-- ============================================================================
-- Balance Schema Alignment — defensive
--
-- Problem: 20260508_balance_system.sql `CREATE TABLE IF NOT EXISTS payments`
-- işlədir. Əgər DB-də `payments` köhnə strukturla artıq mövcuddursa, yeni
-- sütunlar (created_at, metadata, external_id, ...) yaradılmır.
--
-- Bu migration HƏR sütunu defensiv yoxlayıb əlavə edir, sonra index-lər və
-- function-ları yaradır.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ profiles — balance + bonus_balance sütunları                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='balance') then
    alter table public.profiles add column balance numeric(12,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='bonus_balance') then
    alter table public.profiles add column bonus_balance numeric(12,2) not null default 0;
  end if;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ provider_wallets — yarat (yoxdursa) və ya çatışmayan sütunları əlavə et   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.provider_wallets (
  provider_id uuid primary key references public.profiles(id) on delete cascade
);

do $$
declare
  cols text[] := array[
    'balance|numeric(12,2) not null default 0',
    'bonus_balance|numeric(12,2) not null default 0',
    'total_earned|numeric(12,2) not null default 0',
    'total_withdrawn|numeric(12,2) not null default 0',
    'updated_at|timestamptz not null default now()'
  ];
  spec text;
  col_name text;
  col_def text;
begin
  foreach spec in array cols loop
    col_name := split_part(spec, '|', 1);
    col_def  := split_part(spec, '|', 2);
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='provider_wallets' and column_name=col_name
    ) then
      execute format('alter table public.provider_wallets add column %I %s', col_name, col_def);
    end if;
  end loop;
end $$;

alter table public.provider_wallets enable row level security;
drop policy if exists "providers read own wallet" on public.provider_wallets;
create policy "providers read own wallet"
  on public.provider_wallets
  for select to authenticated
  using (auth.uid() = provider_id);
revoke insert, update, delete on public.provider_wallets from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ payments — yarat (yoxdursa) və hər sütunu defensiv əlavə et              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid()
);

do $$
declare
  cols text[] := array[
    'user_id|uuid references public.profiles(id) on delete cascade',
    'amount|numeric(12,2) not null default 0',
    'currency|text not null default ''AZN''',
    'status|text not null default ''pending''',
    'provider|text not null default ''epoint''',
    'external_id|text',
    'description|text',
    'metadata|jsonb not null default ''{}''::jsonb',
    'created_at|timestamptz not null default now()',
    'completed_at|timestamptz'
  ];
  spec text;
  col_name text;
  col_def text;
begin
  foreach spec in array cols loop
    col_name := split_part(spec, '|', 1);
    col_def  := split_part(spec, '|', 2);
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='payments' and column_name=col_name
    ) then
      execute format('alter table public.payments add column %I %s', col_name, col_def);
    end if;
  end loop;
end $$;

-- CHECK constraint-ləri (mövcud deyilsə əlavə et)
do $$
begin
  if not exists (select 1 from pg_constraint where conname='payments_status_check') then
    alter table public.payments add constraint payments_status_check
      check (status in ('pending','completed','failed','refunded','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname='payments_provider_check') then
    alter table public.payments add constraint payments_provider_check
      check (provider in ('epoint','kapitalbank','manual','test'));
  end if;
  if not exists (select 1 from pg_constraint where conname='payments_amount_positive') then
    alter table public.payments add constraint payments_amount_positive check (amount > 0);
  end if;
exception when others then
  raise notice 'Constraint add skipped: %', sqlerrm;
end $$;

create index if not exists payments_user_id_idx
  on public.payments (user_id, created_at desc);
create index if not exists payments_external_id_idx
  on public.payments (external_id) where external_id is not null;

alter table public.payments enable row level security;
drop policy if exists "users read own payments" on public.payments;
create policy "users read own payments"
  on public.payments for select to authenticated
  using (auth.uid() = user_id);
revoke insert, update, delete on public.payments from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ transactions — yarat və ya defensiv sütun əlavə                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid()
);

do $$
declare
  cols text[] := array[
    'user_id|uuid references public.profiles(id) on delete cascade',
    'type|text not null default ''top_up''',
    'amount|numeric(12,2) not null default 0',
    'balance_after|numeric(12,2) not null default 0',
    'description|text',
    'related_id|text',
    'payment_id|uuid references public.payments(id) on delete set null',
    'created_by|uuid references public.profiles(id) on delete set null',
    'created_at|timestamptz not null default now()'
  ];
  spec text;
  col_name text;
  col_def text;
begin
  foreach spec in array cols loop
    col_name := split_part(spec, '|', 1);
    col_def  := split_part(spec, '|', 2);
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='transactions' and column_name=col_name
    ) then
      execute format('alter table public.transactions add column %I %s', col_name, col_def);
    end if;
  end loop;
end $$;

create index if not exists transactions_user_id_idx
  on public.transactions (user_id, created_at desc);
create index if not exists transactions_payment_id_idx
  on public.transactions (payment_id) where payment_id is not null;

alter table public.transactions enable row level security;
drop policy if exists "users read own transactions" on public.transactions;
create policy "users read own transactions"
  on public.transactions for select to authenticated
  using (auth.uid() = user_id);
revoke insert, update, delete on public.transactions from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ provider_bonus_logs — UI tarixçəsi üçün                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.provider_bonus_logs (
  id uuid primary key default gen_random_uuid()
);

do $$
declare
  cols text[] := array[
    'provider_id|uuid references public.profiles(id) on delete cascade',
    'amount|numeric(12,2) not null default 0',
    'type|text',
    'source|text',
    'reason|text',
    'created_at|timestamptz not null default now()'
  ];
  spec text;
  col_name text;
  col_def text;
begin
  foreach spec in array cols loop
    col_name := split_part(spec, '|', 1);
    col_def  := split_part(spec, '|', 2);
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='provider_bonus_logs' and column_name=col_name
    ) then
      execute format('alter table public.provider_bonus_logs add column %I %s', col_name, col_def);
    end if;
  end loop;
end $$;

alter table public.provider_bonus_logs enable row level security;
drop policy if exists "providers read own bonus logs" on public.provider_bonus_logs;
create policy "providers read own bonus logs"
  on public.provider_bonus_logs for select to authenticated
  using (auth.uid() = provider_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FUNCTIONS                                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- credit_balance — yalnız service_role
create or replace function public.credit_balance(
  p_user_id uuid, p_amount numeric, p_payment_id uuid, p_reason text default 'top_up'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_new_balance numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden: credit_balance is service_role only';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.profiles set balance = coalesce(balance,0) + p_amount
   where id = p_user_id returning balance into v_new_balance;
  if v_new_balance is null then raise exception 'User % not found', p_user_id; end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, payment_id)
  values (p_user_id, 'top_up', p_amount, v_new_balance, p_reason, p_payment_id);

  return v_new_balance;
end$$;
revoke execute on function public.credit_balance(uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid, numeric, uuid, text) to service_role;

-- debit_balance — authenticated user
create or replace function public.debit_balance(
  p_amount numeric, p_reason text, p_related_id text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_user_id uuid := auth.uid(); v_new_balance numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.profiles set balance = balance - p_amount
   where id = v_user_id and balance >= p_amount
   returning balance into v_new_balance;
  if v_new_balance is null then raise exception 'Insufficient balance'; end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'booking_charge', -p_amount, v_new_balance, p_reason, p_related_id, v_user_id);
  return v_new_balance;
end$$;
revoke execute on function public.debit_balance(numeric, text, text) from public, anon;
grant execute on function public.debit_balance(numeric, text, text) to authenticated;

-- convert_bonus_to_balance — provider_wallets → profiles.balance (DÜZGÜN MƏNBƏ)
create or replace function public.convert_bonus_to_balance(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_new_bonus   numeric;
  v_new_balance numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- 1. provider_wallets.bonus_balance-dan çıx
  update public.provider_wallets
     set bonus_balance = bonus_balance - p_amount
   where provider_id = v_user_id
     and coalesce(bonus_balance,0) >= p_amount
   returning bonus_balance into v_new_bonus;
  if v_new_bonus is null then raise exception 'Insufficient bonus balance'; end if;

  -- 2. profiles.balance-a əlavə et
  update public.profiles
     set balance = coalesce(balance,0) + p_amount,
         updated_at = now()
   where id = v_user_id
   returning balance into v_new_balance;

  -- 3. Audit
  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (v_user_id, 'bonus_convert', p_amount, v_new_balance, 'Bonus → Balance', v_user_id);

  insert into public.provider_bonus_logs
    (provider_id, amount, type, source, reason, created_at)
  values
    (v_user_id, p_amount, 'conversion', 'bonus_to_main_balance',
     'Bonus əsas balansa çevrildi', now());

  return v_new_balance;
end$$;
revoke execute on function public.convert_bonus_to_balance(numeric) from public, anon;
grant   execute on function public.convert_bonus_to_balance(numeric) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime publication                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
exception when others then
  raise notice 'Realtime skip: %', sqlerrm;
end$$;

-- PostgREST cache reload
notify pgrst, 'reload schema';
