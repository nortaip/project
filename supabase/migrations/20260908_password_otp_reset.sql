-- ============================================================================
-- Parol yeniləmə OTP axını (auth-lu istifadəçi, nömrə daxil etmədən)
-- ============================================================================
-- Axın:
--   1) request_password_change_otp() — 6 rəqəmli kod yaradır, notifications-a
--      yazır → mövcud push trigger-i (trg_notifications_send_push) kodu
--      AVTOMATIK istifadəçinin cihazına çatdırır (app bağlı olsa belə).
--   2) verify_password_change_otp(kod) — yoxlayır, uğurludursa klient
--      supabase.auth.updateUser(password) ilə parolu dəyişir.
--
-- Təhlükəsizlik:
--   * Kod yalnız auth.uid() üçün yaradılır/yoxlanır (nömrə tələb olunmur).
--   * 5 dəqiqə etibarlıdır, bir dəfə istifadə olunur.
--   * Rate limit: saatda maksimum 3 sorğu; kod üzrə maksimum 5 yanlış cəhd.

alter table public.password_otps
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists used boolean not null default false,
  add column if not exists attempts int not null default 0;

create index if not exists ix_password_otps_user
  on public.password_otps (user_id, created_at desc);

-- RLS: cədvələ klient birbaşa toxunmur (yalnız RPC-lər, security definer)
alter table public.password_otps enable row level security;

create or replace function public.request_password_change_otp()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent int;
  v_otp text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select count(*) into v_recent
    from password_otps
   where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  -- Köhnə istifadə olunmamış kodları ləğv et
  update password_otps set used = true
   where user_id = v_uid and not used;

  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into password_otps (user_id, phone, otp, expires_at)
  values (v_uid, '', v_otp, now() + interval '5 minutes');

  -- Push trigger bunu avtomatik cihaza göndərir
  insert into notifications (user_id, type, title, body, related_id)
  values (
    v_uid,
    'password_otp',
    'Parol yeniləmə kodu',
    'Təsdiq kodunuz: ' || v_otp || ' (5 dəqiqə etibarlıdır)',
    'password_otp'
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.verify_password_change_otp(p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_row
    from password_otps
   where user_id = v_uid and not used
   order by created_at desc
   limit 1;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'NO_OTP');
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  if v_row.attempts >= 5 then
    update password_otps set used = true where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  if v_row.otp <> regexp_replace(coalesce(p_otp, ''), '\D', '', 'g') then
    update password_otps set attempts = attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'WRONG_CODE',
                              'attempts_left', 5 - v_row.attempts - 1);
  end if;

  update password_otps set used = true where id = v_row.id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.request_password_change_otp() to authenticated;
grant execute on function public.verify_password_change_otp(text) to authenticated;

-- Köhnə kodların təmizlənməsi (gündəlik işə salına bilər)
delete from public.password_otps where created_at < now() - interval '1 day';

-- ƏLAVƏ (2026-09-09): VEB üçün login-siz OTP bərpası (TƏTBİQ OLUNUB):
--   request_password_reset_otp(identifikator) — EMAIL VƏ YA TELEFON qəbul
--     edir ('@' varsa email, əks halda son 9 rəqəm auth.users.phone /
--     profiles.phone_number ilə tutuşdurulur — _find_user_by_identifier);
--     kod mobil tətbiqə push kimi düşür; cavab HƏMİŞƏ {ok:true} olur
--     (hesab mövcudluğu sızdırılmır) və veb dərhal kod+yeni parol
--     formasına keçir; saatda 3 kod limiti
--   reset_password_with_otp(identifikator, otp, yeni_parol) — parol
--     serverdə bcrypt ilə yenilənir, bütün sessiyalar bağlanır,
--     təhlükəsizlik bildirişi göndərilir; 5 cəhd / 5 dəq / min 8 simvol
-- Tam SQL: Supabase migrations "web_password_reset_otp" +
--   "reset_otp_email_or_phone".
--
-- ƏLAVƏ (2026-09-09b): OTP gəlmədikdə fallback (TƏTBİQ OLUNUB):
--   request_password_reset_email(identifikator) — telefon yazılıbsa belə
--     hesabın email ünvanına Supabase bərpa keçidi serverdən (pg_net →
--     /auth/v1/recover) göndərilir; email klientə sızdırılmır, yalnız
--     maskalanmış görüntü qayıdır (a•••@g•••.com); saatda 3 email limiti
--     (marker sətirlər password_otps.phone='email_fallback', OTP
--     limitindən ayrıdır)
-- Tam SQL: Supabase migration "reset_email_fallback_by_identifier".
