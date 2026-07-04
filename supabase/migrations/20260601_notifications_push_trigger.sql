-- ============================================================================
-- Auto push: notifications insert → send-push-notification Edge Function
-- ============================================================================
-- Hər yeni notification yarananda DB trigger Edge Function-u çağırır.
-- App bağlı olsa belə bildirim cihaza çatır.

create extension if not exists pg_net with schema extensions;

-- Edge Function URL və service role key
-- (Manual yenilə əgər project dəyişərsə)
create or replace function public._send_push_for_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_function_url text :=
    'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/send-push-notification';
  v_anon_key text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
begin
  -- Async HTTP POST (pg_net)
  perform extensions.net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_anon_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id::text
    ),
    timeout_milliseconds := 5000
  );
  return NEW;
exception
  when others then
    -- Push uğursuz olsa notification yaradılması bloklanmasın
    raise warning '[push] send failed: %', sqlerrm;
    return NEW;
end;
$$;

drop trigger if exists trg_notifications_send_push on public.notifications;
create trigger trg_notifications_send_push
  after insert on public.notifications
  for each row
  execute function public._send_push_for_notification();

-- Optional: chat_messages üçün də avtomatik notification yaradan trigger
-- (mövcud notif sistemi already chat üçün notification yaradır — yenidən
--  yazmaq lazım deyil)

notify pgrst, 'reload schema';

-- ── Test: SQL Editor-də test üçün
-- insert into public.notifications (user_id, type, title, body, related_id, is_read)
-- values (
--   (select id from auth.users where email = '<test_user_email>' limit 1),
--   'test',
--   'Test bildirim',
--   'Bu bildirim Edge Function vasitəsilə göndərildi',
--   '',
--   false
-- );
