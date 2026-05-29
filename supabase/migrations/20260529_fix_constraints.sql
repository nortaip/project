-- Fix foreign key and status check constraints

-- 1. Add foreign key if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'opportunities_offers'
    and constraint_name = 'opportunities_offers_opportunity_id_fkey'
  ) then
    alter table public.opportunities_offers
    add constraint opportunities_offers_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunities(id) on delete cascade;
  end if;
end $$;

-- 2. Update status check constraint to include pending_review and rejected
alter table public.opportunities
drop constraint if exists opportunities_status_check;

alter table public.opportunities
add constraint opportunities_status_check
  check (status in ('pending', 'open', 'new', 'active', 'accepted', 'i-am-here', 'ongoing', 'pending_review', 'completed', 'disputed', 'refunded', 'cancelled', 'rejected'));
