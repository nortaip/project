-- ============================================================================
-- Dispetçer → açıq sifarişi işçiyə yönləndirmə (TAM ESCROW modelinə bağlı)
--
-- Məntiq:
--   • Dispatçer açıq sifarişi briqadasının bir işçisinə yönləndirir.
--   • Bu, briqada adından TƏKLİF (opportunities_offers) yaradır + seçilmiş
--     işçiyə assignment bağlayır (status='assigned') → işçiyə bildiriş + FCM.
--   • BAĞLAMADAN ÖNCƏ yoxlanır: sifariş artıq başqası tərəfindən qəbul
--     edilməyib (ALREADY_TAKEN) — "sonra problem yaşamayaq".
--   • Müştəri mövcud axınla təklifi QƏBUL edib ÖDƏYİR:
--       - kart  → Epoint gateway → escrow (locked_balance)
--       - nağd  → qəbul komissiyası briqada balansından
--     3 mərhələli komissiya (accept / complete / withdrawal) olduğu kimi qalır.
--   • accept_offer_with_payment dispatçerin TƏYİN ETDİYİ işçini saxlayır
--     (avtomatik başqa işçi seçmir).
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. RPC: brigade_dispatch_assign                                           ║
-- ║    Təklif yaradır + işçini bağlayır (guard ilə)                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_dispatch_assign(
  p_brigade_id     uuid,
  p_opportunity_id uuid,
  p_member_id      uuid,
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
  v_opp            record;
  v_member         record;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_brigade_bal    numeric;
  v_offer_id       uuid;
  v_existing_asg   record;
  v_assignment_id  uuid;
  v_profile_id     uuid;
  v_brigade_name   text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Təklif məbləği müsbət olmalıdır';
  end if;

  -- Yalnız owner/dispatcher
  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Yalnız briqada sahibi və ya dispatcher sifariş yönləndirə bilər';
  end if;

  -- Sifarişi kilidlə + status yoxla
  select id, status, budget, created_by, accepted_offer_id
    into v_opp
    from public.opportunities
   where id = p_opportunity_id
   for update;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizi yönləndirə bilməzsiniz';
  end if;

  -- ── GUARD: sifariş artıq başqasına bağlanıb? ─────────────────────────
  if v_opp.accepted_offer_id is not null
     or v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb';
  end if;
  if exists (
    select 1 from public.brigade_assignments
     where source_id = p_opportunity_id::text
       and status in ('accepted', 'in_progress', 'completed')
  ) then
    raise exception 'ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb';
  end if;

  -- ── GUARD B: bu briqada artıq başqa işçiyə yönləndirib? ──────────────
  if exists (
    select 1 from public.brigade_assignments
     where brigade_id = p_brigade_id
       and source_id  = p_opportunity_id::text
       and member_id <> p_member_id
       and status in ('assigned', 'accepted', 'in_progress')
  ) then
    raise exception 'Bu sifariş artıq briqadanın başqa işçisinə yönləndirilib';
  end if;

  -- İşçi yoxlaması
  select bm.id, bm.profile_id into v_member
    from public.brigade_members bm
   where bm.id = p_member_id
     and bm.brigade_id = p_brigade_id
     and bm.is_active = true;
  if v_member.id is null then
    raise exception 'İşçi bu briqadanın aktiv üzvü deyil';
  end if;
  v_profile_id := v_member.profile_id;

  -- Komissiya tutumu (nağd halda briqada balansından çıxacaq) — balans yoxla
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * coalesce(v_commission_pct, 0) / 100, 2);

  select coalesce(balance, 0) into v_brigade_bal
    from public.brigades where id = p_brigade_id;
  if v_brigade_bal < v_commission_amt then
    raise exception 'NO_BALANCE: Briqada balansında min. % ₼ olmalıdır (komissiya %%), cari: % ₼',
      v_commission_amt, v_commission_pct, v_brigade_bal;
  end if;

  -- ── Briqada təklifi yarat (varsa yenidən istifadə et) ────────────────
  select id into v_offer_id
    from public.opportunities_offers
   where opportunity_id = p_opportunity_id
     and brigade_id     = p_brigade_id
     and status         = 'pending'
   limit 1;

  if v_offer_id is null then
    insert into public.opportunities_offers
      (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)
    values
      (p_opportunity_id, v_caller, p_brigade_id, p_amount, 'pending', p_notes)
    returning id into v_offer_id;
  else
    update public.opportunities_offers
       set offer_amount = p_amount,
           notes        = coalesce(p_notes, notes)
     where id = v_offer_id;
  end if;

  -- ── İşçini bağla (assignment, source_id = opportunity_id) ────────────
  select * into v_existing_asg
    from public.brigade_assignments
   where brigade_id = p_brigade_id
     and source_id  = p_opportunity_id::text
     and member_id  = p_member_id;

  if v_existing_asg.id is null then
    insert into public.brigade_assignments
      (brigade_id, member_id, source_type, source_id, assigned_by,
       status, notes, priority)
    values
      (p_brigade_id, p_member_id, 'opportunity', p_opportunity_id::text, v_caller,
       'assigned', p_notes, 5)
    returning id into v_assignment_id;
    -- notify_member_on_assignment trigger bildiriş göndərir (INSERT, 'assigned')
  else
    update public.brigade_assignments
       set status       = 'assigned',
           assigned_by  = v_caller,
           notes        = coalesce(p_notes, notes),
           responded_at = null
     where id = v_existing_asg.id
     returning id into v_assignment_id;

    -- UPDATE trigger bildiriş göndərmir — manual notification
    select name into v_brigade_name from public.brigades where id = p_brigade_id;
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_profile_id,
      coalesce(v_brigade_name, 'Briqada') || ' — yeni təyinat',
      'Sifariş sənə təyin edildi. Qəbul və ya rədd et.',
      'brigade_assignment', v_assignment_id::text, '/account/master/incoming'
    );
  end if;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_dispatch_assign', 'opportunity_offer',
            v_offer_id::text,
            jsonb_build_object(
              'brigade_id', p_brigade_id,
              'opportunity_id', p_opportunity_id,
              'member_id', p_member_id,
              'amount', p_amount
            ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'offer_id', v_offer_id,
    'assignment_id', v_assignment_id,
    'amount', p_amount,
    'required_balance', v_commission_amt
  );
end;
$$;

revoke execute on function public.brigade_dispatch_assign(uuid, uuid, uuid, numeric, text)
  from public, anon;
grant   execute on function public.brigade_dispatch_assign(uuid, uuid, uuid, numeric, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. accept_offer_with_payment — dispatçerin təyin etdiyi işçini saxla       ║
-- ║    (yalnız briqada təyinatı bloku dəyişir; qalan məntiq eynidir)           ║
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
    select coalesce(balance,0) into v_customer_bal
      from public.profiles where id = v_caller;
    if v_customer_bal < v_offer.offer_amount then
      raise exception 'INSUFFICIENT_BALANCE: required=% available=%',
        v_offer.offer_amount, v_customer_bal;
    end if;

    update public.profiles
       set balance = balance - v_offer.offer_amount
     where id = v_caller;

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

  -- Briqada təklifidirsə → işçi assignment
  if v_is_brigade then
    -- Dispatçer ARTIQ işçi təyin edibsə, onu saxla (avtomatik seçmə)
    select member_id into v_member_id
      from public.brigade_assignments
     where brigade_id = v_offer.brigade_id
       and source_id  = v_offer.opp_id::text
       and status in ('offered', 'assigned', 'accepted', 'in_progress')
     order by assigned_at desc
     limit 1;

    if v_member_id is null then
      -- Heç kim təyin olunmayıb → ən yaxın online işçini avtomatik seç
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
