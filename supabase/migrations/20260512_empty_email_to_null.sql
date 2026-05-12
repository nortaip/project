-- ============================================================================
-- profiles.email — boş string-ləri NULL-a çevir
--
-- Problem: `profiles.email` üçün UNIQUE constraint var. Bir profil boş string
-- ('') ilə yaradılırsa, sonra ikinci profil də boş string saxlamağa çalışır
-- → duplicate key error.
--
-- Səbəb: Google OAuth-da email olmadıqda kod '' yazır, NULL deyil.
-- Plus admin edit-də boş input '' kimi save olunur.
-- ============================================================================

-- 0) Email sütunundan NOT NULL məhdudiyyətini çıxar (telefon-only girişlər üçün
--    və Google OAuth metadata-da email gəlməsə deyə)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name='email' and is_nullable='NO'
  ) then
    alter table public.profiles alter column email drop not null;
  end if;
end$$;

-- 1) Mövcud datadakı boş email-ləri NULL-a çevir (boş və ya whitespace-only)
update public.profiles
   set email = null
 where email is not null
   and trim(email) = '';

-- 2) Trigger: hər INSERT/UPDATE-də boş email-i avtomatik NULL et
create or replace function public.normalize_profile_email()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null and trim(new.email) = '' then
    new.email := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_profile_email on public.profiles;
create trigger trg_normalize_profile_email
  before insert or update of email on public.profiles
  for each row execute function public.normalize_profile_email();

-- 3) handle_new_user trigger-i də əmin et ki boş email NULL kimi getsin
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
begin
  -- Boş və ya whitespace-only email-i NULL et
  v_email := nullif(trim(coalesce(new.email, '')), '');

  v_name := coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'given_name',
    split_part(coalesce(v_email, new.id::text), '@', 1)
  );

  v_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  v_role := coalesce(new.raw_user_meta_data->>'role', 'customer');

  insert into public.profiles (id, role, name, email, avatar_url, created_at)
  values (
    new.id,
    v_role,
    v_name,
    v_email,
    v_avatar,
    now()
  )
  on conflict (id) do update
  set
    name = coalesce(public.profiles.name, excluded.name),
    email = coalesce(public.profiles.email, excluded.email),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';
