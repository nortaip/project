-- (2026-09-09, CANLI BAZAYA TƏTBİQ OLUNUB)
-- 1) service_categories.sort_order — yeni xidmətlər siyahının əvvəlində
alter table public.service_categories
  add column if not exists sort_order int not null default 100;

update public.service_categories set sort_order = v.so
from (values
  ('Wolt qeydiyyat', 1), ('Bolt qeydiyyat', 2), ('Yango qeydiyyat', 3),
  ('Evakuasiya xidməti', 4), ('Primiçka xidməti', 5), ('Benzin', 6),
  ('Moto təmiri (Səyyar)', 7), ('Ehtiyyat hissəsi (Səyyar)', 8)
) as v(label, so)
where service_categories.label = v.label;

-- 2) Yeni kateqoriyaların alt-kateqoriyaları (az/ru/en) — tam siyahı
--    Supabase migration tarixçəsində: "new_categories_subcategories"
--    (Wolt/Bolt/Yango: qeydiyyat növləri; Evakuasiya/Primiçka: nəqliyyat
--     növü; Benzin: AI-92/AI-95/Dizel; Moto: təmir növləri; Ehtiyyat
--     hissəsi: hissə növləri)
