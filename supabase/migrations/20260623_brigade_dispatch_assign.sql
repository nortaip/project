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
-- ║ 0. opportunities_offers.notes — təklif qeydi (canlı DB-də olmaya bilər)     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.opportunities_offers
  add column if not exists notes text;


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
    raise exception 'NO_BALANCE: Briqada balansında minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
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


-- ============================================================================
-- QEYD: accept_offer_with_payment BURADA DƏYİŞDİRİLMİR.
-- Canlı DB-dəki versiya müştəri servis haqqı + qarantili nağd depozit + lat/lng
-- məntiqini saxlayır və briqada üçün AVTOMATİK işçi seçmir. Dispatçerin əvvəlcədən
-- təyin etdiyi assignment (brigade_dispatch_assign tərəfindən 'assigned' yaradılır)
-- qəbul zamanı toxunulmadan qalır — işçi mobildə qəbul/imtina edir.
-- ============================================================================


notify pgrst, 'reload schema';
