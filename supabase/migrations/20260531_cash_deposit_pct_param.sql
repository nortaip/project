-- ============================================================================
-- Qarantili nağd ödəniş üçün depozit faizi parametri
-- ============================================================================
-- Yeni platform_config key: `cash_deposit_pct` (default 20%)
-- Admin paneldən dəyişdirilə bilər. 0% qoysa qaranti yoxdur.

insert into public.platform_config (key, value, description)
values (
  'cash_deposit_pct',
  '20'::jsonb,
  'Qarantili nağd ödənişdə müştərinin balansından müvəqqəti tutulan qaranti faizi (%). İş tamamlandıqda geri qayıdır.'
)
on conflict (key) do nothing;

-- admin_update_commission RPC açar siyahısına yeni key əlavə et
create or replace function public.admin_update_commission(
  p_key   text,
  p_value numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_key not in (
    'commission_on_accept',
    'commission_on_complete',
    'commission_on_withdrawal',
    'min_withdrawal_amount',
    'commission_customer_service_fee',
    'cash_deposit_pct'
  ) then
    raise exception 'Invalid config key: %', p_key;
  end if;

  if p_value is null then
    raise exception 'Value cannot be null';
  end if;
  if p_value < 0 then
    raise exception 'Value must be >= 0';
  end if;

  if p_key in (
    'commission_on_accept',
    'commission_on_complete',
    'commission_on_withdrawal',
    'commission_customer_service_fee',
    'cash_deposit_pct'
  ) and p_value > 100 then
    raise exception 'Percentage value must be <= 100';
  end if;

  insert into public.platform_config (key, value, description)
  values (p_key, to_jsonb(p_value), null)
  on conflict (key)
  do update set value = excluded.value, updated_at = now();
end;
$$;

revoke execute on function public.admin_update_commission(text, numeric) from public, anon;
grant   execute on function public.admin_update_commission(text, numeric) to authenticated;

notify pgrst, 'reload schema';
