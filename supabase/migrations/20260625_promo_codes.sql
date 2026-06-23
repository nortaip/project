-- ============================================================================
-- Promo kod sistemi
--
--   1. promo_codes + promo_redemptions cədvəlləri (used_count = istifadə sayı)
--   2. validate_promo_code(code, amount) — müştəri önizləmə üçün
--   3. accept_offer_with_payment-ə p_promo_code əlavə olunur — KART axınında
--      endirim tətbiq olunur (platforma endirimi udur, provayder tam alır),
--      used_count artır + redemption qeydi
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Cədvəllər                                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.promo_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  discount_type    text not null check (discount_type in ('percent','fixed')),
  discount_value   numeric(12,2) not null check (discount_value > 0),
  max_uses         integer,          -- null = limitsiz
  used_count       integer not null default 0,
  per_user_limit   integer,          -- null = limitsiz
  min_order_amount numeric(12,2),
  is_active        boolean not null default true,
  starts_at        timestamptz,
  expires_at       timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index if not exists promo_codes_code_upper_idx
  on public.promo_codes (upper(code));

create table if not exists public.promo_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promo_id        uuid not null references public.promo_codes(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  offer_id        uuid,
  opportunity_id  uuid,
  discount_amount numeric(12,2) not null,
  created_at      timestamptz not null default now()
);
create index if not exists promo_redemptions_promo_idx on public.promo_redemptions (promo_id);
create index if not exists promo_redemptions_user_idx  on public.promo_redemptions (user_id);

-- transactions.type → promo_discount
do $$
declare v_constraint text;
begin
  select conname into v_constraint from pg_constraint
   where conrelid = 'public.transactions'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%type%';
  if v_constraint is not null then
    execute format('alter table public.transactions drop constraint %I', v_constraint);
  end if;
  alter table public.transactions add constraint transactions_type_check
    check (type in (
      'top_up','booking_charge','refund','bonus_earn','bonus_convert',
      'withdrawal','admin_adjust','escrow_lock','escrow_release',
      'platform_revenue','cash_deposit_lock','brigade_payout','promo_discount'
    ));
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. RLS                                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

drop policy if exists "admin manage promo_codes" on public.promo_codes;
create policy "admin manage promo_codes" on public.promo_codes for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()
                  and lower(coalesce(p.role,'')) in ('admin','master','superadmin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()
                  and lower(coalesce(p.role,'')) in ('admin','master','superadmin')));

drop policy if exists "admin read redemptions" on public.promo_redemptions;
create policy "admin read redemptions" on public.promo_redemptions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()
                  and lower(coalesce(p.role,'')) in ('admin','master','superadmin'))
         or auth.uid() = user_id);

revoke insert, update, delete on public.promo_redemptions from authenticated, anon;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. validate_promo_code — önizləmə (endirim hesabla)                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.validate_promo_code(p_code text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_promo    record;
  v_discount numeric := 0;
  v_uses     integer;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_code is null or length(trim(p_code)) = 0 then
    return jsonb_build_object('valid', false, 'message', 'Kod boşdur');
  end if;

  select * into v_promo from public.promo_codes
   where upper(code) = upper(trim(p_code));
  if v_promo.id is null then
    return jsonb_build_object('valid', false, 'message', 'Promo kod tapılmadı');
  end if;
  if not v_promo.is_active then
    return jsonb_build_object('valid', false, 'message', 'Kod aktiv deyil');
  end if;
  if v_promo.starts_at is not null and now() < v_promo.starts_at then
    return jsonb_build_object('valid', false, 'message', 'Kod hələ aktiv deyil');
  end if;
  if v_promo.expires_at is not null and now() > v_promo.expires_at then
    return jsonb_build_object('valid', false, 'message', 'Kodun vaxtı keçib');
  end if;
  if v_promo.min_order_amount is not null and p_amount < v_promo.min_order_amount then
    return jsonb_build_object('valid', false,
      'message', 'Minimum sifariş məbləği: ' || v_promo.min_order_amount || ' ₼');
  end if;
  if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('valid', false, 'message', 'Kodun limiti dolub');
  end if;
  if v_promo.per_user_limit is not null then
    select count(*) into v_uses from public.promo_redemptions
     where promo_id = v_promo.id and user_id = v_caller;
    if v_uses >= v_promo.per_user_limit then
      return jsonb_build_object('valid', false, 'message', 'Siz bu kodu artıq istifadə etmisiniz');
    end if;
  end if;

  if v_promo.discount_type = 'percent' then
    v_discount := round(p_amount * v_promo.discount_value / 100, 2);
  else
    v_discount := v_promo.discount_value;
  end if;
  if v_discount > p_amount then v_discount := p_amount; end if;

  return jsonb_build_object(
    'valid', true,
    'promo_id', v_promo.id,
    'code', v_promo.code,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value,
    'discount', v_discount,
    'final', p_amount - v_discount,
    'message', 'Promo kod tətbiq olundu'
  );
end;
$$;
revoke execute on function public.validate_promo_code(text, numeric) from public, anon;
grant   execute on function public.validate_promo_code(text, numeric) to authenticated;


notify pgrst, 'reload schema';
