-- Ustanın öz qiymətləri: kateqoriya üzrə qiymət vahidi (iş üzrə / m² / saat)
-- və standart vahid qiyməti. Profil → Usta ayarları → Qiymətlərim.
--
-- Təklif verəndə (place_bid) vahid belə seçilir: ustanın həmin kateqoriya üçün
-- seçdiyi vahid → kateqoriyanın standart vahidi (service_categories.price_unit)
-- → 'fixed'. unit_price təklif formasını avtomatik doldurmaq üçündür; təklifdə
-- usta qiyməti yenə dəyişə bilər. Hamı oxuyur (müştəri ustanın profilində
-- "3 ₼/m²-dən" görə bilsin), yalnız usta özü yazır.

create table if not exists public.provider_prices (
  provider_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete cascade,
  price_unit  text not null default 'fixed'
              check (price_unit in ('fixed', 'm2', 'hour')),
  unit_price  numeric(12,2)
              check (unit_price is null or (unit_price > 0 and unit_price <= 1000000)),
  updated_at  timestamptz not null default now(),
  primary key (provider_id, category_id)
);

alter table public.provider_prices enable row level security;
grant select on public.provider_prices to anon, authenticated;
grant insert, update, delete on public.provider_prices to authenticated;

drop policy if exists ellit_pp_select on public.provider_prices;
create policy ellit_pp_select on public.provider_prices for select to anon, authenticated
  using (true);
drop policy if exists ellit_pp_write on public.provider_prices;
create policy ellit_pp_write on public.provider_prices for all to authenticated
  using (provider_id = auth.uid() or public.is_admin_user())
  with check (provider_id = auth.uid() or public.is_admin_user());

create or replace function public.ellit_touch_provider_prices() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ellit_touch_provider_prices on public.provider_prices;
create trigger ellit_touch_provider_prices before update on public.provider_prices
  for each row execute function public.ellit_touch_provider_prices();
