-- ============================================================================
-- Admin tərəfindən nağdlaşdırma sorğularının emalı
--
-- - admin_process_withdrawal:
--     status='processed' → withdrawal completed, audit log
--     status='rejected'  → provider-ə balans qaytarılır (refund)
-- - withdrawals cədvəlinə `external_id` (Epoint payout transaction id) əlavə
-- ============================================================================

alter table public.withdrawals
  add column if not exists external_id text;

-- Provayderin Epoint-də qeydiyyatdan keçirdiyi kartın card_uid-i. Bu olmadan
-- Epoint execute-pay payout çağırışı edə bilmərik.
alter table public.profiles
  add column if not exists epoint_card_uid text;
alter table public.profiles
  add column if not exists epoint_card_mask text;

create or replace function public.admin_process_withdrawal(
  p_id           uuid,
  p_status       text,     -- 'processed' | 'rejected'
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
    -- Refund: provider-in balansını geri qaytar (tam tələb edilən məbləğ)
    update public.provider_wallets
       set balance    = coalesce(balance, 0) + v_wd.amount_requested,
           updated_at = now()
     where provider_id = v_wd.provider_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    select v_wd.provider_id, 'refund', v_wd.amount_requested,
           pw.balance,
           'Nağdlaşdırma sorğusu rədd edildi: ' || coalesce(p_admin_notes,'—'),
           v_wd.id::text, auth.uid()
      from public.provider_wallets pw
     where pw.provider_id = v_wd.provider_id;
  end if;

  update public.withdrawals
     set status       = p_status,
         admin_notes  = coalesce(p_admin_notes, admin_notes),
         external_id  = coalesce(p_external_id, external_id),
         processed_at = now()
   where id = p_id;

  -- Audit
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

-- Admin RLS: bütün withdrawal-ları görsün
drop policy if exists "admins read all withdrawals" on public.withdrawals;
create policy "admins read all withdrawals"
  on public.withdrawals for select to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = auth.uid()
         and lower(coalesce(role,'')) in ('admin','master','superadmin')
    )
  );

notify pgrst, 'reload schema';
