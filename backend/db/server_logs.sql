-- Server jurnalı: API və worker-in loq qeydləri (app/core/dblog.py) və HTTP
-- fəaliyyət jurnalı (app/core/activity.py). Admin panel → Server jurnalı.
-- Yalnız adminlər oxuyur; yazan yalnız serverin özüdür (klient yaza bilmir).
-- Köhnə qeydləri worker gündə bir dəfə silir (LOG_RETENTION_DAYS, defolt 14).

create table if not exists public.server_logs (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  level      text not null,
  source     text not null,
  logger     text,
  message    text not null,
  context    jsonb
);
create index if not exists server_logs_created_idx on public.server_logs (created_at desc);
create index if not exists server_logs_level_idx on public.server_logs (level, id desc);
create index if not exists server_logs_logger_idx on public.server_logs (logger, id desc);

alter table public.server_logs enable row level security;
revoke all on public.server_logs from anon;
revoke insert, update, delete on public.server_logs from authenticated;
grant select on public.server_logs to authenticated;

drop policy if exists ellit_server_logs_admin on public.server_logs;
create policy ellit_server_logs_admin on public.server_logs for select to authenticated
  using (public.is_admin_user());
