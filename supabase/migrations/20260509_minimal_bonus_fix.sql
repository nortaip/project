-- ============================================================================
-- MINIMAL Fix — yalnız convert_bonus_to_balance işləməsi üçün
--
-- Bu migration:
-- 1. profiles, provider_wallets, transactions, provider_bonus_logs cədvəllərində
--    ÇOX KİÇİK sayda sütun əlavə edir (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
-- 2. convert_bonus_to_balance funksiyasını yaradır (provider_wallets-dan oxuyur)
-- 3. Hər ALTER bir-birindən asılı deyil — biri fail olsa belə digərləri keçir
-- ============================================================================

-- ── 1. profiles ────────────────────────────────────────────────────────
alter table public.profiles add column if not exists balance       numeric(12,2) not null default 0;
alter table public.profiles add column if not exists bonus_balance numeric(12,2) not null default 0;

-- ── 2. provider_wallets (yarat və ya doldur) ───────────────────────────
create table if not exists public.provider_wallets (
  provider_id uuid primary key references public.profiles(id) on delete cascade
);

alter table public.provider_wallets add column if not exists balance         numeric(12,2) not null default 0;
alter table public.provider_wallets add column if not exists bonus_balance   numeric(12,2) not null default 0;
alter table public.provider_wallets add column if not exists total_earned    numeric(12,2) not null default 0;
alter table public.provider_wallets add column if not exists total_withdrawn numeric(12,2) not null default 0;
alter table public.provider_wallets add column if not exists updated_at      timestamptz   not null default now();

alter table public.provider_wallets enable row level security;
drop policy if exists "providers read own wallet" on public.provider_wallets;
create policy "providers read own wallet"
  on public.provider_wallets for select to authenticated
  using (auth.uid() = provider_id);


-- ── 3. transactions (audit) ────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid()
);

alter table public.transactions add column if not exists user_id        uuid;
alter table public.transactions add column if not exists type           text;
alter table public.transactions add column if not exists amount         numeric(12,2);
alter table public.transactions add column if not exists balance_after  numeric(12,2);
alter table public.transactions add column if not exists description    text;
alter table public.transactions add column if not exists related_id     text;
alter table public.transactions add column if not exists payment_id     uuid;
alter table public.transactions add column if not exists created_by     uuid;
alter table public.transactions add column if not exists created_at     timestamptz default now();

alter table public.transactions enable row level security;
drop policy if exists "users read own transactions" on public.transactions;
create policy "users read own transactions"
  on public.transactions for select to authenticated
  using (auth.uid() = user_id);


-- ── 4. provider_bonus_logs (UI tarixçəsi) ──────────────────────────────
create table if not exists public.provider_bonus_logs (
  id uuid primary key default gen_random_uuid()
);

alter table public.provider_bonus_logs add column if not exists provider_id uuid;
alter table public.provider_bonus_logs add column if not exists amount      numeric(12,2);
alter table public.provider_bonus_logs add column if not exists type        text;
alter table public.provider_bonus_logs add column if not exists source      text;
alter table public.provider_bonus_logs add column if not exists reason      text;
alter table public.provider_bonus_logs add column if not exists created_at  timestamptz default now();

alter table public.provider_bonus_logs enable row level security;
drop policy if exists "providers read own bonus logs" on public.provider_bonus_logs;
create policy "providers read own bonus logs"
  on public.provider_bonus_logs for select to authenticated
  using (auth.uid() = provider_id);


-- ── 5. convert_bonus_to_balance (provider_wallets → profiles.balance) ──
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

  -- 1. provider_wallets.bonus_balance-dan çıx (atomik)
  update public.provider_wallets
     set bonus_balance = bonus_balance - p_amount
   where provider_id = v_user_id
     and coalesce(bonus_balance, 0) >= p_amount
   returning bonus_balance into v_new_bonus;

  if v_new_bonus is null then
    raise exception 'Insufficient bonus balance';
  end if;

  -- 2. profiles.balance-a əlavə et
  update public.profiles
     set balance = coalesce(balance, 0) + p_amount
   where id = v_user_id
   returning balance into v_new_balance;

  -- 3. Audit (transactions) — hər zaman uğurlu olsun
  begin
    insert into public.transactions
      (user_id, type, amount, balance_after, description, created_by, created_at)
    values
      (v_user_id, 'bonus_convert', p_amount, v_new_balance, 'Bonus → Balance', v_user_id, now());
  exception when others then
    null; -- audit fail-ı əsas əməliyyatı bloklamasın
  end;

  -- 4. UI tarixçə (provider_bonus_logs)
  begin
    insert into public.provider_bonus_logs
      (provider_id, amount, type, source, reason, created_at)
    values
      (v_user_id, p_amount, 'conversion', 'bonus_to_main_balance',
       'Bonus əsas balansa çevrildi', now());
  exception when others then
    null;
  end;

  return v_new_balance;
end$$;

revoke execute on function public.convert_bonus_to_balance(numeric) from public, anon;
grant   execute on function public.convert_bonus_to_balance(numeric) to authenticated;

-- PostgREST cache reload
notify pgrst, 'reload schema';
