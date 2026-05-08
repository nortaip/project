-- ============================================================================
--  Brigades / Şirkətlər Migration — 2026-05-08
--
--  Konsepsiya: Brigada (şirkət/ofis) — provayder kimi qeydiyyatdan keçir,
--  daxilində bir neçə işçi (member) saxlayır. Müştəri sifariş edəndə bu
--  brigadaya gedir, ofis dispatcher-i sifarişi konkret işçi(lər)ə yönləndirir.
--
--  Cədvəllər:
--    - brigades             — şirkət/ofis profili
--    - brigade_members      — işçilər (mövcud profiles.id-yə bağlı)
--    - brigade_invites      — yeni işçi dəvətləri (email/phone əsaslı)
--    - brigade_assignments  — sifarişin işçilərə paylanması
--
--  Rollar:
--    'owner'      — şirkət sahibi (CRUD bütün)
--    'dispatcher' — sifarişləri işçilərə yönləndirə bilər
--    'member'     — adi işçi, yalnız özünə yönəldilmiş işləri görür
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ brigades — şirkət/ofis                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.brigades (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete restrict,

  -- Şirkət məlumatları
  name            text not null,
  slug            text unique,                          -- URL-friendly, məs: "as-temizlik"
  description     text,
  logo_url        text,
  cover_url       text,

  -- Əlaqə
  contact_phone   text,
  contact_email   text,
  address         text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  working_hours   jsonb not null default '{}'::jsonb,   -- {mon:"09:00-18:00", ...}

  -- Xidmət sahəsi
  categories      text[] not null default array[]::text[],
  service_radius_km integer,                            -- xidmət göstərilən radius

  -- Status
  is_active       boolean not null default true,
  is_verified     boolean not null default false,
  rating          numeric(3,2) not null default 0,
  total_orders    integer not null default 0,

  -- Audit
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists brigades_owner_idx on public.brigades (owner_id);
create index if not exists brigades_active_idx on public.brigades (is_active, is_verified);
create unique index if not exists brigades_slug_unique
  on public.brigades (lower(slug)) where slug is not null;

-- updated_at avtomatik
create or replace function public._touch_brigades_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_brigades_touch on public.brigades;
create trigger trg_brigades_touch
  before update on public.brigades
  for each row
  execute function public._touch_brigades_updated_at();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ brigade_members — şirkət işçiləri                                        ║
-- ║ profile_id artıq mövcud user-ə işarə edir (provayder olaraq qeydiyyat).  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.brigade_members (
  id          uuid primary key default gen_random_uuid(),
  brigade_id  uuid not null references public.brigades(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner', 'dispatcher', 'member')),
  is_active   boolean not null default true,

  -- İş şərtləri
  commission_pct numeric(5,2),         -- işçinin gəlir faizi (məs. 70.00)
  notes         text,

  joined_at   timestamptz not null default now(),
  unique (brigade_id, profile_id)
);

create index if not exists brigade_members_brigade_idx on public.brigade_members (brigade_id);
create index if not exists brigade_members_profile_idx on public.brigade_members (profile_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ brigade_invites — yeni işçi dəvətləri                                    ║
-- ║ Hələ qeydiyyatdan keçməyən şəxslər email/telefon ilə dəvət olunur.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.brigade_invites (
  id            uuid primary key default gen_random_uuid(),
  brigade_id    uuid not null references public.brigades(id) on delete cascade,
  invited_by    uuid not null references public.profiles(id) on delete set null,

  -- Hədəf
  email         text,
  phone         text,
  intended_role text not null default 'member' check (intended_role in ('dispatcher', 'member')),
  commission_pct numeric(5,2),

  -- Token-based confirmation
  token         uuid not null default gen_random_uuid(),
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at    timestamptz not null default (now() + interval '7 days'),

  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

create index if not exists brigade_invites_brigade_idx on public.brigade_invites (brigade_id);
create index if not exists brigade_invites_token_idx on public.brigade_invites (token);
create index if not exists brigade_invites_email_idx on public.brigade_invites (lower(email)) where email is not null;
create index if not exists brigade_invites_phone_idx on public.brigade_invites (phone) where phone is not null;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ brigade_assignments — sifarişin işçilərə paylanması                      ║
-- ║ 1 sifariş → bir neçə işçiyə yönləndirilə bilər (komanda işi).            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.brigade_assignments (
  id            uuid primary key default gen_random_uuid(),
  brigade_id    uuid not null references public.brigades(id) on delete cascade,
  member_id     uuid not null references public.brigade_members(id) on delete cascade,

  -- Sifarişə işarə (booking, opportunity və ya digər)
  source_type   text not null default 'booking'
                  check (source_type in ('booking', 'opportunity', 'manual')),
  source_id     text not null,                          -- bookings.id və ya opportunities.id

  -- Dispatch metadata
  assigned_by   uuid not null references public.profiles(id) on delete set null,
  status        text not null default 'assigned'
                  check (status in ('assigned', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled')),
  notes         text,
  priority      smallint not null default 5 check (priority between 1 and 10),

  -- Vaxt damğaları
  assigned_at   timestamptz not null default now(),
  responded_at  timestamptz,
  completed_at  timestamptz,

  unique (brigade_id, source_id, member_id)
);

create index if not exists brigade_assignments_brigade_idx on public.brigade_assignments (brigade_id);
create index if not exists brigade_assignments_member_idx on public.brigade_assignments (member_id, status);
create index if not exists brigade_assignments_source_idx on public.brigade_assignments (source_type, source_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ HELPER FUNCTIONS (RLS qoymadan əvvəl)                                    ║
-- ║                                                                          ║
-- ║ İstifadəçinin müəyyən brigada-da rolunu qaytarır:                        ║
-- ║   - 'owner' / 'dispatcher' / 'member' / NULL                             ║
-- ║                                                                          ║
-- ║ STABLE + SECURITY DEFINER — RLS policy-lərində çağrıla bilər,            ║
-- ║ recursion problemi olmadan.                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.brigade_role(p_brigade_id uuid, p_profile_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select bm.role
  from public.brigade_members bm
  where bm.brigade_id = p_brigade_id
    and bm.profile_id = p_profile_id
    and bm.is_active = true
  limit 1
$$;

revoke execute on function public.brigade_role(uuid, uuid) from public, anon;
grant execute on function public.brigade_role(uuid, uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — brigades                                                           ║
-- ║ - SELECT: anyone (public marketplace)                                    ║
-- ║ - INSERT: authenticated users (öz brigadasını yaradır)                   ║
-- ║ - UPDATE/DELETE: yalnız owner                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.brigades enable row level security;

drop policy if exists "anyone read brigades" on public.brigades;
create policy "anyone read brigades"
  on public.brigades
  for select
  to authenticated, anon
  using (is_active = true or auth.uid() = owner_id);

drop policy if exists "owner creates brigade" on public.brigades;
create policy "owner creates brigade"
  on public.brigades
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "owner updates brigade" on public.brigades;
create policy "owner updates brigade"
  on public.brigades
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner deletes brigade" on public.brigades;
create policy "owner deletes brigade"
  on public.brigades
  for delete
  to authenticated
  using (auth.uid() = owner_id);

-- is_verified yalnız admin tərəfindən
revoke update (is_verified, rating, total_orders) on public.brigades from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — brigade_members                                                    ║
-- ║ - SELECT: brigada üzvləri özlərini və komanda yoldaşlarını görür         ║
-- ║ - INSERT/UPDATE/DELETE: yalnız brigada owner-i / dispatcher              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.brigade_members enable row level security;

drop policy if exists "members read team" on public.brigade_members;
create policy "members read team"
  on public.brigade_members
  for select
  to authenticated
  using (
    public.brigade_role(brigade_id) is not null
    or auth.uid() = profile_id
  );

drop policy if exists "owner manages members" on public.brigade_members;
create policy "owner manages members"
  on public.brigade_members
  for all
  to authenticated
  using (public.brigade_role(brigade_id) in ('owner', 'dispatcher'))
  with check (public.brigade_role(brigade_id) in ('owner', 'dispatcher'));


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — brigade_invites                                                    ║
-- ║ - SELECT: invitee (token əsaslı) və ya brigada owner/dispatcher          ║
-- ║ - INSERT: brigada owner/dispatcher                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.brigade_invites enable row level security;

drop policy if exists "owner reads invites" on public.brigade_invites;
create policy "owner reads invites"
  on public.brigade_invites
  for select
  to authenticated
  using (public.brigade_role(brigade_id) in ('owner', 'dispatcher'));

drop policy if exists "owner creates invite" on public.brigade_invites;
create policy "owner creates invite"
  on public.brigade_invites
  for insert
  to authenticated
  with check (public.brigade_role(brigade_id) in ('owner', 'dispatcher'));

drop policy if exists "owner updates invite" on public.brigade_invites;
create policy "owner updates invite"
  on public.brigade_invites
  for update
  to authenticated
  using (public.brigade_role(brigade_id) in ('owner', 'dispatcher'));


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS — brigade_assignments                                                ║
-- ║ - SELECT: dispatch edilən member, dispatch edən, və brigada owner        ║
-- ║ - INSERT: brigada owner/dispatcher                                       ║
-- ║ - UPDATE: assigned member (status update edə bilər)                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.brigade_assignments enable row level security;

drop policy if exists "members read assignments" on public.brigade_assignments;
create policy "members read assignments"
  on public.brigade_assignments
  for select
  to authenticated
  using (
    public.brigade_role(brigade_id) in ('owner', 'dispatcher')
    or exists (
      select 1 from public.brigade_members bm
      where bm.id = member_id and bm.profile_id = auth.uid()
    )
  );

drop policy if exists "dispatcher creates assignment" on public.brigade_assignments;
create policy "dispatcher creates assignment"
  on public.brigade_assignments
  for insert
  to authenticated
  with check (
    public.brigade_role(brigade_id) in ('owner', 'dispatcher')
  );

drop policy if exists "member updates own assignment" on public.brigade_assignments;
create policy "member updates own assignment"
  on public.brigade_assignments
  for update
  to authenticated
  using (
    public.brigade_role(brigade_id) in ('owner', 'dispatcher')
    or exists (
      select 1 from public.brigade_members bm
      where bm.id = member_id and bm.profile_id = auth.uid()
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ HELPER: assign_order_to_brigade                                          ║
-- ║ Müştəri sifariş edib brigadaya yönləndirildikdə bu funksiya              ║
-- ║ avtomatik working hours-a uyğun aktiv işçilər üçün assignment yaradır.   ║
-- ║                                                                          ║
-- ║ İndilik manual: dispatcher OPEN qaldıqları işçilərdən birini seçir.      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.brigade_assign_order(
  p_brigade_id  uuid,
  p_source_type text,
  p_source_id   text,
  p_member_ids  uuid[],          -- bir və ya bir neçə brigade_members.id
  p_notes       text default null,
  p_priority    smallint default 5
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_count       integer := 0;
  v_member_id   uuid;
begin
  v_caller_role := public.brigade_role(p_brigade_id);
  if v_caller_role is null or v_caller_role not in ('owner', 'dispatcher') then
    raise exception 'Forbidden: only owner/dispatcher can assign orders';
  end if;

  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    raise exception 'Must provide at least one member_id';
  end if;

  foreach v_member_id in array p_member_ids loop
    -- Ensure the member belongs to this brigade
    if not exists (
      select 1 from public.brigade_members bm
      where bm.id = v_member_id
        and bm.brigade_id = p_brigade_id
        and bm.is_active = true
    ) then
      raise exception 'Member % does not belong to brigade %', v_member_id, p_brigade_id;
    end if;

    insert into public.brigade_assignments
      (brigade_id, member_id, source_type, source_id, assigned_by, notes, priority)
    values
      (p_brigade_id, v_member_id, p_source_type, p_source_id, auth.uid(), p_notes, p_priority)
    on conflict (brigade_id, source_id, member_id) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.brigade_assign_order(uuid, text, text, uuid[], text, smallint) from public, anon;
grant execute on function public.brigade_assign_order(uuid, text, text, uuid[], text, smallint) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime publication                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='brigades') then
    alter publication supabase_realtime add table public.brigades;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='brigade_members') then
    alter publication supabase_realtime add table public.brigade_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='brigade_assignments') then
    alter publication supabase_realtime add table public.brigade_assignments;
  end if;
exception when others then
  raise notice 'Realtime publication update skipped: %', sqlerrm;
end $$;
