-- Təklifdə gəliş tarixi + kateqoriyaya görə qiymət vahidi + təklif sahələrinin qorunması.
--
-- * service_categories.price_unit: admin hər kateqoriya üçün seçir —
--     fixed (bütün iş üçün qiymət), m2 (kvadrat metr başı), hour (saatlıq).
-- * opportunities_offers:
--     proposed_at — usta gələcəyi gün/vaxt ("20-si gələcəm"); müştəri buna
--                   baxıb qəbul və ya rədd edir. Usta aktiv işi bitməsə də
--                   gələcək tarixə sifariş götürə bilir.
--     price_unit, unit_price, quantity — "15 ₼/m² × 40 m²"; offer_amount
--                   həmişə ümumi məbləğdir (= unit_price × quantity), pul
--                   axını (escrow, komissiya) onu işlədir.
-- * ellit_guard_offer_columns: /rest/v1 ilə təklifin məbləği, tərəfləri və
--   ödəniş sahələri dəyişdirilə bilməz (əvvəl müştəri məbləği endirib sonra
--   qəbul edə, usta öz təklifini "accepted" edə bilərdi). İcazəli keçidlər:
--   müştəri: pending→rejected, pending|accepted→cancelled, accepted→completed;
--   usta: pending→cancelled (təklifi geri götürmək), gözləmədə olan təklifin
--   tarixini/qeydini dəyişmək, tamamlanma sübutu, payout_status→pending_review.
--   Admin hər şeyi dəyişə bilər. Server (RPC) yolları qorumaya düşmür.

alter table public.service_categories
  add column if not exists price_unit text not null default 'fixed';
alter table public.service_categories
  drop constraint if exists service_categories_price_unit_check;
alter table public.service_categories
  add constraint service_categories_price_unit_check
  check (price_unit in ('fixed', 'm2', 'hour'));

alter table public.opportunities_offers
  add column if not exists proposed_at timestamptz,
  add column if not exists price_unit text,
  add column if not exists unit_price numeric(12,2),
  add column if not exists quantity numeric(12,2);
alter table public.opportunities_offers
  drop constraint if exists opportunities_offers_price_unit_check;
alter table public.opportunities_offers
  add constraint opportunities_offers_price_unit_check
  check (price_unit is null or price_unit in ('fixed', 'm2', 'hour'));

create index if not exists opportunities_offers_provider_proposed_idx
  on public.opportunities_offers (provider_id, proposed_at)
  where status in ('pending', 'accepted');

create or replace function public.ellit_guard_offer_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_provider boolean;
  v_owner    boolean;
begin
  if not public.ellit_via_rest() or public.is_admin_user() then
    return new;
  end if;

  if row(new.opportunity_id, new.provider_id, new.offer_amount, new.price_unit,
         new.unit_price, new.quantity, new.paid_at, new.payment_id, new.payment_method,
         new.brigade_id, new.escrow_released_at, new.cash_deposit_amount,
         new.admin_approved_at, new.admin_approved_by, new.created_at)
     is distinct from
     row(old.opportunity_id, old.provider_id, old.offer_amount, old.price_unit,
         old.unit_price, old.quantity, old.paid_at, old.payment_id, old.payment_method,
         old.brigade_id, old.escrow_released_at, old.cash_deposit_amount,
         old.admin_approved_at, old.admin_approved_by, old.created_at) then
    raise exception 'OFFER_FIELD_LOCKED: təklifin məbləği və ödəniş sahələri dəyişdirilə bilməz'
      using errcode = '42501';
  end if;

  v_provider := v_uid is not null and v_uid = old.provider_id;
  v_owner := public._is_opportunity_owner(old.opportunity_id);

  if (new.proposed_at is distinct from old.proposed_at or new.notes is distinct from old.notes)
     and not (v_provider and old.status = 'pending') then
    raise exception 'OFFER_FIELD_LOCKED: tarixi yalnız usta, təklif qəbul olunmamış dəyişə bilər'
      using errcode = '42501';
  end if;

  if (new.completion_photos is distinct from old.completion_photos
      or new.customer_signature_url is distinct from old.customer_signature_url)
     and not v_provider then
    raise exception 'OFFER_FIELD_LOCKED: tamamlanma sübutunu yalnız usta göndərir'
      using errcode = '42501';
  end if;

  if new.payout_status is distinct from old.payout_status
     and not (v_provider and new.payout_status = 'pending_review'
              and coalesce(old.status, '') in ('accepted', 'completed')) then
    raise exception 'OFFER_FIELD_LOCKED: ödəniş statusunu yalnız admin dəyişə bilər'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (v_owner and ((old.status = 'pending' and new.status = 'rejected')
                 or (old.status in ('pending', 'accepted') and new.status = 'cancelled')
                 or (old.status = 'accepted' and new.status = 'completed')))
      or (v_provider and old.status = 'pending' and new.status = 'cancelled')
    ) then
      -- İcazəsiz keçid səssizcə dəyişmir: toplu yeniləmələr (məs. sifarişin
      -- bütün təklifləri) pozulmasın, amma heç kim özünü "qəbul" edə bilməsin
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ellit_guard_offer_columns on public.opportunities_offers;
create trigger ellit_guard_offer_columns before update on public.opportunities_offers
  for each row execute function public.ellit_guard_offer_columns();
