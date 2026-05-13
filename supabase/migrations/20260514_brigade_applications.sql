-- ============================================================================
-- Faza 1: Briqada açılışı admin-only
--
-- Dəyişikliklər:
--   1. brigade_applications cədvəli — provider müraciəti
--   2. brigades.insert RLS sıxılır — yalnız admin (RPC üzərindən)
--   3. RPC apply_for_brigade — provider yeni müraciət göndərir
--   4. RPC admin_approve_brigade_application — admin briqadanı yaradır
--   5. RPC admin_reject_brigade_application — admin imtina edir
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. brigade_applications                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.brigade_applications (
  id              uuid primary key default gen_random_uuid(),
  applicant_id    uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  description     text,
  categories      text[] not null default '{}',
  contact_phone   text,
  contact_email   text,
  address         text,
  logo_url        text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note      text,
  brigade_id      uuid references public.brigades(id) on delete set null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id) on delete set null
);

create index if not exists brigade_applications_applicant_idx
  on public.brigade_applications (applicant_id);
create index if not exists brigade_applications_status_idx
  on public.brigade_applications (status);

-- Bir applicant üçün eyni anda yalnız 1 pending müraciət
create unique index if not exists brigade_applications_one_pending_idx
  on public.brigade_applications (applicant_id)
  where status = 'pending';

alter table public.brigade_applications enable row level security;

drop policy if exists "applicant reads own applications" on public.brigade_applications;
create policy "applicant reads own applications"
  on public.brigade_applications for select to authenticated
  using (
    auth.uid() = applicant_id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

-- Yazma yalnız RPC üzərindən (security definer)
revoke insert, update, delete on public.brigade_applications from authenticated, anon;

grant select on public.brigade_applications to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. brigades.insert lockdown — yalnız admin                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop policy if exists "owner creates brigade" on public.brigades;
create policy "admin creates brigade"
  on public.brigades for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC: apply_for_brigade                                                ║
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
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name required'; end if;

  -- Mövcud pending varsa, onu qaytar (unique index zatən bunu tutar)
  select id into v_app_id
    from public.brigade_applications
   where applicant_id = v_caller and status = 'pending'
   limit 1;
  if v_app_id is not null then
    raise exception 'Sizin artıq aktiv müraciətiniz var';
  end if;

  insert into public.brigade_applications (
    applicant_id, name, description, categories,
    contact_phone, contact_email, address, logo_url
  ) values (
    v_caller, p_name, p_description, coalesce(p_categories, '{}'),
    p_contact_phone, p_contact_email, p_address, p_logo_url
  )
  returning id into v_app_id;

  -- Audit
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
-- ║ 4. RPC: admin_approve_brigade_application                                ║
-- ║   Admin briqadanı yaradır, owner_id = applicant_id                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_approve_brigade_application(
  p_application_id uuid,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_app        record;
  v_brigade_id uuid;
  v_is_admin   boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_app from public.brigade_applications
   where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status;
  end if;

  -- Briqada yarat
  insert into public.brigades (
    owner_id, name, description, categories,
    contact_phone, contact_email, address, logo_url,
    is_verified
  ) values (
    v_app.applicant_id, v_app.name, v_app.description, v_app.categories,
    v_app.contact_phone, v_app.contact_email, v_app.address, v_app.logo_url,
    true
  )
  returning id into v_brigade_id;

  -- Applicant-ı owner üzv kimi əlavə et (mövcud trigger zatən belə edir,
  -- amma trigger yoxdursa fallback)
  begin
    insert into public.brigade_members (brigade_id, profile_id, role, is_active)
    values (v_brigade_id, v_app.applicant_id, 'owner', true)
    on conflict do nothing;
  exception when others then null;
  end;

  -- Müraciəti təsdiqlənmiş kimi qeyd et
  update public.brigade_applications
     set status = 'approved',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_note,
         brigade_id = v_brigade_id
   where id = p_application_id;

  -- Notification → applicant
  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_app.applicant_id,
      'Briqada təsdiqləndi',
      coalesce(v_app.name,'Briqada') || ' admin tərəfindən təsdiqləndi.',
      'brigade_approved',
      v_brigade_id::text,
      '/brigades/' || v_brigade_id::text
    );
  exception when others then null;
  end;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_approve', 'brigade_application', p_application_id::text,
            jsonb_build_object('brigade_id', v_brigade_id, 'note', p_note));
  exception when others then null;
  end;

  return v_brigade_id;
end;
$$;

revoke execute on function public.admin_approve_brigade_application(uuid, text)
  from public, anon;
grant execute on function public.admin_approve_brigade_application(uuid, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. RPC: admin_reject_brigade_application                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_reject_brigade_application(
  p_application_id uuid,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_app    record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_app from public.brigade_applications where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status;
  end if;

  update public.brigade_applications
     set status = 'rejected',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_reason
   where id = p_application_id;

  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_app.applicant_id,
      'Briqada müraciəti imtina edildi',
      coalesce(p_reason, 'Müraciətiniz qəbul olunmadı.'),
      'brigade_rejected',
      p_application_id::text,
      '/brigades'
    );
  exception when others then null;
  end;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_reject', 'brigade_application', p_application_id::text,
            jsonb_build_object('reason', p_reason));
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_reject_brigade_application(uuid, text)
  from public, anon;
grant execute on function public.admin_reject_brigade_application(uuid, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. RPC: cancel_brigade_application — applicant öz pending-i ləğv edir    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.cancel_brigade_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_app    record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_app from public.brigade_applications where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.applicant_id <> v_caller then raise exception 'Forbidden'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Cannot cancel %', v_app.status;
  end if;

  update public.brigade_applications
     set status = 'cancelled', decided_at = now()
   where id = p_application_id;
end;
$$;

revoke execute on function public.cancel_brigade_application(uuid) from public, anon;
grant execute on function public.cancel_brigade_application(uuid) to authenticated;


notify pgrst, 'reload schema';
