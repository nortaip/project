-- ============================================================================
-- Multilingual support for service catalog
--
-- service_categories, service_subcategories, service_questions cədvəllərinə
-- ru/en variantları əlavə edir. Mövcud `label` AZ olaraq qalır (default).
--
-- Translation strategy:
--   - label    → AZ (qalır, dəyişmir)
--   - label_ru → RU tərcümə (NULL olarsa, label fallback)
--   - label_en → EN tərcümə (NULL olarsa, label fallback)
--
-- Frontend i18n.language-ə görə uyğun column seçir.
-- ============================================================================

-- service_categories
alter table public.service_categories add column if not exists label_ru text;
alter table public.service_categories add column if not exists label_en text;

-- service_subcategories
alter table public.service_subcategories add column if not exists label_ru text;
alter table public.service_subcategories add column if not exists label_en text;

-- service_questions
alter table public.service_questions add column if not exists label_ru       text;
alter table public.service_questions add column if not exists label_en       text;
alter table public.service_questions add column if not exists question_ru    text;
alter table public.service_questions add column if not exists question_en    text;
alter table public.service_questions add column if not exists placeholder_ru text;
alter table public.service_questions add column if not exists placeholder_en text;
alter table public.service_questions add column if not exists options_ru     jsonb;
alter table public.service_questions add column if not exists options_en     jsonb;

-- PostgREST cache reload
notify pgrst, 'reload schema';

-- ============================================================================
-- İSTİFADƏ:
--   Admin paneldən hər kateqoriya/sual üçün label_ru və label_en doldurulur.
--   Boşdursa frontend AZ-a fallback edir.
-- ============================================================================
