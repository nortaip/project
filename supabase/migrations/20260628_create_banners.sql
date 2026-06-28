-- Ana səhifə reklam bannerləri (admin paneldən idarə olunur)
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text not null,
  link_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists banners_active_sort_idx
  on public.banners (is_active, sort_order);

alter table public.banners enable row level security;

drop policy if exists "banners_public_read_active" on public.banners;
create policy "banners_public_read_active" on public.banners
  for select using (is_active = true);

drop policy if exists "banners_admin_read_all" on public.banners;
create policy "banners_admin_read_all" on public.banners
  for select using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
  );

drop policy if exists "banners_admin_write" on public.banners;
create policy "banners_admin_write" on public.banners
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
  ) with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
  );

grant select on public.banners to anon, authenticated;
grant insert, update, delete on public.banners to authenticated;

-- Banner şəkilləri üçün public storage bucket
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do update set public = true;

drop policy if exists "banners_img_public_read" on storage.objects;
create policy "banners_img_public_read" on storage.objects
  for select using (bucket_id = 'banners');

drop policy if exists "banners_img_admin_write" on storage.objects;
create policy "banners_img_admin_write" on storage.objects
  for all using (
    bucket_id = 'banners' and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
  ) with check (
    bucket_id = 'banners' and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
  );
