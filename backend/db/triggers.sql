-- ============================================================================
-- Ellit backend-in ÖZ trigger dəsti (Supabase-dən asılı deyil).
--
-- Prinsip: biznes axınları (bildiriş, push, escrow, bonus, broadcast) Python
-- servis qatındadır. Bazada yalnız aşağıdakılar qalır:
--   1) texniki gigiyena  — updated_at, güzgü sütunlar, normallaşdırma
--   2) bütövlük qaydaları — status keçid matrisi, ləğv səbəbi
--   3) audit izi          — sifariş statusu tarixçəsi, təyinat auditi
--
-- Aktyor (kim etdi) `auth.uid()` yerinə `app.user_id` sessiya dəyişənindən
-- oxunur; backend hər tranzaksiyada onu təyin edir (app/db/session.py).
--
-- Fayl idempotentdir: həm alembic (0002), həm Supabase köçürməsindən sonrakı
-- təmizləmə (scripts/migrate_from_supabase.sh) onu təkrar tətbiq edə bilər.
-- Bütün obyektlər `ellit_` prefiksi daşıyır — köçürmə skripti bu prefiksi
-- daşımayan köhnə Supabase trigger/funksiyalarını silir.
-- ============================================================================

create or replace function public.ellit_actor() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ── 1. Gigiyena ──────────────────────────────────────────────────────────────
create or replace function public.ellit_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['opportunities_offers','disputes','provider_verifications',
                           'provider_status','user_settings','provider_wallets',
                           'brigades','brigade_prices','config']
  loop
    execute format('drop trigger if exists ellit_touch_updated_at on public.%I', t);
    execute format('create trigger ellit_touch_updated_at before update on public.%I
                    for each row execute function public.ellit_touch_updated_at()', t);
  end loop;
end $$;

create or replace function public.ellit_audit_log_sync_actor() returns trigger
language plpgsql as $$
begin
  if new.actor is null and new.actor_id is not null then
    new.actor := new.actor_id;
  elsif new.actor_id is null and new.actor is not null then
    new.actor_id := new.actor;
  end if;
  return new;
end $$;
drop trigger if exists ellit_audit_log_sync_actor on public.audit_log;
create trigger ellit_audit_log_sync_actor before insert or update on public.audit_log
  for each row execute function public.ellit_audit_log_sync_actor();

create or replace function public.ellit_normalize_profile_email() returns trigger
language plpgsql as $$
begin
  if new.email is not null and trim(new.email) = '' then
    new.email := null;
  end if;
  return new;
end $$;
drop trigger if exists ellit_normalize_profile_email on public.profiles;
create trigger ellit_normalize_profile_email before insert or update of email on public.profiles
  for each row execute function public.ellit_normalize_profile_email();

create or replace function public.ellit_sync_profile_online_state() returns trigger
language plpgsql as $$
begin
  if new.is_online is distinct from old.is_online then
    new.availability_status := case when new.is_online then 'online' else 'offline' end;
    new.status := case when new.is_online then 'online' else 'offline' end;
  end if;
  return new;
end $$;
drop trigger if exists ellit_sync_profile_online_state on public.profiles;
create trigger ellit_sync_profile_online_state before update of is_online on public.profiles
  for each row execute function public.ellit_sync_profile_online_state();

-- profiles.balance tək mənbədir; provider_wallets.balance onun güzgüsüdür
create or replace function public.ellit_sync_provider_wallet_balance() returns trigger
language plpgsql as $$
begin
  if new.balance is distinct from old.balance then
    update public.provider_wallets
       set balance = new.balance, updated_at = now()
     where provider_id = new.id;
    if not found then
      insert into public.provider_wallets (provider_id, balance)
      values (new.id, new.balance)
      on conflict (provider_id) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ellit_sync_provider_wallet_balance on public.profiles;
create trigger ellit_sync_provider_wallet_balance after update of balance on public.profiles
  for each row execute function public.ellit_sync_provider_wallet_balance();

create or replace function public.ellit_cleanup_wallet_on_role_change() returns trigger
language plpgsql as $$
begin
  if lower(coalesce(new.role, '')) not in ('provider', 'pro', 'seller')
     and lower(coalesce(old.role, '')) in ('provider', 'pro', 'seller') then
    update public.provider_wallets
       set balance = 0, locked_balance = 0, updated_at = now()
     where provider_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists ellit_cleanup_wallet_on_role_change on public.profiles;
create trigger ellit_cleanup_wallet_on_role_change after update of role on public.profiles
  for each row execute function public.ellit_cleanup_wallet_on_role_change();

create or replace function public.ellit_refresh_provider_rating() returns trigger
language plpgsql as $$
declare
  v_provider uuid := coalesce(new.provider_id, old.provider_id);
  v_avg numeric;
  v_cnt integer;
begin
  select round(avg(rating)::numeric, 2), count(*) into v_avg, v_cnt
    from public.provider_reviews
   where provider_id = v_provider and rating is not null;
  update public.profiles
     set rating = coalesce(v_avg, 0), rating_count = coalesce(v_cnt, 0)
   where id = v_provider;
  return coalesce(new, old);
end $$;
drop trigger if exists ellit_refresh_provider_rating on public.provider_reviews;
create trigger ellit_refresh_provider_rating after insert or delete or update on public.provider_reviews
  for each row execute function public.ellit_refresh_provider_rating();

create or replace function public.ellit_brigade_auto_owner() returns trigger
language plpgsql as $$
begin
  insert into public.brigade_members (brigade_id, profile_id, role, is_active)
  values (new.id, new.owner_id, 'owner', true)
  on conflict (brigade_id, profile_id) do nothing;
  return new;
end $$;
drop trigger if exists ellit_brigade_auto_owner on public.brigades;
create trigger ellit_brigade_auto_owner after insert on public.brigades
  for each row execute function public.ellit_brigade_auto_owner();

-- ── 2. Bütövlük qaydaları (sifariş statusu) ─────────────────────────────────
create or replace function public.ellit_validate_opportunity_status() returns trigger
language plpgsql as $$
declare v_allowed boolean;
begin
  if new.status = old.status then return new; end if;
  -- Admin müdaxiləsi (lifecycle.set_opportunity_status) — tranzaksiya-lokal bayraq
  if coalesce(current_setting('app.status_override', true), '') = 'on' then
    return new;
  end if;
  v_allowed := case
    when old.status in ('pending','open','new') and new.status in ('accepted','cancelled') then true
    when old.status = 'accepted'       and new.status in ('i-am-here','ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'i-am-here'      and new.status in ('ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'ongoing'        and new.status in ('pending_review','completed','cancelled','refunded') then true
    when old.status = 'pending_review' and new.status in ('completed','rejected','refunded') then true
    when old.status = 'completed'      and new.status in ('disputed','refunded') then true
    when old.status = 'disputed'       and new.status in ('completed','refunded') then true
    else false
  end;
  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: % -> % (opportunity %)', old.status, new.status, old.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ellit_validate_opportunity_status on public.opportunities;
create trigger ellit_validate_opportunity_status before update on public.opportunities
  for each row execute function public.ellit_validate_opportunity_status();

create or replace function public.ellit_require_cancellation_reason() returns trigger
language plpgsql as $$
begin
  if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
    raise exception 'CANCELLATION_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ellit_require_cancellation_reason on public.opportunities;
create trigger ellit_require_cancellation_reason before update of status on public.opportunities
  for each row when (new.status = 'cancelled')
  execute function public.ellit_require_cancellation_reason();

create or replace function public.ellit_set_opportunity_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists ellit_set_opportunity_completed_at on public.opportunities;
create trigger ellit_set_opportunity_completed_at before update of status on public.opportunities
  for each row execute function public.ellit_set_opportunity_completed_at();

-- pending_review-ə keçəndə qəbul edilmiş təklif admin təsdiq növbəsinə düşür
create or replace function public.ellit_sync_payout_on_review() returns trigger
language plpgsql as $$
begin
  if new.status = 'pending_review'
     and coalesce(old.status, '') <> 'pending_review'
     and new.accepted_offer_id is not null then
    update public.opportunities_offers
       set payout_status = 'pending_review'
     where id = new.accepted_offer_id and payout_status is null;
  end if;
  return new;
end $$;
drop trigger if exists ellit_sync_payout_on_review on public.opportunities;
create trigger ellit_sync_payout_on_review after update of status on public.opportunities
  for each row execute function public.ellit_sync_payout_on_review();

-- ── 3. Audit izi ─────────────────────────────────────────────────────────────
create or replace function public.ellit_log_opportunity_status() returns trigger
language plpgsql as $$
declare
  v_actor uuid := public.ellit_actor();
  v_role  text;
begin
  if new.status is distinct from old.status then
    select coalesce(role, '') into v_role from public.profiles where id = v_actor;
    insert into public.opportunity_audit_log
      (opportunity_id, old_status, new_status, actor_id, actor_role, reason)
    values (
      new.id, old.status, new.status, v_actor,
      case
        when v_actor is null then 'system'
        when v_actor = old.created_by then 'customer'
        when v_actor = old.provider_id then 'provider'
        else coalesce(nullif(v_role, ''), 'unknown')
      end,
      new.cancellation_reason
    );
  end if;
  return new;
end $$;
drop trigger if exists ellit_log_opportunity_status on public.opportunities;
create trigger ellit_log_opportunity_status after update of status on public.opportunities
  for each row execute function public.ellit_log_opportunity_status();

create or replace function public.ellit_brigade_assignment_audit() returns trigger
language plpgsql as $$
declare
  v_member_profile uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  select profile_id into v_member_profile from public.brigade_members where id = new.member_id;
  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (
    coalesce(new.assigned_by, v_member_profile),
    'assignment_' || new.status, 'brigade_assignment', new.id::text,
    jsonb_build_object(
      'brigade_id', new.brigade_id, 'member_id', new.member_id,
      'member_profile_id', v_member_profile, 'source_id', new.source_id,
      'status', new.status,
      'old_status', case when tg_op = 'UPDATE' then old.status else null end)
  );
  return new;
exception when others then
  return new;  -- audit uğursuzluğu əsas əməliyyatı dayandırmasın
end $$;
drop trigger if exists ellit_brigade_assignment_audit on public.brigade_assignments;
create trigger ellit_brigade_assignment_audit after insert or update on public.brigade_assignments
  for each row execute function public.ellit_brigade_assignment_audit();
