-- Admin approval workflow for job completion
-- Allow admin to approve pending_review jobs and release payment to provider

-- Drop and recreate release_offer_to_provider to allow admin calls
drop function if exists public.release_offer_to_provider(uuid) cascade;

create or replace function public.release_offer_to_provider(p_offer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_provider_id    uuid;
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
  v_opp_status     text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.id, oo.payment_method, oo.offer_amount, op.status
    into v_provider_id, v_opp_id, v_method, v_offer_amount, v_opp_status
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;

  -- Bonus faizi
  select coalesce((value)::text::numeric, 0) into v_bonus_pct
    from public.platform_config where key = 'bonus_on_complete';

  -- Check authorization based on status
  if v_opp_status = 'pending_review' then
    -- Admin approval: caller must be admin
    if not exists (select 1 from public.profiles where id = v_caller and role in ('admin', 'master', 'superadmin')) then
      raise exception 'Only admin can approve pending_review jobs';
    end if;
  else
    -- Customer completion: caller must be the offer creator
    if not exists (select 1 from public.opportunities where id = v_opp_id and created_by = v_caller) then
      raise exception 'Only customer can complete the offer';
    end if;
  end if;

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

grant execute on function public.release_offer_to_provider(uuid) to authenticated;


-- Add grant for opportunities_offers table to allow completion evidence updates
-- Providers can update their own offers' completion evidence
drop policy if exists "Providers can update own offer completion evidence" on public.opportunities_offers;
create policy "Providers can update own offer completion evidence"
on public.opportunities_offers
for update
using (auth.uid() = provider_id)
with check (auth.uid() = provider_id);

-- Admins can update payout_status and admin_approved fields
drop policy if exists "Admins can update offer payout status" on public.opportunities_offers;
create policy "Admins can update offer payout status"
on public.opportunities_offers
for update
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'master', 'superadmin')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'master', 'superadmin')
  )
);
