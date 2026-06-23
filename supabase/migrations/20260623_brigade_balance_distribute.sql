-- ============================================================================
-- Briqada balans bölgüsü (pul bölgüsü)
--
-- Briqada sahibi briqada balansından üzvlərə (işçilərə) pul payı ayırır.
-- Pay birbaşa üzvün şəxsi balansına (profiles.balance) köçürülür.
--
--   1. transactions.type CHECK → 'brigade_payout' əlavə olunur
--   2. brigade_distribute_balance(p_brigade_id, p_allocations) RPC
--        p_allocations = [{"profile_id": "...", "amount": 12.50}, ...]
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. transactions.type CHECK constraint-i genişləndir                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.transactions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%type%';

  if v_constraint is not null then
    execute format('alter table public.transactions drop constraint %I', v_constraint);
  end if;

  alter table public.transactions
    add constraint transactions_type_check
    check (type in (
      'top_up',
      'booking_charge',
      'refund',
      'bonus_earn',
      'bonus_convert',
      'withdrawal',
      'admin_adjust',
      'escrow_lock',
      'escrow_release',
      'platform_revenue',
      'brigade_payout'      -- briqada balansından üzvə pay
    ));
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. RPC: brigade_distribute_balance                                        ║
-- ║   Briqada sahibi balansdan üzvlərə pul payı bölür.                        ║
-- ║                                                                           ║
-- ║   - Yalnız briqada sahibi (owner) çağıra bilər                            ║
-- ║   - Hər allocation aktiv briqada üzvünə aid olmalıdır                     ║
-- ║   - Cəmi məbləğ briqada balansından çox ola bilməz (atomik)              ║
-- ║   - Hər üzvün şəxsi balansı kreditlənir + transactions log                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.brigade_distribute_balance(
  p_brigade_id  uuid,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_owner_id     uuid;
  v_brigade_bal  numeric;
  v_new_brigade  numeric;
  v_total        numeric := 0;
  v_count        integer := 0;
  v_item         jsonb;
  v_pid          uuid;
  v_amt          numeric;
  v_member_bal   numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Bölgü siyahısı boşdur';
  end if;

  -- Briqada + sahib yoxlaması (balansı kilidlə)
  select owner_id, coalesce(balance, 0)
    into v_owner_id, v_brigade_bal
    from public.brigades
   where id = p_brigade_id
   for update;
  if v_owner_id is null then raise exception 'Briqada tapılmadı'; end if;
  if v_owner_id <> v_caller then
    raise exception 'Yalnız briqada sahibi pul bölgüsü edə bilər';
  end if;

  -- 1-ci keçid: validasiya + cəm
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_pid := (v_item->>'profile_id')::uuid;
    v_amt := round((v_item->>'amount')::numeric, 2);

    if v_pid is null then raise exception 'profile_id boşdur'; end if;
    if v_amt is null or v_amt <= 0 then
      raise exception 'Məbləğ müsbət olmalıdır (profil %)', v_pid;
    end if;

    if not exists (
      select 1 from public.brigade_members bm
       where bm.brigade_id = p_brigade_id
         and bm.profile_id = v_pid
         and bm.is_active = true
    ) then
      raise exception 'Profil % bu briqadanın aktiv üzvü deyil', v_pid;
    end if;

    v_total := v_total + v_amt;
    v_count := v_count + 1;
  end loop;

  if v_total > v_brigade_bal then
    raise exception 'NO_BALANCE: Briqada balansı yetərli deyil (lazım: % ₼, mövcud: % ₼)',
      v_total, v_brigade_bal;
  end if;

  -- Briqada balansından çıx
  update public.brigades
     set balance    = balance - v_total,
         updated_at = now()
   where id = p_brigade_id
   returning balance into v_new_brigade;

  -- 2-ci keçid: hər üzvə kredit + log
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_pid := (v_item->>'profile_id')::uuid;
    v_amt := round((v_item->>'amount')::numeric, 2);

    update public.profiles
       set balance = coalesce(balance, 0) + v_amt
     where id = v_pid
     returning balance into v_member_bal;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_pid, 'brigade_payout', v_amt, v_member_bal,
       'Briqada pul bölgüsü', p_brigade_id::text, v_caller);
  end loop;

  -- Briqada tərəfi (ledger) — balans tabında görünür
  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_caller, 'brigade_payout', -v_total, v_new_brigade,
     'Üzvlərə pul bölgüsü (' || v_count || ' nəfər)',
     p_brigade_id::text, v_caller);

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_payout', 'brigade', p_brigade_id::text,
            jsonb_build_object(
              'total', v_total,
              'count', v_count,
              'allocations', p_allocations
            ));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'count', v_count,
    'brigade_balance', v_new_brigade
  );
end;
$$;

revoke execute on function public.brigade_distribute_balance(uuid, jsonb) from public, anon;
grant   execute on function public.brigade_distribute_balance(uuid, jsonb) to authenticated;


notify pgrst, 'reload schema';
