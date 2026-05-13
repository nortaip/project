-- ============================================================================
-- Faza 4: Offer expiry — 60 saniyə ərzində qəbul olmayan offer-lər expired olur
--
-- pg_cron ilə hər 30 saniyədən bir işlədilməsi nəzərdə tutulur.
-- pg_cron yoxdursa, edge function və ya client tərəfdə (inbox load) çağırıla bilər.
-- ============================================================================

create or replace function public.expire_stale_offers(
  p_threshold_seconds int default 60
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with updated as (
    update public.brigade_assignments
       set status = 'expired',
           responded_at = now()
     where status in ('offered', 'assigned')
       and assigned_by is null
       and assigned_at < now() - make_interval(secs => p_threshold_seconds)
     returning id
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

-- Bütün authenticated istifadəçilər çağıra bilər (own offers expire olunur,
-- güvənlik baxımından zərərsiz: yalnız status update edir)
revoke execute on function public.expire_stale_offers(int) from public, anon;
grant   execute on function public.expire_stale_offers(int) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ pg_cron job (əgər mövcuddursa) — hər 30 saniyə                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    perform cron.unschedule('expire_stale_offers')
      where exists (
        select 1 from cron.job where jobname = 'expire_stale_offers'
      );
    perform cron.schedule(
      'expire_stale_offers',
      '*/1 * * * *',
      $cmd$ select public.expire_stale_offers(60) $cmd$
    );
  end if;
exception when others then null;
end$$;

notify pgrst, 'reload schema';
