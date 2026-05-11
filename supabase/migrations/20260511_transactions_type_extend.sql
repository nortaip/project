-- ============================================================================
-- transactions.type CHECK constraint-i genişləndir
--
-- 20260510_commission_settings_v2.sql `escrow_lock` və `escrow_release` insert
-- edir, lakin köhnə CHECK constraint yalnız top_up/booking_charge/refund/
-- bonus_earn/bonus_convert/withdrawal/admin_adjust dəyərlərini icazə verir.
-- Yeni axın bu səbəbdən DB səviyyəsində fail olur.
-- ============================================================================

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.transactions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%type%';

  if v_constraint is not null then
    execute format('alter table public.transactions drop constraint %I', v_constraint);
  end if;

  alter table public.transactions
    add constraint transactions_type_check
    check (type in (
      'top_up',
      'booking_charge',
      'refund',
      'bonus_earn',
      'bonus_convert',
      'withdrawal',
      'admin_adjust',
      'escrow_lock',
      'escrow_release',
      'platform_revenue'
    ));
end;
$$;

notify pgrst, 'reload schema';
