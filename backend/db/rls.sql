-- ============================================================================
-- Sətir səviyyəli icazələr (RLS) — Supabase-uyğun giriş qatı üçün.
--
-- Bu fayl canlı Supabase bazasının RLS siyasətlərindən və GRANT-larından
-- GENERASİYA olunub (117 siyasətdən public sxeminə aid 97-si olduğu kimi).
-- Veb və mobil tətbiq cədvəllərə /rest/v1 üzərindən müraciət edəndə backend
-- tranzaksiyada `SET LOCAL ROLE authenticated|anon` edir və PostgreSQL bu
-- siyasətləri özü tətbiq edir — yəni klientin görə/dəyişə bildiyi sətirlər
-- Supabase-dəki ilə eynidir.
--
-- Backend-in öz servis kodu cədvəl sahibi kimi qoşulur və RLS-dən kənardır.
--
-- Əlavə sərtləşdirmə (`ellit_` prefiksli siyasət/trigger-lər): canlıda RLS-i
-- SÖNDÜRÜLMÜŞ 16 cədvəl (profiles, services, bookings, kataloq...) burada
-- qorunur — məs. istifadəçi başqasının profilini və ya öz balansını dəyişə bilməz.
--
-- Fayl idempotentdir (alembic 0004 tətbiq edir).
-- ============================================================================

-- ── Rollar ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
exception when insufficient_privilege then
  raise exception 'anon/authenticated rollarını yaratmaq üçün icazə yoxdur. Superuser ilə bir dəfə icra edin: CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; GRANT anon, authenticated TO %;', current_user;
end $$;
do $$
begin
  execute format('grant anon, authenticated to %I', current_user);
exception when others then null;  -- superuser onsuz da SET ROLE edə bilir
end $$;
grant usage on schema public to anon, authenticated;

-- ── auth.* köməkçiləri (Supabase-dəki auth.uid() və s. əvəzi) ───────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), 'anon')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('app.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.email() returns text language sql stable as $$
  select auth.jwt() ->> 'email'
$$;
grant execute on function auth.uid(), auth.role(), auth.jwt(), auth.email() to anon, authenticated;

-- ── Siyasətlərin istifadə etdiyi yoxlama funksiyaları (canlıdan olduğu kimi) ─

CREATE OR REPLACE FUNCTION public.is_admin_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select lower(role) in ('admin','master','superadmin')
       from public.profiles where id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.brigade_role(p_brigade_id uuid, p_profile_id uuid DEFAULT auth.uid())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select bm.role
  from public.brigade_members bm
  where bm.brigade_id = p_brigade_id
    and bm.profile_id = p_profile_id
    and bm.is_active = true
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.is_brigade_dispatcher(p_brigade_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.brigade_members
     where brigade_id = p_brigade_id
       and profile_id = p_user_id
       and is_active = true
       and role in ('owner', 'dispatcher')
  );
$function$;

CREATE OR REPLACE FUNCTION public._is_assigned_brigade_member(p_opp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.brigade_assignments ba
      join public.brigade_members bm on bm.id = ba.member_id
     where ba.source_id = p_opp_id::text
       and bm.profile_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public._is_offer_provider(p_offer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.opportunities_offers
     where id = p_offer_id and provider_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public._is_opportunity_owner(p_opp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.opportunities
     where id = p_opp_id and created_by = auth.uid());
$function$;

revoke all on function public.is_admin_user(), public.brigade_role(uuid, uuid),
  public.is_brigade_dispatcher(uuid, uuid), public._is_assigned_brigade_member(uuid),
  public._is_offer_provider(uuid), public._is_opportunity_owner(uuid) from public;
grant execute on function public.is_admin_user(), public.brigade_role(uuid, uuid),
  public.is_brigade_dispatcher(uuid, uuid), public._is_assigned_brigade_member(uuid),
  public._is_offer_provider(uuid), public._is_opportunity_owner(uuid) to anon, authenticated;

-- ── Görünüş: public_profiles ──
create or replace view public.public_profiles as
 SELECT profiles.id,
    profiles.name,
    profiles.role,
    profiles.created_at,
    profiles.is_verified,
    profiles.avatar_url,
    profiles.rating
   FROM profiles
  WHERE COALESCE(profiles.status, 'active'::text) <> 'banned'::text;

-- ── GRANT-lar (canlı ilə eyni) ───────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update, delete on public.announcements to anon;
grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.audit_log to anon;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.banners to anon;
grant select, insert, update, delete on public.banners to authenticated;
grant select, insert, update, delete on public.bookings to anon;
grant select, insert, update, delete on public.bookings to authenticated;
grant select on public.brigade_applications to anon;
grant select on public.brigade_applications to authenticated;
grant select, update, delete on public.brigade_assignments to anon;
grant select, update, delete on public.brigade_assignments to authenticated;
grant select, insert, update, delete on public.brigade_invites to anon;
grant select, insert, update, delete on public.brigade_invites to authenticated;
grant select, insert, update, delete on public.brigade_members to anon;
grant select, insert, update, delete on public.brigade_members to authenticated;
grant select, insert, update, delete on public.brigade_prices to anon;
grant select, insert, update, delete on public.brigade_prices to authenticated;
grant select, insert, update, delete on public.brigades to anon;
grant select, insert, update, delete on public.brigades to authenticated;
grant select, insert, update, delete on public.chat_messages to anon;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant select, insert, update, delete on public.config to anon;
grant select, insert, update, delete on public.config to authenticated;
grant select, insert, update, delete on public.conversations to anon;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.dispute_attachments to anon;
grant select, insert, update, delete on public.dispute_attachments to authenticated;
grant select, insert, update, delete on public.disputes to anon;
grant select, insert, update, delete on public.disputes to authenticated;
grant select, insert, update, delete on public.featured_services to anon;
grant select, insert, update, delete on public.featured_services to authenticated;
grant select, insert, update, delete on public.messages to anon;
grant select, insert, update, delete on public.messages to authenticated;
grant select, update on public.notifications to anon;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.opportunities to authenticated;
grant select, update, delete on public.opportunities_offers to authenticated;
grant select, insert, update, delete on public.opportunity_audit_log to anon;
grant select, insert, update, delete on public.opportunity_audit_log to authenticated;
grant select on public.payments to anon;
grant select on public.payments to authenticated;
grant select on public.platform_config to anon;
grant select on public.platform_config to authenticated;
grant select, insert, update, delete on public.popular_services to anon;
grant select, insert, update, delete on public.popular_services to authenticated;
grant select, insert, update, delete on public.profiles to anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.promo_codes to anon;
grant select, insert, update, delete on public.promo_codes to authenticated;
grant select on public.promo_redemptions to anon;
grant select on public.promo_redemptions to authenticated;
grant select, insert, update, delete on public.promotion_plans to anon;
grant select, insert, update, delete on public.promotion_plans to authenticated;
grant select on public.provider_bonus_logs to anon;
grant select on public.provider_bonus_logs to authenticated;
grant select, insert, update, delete on public.provider_commissions_logs to anon;
grant select, insert, update, delete on public.provider_commissions_logs to authenticated;
grant select on public.provider_requests to anon;
grant select on public.provider_requests to authenticated;
grant select, insert, update, delete on public.provider_reviews to anon;
grant select, insert, update, delete on public.provider_reviews to authenticated;
grant select, insert, update, delete on public.provider_status to anon;
grant select, insert, update, delete on public.provider_status to authenticated;
grant select, insert, update, delete on public.provider_verifications to anon;
grant select, insert, update, delete on public.provider_verifications to authenticated;
grant select on public.provider_wallets to anon;
grant select on public.provider_wallets to authenticated;
grant select, insert, update, delete on public.public_profiles to anon;
grant select, insert, update, delete on public.public_profiles to authenticated;
grant select, insert, update, delete on public.service_categories to anon;
grant select, insert, update, delete on public.service_categories to authenticated;
grant select, insert, update, delete on public.service_prices to anon;
grant select, insert, update, delete on public.service_prices to authenticated;
grant select, insert, update, delete on public.service_questions to anon;
grant select, insert, update, delete on public.service_questions to authenticated;
grant select, insert, update, delete on public.service_subcategories to anon;
grant select, insert, update, delete on public.service_subcategories to authenticated;
grant select, insert, update, delete on public.service_text_translations to anon;
grant select, insert, update, delete on public.service_text_translations to authenticated;
grant select, insert, update, delete on public.services to anon;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.transactions to anon;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.user_blocks to anon;
grant select, insert, update, delete on public.user_blocks to authenticated;
grant select, insert, update, delete on public.user_devices to anon;
grant select, insert, update, delete on public.user_devices to authenticated;
grant select, insert, update, delete on public.user_settings to anon;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.user_transactions to anon;
grant select, insert, update, delete on public.user_transactions to authenticated;
grant select on public.withdrawals to anon;
grant select on public.withdrawals to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── RLS + siyasətlər (canlıdan olduğu kimi) ─────────────────────────────────
-- Əvvəlki tətbiqdən qalan bütün siyasətlər silinir ki, fayl tam mənbə olsun
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.announcements enable row level security;
alter table public.audit_log enable row level security;
alter table public.banners enable row level security;
alter table public.bookings enable row level security;
alter table public.brigade_applications enable row level security;
alter table public.brigade_assignments enable row level security;
alter table public.brigade_invites enable row level security;
alter table public.brigade_members enable row level security;
alter table public.brigade_prices enable row level security;
alter table public.brigades enable row level security;
alter table public.chat_messages enable row level security;
alter table public.config enable row level security;
alter table public.conversations enable row level security;
alter table public.dispute_attachments enable row level security;
alter table public.disputes enable row level security;
alter table public.featured_services enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunities_offers enable row level security;
alter table public.opportunity_audit_log enable row level security;
alter table public.password_otps enable row level security;
alter table public.payments enable row level security;
alter table public.platform_config enable row level security;
alter table public.popular_services enable row level security;
alter table public.profiles enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.promotion_plans enable row level security;
alter table public.provider_bonus_logs enable row level security;
alter table public.provider_commissions_logs enable row level security;
alter table public.provider_requests enable row level security;
alter table public.provider_reviews enable row level security;
alter table public.provider_status enable row level security;
alter table public.provider_verifications enable row level security;
alter table public.provider_wallets enable row level security;
alter table public.service_categories enable row level security;
alter table public.service_prices enable row level security;
alter table public.service_questions enable row level security;
alter table public.service_subcategories enable row level security;
alter table public.service_text_translations enable row level security;
alter table public.services enable row level security;
alter table public.transactions enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_devices enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_transactions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.users enable row level security;
alter table public.oauth_identities enable row level security;
alter table public.refresh_sessions enable row level security;


-- audit_log
create policy "admins read audit log" on public.audit_log
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(profiles.role) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));

-- banners
create policy "banners_admin_read_all" on public.banners
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "banners_admin_write" on public.banners
  as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "banners_public_read_active" on public.banners
  as permissive for select to public
  using ((is_active = true));

-- brigade_applications
create policy "applicant reads own applications" on public.brigade_applications
  as permissive for select to authenticated
  using (((auth.uid() = applicant_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- brigade_assignments
create policy "members read brigade assignments" on public.brigade_assignments
  as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM brigade_members bm
  WHERE ((bm.brigade_id = brigade_assignments.brigade_id) AND (bm.profile_id = auth.uid()) AND (bm.is_active = true)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "members update own assignments or dispatcher updates any" on public.brigade_assignments
  as permissive for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM brigade_members bm
  WHERE ((bm.id = brigade_assignments.member_id) AND (bm.profile_id = auth.uid())))) OR is_brigade_dispatcher(brigade_id, auth.uid())));

-- brigade_invites
create policy "owner creates invite" on public.brigade_invites
  as permissive for insert to authenticated
  with check ((brigade_role(brigade_id) = ANY (ARRAY['owner'::text, 'dispatcher'::text])));
create policy "owner reads invites" on public.brigade_invites
  as permissive for select to authenticated
  using ((brigade_role(brigade_id) = ANY (ARRAY['owner'::text, 'dispatcher'::text])));
create policy "owner updates invite" on public.brigade_invites
  as permissive for update to authenticated
  using ((brigade_role(brigade_id) = ANY (ARRAY['owner'::text, 'dispatcher'::text])));

-- brigade_members
create policy "members read team" on public.brigade_members
  as permissive for select to authenticated
  using (((brigade_role(brigade_id) IS NOT NULL) OR (auth.uid() = profile_id)));
create policy "owner manages members" on public.brigade_members
  as permissive for all to authenticated
  using (((EXISTS ( SELECT 1
   FROM brigades b
  WHERE ((b.id = brigade_members.brigade_id) AND (b.owner_id = auth.uid())))) OR (brigade_role(brigade_id) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))))
  with check (((EXISTS ( SELECT 1
   FROM brigades b
  WHERE ((b.id = brigade_members.brigade_id) AND (b.owner_id = auth.uid())))) OR (brigade_role(brigade_id) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

-- brigade_prices
create policy "admin manages all prices" on public.brigade_prices
  as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "anyone read brigade prices" on public.brigade_prices
  as permissive for select to authenticated
  using (true);
create policy "dispatcher manages prices" on public.brigade_prices
  as permissive for all to authenticated
  using (is_brigade_dispatcher(brigade_id, auth.uid()))
  with check (is_brigade_dispatcher(brigade_id, auth.uid()));

-- brigades
create policy "admin creates brigade" on public.brigades
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "anyone read brigades" on public.brigades
  as permissive for select to anon, authenticated
  using (((is_active = true) OR (auth.uid() = owner_id)));
create policy "owner deletes brigade" on public.brigades
  as permissive for delete to authenticated
  using ((auth.uid() = owner_id));
create policy "owner updates brigade" on public.brigades
  as permissive for update to authenticated
  using ((auth.uid() = owner_id))
  with check ((auth.uid() = owner_id));

-- chat_messages
create policy "admin read all chat_messages" on public.chat_messages
  as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((auth.uid() = c.customer_id) OR (auth.uid() = c.provider_id))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text])))))));
create policy "chat_msg insert" on public.chat_messages
  as permissive for insert to public
  with check (((auth.uid() = sender_id) AND ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((auth.uid() = c.customer_id) OR (auth.uid() = c.provider_id))))) OR (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))))))));
create policy "chat_msg mark read" on public.chat_messages
  as permissive for update to public
  using (((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((auth.uid() = c.customer_id) OR (auth.uid() = c.provider_id))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "chat_msg read" on public.chat_messages
  as permissive for select to public
  using (((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((auth.uid() = c.customer_id) OR (auth.uid() = c.provider_id))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- config
create policy "Admins can insert config" on public.config
  as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
create policy "Admins can read config" on public.config
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
create policy "Admins can update config" on public.config
  as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- conversations
create policy "admin read all conversations" on public.conversations
  as permissive for select to authenticated
  using (((auth.uid() = customer_id) OR (auth.uid() = provider_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text])))))));
create policy "conv insert" on public.conversations
  as permissive for insert to public
  with check (((auth.uid() = customer_id) OR (auth.uid() = provider_id)));
create policy "conv read" on public.conversations
  as permissive for select to public
  using (((auth.uid() = customer_id) OR (auth.uid() = provider_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "conv update" on public.conversations
  as permissive for update to public
  using (((auth.uid() = customer_id) OR (auth.uid() = provider_id)));

-- dispute_attachments
create policy "participants can read attachments" on public.dispute_attachments
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM disputes d
  WHERE ((d.id = dispute_attachments.dispute_id) AND ((auth.uid() = d.raised_by) OR (auth.uid() = d.against_user) OR (EXISTS ( SELECT 1
           FROM profiles
          WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'support'::text]))))))))));

-- disputes
create policy "no direct insert" on public.disputes
  as permissive for insert to public
  with check (false);
create policy "no direct update" on public.disputes
  as permissive for update to public
  using (false);
create policy "participants can read disputes" on public.disputes
  as permissive for select to public
  using (((auth.uid() = raised_by) OR (auth.uid() = against_user) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'support'::text])))))));

-- notifications
create policy "users can insert own notifications" on public.notifications
  as permissive for insert to authenticated
  with check ((auth.uid() = user_id));
create policy "users can read own notifications" on public.notifications
  as permissive for select to authenticated
  using ((auth.uid() = user_id));
create policy "users can update own notifications" on public.notifications
  as permissive for update to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "users insert own notifications" on public.notifications
  as permissive for insert to authenticated
  with check ((auth.uid() = user_id));
create policy "users read own notifications" on public.notifications
  as permissive for select to authenticated
  using ((auth.uid() = user_id));
create policy "users update own notifications" on public.notifications
  as permissive for update to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

-- opportunities
create policy "opportunities_insert_own" on public.opportunities
  as permissive for insert to authenticated
  with check ((auth.uid() = created_by));
create policy "opportunities_select_assigned_member" on public.opportunities
  as permissive for select to authenticated
  using (_is_assigned_brigade_member(id));
create policy "opportunities_select_scoped" on public.opportunities
  as permissive for select to authenticated
  using (((created_by = auth.uid()) OR (provider_id = auth.uid()) OR (status = ANY (ARRAY['pending'::text, 'open'::text, 'new'::text, 'active'::text])) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "opportunities_update_owner_provider_admin" on public.opportunities
  as permissive for update to public
  using (((auth.uid() = created_by) OR (auth.uid() = provider_id) OR ((accepted_offer_id IS NOT NULL) AND _is_offer_provider(accepted_offer_id)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))))
  with check (((auth.uid() = created_by) OR (auth.uid() = provider_id) OR ((accepted_offer_id IS NOT NULL) AND _is_offer_provider(accepted_offer_id)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- opportunities_offers
create policy "Admins can update offer payout status" on public.opportunities_offers
  as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "Providers can update own offer completion evidence" on public.opportunities_offers
  as permissive for update to public
  using ((auth.uid() = provider_id))
  with check ((auth.uid() = provider_id));
create policy "offers_select_provider_customer_admin" on public.opportunities_offers
  as permissive for select to public
  using (((auth.uid() = provider_id) OR _is_opportunity_owner(opportunity_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "offers_update_provider_customer_admin" on public.opportunities_offers
  as permissive for update to public
  using (((auth.uid() = provider_id) OR _is_opportunity_owner(opportunity_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "verified providers only" on public.opportunities_offers
  as permissive for insert to public
  with check (((auth.uid() = provider_id) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_verified = true) OR (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'support'::text]))))))));

-- opportunity_audit_log
create policy "users can read own audit" on public.opportunity_audit_log
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM opportunities o
  WHERE ((o.id = opportunity_audit_log.opportunity_id) AND ((o.created_by = auth.uid()) OR (o.provider_id = auth.uid()))))));

-- payments
create policy "admin read all payments" on public.payments
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text]))))));
create policy "users read own payments" on public.payments
  as permissive for select to authenticated
  using ((auth.uid() = user_id));

-- platform_config
create policy "anyone read platform config" on public.platform_config
  as permissive for select to anon, authenticated
  using (true);

-- profiles
create policy "Allow all users to read profiles" on public.profiles
  as permissive for select to anon, authenticated
  using (true);
create policy "Allow authenticated users to insert their profile" on public.profiles
  as permissive for insert to public
  with check ((auth.uid() = id));
create policy "Allow users to select their profile" on public.profiles
  as permissive for select to public
  using ((auth.uid() = id));
create policy "Allow users to update their profile" on public.profiles
  as permissive for update to public
  using ((auth.uid() = id));
create policy "authenticated read profiles" on public.profiles
  as permissive for select to authenticated
  using (((auth.uid() = id) OR (COALESCE(role, ''::text) = 'provider'::text) OR is_admin_user()));
create policy "providers visible to all" on public.profiles
  as permissive for select to anon, authenticated
  using (((role = 'provider'::text) AND (is_online = true)));
create policy "users update own profile or admin update any" on public.profiles
  as permissive for update to authenticated
  using (((auth.uid() = id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))))
  with check (((auth.uid() = id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- promo_codes
create policy "admin manage promo_codes" on public.promo_codes
  as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));

-- promo_redemptions
create policy "admin read redemptions" on public.promo_redemptions
  as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))) OR (auth.uid() = user_id)));

-- provider_bonus_logs
create policy "providers read own bonus logs" on public.provider_bonus_logs
  as permissive for select to authenticated
  using ((auth.uid() = provider_id));
create policy "users read own provider_bonus_logs" on public.provider_bonus_logs
  as permissive for select to authenticated
  using ((auth.uid() = provider_id));

-- provider_requests
create policy "user reads own requests" on public.provider_requests
  as permissive for select to authenticated
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- provider_reviews
create policy "Allow authenticated users to create reviews" on public.provider_reviews
  as permissive for insert to authenticated
  with check (true);
create policy "Allow authenticated users to read reviews" on public.provider_reviews
  as permissive for select to authenticated
  using (true);

-- provider_status
create policy "provider_status_select_all" on public.provider_status
  as permissive for select to public
  using (true);
create policy "provider_status_update_self" on public.provider_status
  as permissive for update to public
  using ((auth.uid() = provider_id))
  with check ((auth.uid() = provider_id));

-- provider_verifications
create policy "no direct kyc insert" on public.provider_verifications
  as permissive for insert to public
  with check (false);
create policy "no direct kyc update" on public.provider_verifications
  as permissive for update to public
  using (false);
create policy "own kyc read" on public.provider_verifications
  as permissive for select to public
  using (((auth.uid() = provider_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'support'::text])))))));

-- provider_wallets
create policy "Enable delete for users based on user_id" on public.provider_wallets
  as permissive for delete to public
  using (true);
create policy "User can read own wallet" on public.provider_wallets
  as permissive for select to public
  using ((provider_id = auth.uid()));
create policy "admin read all wallets" on public.provider_wallets
  as permissive for select to authenticated
  using (((auth.uid() = provider_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text])))))));
create policy "providers read own wallet" on public.provider_wallets
  as permissive for select to authenticated
  using ((auth.uid() = provider_id));
create policy "users read own provider_wallets" on public.provider_wallets
  as permissive for select to authenticated
  using ((auth.uid() = provider_id));

-- service_text_translations
create policy "sxt_read" on public.service_text_translations
  as permissive for select to public
  using (true);

-- services
create policy "Allow all users to insert services" on public.services
  as permissive for insert to public
  with check (true);
create policy "Allow all users to select services" on public.services
  as permissive for select to public
  using (true);
create policy "Allow authenticated users to insert services" on public.services
  as permissive for insert to authenticated
  with check (true);
create policy "Allow update for authenticated users" on public.services
  as permissive for update to public
  using ((auth.uid() = provider_id));

-- transactions
create policy "admin read all transactions" on public.transactions
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text]))))));
create policy "users read own transactions" on public.transactions
  as permissive for select to authenticated
  using ((auth.uid() = user_id));

-- user_blocks
create policy "users create own blocks" on public.user_blocks
  as permissive for insert to authenticated
  with check (((auth.uid() = blocker_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "users delete own blocks" on public.user_blocks
  as permissive for delete to authenticated
  using (((auth.uid() = blocker_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));
create policy "users read own blocks" on public.user_blocks
  as permissive for select to authenticated
  using (((auth.uid() = blocker_id) OR (auth.uid() = blocked_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text])))))));

-- user_devices
create policy "admin all devices" on public.user_devices
  as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "self-manage device tokens" on public.user_devices
  as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "users delete own device" on public.user_devices
  as permissive for delete to authenticated
  using ((auth.uid() = user_id));
create policy "users insert own device" on public.user_devices
  as permissive for insert to authenticated
  with check ((auth.uid() = user_id));
create policy "users select own device" on public.user_devices
  as permissive for select to authenticated
  using ((auth.uid() = user_id));
create policy "users update own device" on public.user_devices
  as permissive for update to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

-- user_settings
create policy "Users manage their own settings" on public.user_settings
  as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

-- withdrawals
create policy "admin read all withdrawals" on public.withdrawals
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text, 'support'::text]))))));
create policy "admins read all withdrawals" on public.withdrawals
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (lower(COALESCE(profiles.role, ''::text)) = ANY (ARRAY['admin'::text, 'master'::text, 'superadmin'::text]))))));
create policy "providers read own withdrawals" on public.withdrawals
  as permissive for select to authenticated
  using ((auth.uid() = provider_id));


-- ============================================================================
-- Sərtləşdirmə: canlıda RLS-i söndürülmüş cədvəllər
-- ============================================================================

-- profiles: hamı oxuyur (canlıdakı kimi); yalnız öz sətrini və ya admin dəyişir
create policy ellit_profiles_select on public.profiles for select to anon, authenticated using (true);
create policy ellit_profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.is_admin_user());
create policy ellit_profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin_user())
  with check (id = auth.uid() or public.is_admin_user());
create policy ellit_profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin_user());

-- Kataloq və vitrin cədvəlləri: hamı oxuyur, yalnız admin yazır
do $$
declare t text;
begin
  foreach t in array array['service_categories','service_subcategories','service_questions',
                           'service_prices','promotion_plans','featured_services',
                           'popular_services','announcements']
  loop
    execute format('create policy ellit_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy ellit_admin_write on public.%I for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user())', t);
  end loop;
end $$;

-- services: hamı oxuyur; sahibi və ya admin yazır
create policy ellit_services_select on public.services for select to anon, authenticated using (true);
create policy ellit_services_insert on public.services for insert to authenticated
  with check (provider_id = auth.uid() or public.is_admin_user());
create policy ellit_services_update on public.services for update to authenticated
  using (provider_id = auth.uid() or public.is_admin_user())
  with check (provider_id = auth.uid() or public.is_admin_user());
create policy ellit_services_delete on public.services for delete to authenticated
  using (provider_id = auth.uid() or public.is_admin_user());

-- bookings: yalnız tərəflər və admin
create policy ellit_bookings_select on public.bookings for select to authenticated
  using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin_user());
create policy ellit_bookings_insert on public.bookings for insert to authenticated
  with check (customer_id = auth.uid() or public.is_admin_user());
create policy ellit_bookings_update on public.bookings for update to authenticated
  using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin_user())
  with check (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin_user());
create policy ellit_bookings_delete on public.bookings for delete to authenticated
  using (public.is_admin_user());

-- provider_reviews: hamı oxuyur; rəyi yalnız həmin təklifin müştərisi yazır
create policy ellit_reviews_select on public.provider_reviews for select to anon, authenticated using (true);
create policy ellit_reviews_insert on public.provider_reviews for insert to authenticated
  with check (
    public.is_admin_user() or exists (
      select 1 from public.opportunities_offers oo
        join public.opportunities op on op.id = oo.opportunity_id
       where oo.id = offer_id and oo.provider_id = provider_reviews.provider_id
         and op.created_by = auth.uid()));
create policy ellit_reviews_admin on public.provider_reviews for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- provider_status: hamı oxuyur; öz statusunu və ya admin yazır
create policy ellit_pstatus_select on public.provider_status for select to anon, authenticated using (true);
create policy ellit_pstatus_write on public.provider_status for all to authenticated
  using (provider_id = auth.uid() or public.is_admin_user())
  with check (provider_id = auth.uid() or public.is_admin_user());

-- messages: yalnız göndərən/alan
create policy ellit_messages_select on public.messages for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin_user());
create policy ellit_messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid());
create policy ellit_messages_update on public.messages for update to authenticated
  using (receiver_id = auth.uid() or public.is_admin_user());

-- Maliyyə jurnalları: sahibi oxuyur, yalnız admin yazır
create policy ellit_pcl_select on public.provider_commissions_logs for select to authenticated
  using (provider_id = auth.uid() or public.is_admin_user());
create policy ellit_pcl_admin on public.provider_commissions_logs for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy ellit_utx_select on public.user_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin_user());
create policy ellit_utx_admin on public.user_transactions for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- ── Qorunan sütunlar ────────────────────────────────────────────────────────
-- Klient (anon/authenticated rolu) pul, təsdiq və reytinq sütunlarını dəyişə
-- bilməz; admin rolunu özünə verə bilməz. Dəyişiklik səssizcə nəzərə alınmır
-- ki, bütöv obyekt göndərən köhnə klient kodu sınmasın. Backend servis kodu
-- (cədvəl sahibi kimi qoşulur) bu məhdudiyyətdən kənardır.
create or replace function public.ellit_guard_profile_columns() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.balance := 0;
    new.bonus_balance := 0;
    new.total_bonus_earned := 0;
    new.is_verified := false;
    new.verification_status := 'not_submitted';
    new.last_kyc_approved_at := null;
    new.rating := null;
    new.rating_count := 0;
    if lower(coalesce(new.role, '')) not in ('customer', 'provider') then
      new.role := 'customer';
    end if;
  else
    new.balance := old.balance;
    new.bonus_balance := old.bonus_balance;
    new.total_bonus_earned := old.total_bonus_earned;
    new.is_verified := old.is_verified;
    new.verification_status := old.verification_status;
    new.last_kyc_approved_at := old.last_kyc_approved_at;
    new.rating := old.rating;
    new.rating_count := old.rating_count;
    if lower(coalesce(new.role, '')) not in ('customer', 'provider')
       or lower(coalesce(old.role, '')) not in ('customer', 'provider') then
      new.role := old.role;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ellit_guard_profile_columns on public.profiles;
create trigger ellit_guard_profile_columns before insert or update on public.profiles
  for each row execute function public.ellit_guard_profile_columns();

-- profiles.role → users.role (API-nin rol yoxlaması ilə sinxron)
create or replace function public.ellit_sync_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    update public.users set role = left(new.role, 24) where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists ellit_sync_user_role on public.profiles;
create trigger ellit_sync_user_role after update of role on public.profiles
  for each row execute function public.ellit_sync_user_role();

-- services: elanın pullu təşviq sütunlarını klient özü dəyişə bilməz
create or replace function public.ellit_guard_service_columns() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.promotion_paid := false;
    new.promotion_expires_at := null;
    new.rating := null;
    new.reviews_count := 0;
    new.view_count := 0;
  else
    new.promotion_paid := old.promotion_paid;
    new.promotion_expires_at := old.promotion_expires_at;
    new.rating := old.rating;
    new.reviews_count := old.reviews_count;
    new.provider_id := old.provider_id;
  end if;
  return new;
end $$;
drop trigger if exists ellit_guard_service_columns on public.services;
create trigger ellit_guard_service_columns before insert or update on public.services
  for each row execute function public.ellit_guard_service_columns();

-- ============================================================================
-- Realtime: dəyişiklik siqnalı (Supabase `supabase_realtime` nəşrinin əvəzi)
-- ============================================================================
-- Yalnız (cədvəl, əməliyyat, açar) göndərilir; sətrin özünü backend hər
-- abunəçinin RLS konteksti ilə yenidən oxuyur — icazəsiz sətir sızmır.
create or replace function public.ellit_notify_change() returns trigger
language plpgsql as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_pk  text  := tg_argv[0];
begin
  perform pg_notify('ellit_rt', json_build_object(
    't', tg_table_name, 'op', tg_op, 'pk', v_pk, 'id', v_row ->> v_pk,
    'ts', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('opportunities', 'id'),
    ('opportunities_offers', 'id'),
    ('profiles', 'id'),
    ('provider_status', 'provider_id'),
    ('provider_wallets', 'provider_id'),
    ('services', 'id'),
    ('notifications', 'id'),
    ('brigades', 'id'),
    ('brigade_members', 'id'),
    ('brigade_assignments', 'id'),
    ('withdrawals', 'id'),
    ('brigade_prices', 'id'),
    ('disputes', 'id'),
    ('dispute_attachments', 'id'),
    ('opportunity_audit_log', 'id'),
    ('provider_verifications', 'id'),
    ('conversations', 'id'),
    ('chat_messages', 'id')
  ) as v(tbl, pk) loop
    execute format('drop trigger if exists ellit_notify_change on public.%I', r.tbl);
    execute format('create trigger ellit_notify_change after insert or update or delete on public.%I
                    for each row execute function public.ellit_notify_change(%L)', r.tbl, r.pk);
  end loop;
end $$;
