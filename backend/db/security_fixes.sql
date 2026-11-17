-- Təhlükəsizlik yoxlamasının (pentest) düzəlişləri.
--
-- db/rls.sql canlı Supabase siyasətlərini olduğu kimi köçürüb, üstündən sərt
-- `ellit_*` siyasətləri əlavə edib. Amma PostgreSQL icazəli (permissive)
-- siyasətləri OR ilə birləşdirir: köhnə `with check (true)` siyasəti qalanda
-- sərt yoxlama heç nə etmir. Aşağıdakılar belə köhnə siyasətlərdir:
--   * provider_reviews: istənilən istifadəçi istənilən ustaya saxta rəy yazıb
--     reytinqini dəyişə bilirdi;
--   * services: giriş etməmiş biri başqa ustanın adına elan yarada bilirdi;
--   * provider_wallets: "hər kəs silə bilər" siyasəti (DELETE icazəsi
--     verilmədiyi üçün işləmirdi, amma qalmamalıdır).

drop policy if exists "Allow authenticated users to create reviews" on public.provider_reviews;
drop policy if exists "Allow all users to insert services" on public.services;
drop policy if exists "Allow authenticated users to insert services" on public.services;
drop policy if exists "Enable delete for users based on user_id" on public.provider_wallets;

revoke insert on public.services from anon;
revoke insert, update, delete on public.provider_reviews from anon;

-- Rəy: yalnız TAMAMLANMIŞ işin müştərisi yaza bilər, bir iş üçün bir rəy
drop policy if exists ellit_reviews_insert on public.provider_reviews;
create policy ellit_reviews_insert on public.provider_reviews for insert to authenticated
  with check (
    public.is_admin_user() or exists (
      select 1 from public.opportunities_offers oo
        join public.opportunities op on op.id = oo.opportunity_id
       where oo.id = offer_id and oo.provider_id = provider_reviews.provider_id
         and op.created_by = auth.uid()
         and (oo.status = 'completed' or op.status = 'completed')));
create unique index if not exists provider_reviews_offer_uniq
  on public.provider_reviews (offer_id) where offer_id is not null;

-- Elan: klient yaradanda sahibi həmişə özüdür (başqasının adına elan olmur)
create or replace function public.ellit_guard_service_columns() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.provider_id := auth.uid();
    new.promotion_paid := false;
    new.promotion_expires_at := null;
    new.rating := null;
    new.reviews_count := 0;
    new.view_count := 0;
  else
    new.promotion_paid := old.promotion_paid;
    new.promotion_expires_at := old.promotion_expires_at;
    new.rating := old.rating;
    new.reviews_count := old.reviews_count;
    new.provider_id := old.provider_id;
  end if;
  return new;
end $$;
