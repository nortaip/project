-- ============================================================================
-- Fix: convert_bonus_to_balance + admin_credit_bonus
--
-- İki problem həll olunur:
-- 1. convert_bonus_to_balance funksiyası `profiles.bonus_balance`-ı yoxlayırdı,
--    amma bonus əslində `provider_wallets.bonus_balance`-da saxlanılır.
-- 2. admin_credit_bonus(...) yalnız `provider_wallets`-ə yazır — convert
--    funksiyası eyni mənbədən oxumalıdır.
--
-- Yeni davranış:
--   - Bonus mənbəyi: provider_wallets.bonus_balance
--   - Hədəf: profiles.balance
--   - Atomik: tək UPDATE-də həm bonus çıxır, həm balans artır (ya da fail)
-- ============================================================================

create or replace function public.convert_bonus_to_balance(
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_new_bonus      numeric;
  v_new_balance    numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- 1. provider_wallets.bonus_balance-dan çıx (atomic check)
  update public.provider_wallets
     set bonus_balance = bonus_balance - p_amount
   where provider_id = v_user_id
     and coalesce(bonus_balance, 0) >= p_amount
   returning bonus_balance into v_new_bonus;

  if v_new_bonus is null then
    raise exception 'Insufficient bonus balance';
  end if;

  -- 2. profiles.balance-a əlavə et
  update public.profiles
     set balance = coalesce(balance, 0) + p_amount,
         updated_at = now()
   where id = v_user_id
   returning balance into v_new_balance;

  -- 3. Audit transaction
  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (v_user_id, 'bonus_convert', p_amount, v_new_balance, 'Bonus → Balance', v_user_id);

  -- 4. Bonus log (UI tarixçə üçün)
  insert into public.provider_bonus_logs
    (provider_id, amount, type, source, created_at, reason)
  values
    (v_user_id, p_amount, 'conversion', 'bonus_to_main_balance',
     now(), 'Bonus əsas balansa çevrildi');

  return v_new_balance;
end;
$$;

revoke execute on function public.convert_bonus_to_balance(numeric) from public, anon;
grant   execute on function public.convert_bonus_to_balance(numeric) to authenticated;

-- PostgREST schema cache-i refresh et ki, function dərhal görünsün
notify pgrst, 'reload schema';
