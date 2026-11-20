-- Yeni qiymət vahidləri: ədəd (piece) və metr (meter).
--   piece — "8 ₼/ədəd × 5 ədəd" (rozetka, lampa, kran...), miqdar tam ədəd
--   meter — "12 ₼/m × 15 m" (boru, kabel, plintus, karniz...)
-- Kateqoriyanın standart vahidi, ustanın öz qiyməti və təklifin özü üçün.

alter table public.service_categories
  drop constraint if exists service_categories_price_unit_check;
alter table public.service_categories
  add constraint service_categories_price_unit_check
  check (price_unit in ('fixed', 'm2', 'hour', 'piece', 'meter'));

alter table public.opportunities_offers
  drop constraint if exists opportunities_offers_price_unit_check;
alter table public.opportunities_offers
  add constraint opportunities_offers_price_unit_check
  check (price_unit is null or price_unit in ('fixed', 'm2', 'hour', 'piece', 'meter'));

alter table public.provider_prices
  drop constraint if exists provider_prices_price_unit_check;
alter table public.provider_prices
  add constraint provider_prices_price_unit_check
  check (price_unit in ('fixed', 'm2', 'hour', 'piece', 'meter'));
