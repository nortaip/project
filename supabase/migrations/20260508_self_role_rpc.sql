-- ============================================================================
-- Migration: set_self_role RPC + admin balance helpers
--
-- Pentest-də aşkar olundu (C4): client-side `update profiles set role/balance`
-- yazıları var. Hardening migration UPDATE privilege-ı revoke edib amma:
--   - rol dəyişməsi qanuni biznes axındır (customer ↔ provider)
--   - bonus → balance konvertasiyası mövcud RPC-yə uyğunlaşdırılmalıdır
--
-- Bu migration:
-- 1. set_self_role(new_role) — istifadəçi yalnız özünü customer ↔ provider
--    arasında dəyişə bilər. Admin rolu YALNIZ admin_set_user_role ilə təyin
--    olunur.
-- 2. admin_credit_balance(target_user_id, amount, reason) — admin-lər manual
--    balans əlavəsi üçün
-- 3. admin_credit_bonus(target_user_id, amount, reason) — bonus üçün
-- ============================================================================

-- ── 1. set_self_role ────────────────────────────────────────────────────
create or replace function public.set_self_role(p_new_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_current text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_role not in ('customer', 'provider') then
    raise exception 'Invalid role: % (only customer/provider allowed via self-service)', p_new_role;
  end if;

  select role into v_current from public.profiles where id = v_uid;

  -- Admin/master öz rolunu downgrade edə bilməz — qaqalmayan superadmin riski
  if lower(coalesce(v_current,'')) in ('admin','master','superadmin') then
    raise exception 'Forbidden: admin role cannot be changed via self-service';
  end if;

  update public.profiles
     set role = p_new_role,
         updated_at = now()
   where id = v_uid;

  -- Audit
  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (
    v_uid, 'self_role_change', 'profile', v_uid,
    jsonb_build_object('from', v_current, 'to', p_new_role)
  );

  return p_new_role;
end;
$$;

revoke execute on function public.set_self_role(text) from public, anon;
grant   execute on function public.set_self_role(text) to authenticated;


-- ── 2. admin_credit_balance ─────────────────────────────────────────────
create or replace function public.admin_credit_balance(
  p_target_user_id uuid,
  p_amount         numeric,
  p_reason         text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_balance numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;

  update public.profiles
     set balance = coalesce(balance,0) + p_amount
   where id = p_target_user_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User not found';
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (p_target_user_id,
     case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
     p_amount, v_new_balance,
     coalesce(p_reason, 'Admin manual adjustment'),
     auth.uid());

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (auth.uid(), 'admin_balance_adjust', 'profile', p_target_user_id,
          jsonb_build_object('amount', p_amount, 'reason', p_reason, 'new_balance', v_new_balance));

  return v_new_balance;
end;
$$;

revoke execute on function public.admin_credit_balance(uuid, numeric, text) from public, anon;
grant   execute on function public.admin_credit_balance(uuid, numeric, text) to authenticated;


-- ── 3. admin_credit_bonus ───────────────────────────────────────────────
create or replace function public.admin_credit_bonus(
  p_target_user_id uuid,
  p_amount         numeric,
  p_reason         text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_bonus   numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;

  -- provider_wallets row-u yoxdursa yarat
  insert into public.provider_wallets (provider_id, bonus_balance)
  values (p_target_user_id, p_amount)
  on conflict (provider_id) do update
    set bonus_balance = coalesce(public.provider_wallets.bonus_balance,0) + p_amount
  returning bonus_balance into v_new_bonus;

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (auth.uid(), 'admin_bonus_adjust', 'wallet', p_target_user_id,
          jsonb_build_object('amount', p_amount, 'reason', p_reason, 'new_bonus', v_new_bonus));

  return v_new_bonus;
end;
$$;

revoke execute on function public.admin_credit_bonus(uuid, numeric, text) from public, anon;
grant   execute on function public.admin_credit_bonus(uuid, numeric, text) to authenticated;
