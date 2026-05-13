-- ============================================================================
-- Brigade dispatch — sifarişləri işçilərə paylama RPC-ləri
--
-- Mövcud sxem (20260508_brigades.sql):
--   - brigades
--   - brigade_members (owner/dispatcher/member)
--   - brigade_assignments (1 sifariş → 1-N işçiyə)
--
-- Bu migration:
--   1. brigade_dispatch_order(brigade_id, source_id, member_ids[], priority, notes)
--      → dispatcher/owner sifarişi 1 və ya bir neçə işçiyə yönləndirir
--   2. brigade_assignment_respond(assignment_id, action) → işçi qəbul/rədd
--   3. brigade_assignment_complete(assignment_id) → işçi tamamladığını qeyd
--   4. RLS: dispatcher/owner brigade_assignments insert/update edə bilər
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper — istifadəçi briqadanın dispatcher və ya owner-idirmi?            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.is_brigade_dispatcher(p_brigade_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brigade_members
     where brigade_id = p_brigade_id
       and profile_id = p_user_id
       and is_active = true
       and role in ('owner', 'dispatcher')
  );
$$;

grant execute on function public.is_brigade_dispatcher(uuid, uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RPC: brigade_dispatch_order                                              ║
-- ║   Dispatcher/owner offer-i bir və ya bir neçə işçiyə yönləndirir         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_dispatch_order(
  p_brigade_id uuid,
  p_source_id  text,                 -- opportunities_offers.id
  p_member_ids uuid[],               -- brigade_members.id[] (1 və ya çox)
  p_priority   int default 5,
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inserted int := 0;
  v_member_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Forbidden: only brigade owner/dispatcher can dispatch';
  end if;

  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    raise exception 'At least one member_id required';
  end if;

  -- Hər member üçün assignment yarat (uniqueness constraint duplicate-i tutar)
  foreach v_member_id in array p_member_ids
  loop
    begin
      insert into public.brigade_assignments
        (brigade_id, member_id, source_type, source_id,
         assigned_by, status, notes, priority)
      values
        (p_brigade_id, v_member_id, 'opportunity', p_source_id,
         v_caller, 'assigned', p_notes, p_priority);
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      -- Bu member-ə artıq təyin edilib — keç
      null;
    end;
  end loop;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      v_caller,
      'brigade_dispatch',
      'brigade_assignment',
      p_source_id,
      jsonb_build_object(
        'brigade_id', p_brigade_id,
        'member_count', v_inserted,
        'priority', p_priority
      )
    );
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

revoke execute on function public.brigade_dispatch_order(uuid, text, uuid[], int, text)
  from public, anon;
grant execute on function public.brigade_dispatch_order(uuid, text, uuid[], int, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RPC: brigade_assignment_respond                                          ║
-- ║   İşçi təyin olunmuş işi qəbul / rədd edir                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_assignment_respond(
  p_assignment_id uuid,
  p_action        text   -- 'accept' | 'decline'
)
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
  if p_action not in ('accept', 'decline') then
    raise exception 'Invalid action (accept | decline)';
  end if;

  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden: only assigned member can respond';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'Assignment already %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = case when p_action = 'accept' then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_assignment_id;
end;
$$;

revoke execute on function public.brigade_assignment_respond(uuid, text)
  from public, anon;
grant execute on function public.brigade_assignment_respond(uuid, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RPC: brigade_assignment_complete                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_assignment_complete(p_assignment_id uuid)
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

  select a.*, m.profile_id as member_profile_id, m.brigade_id as bid
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;

  -- Member özü VƏ YA dispatcher tamamlanmış kimi qeyd edə bilər
  if v_assignment.member_profile_id <> v_caller
     and not is_brigade_dispatcher(v_assignment.bid, v_caller) then
    raise exception 'Forbidden';
  end if;
  if v_assignment.status not in ('accepted', 'in_progress') then
    raise exception 'Assignment cannot be completed from %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = 'completed',
         completed_at = now()
   where id = p_assignment_id;
end;
$$;

revoke execute on function public.brigade_assignment_complete(uuid) from public, anon;
grant execute on function public.brigade_assignment_complete(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — brigade_assignments üçün INSERT/UPDATE icazələri                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname='public' and tablename='brigade_assignments'
  loop
    execute format('drop policy if exists %I on public.brigade_assignments', r.policyname);
  end loop;
end$$;

-- SELECT: brigade üzvləri (member, dispatcher, owner) öz brigade-in assignments-ni görür
create policy "members read brigade assignments"
  on public.brigade_assignments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.brigade_members bm
       where bm.brigade_id = brigade_assignments.brigade_id
         and bm.profile_id = auth.uid()
         and bm.is_active = true
    )
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

-- INSERT: yalnız dispatcher/owner (RPC vasitəsilə) — direct insert blok, RPC ilə icazə
-- (RPC security definer-dir, RLS bypass edir)
revoke insert on public.brigade_assignments from authenticated, anon;

-- UPDATE: member öz row-unu yeniləyə bilər (status), dispatcher hamısını
create policy "members update own assignments or dispatcher updates any"
  on public.brigade_assignments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.brigade_members bm
       where bm.id = brigade_assignments.member_id
         and bm.profile_id = auth.uid()
    )
    or is_brigade_dispatcher(brigade_assignments.brigade_id, auth.uid())
  );

grant select, update on public.brigade_assignments to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime publication                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='brigade_assignments'
  ) then
    alter publication supabase_realtime add table public.brigade_assignments;
  end if;
end$$;

notify pgrst, 'reload schema';
