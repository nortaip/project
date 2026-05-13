-- ============================================================================
-- Faza 3: Avtomatik broadcast dispatch (Uber-style)
--
-- Yeni opportunity yarananda:
--   1. Kateqoriya uyğun briqadalar tapılır (brigade_prices üzərindən)
--   2. Hər briqadanın online aktiv üzvlərinə "offered" assignment yaradılır
--   3. Mövcud bildiriş trigger-i işçilərə xəbər verir
--   4. İlk qəbul edən qazanır — atomic claim_opportunity RPC
--   5. Digər offerlər avtomatik 'expired' olur
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. brigade_members — online status                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.brigade_members
  add column if not exists is_online boolean not null default false;
alter table public.brigade_members
  add column if not exists last_heartbeat timestamptz;

create index if not exists brigade_members_online_idx
  on public.brigade_members (brigade_id, is_online)
  where is_active = true and is_online = true;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. brigade_assignments.status — 'offered' + 'expired' əlavə              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare v_conname text;
begin
  -- Köhnə check constraint-i tap və sil
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.brigade_assignments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%';
  if v_conname is not null then
    execute format('alter table public.brigade_assignments drop constraint %I', v_conname);
  end if;
end$$;

alter table public.brigade_assignments
  add constraint brigade_assignments_status_check
  check (status in (
    'offered', 'assigned', 'accepted', 'declined',
    'in_progress', 'completed', 'cancelled', 'expired'
  ));

-- assigned_by-ı nullable et — auto-broadcast üçün
alter table public.brigade_assignments
  alter column assigned_by drop not null;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Notification trigger — 'offered' üçün də işləsin                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.notify_member_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id   uuid;
  v_brigade_name text;
  v_opp_title    text;
  v_kind         text;
  v_title        text;
  v_body         text;
begin
  if new.status not in ('offered', 'assigned') then return new; end if;

  select profile_id into v_profile_id
    from public.brigade_members where id = new.member_id;
  if v_profile_id is null then return new; end if;

  select name into v_brigade_name from public.brigades where id = new.brigade_id;
  begin
    select op.title into v_opp_title
      from public.opportunities op
     where op.id::text = new.source_id;
  exception when others then v_opp_title := null;
  end;

  v_kind  := case when new.status = 'offered' then 'brigade_offer' else 'brigade_assignment' end;
  v_title := coalesce(v_brigade_name, 'Briqada') || ' — ' ||
             case when new.status = 'offered' then 'yeni sifariş' else 'yeni təyinat' end;
  v_body  := coalesce(v_opp_title, 'Sifariş') || ' — ' ||
             case when new.status = 'offered'
                  then 'ilk qəbul edən qazanır'
                  else 'sənə təyin edildi'
             end;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    v_profile_id, v_title, v_body, v_kind, new.id::text,
    '/account/master/incoming'
  );

  return new;
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. RPC: set_member_online — işçi online/offline keçir                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.set_member_online(p_is_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  update public.brigade_members
     set is_online = p_is_online,
         last_heartbeat = now()
   where profile_id = v_caller and is_active = true;
end;
$$;

revoke execute on function public.set_member_online(boolean) from public, anon;
grant execute on function public.set_member_online(boolean) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Funksiya: auto_broadcast_opportunity                                  ║
-- ║   Sifarişi uyğun briqadaların online işçilərinə broadcast edir           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.auto_broadcast_opportunity(p_opp_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp        record;
  v_inserted   int := 0;
  v_brigade_id uuid;
  v_member_id  uuid;
begin
  select id, category_id, subcategory_id, status, created_by
    into v_opp
    from public.opportunities
   where id = p_opp_id;
  if v_opp.id is null then return 0; end if;

  -- Bu opportunity-yə artıq accepted/in_progress assignment varsa, skip
  if exists (
    select 1 from public.brigade_assignments
     where source_id = p_opp_id::text
       and status in ('accepted', 'in_progress', 'completed')
  ) then
    return 0;
  end if;

  -- Uyğun briqadaları tap: brigade_prices-də həmin category üçün
  -- aktiv qiyməti olan, briqada özü is_active=true (əgər sahə varsa)
  for v_brigade_id, v_member_id in
    select distinct bp.brigade_id, bm.id
      from public.brigade_prices bp
      join public.brigade_members bm on bm.brigade_id = bp.brigade_id
     where bp.category_id = v_opp.category_id
       and bp.is_active = true
       and (bp.subcategory_id is null or bp.subcategory_id = v_opp.subcategory_id)
       and bm.is_active = true
       and bm.is_online = true
       and bm.profile_id <> coalesce(v_opp.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
       -- Bloklananları çıxar
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocked_id = bm.profile_id
            and ub.scope = 'global'
       )
  loop
    begin
      insert into public.brigade_assignments
        (brigade_id, member_id, source_type, source_id,
         assigned_by, status, priority)
      values
        (v_brigade_id, v_member_id, 'opportunity', p_opp_id::text,
         null, 'offered', 5);
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      null;  -- artıq broadcast olunmuş
    end;
  end loop;

  return v_inserted;
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. Trigger: opportunity insert → auto broadcast                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.tg_opportunity_auto_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yalnız təzə açıq sifarişlər
  if coalesce(new.status, '') not in ('open', 'pending', 'new', 'active') then
    return new;
  end if;
  if new.category_id is null then return new; end if;

  begin
    perform public.auto_broadcast_opportunity(new.id);
  exception when others then
    -- Broadcast uğursuzluğu sifarişin yaranmasını blok etməsin
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_auto_broadcast on public.opportunities;
create trigger trg_opportunity_auto_broadcast
  after insert on public.opportunities
  for each row execute function public.tg_opportunity_auto_broadcast();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. RPC: claim_opportunity — ilk gələn qazanır (atomic)                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.claim_opportunity(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_assignment   record;
  v_member_uid   uuid;
  v_other_count  int;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  -- Bu assignment-ı kilidlə
  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id
   for update;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden: only assigned member can claim';
  end if;
  if v_assignment.status not in ('offered', 'assigned') then
    raise exception 'Assignment already %', v_assignment.status;
  end if;

  -- Başqa biri artıq qəbul edibmi? (eyni source_id üçün)
  select count(*) into v_other_count
    from public.brigade_assignments
   where source_id = v_assignment.source_id
     and id <> v_assignment.id
     and status in ('accepted', 'in_progress', 'completed');
  if v_other_count > 0 then
    -- Bu offer-i avtomatik expired et
    update public.brigade_assignments
       set status = 'expired', responded_at = now()
     where id = v_assignment.id;
    raise exception 'Sifariş artıq başqa işçi tərəfindən qəbul edildi';
  end if;

  -- Qəbul et
  update public.brigade_assignments
     set status = 'accepted', responded_at = now()
   where id = v_assignment.id;

  -- Eyni opportunity üzrə qalan offerləri expired et
  update public.brigade_assignments
     set status = 'expired', responded_at = now()
   where source_id = v_assignment.source_id
     and id <> v_assignment.id
     and status in ('offered', 'assigned');

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'opportunity_claim', 'brigade_assignment',
            v_assignment.id::text,
            jsonb_build_object('source_id', v_assignment.source_id,
                               'brigade_id', v_assignment.brigade_id));
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.claim_opportunity(uuid) from public, anon;
grant execute on function public.claim_opportunity(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. RPC: decline_offer — işçi imtina edir                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.decline_offer(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_assignment record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden';
  end if;
  if v_assignment.status not in ('offered', 'assigned') then
    raise exception 'Cannot decline %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = 'declined', responded_at = now()
   where id = p_assignment_id;
end;
$$;

revoke execute on function public.decline_offer(uuid) from public, anon;
grant execute on function public.decline_offer(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 9. RLS: assigned_by-ı nullable etdik, mövcud policy-ləri qoruyaq         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- (mövcud policy-lər brigade_dispatch.sql-də artıq qurulub)


notify pgrst, 'reload schema';
