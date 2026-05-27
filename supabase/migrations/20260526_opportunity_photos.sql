-- ============================================================================
-- Müştəri opportunity post edərkən şəkillər əlavə edə bilsin.
-- Provider iş haqqında tam fikir əldə etsin (visual context).
--
-- Path format: {user_id}/{timestamp}_{filename}
--   • Upload: yalnız öz user_id altına (RLS)
--   • Read: bucket public (provider və müştəri görür)
--   • Delete: yalnız upload edən
-- ============================================================================

-- 1. opportunities.photos sütunu (text[] of public URLs)
alter table public.opportunities
  add column if not exists photos text[] not null default '{}';

-- 2. Storage bucket — opportunity-photos (public read, 5 MB limit)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'opportunity-photos',
  'opportunity-photos',
  true,  -- public read (providers & customers see)
  5242880,  -- 5 MB per photo
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. RLS policies
drop policy if exists "opportunity photos upload" on storage.objects;
create policy "opportunity photos upload"
  on storage.objects for insert
  with check (
    bucket_id = 'opportunity-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "opportunity photos delete" on storage.objects;
create policy "opportunity photos delete"
  on storage.objects for delete
  using (
    bucket_id = 'opportunity-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "opportunity photos update" on storage.objects;
create policy "opportunity photos update"
  on storage.objects for update
  using (
    bucket_id = 'opportunity-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- SELECT: bucket public, default işləyir. RLS policy əlavə etmirik.

notify pgrst, 'reload schema';
