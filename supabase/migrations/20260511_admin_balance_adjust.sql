-- ============================================================================
-- admin_adjust_balance — admin tərəfindən hər hansı istifadəçinin balansını
-- manual olaraq artıra/azalda bilər (test üçün, fix üçün, bonus üçün, vs.)
-- ============================================================================

create or replace function public.admin_adjust_balance(
  p_user_id   uuid,
  p_amount    numeric,           -- müsbət = kredit, mənfi = debit
  p_reason    text,
  p_target    text default 'balance'  -- 'balance' | 'bonus' | 'locked'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_role        text;
  v_new         numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount = 0 or p_amount is null then
    raise exception 'Amount cannot be zero / null';
  end if;
  if p_target not in ('balance','bonus','locked') then
    raise exception 'Invalid target (must be balance | bonus | locked)';
  end if;

  -- Target user-in rolunu öyrən (provider üçün provider_wallets, customer üçün profiles)
  select lower(coalesce(role,'')) into v_role from public.profiles where id = p_user_id;
  if v_role is null then raise exception 'User not found'; end if;

  -- Provider rolundakılar üçün provider_wallets istifadə edirik
  if v_role in ('provider','pro','seller') then
    -- wallet sətri yoxsa yarat
    insert into public.provider_wallets (provider_id) values (p_user_id)
    on conflict (provider_id) do nothing;

    if p_target = 'balance' then
      update public.provider_wallets
         set balance = coalesce(balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning balance into v_new;
    elsif p_target = 'bonus' then
      update public.provider_wallets
         set bonus_balance = coalesce(bonus_balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning bonus_balance into v_new;
    else -- locked
      update public.provider_wallets
         set locked_balance = coalesce(locked_balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning locked_balance into v_new;
    end if;
  else
    -- Customer: profiles.balance / bonus_balance istifadə olunur
    if p_target = 'balance' then
      update public.profiles
         set balance = coalesce(balance,0) + p_amount
       where id = p_user_id
       returning balance into v_new;
    elsif p_target = 'bonus' then
      update public.profiles
         set bonus_balance = coalesce(bonus_balance,0) + p_amount
       where id = p_user_id
       returning bonus_balance into v_new;
    else
      raise exception 'locked balance applies only to providers';
    end if;
  end if;

  if v_new is null then raise exception 'Balance update failed'; end if;
  if v_new < 0 then
    raise exception 'Result would be negative balance';
  end if;

  -- transactions log
  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (p_user_id, 'admin_adjust', p_amount, v_new,
     'Admin düzəlişi (' || p_target || '): ' || coalesce(p_reason,'—'),
     auth.uid());

  -- audit log
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      auth.uid(),
      'balance_adjust',
      'user_balance',
      p_user_id::text,
      jsonb_build_object(
        'target', p_target,
        'amount', p_amount,
        'reason', p_reason,
        'new_balance', v_new
      )
    );
  exception when others then null;
  end;

  return v_new;
end;
$$;

revoke execute on function public.admin_adjust_balance(uuid, numeric, text, text) from public, anon;
grant   execute on function public.admin_adjust_balance(uuid, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
