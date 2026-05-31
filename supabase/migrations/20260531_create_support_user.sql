-- ============================================================================
-- Support user yaratma: support@ellit.az
-- ============================================================================
-- DİQQƏT: Yalnız Supabase Dashboard SQL Editor-də (superuser) icra edilməlidir.
--
-- Idempotent + ID-konfliktə qarşı resilient:
--   • Profile mövcuddursa onun ID-sini istifadə edir (FK-lar saxlanır)
--   • Auth user yoxdursa profile ID-si ilə yaradır
--   • Auth user fərqli ID-də mövcuddursa silib yenidən yaradır
--   • Hər iki yoxdursa yeni UUID generate edir
--   • Hər halda parol → 'Test@2026!', config yenilənir

do $$
declare
  v_uid uuid;
  v_auth_id uuid;
  v_profile_id uuid;
  v_password_hash text := crypt('Test@2026!', gen_salt('bf'));
begin
  -- Mövcud sətirləri tap
  select id into v_auth_id    from auth.users      where email = 'support@ellit.az';
  select id into v_profile_id from public.profiles where email = 'support@ellit.az';

  -- ID prioriteti: profile > auth > new (FK qoruması üçün profile birinci)
  v_uid := coalesce(v_profile_id, v_auth_id, gen_random_uuid());

  -- ── Konflikt detektoru: profile_id başqa auth user üçün istifadə olunurmu? ──
  -- (məs. köhnə cəhddə yarımçıq qalmış orphan profile)
  if v_profile_id is not null
     and exists (
       select 1 from auth.users
        where id = v_profile_id
          and email is distinct from 'support@ellit.az'
     )
  then
    raise notice 'KONFLİKT: profile ID % başqa auth user üçün istifadə olunur', v_profile_id;
    raise notice 'Köhnə orphan profili silirik və təzə UUID ilə davam edirik...';
    delete from public.profiles where id = v_profile_id;
    v_profile_id := null;
    v_uid := coalesce(v_auth_id, gen_random_uuid());
  end if;

  -- ── Auth.users sinxronizasiyası ──────────────────────────────────
  if v_auth_id is null then
    -- Auth yoxdur → yarat
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated', 'authenticated',
      'support@ellit.az',
      v_password_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('name', 'Ellit Dəstək'),
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'support@ellit.az'),
      'email',
      v_uid::text,
      now(), now(), now()
    );
    raise notice 'Auth user yaradıldı: %', v_uid;

  elsif v_auth_id <> v_uid then
    -- Auth fərqli ID-də → köhnəni sil və profil ID-si ilə yenidən yarat
    delete from auth.identities where user_id = v_auth_id;
    delete from auth.users where id = v_auth_id;
    raise notice 'Köhnə auth user silindi (% != %)', v_auth_id, v_uid;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated', 'authenticated',
      'support@ellit.az',
      v_password_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('name', 'Ellit Dəstək'),
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'support@ellit.az'),
      'email',
      v_uid::text,
      now(), now(), now()
    );
    raise notice 'Auth user profil ID-si ilə yenidən yaradıldı: %', v_uid;

  else
    -- Auth var və ID uyğundur → yalnız parolu yenilə
    update auth.users
       set encrypted_password = v_password_hash,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('name', 'Ellit Dəstək'),
           updated_at = now()
     where id = v_uid;
    raise notice 'Mövcud auth user yeniləndi: %', v_uid;
  end if;

  -- ── Profile upsert (id-ə görə, email konflikti olmayacaq) ────────
  insert into public.profiles (id, email, name, role, balance, created_at)
  values (v_uid, 'support@ellit.az', 'Ellit Dəstək', 'admin', 0, now())
  on conflict (id) do update set
    email = 'support@ellit.az',
    name = 'Ellit Dəstək',
    role = 'admin';

  -- ── Platform config (chat sistemi bu UUID-ə yönlənir) ────────────
  insert into public.platform_config (key, value, description)
  values (
    'support_user_id',
    to_jsonb(v_uid::text),
    'Ellit Dəstək (support@ellit.az) UUID — chat sistemi üçün'
  )
  on conflict (key) do update set
    value = to_jsonb(v_uid::text),
    description = 'Ellit Dəstək (support@ellit.az) UUID — chat sistemi üçün',
    updated_at = now();

  raise notice '────────────────────────────────────────────────';
  raise notice 'Support user hazırdır:';
  raise notice '  Email:    support@ellit.az';
  raise notice '  Parol:    Test@2026!';
  raise notice '  UUID:     %', v_uid;
  raise notice '  Rolu:     admin';
  raise notice '────────────────────────────────────────────────';
end;
$$;

notify pgrst, 'reload schema';
