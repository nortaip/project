-- ============================================================================
-- Düzəliş: pg_net schema istinadı yanlış idi
-- ============================================================================
-- Səbəb: pg_net `net` schema yaradır (yaxud `extensions`).
-- `extensions.net.http_post(...)` cross-db istinad kimi parse olunur.
-- Düzgün: `net.http_post(...)` yaxud `extensions.http_post(...)`.

create or replace function public._send_push_for_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_function_url text :=
    'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/send-push-notification';
  v_anon_key text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
  v_request_id bigint;
begin
  -- pg_net `net` schema-dadır (default Supabase üçün)
  -- search_path-də `net` qoyduq, ona görə net. prefiks lazım deyil
  v_request_id := net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_anon_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('notification_id', NEW.id::text),
    timeout_milliseconds := 5000
  );
  return NEW;
exception
  when others then
    raise warning '[push] send failed: %', sqlerrm;
    return NEW;
end;
$$;

drop trigger if exists trg_notifications_send_push on public.notifications;
create trigger trg_notifications_send_push
  after insert on public.notifications
  for each row
  execute function public._send_push_for_notification();

notify pgrst, 'reload schema';
