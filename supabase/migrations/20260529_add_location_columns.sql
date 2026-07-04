-- Add latitude and longitude columns to opportunities table
-- If they don't exist

-- Check if columns exist before adding
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'opportunities' and column_name = 'latitude'
  ) then
    alter table public.opportunities add column latitude numeric;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'opportunities' and column_name = 'longitude'
  ) then
    alter table public.opportunities add column longitude numeric;
  end if;
end $$;

-- Parse location string and populate latitude/longitude for existing opportunities
-- Location format: "latitude, longitude"
update public.opportunities
set
  latitude = (trim(split_part(location, ',', 1)))::numeric,
  longitude = (trim(split_part(location, ',', 2)))::numeric
where location is not null
  and location like '%,%'
  and (latitude is null or longitude is null)
  and trim(split_part(location, ',', 1)) ~ '^\d+\.?\d*$'
  and trim(split_part(location, ',', 2)) ~ '^\d+\.?\d*$';