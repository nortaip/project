-- ============================================================================
-- Bot provider seed — app boş görünməsin deyə demo provayderlər
-- ============================================================================
-- 15 bot provayder yaradır Bakı koordinatları ətrafında:
--   • auth.users (fake email, bcrypt parol)
--   • auth.identities
--   • public.profiles (role='provider', is_online=true, rating, lat/lng)
--
-- Idempotent: email-ə görə skip edir (yenidən run edilə bilər).
-- Email pattern: bot_provider_<N>@ellit.bot

do $$
declare
  v_bots constant jsonb := jsonb_build_array(
    jsonb_build_object('name', 'Elnur Hüseynov',     'avatar', 1,  'lat', 40.4082, 'lng', 49.8531, 'rating', 4.8, 'jobs', 47),
    jsonb_build_object('name', 'Tural Məmmədov',     'avatar', 12, 'lat', 40.3953, 'lng', 49.8127, 'rating', 4.6, 'jobs', 32),
    jsonb_build_object('name', 'Rəşad Əliyev',       'avatar', 33, 'lat', 40.3712, 'lng', 49.8392, 'rating', 4.9, 'jobs', 89),
    jsonb_build_object('name', 'Vüsal Qədirov',      'avatar', 51, 'lat', 40.4514, 'lng', 49.8014, 'rating', 4.5, 'jobs', 21),
    jsonb_build_object('name', 'Şahin Bayramov',     'avatar', 8,  'lat', 40.4127, 'lng', 49.8636, 'rating', 4.7, 'jobs', 56),
    jsonb_build_object('name', 'Ülvi Quliyev',       'avatar', 14, 'lat', 40.3961, 'lng', 49.9237, 'rating', 4.4, 'jobs', 18),
    jsonb_build_object('name', 'Cavid Mərdanov',     'avatar', 22, 'lat', 40.4577, 'lng', 49.9617, 'rating', 4.8, 'jobs', 64),
    jsonb_build_object('name', 'Anar Nəbiyev',       'avatar', 7,  'lat', 40.3760, 'lng', 50.0167, 'rating', 4.6, 'jobs', 41),
    jsonb_build_object('name', 'Nicat Süleymanov',   'avatar', 53, 'lat', 40.4262, 'lng', 49.8918, 'rating', 4.9, 'jobs', 73),
    jsonb_build_object('name', 'Kamran Ağayev',      'avatar', 11, 'lat', 40.3805, 'lng', 49.8744, 'rating', 4.5, 'jobs', 29),
    jsonb_build_object('name', 'Rauf İbrahimov',     'avatar', 60, 'lat', 40.4391, 'lng', 49.8255, 'rating', 4.7, 'jobs', 52),
    jsonb_build_object('name', 'Ramin Hacıyev',      'avatar', 17, 'lat', 40.4015, 'lng', 49.8889, 'rating', 4.4, 'jobs', 23),
    jsonb_build_object('name', 'Murad Kərimov',      'avatar', 13, 'lat', 40.4188, 'lng', 49.9492, 'rating', 4.8, 'jobs', 67),
    jsonb_build_object('name', 'Pərviz Vəliyev',     'avatar', 65, 'lat', 40.3892, 'lng', 49.9531, 'rating', 4.6, 'jobs', 38),
    jsonb_build_object('name', 'Elvin Rzayev',       'avatar', 9,  'lat', 40.4435, 'lng', 49.8716, 'rating', 4.7, 'jobs', 44)
  );
  v_bot jsonb;
  v_email text;
  v_uid uuid;
  v_existing uuid;
  v_password_hash text := crypt('Bot@2026!demo', gen_salt('bf'));
  v_idx int := 0;
  v_created int := 0;
  v_skipped int := 0;
begin
  for v_bot in select * from jsonb_array_elements(v_bots) loop
    v_idx := v_idx + 1;
    v_email := 'bot_provider_' || v_idx || '@ellit.bot';

    -- Mövcuddursa skip
    select id into v_existing from auth.users where email = v_email;
    if v_existing is not null then
      v_skipped := v_skipped + 1;
      -- Sadəcə profil sahələrini refresh et (rating, lat, lng, is_online)
      update public.profiles set
        name = v_bot->>'name',
        avatar_url = 'https://i.pravatar.cc/200?img=' || (v_bot->>'avatar'),
        rating = (v_bot->>'rating')::numeric,
        latitude = (v_bot->>'lat')::numeric,
        longitude = (v_bot->>'lng')::numeric,
        is_online = true,
        last_seen_at = now()
      where id = v_existing;
      continue;
    end if;

    v_uid := gen_random_uuid();

    -- 1. auth.users
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated', 'authenticated',
      v_email,
      v_password_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('name', v_bot->>'name', 'is_bot', true),
      now(), now(),
      '', '', '', ''
    );

    -- 2. auth.identities
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email',
      v_uid::text,
      now(), now(), now()
    );

    -- 3. profiles
    insert into public.profiles (
      id, email, name, role, balance,
      avatar_url, rating, latitude, longitude,
      is_online, last_seen_at, created_at
    ) values (
      v_uid,
      v_email,
      v_bot->>'name',
      'provider',
      0,
      'https://i.pravatar.cc/200?img=' || (v_bot->>'avatar'),
      (v_bot->>'rating')::numeric,
      (v_bot->>'lat')::numeric,
      (v_bot->>'lng')::numeric,
      true,
      now(),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      rating = excluded.rating,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      is_online = true,
      last_seen_at = now();

    v_created := v_created + 1;
  end loop;

  raise notice '────────────────────────────────────────────────';
  raise notice 'Bot provayderlər hazırdır:';
  raise notice '  Yaradıldı: %', v_created;
  raise notice '  Yeniləndi: %', v_skipped;
  raise notice '  Cəmi:      %', v_idx;
  raise notice '  Koordinat: Bakı (40.37-40.46, 49.80-50.02)';
  raise notice '  is_online: true (xəritədə görünür)';
  raise notice '────────────────────────────────────────────────';
end;
$$;

notify pgrst, 'reload schema';
