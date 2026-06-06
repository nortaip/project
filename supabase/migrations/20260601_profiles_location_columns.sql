-- ============================================================================
-- profiles cədvəlinə provayder yerləşməsi sahələri əlavə et
-- ============================================================================
-- Bot provayderləri xəritədə göstərmək üçün bu sahələr lazımdır:
--   • latitude, longitude — provayderin online halda olduğu yer
--   • avatar_url, rating, is_online, last_seen_at — UI üçün
--
-- Bu sahələr yoxdursa əlavə edilir (idempotent).

alter table public.profiles add column if not exists latitude     numeric;
alter table public.profiles add column if not exists longitude    numeric;
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists rating       numeric default 0;
alter table public.profiles add column if not exists is_online    boolean default false;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Optional: is_bot bayrağı — demo provayderləri real-dan ayırd etmək üçün
alter table public.profiles add column if not exists is_bot       boolean default false;

-- Coordinate index — xəritə sorğularını sürətləndirmək üçün
create index if not exists profiles_provider_location_idx
  on public.profiles (role, is_online, latitude, longitude)
  where role = 'provider' and latitude is not null and longitude is not null;

notify pgrst, 'reload schema';
