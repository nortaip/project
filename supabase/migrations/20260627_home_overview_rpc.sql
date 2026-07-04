-- ============================================================================
-- home_overview(): ana səhifənin BÜTÜN datasını TƏK round-trip-də qaytarır.
--   Əvvəl: 6 ayrı sorğu (3 full-table exact count + 131 sətrlik client-side
--   aqreqasiya) + profiles.reviews_count (mövcud olmayan sütun → xəta).
--   İndi: 1 RPC, aqreqasiya DB daxilində, reviews_count provider_reviews-dən.
-- Anonim (login olmamış) istifadəçilər üçün də açıqdır.
-- ============================================================================
create or replace function public.home_overview()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'providers', (select count(*) from profiles where role = 'provider'),
    'services',  (select count(*) from services),
    'bookings',  (select count(*) from bookings),
    'top_providers', coalesce((
      select jsonb_agg(p) from (
        select pr.id, pr.name, pr.avatar_url, pr.rating, pr.is_verified,
               (select count(*) from provider_reviews rv where rv.provider_id = pr.id)::int as reviews_count
        from profiles pr
        where pr.role = 'provider'
        order by pr.rating desc nulls last
        limit 8
      ) p
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(c) from (
        select trim(category) as category, count(*)::int as count
        from services
        where coalesce(trim(category), '') <> ''
        group by trim(category)
        order by count(*) desc
        limit 12
      ) c
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(ct) from (
        select trim(split_part(location, ',', 1)) as city, count(*)::int as count
        from services
        where coalesce(trim(split_part(location, ',', 1)), '') <> ''
        group by trim(split_part(location, ',', 1))
        order by count(*) desc
        limit 10
      ) ct
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r) from (
        select id, title, category, location, created_at
        from services
        order by created_at desc
        limit 5
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.home_overview() from public;
grant execute on function public.home_overview() to anon, authenticated;
notify pgrst, 'reload schema';
