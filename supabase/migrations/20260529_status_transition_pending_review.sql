-- Update status transition rules to allow ongoing -> pending_review
-- This allows providers to submit evidence and wait for admin review

-- Drop existing trigger and function
drop trigger if exists trg_validate_opportunity_status on public.opportunities;
drop function if exists public.validate_opportunity_status() cascade;

-- Recreate with updated rules
create function public.validate_opportunity_status()
returns trigger as $$
declare
  v_allowed boolean;
begin
  v_allowed := case
    when old.status in ('pending', 'open', 'new') and new.status in ('accepted', 'cancelled') then true
    when old.status = 'accepted'   and new.status in ('i-am-here', 'ongoing', 'cancelled', 'refunded') then true
    when old.status = 'i-am-here'  and new.status in ('ongoing', 'cancelled', 'refunded') then true
    when old.status = 'ongoing'    and new.status in ('pending_review', 'completed', 'cancelled', 'refunded') then true
    when old.status = 'pending_review' and new.status in ('completed', 'rejected', 'refunded') then true
    when old.status = 'completed'  and new.status in ('disputed', 'refunded') then true
    when old.status = 'disputed'   and new.status in ('completed', 'refunded') then true
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: % -> % (opportunity %)',
      old.status, new.status, old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$
language plpgsql;

-- Recreate trigger
create trigger trg_validate_opportunity_status
  before update on public.opportunities
  for each row
  execute function public.validate_opportunity_status();
