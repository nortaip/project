-- Yeni xidmət kateqoriyaları (2026-09-09, CANLI BAZAYA TƏTBİQ OLUNUB)
insert into public.service_categories (label, label_ru, label_en, is_active)
select v.label, v.label_ru, v.label_en, true
from (values
  ('Wolt qeydiyyat',            'Регистрация Wolt',        'Wolt Registration'),
  ('Bolt qeydiyyat',            'Регистрация Bolt',        'Bolt Registration'),
  ('Yango qeydiyyat',           'Регистрация Yango',       'Yango Registration'),
  ('Evakuasiya xidməti',        'Услуга эвакуатора',       'Towing Service'),
  ('Primiçka xidməti',          'Прикурка авто',           'Jump Start Service'),
  ('Benzin',                    'Доставка бензина',        'Fuel Delivery'),
  ('Moto təmiri (Səyyar)',      'Ремонт мото (выездной)',  'Mobile Moto Repair'),
  ('Ehtiyyat hissəsi (Səyyar)', 'Автозапчасти (доставка)', 'Spare Parts (Mobile)')
) as v(label, label_ru, label_en)
where not exists (
  select 1 from public.service_categories sc where sc.label = v.label
);
