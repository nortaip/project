-- ============================================================================
--  Security Hardening Migration — 2026-05-08
--
--  Addresses critical security findings from initial pentest:
--    C3: profiles UPDATE policy too loose — users could elevate to admin
--    C5: profiles SELECT exposes PII (email, phone, address, balance) to anon
--    C6: handle_new_user trigger trusts client-supplied role → admin elevation
--    H2: missing RLS on payments / provider_wallets / provider_bonus_logs
--
--  Run this in Supabase Dashboard → SQL Editor.
--
--  IDEMPOTENT: Defensive — checks for column/table existence before acting.
--  Safe to re-run multiple times.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIX C6: Sign-up trigger no longer trusts client role payload.            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Defensive: only insert columns that actually exist in profiles.
-- "created_at" / "updated_at" / "email" / "name" hamısı schema-dan asılı ola bilər.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols text[] := array['id', 'role'];
  v_vals text[] := array[
    quote_literal(new.id) || '::uuid',
    quote_literal('customer')
  ];
begin
  -- name (əgər varsa)
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='profiles' and column_name='name') then
    v_cols := array_append(v_cols, 'name');
    v_vals := array_append(
      v_vals,
      quote_literal(coalesce(new.raw_user_meta_data->>'name', ''))
    );
  end if;

  -- email (əgər varsa)
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='profiles' and column_name='email') then
    v_cols := array_append(v_cols, 'email');
    v_vals := array_append(v_vals, quote_literal(coalesce(new.email, '')));
  end if;

  execute format(
    'insert into public.profiles (%s) values (%s) on conflict (id) do nothing',
    array_to_string(v_cols, ', '),
    array_to_string(v_vals, ', ')
  );

  return new;
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIX C3 + C5: profiles RLS                                                ║
-- ║ Drop old loose policies, add tight ones.                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

drop policy if exists "Anyone can read profiles" on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "authenticated read profiles" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;

create policy "authenticated read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "users update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Hard revoke privileged columns — DEFENSIVE: only existing columns        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare
  cols text[] := array[
    'role', 'balance', 'bonus_balance', 'is_verified',
    'status', 'total_bonus_earned', 'rating', 'total_reviews'
  ];
  c text;
begin
  foreach c in array cols loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = c
    ) then
      execute format(
        'revoke update (%I) on public.profiles from authenticated, anon',
        c
      );
      raise notice 'Revoked UPDATE on profiles.% from authenticated/anon', c;
    else
      raise notice 'Column profiles.% does not exist — skipped', c;
    end if;
  end loop;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ public_profiles VIEW — only safe columns. Built dynamically.             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

drop view if exists public.public_profiles;

do $$
declare
  v_select_cols text;
  v_where text;
begin
  -- Build select list from columns that actually exist
  select string_agg(
    format('%I', column_name),
    ', '
    order by ordinal_position
  )
  into v_select_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name in (
      'id', 'name', 'role', 'avatar_url',
      'is_verified', 'rating', 'total_reviews', 'created_at'
    );

  -- WHERE clause only if status column exists
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'status'
  ) then
    v_where := 'where coalesce(status, ''active'') <> ''banned''';
  else
    v_where := '';
  end if;

  execute format(
    'create or replace view public.public_profiles as select %s from public.profiles %s',
    v_select_cols,
    v_where
  );
end $$;

grant select on public.public_profiles to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIX H2: Lock down payments / wallets / bonus logs                        ║
-- ║ DEFENSIVE: only act on tables that exist.                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare
  tbl text;
  owner_col text;
  tables_owners text[][] := array[
    array['payments',             'user_id'],
    array['provider_wallets',     'provider_id'],
    array['provider_bonus_logs',  'provider_id']
  ];
  pair text[];
begin
  foreach pair slice 1 in array tables_owners loop
    tbl       := pair[1];
    owner_col := pair[2];

    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      execute format('alter table public.%I enable row level security', tbl);

      execute format(
        'drop policy if exists "users read own %s" on public.%I',
        tbl, tbl
      );
      execute format(
        'create policy "users read own %s" on public.%I
           for select to authenticated using (auth.uid() = %I)',
        tbl, tbl, owner_col
      );

      execute format(
        'revoke insert, update, delete on public.%I from authenticated, anon',
        tbl
      );

      raise notice 'Locked down %', tbl;
    else
      raise notice 'Table % does not exist — skipped', tbl;
    end if;
  end loop;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper: SECURITY DEFINER for admin role changes (replaces direct UPDATE) ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.admin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid();

  if v_caller_role is null
     or lower(v_caller_role) not in ('admin', 'master', 'superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_new_role not in ('customer', 'provider', 'admin') then
    raise exception 'Invalid role: %', p_new_role;
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_target_user_id;
end;
$$;

revoke execute on function public.admin_set_user_role from public, anon;
grant execute on function public.admin_set_user_role to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Audit log table for sensitive admin actions.                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.audit_log enable row level security;

drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log"
  on public.audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and lower(role) in ('admin', 'master', 'superadmin')
    )
  );

revoke insert, update, delete on public.audit_log from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ VERIFICATION — run these manually after migration                         ║
-- ║                                                                          ║
-- ║   1) RLS coverage:                                                       ║
-- ║      select relname, relrowsecurity from pg_class                        ║
-- ║      where relnamespace='public'::regnamespace and relkind='r';          ║
-- ║                                                                          ║
-- ║   2) public_profiles view (anon should NOT see email/balance):           ║
-- ║      select * from public_profiles limit 1;                              ║
-- ║                                                                          ║
-- ║   3) Try to elevate (should fail with permission denied):                ║
-- ║      update profiles set role='admin' where id=auth.uid();               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
