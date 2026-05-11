-- ============================================================================
-- audit_log schema sync
--
-- Mövcud sxemdə yalnız `actor_id` və `target_id` var idi, amma sonrakı
-- RPC-lər (`admin_update_commission`, `admin_set_role`, `apply_promotion`...)
-- `actor` və `target_type` sütunlarına insert edir → INSERT səssiz fail olur,
-- exception handler udur, log boş qalır, Dashboard "Son fəaliyyət" boş çıxır.
--
-- Düzəliş: əksik sütunları əlavə et + actor_id-ni avtomatik doldurmaq üçün
-- backfill trigger.
-- ============================================================================

alter table public.audit_log
  add column if not exists actor       uuid references auth.users(id) on delete set null,
  add column if not exists target_type text;

-- Köhnə sətrlər üçün actor_id ↔ actor backfill (hər iki istiqamətdə)
update public.audit_log
   set actor = actor_id
 where actor is null and actor_id is not null;

update public.audit_log
   set actor_id = actor
 where actor_id is null and actor is not null;

-- Trigger: insert/update zamanı hansı sahə doldurulubsa o birini də sinxronlaşdır
create or replace function public.audit_log_sync_actor()
returns trigger
language plpgsql
as $$
begin
  if new.actor is null and new.actor_id is not null then
    new.actor := new.actor_id;
  elsif new.actor_id is null and new.actor is not null then
    new.actor_id := new.actor;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_log_sync_actor on public.audit_log;
create trigger trg_audit_log_sync_actor
  before insert or update on public.audit_log
  for each row execute function public.audit_log_sync_actor();

notify pgrst, 'reload schema';
