-- ============================================================================
-- 1) Status keçidlərini yumşalt — "bitir" zamanı INVALID_STATUS_TRANSITION
--    accepted / i-am-here / ongoing / pending_review → completed olur
-- 2) Promo endirimi NAĞD ödənişdə də tətbiq olunur (əvvəl yalnız kart);
--    nağdda endirim öncədən tutulan məbləği (depozit + servis haqqı) azaldır.
-- (Tam funksiya mətni canlı DB-də apply_migration ilə tətbiq olunub —
--  bax: accept_offer_with_payment + validate_opportunity_status.)
-- ============================================================================
create or replace function public.validate_opportunity_status()
returns trigger language plpgsql as $$
declare v_allowed boolean;
begin
  if new.status = old.status then return new; end if;
  v_allowed := case
    when old.status in ('pending','open','new') and new.status in ('accepted','cancelled') then true
    when old.status = 'accepted'      and new.status in ('i-am-here','ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'i-am-here'     and new.status in ('ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'ongoing'       and new.status in ('pending_review','completed','cancelled','refunded') then true
    when old.status = 'pending_review' and new.status in ('completed','rejected','refunded') then true
    when old.status = 'completed'     and new.status in ('disputed','refunded') then true
    when old.status = 'disputed'      and new.status in ('completed','refunded') then true
    else false
  end;
  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: % -> % (opportunity %)', old.status, new.status, old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- accept_offer_with_payment: promo-nun nağda da tətbiqi üçün yenidən təyin
-- edilib (tam mətn canlı miqrasiyada). Burada qeyd kimi saxlanılır.
notify pgrst, 'reload schema';
