-- ============================================================================
-- Provayder online status sütunlarını və icazələri düzəlt
--
-- Problem: mobile app `is_online`, `availability_status`, `last_seen_at`
-- yenilədikdə update fail olur — bu sütunlar mövcud deyil və ya update
-- icazəsi yoxdur.
-- ============================================================================

-- ── 1. Sütunları əlavə et ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_online boolean not null default false;

alter table public.profiles
  add column if not exists availability_status text default 'offline';

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- availability_status üçün CHECK constraint
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%availability_status%';
  if v_name is null then
    alter table public.profiles
      add constraint profiles_availability_status_check
      check (availability_status in ('online','offline','busy','away'));
  end if;
end;
$$;

-- ── 2. Index ────────────────────────────────────────────────────────────
-- Online provayderləri sürətlə tapmaq üçün
create index if not exists profiles_online_idx
  on public.profiles (is_online, role)
  where is_online = true;

-- ── 3. UPDATE icazəsi (authenticated user öz online statusunu yenilə bilsin)
-- security_hardening.sql `status` sütunu üçün revoke edib, amma `is_online`
-- və availability_status icazəlidir. Hər ehtimala qarşı explicit grant.
grant update (is_online, availability_status, last_seen_at, latitude, longitude)
  on public.profiles to authenticated;

-- ── 4. Auto-sync trigger: is_online <-> status legacy ───────────────────
-- Köhnə kod `profiles.status='online'` istifadə edə bilər, hər ikisinə
-- baxan kod var. Bunları sinxronlaşdıraq ki, hər iki tərəfdən düzgün oxunsun.
create or replace function public.sync_profile_online_state()
returns trigger
language plpgsql
as $$
begin
  if new.is_online is distinct from old.is_online then
    new.availability_status := case when new.is_online then 'online' else 'offline' end;
    -- Köhnə `status` sütunu varsa
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='profiles' and column_name='status'
    ) then
      new.status := case when new.is_online then 'online' else 'offline' end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_online on public.profiles;
create trigger trg_sync_profile_online
  before update of is_online on public.profiles
  for each row execute function public.sync_profile_online_state();

notify pgrst, 'reload schema';
