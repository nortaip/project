-- ============================================================================
-- Komissiya qaydaları v3 — final business rules
--
-- 1. place_bid balans yoxlaması: bid_amount × commission_on_accept faizi qədər
-- 2. Nağd qəbulda provayder balansından komissiya tutulur
-- 3. bonus_on_complete açarı + tamamlama anında provayder bonusu
-- 4. accept_offer_with_payment cash axınında insufficient balance check
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. bonus_on_complete platform_config                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
insert into public.platform_config (key, value, description) values
  ('bonus_on_complete', '0'::jsonb,
   'Tamamlanmış işdən provayderə bonus % (provider_wallets.bonus_balance-ə yazılır)')
on conflict (key) do nothing;

-- get_commission_rates RPC bonus-u da qaytarsın
create or replace function public.get_commission_rates()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_object_agg(key, (value)::text::numeric)
    from public.platform_config
   where key in (
     'commission_on_accept',
     'commission_on_complete',
     'commission_on_withdrawal',
     'commission_on_bonus_convert',
     'bonus_on_complete',
     'min_withdrawal_amount'
   );
$$;
grant execute on function public.get_commission_rates() to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. place_bid — balans yoxlaması komissiya məbləği qədər                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.place_bid(
  p_opportunity_id uuid,
  p_amount         numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_balance        numeric;
  v_role           text;
  v_bid_id         uuid;
  v_opp            record;
  v_commission_pct numeric;
  v_commission_amt numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid məbləği müsbət olmalıdır';
  end if;

  select lower(coalesce(role,'')), coalesce(balance, 0)
    into v_role, v_balance
    from public.profiles where id = v_caller;

  if v_role not in ('provider','admin','master','superadmin') then
    raise exception 'Yalnız provayder təklif verə bilər';
  end if;

  -- Komissiya faizini oxu
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);

  -- Balansda komissiya məbləği qədər olmalıdır
  if v_balance < v_commission_amt then
    raise exception 'NO_BALANCE: balansda minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
      v_commission_amt, v_commission_pct, v_balance;
  end if;

  select id, status, created_by into v_opp
    from public.opportunities where id = p_opportunity_id;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizə təklif verə bilməzsiniz';
  end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'Sifariş artıq aktiv deyil (status: %)', v_opp.status;
  end if;

  if exists (
    select 1 from public.opportunities_offers
     where opportunity_id = p_opportunity_id
       and provider_id    = v_caller
       and status         = 'pending'
  ) then
    raise exception 'Bu sifarişə artıq aktiv təklifiniz var';
  end if;

  insert into public.opportunities_offers
    (opportunity_id, provider_id, offer_amount, status)
  values
    (p_opportunity_id, v_caller, p_amount, 'pending')
  returning id into v_bid_id;

  return jsonb_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'amount', p_amount,
    'required_balance', v_commission_amt
  );
end;
$$;

revoke execute on function public.place_bid(uuid, numeric) from public, anon;
grant   execute on function public.place_bid(uuid, numeric) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. accept_offer_with_payment — cash axınında provayderdən komissiya     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
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

  update public.opportunities
     set status            = 'accepted',
         accepted_offer_id = p_offer_id,
         provider_id       = v_offer.provider_id
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

revoke execute on function public.accept_offer_with_payment(uuid, text) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. release_offer_to_provider — bonus_on_complete tətbiqi (cash + card)  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
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
  v_offer_amount   numeric;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
  v_bonus_pct      numeric;
  v_bonus_amt      numeric;
  v_bonus_base     numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.created_by, oo.payment_method, op.id, oo.offer_amount
    into v_provider_id, v_opp_creator, v_method, v_opp_id, v_offer_amount
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_opp_creator <> v_caller then
    raise exception 'Only customer can complete the offer';
  end if;

  -- Bonus faizi
  select coalesce((value)::text::numeric, 0) into v_bonus_pct
    from public.platform_config where key = 'bonus_on_complete';

  -- Cash axını
  if v_method = 'cash' or v_method is null then
    update public.opportunities_offers
       set status = 'completed' where id = p_offer_id;
    update public.opportunities
       set status = 'completed' where id = v_opp_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'admin_adjust', 0, 0,
       'Nağd sifariş tamamlandı, offer ' || left(p_offer_id::text, 8),
       p_offer_id::text, v_caller);

    -- Cash bonus: offer_amount × pct
    v_bonus_base := v_offer_amount;
    v_bonus_amt  := round(v_bonus_base * v_bonus_pct / 100, 2);
    if v_bonus_amt > 0 then
      insert into public.provider_wallets (provider_id, bonus_balance)
      values (v_provider_id, v_bonus_amt)
      on conflict (provider_id) do update
        set bonus_balance = public.provider_wallets.bonus_balance + v_bonus_amt,
            updated_at    = now();

      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_provider_id, 'bonus_earn', v_bonus_amt, 0,
         'Tamamlama bonusu (nağd, ' || v_bonus_pct || '%)',
         p_offer_id::text, v_caller);

      begin
        insert into public.provider_bonus_logs
          (provider_id, amount, type, source, reason)
        values
          (v_provider_id, v_bonus_amt, 'completion', 'cash_order',
           'Tamamlama bonusu (' || v_bonus_pct || '%)');
      exception when others then null;
      end;
    end if;

    return 0;
  end if;

  -- Card axını
  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found'; end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt    := v_locked_amt - v_commission_amt;

  update public.provider_wallets
     set locked_balance = locked_balance - v_locked_amt,
         total_earned   = coalesce(total_earned, 0) + v_release_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  update public.profiles
     set balance = coalesce(balance, 0) + v_release_amt
   where id = v_provider_id;

  update public.opportunities_offers
     set status = 'completed' where id = p_offer_id;
  update public.opportunities
     set status = 'completed' where id = v_opp_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_provider_id, 'escrow_release', v_release_amt, 0,
     'İş tamamlandı (tamamlama komissiyası: '
       || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, v_caller);

  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'platform_revenue', v_commission_amt, 0,
       'Tamamlama komissiyası (' || v_commission_pct || '%)',
       p_offer_id::text, v_caller);
  end if;

  -- Card bonus: release_amt × pct
  v_bonus_amt := round(v_release_amt * v_bonus_pct / 100, 2);
  if v_bonus_amt > 0 then
    insert into public.provider_wallets (provider_id, bonus_balance)
    values (v_provider_id, v_bonus_amt)
    on conflict (provider_id) do update
      set bonus_balance = public.provider_wallets.bonus_balance + v_bonus_amt,
          updated_at    = now();

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'bonus_earn', v_bonus_amt, 0,
       'Tamamlama bonusu (kart, ' || v_bonus_pct || '%)',
       p_offer_id::text, v_caller);

    begin
      insert into public.provider_bonus_logs
        (provider_id, amount, type, source, reason)
      values
        (v_provider_id, v_bonus_amt, 'completion', 'card_order',
         'Tamamlama bonusu (' || v_bonus_pct || '%)');
    exception when others then null;
    end;
  end if;

  return v_release_amt;
end;
$$;

revoke execute on function public.release_offer_to_provider(uuid) from public, anon;
grant   execute on function public.release_offer_to_provider(uuid) to authenticated;


notify pgrst, 'reload schema';
