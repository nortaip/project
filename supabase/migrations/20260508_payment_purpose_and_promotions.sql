-- ============================================================================
-- Migration: payment purpose tracking + service promotion RPC
--
-- Bu migration:
-- 1. services cədvəlinə promotion_type / promotion_expires_at sütunları əlavə edir
--    (əgər artıq yoxdursa)
-- 2. apply_service_promotion(...) SECURITY DEFINER RPC yaradır — yalnız
--    payment-webhook tərəfindən çağrılır, service-i bir müddətə VIP / premium edir
-- 3. payments cədvəlinə CHECK əlavə edir ki amount > 0 olsun
-- ============================================================================

-- 1. services-ə promotion sütunları (idempotent) ─────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='services' and column_name='promotion_type'
  ) then
    alter table public.services
      add column promotion_type text check (promotion_type in ('normal','vip','premium')) default 'normal';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='services' and column_name='promotion_expires_at'
  ) then
    alter table public.services add column promotion_expires_at timestamptz;
  end if;
end$$;

create index if not exists idx_services_promotion_active
  on public.services (promotion_type, promotion_expires_at)
  where promotion_expires_at is not null;

-- 2. apply_service_promotion RPC ──────────────────────────────────────────
-- Bu funksiya yalnız payment-webhook tərəfindən (service_role JWT ilə)
-- çağırılır. Client tərəfdən çağırılması REVOKE-lanıb.
create or replace function public.apply_service_promotion(
  p_service_id     uuid,
  p_promotion_type text,
  p_promotion_days int,
  p_payment_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_now     timestamptz := now();
  v_until   timestamptz;
begin
  -- Payment-i tap, service_promotion olduğunu və sahibini yoxla
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

  -- Service sahibinin payment owner ilə eyni olduğunu yoxla
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

  -- Mövcud promotion-u extend et və ya yenisini başlat
  v_until := greatest(v_now, coalesce((select promotion_expires_at from public.services where id = p_service_id), v_now))
             + (p_promotion_days || ' days')::interval;

  update public.services
     set promotion_type       = p_promotion_type,
         promotion_expires_at = v_until,
         updated_at           = v_now
   where id = p_service_id;

  -- Audit
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
$$;

-- Yalnız service_role çağıra bilsin — Edge Function özü
revoke all on function public.apply_service_promotion(uuid, text, int, uuid) from public, authenticated, anon;
grant execute on function public.apply_service_promotion(uuid, text, int, uuid) to service_role;

-- 3. payments cədvəlində amount > 0 invariant ──────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='payments' and column_name='amount'
  ) and not exists (
    select 1 from pg_constraint where conname = 'payments_amount_positive'
  ) then
    alter table public.payments add constraint payments_amount_positive check (amount > 0);
  end if;
end$$;

-- 4. external_id sütunu yoxdursa əlavə et (köhnə schemə üçün backfill)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='payments' and column_name='external_id'
  ) then
    alter table public.payments add column external_id text;
  end if;
end$$;

-- 5. payment-webhook signature replay-protection üçün uniq index ────────
-- (eyni Epoint transaction iki dəfə emal olunmasın)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='payments' and column_name='external_id'
  ) then
    create unique index if not exists idx_payments_external_id_unique
      on public.payments (external_id)
      where external_id is not null;
  end if;
end$$;
