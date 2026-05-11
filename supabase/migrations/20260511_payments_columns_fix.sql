-- ============================================================================
-- payments + transactions sütunlarını sinxronlaşdır
--
-- Problem: `payments` cədvəlində `currency` (və digər) sütunları yoxdur,
-- bu da `create-payment-session` Edge Function-da error verir:
--   "Could not find the 'currency' column of 'payments' in the schema cache"
--
-- Bu migrasiya hər bir lazımi sütunu IF NOT EXISTS ilə əlavə edir.
-- Mövcud verilərə təsir etmir.
-- ============================================================================

-- ── payments ────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid()
);

alter table public.payments
  add column if not exists user_id      uuid references public.profiles(id) on delete cascade;
alter table public.payments
  add column if not exists amount       numeric(12,2) not null default 0;
alter table public.payments
  add column if not exists currency     text not null default 'AZN';
alter table public.payments
  add column if not exists status       text not null default 'pending';
alter table public.payments
  add column if not exists provider     text not null default 'epoint';
alter table public.payments
  add column if not exists external_id  text;
alter table public.payments
  add column if not exists description  text;
alter table public.payments
  add column if not exists metadata     jsonb not null default '{}'::jsonb;
alter table public.payments
  add column if not exists created_at   timestamptz not null default now();
alter table public.payments
  add column if not exists completed_at timestamptz;

-- status CHECK constraint (varsa drop edib yenidən qoy)
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.payments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;

  alter table public.payments
    add constraint payments_status_check
    check (status in ('pending','completed','failed','refunded','cancelled'));
end;
$$;

-- provider CHECK (Epoint inteqrasiyasından başqa manual/test də olur)
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.payments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%provider%';
  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;

  alter table public.payments
    add constraint payments_provider_check
    check (provider in ('epoint','kapitalbank','manual','test'));
end;
$$;

create index if not exists payments_user_id_idx
  on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx
  on public.payments (status, created_at desc);

-- ── transactions ────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid()
);

alter table public.transactions
  add column if not exists user_id        uuid references public.profiles(id) on delete cascade;
alter table public.transactions
  add column if not exists type           text not null default 'top_up';
alter table public.transactions
  add column if not exists amount         numeric(12,2) not null default 0;
alter table public.transactions
  add column if not exists balance_after  numeric(12,2) not null default 0;
alter table public.transactions
  add column if not exists description    text;
alter table public.transactions
  add column if not exists related_id     text;
alter table public.transactions
  add column if not exists payment_id     uuid references public.payments(id) on delete set null;
alter table public.transactions
  add column if not exists created_by     uuid references public.profiles(id) on delete set null;
alter table public.transactions
  add column if not exists created_at     timestamptz not null default now();

create index if not exists transactions_user_id_idx
  on public.transactions (user_id, created_at desc);

-- ── PostgREST cache reload ──────────────────────────────────────────────
-- Bu vacibdir — yoxsa edge function hələ də "column not found" deyə bilər
notify pgrst, 'reload schema';
