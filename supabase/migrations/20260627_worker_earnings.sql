-- worker_earnings(p_from, p_to): cari işçinin seçilmiş tarix aralığında
-- tamamlanmış sifarişlərdən qazancı — ümumi, komandaya pay, platforma
-- komissiyası, xalis qazanc + sifariş siyahısı. (Tam mətn canlı miqrasiyada.)
create or replace function public.worker_earnings(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public stable
as $$
declare
  v_caller uuid := auth.uid();
  v_platform_pct numeric;
  v_out jsonb;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select coalesce((value)::text::numeric, 0) into v_platform_pct
    from public.platform_config where key = 'commission_on_accept';

  with rows as (
    select op.id, op.title, op.completed_at, oo.offer_amount::numeric as amount,
           oo.brigade_id, oo.payment_method, coalesce(bm.commission_pct, 100) as worker_pct
    from public.opportunities op
    join public.opportunities_offers oo on oo.id = op.accepted_offer_id
    left join public.brigade_members bm
      on bm.brigade_id = oo.brigade_id and bm.profile_id = v_caller
    where oo.provider_id = v_caller and op.status = 'completed'
      and op.completed_at is not null
      and op.completed_at >= p_from and op.completed_at <= p_to
  ),
  calc as (
    select *,
      round(amount * v_platform_pct / 100, 2) as platform_amt,
      case when brigade_id is not null then round(amount * worker_pct / 100, 2)
           else round(amount - amount * v_platform_pct / 100, 2) end as worker_net,
      case when brigade_id is not null then round(amount - amount * worker_pct / 100, 2)
           else 0 end as brigade_cut
    from rows
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'count', (select count(*) from calc),
    'gross', coalesce((select sum(amount) from calc), 0),
    'platform_total', coalesce((select sum(platform_amt) from calc), 0),
    'brigade_total', coalesce((select sum(brigade_cut) from calc), 0),
    'net_total', coalesce((select sum(worker_net) from calc), 0),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'completed_at', completed_at, 'amount', amount,
        'is_brigade', brigade_id is not null, 'payment_method', payment_method,
        'worker_pct', worker_pct, 'worker_net', worker_net,
        'brigade_cut', brigade_cut, 'platform_amt', platform_amt
      ) order by completed_at desc) from calc
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke execute on function public.worker_earnings(timestamptz, timestamptz) from public, anon;
grant execute on function public.worker_earnings(timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
