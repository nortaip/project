-- ============================================================================
-- Brigade dispatch notification + user block table
--
-- 1. Trigger: yeni brigade_assignment → işçiyə notification
-- 2. user_blocks cədvəli: brigade və ya admin tərəfindən bloklananlar
-- 3. RPC-lər: block/unblock + bloklanmış userlərin yoxlanılması
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. TRIGGER: brigade_assignment → notification                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.notify_member_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_brigade_name text;
  v_opp_title text;
begin
  if new.status <> 'assigned' then return new; end if;

  -- Member-in profile_id-sini tap
  select profile_id into v_profile_id
    from public.brigade_members
   where id = new.member_id;
  if v_profile_id is null then return new; end if;

  -- Brigade adı
  select name into v_brigade_name from public.brigades where id = new.brigade_id;

  -- Opportunity başlığı
  select op.title into v_opp_title
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id::text = new.source_id;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    v_profile_id,
    coalesce(v_brigade_name, 'Briqada') || ' — yeni təyinat',
    coalesce(v_opp_title, 'Sifariş') || ' sənə təyin edildi. Qəbul və ya rədd et.',
    'brigade_assignment',
    new.id::text,
    '/brigades/' || new.brigade_id::text
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_member_on_assignment on public.brigade_assignments;
create trigger trg_notify_member_on_assignment
  after insert on public.brigade_assignments
  for each row execute function public.notify_member_on_assignment();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. user_blocks cədvəli                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.user_blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  reason      text,
  scope       text not null default 'global'
                check (scope in ('global', 'brigade', 'customer')),
  brigade_id  uuid references public.brigades(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists user_blocks_blocker_idx on public.user_blocks (blocker_id);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- Unique constraint with NULL-safe brigade_id handling (expression index)
create unique index if not exists user_blocks_unique_idx
  on public.user_blocks (
    blocker_id,
    blocked_id,
    scope,
    coalesce(brigade_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.user_blocks enable row level security;

drop policy if exists "users read own blocks" on public.user_blocks;
create policy "users read own blocks"
  on public.user_blocks for select to authenticated
  using (
    auth.uid() = blocker_id
    or auth.uid() = blocked_id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

drop policy if exists "users create own blocks" on public.user_blocks;
create policy "users create own blocks"
  on public.user_blocks for insert to authenticated
  with check (
    auth.uid() = blocker_id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

drop policy if exists "users delete own blocks" on public.user_blocks;
create policy "users delete own blocks"
  on public.user_blocks for delete to authenticated
  using (
    auth.uid() = blocker_id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

grant select, insert, delete on public.user_blocks to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC: block_user                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.block_user(
  p_blocked_id uuid,
  p_reason     text default null,
  p_scope      text default 'global',
  p_brigade_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_id     uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_blocked_id then raise exception 'Cannot block yourself'; end if;
  if p_scope not in ('global', 'brigade', 'customer') then
    raise exception 'Invalid scope';
  end if;

  -- Brigade scope-da yoxla ki, caller həmin brigade-in dispatcher/owner-idirmi
  if p_scope = 'brigade' then
    if p_brigade_id is null then raise exception 'brigade_id required'; end if;
    if not is_brigade_dispatcher(p_brigade_id, v_caller) then
      raise exception 'Forbidden: only brigade owner/dispatcher';
    end if;

    -- Brigade-dən üzvü çıxar
    update public.brigade_members
       set is_active = false
     where brigade_id = p_brigade_id and profile_id = p_blocked_id;
  end if;

  -- Block sətrini yarat (ON CONFLICT DO NOTHING)
  insert into public.user_blocks (blocker_id, blocked_id, reason, scope, brigade_id)
  values (v_caller, p_blocked_id, p_reason, p_scope, p_brigade_id)
  on conflict do nothing
  returning id into v_id;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'user_block', 'user', p_blocked_id::text,
            jsonb_build_object('scope', p_scope, 'brigade_id', p_brigade_id, 'reason', p_reason));
  exception when others then null;
  end;

  return v_id;
end;
$$;

revoke execute on function public.block_user(uuid, text, text, uuid) from public, anon;
grant   execute on function public.block_user(uuid, text, text, uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. RPC: unblock_user                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.unblock_user(
  p_block_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_block  record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_block from public.user_blocks where id = p_block_id;
  if v_block.id is null then raise exception 'Block not found'; end if;

  -- Yalnız blocker özü və ya admin
  if v_block.blocker_id <> v_caller
     and not exists (
       select 1 from public.profiles p
        where p.id = v_caller
          and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
     ) then
    raise exception 'Forbidden';
  end if;

  delete from public.user_blocks where id = p_block_id;
end;
$$;

revoke execute on function public.unblock_user(uuid) from public, anon;
grant   execute on function public.unblock_user(uuid) to authenticated;

notify pgrst, 'reload schema';
