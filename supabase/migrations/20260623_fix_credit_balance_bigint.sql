-- ============================================================================
-- credit_balance — bigint payment_id düzəlişi
--
-- Problem: payment-webhook `credit_balance(p_user_id, p_amount, p_payment_id,
-- p_reason)` çağırır, amma funksiya canlı DB-də yox idi. Əvvəlki tərif
-- (20260508/20260509 migrasiyaları) `p_payment_id uuid` gözləyirdi, halbuki
-- canlı sxemdə `payments.id` BIGINT-dir. Nəticədə webhook "Could not find the
-- function public.credit_balance(...)" xətası alıb ödənişi `failed` edirdi və
-- balans kreditləşmirdi (məs. payment 188).
--
-- Bu versiya:
--   • p_payment_id bigint qəbul edir
--   • payment id-ni transactions.related_id-yə yazır (payment_id sütunu uuid
--     olduğu üçün ora yazıla bilməz)
--   • idempotentdir (eyni ödəniş üçün ikinci dəfə kreditləmir)
--   • yalnız service_role icra edə bilər
-- ============================================================================

create or replace function public.credit_balance(
  p_user_id uuid,
  p_amount numeric,
  p_payment_id bigint,
  p_reason text default 'top_up'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
  v_already boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select exists(
    select 1 from public.transactions
    where type = 'top_up' and related_id = p_payment_id::text
  ) into v_already;

  if v_already then
    select balance into v_new_balance from public.profiles where id = p_user_id;
    return v_new_balance;
  end if;

  update public.profiles
     set balance = coalesce(balance, 0) + p_amount
   where id = p_user_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, payment_id)
  values
    (p_user_id, 'top_up', p_amount, v_new_balance,
     coalesce(p_reason, 'Balance top-up'), p_payment_id::text, null);

  return v_new_balance;
end$$;

revoke execute on function public.credit_balance(uuid, numeric, bigint, text)
  from public, anon, authenticated;
grant execute on function public.credit_balance(uuid, numeric, bigint, text)
  to service_role;

notify pgrst, 'reload schema';
