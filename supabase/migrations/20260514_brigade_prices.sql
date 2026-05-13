-- ============================================================================
-- Faza 2: Per-briqada sabit qiymət
--
-- Hər briqada öz kateqoriya/alt-kateqoriya üzrə sabit qiymət təyin edir.
-- Customer sifariş açanda bu qiymət göstərilir — bid yox, fix price.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ brigade_prices                                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.brigade_prices (
  id              uuid primary key default gen_random_uuid(),
  brigade_id      uuid not null references public.brigades(id) on delete cascade,
  category_id     uuid not null references public.service_categories(id) on delete cascade,
  subcategory_id  uuid references public.service_subcategories(id) on delete cascade,
  unit            text not null default 'job'
                    check (unit in ('job', 'hour', 'm2', 'piece', 'day')),
  price           numeric(12,2) not null check (price >= 0),
  currency        text not null default 'AZN',
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists brigade_prices_brigade_idx
  on public.brigade_prices (brigade_id);
create index if not exists brigade_prices_category_idx
  on public.brigade_prices (category_id, subcategory_id);

-- Unique per (brigade, category, subcategory, unit) — NULL-safe
create unique index if not exists brigade_prices_unique_idx
  on public.brigade_prices (
    brigade_id,
    category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    unit
  );

-- updated_at trigger
create or replace function public.tg_brigade_prices_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists brigade_prices_touch on public.brigade_prices;
create trigger brigade_prices_touch
  before update on public.brigade_prices
  for each row execute function public.tg_brigade_prices_touch();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ RLS                                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.brigade_prices enable row level security;

-- Oxu: bütün autentifikasiya olunmuş istifadəçilər (müştəri qiyməti görsün)
drop policy if exists "anyone read brigade prices" on public.brigade_prices;
create policy "anyone read brigade prices"
  on public.brigade_prices for select to authenticated
  using (true);

-- Yazı: yalnız brigade owner / dispatcher (mövcud is_brigade_dispatcher helper)
drop policy if exists "dispatcher manages prices" on public.brigade_prices;
create policy "dispatcher manages prices"
  on public.brigade_prices for all to authenticated
  using (is_brigade_dispatcher(brigade_id, auth.uid()))
  with check (is_brigade_dispatcher(brigade_id, auth.uid()));

-- Admin də idarə edə bilər
drop policy if exists "admin manages all prices" on public.brigade_prices;
create policy "admin manages all prices"
  on public.brigade_prices for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

grant select, insert, update, delete on public.brigade_prices to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime                                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='brigade_prices'
  ) then
    alter publication supabase_realtime add table public.brigade_prices;
  end if;
end$$;

notify pgrst, 'reload schema';
