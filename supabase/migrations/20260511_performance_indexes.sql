-- ============================================================================
-- Performans indexləri + tək sorğu dashboard RPC
--
-- Problem: Dashboard 13+ paralel sorğu atırdı, hər biri ayrı round-trip.
-- Plus bəzi cədvəllərdə kritik sütunlar üçün index yox idi.
--
-- Həll:
--   1. Filter / sort üçün istifadə olunan sütunlara index əlavə et
--   2. `admin_dashboard_stats()` RPC — bir çağırışda bütün KPI-lar
-- ============================================================================

-- ── Indexes ─────────────────────────────────────────────────────────────
create index if not exists profiles_role_idx           on public.profiles (role);
create index if not exists profiles_created_at_idx     on public.profiles (created_at desc);
create index if not exists opportunities_status_idx    on public.opportunities (status, created_at desc);
create index if not exists opportunities_created_by_idx on public.opportunities (created_by);
create index if not exists opportunities_provider_idx  on public.opportunities (provider_id) where provider_id is not null;
create index if not exists offers_status_idx           on public.opportunities_offers (status, created_at desc);
create index if not exists offers_opp_idx              on public.opportunities_offers (opportunity_id, status);
create index if not exists offers_provider_idx         on public.opportunities_offers (provider_id, status);
create index if not exists payments_status_completed_idx
  on public.payments (status, completed_at desc) where status = 'completed';
create index if not exists payments_purpose_idx
  on public.payments ((metadata->>'purpose'), completed_at desc)
  where status = 'completed';
create index if not exists transactions_type_user_idx
  on public.transactions (type, user_id, created_at desc);
create index if not exists transactions_related_idx
  on public.transactions (related_id, type) where related_id is not null;
create index if not exists withdrawals_status_idx
  on public.withdrawals (status, requested_at desc);
create index if not exists withdrawals_provider_idx
  on public.withdrawals (provider_id, requested_at desc);
create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

-- ── admin_dashboard_stats: tək çağırışda hər şey ────────────────────────
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_30d timestamptz := now() - interval '30 days';
  v_7d  timestamptz := now() - interval '7 days';
  v_result jsonb;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  with
  counts as (
    select
      (select count(*) from public.profiles)                                                 as total_users,
      (select count(*) from public.profiles where created_at >= v_7d)                       as new_users_7d,
      (select count(*) from public.profiles where lower(coalesce(role,'')) = 'provider')    as total_providers,
      (select count(*) from public.bookings)                                                as total_bookings,
      (select count(*) from public.bookings where status = 'pending')                       as pending_bookings,
      (select count(*) from public.bookings where status = 'completed')                     as completed_bookings,
      (select count(*) from public.brigades)                                                as total_brigades,
      (select count(*) from public.opportunities
        where status in ('pending','active','ongoing','accepted'))                          as active_opportunities,
      (select count(*) from public.opportunities)                                           as total_opportunities
  ),
  pay_30d as (
    select coalesce(sum(amount),0) as gmv_30d,
           count(*)                as paid_count_30d
      from public.payments
     where status = 'completed' and completed_at >= v_30d
  ),
  pay_7d as (
    select coalesce(sum(amount),0) as gmv_7d
      from public.payments
     where status = 'completed' and completed_at >= v_7d
  ),
  accept_comm as (
    select coalesce(sum(p.amount - coalesce(t.amount, p.amount)), 0) as v
      from public.payments p
      left join public.transactions t
        on t.payment_id = p.id and t.type = 'escrow_lock'
     where p.status = 'completed'
       and (p.metadata->>'purpose') = 'service_payment'
       and p.completed_at >= v_30d
  ),
  complete_comm as (
    select coalesce(sum(l.amount - r.amount), 0) as v
      from public.transactions l
      join public.transactions r
        on r.related_id = l.related_id and r.type = 'escrow_release'
     where l.type = 'escrow_lock' and l.created_at >= v_30d
  ),
  wd as (
    select
      coalesce(sum(commission_amount),0)                                  as wd_comm,
      coalesce(sum(case when status='pending' then amount_requested end),0) as pending_amount,
      count(*) filter (where status='pending')                            as pending_count
      from public.withdrawals
     where requested_at >= v_30d
  )
  select jsonb_build_object(
    'totalUsers',            c.total_users,
    'newUsers7d',            c.new_users_7d,
    'totalProviders',        c.total_providers,
    'totalBookings',         c.total_bookings,
    'pendingBookings',       c.pending_bookings,
    'completedBookings',     c.completed_bookings,
    'totalBrigades',         c.total_brigades,
    'activeOpportunities',   c.active_opportunities,
    'totalOpportunities',    c.total_opportunities,
    'gmv7d',                 p7.gmv_7d,
    'gmv30d',                p30.gmv_30d,
    'completedPayments30d',  p30.paid_count_30d,
    'acceptCommission',      ac.v,
    'completeCommission',    cc.v,
    'withdrawalCommission',  w.wd_comm,
    'platformRevenue30d',    ac.v + cc.v + w.wd_comm,
    'pendingWithdrawalsAmount', w.pending_amount,
    'pendingWithdrawalsCount',  w.pending_count
  )
    into v_result
    from counts c, pay_30d p30, pay_7d p7, accept_comm ac, complete_comm cc, wd w;

  return v_result;
end;
$$;

revoke execute on function public.admin_dashboard_stats() from public, anon;
grant   execute on function public.admin_dashboard_stats() to authenticated;

-- ── Günlük dinamika RPC (son 14 gün) ───────────────────────────────────
create or replace function public.admin_dashboard_daily(p_days int default 14)
returns table(d date, gmv numeric, revenue numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  return query
  with days as (
    select generate_series(
      (current_date - (p_days - 1))::date,
      current_date,
      '1 day'::interval
    )::date as d
  ),
  daily_gmv as (
    select date_trunc('day', completed_at)::date as dt, sum(amount) as g
      from public.payments
     where status = 'completed' and completed_at >= current_date - p_days
     group by 1
  ),
  daily_accept as (
    select date_trunc('day', p.completed_at)::date as dt,
           sum(p.amount - coalesce(t.amount, p.amount)) as a
      from public.payments p
      left join public.transactions t
        on t.payment_id = p.id and t.type = 'escrow_lock'
     where p.status = 'completed'
       and (p.metadata->>'purpose') = 'service_payment'
       and p.completed_at >= current_date - p_days
     group by 1
  ),
  daily_wd as (
    select date_trunc('day', requested_at)::date as dt,
           sum(commission_amount) as w
      from public.withdrawals
     where requested_at >= current_date - p_days
     group by 1
  )
  select
    days.d,
    coalesce(daily_gmv.g, 0)::numeric,
    (coalesce(daily_accept.a, 0) + coalesce(daily_wd.w, 0))::numeric
  from days
  left join daily_gmv on daily_gmv.dt = days.d
  left join daily_accept on daily_accept.dt = days.d
  left join daily_wd on daily_wd.dt = days.d
  order by days.d;
end;
$$;

revoke execute on function public.admin_dashboard_daily(int) from public, anon;
grant   execute on function public.admin_dashboard_daily(int) to authenticated;

notify pgrst, 'reload schema';
