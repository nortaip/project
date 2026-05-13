-- ============================================================================
-- Provider role müraciəti — admin təsdiqi tələb olunur
--
-- Qaydalar:
--   1. İstifadəçi qeydiyyatda və ya profildən "Provayder ol" seçəndə
--      role = 'customer' qalır, lakin pending request yaradılır.
--   2. Admin paneldə müraciətlər siyahısı görsənir.
--   3. Təsdiqlədikdə → role = 'provider' (admin_set_user_role çağırılır).
--   4. İmtina edildikdə → role 'customer' qalır, notification göndərilir.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. provider_requests cədvəli                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.provider_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message       text,                       -- Niyə provayder olmaq istəyir
  company_name  text,
  experience_years int,
  specialties   text[] not null default '{}',
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note    text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null
);

create index if not exists provider_requests_user_idx
  on public.provider_requests (user_id);
create index if not exists provider_requests_status_idx
  on public.provider_requests (status);

-- Bir user üçün yalnız 1 pending request
create unique index if not exists provider_requests_one_pending_idx
  on public.provider_requests (user_id)
  where status = 'pending';

alter table public.provider_requests enable row level security;
alter table public.provider_requests replica identity full;

drop policy if exists "user reads own requests" on public.provider_requests;
create policy "user reads own requests"
  on public.provider_requests for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

revoke insert, update, delete on public.provider_requests from authenticated, anon;
grant select on public.provider_requests to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. RPC: request_provider_role                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.request_provider_role(
  p_message          text default null,
  p_company_name     text default null,
  p_experience_years int  default null,
  p_specialties      text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_req_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select lower(coalesce(role,'')) into v_role from public.profiles where id = v_caller;
  if v_role in ('provider','admin','master','superadmin') then
    raise exception 'Siz artıq provayder/admin statusundasınız';
  end if;

  if exists (
    select 1 from public.provider_requests
     where user_id = v_caller and status = 'pending'
  ) then
    raise exception 'Sizin artıq aktiv müraciətiniz var';
  end if;

  insert into public.provider_requests
    (user_id, message, company_name, experience_years, specialties)
  values
    (v_caller, p_message, p_company_name, p_experience_years, coalesce(p_specialties, '{}'))
  returning id into v_req_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'provider_request', 'provider_request', v_req_id::text,
            jsonb_build_object('message', p_message));
  exception when others then null;
  end;

  return v_req_id;
end;
$$;

revoke execute on function public.request_provider_role(text, text, int, text[])
  from public, anon;
grant execute on function public.request_provider_role(text, text, int, text[])
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC: admin_approve_provider_request                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_approve_provider_request(
  p_request_id uuid,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_req      record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Request already %', v_req.status;
  end if;

  -- Profili yenilə: role + müraciətdə qeyd olunan provider sahələri
  update public.profiles
     set role = 'provider',
         company_name      = coalesce(v_req.company_name,     company_name),
         experience_years  = coalesce(v_req.experience_years, experience_years),
         specialties       = case when array_length(v_req.specialties,1) > 0
                                  then v_req.specialties
                                  else specialties end
   where id = v_req.user_id;

  update public.provider_requests
     set status = 'approved',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_note
   where id = p_request_id;

  -- Notification
  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_req.user_id,
      'Provayder statusu təsdiqləndi',
      'Artıq sifariş qəbul edə bilərsiniz.',
      'provider_approved',
      p_request_id::text,
      '/account'
    );
  exception when others then null;
  end;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'provider_approve', 'provider_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id));
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_approve_provider_request(uuid, text)
  from public, anon;
grant execute on function public.admin_approve_provider_request(uuid, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. RPC: admin_reject_provider_request                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_reject_provider_request(
  p_request_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_req    record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Request already %', v_req.status;
  end if;

  update public.provider_requests
     set status = 'rejected',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_reason
   where id = p_request_id;

  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_req.user_id,
      'Provayder müraciəti imtina edildi',
      coalesce(p_reason, 'Müraciətiniz qəbul olunmadı.'),
      'provider_rejected',
      p_request_id::text,
      '/account'
    );
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_reject_provider_request(uuid, text)
  from public, anon;
grant execute on function public.admin_reject_provider_request(uuid, text)
  to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. RPC: cancel_provider_request — user öz pending-i ləğv edir            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.cancel_provider_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_req    record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.user_id <> v_caller then raise exception 'Forbidden'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Cannot cancel %', v_req.status;
  end if;

  update public.provider_requests
     set status = 'cancelled', decided_at = now()
   where id = p_request_id;
end;
$$;

revoke execute on function public.cancel_provider_request(uuid) from public, anon;
grant execute on function public.cancel_provider_request(uuid) to authenticated;


notify pgrst, 'reload schema';
