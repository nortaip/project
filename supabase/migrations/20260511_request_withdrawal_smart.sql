-- ============================================================================
-- request_withdrawal-ı smart et: provider rolu üçün provider_wallets.balance,
-- digər rollar (customer və s.) üçün profiles.balance-dan debitlə.
--
-- Problem: əvvəl yalnız provider_wallets-i yoxlayırdı → customer-lər
-- nağdlaşdıra bilmirdi, hətta admin onlara balans kredit etsə də.
-- ============================================================================

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
  v_role           text;
  v_min            numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_net_amt        numeric;
  v_balance_after  numeric;
  v_id             uuid;
  v_use_provider_wallet boolean;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_bank_card is null or length(trim(p_bank_card)) < 8 then
    raise exception 'Bank card / IBAN required';
  end if;

  select (value)::text::numeric into v_min
    from public.platform_config where key = 'min_withdrawal_amount';
  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_withdrawal';

  if v_min is not null and p_amount < v_min then
    raise exception 'Minimum withdrawal amount: % ₼', v_min;
  end if;

  -- Hansı balansı debit edəcəyik?
  -- Provider üçün: provider_wallets.balance (jobs-dan qazanılan)
  -- Digər rollar üçün: profiles.balance
  select lower(coalesce(role,'')) into v_role from public.profiles where id = v_user_id;
  v_use_provider_wallet := v_role in ('provider','pro','seller');

  if v_use_provider_wallet then
    -- Atomik balance debit (provider_wallets)
    update public.provider_wallets
       set balance    = balance - p_amount,
           updated_at = now()
     where provider_id = v_user_id
       and coalesce(balance, 0) >= p_amount
     returning balance into v_balance_after;

    if v_balance_after is null then
      raise exception 'Insufficient balance (provider wallet)';
    end if;
  else
    -- Customer və digər rollar — profiles.balance
    update public.profiles
       set balance = balance - p_amount
     where id = v_user_id
       and coalesce(balance, 0) >= p_amount
     returning balance into v_balance_after;

    if v_balance_after is null then
      raise exception 'Insufficient balance (profile)';
    end if;
  end if;

  v_commission_amt := round(p_amount * coalesce(v_commission_pct,0) / 100, 2);
  v_net_amt        := p_amount - v_commission_amt;

  insert into public.withdrawals
    (provider_id, amount_requested, commission_percent, commission_amount, net_amount, bank_card)
  values
    (v_user_id, p_amount, coalesce(v_commission_pct,0), v_commission_amt, v_net_amt, p_bank_card)
  returning id into v_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'withdrawal', -p_amount, v_balance_after,
     'Nağdlaşdırma sorğusu (komissiya: ' || coalesce(v_commission_pct,0)
       || '%, ' || v_commission_amt || ' ₼ → net: ' || v_net_amt || ' ₼)',
     v_id::text, v_user_id);

  return v_id;
end;
$$;

revoke execute on function public.request_withdrawal(numeric, text) from public, anon;
grant   execute on function public.request_withdrawal(numeric, text) to authenticated;

-- Eyni şəkildə, admin_process_withdrawal-da rejection refund-u da düzgün
-- yerə qaytarmalıdır. Yenidən yazırıq.
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
  v_target_role text;
  v_use_provider_wallet boolean;
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
    -- Refund: hansı balansa yazılmalıdırsa oradan qaytar
    select lower(coalesce(role,'')) into v_target_role
      from public.profiles where id = v_wd.provider_id;
    v_use_provider_wallet := v_target_role in ('provider','pro','seller');

    if v_use_provider_wallet then
      update public.provider_wallets
         set balance    = coalesce(balance, 0) + v_wd.amount_requested,
             updated_at = now()
       where provider_id = v_wd.provider_id;
    else
      update public.profiles
         set balance = coalesce(balance, 0) + v_wd.amount_requested
       where id = v_wd.provider_id;
    end if;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_wd.provider_id, 'refund', v_wd.amount_requested,
       0,  -- balance_after-i tam hesabla bilmirik burada
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
    values (
      auth.uid(),
      'withdrawal_' || p_status,
      'withdrawal',
      p_id::text,
      jsonb_build_object(
        'amount', v_wd.amount_requested,
        'net', v_wd.net_amount,
        'notes', p_admin_notes,
        'external_id', p_external_id
      )
    );
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_process_withdrawal(uuid, text, text, text) from public, anon;
grant   execute on function public.admin_process_withdrawal(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
