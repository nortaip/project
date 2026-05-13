-- ============================================================================
-- Profile ↔ auth.users metadata sinxronizasiyası
--
-- Problem: OAuth (Google) ilə qeydiyyatdan keçən istifadəçinin adı, emaili,
-- telefonu auth.users.raw_user_meta_data-da qalır, profiles cədvəlində boş.
-- Admin paneldə UUID görsənir, ad/email görünmür.
--
-- Həll:
--   1. auth.users-dən profil sahələrini çıxaran helper funksiya
--   2. INSERT/UPDATE trigger — auth.users dəyişəndə profil avtomatik yenilənir
--   3. Mövcud profillər üçün backfill
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0. NOT NULL constraint-ləri yumşalt — OAuth user-də ad/email yox ola bilər║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.profiles alter column name drop not null;
alter table public.profiles alter column email drop not null;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Helper: auth metadata-dan profile sahələri çıxar                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.extract_profile_fields_from_auth(
  p_email text,
  p_meta jsonb,
  p_phone text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'name', coalesce(
      nullif(p_meta->>'full_name', ''),
      nullif(p_meta->>'name', ''),
      nullif(p_meta->>'display_name', ''),
      nullif(split_part(p_email, '@', 1), '')
    ),
    'email', coalesce(
      nullif(p_email, ''),
      nullif(p_meta->>'email', '')
    ),
    'phone_number', coalesce(
      nullif(p_phone, ''),
      nullif(p_meta->>'phone', ''),
      nullif(p_meta->>'phone_number', '')
    ),
    'avatar_url', coalesce(
      nullif(p_meta->>'avatar_url', ''),
      nullif(p_meta->>'picture', '')
    )
  );
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Trigger funksiyası                                                     ║
-- ║   auth.users INSERT/UPDATE → profiles upsert/update (boş sahələri doldur)║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.tg_sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_fields jsonb;
begin
  v_fields := public.extract_profile_fields_from_auth(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    new.phone
  );

  -- Profili upsert et — boş olan sahələri doldur, mövcud dəyərləri pozma
  insert into public.profiles (id, name, email, phone_number, avatar_url, role)
  values (
    new.id,
    v_fields->>'name',
    v_fields->>'email',
    v_fields->>'phone_number',
    v_fields->>'avatar_url',
    'customer'
  )
  on conflict (id) do update set
    name         = coalesce(nullif(public.profiles.name, ''),         excluded.name),
    email        = coalesce(nullif(public.profiles.email, ''),        excluded.email),
    phone_number = coalesce(nullif(public.profiles.phone_number, ''), excluded.phone_number),
    avatar_url   = coalesce(nullif(public.profiles.avatar_url, ''),   excluded.avatar_url);

  return new;
exception when others then
  -- Auth axınını blok etməsin
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_auth on auth.users;
create trigger trg_sync_profile_from_auth
  after insert or update of email, phone, raw_user_meta_data
  on auth.users
  for each row execute function public.tg_sync_profile_from_auth();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3a. handle_new_user — UUID-fallback bug düzəldildi                        ║
-- ║   Köhnə kod: split_part(new.id::text,'@',1) → tam UUID qaytarır           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_avatar text;
  v_role text;
  v_email text;
  v_phone text;
begin
  v_email := nullif(trim(coalesce(new.email, '')), '');
  v_phone := nullif(trim(coalesce(new.phone, '')), '');

  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'given_name', ''),
    -- email varsa @-dən əvvəlki hissə (UUID DEYİL)
    case when v_email is not null then split_part(v_email, '@', 1) end
  );

  v_avatar := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', '')
  );

  v_role := coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'customer');

  insert into public.profiles (id, role, name, email, phone_number, avatar_url, created_at)
  values (new.id, v_role, v_name, v_email, v_phone, v_avatar, now())
  on conflict (id) do update set
    name         = coalesce(nullif(public.profiles.name, ''),         excluded.name),
    email        = coalesce(nullif(public.profiles.email, ''),        excluded.email),
    phone_number = coalesce(nullif(public.profiles.phone_number, ''), excluded.phone_number),
    avatar_url   = coalesce(nullif(public.profiles.avatar_url, ''),   excluded.avatar_url);

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3b. UUID kimi name-ləri təmizlə (köhnə bug-dan qalan)                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
update public.profiles
   set name = null
 where name is not null
   and name = id::text;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Mövcud profillər üçün one-time backfill                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare r record;
begin
  for r in
    select au.id, au.email, au.phone, au.raw_user_meta_data
      from auth.users au
      join public.profiles p on p.id = au.id
     where (p.name is null or p.name = '' or p.name = p.id::text)
        or (p.email is null or p.email = '')
        or (p.phone_number is null or p.phone_number = '')
        or (p.avatar_url is null or p.avatar_url = '')
  loop
    begin
      update public.profiles p
         set name = coalesce(
               case when p.name = p.id::text then null else nullif(p.name, '') end,
               nullif(r.raw_user_meta_data->>'full_name', ''),
               nullif(r.raw_user_meta_data->>'name', ''),
               nullif(r.raw_user_meta_data->>'display_name', ''),
               case when r.email is not null and r.email <> ''
                    then split_part(r.email, '@', 1) end
             ),
             email = coalesce(
               nullif(p.email, ''),
               nullif(r.email, ''),
               nullif(r.raw_user_meta_data->>'email', '')
             ),
             phone_number = coalesce(
               nullif(p.phone_number, ''),
               nullif(r.phone, ''),
               nullif(r.raw_user_meta_data->>'phone', ''),
               nullif(r.raw_user_meta_data->>'phone_number', '')
             ),
             avatar_url = coalesce(
               nullif(p.avatar_url, ''),
               nullif(r.raw_user_meta_data->>'avatar_url', ''),
               nullif(r.raw_user_meta_data->>'picture', '')
             )
       where p.id = r.id;
    exception when others then null;
    end;
  end loop;
end$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. Admin RPC: tam profil + auth metadata birgə                           ║
-- ║   Mövcud Users.tsx işləməsi davam edir, lakin admin metadata da görsün   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_list_users_with_meta()
returns table (
  id            uuid,
  name          text,
  email         text,
  phone_number  text,
  avatar_url    text,
  role          text,
  is_active     boolean,
  created_at    timestamptz,
  auth_email    text,
  auth_meta     jsonb,
  provider      text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_is_admin boolean;
begin
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  return query
    select p.id, p.name, p.email, p.phone_number, p.avatar_url,
           p.role,
           coalesce(p.is_active, true) as is_active,
           p.created_at,
           au.email as auth_email,
           au.raw_user_meta_data as auth_meta,
           coalesce(
             au.raw_app_meta_data->>'provider',
             (au.raw_app_meta_data->'providers'->>0),
             'email'
           ) as provider
      from public.profiles p
      left join auth.users au on au.id = p.id
     order by p.created_at desc nulls last;
end;
$$;

revoke execute on function public.admin_list_users_with_meta() from public, anon;
grant execute on function public.admin_list_users_with_meta() to authenticated;


notify pgrst, 'reload schema';
