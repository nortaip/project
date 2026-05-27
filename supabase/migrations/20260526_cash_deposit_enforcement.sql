-- ============================================================================
-- Payment enforcement: cash method requires 20% card deposit
--
-- Yeni model:
--   • 'card'  → 100% balansdan çıxır, escrow → provider locked_balance
--   • 'cash'  → 20% balansdan çıxır (deposit), 80% nağd provider yığır
--               Deposit → provider escrow. Tamamlanmada deposit komissiya
--               tutulduqdan sonra provider balansına keçir.
--
-- Customer cancel etsə: deposit provider-ə forfeit.
-- Customer ödəniş etmədən iş başlayama bilmir (deposit lock-suz offer accept
-- edilə bilməz).
-- ============================================================================

-- 1. Deposit faizini config-ə yaz
insert into public.platform_config (key, value)
values ('cash_deposit_pct', '20'::jsonb)
on conflict (key) do nothing;

-- 2. opportunities_offers-ə deposit sütunu
alter table public.opportunities_offers
  add column if not exists cash_deposit_amount numeric;

-- 3. RPC: accept_offer_with_payment — cash üçün 20% deposit lock
create or replace function public.accept_offer_with_payment(
  p_offer_id uuid,
  p_method   text   -- 'cash' | 'card'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_offer          record;
  v_customer_bal   numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_provider_amt   numeric;
  v_deposit_pct    numeric;
  v_deposit_amt    numeric;
  v_lock_amt       numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then
    raise exception 'Invalid payment method (must be cash or card)';
  end if;

  -- Offer + opportunity creator yüklə
  select oo.id, oo.opportunity_id, oo.provider_id, oo.offer_amount, oo.status,
         op.created_by, op.id as opp_id
    into v_offer
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_offer.id is null then raise exception 'Offer not found'; end if;
  if v_offer.created_by <> v_caller then
    raise exception 'Forbidden — not opportunity owner';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'Offer is not pending (current: %)', v_offer.status;
  end if;

  -- Müştəri balansı
  select coalesce(balance,0) into v_customer_bal
    from public.profiles where id = v_caller;

  -- Komissiya faizi
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';

  -- ── METOD-A GÖRƏ LOCK MƏBLƏĞİ ───────────────────────────────────────
  if p_method = 'card' then
    v_lock_amt    := v_offer.offer_amount;
    v_deposit_amt := null;
  else
    -- Cash: 20% deposit
    select coalesce((value)::text::numeric, 20) into v_deposit_pct
      from public.platform_config where key = 'cash_deposit_pct';
    v_deposit_amt := round(v_offer.offer_amount * v_deposit_pct / 100, 2);
    v_lock_amt    := v_deposit_amt;
  end if;

  -- Balans yoxlanışı (hər iki metod üçün)
  if v_customer_bal < v_lock_amt then
    raise exception 'INSUFFICIENT_BALANCE: required=% available=% method=%',
      v_lock_amt, v_customer_bal, p_method;
  end if;

  -- Komissiya hesabla (full offer üzərindən — cash + card eyni)
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt   := v_lock_amt - case when p_method='card'
                                        then v_commission_amt
                                        else 0 end;

  -- ── 1. Customer balansından debit (deposit və ya tam) ──────────────
  update public.profiles
     set balance = balance - v_lock_amt
   where id = v_caller;

  -- ── 2. Provider escrow-una credit ───────────────────────────────────
  insert into public.provider_wallets (provider_id, locked_balance)
  values (v_offer.provider_id, v_provider_amt)
  on conflict (provider_id) do update
    set locked_balance = public.provider_wallets.locked_balance + v_provider_amt,
        updated_at     = now();

  -- ── 3. Transactions audit (customer debit) ─────────────────────────
  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values (
    v_caller,
    'booking_charge',
    -v_lock_amt,
    v_customer_bal - v_lock_amt,
    case when p_method='card'
         then 'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8)
         else 'Nağd sifariş depoziti (' || v_deposit_pct || '%), offer '
              || left(p_offer_id::text, 8) end,
    p_offer_id::text,
    v_caller
  );

  -- ── 4. Transactions audit (provider escrow lock) ───────────────────
  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values (
    v_offer.provider_id,
    'escrow_lock',
    v_provider_amt,
    0,
    case when p_method='card'
         then 'Müştəri ödənişi escrow-a düşdü (qəbul komissiyası: '
              || v_commission_pct || '%, ' || v_commission_amt || ' ₼)'
         else 'Nağd sifariş depoziti escrow-da (' || v_deposit_pct || '%)' end,
    p_offer_id::text,
    v_caller
  );

  -- Offer-i accepted statusuna keçir
  update public.opportunities_offers
     set status               = 'accepted',
         payment_method       = p_method,
         cash_deposit_amount  = v_deposit_amt,
         paid_at              = now()
   where id = p_offer_id;

  -- Eyni opportunity-yə digər pending təklifləri rədd et
  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = v_offer.opp_id
     and id <> p_offer_id
     and status = 'pending';

  -- Opportunity-ni active + accepted_offer_id + provider_id təyin et
  update public.opportunities
     set status            = 'active',
         accepted_offer_id = p_offer_id,
         provider_id       = v_offer.provider_id
   where id = v_offer.opp_id;

  return jsonb_build_object(
    'ok', true,
    'method', p_method,
    'offer_id', p_offer_id,
    'opportunity_id', v_offer.opp_id,
    'locked_amount', v_lock_amt,
    'deposit_amount', v_deposit_amt
  );
end;
$$;

revoke execute on function public.accept_offer_with_payment(uuid, text) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text) to authenticated;

-- ============================================================================
-- release_offer_to_provider: cash üçün deposit + 80% kompensasiya
-- ============================================================================
create or replace function public.release_offer_to_provider(p_offer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_provider_id    uuid;
  v_opp_creator    uuid;
  v_method         text;
  v_offer_amount   numeric;
  v_deposit_amt    numeric;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.created_by, oo.payment_method,
         oo.offer_amount, oo.cash_deposit_amount
    into v_provider_id, v_opp_creator, v_method,
         v_offer_amount, v_deposit_amt
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_opp_creator <> v_caller then
    raise exception 'Only customer can complete the offer';
  end if;

  -- Escrow məbləği
  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found for offer'; end if;

  -- Tamamlama komissiyası (full offer üzərindən)
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_offer_amount * v_commission_pct / 100, 2);

  -- Cash: deposit-dan komissiya tutulur (80% nağdı provider artıq aldı)
  -- Card: escrow-dan komissiya tutulur
  v_release_amt := v_locked_amt - v_commission_amt;
  if v_release_amt < 0 then v_release_amt := 0; end if;

  update public.provider_wallets
     set locked_balance = locked_balance - v_locked_amt,
         balance        = coalesce(balance, 0) + v_release_amt,
         total_earned   = coalesce(total_earned, 0) + v_release_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  update public.opportunities_offers
     set status = 'completed'
   where id = p_offer_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_provider_id, 'escrow_release', v_release_amt, 0,
     case when v_method='cash'
          then 'Nağd işi tamamlandı: deposit (' || v_locked_amt
               || ' ₼) - komissiya (' || v_commission_amt
               || ' ₼) = ' || v_release_amt || ' ₼'
          else 'İş tamamlandı: escrow (' || v_locked_amt
               || ' ₼) - komissiya (' || v_commission_amt
               || ' ₼) = ' || v_release_amt || ' ₼' end,
     p_offer_id::text, v_caller);

  return v_release_amt;
end;
$$;

revoke execute on function public.release_offer_to_provider(uuid) from public, anon;
grant   execute on function public.release_offer_to_provider(uuid) to authenticated;

notify pgrst, 'reload schema';
