-- ============================================================================
-- Balans modeli unifikasiyası + bonus konvertasiya komissiyası
--
-- Qaydalar (commission_rules.md ilə uyğun):
--   1. profiles.balance — yeganə spendable balans mənbəyi
--   2. provider_wallets yalnız locked_balance + bonus_balance + totals üçün
--   3. commission_on_bonus_convert yeni platform_config açarı
--   4. convert_bonus_to_balance faiz tətbiq edir + platform_revenue yazır
--   5. release_offer_to_provider və request_withdrawal indi profiles.balance
--      ilə işləyir; provider_wallets.balance trigger ilə sinxron qalır
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Yeni platform_config açarı                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
insert into public.platform_config (key, value, description) values
  ('commission_on_bonus_convert', '0'::jsonb,
   'Bonus → balans konvertasiyasında tutulan % (0 = komissiyasız)')
on conflict (key) do nothing;

-- get_commission_rates RPC bonus konvertasiyanı da qaytarsın
create or replace function public.get_commission_rates()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_object_agg(key, (value)::text::numeric)
    from public.platform_config
   where key in (
     'commission_on_accept',
     'commission_on_complete',
     'commission_on_withdrawal',
     'commission_on_bonus_convert',
     'min_withdrawal_amount'
   );
$$;
grant execute on function public.get_commission_rates() to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Mövcud provider_wallets.balance-i profiles.balance-ə köçür (one-time)║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select pw.provider_id, coalesce(pw.balance, 0) as wallet_balance
      from public.provider_wallets pw
     where coalesce(pw.balance, 0) > 0
  loop
    update public.profiles
       set balance = coalesce(balance, 0) + r.wallet_balance
     where id = r.provider_id;

    update public.provider_wallets
       set balance = 0,
           updated_at = now()
     where provider_id = r.provider_id;

    v_count := v_count + 1;
  end loop;
  raise notice 'provider_wallets.balance → profiles.balance miqrasiyası: % sətr', v_count;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Sinxron trigger — provider_wallets.balance hələ də provider üçün     ║
-- ║    profiles.balance ilə eyni dəyər olsun (geriyə uyğunluq)              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.sync_provider_wallet_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.balance is distinct from old.balance then
    update public.provider_wallets
       set balance    = new.balance,
           updated_at = now()
     where provider_id = new.id;
    if not found then
      insert into public.provider_wallets (provider_id, balance)
      values (new.id, new.balance)
      on conflict (provider_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_provider_wallet_balance on public.profiles;
create trigger trg_sync_provider_wallet_balance
  after update of balance on public.profiles
  for each row execute function public.sync_provider_wallet_balance();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. convert_bonus_to_balance — komissiya tətbiq et                        ║
-- ║   Köhnə versiya numeric qaytarırdı; DROP edib jsonb-ə keçirik           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop function if exists public.convert_bonus_to_balance(numeric);

create or replace function public.convert_bonus_to_balance(
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_new_bonus      numeric;
  v_new_balance    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_credited_amt   numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Komissiya faizi platform_config-dən
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_bonus_convert';

  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);
  v_credited_amt   := p_amount - v_commission_amt;

  -- 1. provider_wallets.bonus_balance-dan çıx (atomic)
  update public.provider_wallets
     set bonus_balance = bonus_balance - p_amount
   where provider_id = v_user_id
     and coalesce(bonus_balance, 0) >= p_amount
   returning bonus_balance into v_new_bonus;

  if v_new_bonus is null then
    raise exception 'Insufficient bonus balance';
  end if;

  -- 2. profiles.balance-ə net məbləği əlavə et
  update public.profiles
     set balance = coalesce(balance, 0) + v_credited_amt
   where id = v_user_id
   returning balance into v_new_balance;

  -- 3. Konvertasiya transaksiyası
  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'bonus_convert', v_credited_amt, v_new_balance,
     'Bonus → Balans (komissiya: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     null, v_user_id);

  -- 4. Platform komissiyası (varsa)
  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_user_id, 'platform_revenue', v_commission_amt, 0,
       'Bonus konvertasiya komissiyası (' || v_commission_pct || '%)',
       null, v_user_id);
  end if;

  -- 5. Bonus log
  begin
    insert into public.provider_bonus_logs
      (provider_id, amount, type, source, created_at, reason)
    values
      (v_user_id, p_amount, 'conversion', 'bonus_to_main_balance',
       now(),
       'Bonus əsas balansa çevrildi (komissiya: '
         || v_commission_pct || '%, net: ' || v_credited_amt || ' ₼)');
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'amount_requested', p_amount,
    'commission_pct', v_commission_pct,
    'commission_amt', v_commission_amt,
    'credited', v_credited_amt,
    'new_balance', v_new_balance
  );
end;
$$;

revoke execute on function public.convert_bonus_to_balance(numeric) from public, anon;
grant   execute on function public.convert_bonus_to_balance(numeric) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. release_offer_to_provider — profiles.balance-ə yaz                    ║
-- ║    (provider_wallets.balance trigger ilə sinxron qalır)                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.release_offer_to_provider(p_offer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_provider_id    uuid;
  v_opp_creator    uuid;
  v_opp_id         uuid;
  v_method         text;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.created_by, oo.payment_method, op.id
    into v_provider_id, v_opp_creator, v_method, v_opp_id
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_opp_creator <> v_caller then
    raise exception 'Only customer can complete the offer';
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
    return 0;
  end if;

  -- Card axını
  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found for offer'; end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt    := v_locked_amt - v_commission_amt;

  -- Escrow-dan provayder profilinə (vahid balans mənbəyi)
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
     'İş tamamlandı, escrow → balans (tamamlama komissiyası: '
       || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, v_caller);

  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values (
      v_provider_id, 'platform_revenue', v_commission_amt, 0,
      'Tamamlama komissiyası (' || v_commission_pct || '%, offer '
        || left(p_offer_id::text, 8) || ')',
      p_offer_id::text, v_caller
    );
  end if;

  return v_release_amt;
end;
$$;

revoke execute on function public.release_offer_to_provider(uuid) from public, anon;
grant   execute on function public.release_offer_to_provider(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. request_withdrawal — yalnız profiles.balance                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.request_withdrawal(
  p_amount    numeric,
  p_bank_card text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_min            numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_net_amt        numeric;
  v_balance_after  numeric;
  v_id             uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_bank_card is null or length(trim(p_bank_card)) < 8 then
    raise exception 'Bank card / IBAN required';
  end if;

  select coalesce((value)::text::numeric, 0) into v_min
    from public.platform_config where key = 'min_withdrawal_amount';
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_withdrawal';

  if v_min > 0 and p_amount < v_min then
    raise exception 'Minimum withdrawal amount: % ₼', v_min;
  end if;

  -- Tək mənbə: profiles.balance
  update public.profiles
     set balance = balance - p_amount
   where id = v_user_id
     and coalesce(balance, 0) >= p_amount
   returning balance into v_balance_after;

  if v_balance_after is null then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);
  v_net_amt        := p_amount - v_commission_amt;

  insert into public.withdrawals
    (provider_id, amount_requested, commission_percent, commission_amount,
     net_amount, bank_card)
  values
    (v_user_id, p_amount, v_commission_pct, v_commission_amt, v_net_amt,
     p_bank_card)
  returning id into v_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'withdrawal', -p_amount, v_balance_after,
     'Nağdlaşdırma sorğusu (komissiya: ' || v_commission_pct
       || '%, ' || v_commission_amt || ' ₼ → net: ' || v_net_amt || ' ₼)',
     v_id::text, v_user_id);

  -- Komissiya platform_revenue
  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_user_id, 'platform_revenue', v_commission_amt, 0,
       'Nağdlaşdırma komissiyası (' || v_commission_pct || '%)',
       v_id::text, v_user_id);
  end if;

  return v_id;
end;
$$;

revoke execute on function public.request_withdrawal(numeric, text) from public, anon;
grant   execute on function public.request_withdrawal(numeric, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. admin_process_withdrawal refund → profiles.balance                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_process_withdrawal(
  p_id           uuid,
  p_status       text,
  p_admin_notes  text default null,
  p_external_id  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_wd          record;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;
  if p_status not in ('processed','rejected') then
    raise exception 'Invalid status (must be processed or rejected)';
  end if;

  select * into v_wd from public.withdrawals where id = p_id;
  if v_wd.id is null then raise exception 'Withdrawal not found'; end if;
  if v_wd.status <> 'pending' then
    raise exception 'Withdrawal already %', v_wd.status;
  end if;

  if p_status = 'rejected' then
    update public.profiles
       set balance = coalesce(balance, 0) + v_wd.amount_requested
     where id = v_wd.provider_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_wd.provider_id, 'refund', v_wd.amount_requested, 0,
       'Nağdlaşdırma rədd edildi: ' || coalesce(p_admin_notes,'—'),
       v_wd.id::text, auth.uid());
  end if;

  update public.withdrawals
     set status       = p_status,
         admin_notes  = coalesce(p_admin_notes, admin_notes),
         external_id  = coalesce(p_external_id, external_id),
         processed_at = now()
   where id = p_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (auth.uid(), 'withdrawal_' || p_status, 'withdrawal', p_id::text,
            jsonb_build_object('amount', v_wd.amount_requested,
                               'net', v_wd.net_amount, 'notes', p_admin_notes,
                               'external_id', p_external_id));
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_process_withdrawal(uuid, text, text, text) from public, anon;
grant   execute on function public.admin_process_withdrawal(uuid, text, text, text) to authenticated;


notify pgrst, 'reload schema';
