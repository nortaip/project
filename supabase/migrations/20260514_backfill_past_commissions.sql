-- ============================================================================
-- Backfill: keçmişdə qəbul edilmiş və tamamlanmış kart sifarişləri üçün
-- platform_revenue transaction-larını əlavə et.
--
-- Niyə lazımdır:
--   Köhnə accept_offer_with_payment və release_offer_to_provider RPC-ləri
--   komissiya məbləğini yalnız təsvirə yazırdı, lakin ayrıca
--   platform_revenue transaction yaratmırdı. Bu səbəbdən gəlir hesabatında
--   keçmiş komissiyalar görünmür.
--
-- Yanaşma:
--   1. Bütün kart-əsaslı 'accepted' və 'completed' sifarişlər üçün gez
--   2. Hər biri üçün platform_revenue transaction artıq varsa skip et
--   3. Yoxdursa, escrow_lock məbləği və offer_amount fərqindən komissiya
--      hesablayıb insert et
--
-- Idempotent: təkrar işlədilməsi heç nə pozmur (UNIQUE check ilə)
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Backfill helper — keçmiş qəbul komissiyası                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare
  v_row       record;
  v_locked    numeric;
  v_offer_amt numeric;
  v_commission numeric;
  v_inserted  int := 0;
  v_skipped   int := 0;
begin
  raise notice '── Qəbul komissiyası backfill başlayır ──';

  for v_row in
    select oo.id              as offer_id,
           oo.opportunity_id,
           oo.provider_id,
           oo.offer_amount,
           op.created_by      as customer_id,
           oo.status,
           oo.paid_at,
           oo.created_at
      from public.opportunities_offers oo
      join public.opportunities op on op.id = oo.opportunity_id
     where oo.payment_method = 'card'
       and oo.status in ('accepted', 'completed')
  loop
    -- Eyni offer üçün platform_revenue artıq varsa skip et
    if exists (
      select 1 from public.transactions
       where related_id = v_row.offer_id::text
         and type       = 'platform_revenue'
         and description ilike 'Qəbul komissiyası%'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- escrow_lock məbləği (provider-ə gedən hissə)
    select amount into v_locked
      from public.transactions
     where related_id = v_row.offer_id::text
       and type       = 'escrow_lock'
     order by created_at asc
     limit 1;

    if v_locked is null then
      -- escrow_lock yoxdursa, offer_amount-ı baza götür
      v_locked := v_row.offer_amount;
    end if;

    v_offer_amt  := v_row.offer_amount;
    v_commission := round(v_offer_amt - v_locked, 2);

    if v_commission <= 0 then
      -- Heç bir komissiya tutulmayıb (köhnə qaydalar) — keç
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by, created_at)
    values (
      v_row.provider_id,
      'platform_revenue',
      v_commission,
      0,
      'Qəbul komissiyası (backfill, offer ' || left(v_row.offer_id::text, 8) || ')',
      v_row.offer_id::text,
      v_row.customer_id,
      coalesce(v_row.paid_at, v_row.created_at, now())
    );
    v_inserted := v_inserted + 1;
  end loop;

  raise notice 'Qəbul komissiyası: % insert, % skip', v_inserted, v_skipped;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Backfill helper — keçmiş tamamlama komissiyası                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare
  v_row        record;
  v_locked     numeric;
  v_released   numeric;
  v_commission numeric;
  v_inserted   int := 0;
  v_skipped    int := 0;
begin
  raise notice '── Tamamlama komissiyası backfill başlayır ──';

  for v_row in
    select oo.id              as offer_id,
           oo.opportunity_id,
           oo.provider_id,
           op.created_by      as customer_id,
           oo.created_at
      from public.opportunities_offers oo
      join public.opportunities op on op.id = oo.opportunity_id
     where oo.payment_method = 'card'
       and oo.status         = 'completed'
  loop
    -- Skip if platform_revenue üçün tamamlama artıq var
    if exists (
      select 1 from public.transactions
       where related_id = v_row.offer_id::text
         and type       = 'platform_revenue'
         and description ilike 'Tamamlama komissiyası%'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select amount into v_locked
      from public.transactions
     where related_id = v_row.offer_id::text
       and type       = 'escrow_lock'
     order by created_at asc
     limit 1;

    select amount into v_released
      from public.transactions
     where related_id = v_row.offer_id::text
       and type       = 'escrow_release'
     order by created_at desc
     limit 1;

    if v_locked is null or v_released is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_commission := round(v_locked - v_released, 2);

    if v_commission <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Tamamlama vaxtını escrow_release transaksiyasından götür
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by, created_at)
    values (
      v_row.provider_id,
      'platform_revenue',
      v_commission,
      0,
      'Tamamlama komissiyası (backfill, offer ' || left(v_row.offer_id::text, 8) || ')',
      v_row.offer_id::text,
      v_row.customer_id,
      coalesce(
        (select created_at from public.transactions
          where related_id = v_row.offer_id::text and type = 'escrow_release'
          order by created_at desc limit 1),
        v_row.created_at,
        now()
      )
    );
    v_inserted := v_inserted + 1;
  end loop;

  raise notice 'Tamamlama komissiyası: % insert, % skip', v_inserted, v_skipped;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. opportunities.status — keçmiş 'active'-lər 'accepted' olur            ║
-- ║    (Yeni RPC artıq 'accepted' yazır; köhnə sətirlər üçün backfill)       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare v_count int;
begin
  with updated as (
    update public.opportunities
       set status = 'accepted'
     where status = 'active'
       and accepted_offer_id is not null
     returning id
  )
  select count(*) into v_count from updated;
  raise notice 'opportunities.status active → accepted: % row', v_count;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Yekun hesabat — neçə platform_revenue var indi                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare
  v_count int;
  v_total numeric;
begin
  select count(*), coalesce(sum(amount), 0)
    into v_count, v_total
    from public.transactions
   where type = 'platform_revenue';
  raise notice '── Yekun: % platform_revenue qeyd, cəm % ₼ ──', v_count, v_total;
end$$;


notify pgrst, 'reload schema';
