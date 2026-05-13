-- ============================================================================
-- Fix: provider_wallets və bağlı cədvəllər üçün REPLICA IDENTITY
--
-- Səhv: "cannot delete from table because it does not have a replica identity
-- and publishes deletes" (55000)
--
-- Səbəb: Cədvəl supabase_realtime publication-a əlavə olunub DELETE event ilə,
-- amma PK əsaslı replica identity explicit qeyd olunmayıb.
-- ============================================================================

alter table if exists public.provider_wallets       replica identity full;
alter table if exists public.brigade_assignments    replica identity full;
alter table if exists public.brigade_prices         replica identity full;
alter table if exists public.brigade_applications   replica identity full;
alter table if exists public.brigade_members        replica identity full;
alter table if exists public.brigades               replica identity full;
alter table if exists public.notifications          replica identity full;
alter table if exists public.user_blocks            replica identity full;
alter table if exists public.opportunities          replica identity full;
alter table if exists public.opportunities_offers   replica identity full;

notify pgrst, 'reload schema';
