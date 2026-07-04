-- ============================================================================
-- FIX: Komandaya dəvət təklifi "getmir" — alıcı uyğunluğu auth.users.phone-a
-- baxırdı, lakin istifadəçilər telefonu profiles.phone_number-də saxlayır
-- (email/Google ilə girənlərdə auth.users.phone NULL + format fərqli +994/994).
-- Həll: profiles-ə də bax + telefonu normallaşdır (son 9 rəqəm).
-- ============================================================================

create or replace function public.my_pending_brigade_invites()
returns table(
  token uuid, intended_role text, brigade_id uuid, brigade_name text,
  brigade_logo text, invited_at timestamptz, expires_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select coalesce(p.email, au.email) as my_email,
           nullif(right(regexp_replace(coalesce(p.phone_number, au.phone, ''), '[^0-9]', '', 'g'), 9), '') as my_phone9
    from auth.users au
    left join public.profiles p on p.id = au.id
    where au.id = auth.uid()
  )
  select i.token, i.intended_role, b.id, b.name, b.logo_url, i.created_at, i.expires_at
  from public.brigade_invites i
  join public.brigades b on b.id = i.brigade_id
  cross join me
  where i.status = 'pending'
    and i.expires_at > now()
    and (
      (i.email is not null and me.my_email is not null and lower(i.email) = lower(me.my_email))
      or
      (i.phone is not null and me.my_phone9 is not null
        and right(regexp_replace(i.phone, '[^0-9]', '', 'g'), 9) = me.my_phone9)
    )
  order by i.created_at desc
$$;

create or replace function public.accept_brigade_invite(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_invite     record;
  v_user_email text;
  v_user_phone text;
  v_user_id    uuid := auth.uid();
  v_inv_phone9 text;
  v_usr_phone9 text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_invite
  from public.brigade_invites
  where token = p_token and status = 'pending' and expires_at > now()
  for update;
  if v_invite is null then
    raise exception 'Invite not found, expired, or already responded';
  end if;

  select coalesce(p.email, au.email), coalesce(p.phone_number, au.phone)
    into v_user_email, v_user_phone
  from auth.users au
  left join public.profiles p on p.id = au.id
  where au.id = v_user_id;

  if v_invite.email is not null
     and lower(coalesce(v_user_email, '')) <> lower(v_invite.email) then
    raise exception 'This invite is for a different email address';
  end if;

  if v_invite.phone is not null then
    v_inv_phone9 := nullif(right(regexp_replace(v_invite.phone, '[^0-9]', '', 'g'), 9), '');
    v_usr_phone9 := nullif(right(regexp_replace(coalesce(v_user_phone, ''), '[^0-9]', '', 'g'), 9), '');
    if v_inv_phone9 is distinct from v_usr_phone9 then
      raise exception 'This invite is for a different phone number';
    end if;
  end if;

  insert into public.brigade_members
    (brigade_id, profile_id, role, is_active, commission_pct)
  values
    (v_invite.brigade_id, v_user_id, v_invite.intended_role, true, v_invite.commission_pct)
  on conflict (brigade_id, profile_id) do update
  set role = excluded.role, is_active = true, commission_pct = excluded.commission_pct;

  update public.brigade_invites
  set status = 'accepted', responded_at = now()
  where id = v_invite.id;

  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='notifications') then
    begin
      insert into public.notifications (user_id, type, title, body, related_id)
      select b.owner_id, 'brigade_invite_accepted', 'Dəvət qəbul edildi',
             'Yeni üzv şirkətinizə qatıldı.', v_invite.brigade_id::text
      from public.brigades b where b.id = v_invite.brigade_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'brigade_id', v_invite.brigade_id, 'role', v_invite.intended_role);
end;
$$;

notify pgrst, 'reload schema';
