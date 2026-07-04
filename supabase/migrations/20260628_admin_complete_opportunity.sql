-- Admin sifariş tamamlanmasını təsdiqləyir: pending_review -> completed.
-- Escrow buraxılışı (auto_release_on_opportunity_complete trigger) avtomatik baş verir.
create or replace function public.admin_complete_opportunity(p_opportunity_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_caller and role in ('admin', 'master', 'superadmin')
  ) then
    raise exception 'Only admin can approve orders';
  end if;

  select status into v_status from public.opportunities where id = p_opportunity_id;
  if v_status is null then
    raise exception 'Opportunity not found';
  end if;

  -- Yalnız təsdiq gözləyən (və ya hələ aktiv) sifarişlər təsdiqlənə bilər
  if v_status = 'completed' then
    return 'already_completed';
  end if;
  if v_status not in ('pending_review', 'ongoing', 'i-am-here', 'accepted') then
    raise exception 'Order is not awaiting approval (status: %)', v_status;
  end if;

  update public.opportunities
     set status = 'completed'
   where id = p_opportunity_id;

  return 'completed';
end;
$$;

grant execute on function public.admin_complete_opportunity(uuid) to authenticated;
