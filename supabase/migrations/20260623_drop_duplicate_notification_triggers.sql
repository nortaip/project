-- ============================================================================
-- Dublikat bildiriş/push trigger-lərinin təmizlənməsi
--
-- Canlı DB-də hər hadisə üçün iki eyni trigger var idi (köhnə mobil
-- notifications.sql + web 20260512 migration). Nəticə: cüt in-app bildiriş və
-- cüt push. Hər birindən biri (repo migration adı) saxlanılır, dublikat silinir.
--
-- Push tərəfdə iki ayrı edge function çağırılırdı:
--   trg_fcm_dispatch           → send-fcm                (saxlanılır — repo-da var)
--   trg_notifications_send_push → send-push-notification  (trigger silinir)
-- ============================================================================

drop trigger if exists trg_new_opportunity_notify on public.opportunities;
drop trigger if exists trg_new_offer_notify       on public.opportunities_offers;
drop trigger if exists trg_offer_status_notify    on public.opportunities_offers;
drop trigger if exists trg_notifications_send_push on public.notifications;
