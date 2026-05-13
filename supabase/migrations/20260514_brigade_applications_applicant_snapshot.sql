-- ============================================================================
-- Brigade applications — applicant snapshot
--
-- Problem: OAuth ilə qeydiyyatdan keçən istifadəçi auth.users-a düşür,
-- profiles-də adı/maili boş ola bilər. Admin paneldə müraciətçi məlumatları
-- görünmür. Həll: müraciət göndərilərkən applicant-ın adı/email/telefonu
-- auth.users metadata + profiles-dən tutub application-a snapshot kimi yazırıq.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Yeni snapshot sütunları                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.brigade_applications
  add column if not exists applicant_name  text,
  add column if not exists applicant_email text,
  add column if not exists applicant_phone text;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. apply_for_brigade — snapshot daxil et                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.apply_for_brigade(
  p_name          text,
  p_description   text default null,
  p_categories    text[] default '{}',
  p_contact_phone text default null,
  p_contact_email text default null,
  p_address       text default null,
  p_logo_url      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_app_id uuid;
  v_app_name  text;
  v_app_email text;
  v_app_phone text;
  v_meta jsonb;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name required'; end if;

  -- Pending varsa imtina
  if exists (
    select 1 from public.brigade_applications
     where applicant_id = v_caller and status = 'pending'
  ) then
    raise exception 'Sizin artıq aktiv müraciətiniz var';
  end if;

  -- Profil + auth.users metadata-dan applicant snapshot tutub yazırıq
  select coalesce(p.name, ''),
         coalesce(p.email, ''),
         coalesce(p.phone_number, '')
    into v_app_name, v_app_email, v_app_phone
    from public.profiles p
   where p.id = v_caller;

  begin
    select au.raw_user_meta_data, au.email
      into v_meta, v_app_email
      from auth.users au
     where au.id = v_caller;
    -- Email-ı profillə birləşdir
    if v_app_email is null or v_app_email = '' then
      v_app_email := coalesce(v_meta->>'email', '');
    end if;
    if v_app_name is null or v_app_name = '' then
      v_app_name := coalesce(
        v_meta->>'full_name',
        v_meta->>'name',
        v_meta->>'display_name',
        ''
      );
    end if;
    if v_app_phone is null or v_app_phone = '' then
      v_app_phone := coalesce(v_meta->>'phone', v_meta->>'phone_number', '');
    end if;
  exception when others then null;
  end;

  insert into public.brigade_applications (
    applicant_id, name, description, categories,
    contact_phone, contact_email, address, logo_url,
    applicant_name, applicant_email, applicant_phone
  ) values (
    v_caller, p_name, p_description, coalesce(p_categories, '{}'),
    p_contact_phone, p_contact_email, p_address, p_logo_url,
    nullif(v_app_name, ''), nullif(v_app_email, ''), nullif(v_app_phone, '')
  )
  returning id into v_app_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_apply', 'brigade_application', v_app_id::text,
            jsonb_build_object('name', p_name));
  exception when others then null;
  end;

  return v_app_id;
end;
$$;

revoke execute on function public.apply_for_brigade(text, text, text[], text, text, text, text)
  from public, anon;
grant execute on function public.apply_for_brigade(text, text, text[], text, text, text, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Mövcud sətirləri backfill et                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  update public.brigade_applications ba
     set applicant_name = coalesce(
           nullif(ba.applicant_name, ''),
           nullif(p.name, ''),
           nullif(au.raw_user_meta_data->>'full_name', ''),
           nullif(au.raw_user_meta_data->>'name', ''),
           nullif(au.raw_user_meta_data->>'display_name', '')
         ),
         applicant_email = coalesce(
           nullif(ba.applicant_email, ''),
           nullif(p.email, ''),
           nullif(au.email, ''),
           nullif(au.raw_user_meta_data->>'email', '')
         ),
         applicant_phone = coalesce(
           nullif(ba.applicant_phone, ''),
           nullif(p.phone_number, ''),
           nullif(au.raw_user_meta_data->>'phone', ''),
           nullif(au.raw_user_meta_data->>'phone_number', '')
         )
    from public.profiles p
    join auth.users au on au.id = p.id
   where p.id = ba.applicant_id;
exception when others then null;
end$$;


notify pgrst, 'reload schema';
