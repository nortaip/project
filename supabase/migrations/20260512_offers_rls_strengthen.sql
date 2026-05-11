-- ============================================================================
-- opportunities_offers RLS gücləndirilməsi
--
-- Problem: müştəri mobil/web tərəfdə öz sifarişlərinin təkliflərini görə bilmir.
-- Səbəb subquery (`select created_by from opportunities ...`) bəzən RLS
-- kontekstində düzgün işləmir.
--
-- Düzəliş: policy-i daha aydın yenidən yazırıq, plus opportunities-də
-- created_by sütunu üçün indeks əlavə edirik ki subquery sürətli olsun.
-- ============================================================================

-- Aktiv etmək (təkrar)
alter table public.opportunities_offers enable row level security;

-- Köhnə policy-ləri sil (yenidən qurmaq üçün)
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

-- SELECT: provayder öz təkliflərini, müştəri öz sifarişinin bütün təkliflərini,
-- admin də hamısını görür
create policy "offers_select_provider_customer_admin"
  on public.opportunities_offers
  for select
  to authenticated
  using (
    -- Provider öz təklifini görür
    auth.uid() = provider_id
    -- VƏ YA müştəri öz opportunity-sinin təkliflərini görür
    or exists (
      select 1 from public.opportunities op
       where op.id = opportunities_offers.opportunity_id
         and op.created_by = auth.uid()
    )
    -- VƏ YA admin/master/superadmin
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

-- INSERT: yalnız provayder kimi öz adına
create policy "offers_insert_provider_self"
  on public.opportunities_offers
  for insert
  to authenticated
  with check (auth.uid() = provider_id);

-- UPDATE: provayder öz təklifini, müştəri öz opportunity-sinin offer-larını,
-- admin də hamısını update edə bilər
create policy "offers_update_provider_customer_admin"
  on public.opportunities_offers
  for update
  to authenticated
  using (
    auth.uid() = provider_id
    or exists (
      select 1 from public.opportunities op
       where op.id = opportunities_offers.opportunity_id
         and op.created_by = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

revoke all on public.opportunities_offers from anon;
grant select, insert, update on public.opportunities_offers to authenticated;

-- Index: customer subquery sürətli olsun
create index if not exists opportunities_created_by_idx
  on public.opportunities (created_by);

create index if not exists offers_opportunity_id_idx
  on public.opportunities_offers (opportunity_id, status);

-- ── Realtime publication (təkrar yoxla) ───────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='opportunities_offers'
  ) then
    alter publication supabase_realtime add table public.opportunities_offers;
  end if;
end$$;

notify pgrst, 'reload schema';
