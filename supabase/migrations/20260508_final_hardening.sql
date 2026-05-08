-- ============================================================================
-- FINAL Security Hardening — Pentest follow-up (Phase 6)
--
-- Pentest tapıntıları:
-- H4: service-images bucket-i path/mime məhdudiyyəti yoxdur, DELETE policy yox
-- H5: profiles SELECT `using (true)` — bütün userlar bütün PII-ni görə bilir
-- M3: lookup_brigade_invite invite-in email/phone-unu anon-a qaytarır
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ H5 — profiles SELECT-i məhdudlaşdır                                      ║
-- ║                                                                          ║
-- ║ Customer A artıq Customer B-nin email/phone/balance-ini görə bilməyəcək. ║
-- ║ Hərkəs öz row-unu görür; provayder row-ları public; admin hər şeyi görür║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Helper: caller-in role-unu cache-li qaytarır (recursion-suz)
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select lower(role) in ('admin','master','superadmin')
       from public.profiles where id = auth.uid()),
    false
  );
$$;
revoke execute on function public.is_admin_user from public, anon;
grant   execute on function public.is_admin_user to authenticated;

-- Mövcud policy-ni dəyiş
drop policy if exists "authenticated read profiles" on public.profiles;
create policy "authenticated read profiles"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or coalesce(role, '') = 'provider'
    or public.is_admin_user()
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ H4 — storage.objects (service-images bucket)                             ║
-- ║                                                                          ║
-- ║ INSERT-i path-scope et: `services/<auth.uid()>/...` üçün məhdudla        ║
-- ║ DELETE/UPDATE — yalnız sahibi                                            ║
-- ║ MIME limit: bucket allowed_mime_types ilə Dashboard-da set olunmalı       ║
-- ║ (allowed_mime_types: ['image/jpeg','image/png','image/webp'])            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- service-images bucket-ə file_size_limit + allowed_mime_types tətbiq et
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,         -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
 where id = 'service-images';

-- Köhnə geniş policy-ləri sil
drop policy if exists "Allow authenticated users to upload images" on storage.objects;
drop policy if exists "Allow public to view images" on storage.objects;

-- INSERT: yalnız öz qovluğuna upload edə bilər (services/<uid>/<filename>)
create policy "service_images_owner_upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'service-images'
    and (storage.foldername(name))[1] = 'services'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- SELECT: public bucket — hər kəs oxuya bilər (URL-i bilirsə)
create policy "service_images_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'service-images');

-- DELETE: yalnız sahibi
create policy "service_images_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'service-images'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- UPDATE: yalnız sahibi (məs. metadata replace)
create policy "service_images_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'service-images'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'service-images'
    and (storage.foldername(name))[2] = auth.uid()::text
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ M3 — lookup_brigade_invite-də PII məhdudlaşdır                            ║
-- ║                                                                          ║
-- ║ invited_email/phone artıq qaytarılmır. Yalnız brigade name + role.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.lookup_brigade_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_brigade record;
begin
  select id, brigade_id, role, invited_email, invited_phone, expires_at, status
    into v_invite
    from public.brigade_invites
   where token = p_token;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_invite.status <> 'pending' then
    return jsonb_build_object('valid', false, 'reason', v_invite.status);
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  select id, name, slug into v_brigade
    from public.brigades
   where id = v_invite.brigade_id;

  -- PII məhdud — invitee email/phone qaytarmırıq (referrer leak-ı qarşısı alınır)
  return jsonb_build_object(
    'valid',         true,
    'brigade_id',    v_brigade.id,
    'brigade_name',  v_brigade.name,
    'brigade_slug',  v_brigade.slug,
    'role',          v_invite.role,
    'expires_at',    v_invite.expires_at
  );
end;
$$;

revoke execute on function public.lookup_brigade_invite(text) from public;
grant   execute on function public.lookup_brigade_invite(text) to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Quick verification queries (komment-li, manual yoxlama üçün)              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Customer A-nın Customer B-nin balance-ini görə bilməməsini test et:
--   set role authenticated;
--   set request.jwt.claim.sub to 'CUSTOMER_A_UUID';
--   select balance from profiles where id = 'CUSTOMER_B_UUID';
--   -- Gözlənilən: 0 row (RLS filter)

-- Storage policy testi:
--   insert into storage.objects (bucket_id, name, owner) values ('service-images', 'evil/foo.html', auth.uid());
--   -- Gözlənilən: error (foldername[1] != 'services')
