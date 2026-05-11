-- ============================================================================
-- Commission validation fix
--
-- 1. admin_update_commission:
--    - 0 dəyəri açıq şəkildə icazəlidir
--    - min_withdrawal_amount üçün 100 üst limit yoxdur (AZN-dir, 1000 ola bilər)
--    - Yalnız % field-ləri 0..100 ilə məhdudlaşır
-- ============================================================================

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
    'min_withdrawal_amount'
  ) then
    raise exception 'Invalid config key: %', p_key;
  end if;

  if p_value is null then
    raise exception 'Value cannot be null';
  end if;
  if p_value < 0 then
    raise exception 'Value must be >= 0';
  end if;

  -- Faiz field-ləri 0..100 ilə məhdudlaşır
  if p_key in ('commission_on_accept','commission_on_complete','commission_on_withdrawal')
     and p_value > 100 then
    raise exception 'Percentage must be between 0 and 100';
  end if;

  -- min_withdrawal_amount AZN-dir, 100+ ola bilər (məs. 500 ₼)
  if p_key = 'min_withdrawal_amount' and p_value > 1000000 then
    raise exception 'Min withdrawal amount unrealistic';
  end if;

  update public.platform_config
     set value      = to_jsonb(p_value),
         updated_at = now()
   where key = p_key;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (auth.uid(), 'commission_update', 'config', null,
            jsonb_build_object('key', p_key, 'value', p_value));
  exception when others then
    null; -- audit fail-ı bloklamasın
  end;
end;
$$;

revoke execute on function public.admin_update_commission(text, numeric) from public, anon;
grant   execute on function public.admin_update_commission(text, numeric) to authenticated;

notify pgrst, 'reload schema';
