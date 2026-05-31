-- ============================================================================
-- Fix: notifications INSERT permission for authenticated users
-- ============================================================================
-- 20260512_realtime_and_notifications.sql `revoke insert ... from authenticated`
-- edir, ona görə Flutter/web client öz notification-larını yaza bilmir.
-- (Xəta: "permission denied for table notifications", code 42501)
--
-- Bu migration:
--   1. Grant-i geri qaytarır
--   2. RLS policy əlavə edir: yalnız öz user_id-si üçün insert edə bilər
--   3. Realtime publication-ı qoruyur

grant insert on public.notifications to authenticated;

drop policy if exists "users insert own notifications" on public.notifications;
create policy "users insert own notifications"
  on public.notifications
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Köhnə dublikat policy-lər varsa təmizlə
drop policy if exists "users can insert own notifications" on public.notifications;
create policy "users can insert own notifications"
  on public.notifications
  for insert
  to authenticated
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
