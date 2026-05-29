-- Add missing foreign key: opportunities_offers.provider_id -> profiles.id

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'opportunities_offers'
    and constraint_name = 'opportunities_offers_provider_id_fkey'
  ) then
    alter table public.opportunities_offers
    add constraint opportunities_offers_provider_id_fkey
    foreign key (provider_id) references public.profiles(id) on delete cascade;
  end if;
end $$;
