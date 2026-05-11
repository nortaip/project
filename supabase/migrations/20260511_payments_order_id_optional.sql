-- ============================================================================
-- payments.order_id NOT NULL məhdudiyyətini aradan qaldır
--
-- Köhnə sxemdə `payments.order_id` NOT NULL idi (bookings flow üçün).
-- Yeni commission flow-da `purpose` metadata-da (service_payment, balance_topup,
-- service_promotion) saxlanır və `order_id` istifadə olunmur. Sütunu silmirik
-- (geriyə uyğunluq üçün), sadəcə NOT NULL məhdudiyyətini götürürük.
--
-- Eyni zamanda hər ehtimala qarşı digər legacy NOT NULL sütunlarını da
-- defensiv yoxlayırıq.
-- ============================================================================

do $$
declare
  rec record;
begin
  for rec in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payments'
       and is_nullable = 'NO'
       and column_name not in (
         -- yeni sistemin mütləq tələb etdiyi sütunlar burada qalır
         'id','user_id','amount','currency','status','provider',
         'created_at','metadata'
       )
  loop
    execute format(
      'alter table public.payments alter column %I drop not null',
      rec.column_name
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
