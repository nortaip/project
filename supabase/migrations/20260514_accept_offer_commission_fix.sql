-- ============================================================================
-- Fix: accept_offer_with_payment + release_offer_to_provider
--
-- Problemlər:
--   1. Müştəri təklifi qəbul etdikdə opportunity.status = 'active' olur
--      → UI/hesabatda 'accepted' kimi görünməlidir.
--   2. Commission (commission_on_accept) provider escrow-undan tutulur, lakin
--      platform_revenue kimi explicit transaction yaranmır →
--      gəlir hesabatında görsənmir.
--   3. Eyni problem release zamanı (commission_on_complete).
--
-- Düzəlişlər:
--   - opportunity.status = 'accepted' (active əvəzinə)
--   - hər iki commission üçün platform_revenue transaction
--   - Səhv olduqda heç bir tərəfin balansına toxunulmasın (transaction)
-- ============================================================================

create or replace function public.accept_offer_with_payment(
  p_offer_id uuid,
  p_method   text
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
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then
    raise exception 'Invalid payment method (must be cash or card)';
  end if;

  -- Offer + opportunity creator
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

  -- ── KART axını ─────────────────────────────────────────────────────
  if p_method = 'card' then
    select coalesce(balance,0) into v_customer_bal
      from public.profiles where id = v_caller;

    if v_customer_bal < v_offer.offer_amount then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%',
        v_offer.offer_amount, v_customer_bal;
    end if;

    select coalesce((value)::text::numeric, 0) into v_commission_pct
      from public.platform_config where key = 'commission_on_accept';

    v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
    v_provider_amt   := v_offer.offer_amount - v_commission_amt;

    -- Müştəri balansından çıx
    update public.profiles
       set balance = balance - v_offer.offer_amount
     where id = v_caller;

    -- Provayder escrow
    insert into public.provider_wallets (provider_id, locked_balance)
    values (v_offer.provider_id, v_provider_amt)
    on conflict (provider_id) do update
      set locked_balance = public.provider_wallets.locked_balance + v_provider_amt,
          updated_at     = now();

    -- Müştəri transaction
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values (
      v_caller, 'booking_charge', -v_offer.offer_amount,
      v_customer_bal - v_offer.offer_amount,
      'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8),
      p_offer_id::text, v_caller
    );

    -- Provayder escrow_lock transaction
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values (
      v_offer.provider_id, 'escrow_lock', v_provider_amt, 0,
      'Sifariş escrow-a düşdü (qəbul komissiyası: '
        || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
      p_offer_id::text, v_caller
    );

    -- ★ Platform commission revenue (explicit)
    if v_commission_amt > 0 then
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values (
        v_offer.provider_id,
        'platform_revenue',
        v_commission_amt,
        0,
        'Qəbul komissiyası (' || v_commission_pct || '%, offer '
          || left(p_offer_id::text, 8) || ')',
        p_offer_id::text,
        v_caller
      );
    end if;
  end if;

  -- Offer-i accepted statusuna keçir
  update public.opportunities_offers
     set status         = 'accepted',
         payment_method = p_method,
         paid_at        = case when p_method = 'card' then now() else null end
   where id = p_offer_id;

  -- Digər təklifləri rədd et
  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = v_offer.opp_id
     and id <> p_offer_id
     and status = 'pending';

  -- ★ Opportunity status = 'accepted' (active əvəzinə)
  update public.opportunities
     set status            = 'accepted',
         accepted_offer_id = p_offer_id,
         provider_id       = v_offer.provider_id
   where id = v_offer.opp_id;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer',
            p_offer_id::text,
            jsonb_build_object(
              'method', p_method,
              'amount', v_offer.offer_amount,
              'commission_pct', v_commission_pct,
              'commission_amt', v_commission_amt,
              'provider_id', v_offer.provider_id
            ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'method', p_method,
    'offer_id', p_offer_id,
    'opportunity_id', v_offer.opp_id,
    'commission_amt', coalesce(v_commission_amt, 0),
    'commission_pct', coalesce(v_commission_pct, 0)
  );
end;
$$;

revoke execute on function public.accept_offer_with_payment(uuid, text) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text) to authenticated;


-- ============================================================================
-- release_offer_to_provider — tamamlama komissiyası üçün də platform_revenue
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
  v_opp_id         uuid;
  v_method         text;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.created_by, oo.payment_method, op.id
    into v_provider_id, v_opp_creator, v_method, v_opp_id
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_opp_creator <> v_caller then
    raise exception 'Only customer can complete the offer';
  end if;

  -- Cash axını — heç bir balans hərəkəti
  if v_method = 'cash' or v_method is null then
    update public.opportunities_offers
       set status = 'completed'
     where id = p_offer_id;

    update public.opportunities
       set status = 'completed'
     where id = v_opp_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'admin_adjust', 0, 0,
       'Nağd sifariş tamamlandı, offer ' || left(p_offer_id::text, 8),
       p_offer_id::text, v_caller);

    return 0;
  end if;

  -- Card axını
  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found for offer'; end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt    := v_locked_amt - v_commission_amt;

  update public.provider_wallets
     set locked_balance = locked_balance - v_locked_amt,
         balance        = coalesce(balance, 0) + v_release_amt,
         total_earned   = coalesce(total_earned, 0) + v_release_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  update public.opportunities_offers
     set status = 'completed'
   where id = p_offer_id;

  update public.opportunities
     set status = 'completed'
   where id = v_opp_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_provider_id, 'escrow_release', v_release_amt, 0,
     'İş tamamlandı, escrow → balans (tamamlama komissiyası: '
       || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, v_caller);

  -- ★ Platform commission revenue
  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values (
      v_provider_id, 'platform_revenue', v_commission_amt, 0,
      'Tamamlama komissiyası (' || v_commission_pct || '%, offer '
        || left(p_offer_id::text, 8) || ')',
      p_offer_id::text, v_caller
    );
  end if;

  return v_release_amt;
end;
$$;

revoke execute on function public.release_offer_to_provider(uuid) from public, anon;
grant   execute on function public.release_offer_to_provider(uuid) to authenticated;

notify pgrst, 'reload schema';
