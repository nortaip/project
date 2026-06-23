-- ============================================================================
-- FCM PUSH BİLDİRİŞLƏRİNİN BƏRPASI
--
-- Problem (mobil app sifariş gələndə push almır):
--   1. `user_devices` cədvəli heç bir migration-da yaradılmırdı → mobil app
--      FCM token-i saxlaya bilmir → `send-fcm` "no devices" qaytarır.
--   2. `notifications` cədvəlinin sxemi uyğunsuz idi: web migration `kind`
--      sütunu işlədir, mobil app və FCM dispatch trigger isə `type` gözləyir.
--   3. FCM dispatch trigger-i (`notifications` insert → `send-fcm` Edge Function)
--      yalnız sərbəst `ellit_booking/supabase/fcm_dispatch.sql` faylında idi,
--      migration kimi heç vaxt tətbiq olunmamışdı.
--
-- Bu migration üçü də həll edir. İdempotentdir (təkrar icra təhlükəsizdir).
--
-- ÖN ŞƏRT (bu migration-dan kənar, manual):
--   • Supabase secrets: FCM_SERVICE_ACCOUNT_JSON, FCM_PROJECT_ID
--   • Edge Function deploy: supabase functions deploy send-fcm --no-verify-jwt
--   • Mobil build: google-services.json / GoogleService-Info.plist
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. user_devices — FCM token saxlanc cədvəli                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.user_devices (
  fcm_token   text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text,
  last_seen   timestamptz default now(),
  created_at  timestamptz not null default now()
);

create index if not exists user_devices_user_idx
  on public.user_devices (user_id);

alter table public.user_devices enable row level security;

-- İstifadəçi yalnız öz cihaz token-lərini idarə edir.
drop policy if exists "users select own devices" on public.user_devices;
create policy "users select own devices"
  on public.user_devices for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users insert own devices" on public.user_devices;
create policy "users insert own devices"
  on public.user_devices for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users update own devices" on public.user_devices;
create policy "users update own devices"
  on public.user_devices for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own devices" on public.user_devices;
create policy "users delete own devices"
  on public.user_devices for delete to authenticated
  using (auth.uid() = user_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. notifications — `type` ↔ `kind` uyğunluğu                              ║
-- ║    Web triggerlər `kind`, mobil app isə `type` yazır/oxuyur. Hər iki     ║
-- ║    sütun mövcud olsun və avtomatik sinxron qalsın ki, hər iki tərəf      ║
-- ║    işləsin.                                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists kind text;

-- Mövcud sətirləri qarşılıqlı doldur.
update public.notifications set type = kind where type is null and kind is not null;
update public.notifications set kind = type where kind is null and type is not null;

-- Yeni insert/update-də iki sütunu bir-biri ilə doldur.
create or replace function public.notifications_sync_type_kind()
returns trigger
language plpgsql
as $$
begin
  if new.type is null and new.kind is not null then
    new.type := new.kind;
  elsif new.kind is null and new.type is not null then
    new.kind := new.type;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notifications_sync_type_kind on public.notifications;
create trigger trg_notifications_sync_type_kind
  before insert or update on public.notifications
  for each row execute function public.notifications_sync_type_kind();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. FCM dispatch — notifications insert olunanda send-fcm-i çağır          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_fcm_on_new_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_function_url constant text :=
    'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/send-fcm';

  -- Public anon key — Supabase gateway tələbidir (Edge Function
  -- `--no-verify-jwt` ilə deploy olunur, service_role öz env-indən gəlir).
  v_anon_key constant text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
begin
  perform net.http_post(
    url     := v_function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body    := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    coalesce(new.body, ''),
      'data',    jsonb_build_object(
        -- `type` və `kind` sütunlarının hər ikisini dəstəklə
        'type',       coalesce(new.type, new.kind, 'info'),
        'related_id', coalesce(new.related_id, ''),
        'notif_id',   new.id::text
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_fcm_dispatch on public.notifications;
create trigger trg_fcm_dispatch
  after insert on public.notifications
  for each row
  execute function public.dispatch_fcm_on_new_notification();


-- PostgREST schema cache reload
notify pgrst, 'reload schema';
