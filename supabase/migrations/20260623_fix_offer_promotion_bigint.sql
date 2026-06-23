-- ============================================================================
-- lock_offer_payment & apply_service_promotion — bigint payment_id düzəlişi
--
-- credit_balance ilə eyni problem: webhook bu funksiyaları bigint payments.id
-- ilə çağırır, amma onlar p_payment_id uuid gözləyirdi → "function not found"
-- → service ödənişi / promosyon Epoint axını sınırdı.
--
-- payments.id (bigint) uuid sütunlara (offers.payment_id, transactions.payment_id)
-- yazıla bilmədiyi üçün ödəniş istinadı mətndə saxlanılır. Daxili məntiq dəyişmir.
-- service_role-only (REVOKE/GRANT).
-- ============================================================================

drop function if exists public.lock_offer_payment(uuid, numeric, uuid);

create or replace function public.lock_offer_payment(
  p_offer_id uuid, p_amount numeric, p_payment_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_provider_id      uuid;
  v_commission_pct   numeric;
  v_commission_amt   numeric;
  v_provider_amount  numeric;
begin
  select provider_id into v_provider_id
    from public.opportunities_offers where id = p_offer_id;
  if v_provider_id is null then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';

  v_commission_amt  := round(p_amount * coalesce(v_commission_pct,0) / 100, 2);
  v_provider_amount := p_amount - v_commission_amt;

  insert into public.provider_wallets (provider_id, locked_balance)
  values (v_provider_id, v_provider_amount)
  on conflict (provider_id) do update
    set locked_balance = public.provider_wallets.locked_balance + v_provider_amount,
        updated_at     = now();

  update public.opportunities_offers
     set status = 'accepted', paid_at = now()
   where id = p_offer_id;

  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   )
     and id <> p_offer_id
     and status = 'pending';

  update public.opportunities
     set status = 'active', accepted_offer_id = p_offer_id
   where id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   );

  insert into public.transactions
    (user_id, type, amount, description, related_id, payment_id)
  values
    (v_provider_id, 'escrow_lock', v_provider_amount,
     'Müştəri ödənişi escrow-a düşdü (qəbul komissiyası: ' || coalesce(v_commission_pct,0)
       || '%, ' || v_commission_amt || ' ₼; ödəniş #' || p_payment_id || ')',
     p_offer_id::text, null);
end;
$function$;

revoke execute on function public.lock_offer_payment(uuid, numeric, bigint)
  from public, anon, authenticated;
grant execute on function public.lock_offer_payment(uuid, numeric, bigint)
  to service_role;


drop function if exists public.apply_service_promotion(uuid, text, integer, uuid);

create or replace function public.apply_service_promotion(
  p_service_id uuid, p_promotion_type text, p_promotion_days integer, p_payment_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_now     timestamptz := now();
  v_until   timestamptz;
begin
  select id, user_id, status, amount, metadata
    into v_payment
    from public.payments
   where id = p_payment_id;

  if not found then
    raise exception 'Payment % not found', p_payment_id;
  end if;

  if (v_payment.metadata->>'purpose') is distinct from 'service_promotion' then
    raise exception 'Payment % is not a service_promotion', p_payment_id;
  end if;

  perform 1
    from public.services s
   where s.id = p_service_id
     and s.provider_id = v_payment.user_id;
  if not found then
    raise exception 'Service % does not belong to payment user', p_service_id;
  end if;

  if p_promotion_days is null or p_promotion_days <= 0 or p_promotion_days > 365 then
    raise exception 'Invalid promotion_days: %', p_promotion_days;
  end if;

  if p_promotion_type not in ('vip','premium') then
    raise exception 'Invalid promotion_type: %', p_promotion_type;
  end if;

  v_until := greatest(v_now, coalesce(
              (select promotion_expires_at from public.services where id = p_service_id), v_now))
             + (p_promotion_days || ' days')::interval;

  update public.services
     set promotion_type       = p_promotion_type,
         promotion_expires_at = v_until,
         updated_at           = v_now
   where id = p_service_id;

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (
    v_payment.user_id,
    'service_promotion_applied',
    'service',
    p_service_id,
    jsonb_build_object(
      'promotion_type', p_promotion_type,
      'days',           p_promotion_days,
      'until',          v_until,
      'payment_id',     p_payment_id
    )
  );
end;
$function$;

revoke execute on function public.apply_service_promotion(uuid, text, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_service_promotion(uuid, text, integer, bigint)
  to service_role;

notify pgrst, 'reload schema';
