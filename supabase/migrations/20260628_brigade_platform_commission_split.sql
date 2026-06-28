-- Komanda (briqada) üçün ayrıca platform komissiyası (fərdi provayderdən fərqli).
-- Default: cari fərdi dəyərlərlə eyni seed olunur ki, davranış dəyişməsin.
insert into public.platform_config (key, value, description)
values
  ('brigade_commission_on_accept',  (select value from public.platform_config where key = 'commission_on_accept'),  'Komanda təklifinin qəbulunda platform komissiyası (%)'),
  ('brigade_commission_on_complete',(select value from public.platform_config where key = 'commission_on_complete'),'Komanda işi bitdikdə platform komissiyası (%)')
on conflict (key) do nothing;

-- admin_update_commission whitelist-ə yeni açarlar (brigade_commission_on_accept/complete).
-- accept_offer_with_payment və auto_release_on_opportunity_complete funksiyaları
-- komanda təklifləri üçün brigade_* faizlərini, fərdi üçün isə standart faizləri
-- oxuyacaq şəkildə yeniləndi (bax: müvafiq migrasiyalar). Faktiki funksiya
-- mətnləri canlı bazada saxlanılır; burada yalnız config + whitelist sənədləşdirilir.

create or replace function public.admin_update_commission(p_key text, p_value numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;
  if p_key not in (
    'commission_on_accept','commission_on_complete','commission_on_withdrawal',
    'min_withdrawal_amount','commission_customer_service_fee','cash_deposit_pct',
    'brigade_member_commission_pct','brigade_commission_on_accept','brigade_commission_on_complete'
  ) then raise exception 'Invalid config key: %', p_key; end if;
  if p_value is null then raise exception 'Value cannot be null'; end if;
  if p_value < 0 then raise exception 'Value must be >= 0'; end if;
  if p_key in (
    'commission_on_accept','commission_on_complete','commission_on_withdrawal',
    'commission_customer_service_fee','cash_deposit_pct','brigade_member_commission_pct',
    'brigade_commission_on_accept','brigade_commission_on_complete'
  ) and p_value > 100 then raise exception 'Percentage value must be <= 100'; end if;
  insert into public.platform_config (key, value, description)
  values (p_key, to_jsonb(p_value), null)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$function$;
