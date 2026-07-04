-- ============================================================================
-- Nağd qəbulda qəbul komissiyası BRİQADA balansından tutulsun
--
-- Briqada təklifində provider_id = işçi olduğu üçün əvvəlki məntiq komissiyanı
-- işçinin şəxsi balansından tuturdu. İndi:
--   • offer.brigade_id IS NOT NULL → komissiya briqada balansından
--   • əks halda (solo provayder) → provayderin şəxsi balansından (köhnə davranış)
-- Kart axını dəyişmir (escrow əsaslıdır).
-- ============================================================================
create or replace function public.accept_offer_with_payment(
  p_offer_id uuid,
  p_method   text,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_promo_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller         uuid := auth.uid();
  v_offer          record;
  v_customer_bal   numeric;
  v_provider_bal   numeric;
  v_brigade_bal    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_provider_amt   numeric;
  v_cust_fee_pct   numeric;
  v_cust_fee_amt   numeric;
  v_deposit_pct    numeric;
  v_deposit_amt    numeric;
  v_total_charge   numeric;
  v_notif_title    text;
  v_notif_body     text;
  v_discount       numeric := 0;
  v_promo          record;
  v_user_uses      integer;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then raise exception 'Invalid payment method'; end if;

  select oo.id, oo.opportunity_id, oo.provider_id, oo.brigade_id, oo.offer_amount, oo.status,
         op.created_by, op.id as opp_id
    into v_offer
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_offer.id is null then raise exception 'Offer not found'; end if;
  if v_offer.created_by <> v_caller then raise exception 'Forbidden — not opportunity owner'; end if;
  if v_offer.status <> 'pending' then raise exception 'Offer is not pending'; end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt   := v_offer.offer_amount - v_commission_amt;

  select coalesce((value)::text::numeric, 0) into v_cust_fee_pct
    from public.platform_config where key = 'commission_customer_service_fee';
  v_cust_fee_amt := round(v_offer.offer_amount * v_cust_fee_pct / 100, 2);

  select coalesce((value)::text::numeric, 20) into v_deposit_pct
    from public.platform_config where key = 'cash_deposit_pct';
  v_deposit_amt := round(v_offer.offer_amount * v_deposit_pct / 100, 2);

  -- Promo kod (yalnız KART)
  if p_method = 'card' and p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from public.promo_codes
     where upper(code) = upper(trim(p_promo_code)) for update;
    if v_promo.id is null then raise exception 'PROMO_INVALID: Promo kod tapılmadı'; end if;
    if not v_promo.is_active then raise exception 'PROMO_INVALID: Kod aktiv deyil'; end if;
    if v_promo.starts_at is not null and now() < v_promo.starts_at then
      raise exception 'PROMO_INVALID: Kod hələ aktiv deyil'; end if;
    if v_promo.expires_at is not null and now() > v_promo.expires_at then
      raise exception 'PROMO_INVALID: Kodun vaxtı keçib'; end if;
    if v_promo.min_order_amount is not null and v_offer.offer_amount < v_promo.min_order_amount then
      raise exception 'PROMO_INVALID: Minimum məbləğ % AZN', v_promo.min_order_amount; end if;
    if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then
      raise exception 'PROMO_INVALID: Kodun limiti dolub'; end if;
    if v_promo.per_user_limit is not null then
      select count(*) into v_user_uses from public.promo_redemptions
       where promo_id = v_promo.id and user_id = v_caller;
      if v_user_uses >= v_promo.per_user_limit then
        raise exception 'PROMO_INVALID: Siz bu kodu artıq istifadə etmisiniz'; end if;
    end if;
    if v_promo.discount_type = 'percent' then
      v_discount := round(v_offer.offer_amount * v_promo.discount_value / 100, 2);
    else
      v_discount := v_promo.discount_value;
    end if;
    if v_discount > v_offer.offer_amount then v_discount := v_offer.offer_amount; end if;
  end if;

  if p_method = 'card' then
    select coalesce(balance,0) into v_customer_bal from public.profiles where id = v_caller;
    v_total_charge := v_offer.offer_amount + v_cust_fee_amt - v_discount;
    if v_total_charge < 0 then v_total_charge := 0; end if;
    if v_customer_bal < v_total_charge then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%', v_total_charge, v_customer_bal;
    end if;

    update public.profiles set balance = balance - v_total_charge where id = v_caller;

    insert into public.provider_wallets (provider_id, locked_balance)
    values (v_offer.provider_id, v_provider_amt)
    on conflict (provider_id) do update
      set locked_balance = public.provider_wallets.locked_balance + v_provider_amt, updated_at = now();

    insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_caller, 'booking_charge', -v_offer.offer_amount, v_customer_bal - v_total_charge,
       'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8), p_offer_id::text, v_caller),
      (v_offer.provider_id, 'escrow_lock', v_provider_amt, 0,
       'Sifariş escrow-a düşdü (qəbul komissiyası: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
       p_offer_id::text, v_caller);

    if v_commission_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
        'Qəbul komissiyası (kart, ' || v_commission_pct || '%)', p_offer_id::text, v_caller);
    end if;
    if v_cust_fee_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'platform_revenue', -v_cust_fee_amt, v_customer_bal - v_total_charge,
        'Müştəri servis haqqı (' || v_cust_fee_pct || '%)', p_offer_id::text, v_caller);
    end if;
    if v_discount > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'promo_discount', v_discount, v_customer_bal - v_total_charge,
        'Promo endirim (' || v_promo.code || ')', p_offer_id::text, v_caller);
      update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
      insert into public.promo_redemptions (promo_id, user_id, offer_id, opportunity_id, discount_amount)
      values (v_promo.id, v_caller, p_offer_id, v_offer.opp_id, v_discount);
    end if;

  else
    -- NAĞD axını
    select coalesce(balance, 0) into v_customer_bal from public.profiles where id = v_caller;
    v_total_charge := v_deposit_amt + v_cust_fee_amt;
    if v_customer_bal < v_total_charge then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=% (deposit + service_fee)', v_total_charge, v_customer_bal;
    end if;

    -- Müştəridən qaranti depoziti + servis haqqı
    update public.profiles set balance = balance - v_total_charge where id = v_caller;

    -- Qəbul komissiyası: BRİQADA təklifidirsə briqada balansından, yoxsa provayderdən
    if v_offer.brigade_id is not null then
      select coalesce(balance, 0) into v_brigade_bal from public.brigades where id = v_offer.brigade_id;
      if v_brigade_bal < v_commission_amt then
        raise exception 'BRIGADE_INSUFFICIENT_BALANCE: Briqada balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)',
          v_commission_amt, v_brigade_bal;
      end if;
      update public.brigades set balance = balance - v_commission_amt, updated_at = now()
       where id = v_offer.brigade_id;
      if v_commission_amt > 0 then
        insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
        values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
          'Qəbul komissiyası (nağd, briqada, ' || v_commission_pct || '%, offer ' || left(p_offer_id::text, 8) || ')',
          v_offer.brigade_id::text, v_caller);
      end if;
    else
      select coalesce(balance, 0) into v_provider_bal from public.profiles where id = v_offer.provider_id;
      if v_provider_bal < v_commission_amt then
        raise exception 'PROVIDER_INSUFFICIENT_BALANCE: Provayder balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)',
          v_commission_amt, v_provider_bal;
      end if;
      update public.profiles set balance = balance - v_commission_amt where id = v_offer.provider_id;
      if v_commission_amt > 0 then
        insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
        values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
          'Qəbul komissiyası (nağd, ' || v_commission_pct || '%, offer ' || left(p_offer_id::text, 8) || ')',
          p_offer_id::text, v_caller);
      end if;
    end if;

    if v_deposit_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'cash_deposit_lock', -v_deposit_amt, v_customer_bal - v_total_charge,
        'Qarantili nağd üçün depozit (' || v_deposit_pct || '%, offer ' || left(p_offer_id::text, 8) || ')',
        p_offer_id::text, v_caller);
    end if;
    if v_cust_fee_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'platform_revenue', -v_cust_fee_amt, v_customer_bal - v_total_charge,
        'Müştəri servis haqqı (' || v_cust_fee_pct || '%, nağd)', p_offer_id::text, v_caller);
    end if;
  end if;

  update public.opportunities_offers
     set status = 'accepted', payment_method = p_method,
         paid_at = case when p_method = 'card' then now() else null end
   where id = p_offer_id;
  update public.opportunities_offers set status = 'rejected'
   where opportunity_id = v_offer.opp_id and id <> p_offer_id and status = 'pending';
  update public.opportunities
     set status = 'accepted', accepted_offer_id = p_offer_id, provider_id = v_offer.provider_id,
         latitude = coalesce(p_latitude, latitude), longitude = coalesce(p_longitude, longitude)
   where id = v_offer.opp_id;

  v_notif_title := 'Təklifiniz qəbul edildi 🎉';
  if p_method = 'card' then
    v_notif_body := 'Müştəri kartla ödəmə seçdi, məbləğ escrow-a düşdü.';
  else
    v_notif_body := 'Müştəri qarantili nağd ödəniş seçdi. İşi tamamladıqdan sonra qalan məbləği nağd alacaqsınız.';
  end if;
  begin
    insert into public.notifications (user_id, type, title, body, related_id, is_read)
    values (v_offer.provider_id,
      case when p_method = 'card' then 'offer_accepted_card' else 'offer_accepted_cash' end,
      v_notif_title, v_notif_body, v_offer.opp_id::text, false);
  exception when others then null;
  end;
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer', p_offer_id::text,
            jsonb_build_object('method', p_method, 'amount', v_offer.offer_amount,
              'commission_pct', v_commission_pct, 'commission_amt', v_commission_amt,
              'brigade_id', v_offer.brigade_id,
              'customer_fee_pct', v_cust_fee_pct, 'customer_fee_amt', v_cust_fee_amt,
              'deposit_pct', v_deposit_pct, 'deposit_amt', v_deposit_amt,
              'promo_code', case when v_discount > 0 then v_promo.code else null end,
              'promo_discount', v_discount, 'provider_id', v_offer.provider_id));
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'method', p_method, 'offer_id', p_offer_id,
    'opportunity_id', v_offer.opp_id, 'commission_amt', v_commission_amt, 'commission_pct', v_commission_pct,
    'is_brigade', v_offer.brigade_id is not null,
    'customer_fee_amt', v_cust_fee_amt, 'customer_fee_pct', v_cust_fee_pct,
    'deposit_amt', v_deposit_amt, 'deposit_pct', v_deposit_pct, 'discount', v_discount);
end;
$function$;

revoke execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric, text) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
