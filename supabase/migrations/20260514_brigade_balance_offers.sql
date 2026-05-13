-- ============================================================================
-- Briqada balansı + briqada təklif axını
--
-- 1. brigades.balance sütunu (sahibin şəxsi balansından ayrı)
-- 2. brigade_top_up_from_owner RPC (şəxsi → briqada balansı)
-- 3. opportunities_offers.brigade_id nullable sütun (briqada təklifləri)
-- 4. brigade_place_offer RPC — dispatcher təklif verir
-- 5. accept_offer_with_payment briqada təkliflərini də idarə edir
-- 6. Briqada təklifi qəbul olunanda ən yaxın online işçi avtomatik təyin olunur
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. brigades.balance                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.brigades
  add column if not exists balance numeric(12,2) not null default 0;

create index if not exists brigades_balance_idx on public.brigades (balance);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. opportunities_offers.brigade_id                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.opportunities_offers
  add column if not exists brigade_id uuid references public.brigades(id) on delete set null;

create index if not exists offers_brigade_idx on public.opportunities_offers (brigade_id)
  where brigade_id is not null;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC: brigade_top_up_from_owner                                         ║
-- ║   Sahib şəxsi balansından briqada balansına köçürür                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_top_up_from_owner(
  p_brigade_id uuid,
  p_amount     numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_owner_id      uuid;
  v_owner_balance numeric;
  v_new_brigade   numeric;
  v_new_owner     numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select owner_id into v_owner_id
    from public.brigades where id = p_brigade_id;
  if v_owner_id is null then raise exception 'Briqada tapılmadı'; end if;
  if v_owner_id <> v_caller then
    raise exception 'Yalnız briqada sahibi top-up edə bilər';
  end if;

  select coalesce(balance, 0) into v_owner_balance
    from public.profiles where id = v_caller;
  if v_owner_balance < p_amount then
    raise exception 'INSUFFICIENT_BALANCE: Şəxsi balans yetərli deyil (cari: % ₼)',
      v_owner_balance;
  end if;

  -- Atomik köçürmə
  update public.profiles
     set balance = balance - p_amount
   where id = v_caller and coalesce(balance, 0) >= p_amount
   returning balance into v_new_owner;
  if v_new_owner is null then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  update public.brigades
     set balance = coalesce(balance, 0) + p_amount,
         updated_at = now()
   where id = p_brigade_id
   returning balance into v_new_brigade;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_caller, 'admin_adjust', -p_amount, v_new_owner,
     'Briqada balansına köçürmə (' || p_brigade_id::text || ')',
     p_brigade_id::text, v_caller);

  return jsonb_build_object(
    'ok', true,
    'brigade_balance', v_new_brigade,
    'owner_balance', v_new_owner
  );
end;
$$;

revoke execute on function public.brigade_top_up_from_owner(uuid, numeric) from public, anon;
grant   execute on function public.brigade_top_up_from_owner(uuid, numeric) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. RPC: brigade_place_offer                                               ║
-- ║   Dispatcher və ya owner briqada adından təklif verir                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_place_offer(
  p_brigade_id     uuid,
  p_opportunity_id uuid,
  p_amount         numeric,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_brigade_bal    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_opp            record;
  v_offer_id       uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid məbləği müsbət olmalıdır';
  end if;

  -- Yalnız dispatcher/owner
  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Yalnız briqada sahibi və ya dispatcher təklif verə bilər';
  end if;

  -- Komissiya
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);

  -- Briqada balansı yoxla
  select coalesce(balance, 0) into v_brigade_bal
    from public.brigades where id = p_brigade_id;
  if v_brigade_bal < v_commission_amt then
    raise exception 'NO_BALANCE: Briqada balansında minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
      v_commission_amt, v_commission_pct, v_brigade_bal;
  end if;

  -- Opportunity yoxla
  select id, status, created_by into v_opp
    from public.opportunities where id = p_opportunity_id;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizə təklif verə bilməzsiniz';
  end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'Sifariş artıq aktiv deyil';
  end if;

  -- Bu briqada artıq təklif veribsə skip
  if exists (
    select 1 from public.opportunities_offers
     where opportunity_id = p_opportunity_id
       and brigade_id     = p_brigade_id
       and status         = 'pending'
  ) then
    raise exception 'Briqada artıq bu sifarişə təklif verib';
  end if;

  -- provider_id = dispatcher (kim göndərdi) — briqada təklifi olduğu
  -- brigade_id ilə fərqləndirilir
  insert into public.opportunities_offers
    (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)
  values
    (p_opportunity_id, v_caller, p_brigade_id, p_amount, 'pending', p_notes)
  returning id into v_offer_id;

  return jsonb_build_object(
    'ok', true,
    'offer_id', v_offer_id,
    'amount', p_amount,
    'required_balance', v_commission_amt
  );
end;
$$;

revoke execute on function public.brigade_place_offer(uuid, uuid, numeric, text) from public, anon;
grant   execute on function public.brigade_place_offer(uuid, uuid, numeric, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Helper: ilk online işçini tap                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_pick_worker(p_brigade_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- İlk online işçi (məsafə yoxlanmır hələlik)
  select id from public.brigade_members
   where brigade_id = p_brigade_id
     and is_active = true
     and is_online = true
   order by last_heartbeat desc nulls last, joined_at asc
   limit 1;
$$;

grant execute on function public.brigade_pick_worker(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. accept_offer_with_payment — briqada təklifi axını                     ║
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
  v_brigade_bal    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_provider_amt   numeric;
  v_is_brigade     boolean;
  v_member_id      uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then
    raise exception 'Invalid payment method';
  end if;

  select oo.id, oo.opportunity_id, oo.provider_id, oo.brigade_id,
         oo.offer_amount, oo.status,
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

  v_is_brigade := v_offer.brigade_id is not null;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt   := v_offer.offer_amount - v_commission_amt;

  if p_method = 'card' then
    -- Müştəri balansı
    select coalesce(balance,0) into v_customer_bal
      from public.profiles where id = v_caller;
    if v_customer_bal < v_offer.offer_amount then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%',
        v_offer.offer_amount, v_customer_bal;
    end if;

    update public.profiles
       set balance = balance - v_offer.offer_amount
     where id = v_caller;

    -- Provayder escrow (briqada təklifində də escrow provayder-in lokal-balansına yox,
    -- briqadaya yox — locked_balance hələ provayderə bağlıdır, çünki
    -- provider_id = dispatcher. Sadəlik üçün belə saxlanılır)
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
    -- NAĞD axını
    if v_is_brigade then
      -- Briqada balansından komissiya tutulur
      select coalesce(balance, 0) into v_brigade_bal
        from public.brigades where id = v_offer.brigade_id;
      if v_brigade_bal < v_commission_amt then
        raise exception 'BRIGADE_INSUFFICIENT_BALANCE: Briqada balansı yetərli deyil (lazım: % ₼, mövcud: % ₼)',
          v_commission_amt, v_brigade_bal;
      end if;

      update public.brigades
         set balance    = balance - v_commission_amt,
             updated_at = now()
       where id = v_offer.brigade_id;

      if v_commission_amt > 0 then
        insert into public.transactions
          (user_id, type, amount, balance_after, description, related_id, created_by)
        values
          (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
           'Qəbul komissiyası (nağd, briqada, ' || v_commission_pct || '%)',
           p_offer_id::text, v_caller);
      end if;
    else
      -- Tək provayder nağd: şəxsi balansdan
      select coalesce(balance, 0) into v_provider_bal
        from public.profiles where id = v_offer.provider_id;
      if v_provider_bal < v_commission_amt then
        raise exception 'PROVIDER_INSUFFICIENT_BALANCE: Provayder balansı yetərli deyil (lazım: % ₼, mövcud: % ₼)',
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
           'Qəbul komissiyası (nağd, ' || v_commission_pct || '%)',
           p_offer_id::text, v_caller);
      end if;
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

  -- Briqada təklifidirsə → ən yaxın işçiyə assignment yarat
  if v_is_brigade then
    v_member_id := brigade_pick_worker(v_offer.brigade_id);
    if v_member_id is not null then
      begin
        insert into public.brigade_assignments
          (brigade_id, member_id, source_type, source_id,
           assigned_by, status, priority)
        values
          (v_offer.brigade_id, v_member_id, 'opportunity',
           v_offer.opp_id::text, v_caller, 'assigned', 5);
      exception when unique_violation then null;
      end;
    end if;
  end if;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer', p_offer_id::text,
            jsonb_build_object(
              'method', p_method,
              'amount', v_offer.offer_amount,
              'is_brigade', v_is_brigade,
              'brigade_id', v_offer.brigade_id,
              'commission_pct', v_commission_pct,
              'commission_amt', v_commission_amt
            ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'method', p_method,
    'offer_id', p_offer_id,
    'opportunity_id', v_offer.opp_id,
    'is_brigade', v_is_brigade,
    'assigned_member_id', v_member_id,
    'commission_amt', v_commission_amt,
    'commission_pct', v_commission_pct
  );
end;
$$;

revoke execute on function public.accept_offer_with_payment(uuid, text) from public, anon;
grant   execute on function public.accept_offer_with_payment(uuid, text) to authenticated;


notify pgrst, 'reload schema';
