-- ============================================================================
-- accept_offer_with_payment — müştəri servis haqqını balansdan tut
-- ============================================================================
-- Səbəb: UI-də "Müştəri servis haqqı" görünürdü (commission_customer_service_fee)
-- amma RPC bunu hesablamır, balansdan tutmurdu — yalnız offer_amount tutulurdu.
-- Bu uyğunsuzluğu düzəldirik: müştəri servis haqqını həm kart həm nağd halında
-- balansdan tutur və platform_revenue transaction-a yazır.
--
-- Eyni zamanda 20260531_accept_offer_notify_provider.sql-də əlavə edilən
-- provayder bildirimi məntiqi də qorunur.

drop function if exists public.accept_offer_with_payment(uuid, text, numeric, numeric);

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
  v_cust_fee_pct   numeric;
  v_cust_fee_amt   numeric;
  v_total_charge   numeric;
  v_notif_title    text;
  v_notif_body     text;
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

  -- Provayder komissiyası (təklif qəbulunda tutulan)
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt   := v_offer.offer_amount - v_commission_amt;

  -- Müştəri servis haqqı (admin paneldən tənzimlənir, default 0)
  select coalesce((value)::text::numeric, 0) into v_cust_fee_pct
    from public.platform_config where key = 'commission_customer_service_fee';
  v_cust_fee_amt := round(v_offer.offer_amount * v_cust_fee_pct / 100, 2);

  if p_method = 'card' then
    select coalesce(balance,0) into v_customer_bal
      from public.profiles where id = v_caller;
    v_total_charge := v_offer.offer_amount + v_cust_fee_amt;
    if v_customer_bal < v_total_charge then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%',
        v_total_charge, v_customer_bal;
    end if;

    -- Müştəri debit (offer amount + servis haqqı)
    update public.profiles
       set balance = balance - v_total_charge
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
       v_customer_bal - v_total_charge,
       'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8),
       p_offer_id::text, v_caller),
      (v_offer.provider_id, 'escrow_lock', v_provider_amt, 0,
       'Sifariş escrow-a düşdü (qəbul komissiyası: '
         || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
       p_offer_id::text, v_caller);

    -- Provayder qəbul komissiyası → platforma
    if v_commission_amt > 0 then
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
         'Qəbul komissiyası (kart, ' || v_commission_pct || '%)',
         p_offer_id::text, v_caller);
    end if;

    -- Müştəri servis haqqı → platforma
    if v_cust_fee_amt > 0 then
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_caller, 'platform_revenue', -v_cust_fee_amt,
         v_customer_bal - v_total_charge,
         'Müştəri servis haqqı (' || v_cust_fee_pct || '%)',
         p_offer_id::text, v_caller);
    end if;

  else
    -- NAĞD axını
    select coalesce(balance, 0) into v_provider_bal
      from public.profiles where id = v_offer.provider_id;

    if v_provider_bal < v_commission_amt then
      raise exception 'PROVIDER_INSUFFICIENT_BALANCE: Provayder balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)',
        v_commission_amt, v_provider_bal;
    end if;

    -- Provayder qəbul komissiyası tutulur
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

    -- Müştəri servis haqqı (nağd halında da müştəridən tutulur)
    if v_cust_fee_amt > 0 then
      select coalesce(balance, 0) into v_customer_bal
        from public.profiles where id = v_caller;
      if v_customer_bal < v_cust_fee_amt then
        raise exception 'INSUFFICIENT_BALANCE: Müştəri servis haqqı üçün balans yetərli deyil (lazım: % ₼, mövcud: % ₼)',
          v_cust_fee_amt, v_customer_bal;
      end if;
      update public.profiles
         set balance = balance - v_cust_fee_amt
       where id = v_caller;
      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_caller, 'platform_revenue', -v_cust_fee_amt,
         v_customer_bal - v_cust_fee_amt,
         'Müştəri servis haqqı (' || v_cust_fee_pct || '%, nağd)',
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

  update public.opportunities
     set status            = 'accepted',
         accepted_offer_id = p_offer_id,
         provider_id       = v_offer.provider_id,
         latitude          = coalesce(p_latitude, latitude),
         longitude         = coalesce(p_longitude, longitude)
   where id = v_offer.opp_id;

  -- Provayderə bildiriş (server-tərəfli, RLS by-pass)
  v_notif_title := 'Təklifiniz qəbul edildi 🎉';
  if p_method = 'card' then
    v_notif_body := 'Müştəri kartla ödəmə seçdi, məbləğ escrow-a düşdü.';
  else
    v_notif_body := 'Müştəri qarantili nağd ödəniş seçdi. İşi tamamladıqdan sonra qalan məbləği nağd alacaqsınız.';
  end if;

  begin
    insert into public.notifications (user_id, type, title, body, related_id, is_read)
    values (
      v_offer.provider_id,
      case when p_method = 'card' then 'offer_accepted_card' else 'offer_accepted_cash' end,
      v_notif_title,
      v_notif_body,
      v_offer.opp_id::text,
      false
    );
  exception when others then null;
  end;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer', p_offer_id::text,
            jsonb_build_object(
              'method', p_method,
              'amount', v_offer.offer_amount,
              'commission_pct', v_commission_pct,
              'commission_amt', v_commission_amt,
              'customer_fee_pct', v_cust_fee_pct,
              'customer_fee_amt', v_cust_fee_amt,
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
    'commission_pct', v_commission_pct,
    'customer_fee_amt', v_cust_fee_amt,
    'customer_fee_pct', v_cust_fee_pct
  );
end;
$$;

revoke execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
