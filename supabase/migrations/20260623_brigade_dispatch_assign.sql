-- ============================================================================
-- Dispetçer → açıq sifarişi konkret işçiyə yönləndirmə (manual dispatch)
--
-- Tələblər:
--   • Dispatcher açıq sifarişi briqadasının bir işçisinə yönləndirə bilsin
--   • İşçiyə BAĞLAMADAN ÖNCƏ sistem yoxlasın ki, sifariş artıq başqasına
--     (başqa işçi/briqada) bağlı deyil — yoxsa "ALREADY_TAKEN" xətası
--   • Yönləndirmə anında komissiya briqada balansından REZERV olunur
--     (sifariş büdcəsi × commission_on_accept %). İşçi imtina edərsə və ya
--     sifarişi başqası götürərsə (assignment expired/declined/cancelled) —
--     rezerv avtomatik briqada balansına geri qaytarılır (trigger).
--   • İşçi "əvvəlcə qəbul etsin": assignment status = 'assigned' yaradılır,
--     mobil app-də mövcud claim/decline axını ilə qəbul/imtina edir.
--   • Bildiriş + FCM mövcud notify trigger / explicit insert ilə gedir.
--   • Ödəniş üsulu (nağd/kart) assignment-də saxlanılır.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. brigade_assignments — yeni sütunlar                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.brigade_assignments
  add column if not exists payment_method text
    check (payment_method in ('cash', 'card'));

alter table public.brigade_assignments
  add column if not exists commission_reserved numeric(12,2);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Komissiya rezervinin geri qaytarılması (trigger)                       ║
-- ║   Assignment declined/expired/cancelled olanda rezerv briqadaya qayıdır.  ║
-- ║   BEFORE UPDATE — NEW.commission_reserved sıfırlanır (idempotent).         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_assignment_refund_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  if old.commission_reserved is not null
     and coalesce(old.commission_reserved, 0) > 0
     and new.status in ('declined', 'expired', 'cancelled')
     and old.status not in ('declined', 'expired', 'cancelled') then

    update public.brigades
       set balance = coalesce(balance, 0) + old.commission_reserved,
           updated_at = now()
     where id = old.brigade_id
     returning balance into v_new_balance;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (coalesce(old.assigned_by, (select owner_id from public.brigades where id = old.brigade_id)),
       'admin_adjust', old.commission_reserved, coalesce(v_new_balance, 0),
       'Yönləndirmə ləğvi — komissiya rezervi geri qaytarıldı',
       old.brigade_id::text, old.assigned_by);

    -- İdempotent: rezerv qaytarıldı, sütunu sıfırla
    new.commission_reserved := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_brigade_assignment_refund on public.brigade_assignments;
create trigger trg_brigade_assignment_refund
  before update on public.brigade_assignments
  for each row
  execute function public.brigade_assignment_refund_commission();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC: brigade_dispatch_assign                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_dispatch_assign(
  p_brigade_id     uuid,
  p_opportunity_id uuid,
  p_member_id      uuid,
  p_method         text default 'cash',
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
  v_commission_amt numeric := 0;
  v_brigade_bal    numeric;
  v_new_balance    numeric;
  v_existing       record;
  v_need_reserve   boolean := false;
  v_assignment_id  uuid;
  v_profile_id     uuid;
  v_brigade_name   text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash', 'card') then
    raise exception 'Ödəniş üsulu nağd və ya kart olmalıdır';
  end if;

  -- Yalnız owner/dispatcher
  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Yalnız briqada sahibi və ya dispatcher sifariş yönləndirə bilər';
  end if;

  -- Sifarişi kilidlə
  select id, status, budget, created_by
    into v_opp
    from public.opportunities
   where id = p_opportunity_id
   for update;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'ALREADY_TAKEN: Sifariş artıq aktiv deyil';
  end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizi yönləndirə bilməzsiniz';
  end if;

  -- ── GUARD A: sifariş artıq KİMSƏ tərəfindən götürülübmü? ──────────────
  if exists (
    select 1 from public.brigade_assignments
     where source_id = p_opportunity_id::text
       and status in ('accepted', 'in_progress', 'completed')
  ) then
    raise exception 'ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb';
  end if;

  -- ── GUARD B: bu briqada artıq başqa işçiyə yönləndiribmi? ─────────────
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
  select bm.id, bm.profile_id
    into v_member
    from public.brigade_members bm
   where bm.id = p_member_id
     and bm.brigade_id = p_brigade_id
     and bm.is_active = true;
  if v_member.id is null then
    raise exception 'İşçi bu briqadanın aktiv üzvü deyil';
  end if;
  v_profile_id := v_member.profile_id;

  -- Komissiya faizi
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(coalesce(v_opp.budget, 0) * coalesce(v_commission_pct, 0) / 100, 2);

  -- Mövcud assignment (auto-broadcast 'offered' və ya köhnə)
  select * into v_existing
    from public.brigade_assignments
   where brigade_id = p_brigade_id
     and source_id  = p_opportunity_id::text
     and member_id  = p_member_id;

  -- Rezerv lazımdırmı? (komissiya > 0 və hələ rezerv olunmayıb)
  v_need_reserve := v_commission_amt > 0
    and (v_existing.id is null or v_existing.commission_reserved is null);

  if v_need_reserve then
    -- Briqada balansından atomik tut
    update public.brigades
       set balance = balance - v_commission_amt,
           updated_at = now()
     where id = p_brigade_id
       and coalesce(balance, 0) >= v_commission_amt
     returning balance into v_new_balance;
    if v_new_balance is null then
      select coalesce(balance, 0) into v_brigade_bal
        from public.brigades where id = p_brigade_id;
      raise exception 'NO_BALANCE: Briqada balansı yetərli deyil (lazım: % ₼, mövcud: % ₼)',
        v_commission_amt, v_brigade_bal;
    end if;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_caller, 'admin_adjust', -v_commission_amt, v_new_balance,
       'Dispetçer yönləndirmə — komissiya rezervi (' || v_commission_pct || '%)',
       p_brigade_id::text, v_caller);
  end if;

  -- Assignment yarat / yenilə (status = 'assigned' — işçi qəbul edəcək)
  if v_existing.id is null then
    insert into public.brigade_assignments
      (brigade_id, member_id, source_type, source_id, assigned_by,
       status, notes, priority, payment_method, commission_reserved)
    values
      (p_brigade_id, p_member_id, 'opportunity', p_opportunity_id::text, v_caller,
       'assigned', p_notes, 5, p_method,
       case when v_need_reserve then v_commission_amt else null end)
    returning id into v_assignment_id;
    -- notify_member_on_assignment trigger bildiriş göndərir (INSERT, 'assigned')
  else
    update public.brigade_assignments
       set status          = 'assigned',
           assigned_by      = v_caller,
           payment_method   = p_method,
           notes            = coalesce(p_notes, notes),
           responded_at     = null,
           commission_reserved = case
             when v_need_reserve then v_commission_amt
             else commission_reserved
           end
     where id = v_existing.id
     returning id into v_assignment_id;

    -- UPDATE trigger bildiriş göndərmir — manual notification
    select name into v_brigade_name from public.brigades where id = p_brigade_id;
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_profile_id,
      coalesce(v_brigade_name, 'Briqada') || ' — yeni təyinat',
      'Sifariş sənə təyin edildi. Qəbul və ya rədd et.',
      'brigade_assignment',
      v_assignment_id::text,
      '/account/master/incoming'
    );
  end if;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_dispatch_assign', 'brigade_assignment',
            v_assignment_id::text,
            jsonb_build_object(
              'brigade_id', p_brigade_id,
              'opportunity_id', p_opportunity_id,
              'member_id', p_member_id,
              'method', p_method,
              'commission_reserved', case when v_need_reserve then v_commission_amt else 0 end
            ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', v_assignment_id,
    'method', p_method,
    'commission_reserved', case when v_need_reserve then v_commission_amt else 0 end
  );
end;
$$;

revoke execute on function public.brigade_dispatch_assign(uuid, uuid, uuid, text, text)
  from public, anon;
grant   execute on function public.brigade_dispatch_assign(uuid, uuid, uuid, text, text)
  to authenticated;


notify pgrst, 'reload schema';
