-- ============================================================================
-- place_bid RPC + balans yoxlaması
--
-- Qaydalar:
--   - Provayder balansında məbləğ yoxdursa (balance <= 0) bid bloklanır
--   - Direct INSERT bloklanır (yalnız RPC üzərindən)
--   - Bid məbləği müsbət olmalıdır
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. opportunities_offers.insert RLS sıxılır                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname='public' and tablename='opportunities_offers'
       and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.opportunities_offers', r.policyname);
  end loop;
end$$;

-- Yalnız RPC vasitəsilə insert (security definer bypass edir)
revoke insert on public.opportunities_offers from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. RPC: place_bid                                                         ║
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
  v_caller  uuid := auth.uid();
  v_balance numeric;
  v_role    text;
  v_bid_id  uuid;
  v_opp     record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid məbləği müsbət olmalıdır';
  end if;

  -- Rol və balans yoxla
  select lower(coalesce(role,'')), coalesce(balance, 0)
    into v_role, v_balance
    from public.profiles
   where id = v_caller;

  if v_role not in ('provider','admin','master','superadmin') then
    raise exception 'Yalnız provayder təklif verə bilər';
  end if;

  -- Balans yoxdursa bloklanır
  if v_balance <= 0 then
    raise exception 'NO_BALANCE: Təklif vermək üçün balansınızda məbləğ olmalıdır. Balansı artırın.';
  end if;

  -- Opportunity mövcuddur və açıqdır?
  select id, status, created_by
    into v_opp
    from public.opportunities
   where id = p_opportunity_id;

  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizə təklif verə bilməzsiniz';
  end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'Sifariş artıq aktiv deyil (status: %)', v_opp.status;
  end if;

  -- Eyni provayder eyni sifarişə artıq təklif verib?
  if exists (
    select 1 from public.opportunities_offers
     where opportunity_id = p_opportunity_id
       and provider_id    = v_caller
       and status         = 'pending'
  ) then
    raise exception 'Bu sifarişə artıq aktiv təklifiniz var';
  end if;

  -- Insert
  insert into public.opportunities_offers
    (opportunity_id, provider_id, offer_amount, status)
  values
    (p_opportunity_id, v_caller, p_amount, 'pending')
  returning id into v_bid_id;

  return jsonb_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'amount', p_amount
  );
end;
$$;

revoke execute on function public.place_bid(uuid, numeric) from public, anon;
grant   execute on function public.place_bid(uuid, numeric) to authenticated;


notify pgrst, 'reload schema';
