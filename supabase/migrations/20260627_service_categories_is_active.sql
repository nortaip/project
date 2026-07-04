-- Kateqoriyaları deaktiv etmək imkanı (müştəriyə görünməsin, amma silinməsin)
alter table public.service_categories
  add column if not exists is_active boolean not null default true;

-- Mövcud sətirləri aktiv saxla
update public.service_categories set is_active = true where is_active is null;

notify pgrst, 'reload schema';
