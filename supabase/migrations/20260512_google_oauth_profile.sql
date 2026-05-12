-- ============================================================================
-- Google OAuth — yeni istifadəçi üçün profile auto-create iyileşdirmə
--
-- Köhnə trigger Google-dan gələn `full_name`, `picture`, `avatar_url` kimi
-- meta data sahələrini bilmirdi. Plus duplicate user halında fail edirdi.
-- ============================================================================

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
  v_email := coalesce(new.email, '');

  -- Adın mənbəyi: meta_data.name → meta_data.full_name → email prefix
  v_name := coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'given_name',
    split_part(v_email, '@', 1)
  );

  -- Avatar: meta_data.avatar_url → meta_data.picture
  v_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  -- Role (default customer)
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
    -- Yalnız boş olan sahələri yenilə (mövcud dəyərləri pozma)
    name = coalesce(public.profiles.name, excluded.name),
    email = coalesce(public.profiles.email, excluded.email),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
exception when others then
  -- Profile yaratmaq fail olsa belə, auth.users insert keçməlidir
  return new;
end;
$$;

-- Trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';
