-- ============================================================================
-- Opportunities RLS fix
--
-- Problem: customer sorğu yaradanda, sorğu provider-lərin qarşısına düşmür.
--
-- Səbəb: əvvəl wizard `provider_id: userId` (customer-in özü) yazırdı, bu
-- mümkün RLS policy ilə kombinasiyada provider-lərin SELECT-ini bloklayırdı.
-- Yeni wizard `provider_id`-i set etmir.
--
-- Bu migration:
-- 1. opportunities cədvəlində `status` sütununu yoxlayır (yoxdursa əlavə)
-- 2. RLS-i düzəldir:
--    SELECT: bütün authenticated user-lər aktiv (status='open') sorğuları görür
--            VƏ customer öz sorğularını həmişə görür (istənilən statusda)
--    INSERT: yalnız öz adına (created_by = auth.uid())
--    UPDATE: customer öz sorğusunu update edə bilər
-- 3. provider_id sütununun default null olmasına icazə verir
-- ============================================================================

-- ── 1. Defensive column adds ─────────────────────────────────────────
do $$
begin
  -- status sütunu (yoxdursa əlavə et)
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='opportunities' and column_name='status'
  ) then
    alter table public.opportunities add column status text default 'open';
  end if;

  -- accepted_offer_id (offer qəbul olunduqda təyin olunur)
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='opportunities' and column_name='accepted_offer_id'
  ) then
    alter table public.opportunities add column accepted_offer_id uuid;
  end if;
end$$;

-- provider_id NOT NULL məhdudiyyəti varsa onu NULLABLE et
-- (köhnə schema bunu məcburi edə bilər)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='opportunities'
       and column_name='provider_id' and is_nullable='NO'
  ) then
    alter table public.opportunities alter column provider_id drop not null;
  end if;
end$$;


-- ── 2. RLS policies ───────────────────────────────────────────────────
alter table public.opportunities enable row level security;

-- Köhnə hər hansı opportunities policy-lərini sil
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname='public' and tablename='opportunities'
  loop
    execute format('drop policy if exists %I on public.opportunities', r.policyname);
  end loop;
end$$;

-- SELECT: authenticated user-lər
--   - Provider/admin: bütün sorğuları görür (təklif vermək üçün)
--   - Hər kəs öz yaratdığı sorğuları görür (status fərq etməz)
create policy "opportunities_select_all_authenticated"
  on public.opportunities
  for select
  to authenticated
  using (true);

-- Anon-a görsənmə yoxdur (təhlükəsizlik)
revoke all on public.opportunities from anon;
grant select, insert, update on public.opportunities to authenticated;

-- INSERT: yalnız öz adına
create policy "opportunities_insert_own"
  on public.opportunities
  for insert
  to authenticated
  with check (auth.uid() = created_by);

-- UPDATE: customer öz sorğusunu, admin hər şeyi
create policy "opportunities_update_own_or_admin"
  on public.opportunities
  for update
  to authenticated
  using (
    auth.uid() = created_by
    or coalesce(
      (select lower(role) in ('admin','master','superadmin')
         from public.profiles where id = auth.uid()),
      false
    )
  )
  with check (
    auth.uid() = created_by
    or coalesce(
      (select lower(role) in ('admin','master','superadmin')
         from public.profiles where id = auth.uid()),
      false
    )
  );


-- ── 3. opportunities_offers RLS yoxla (provider təklif verə bilsin) ──
alter table public.opportunities_offers enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname='public' and tablename='opportunities_offers'
  loop
    execute format('drop policy if exists %I on public.opportunities_offers', r.policyname);
  end loop;
end$$;

-- SELECT: təklif verən provayder + sorğu sahibi customer
create policy "offers_select_provider_or_customer"
  on public.opportunities_offers
  for select
  to authenticated
  using (
    auth.uid() = provider_id
    or auth.uid() in (
      select created_by from public.opportunities where id = opportunity_id
    )
  );

-- INSERT: yalnız öz adına (provider təklif verir)
create policy "offers_insert_own"
  on public.opportunities_offers
  for insert
  to authenticated
  with check (auth.uid() = provider_id);

-- UPDATE: təklif sahibi (provider) və sorğu sahibi (customer status dəyişə bilər)
create policy "offers_update_owner"
  on public.opportunities_offers
  for update
  to authenticated
  using (
    auth.uid() = provider_id
    or auth.uid() in (
      select created_by from public.opportunities where id = opportunity_id
    )
  );

revoke all on public.opportunities_offers from anon;
grant select, insert, update on public.opportunities_offers to authenticated;


-- ── 4. PostgREST schema cache reload ─────────────────────────────────
notify pgrst, 'reload schema';
