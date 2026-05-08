-- ============================================================================
-- Migration: bookings → profiles FK fix
--
-- PostgREST `provider:profiles!provider_id(...)` join-i yalnız o zaman işləyir
-- ki, `bookings.provider_id` üçün `profiles(id)` -ə FK constraint olsun.
-- Bəzi mühitlərdə bu FK itib və ya heç qoyulmayıb. Bu migration onu garant edir.
-- Həm də `customer_id` və `service_id` üçün analoji FK-ları yoxlayır.
-- ============================================================================

do $$
declare
  v_count int;
begin
  -- ── 1. provider_id → profiles(id) FK ─────────────────────────────────
  select count(*) into v_count
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
   where tc.table_schema = 'public'
     and tc.table_name = 'bookings'
     and tc.constraint_type = 'FOREIGN KEY'
     and kcu.column_name = 'provider_id';

  if v_count = 0 then
    -- Sütun varsa amma FK yoxdursa, əlavə et
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='provider_id'
    ) then
      alter table public.bookings
        add constraint bookings_provider_id_fkey
        foreign key (provider_id) references public.profiles(id)
        on delete cascade;
      raise notice 'Added bookings_provider_id_fkey';
    end if;
  end if;

  -- ── 2. customer_id → profiles(id) FK ─────────────────────────────────
  select count(*) into v_count
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
   where tc.table_schema = 'public'
     and tc.table_name = 'bookings'
     and tc.constraint_type = 'FOREIGN KEY'
     and kcu.column_name = 'customer_id';

  if v_count = 0 then
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='customer_id'
    ) then
      alter table public.bookings
        add constraint bookings_customer_id_fkey
        foreign key (customer_id) references public.profiles(id)
        on delete cascade;
      raise notice 'Added bookings_customer_id_fkey';
    end if;
  end if;

  -- ── 3. service_id → services(id) FK ──────────────────────────────────
  select count(*) into v_count
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
   where tc.table_schema = 'public'
     and tc.table_name = 'bookings'
     and tc.constraint_type = 'FOREIGN KEY'
     and kcu.column_name = 'service_id';

  if v_count = 0 then
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='service_id'
    ) then
      alter table public.bookings
        add constraint bookings_service_id_fkey
        foreign key (service_id) references public.services(id)
        on delete cascade;
      raise notice 'Added bookings_service_id_fkey';
    end if;
  end if;
end$$;

-- PostgREST schema cache-ni reload et (live DB üçün)
notify pgrst, 'reload schema';
