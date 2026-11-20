-- Müştərinin "İş bitdi" təsdiqi + rəylər.
--
-- 0) Müştəri sifarişi 'pending_review'-ə keçirəndə ellit_sync_payout_on_review
--    trigger-i qəbul olunmuş təklifin payout_status-unu 'pending_review' edir.
--    0008-dəki ellit_guard_offer_columns isə bu yeniləməni müştərinin öz
--    dəyişikliyi sayıb rədd edirdi ("ödəniş statusunu yalnız admin dəyişə
--    bilər") — mobildə müştərinin "İş bitdi" düyməsi serverdə alınmırdı.
--    İndi: boş payout_status → 'pending_review' keçidinə sifariş həqiqətən
--    admin yoxlamasında olanda sifariş sahibinə də icazə var (başqa heç nə).
--
-- 1) Mobil tətbiqdə müştəri "İş bitdi" deyəndə sifariş birbaşa tamamlanmır,
--    admin yoxlamasına düşür (opportunities.status = 'pending_review'), təklif
--    isə 'accepted' qalır. Köhnə qayda yalnız 'completed' işə rəy icazə verirdi
--    — müştəri rəy formasını görüb göndərəndə "Rəy göndərilmədi" alırdı.
--    İndi: tamamlanmış iş VƏ ya müştərinin bitmiş kimi təsdiqlədiyi (admin
--    yoxlamasındakı) işin qəbul olunmuş təklifi. Saxta rəyə qarşı qoruma eyni
--    qalır: yalnız həmin sifarişin sahibi, yalnız həmin təklifin ustasına,
--    bir işə bir rəy (provider_reviews_offer_uniq).
-- 2) Mobil rəyi /rest/v1 ilə yazır — ustaya "Yeni rəy" bildirişi yalnız
--    /opportunities/{id}/review endpoint-ində yaranırdı. Trigger yalnız REST
--    yazılarında işləyir (notify_triggers.sql-dəki kimi), ikiqat olmur.

-- 0) Təklif sahələrinin mühafizəsi (0008-dən; sifariş sahibi üçün yuxarıdakı qayda əlavə olunub)
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
              and coalesce(old.status, '') in ('accepted', 'completed'))
     and not (v_owner and new.payout_status = 'pending_review'
              and old.payout_status is null
              and coalesce(old.status, '') in ('accepted', 'completed')
              and exists (select 1 from public.opportunities op
                           where op.id = old.opportunity_id
                             and op.status = 'pending_review'
                             and op.accepted_offer_id = old.id)) then
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

drop policy if exists ellit_reviews_insert on public.provider_reviews;
create policy ellit_reviews_insert on public.provider_reviews for insert to authenticated
  with check (
    public.is_admin_user() or exists (
      select 1 from public.opportunities_offers oo
        join public.opportunities op on op.id = oo.opportunity_id
       where oo.id = offer_id and oo.provider_id = provider_reviews.provider_id
         and op.created_by = auth.uid()
         and (oo.status = 'completed' or op.status = 'completed'
              or (op.status = 'pending_review'
                  and (op.accepted_offer_id = oo.id or oo.status = 'accepted')))));

create or replace function public.ellit_n_new_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opp   uuid;
  v_title text;
begin
  if not public.ellit_via_rest() or new.provider_id is null then
    return new;
  end if;
  select oo.opportunity_id, op.title into v_opp, v_title
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = new.offer_id;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  values (new.provider_id, 'new_review', 'new_review', 'Yeni rəy aldınız ⭐',
          'Müştəri ' || coalesce(new.rating::text, '—') || '/5 qiymət verdi'
            || case when v_title is null then '' else ' — ' || v_title end,
          coalesce(v_opp::text, new.offer_id::text), '/provider/reviews');
  return new;
end $$;

drop trigger if exists ellit_n_new_review on public.provider_reviews;
create trigger ellit_n_new_review after insert on public.provider_reviews
  for each row execute function public.ellit_n_new_review();
