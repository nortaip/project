-- ============================================================================
-- Provayder öz işinin statusunu update edə bilməlidir
--
-- Problem: 20260510_opportunities_rls_fix.sql-də UPDATE policy yalnız customer
-- (created_by) və admin-ə icazə verir. Provayder "İşə başla" / "Bitirdim"
-- düymələrinə basanda update fail olur.
--
-- Düzəliş: provayder yalnız o opportunity-ləri update edə bilər ki:
--   - opportunity.provider_id = auth.uid()  (köhnə yol)
--   - VƏ YA accepted_offer_id-yə uyğun offer-in provider-i auth.uid()-dir
-- ============================================================================

-- Köhnə update policy-ni sil
drop policy if exists "opportunities_update_own_or_admin" on public.opportunities;
drop policy if exists "opportunities_update_provider" on public.opportunities;

-- Yeni geniş policy
create policy "opportunities_update_owner_provider_admin"
  on public.opportunities
  for update
  to authenticated
  using (
    -- Customer (sifariş sahibi)
    auth.uid() = created_by
    -- Provider (provider_id sütunu)
    or auth.uid() = provider_id
    -- Provider (accepted_offer-in sahibi)
    or auth.uid() in (
      select provider_id from public.opportunities_offers
       where id = opportunities.accepted_offer_id
    )
    -- Admin
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  )
  with check (
    auth.uid() = created_by
    or auth.uid() = provider_id
    or auth.uid() in (
      select provider_id from public.opportunities_offers
       where id = opportunities.accepted_offer_id
    )
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

notify pgrst, 'reload schema';
