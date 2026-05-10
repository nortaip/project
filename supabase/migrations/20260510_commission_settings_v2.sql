-- ============================================================================
-- Commission Settings V2 — 3 mərhələli komissiya modeli
--
-- Yeni axın:
--   1. Provider təklif verir — PULSUZ (komissiya yox)
--   2. Customer təklifi qəbul edir → kartla ödəyir (Edge Function)
--      → webhook `lock_offer_payment` çağırır
--      → commission_on_accept tutulur, qalan provayder escrow-da bloklanır
--   3. İş tamamlandıqda customer "Tamamla" basır
--      → `release_offer_to_provider` çağırılır
--      → commission_on_complete tutulur, qalan available balansa keçir
--   4. Provider nağdlaşdırma istəyir
--      → `request_withdrawal` çağırılır
--      → commission_on_withdrawal tutulur, qalan bank kartına köçürülür
--
-- Bütün faizlər `platform_config` cədvəlindədir, admin dəyişə bilər.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. platform_config — admin tərəfindən konfiqurasiya olunan dəyərlər       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.platform_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- Default komissiya dəyərləri (% olaraq)
insert into platform_config (key, value, description) values
  ('commission_on_accept',     '2'::jsonb,  'Təklif qəbul edildikdə tutulan % (provayderdən, ödəniş zamanı)'),
  ('commission_on_complete',   '5'::jsonb,  'İş tamamlandıqda tutulan % (provayderdən, escrow-dan açılanda)'),
  ('commission_on_withdrawal', '3'::jsonb,  'Nağdlaşdırma zamanı tutulan %'),
  ('min_withdrawal_amount',    '10'::jsonb, 'Minimum nağdlaşdırma məbləği (₼)')
on conflict (key) do nothing;

alter table public.platform_config enable row level security;

drop policy if exists "anyone read platform config" on public.platform_config;
create policy "anyone read platform config"
  on public.platform_config for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.platform_config from anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. provider_wallets — locked_balance (escrow) əlavə                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.provider_wallets
  add column if not exists locked_balance numeric(12,2) not null default 0;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. opportunities_offers — paid_at + payment_id                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.opportunities_offers
  add column if not exists paid_at    timestamptz;
alter table public.opportunities_offers
  add column if not exists payment_id uuid;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. withdrawals cədvəli                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.withdrawals (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid references public.profiles(id) on delete cascade,
  amount_requested    numeric(12,2) not null check (amount_requested > 0),
  commission_percent  numeric(5,2)  not null,
  commission_amount   numeric(12,2) not null,
  net_amount          numeric(12,2) not null,
  bank_card           text,
  status              text not null default 'pending'
                        check (status in ('pending','processed','rejected')),
  admin_notes         text,
  requested_at        timestamptz not null default now(),
  processed_at        timestamptz
);

alter table public.withdrawals enable row level security;

drop policy if exists "providers read own withdrawals" on public.withdrawals;
create policy "providers read own withdrawals"
  on public.withdrawals for select to authenticated
  using (auth.uid() = provider_id);

revoke insert, update, delete on public.withdrawals from anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. RPC: get_commission_rates                                              ║
-- ║    Frontend bütün rates-ı tək sorğu ilə alır                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.get_commission_rates()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_object_agg(key, (value)::text::numeric)
    from public.platform_config
   where key in (
     'commission_on_accept',
     'commission_on_complete',
     'commission_on_withdrawal',
     'min_withdrawal_amount'
   );
$$;
grant execute on function public.get_commission_rates() to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. RPC: lock_offer_payment(offer_id, amount, payment_id)                  ║
-- ║    Yalnız payment-webhook (service_role) çağırır                         ║
-- ║    Customer kartla ödədikdən sonra escrow-a yazır                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.lock_offer_payment(
  p_offer_id   uuid,
  p_amount     numeric,
  p_payment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_id      uuid;
  v_commission_pct   numeric;
  v_commission_amt   numeric;
  v_provider_amount  numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden: lock_offer_payment is service_role only';
  end if;

  select provider_id into v_provider_id
    from public.opportunities_offers
   where id = p_offer_id;
  if v_provider_id is null then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';

  v_commission_amt  := round(p_amount * v_commission_pct / 100, 2);
  v_provider_amount := p_amount - v_commission_amt;

  -- Provider escrow-a əlavə et
  insert into public.provider_wallets (provider_id, locked_balance)
  values (v_provider_id, v_provider_amount)
  on conflict (provider_id) do update
    set locked_balance = public.provider_wallets.locked_balance + v_provider_amount,
        updated_at     = now();

  -- Offer-i accepted statusuna keçir + ödəniş tarixçəsi
  update public.opportunities_offers
     set status     = 'accepted',
         paid_at    = now(),
         payment_id = p_payment_id
   where id = p_offer_id;

  -- Eyni opportunity-yə digər pending təklifləri rədd et
  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   )
     and id <> p_offer_id
     and status = 'pending';

  -- Opportunity-ni active + accepted_offer_id təyin et
  update public.opportunities
     set status            = 'active',
         accepted_offer_id = p_offer_id
   where id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   );

  -- Transactions audit
  insert into public.transactions
    (user_id, type, amount, description, related_id, payment_id)
  values
    (v_provider_id, 'escrow_lock', v_provider_amount,
     'Müştəri ödənişi escrow-a düşdü (qəbul komissiyası: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, p_payment_id);
end;
$$;
revoke execute on function public.lock_offer_payment(uuid, numeric, uuid) from public, anon, authenticated;
grant   execute on function public.lock_offer_payment(uuid, numeric, uuid) to service_role;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. RPC: release_offer_to_provider(offer_id)                               ║
-- ║    Customer "Tamamla" düyməsinə basanda                                   ║
-- ║    locked → available, commission_on_complete tutulur                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.release_offer_to_provider(p_offer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_provider_id    uuid;
  v_opp_creator    uuid;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select oo.provider_id, op.created_by
    into v_provider_id, v_opp_creator
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_opp_creator <> v_caller then
    raise exception 'Only customer can complete the offer';
  end if;

  -- Locked amount-u escrow_lock transaction-dan götür
  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found for offer'; end if;

  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt    := v_locked_amt - v_commission_amt;

  -- Locked → balance (provider üçün available olunur)
  update public.provider_wallets
     set locked_balance = locked_balance - v_locked_amt,
         balance        = coalesce(balance, 0) + v_release_amt,
         total_earned   = coalesce(total_earned, 0) + v_release_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  -- Offer completed
  update public.opportunities_offers
     set status = 'completed'
   where id = p_offer_id;

  -- Transactions audit
  insert into public.transactions
    (user_id, type, amount, description, related_id, created_by)
  values
    (v_provider_id, 'escrow_release', v_release_amt,
     'İş tamamlandı, escrow → balans (tamamlama komissiyası: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, v_caller);

  return v_release_amt;
end;
$$;
revoke execute on function public.release_offer_to_provider(uuid) from public, anon;
grant   execute on function public.release_offer_to_provider(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. RPC: request_withdrawal(amount, bank_card)                             ║
-- ║    Provider nağdlaşdırma istəyir                                          ║
-- ║    commission_on_withdrawal tutulur                                       ║
-- ║    Withdrawal pending statusda yaradılır (admin manual emal edir)         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.request_withdrawal(
  p_amount    numeric,
  p_bank_card text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_min            numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_net_amt        numeric;
  v_balance        numeric;
  v_id             uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_bank_card is null or length(trim(p_bank_card)) < 8 then
    raise exception 'Bank card / IBAN required';
  end if;

  select (value)::text::numeric into v_min
    from public.platform_config where key = 'min_withdrawal_amount';
  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_withdrawal';

  if p_amount < v_min then
    raise exception 'Minimum withdrawal amount: % ₼', v_min;
  end if;

  -- Atomik balance debit (yetərsizdirsə xəta)
  update public.provider_wallets
     set balance    = balance - p_amount,
         updated_at = now()
   where provider_id = v_user_id
     and coalesce(balance, 0) >= p_amount
   returning balance into v_balance;

  if v_balance is null then raise exception 'Insufficient balance'; end if;

  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);
  v_net_amt        := p_amount - v_commission_amt;

  insert into public.withdrawals
    (provider_id, amount_requested, commission_percent, commission_amount, net_amount, bank_card)
  values
    (v_user_id, p_amount, v_commission_pct, v_commission_amt, v_net_amt, p_bank_card)
  returning id into v_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'withdrawal', -p_amount, v_balance,
     'Nağdlaşdırma sorğusu (komissiya: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼ → net: ' || v_net_amt || ' ₼)',
     v_id::text, v_user_id);

  return v_id;
end;
$$;
revoke execute on function public.request_withdrawal(numeric, text) from public, anon;
grant   execute on function public.request_withdrawal(numeric, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 9. RPC: admin_update_commission(key, value)                               ║
-- ║    Admin üçün konfig dəyərini dəyişmək                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_update_commission(
  p_key   text,
  p_value numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_key not in (
    'commission_on_accept',
    'commission_on_complete',
    'commission_on_withdrawal',
    'min_withdrawal_amount'
  ) then
    raise exception 'Invalid config key: %', p_key;
  end if;

  if p_value < 0 or p_value > 100 then
    raise exception 'Value must be 0..100';
  end if;

  update public.platform_config
     set value      = to_jsonb(p_value),
         updated_at = now()
   where key = p_key;

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (auth.uid(), 'commission_update', 'config', null,
          jsonb_build_object('key', p_key, 'value', p_value));
exception when others then
  if sqlerrm like '%audit_log%' then
    null; -- audit fail-ı bloklamasın
  else
    raise;
  end if;
end;
$$;
revoke execute on function public.admin_update_commission(text, numeric) from public, anon;
grant   execute on function public.admin_update_commission(text, numeric) to authenticated;


-- PostgREST cache reload
notify pgrst, 'reload schema';
