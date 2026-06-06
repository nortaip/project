-- ============================================================================
-- Bot provider təkmilləşdirmələri
-- ============================================================================
--   1. Profil avatarlarını sil (avatar_url = null)
--   2. Abşeron yarımadasında QURU koordinatlar (dəniz/göl yox)
--   3. Günlük avtomatik refresh function (pg_cron)

-- ── 1. Avatarları sil ───────────────────────────────────────────────
update public.profiles set
  avatar_url = null
where email like 'bot_provider_%@ellit.bot';

-- ── 2. pg_cron extension (Supabase-də mövcuddur) ──────────────────
create extension if not exists pg_cron with schema extensions;

-- ── 3. Refresh function ───────────────────────────────────────────────
create or replace function public.refresh_bot_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Abşeron yarımadası quru sahələr (dəniz/göl deyil, faktiki yaşayış yerləri)
  v_coords constant numeric[][] := array[
    -- Bakı şəhər
    array[40.4082, 49.8531],  -- Bakı mərkəz (Fəvvarələr meydanı)
    array[40.3953, 49.8127],  -- Yasamal
    array[40.3805, 49.8590],  -- Səbail (28 May)
    array[40.4514, 49.8014],  -- Binəqədi
    array[40.4127, 49.8636],  -- Nərimanov
    array[40.4015, 49.9095],  -- Nizami
    array[40.4577, 49.9617],  -- Sabunçu
    array[40.4093, 49.9742],  -- Suraxanı
    array[40.3892, 49.9531],  -- Xətai
    array[40.4262, 49.8918],  -- Nəsimi (Akademiya)
    -- Abşeron qəsəbələri
    array[40.5215, 49.9890],  -- Maştağa
    array[40.5078, 50.0913],  -- Buzovna
    array[40.4861, 50.1480],  -- Mərdəkan
    array[40.5410, 50.1467],  -- Şüvəlan
    array[40.5630, 50.0260],  -- Bilgəh
    array[40.5810, 49.9020],  -- Pirşağa
    array[40.4520, 49.9650],  -- Nardaran
    array[40.4350, 49.9450],  -- Bakıxanov
    -- Cənub və qərb
    array[40.5896, 49.6685],  -- Sumqayıt
    array[40.3927, 49.7530],  -- Lökbatan
    array[40.3650, 49.6300],  -- Qaradağ (Sahil)
    array[40.4950, 49.7240]   -- Mehdiabad
  ];
  v_bot record;
  v_idx int;
  v_lat numeric;
  v_lng numeric;
  v_count int := 0;
begin
  for v_bot in
    select id from public.profiles
     where email like 'bot_provider_%@ellit.bot'
  loop
    -- Random base koordinat
    v_idx := 1 + floor(random() * array_length(v_coords, 1))::int;
    -- Random kiçik offset (±0.004 ≈ 400m), şəhər daxili
    v_lat := v_coords[v_idx][1] + (random() - 0.5) * 0.008;
    v_lng := v_coords[v_idx][2] + (random() - 0.5) * 0.008;

    update public.profiles set
      latitude = v_lat,
      longitude = v_lng,
      is_online = true,
      last_seen_at = now()
    where id = v_bot.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.refresh_bot_locations() from public, anon, authenticated;

-- ── 4. İlk dəfə çağır (mövcud botların koordinatlarını yenilə) ─────
select public.refresh_bot_locations() as updated_count;

-- ── 5. Günlük cron schedule ─────────────────────────────────────────
-- Köhnə job-(lar)ı sil (command field-i ilə tap — jobname köhnə versiyada yoxdur)
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job
     where command ilike '%refresh_bot_locations%'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$$;

-- Hər gün 03:00 UTC (Bakı 07:00) yenilə
-- pg_cron köhnə API: cron.schedule(schedule, command) returns bigint
select cron.schedule(
  '0 3 * * *',
  $$select public.refresh_bot_locations();$$
);

notify pgrst, 'reload schema';

-- ── Yoxlama sorğuları ───────────────────────────────────────────────
-- Cron job-u görmək üçün:
-- select jobid, schedule, command, active from cron.job
--  where command ilike '%refresh_bot_locations%';

-- Son icra nəticələri:
-- select * from cron.job_run_details
--  where jobid in (select jobid from cron.job where command ilike '%refresh_bot_locations%')
--  order by start_time desc limit 5;

-- Manual yenidən çağır:
-- select public.refresh_bot_locations();
