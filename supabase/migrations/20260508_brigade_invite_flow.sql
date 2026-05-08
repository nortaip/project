-- ============================================================================
--  Brigade Invite Flow — 2026-05-08 (revised)
--
--  Funksiyalar:
--    - accept_brigade_invite(token)        → invite qəbul et, member ol
--    - decline_brigade_invite(token)       → invite rədd et
--    - my_pending_brigade_invites()        → mənə gələn pending invite-lər
--    - lookup_brigade_invite(token)        → token əsasında invite detalları
--                                            (auth tələb etmir, magic link üçün)
--
--  Trigger:
--    - Yeni invite yaranarkən mövcud user-ə notification göndər
--
--  QEYD: Email/phone əldə edərkən PRIMARY mənbə `auth.users`-dir
--  (həmişə mövcuddur). Profil cədvəli sxemə görə fərqlənə bilər.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ accept_brigade_invite                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.accept_brigade_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite      record;
  v_user_email  text;
  v_user_phone  text;
  v_user_id     uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- 1. Invite-i tap (yalnız pending və müddəti keçməmiş)
  select * into v_invite
  from public.brigade_invites
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_invite is null then
    raise exception 'Invite not found, expired, or already responded';
  end if;

  -- 2. User-in email/phone-unu auth.users-dən götür (həmişə mövcuddur)
  select au.email, au.phone
    into v_user_email, v_user_phone
  from auth.users au
  where au.id = v_user_id;

  -- 3. Match yoxla
  if v_invite.email is not null
     and lower(coalesce(v_user_email, '')) <> lower(v_invite.email) then
    raise exception 'This invite is for a different email address';
  end if;

  if v_invite.phone is not null
     and coalesce(v_user_phone, '') <> v_invite.phone then
    raise exception 'This invite is for a different phone number';
  end if;

  -- 4. Member əlavə et (idempotent)
  insert into public.brigade_members
    (brigade_id, profile_id, role, is_active, commission_pct)
  values
    (v_invite.brigade_id, v_user_id, v_invite.intended_role, true, v_invite.commission_pct)
  on conflict (brigade_id, profile_id) do update
  set
    role           = excluded.role,
    is_active      = true,
    commission_pct = excluded.commission_pct;

  -- 5. Invite-i accepted olaraq qeyd et
  update public.brigade_invites
  set status = 'accepted', responded_at = now()
  where id = v_invite.id;

  -- 6. Brigada owner-ə bildiriş (notifications cədvəli varsa)
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='notifications') then
    insert into public.notifications (user_id, type, title, body, related_id)
    select b.owner_id,
           'brigade_invite_accepted',
           'Dəvət qəbul edildi',
           'Yeni üzv şirkətinizə qatıldı.',
           v_invite.brigade_id::text
    from public.brigades b
    where b.id = v_invite.brigade_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'brigade_id', v_invite.brigade_id,
    'role', v_invite.intended_role
  );
end;
$$;

revoke execute on function public.accept_brigade_invite(uuid) from public, anon;
grant execute on function public.accept_brigade_invite(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ decline_brigade_invite                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.decline_brigade_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_invite
  from public.brigade_invites
  where token = p_token and status = 'pending'
  for update;

  if v_invite is null then
    raise exception 'Invite not found or already responded';
  end if;

  update public.brigade_invites
  set status = 'declined', responded_at = now()
  where id = v_invite.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.decline_brigade_invite(uuid) from public, anon;
grant execute on function public.decline_brigade_invite(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ lookup_brigade_invite — auth tələb etmir (magic link üçün)               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.lookup_brigade_invite(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'token', i.token,
    'status', i.status,
    'intended_role', i.intended_role,
    'commission_pct', i.commission_pct,
    'expires_at', i.expires_at,
    'is_expired', i.expires_at <= now(),
    'invited_email', i.email,
    'invited_phone', i.phone,
    'brigade', jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'description', b.description,
      'logo_url', b.logo_url,
      'is_verified', b.is_verified
    )
  )
  from public.brigade_invites i
  join public.brigades b on b.id = i.brigade_id
  where i.token = p_token
$$;

revoke execute on function public.lookup_brigade_invite(uuid) from public;
grant execute on function public.lookup_brigade_invite(uuid) to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ my_pending_brigade_invites — FIXED (id qeyri-müəyyən idi)                ║
-- ║ Email/phone-u auth.users-dən götürürük (həmişə mövcud, ambiguity yoxdur).║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.my_pending_brigade_invites()
returns table (
  token         uuid,
  intended_role text,
  brigade_id    uuid,
  brigade_name  text,
  brigade_logo  text,
  invited_at    timestamptz,
  expires_at    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select au.email as my_email,
           au.phone as my_phone
    from auth.users au
    where au.id = auth.uid()
  )
  select i.token,
         i.intended_role,
         b.id          as brigade_id,
         b.name        as brigade_name,
         b.logo_url    as brigade_logo,
         i.created_at  as invited_at,
         i.expires_at
  from public.brigade_invites i
  join public.brigades b on b.id = i.brigade_id
  cross join me
  where i.status = 'pending'
    and i.expires_at > now()
    and (
      (i.email is not null and me.my_email is not null
        and lower(i.email) = lower(me.my_email))
      or
      (i.phone is not null and me.my_phone is not null
        and i.phone = me.my_phone)
    )
  order by i.created_at desc
$$;

revoke execute on function public.my_pending_brigade_invites() from public, anon;
grant execute on function public.my_pending_brigade_invites() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Trigger: Invite yaranarkən mövcud user varsa notification göndər         ║
-- ║ auth.users mənbəsi istifadə olunur (profiles asılı deyil).               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public._brigade_invite_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_brigade_name text;
begin
  -- Hədəf user-i auth.users-də tap (profiles asılı deyil)
  if new.email is not null then
    select au.id into v_user_id
    from auth.users au
    where lower(coalesce(au.email, '')) = lower(new.email)
    limit 1;
  end if;

  if v_user_id is null and new.phone is not null then
    select au.id into v_user_id
    from auth.users au
    where coalesce(au.phone, '') = new.phone
    limit 1;
  end if;

  if v_user_id is null then
    return new;  -- user qeydiyyatdan keçməyib, yalnız magic link ilə işləyəcək
  end if;

  -- Notifications cədvəli varsa, bildiriş yaz
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='notifications') then
    return new;
  end if;

  select name into v_brigade_name from public.brigades where id = new.brigade_id;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_user_id,
    'brigade_invite',
    coalesce(v_brigade_name, 'Şirkət') || ' sizi dəvət edir',
    'Şirkətə '
      || case new.intended_role
           when 'dispatcher' then 'dispatcher'
           else 'işçi'
         end
      || ' kimi qatılmaq üçün dəvət aldınız.',
    new.token::text
  );

  return new;
end;
$$;

drop trigger if exists trg_brigade_invite_notify on public.brigade_invites;
create trigger trg_brigade_invite_notify
  after insert on public.brigade_invites
  for each row
  execute function public._brigade_invite_notify();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Verification queries (manual)                                            ║
-- ║                                                                          ║
-- ║   1) Pending invites mənim üçün:                                         ║
-- ║      select * from my_pending_brigade_invites();                         ║
-- ║                                                                          ║
-- ║   2) Token-i lookup et:                                                  ║
-- ║      select lookup_brigade_invite('<token-uuid>'::uuid);                 ║
-- ║                                                                          ║
-- ║   3) Test invite yarat (özünə email göndər):                             ║
-- ║      insert into brigade_invites (brigade_id, invited_by, email)         ║
-- ║      values ('<brigade-uuid>', auth.uid(), 'mənim@email.com');           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
