-- ============================================================================
--  Notifications Migration — 2026-05-08
--
--  Eyni schema Flutter mobile app-da artıq mövcuddur (`/ellit_booking/supabase/notifications.sql`).
--  Bu fayl web project-də də eyni cədvəlləri/trigger-ləri yaradır
--  (əgər artıq yaradılıbsa, idempotent — heç nə dəyişməz).
--
--  Tətbiq olunduqdan sonra:
--    - In-app realtime bildirişlər həm web həm mobile-də işləyir
--    - FCM dispatch trigger artıq quraşdırılıb (`fcm_dispatch.sql`)
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ notifications cədvəli                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  related_id  text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_id_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (user_id, is_read)
  where is_read = false;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS                                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.notifications enable row level security;

drop policy if exists "users can read own notifications" on public.notifications;
create policy "users can read own notifications"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can update own notifications" on public.notifications;
create policy "users can update own notifications"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can insert own notifications" on public.notifications;
create policy "users can insert own notifications"
  on public.notifications
  for insert
  to authenticated
  with check (auth.uid() = user_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime publication                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when others then
  raise notice 'Realtime publication update skipped: %', sqlerrm;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper: mark_all_read                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.notifications
  set is_read = true
  where user_id = auth.uid() and is_read = false;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Helper: unread_count (Navbar bell üçün)                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.notifications_unread_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(count(*)::integer, 0)
  from public.notifications
  where user_id = auth.uid() and is_read = false;
$$;

revoke execute on function public.notifications_unread_count() from public, anon;
grant execute on function public.notifications_unread_count() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Auto-trigger: opportunity / offer / status hadisələrindən bildiriş yarat ║
-- ║ (Yalnız əgər opportunities və ya bookings cədvəlləri varsa)              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Yeni booking → provayderə bildiriş
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='bookings'
  ) then
    create or replace function public.notify_provider_on_new_booking()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $func$
    begin
      if new.provider_id is not null and new.provider_id <> new.customer_id then
        insert into public.notifications (user_id, type, title, body, related_id)
        values (
          new.provider_id,
          'new_booking',
          'Yeni sifariş',
          'Sizə yeni sifariş gəldi.',
          new.id::text
        );
      end if;
      return new;
    end;
    $func$;

    drop trigger if exists trg_new_booking_notify on public.bookings;
    create trigger trg_new_booking_notify
      after insert on public.bookings
      for each row
      execute function public.notify_provider_on_new_booking();
  end if;
end $$;

-- Booking status dəyişdi → həm müştəri həm provayderə bildiriş
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='bookings'
  ) then
    create or replace function public.notify_on_booking_status_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $func$
    declare
      v_title text;
      v_body  text;
    begin
      if new.status is distinct from old.status then
        case new.status
          when 'confirmed' then
            v_title := 'Sifariş qəbul edildi';
            v_body  := 'Provayder sifarişinizi qəbul etdi.';
          when 'completed' then
            v_title := 'Sifariş tamamlandı';
            v_body  := 'Sifariş uğurla tamamlandı — rəy bildirə bilərsiniz.';
          when 'cancelled' then
            v_title := 'Sifariş ləğv edildi';
            v_body  := 'Bu sifariş ləğv edildi.';
          else
            v_title := 'Sifariş statusu dəyişdi';
            v_body  := concat('Yeni status: ', new.status);
        end case;

        if new.customer_id is not null then
          insert into public.notifications (user_id, type, title, body, related_id)
          values (new.customer_id, concat('booking_', new.status), v_title, v_body, new.id::text);
        end if;
        if new.provider_id is not null and new.provider_id <> new.customer_id then
          insert into public.notifications (user_id, type, title, body, related_id)
          values (new.provider_id, concat('booking_', new.status), v_title, v_body, new.id::text);
        end if;
      end if;
      return new;
    end;
    $func$;

    drop trigger if exists trg_booking_status_notify on public.bookings;
    create trigger trg_booking_status_notify
      after update on public.bookings
      for each row
      execute function public.notify_on_booking_status_change();
  end if;
end $$;
