-- Update accept_offer_with_payment to accept and store customer GPS coordinates
-- When customer accepts offer, their current location is saved to opportunities table

drop function if exists public.accept_offer_with_payment(uuid, text);

create or replace function public.accept_offer_with_payment(
  p_offer_id uuid,
  p_method   text,
  p_latitude numeric default null,
  p_longitude numeric default null
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
  v_provider_bal   numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_provider_amt   numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then
    raise exception 'Invalid payment method';
  end if;

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
    raise exception 'Offer is not pending';
  end if;

  -- Komissiya faizi
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt   := v_offer.offer_amount - v_commission_amt;

  if p_method = 'card' then
    -- Müştəri balansı yoxlaması
    select coalesce(balance,0) into v_customer_bal
      from public.profiles where id = v_caller;
    if v_customer_bal < v_offer.offer_amount then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%',
        v_offer.offer_amount, v_customer_bal;
    end if;

    -- Müştəri debit
    update public.profiles
       set balance = balance - v_offer.offer_amount
     where id = v_caller;

    -- Provayder escrow kredit (komissiya çıxılmış)
    insert into public.provider_wallets (provider_id, locked_balance)
    values (v_offer.provider_id, v_provider_amt)
    on conflict (provider_id) do update
      set locked_balance = public.provider_wallets.locked_balance + v_provider_amt,
          updated_at     = now();

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_caller, 'booking_charge', -v_offer.offer_amount,
       v_customer_bal - v_offer.offer_amount,
       'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8),
       p_offer_id::text, v_caller),
      (v_offer.provider_id, 'escrow_lock', v_provider_amt, 0,
       'Sifariş escrow-a düşdü (qəbul komissiyası: '
         || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
       p_offer_id::text, v_caller);

    if v_commission_amt > 0 then
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
         'Qəbul komissiyası (kart, ' || v_commission_pct || '%)',
         p_offer_id::text, v_caller);
    end if;

  else
    -- NAĞD axını: komissiya provayder balansından
    select coalesce(balance, 0) into v_provider_bal
      from public.profiles where id = v_offer.provider_id;

    if v_provider_bal < v_commission_amt then
      raise exception 'PROVIDER_INSUFFICIENT_BALANCE: Provayder balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)',
        v_commission_amt, v_provider_bal;
    end if;

    update public.profiles
       set balance = balance - v_commission_amt
     where id = v_offer.provider_id;

    if v_commission_amt > 0 then
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
         'Qəbul komissiyası (nağd, ' || v_commission_pct || '%, offer '
           || left(p_offer_id::text, 8) || ')',
         p_offer_id::text, v_caller);
    end if;
  end if;

  -- Offer + opportunity status
  update public.opportunities_offers
     set status         = 'accepted',
         payment_method = p_method,
         paid_at        = case when p_method = 'card' then now() else null end
   where id = p_offer_id;

  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = v_offer.opp_id
     and id <> p_offer_id
     and status = 'pending';

  -- Update opportunity with customer's current GPS coordinates (if provided)
  update public.opportunities
     set status            = 'accepted',
         accepted_offer_id = p_offer_id,
         provider_id       = v_offer.provider_id,
         latitude          = coalesce(p_latitude, latitude),
         longitude         = coalesce(p_longitude, longitude)
   where id = v_offer.opp_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer', p_offer_id::text,
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
    'commission_amt', v_commission_amt,
    'commission_pct', v_commission_pct
  );
end;
$$;

revoke execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric) to authenticated;