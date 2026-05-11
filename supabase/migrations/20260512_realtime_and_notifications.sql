-- ============================================================================
-- ƏSAS AXIN — REAL-TIME + AVTOMATIK BİLDİRİŞLƏR
--
-- Problem:
--   1. `opportunities` və `opportunities_offers` realtime publication-da YOX idi
--      → mobil və web stream-ləri yeni sətrləri tutmurdu
--   2. Yeni sifariş gələndə provayderə bildiriş yox idi
--   3. Yeni təklif gələndə müştəriyə bildiriş yox idi
--
-- Bu migrasiya:
--   1. Bütün lazımi cədvəlləri supabase_realtime publication-a əlavə edir
--   2. Auto-notify trigger: yeni opportunity yaranda — uyğun kateqoriyalı
--      provayderlərə notification yaradır
--   3. Auto-notify trigger: yeni offer gələndə — opportunity sahibinə
--      notification yaradır
--   4. Offer status dəyişəndə (accepted/rejected) — provayderə notification
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Real-time publication                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  -- opportunities
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='opportunities'
  ) then
    alter publication supabase_realtime add table public.opportunities;
  end if;

  -- opportunities_offers (mobile + web real-time offer updates)
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='opportunities_offers'
  ) then
    alter publication supabase_realtime add table public.opportunities_offers;
  end if;

  -- withdrawals (admin canlı yenilənmə üçün)
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='withdrawals'
  ) then
    alter publication supabase_realtime add table public.withdrawals;
  end if;

  -- provider_wallets (provayder balansı dəyişəndə anında görsün)
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='provider_wallets'
  ) then
    alter publication supabase_realtime add table public.provider_wallets;
  end if;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Defensive: notifications cədvəli mövcudluğu yoxla                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text,
  kind        text default 'info',
  related_id  text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke insert, delete on public.notifications from authenticated, anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. TRIGGER — yeni opportunity → uyğun provayderlərə notification          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.notify_providers_on_new_opportunity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(coalesce(new.status,''));
  v_cat_id text := coalesce(new.category_id::text,'');
  v_subcat_id text := coalesce(new.subcategory_id::text,'');
  v_title text := coalesce(new.title, 'Yeni sifariş');
begin
  -- Yalnız "açıq" status olduqda bildiriş göndər
  if v_status not in ('pending','open','new','') then
    return new;
  end if;

  -- Uyğun provayderlərə (specialty / category match) notification insert
  insert into public.notifications (user_id, title, body, kind, related_id, link)
  select
    p.id,
    'Yeni sifariş: ' || v_title,
    coalesce(new.description, new.location, 'Detallara baxın'),
    'new_opportunity',
    new.id::text,
    '/account/services'  -- web link; mobil app öz routing-ini bilir
  from public.profiles p
  where lower(coalesce(p.role,'')) in ('provider','pro','seller')
    and p.id <> new.created_by
    and (
      -- specialties UUID kimi saxlanır (yeni axın)
      (p.specialties is not null and (
        v_cat_id <> '' and p.specialties @> array[v_cat_id]
        or
        v_subcat_id <> '' and p.specialties @> array[v_subcat_id]
      ))
      -- Heç bir filter yoxsa, hər kəsə xəbər ver
      or coalesce(array_length(p.specialties, 1), 0) = 0
    );

  return new;
end;
$$;

drop trigger if exists trg_notify_providers_new_opp on public.opportunities;
create trigger trg_notify_providers_new_opp
  after insert on public.opportunities
  for each row execute function public.notify_providers_on_new_opportunity();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. TRIGGER — yeni offer → opportunity sahibinə notification               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.notify_customer_on_new_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_provider_name text;
  v_opp_title text;
begin
  -- Yalnız yeni pending offer üçün
  if new.status <> 'pending' then return new; end if;

  select op.created_by, op.title into v_customer_id, v_opp_title
    from public.opportunities op
   where op.id = new.opportunity_id;

  if v_customer_id is null then return new; end if;

  select coalesce(name, 'Provayder') into v_provider_name
    from public.profiles where id = new.provider_id;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    v_customer_id,
    'Yeni təklif: ' || coalesce(v_provider_name,'Provayder'),
    coalesce(v_opp_title,'Sifarişiniz') || ' — ' ||
      coalesce(new.offer_amount::text,'') || ' ₼',
    'new_offer',
    new.id::text,
    '/my-opportunities'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_customer_new_offer on public.opportunities_offers;
create trigger trg_notify_customer_new_offer
  after insert on public.opportunities_offers
  for each row execute function public.notify_customer_on_new_offer();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. TRIGGER — offer status dəyişdi → provayderə notification               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.notify_provider_on_offer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp_title text;
  v_title text;
  v_kind text;
begin
  -- Yalnız status faktiki dəyişəndə
  if new.status = old.status then return new; end if;
  if new.provider_id is null then return new; end if;

  select coalesce(title,'Sifariş') into v_opp_title
    from public.opportunities where id = new.opportunity_id;

  if new.status = 'accepted' then
    v_title := 'Təklifin qəbul edildi!';
    v_kind := 'offer_accepted';
  elsif new.status = 'rejected' then
    v_title := 'Təklifin rədd edildi';
    v_kind := 'offer_rejected';
  elsif new.status = 'completed' then
    v_title := 'İş tamamlandı və ödəniş açıldı';
    v_kind := 'offer_completed';
  else
    return new;
  end if;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    new.provider_id,
    v_title,
    v_opp_title || ' — ' || coalesce(new.offer_amount::text,'') || ' ₼',
    v_kind,
    new.id::text,
    '/account/services'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_provider_offer_status on public.opportunities_offers;
create trigger trg_notify_provider_offer_status
  after update of status on public.opportunities_offers
  for each row execute function public.notify_provider_on_offer_status();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. PostgREST cache reload                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
notify pgrst, 'reload schema';
