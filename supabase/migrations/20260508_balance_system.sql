-- ============================================================================
--  Balance System Migration — 2026-05-08
--
--  Yaratılan/yenilənən cədvəllər:
--    - provider_wallets        (provider üçün balance + bonus)
--    - payments                (ödəniş sessiyaları + status)
--    - transactions            (audit trail — bütün balance hərəkətləri)
--
--  Yaradılan SECURITY DEFINER funksiyalar (təhlükəsiz balance dəyişiklikləri):
--    - credit_balance(user_id, amount, payment_id, reason)  → webhook çağırır
--    - debit_balance(user_id, amount, reason, related_id)   → booking ödəniş
--    - convert_bonus_to_balance(user_id, amount)            → bonus → balance
--
--  Web + Mobile (Flutter) hər ikisi eyni Edge Function-lar üzərindən işləyəcək:
--    POST /functions/v1/create-payment-session    → bank gateway URL
--    POST /functions/v1/payment-webhook           → bank callback
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ profiles cədvəlinə balance sütunları əlavə (yoxdursa)                    ║
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
-- ║ provider_wallets — provayder qazancı və bonus                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.provider_wallets (
  provider_id     uuid primary key references public.profiles(id) on delete cascade,
  balance         numeric(12,2) not null default 0,
  bonus_balance   numeric(12,2) not null default 0,
  total_earned    numeric(12,2) not null default 0,
  total_withdrawn numeric(12,2) not null default 0,
  updated_at      timestamptz not null default now()
);

alter table public.provider_wallets enable row level security;

drop policy if exists "providers read own wallet" on public.provider_wallets;
create policy "providers read own wallet"
  on public.provider_wallets
  for select
  to authenticated
  using (auth.uid() = provider_id);

revoke insert, update, delete on public.provider_wallets from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ payments — bank gateway sessiyaları                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  amount          numeric(12,2) not null check (amount > 0),
  currency        text not null default 'AZN',
  status          text not null default 'pending'
                    check (status in ('pending', 'completed', 'failed', 'refunded', 'cancelled')),
  provider        text not null default 'epoint'
                    check (provider in ('epoint', 'kapitalbank', 'manual', 'test')),
  external_id     text,            -- bank tərəfində sessiya ID-si
  description     text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists payments_user_id_idx
  on public.payments (user_id, created_at desc);
create index if not exists payments_external_id_idx
  on public.payments (external_id) where external_id is not null;

alter table public.payments enable row level security;

drop policy if exists "users read own payments" on public.payments;
create policy "users read own payments"
  on public.payments
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.payments from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ transactions — bütün balance hərəkətləri (audit trail)                   ║
-- ║ Ledger pattern: hər kredit/debet bir row, balance dəyişməsi göstərilir  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  type            text not null
                    check (type in (
                      'top_up',          -- balansa yüklənmə
                      'booking_charge',  -- sifariş ödənişi
                      'refund',          -- geri qaytarma
                      'bonus_earn',      -- bonus qazanma
                      'bonus_convert',   -- bonus → balans
                      'withdrawal',      -- provayder çəkdirmə
                      'admin_adjust'     -- admin tərəfindən düzəliş
                    )),
  amount          numeric(12,2) not null,  -- müsbət=kredit, mənfi=debet
  balance_after   numeric(12,2) not null,  -- snapshot
  description     text,
  related_id      text,                    -- payment_id / booking_id / opportunity_id
  payment_id      uuid references public.payments(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists transactions_user_id_idx
  on public.transactions (user_id, created_at desc);
create index if not exists transactions_payment_id_idx
  on public.transactions (payment_id) where payment_id is not null;

alter table public.transactions enable row level security;

drop policy if exists "users read own transactions" on public.transactions;
create policy "users read own transactions"
  on public.transactions
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.transactions from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FUNKSIYA: credit_balance                                                 ║
-- ║ Yalnız Edge Function-dan (service_role JWT ilə) çağrıla bilər.           ║
-- ║ payment-webhook bunu çağırır → balansa kredit + transactions log.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.credit_balance(
  p_user_id    uuid,
  p_amount     numeric,
  p_payment_id uuid,
  p_reason     text default 'top_up'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  -- Yalnız service_role çağıra bilər (Edge Function)
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden: credit_balance is service_role only';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.profiles
  set balance = balance + p_amount
  where id = p_user_id
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User % not found', p_user_id;
  end if;

  -- Audit trail
  insert into public.transactions
    (user_id, type, amount, balance_after, description, payment_id)
  values
    (p_user_id, 'top_up', p_amount, v_new_balance, p_reason, p_payment_id);

  return v_new_balance;
end;
$$;

revoke execute on function public.credit_balance(uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid, numeric, uuid, text) to service_role;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FUNKSIYA: debit_balance                                                  ║
-- ║ Authenticated user öz balansından debet edə bilər (məs. booking ödəniş).║
-- ║ Atomic: balans yetərsizdirsə xəta atır.                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.debit_balance(
  p_amount      numeric,
  p_reason      text,
  p_related_id  text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_new_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.profiles
  set balance = balance - p_amount
  where id = v_user_id
    and balance >= p_amount     -- atomic check
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'Insufficient balance';
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'booking_charge', -p_amount, v_new_balance, p_reason, p_related_id, v_user_id);

  return v_new_balance;
end;
$$;

revoke execute on function public.debit_balance(numeric, text, text) from public, anon;
grant execute on function public.debit_balance(numeric, text, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FUNKSIYA: convert_bonus_to_balance                                       ║
-- ║ İstifadəçi öz bonusunu balansa çevirə bilər.                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.convert_bonus_to_balance(
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_new_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.profiles
  set
    bonus_balance = bonus_balance - p_amount,
    balance       = balance + p_amount
  where id = v_user_id
    and bonus_balance >= p_amount
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'Insufficient bonus balance';
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (v_user_id, 'bonus_convert', p_amount, v_new_balance, 'Bonus → Balance', v_user_id);

  return v_new_balance;
end;
$$;

revoke execute on function public.convert_bonus_to_balance(numeric) from public, anon;
grant execute on function public.convert_bonus_to_balance(numeric) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Realtime publication                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and tablename='transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
exception when others then
  raise notice 'Realtime publication update skipped: %', sqlerrm;
end $$;
