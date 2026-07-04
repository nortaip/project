-- ============================================================================
-- user_devices RLS policy-ləri
-- ============================================================================
-- Mobile app FCM token-i bu cədvələ yazmalıdır:
--   • INSERT: yalnız öz user_id-si üçün
--   • UPDATE: yalnız öz sətirlərini
--   • SELECT: yalnız öz sətirlərini
--   • DELETE: logout-da öz tokeni silmək üçün
--
-- Admin/superadmin hər şeyi görə bilər (Edge Function service_role ilə işləyir,
-- ona görə RLS-i bypass edir — bu OK).

alter table public.user_devices enable row level security;

-- Köhnə policy-ləri təmizlə (idempotent)
drop policy if exists "users insert own device"  on public.user_devices;
drop policy if exists "users update own device"  on public.user_devices;
drop policy if exists "users select own device"  on public.user_devices;
drop policy if exists "users delete own device"  on public.user_devices;
drop policy if exists "admin all devices"        on public.user_devices;

-- INSERT: yalnız öz user_id ilə
create policy "users insert own device"
  on public.user_devices
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE: yalnız öz sətirləri (upsert üçün lazım)
create policy "users update own device"
  on public.user_devices
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- SELECT: yalnız öz tokenlərini görə bilər
create policy "users select own device"
  on public.user_devices
  for select
  to authenticated
  using (auth.uid() = user_id);

-- DELETE: logout-da öz tokenini silmək
create policy "users delete own device"
  on public.user_devices
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Adminlər hər şeyi (idarəetmə üçün)
create policy "admin all devices"
  on public.user_devices
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'master', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'master', 'superadmin')
    )
  );

-- Grants
grant select, insert, update, delete on public.user_devices to authenticated;

notify pgrst, 'reload schema';
