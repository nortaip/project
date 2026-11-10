CREATE OR REPLACE FUNCTION public._brigade_auto_add_owner_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.brigade_members (brigade_id, profile_id, role, is_active)
  values (new.id, new.owner_id, 'owner', true)
  on conflict (brigade_id, profile_id) do nothing;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._brigade_invite_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_brigade_name text;
begin
  -- Hədəf user-i auth.users-də tap (profiles asılı deyil)
  if new.email is not null then
    select au.id into v_user_id
    from auth.users au
    where lower(coalesce(au.email, '')) = lower(new.email)
    limit 1;
  end if;

  if v_user_id is null and new.phone is not null then
    select au.id into v_user_id
    from auth.users au
    where coalesce(au.phone, '') = new.phone
    limit 1;
  end if;

  if v_user_id is null then
    return new;  -- user qeydiyyatdan keçməyib, yalnız magic link ilə işləyəcək
  end if;

  -- Notifications cədvəli varsa, bildiriş yaz
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='notifications') then
    return new;
  end if;

  select name into v_brigade_name from public.brigades where id = new.brigade_id;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_user_id,
    'brigade_invite',
    coalesce(v_brigade_name, 'Şirkət') || ' sizi dəvət edir',
    'Şirkətə '
      || case new.intended_role
           when 'dispatcher' then 'dispatcher'
           else 'işçi'
         end
      || ' kimi qatılmaq üçün dəvət aldınız.',
    new.token::text
  );

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._find_user_by_identifier(p_identifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := trim(coalesce(p_identifier,''));
  v_digits text;
  v_uid uuid;
begin
  if v_id = '' then return null; end if;

  if position('@' in v_id) > 0 then
    select id into v_uid from auth.users where lower(email) = lower(v_id);
    return v_uid;
  end if;

  -- Telefon: hər iki tərəfi rəqəmlərə salıb son 9 rəqəmi müqayisə edirik
  -- (AZ milli nömrə 9 rəqəmdir: 50xxxxxxx) — +994/0 prefiks fərqi itir
  v_digits := right(regexp_replace(v_id, '\D', '', 'g'), 9);
  if length(v_digits) < 9 then return null; end if;

  select id into v_uid from auth.users
   where right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = v_digits
   limit 1;
  if v_uid is not null then return v_uid; end if;

  select id into v_uid from public.profiles
   where right(regexp_replace(coalesce(phone_number,''), '\D', '', 'g'), 9) = v_digits
   limit 1;
  return v_uid;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._is_assigned_brigade_member(p_opp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.brigade_assignments ba
      join public.brigade_members bm on bm.id = ba.member_id
     where ba.source_id = p_opp_id::text
       and bm.profile_id = auth.uid()
  );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._is_offer_provider(p_offer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.opportunities_offers
     where id = p_offer_id and provider_id = auth.uid());
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._is_opportunity_owner(p_opp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.opportunities
     where id = p_opp_id and created_by = auth.uid());
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._refresh_provider_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_provider uuid;
  v_avg      numeric;
  v_cnt      integer;
begin
  v_provider := coalesce(new.provider_id, old.provider_id);

  select round(avg(rating)::numeric, 2), count(*)
    into v_avg, v_cnt
    from public.provider_reviews
   where provider_id = v_provider and rating is not null;

  update public.profiles
     set rating = coalesce(v_avg, 0),
         rating_count = coalesce(v_cnt, 0)
   where id = v_provider;

  return coalesce(new, old);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._require_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) then raise exception 'Forbidden: admin only'; end if;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._send_push_for_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
declare
  v_function_url text :=
    'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/send-push-notification';
  v_anon_key text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
  v_request_id bigint;
begin
  -- pg_net `net` schema-dadır (default Supabase üçün)
  -- search_path-də `net` qoyduq, ona görə net. prefiks lazım deyil
  v_request_id := net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_anon_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('notification_id', NEW.id::text),
    timeout_milliseconds := 5000
  );
  return NEW;
exception
  when others then
    raise warning '[push] send failed: %', sqlerrm;
    return NEW;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._sync_payout_status_on_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'pending_review'
     and coalesce(old.status,'') <> 'pending_review'
     and new.accepted_offer_id is not null then
    update public.opportunities_offers
       set payout_status = 'pending_review'
     where id = new.accepted_offer_id
       and payout_status is null;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._touch_brigades_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public._touch_conversation_after_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.body, 120)
   where id = new.conversation_id;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.accept_brigade_invite(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite     record;
  v_user_email text;
  v_user_phone text;
  v_user_id    uuid := auth.uid();
  v_inv_phone9 text;
  v_usr_phone9 text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_invite
  from public.brigade_invites
  where token = p_token and status = 'pending' and expires_at > now()
  for update;
  if v_invite is null then
    raise exception 'Invite not found, expired, or already responded';
  end if;

  -- email/phone-u profiles + auth.users birləşdirərək götür
  select coalesce(p.email, au.email), coalesce(p.phone_number, au.phone)
    into v_user_email, v_user_phone
  from auth.users au
  left join public.profiles p on p.id = au.id
  where au.id = v_user_id;

  if v_invite.email is not null
     and lower(coalesce(v_user_email, '')) <> lower(v_invite.email) then
    raise exception 'This invite is for a different email address';
  end if;

  if v_invite.phone is not null then
    v_inv_phone9 := nullif(right(regexp_replace(v_invite.phone, '[^0-9]', '', 'g'), 9), '');
    v_usr_phone9 := nullif(right(regexp_replace(coalesce(v_user_phone, ''), '[^0-9]', '', 'g'), 9), '');
    if v_inv_phone9 is distinct from v_usr_phone9 then
      raise exception 'This invite is for a different phone number';
    end if;
  end if;

  insert into public.brigade_members
    (brigade_id, profile_id, role, is_active, commission_pct)
  values
    (v_invite.brigade_id, v_user_id, v_invite.intended_role, true, v_invite.commission_pct)
  on conflict (brigade_id, profile_id) do update
  set role = excluded.role, is_active = true, commission_pct = excluded.commission_pct;

  update public.brigade_invites
  set status = 'accepted', responded_at = now()
  where id = v_invite.id;

  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='notifications') then
    begin
      insert into public.notifications (user_id, type, title, body, related_id)
      select b.owner_id, 'brigade_invite_accepted', 'Dəvət qəbul edildi',
             'Yeni üzv şirkətinizə qatıldı.', v_invite.brigade_id::text
      from public.brigades b where b.id = v_invite.brigade_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'brigade_id', v_invite.brigade_id, 'role', v_invite.intended_role);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.accept_offer_with_payment(p_offer_id uuid, p_method text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_promo_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid(); v_offer record;
  v_customer_bal numeric; v_provider_bal numeric; v_brigade_bal numeric;
  v_commission_pct numeric; v_commission_amt numeric; v_provider_amt numeric;
  v_cust_fee_pct numeric; v_cust_fee_amt numeric; v_deposit_pct numeric; v_deposit_amt numeric;
  v_total_charge numeric; v_gross numeric; v_notif_title text; v_notif_body text;
  v_discount numeric := 0; v_promo record; v_user_uses integer;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('cash','card') then raise exception 'Invalid payment method'; end if;

  select oo.id, oo.opportunity_id, oo.provider_id, oo.brigade_id, oo.offer_amount, oo.status,
         op.created_by, op.id as opp_id
    into v_offer from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id where oo.id = p_offer_id;
  if v_offer.id is null then raise exception 'Offer not found'; end if;
  if v_offer.created_by <> v_caller then raise exception 'Forbidden — not opportunity owner'; end if;
  if v_offer.status <> 'pending' then raise exception 'Offer is not pending'; end if;

  -- Komanda təklifi üçün ayrıca komissiya faizi; yoxdursa fərdi faizə fallback
  select coalesce(
    (select (value)::text::numeric from public.platform_config
       where key = case when v_offer.brigade_id is not null
                        then 'brigade_commission_on_accept' else 'commission_on_accept' end),
    (select (value)::text::numeric from public.platform_config where key = 'commission_on_accept'),
    0
  ) into v_commission_pct;
  v_commission_amt := round(v_offer.offer_amount * v_commission_pct / 100, 2);
  v_provider_amt := v_offer.offer_amount - v_commission_amt;
  select coalesce((value)::text::numeric, 0) into v_cust_fee_pct from public.platform_config where key = 'commission_customer_service_fee';
  v_cust_fee_amt := round(v_offer.offer_amount * v_cust_fee_pct / 100, 2);
  select coalesce((value)::text::numeric, 20) into v_deposit_pct from public.platform_config where key = 'cash_deposit_pct';
  v_deposit_amt := round(v_offer.offer_amount * v_deposit_pct / 100, 2);

  -- PROMO — hər iki ödəniş növü üçün hesablanır
  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from public.promo_codes where upper(code) = upper(trim(p_promo_code)) for update;
    if v_promo.id is null then raise exception 'PROMO_INVALID: Promo kod tapılmadı'; end if;
    if not v_promo.is_active then raise exception 'PROMO_INVALID: Kod aktiv deyil'; end if;
    if v_promo.starts_at is not null and now() < v_promo.starts_at then raise exception 'PROMO_INVALID: Kod hələ aktiv deyil'; end if;
    if v_promo.expires_at is not null and now() > v_promo.expires_at then raise exception 'PROMO_INVALID: Kodun vaxtı keçib'; end if;
    if v_promo.min_order_amount is not null and v_offer.offer_amount < v_promo.min_order_amount then raise exception 'PROMO_INVALID: Minimum məbləğ % AZN', v_promo.min_order_amount; end if;
    if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then raise exception 'PROMO_INVALID: Kodun limiti dolub'; end if;
    if v_promo.per_user_limit is not null then
      select count(*) into v_user_uses from public.promo_redemptions where promo_id = v_promo.id and user_id = v_caller;
      if v_user_uses >= v_promo.per_user_limit then raise exception 'PROMO_INVALID: Siz bu kodu artıq istifadə etmisiniz'; end if;
    end if;
    if v_promo.discount_type = 'percent' then v_discount := round(v_offer.offer_amount * v_promo.discount_value / 100, 2);
    else v_discount := v_promo.discount_value; end if;
    if v_discount > v_offer.offer_amount then v_discount := v_offer.offer_amount; end if;
  end if;

  if p_method = 'card' then
    v_gross := v_offer.offer_amount + v_cust_fee_amt;
    if v_discount > v_gross then v_discount := v_gross; end if;
    v_total_charge := v_gross - v_discount;
    select coalesce(balance,0) into v_customer_bal from public.profiles where id = v_caller;
    if v_customer_bal < v_total_charge then raise exception 'INSUFFICIENT_BALANCE: required=% available=%', v_total_charge, v_customer_bal; end if;
    update public.profiles set balance = balance - v_total_charge where id = v_caller;
    insert into public.provider_wallets (provider_id, locked_balance) values (v_offer.provider_id, v_provider_amt)
    on conflict (provider_id) do update set locked_balance = public.provider_wallets.locked_balance + v_provider_amt, updated_at = now();
    insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by) values
      (v_caller, 'booking_charge', -v_offer.offer_amount, v_customer_bal - v_total_charge,
       'Sifariş ödənişi (escrow), offer ' || left(p_offer_id::text, 8), p_offer_id::text, v_caller),
      (v_offer.provider_id, 'escrow_lock', v_provider_amt, 0,
       'Sifariş escrow-a düşdü (qəbul komissiyası: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)', p_offer_id::text, v_caller);
    if v_commission_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0, 'Qəbul komissiyası (kart, ' || v_commission_pct || '%)', p_offer_id::text, v_caller);
    end if;
    if v_cust_fee_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'platform_revenue', -v_cust_fee_amt, v_customer_bal - v_total_charge, 'Müştəri servis haqqı (' || v_cust_fee_pct || '%)', p_offer_id::text, v_caller);
    end if;
  else
    v_gross := v_deposit_amt + v_cust_fee_amt;
    if v_discount > v_gross then v_discount := v_gross; end if;  -- nağdda endirim öncədən tutulanı azaldır
    v_total_charge := v_gross - v_discount;
    if v_total_charge < 0 then v_total_charge := 0; end if;
    select coalesce(balance, 0) into v_customer_bal from public.profiles where id = v_caller;
    if v_customer_bal < v_total_charge then raise exception 'INSUFFICIENT_BALANCE: required=% available=% (deposit + service_fee)', v_total_charge, v_customer_bal; end if;
    update public.profiles set balance = balance - v_total_charge where id = v_caller;

    if v_offer.brigade_id is not null then
      select coalesce(balance, 0) into v_brigade_bal from public.brigades where id = v_offer.brigade_id;
      if v_brigade_bal < v_commission_amt then
        raise exception 'BRIGADE_INSUFFICIENT_BALANCE: Briqada balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)', v_commission_amt, v_brigade_bal;
      end if;
      update public.brigades set balance = balance - v_commission_amt, updated_at = now() where id = v_offer.brigade_id;
      if v_commission_amt > 0 then
        insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
        values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
          'Qəbul komissiyası (nağd, briqada, ' || v_commission_pct || '%, offer ' || left(p_offer_id::text, 8) || ')', v_offer.brigade_id::text, v_caller);
      end if;
    else
      select coalesce(balance, 0) into v_provider_bal from public.profiles where id = v_offer.provider_id;
      if v_provider_bal < v_commission_amt then
        raise exception 'PROVIDER_INSUFFICIENT_BALANCE: Provayder balansı nağd komissiya üçün yetərli deyil (lazım: % ₼, mövcud: % ₼)', v_commission_amt, v_provider_bal;
      end if;
      update public.profiles set balance = balance - v_commission_amt where id = v_offer.provider_id;
      if v_commission_amt > 0 then
        insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
        values (v_offer.provider_id, 'platform_revenue', v_commission_amt, 0,
          'Qəbul komissiyası (nağd, ' || v_commission_pct || '%, offer ' || left(p_offer_id::text, 8) || ')', p_offer_id::text, v_caller);
      end if;
    end if;

    if v_deposit_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'cash_deposit_lock', -v_deposit_amt, v_customer_bal - v_total_charge,
        'Qarantili nağd üçün depozit (' || v_deposit_pct || '%, offer ' || left(p_offer_id::text, 8) || ')', p_offer_id::text, v_caller);
    end if;
    if v_cust_fee_amt > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_caller, 'platform_revenue', -v_cust_fee_amt, v_customer_bal - v_total_charge,
        'Müştəri servis haqqı (' || v_cust_fee_pct || '%, nağd)', p_offer_id::text, v_caller);
    end if;
  end if;

  -- PROMO endirimini qeyd et (hər iki ödəniş növü üçün)
  if v_discount > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
    values (v_caller, 'promo_discount', v_discount, v_customer_bal - v_total_charge,
      'Promo endirim (' || v_promo.code || ', ' || p_method || ')', p_offer_id::text, v_caller);
    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, user_id, offer_id, opportunity_id, discount_amount)
    values (v_promo.id, v_caller, p_offer_id, v_offer.opp_id, v_discount);
  end if;

  update public.opportunities_offers set status = 'accepted', payment_method = p_method,
         paid_at = case when p_method = 'card' then now() else null end where id = p_offer_id;
  update public.opportunities_offers set status = 'rejected' where opportunity_id = v_offer.opp_id and id <> p_offer_id and status = 'pending';
  update public.opportunities set status = 'accepted', accepted_offer_id = p_offer_id, provider_id = v_offer.provider_id,
         latitude = coalesce(p_latitude, latitude), longitude = coalesce(p_longitude, longitude) where id = v_offer.opp_id;

  v_notif_title := 'Təklifiniz qəbul edildi 🎉';
  if p_method = 'card' then v_notif_body := 'Müştəri kartla ödəmə seçdi, məbləğ escrow-a düşdü.';
  else v_notif_body := 'Müştəri qarantili nağd ödəniş seçdi. İşi tamamladıqdan sonra qalan məbləği nağd alacaqsınız.'; end if;
  begin
    insert into public.notifications (user_id, type, title, body, related_id, is_read)
    values (v_offer.provider_id, case when p_method = 'card' then 'offer_accepted_card' else 'offer_accepted_cash' end,
      v_notif_title, v_notif_body, v_offer.opp_id::text, false);
  exception when others then null; end;
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'offer_accepted', 'opportunity_offer', p_offer_id::text,
            jsonb_build_object('method', p_method, 'amount', v_offer.offer_amount, 'commission_pct', v_commission_pct,
              'commission_amt', v_commission_amt, 'brigade_id', v_offer.brigade_id, 'customer_fee_pct', v_cust_fee_pct,
              'customer_fee_amt', v_cust_fee_amt, 'deposit_pct', v_deposit_pct, 'deposit_amt', v_deposit_amt,
              'promo_code', case when v_discount > 0 then v_promo.code else null end, 'promo_discount', v_discount,
              'provider_id', v_offer.provider_id));
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'method', p_method, 'offer_id', p_offer_id, 'opportunity_id', v_offer.opp_id,
    'commission_amt', v_commission_amt, 'commission_pct', v_commission_pct, 'is_brigade', v_offer.brigade_id is not null,
    'customer_fee_amt', v_cust_fee_amt, 'customer_fee_pct', v_cust_fee_pct, 'deposit_amt', v_deposit_amt,
    'deposit_pct', v_deposit_pct, 'discount', v_discount);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.add_dispute_evidence(p_dispute_id uuid, p_file_path text, p_file_type text, p_size_bytes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_dispute record;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select * into v_dispute from public.disputes where id = p_dispute_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DISPUTE_NOT_FOUND');
  end if;

  if v_caller <> v_dispute.raised_by and v_caller <> v_dispute.against_user then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  if v_dispute.status not in ('open', 'under_review') then
    return jsonb_build_object('ok', false, 'error', 'DISPUTE_CLOSED');
  end if;

  insert into public.dispute_attachments (dispute_id, file_path, file_type, size_bytes, uploaded_by)
  values (p_dispute_id, p_file_path, p_file_type, p_size_bytes, v_caller);

  -- Dispute updated_at avtomatik dolur (trigger var)
  update public.disputes set updated_at = now() where id = p_dispute_id;

  return jsonb_build_object('ok', true);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_amount numeric, p_reason text, p_target text DEFAULT 'balance'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_role        text;
  v_new         numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount = 0 or p_amount is null then
    raise exception 'Amount cannot be zero / null';
  end if;
  if p_target not in ('balance','bonus','locked') then
    raise exception 'Invalid target (must be balance | bonus | locked)';
  end if;

  -- Target user-in rolunu öyrən (provider üçün provider_wallets, customer üçün profiles)
  select lower(coalesce(role,'')) into v_role from public.profiles where id = p_user_id;
  if v_role is null then raise exception 'User not found'; end if;

  -- Provider rolundakılar üçün provider_wallets istifadə edirik
  if v_role in ('provider','pro','seller') then
    -- wallet sətri yoxsa yarat
    insert into public.provider_wallets (provider_id) values (p_user_id)
    on conflict (provider_id) do nothing;

    if p_target = 'balance' then
      update public.provider_wallets
         set balance = coalesce(balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning balance into v_new;
    elsif p_target = 'bonus' then
      update public.provider_wallets
         set bonus_balance = coalesce(bonus_balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning bonus_balance into v_new;
    else -- locked
      update public.provider_wallets
         set locked_balance = coalesce(locked_balance,0) + p_amount,
             updated_at = now()
       where provider_id = p_user_id
       returning locked_balance into v_new;
    end if;
  else
    -- Customer: profiles.balance / bonus_balance istifadə olunur
    if p_target = 'balance' then
      update public.profiles
         set balance = coalesce(balance,0) + p_amount
       where id = p_user_id
       returning balance into v_new;
    elsif p_target = 'bonus' then
      update public.profiles
         set bonus_balance = coalesce(bonus_balance,0) + p_amount
       where id = p_user_id
       returning bonus_balance into v_new;
    else
      raise exception 'locked balance applies only to providers';
    end if;
  end if;

  if v_new is null then raise exception 'Balance update failed'; end if;
  if v_new < 0 then
    raise exception 'Result would be negative balance';
  end if;

  -- transactions log
  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (p_user_id, 'admin_adjust', p_amount, v_new,
     'Admin düzəlişi (' || p_target || '): ' || coalesce(p_reason,'—'),
     auth.uid());

  -- audit log
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      auth.uid(),
      'balance_adjust',
      'user_balance',
      p_user_id::text,
      jsonb_build_object(
        'target', p_target,
        'amount', p_amount,
        'reason', p_reason,
        'new_balance', v_new
      )
    );
  exception when others then null;
  end;

  return v_new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_approve_brigade_application(p_application_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller     uuid := auth.uid();
  v_app        record;
  v_brigade_id uuid;
  v_is_admin   boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_app from public.brigade_applications
   where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status;
  end if;

  -- Briqada yarat
  insert into public.brigades (
    owner_id, name, description, categories,
    contact_phone, contact_email, address, logo_url,
    is_verified
  ) values (
    v_app.applicant_id, v_app.name, v_app.description, v_app.categories,
    v_app.contact_phone, v_app.contact_email, v_app.address, v_app.logo_url,
    true
  )
  returning id into v_brigade_id;

  -- Applicant-ı owner üzv kimi əlavə et (mövcud trigger zatən belə edir,
  -- amma trigger yoxdursa fallback)
  begin
    insert into public.brigade_members (brigade_id, profile_id, role, is_active)
    values (v_brigade_id, v_app.applicant_id, 'owner', true)
    on conflict do nothing;
  exception when others then null;
  end;

  -- Müraciəti təsdiqlənmiş kimi qeyd et
  update public.brigade_applications
     set status = 'approved',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_note,
         brigade_id = v_brigade_id
   where id = p_application_id;

  -- Notification → applicant
  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_app.applicant_id,
      'Briqada təsdiqləndi',
      coalesce(v_app.name,'Briqada') || ' admin tərəfindən təsdiqləndi.',
      'brigade_approved',
      v_brigade_id::text,
      '/brigades/' || v_brigade_id::text
    );
  exception when others then null;
  end;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_approve', 'brigade_application', p_application_id::text,
            jsonb_build_object('brigade_id', v_brigade_id, 'note', p_note));
  exception when others then null;
  end;

  return v_brigade_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_approve_provider_request(p_request_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller   uuid := auth.uid();
  v_req      record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Request already %', v_req.status;
  end if;

  -- Profili yenilə: role + müraciətdə qeyd olunan provider sahələri
  update public.profiles
     set role = 'provider',
         company_name      = coalesce(v_req.company_name,     company_name),
         experience_years  = coalesce(v_req.experience_years, experience_years),
         specialties       = case when array_length(v_req.specialties,1) > 0
                                  then v_req.specialties
                                  else specialties end
   where id = v_req.user_id;

  update public.provider_requests
     set status = 'approved',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_note
   where id = p_request_id;

  -- Notification
  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_req.user_id,
      'Provayder statusu təsdiqləndi',
      'Artıq sifariş qəbul edə bilərsiniz.',
      'provider_approved',
      p_request_id::text,
      '/account'
    );
  exception when others then null;
  end;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'provider_approve', 'provider_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id));
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_companies_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caller uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_caller
                 and lower(coalesce(role,'')) in ('admin','master','superadmin')) then
    raise exception 'Forbidden: admin only';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'name')) from (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'is_verified', b.is_verified, 'is_active', b.is_active,
        'balance', b.balance, 'rating', b.rating, 'total_orders', b.total_orders,
        'created_at', b.created_at,
        'owner_name', (select name from public.profiles where id = b.owner_id),
        'member_count', (select count(*) from public.brigade_members bm where bm.brigade_id = b.id and bm.is_active),
        'online_count', (select count(*) from public.brigade_members bm where bm.brigade_id = b.id and bm.is_active and bm.is_online),
        'offer_count', (select count(*) from public.opportunities_offers oo where oo.brigade_id = b.id)
      ) as x from public.brigades b
    ) t
  ), '[]'::jsonb);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_company_detail(p_brigade_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_brigade jsonb; v_members jsonb; v_orders jsonb; v_finance jsonb; v_logs jsonb;
begin
  if not exists (select 1 from public.profiles where id = v_caller
                 and lower(coalesce(role,'')) in ('admin','master','superadmin')) then
    raise exception 'Forbidden: admin only';
  end if;

  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'description', b.description,
    'is_verified', b.is_verified, 'is_active', b.is_active,
    'balance', b.balance, 'rating', b.rating, 'total_orders', b.total_orders,
    'categories', b.categories, 'contact_phone', b.contact_phone,
    'contact_email', b.contact_email, 'address', b.address, 'created_at', b.created_at,
    'owner_name', (select name from public.profiles where id = b.owner_id), 'owner_id', b.owner_id
  ) into v_brigade from public.brigades b where b.id = p_brigade_id;
  if v_brigade is null then raise exception 'Şirkət tapılmadı'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'member_id', bm.id, 'profile_id', bm.profile_id, 'name', p.name, 'avatar_url', p.avatar_url,
    'role', bm.role, 'commission_pct', bm.commission_pct, 'is_active', bm.is_active,
    'is_online', bm.is_online, 'joined_at', bm.joined_at,
    'done_count', (select count(*) from public.brigade_assignments ba where ba.member_id = bm.id and ba.status = 'completed')
  ) order by bm.role, p.name), '[]'::jsonb) into v_members
  from public.brigade_members bm join public.profiles p on p.id = bm.profile_id
  where bm.brigade_id = p_brigade_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'offer_id', oo.id, 'opportunity_id', oo.opportunity_id, 'title', op.title,
    'amount', oo.offer_amount, 'status', oo.status, 'payment_method', oo.payment_method,
    'created_at', oo.created_at,
    'worker_name', (select p2.name from public.brigade_assignments ba
      join public.brigade_members bm2 on bm2.id = ba.member_id
      join public.profiles p2 on p2.id = bm2.profile_id
      where ba.brigade_id = p_brigade_id and ba.source_id = oo.opportunity_id::text
      order by ba.assigned_at desc limit 1),
    'worker_status', (select ba.status from public.brigade_assignments ba
      where ba.brigade_id = p_brigade_id and ba.source_id = oo.opportunity_id::text
      order by ba.assigned_at desc limit 1)
  ) order by oo.created_at desc), '[]'::jsonb) into v_orders
  from public.opportunities_offers oo
  left join public.opportunities op on op.id = oo.opportunity_id
  where oo.brigade_id = p_brigade_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'type', t.type, 'amount', t.amount, 'description', t.description,
    'created_at', t.created_at, 'user_name', (select name from public.profiles where id = t.user_id)
  ) order by t.created_at desc), '[]'::jsonb) into v_finance
  from (select * from public.transactions where related_id = p_brigade_id::text
        order by created_at desc limit 200) t;

  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) into v_logs
  from (
    select jsonb_build_object(
      'id', a.id, 'action', a.action, 'target_type', a.target_type, 'created_at', a.created_at,
      'actor_name', (select name from public.profiles where id = a.actor), 'payload', a.payload
    ) as x from public.audit_log a
    where a.target_id = p_brigade_id::text or a.payload->>'brigade_id' = p_brigade_id::text
    order by a.created_at desc limit 300
  ) s;

  return jsonb_build_object('brigade', v_brigade, 'members', v_members,
    'orders', v_orders, 'finance', v_finance, 'logs', v_logs);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_complete_opportunity(p_opportunity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_status text;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_caller and role in ('admin', 'master', 'superadmin')
  ) then
    raise exception 'Only admin can approve orders';
  end if;

  select status into v_status from public.opportunities where id = p_opportunity_id;
  if v_status is null then
    raise exception 'Opportunity not found';
  end if;

  -- Yalnız təsdiq gözləyən (və ya hələ aktiv) sifarişlər təsdiqlənə bilər
  if v_status = 'completed' then
    return 'already_completed';
  end if;
  if v_status not in ('pending_review', 'ongoing', 'i-am-here', 'accepted') then
    raise exception 'Order is not awaiting approval (status: %)', v_status;
  end if;

  update public.opportunities
     set status = 'completed'
   where id = p_opportunity_id;

  return 'completed';
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_credit_balance(p_target_user_id uuid, p_amount numeric, p_reason text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_new_balance numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;

  update public.profiles
     set balance = coalesce(balance,0) + p_amount
   where id = p_target_user_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User not found';
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, created_by)
  values
    (p_target_user_id,
     case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
     p_amount, v_new_balance,
     coalesce(p_reason, 'Admin manual adjustment'),
     auth.uid());

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (auth.uid(), 'admin_balance_adjust', 'profile', p_target_user_id,
          jsonb_build_object('amount', p_amount, 'reason', p_reason, 'new_balance', v_new_balance));

  return v_new_balance;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_credit_bonus(p_target_user_id uuid, p_amount numeric, p_reason text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_new_bonus   numeric;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;

  -- provider_wallets row-u yoxdursa yarat
  insert into public.provider_wallets (provider_id, bonus_balance)
  values (p_target_user_id, p_amount)
  on conflict (provider_id) do update
    set bonus_balance = coalesce(public.provider_wallets.bonus_balance,0) + p_amount
  returning bonus_balance into v_new_bonus;

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (auth.uid(), 'admin_bonus_adjust', 'wallet', p_target_user_id,
          jsonb_build_object('amount', p_amount, 'reason', p_reason, 'new_bonus', v_new_bonus));

  return v_new_bonus;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_dashboard_daily(p_days integer DEFAULT 14)
 RETURNS TABLE(d date, gmv numeric, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
begin
  if auth.uid() is not null then
    select role into v_caller_role from public.profiles where id = auth.uid();
    if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
      raise exception 'Forbidden: caller is not an admin';
    end if;
  end if;

  return query
  with days as (
    select generate_series(
      (current_date - (p_days - 1))::date,
      current_date,
      '1 day'::interval
    )::date as d
  ),
  daily_gmv as (
    select date_trunc('day', created_at)::date as dt, sum(abs(amount)) as g
      from public.transactions
     where type = 'booking_charge' and created_at >= current_date - p_days
     group by 1
  ),
  daily_accept as (
    select date_trunc('day', c.created_at)::date as dt,
           sum(abs(c.amount) - coalesce(l.amt, 0)) as a
      from public.transactions c
      left join (
        select related_id, sum(amount) as amt
          from public.transactions
         where type = 'escrow_lock'
         group by related_id
      ) l on l.related_id = c.related_id
     where c.type = 'booking_charge'
       and c.created_at >= current_date - p_days
     group by 1
  ),
  daily_wd as (
    select date_trunc('day', requested_at)::date as dt, sum(commission_amount) as w
      from public.withdrawals
     where requested_at >= current_date - p_days
     group by 1
  )
  select
    days.d,
    coalesce(daily_gmv.g, 0)::numeric,
    (coalesce(daily_accept.a, 0) + coalesce(daily_wd.w, 0))::numeric
  from days
  left join daily_gmv on daily_gmv.dt = days.d
  left join daily_accept on daily_accept.dt = days.d
  left join daily_wd on daily_wd.dt = days.d
  order by days.d;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_30d timestamptz := now() - interval '30 days';
  v_7d  timestamptz := now() - interval '7 days';
  v_result jsonb;
  v_caller_role text;
begin
  if auth.uid() is not null then
    select role into v_caller_role from public.profiles where id = auth.uid();
    if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
      raise exception 'Forbidden: caller is not an admin';
    end if;
  end if;

  with
  counts as (
    select
      (select count(*) from public.profiles)                                                 as total_users,
      (select count(*) from public.profiles where created_at >= v_7d)                       as new_users_7d,
      (select count(*) from public.profiles where lower(coalesce(role,'')) = 'provider')    as total_providers,
      (select count(*) from public.bookings)                                                as total_bookings,
      (select count(*) from public.bookings where status = 'pending')                       as pending_bookings,
      (select count(*) from public.bookings where status = 'completed')                     as completed_bookings,
      (select count(*) from public.brigades)                                                as total_brigades,
      (select count(*) from public.opportunities
        where status in ('pending','active','ongoing','accepted'))                          as active_opportunities,
      (select count(*) from public.opportunities)                                           as total_opportunities
  ),
  gmv_30d as (
    select coalesce(sum(abs(amount)), 0) as v, count(*) as paid_count
      from public.transactions
     where type = 'booking_charge' and created_at >= v_30d
  ),
  gmv_7d as (
    select coalesce(sum(abs(amount)), 0) as v
      from public.transactions
     where type = 'booking_charge' and created_at >= v_7d
  ),
  -- Acceptance commission: customer-in əlavə ödədiyi 1%
  accept_comm as (
    select coalesce(sum(c.abs_amt - coalesce(l.amt, 0)), 0) as v
      from (
        select related_id, abs(amount) as abs_amt
          from public.transactions
         where type = 'booking_charge' and created_at >= v_30d
      ) c
      left join (
        select related_id, sum(amount) as amt
          from public.transactions
         where type = 'escrow_lock'
         group by related_id
      ) l on l.related_id = c.related_id
  ),
  -- Completion commission: escrow_lock - escrow_release (escrow-dan tutulan)
  complete_comm as (
    select coalesce(sum(l.amt - r.amt), 0) as v
      from (
        select related_id, sum(amount) as amt
          from public.transactions
         where type = 'escrow_lock' and created_at >= v_30d
         group by related_id
      ) l
      join (
        select related_id, sum(amount) as amt
          from public.transactions
         where type = 'escrow_release' and created_at >= v_30d
         group by related_id
      ) r on r.related_id = l.related_id
  ),
  wd as (
    select
      coalesce(sum(commission_amount), 0)                                  as wd_comm,
      coalesce(sum(case when status='pending' then amount_requested end),0) as pending_amount,
      count(*) filter (where status='pending')                              as pending_count
      from public.withdrawals
     where requested_at >= v_30d
  )
  select jsonb_build_object(
    'totalUsers',            c.total_users,
    'newUsers7d',            c.new_users_7d,
    'totalProviders',        c.total_providers,
    'totalBookings',         c.total_bookings,
    'pendingBookings',       c.pending_bookings,
    'completedBookings',     c.completed_bookings,
    'totalBrigades',         c.total_brigades,
    'activeOpportunities',   c.active_opportunities,
    'totalOpportunities',    c.total_opportunities,
    'gmv7d',                 g7.v,
    'gmv30d',                g30.v,
    'completedPayments30d',  g30.paid_count,
    'acceptCommission',      ac.v,
    'completeCommission',    cc.v,
    'withdrawalCommission',  w.wd_comm,
    'platformRevenue30d',    ac.v + cc.v + w.wd_comm,
    'pendingWithdrawalsAmount', w.pending_amount,
    'pendingWithdrawalsCount',  w.pending_count
  )
    into v_result
    from counts c, gmv_30d g30, gmv_7d g7, accept_comm ac, complete_comm cc, wd w;

  return v_result;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
begin
  select lower(coalesce(role,'')) into v_caller_role
    from public.profiles where id = v_caller;
  if v_caller_role not in ('admin','master','superadmin') then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if p_user_id = v_caller then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_DELETE_SELF');
  end if;
  select lower(coalesce(role,'')) into v_target_role
    from public.profiles where id = p_user_id;
  if v_target_role in ('admin','master','superadmin') and v_caller_role <> 'superadmin' then
    return jsonb_build_object('ok', false, 'error', 'ONLY_SUPERADMIN_DELETES_ADMINS');
  end if;

  begin
    delete from public.profiles where id = p_user_id;
    delete from auth.users where id = p_user_id;
    insert into public.audit_log (actor_id, action, target_type, target_id)
    values (v_caller, 'user_delete', 'user', p_user_id::text);
    return jsonb_build_object('ok', true, 'deleted', true);
  exception when foreign_key_violation then
    -- Tarixçəsi (tranzaksiya/sifariş) olan hesab silinmir → soft-ban:
    -- login bloklanır, profil "blocked" olur, data toxunulmaz qalır
    update auth.users set banned_until = 'infinity' where id = p_user_id;
    update public.profiles set status = 'blocked' where id = p_user_id;
    insert into public.audit_log (actor_id, action, target_type, target_id)
    values (v_caller, 'user_soft_ban', 'user', p_user_id::text);
    return jsonb_build_object('ok', true, 'deleted', false, 'banned', true);
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_kyc_list(p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_out jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(row order by row_created desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', v.id,
      'provider_id', v.provider_id,
      'full_name_on_id', v.full_name_on_id,
      'id_number', v.id_number,
      'birth_date', v.birth_date,
      'status', v.status,
      'rejection_reason', v.rejection_reason,
      'admin_notes', v.admin_notes,
      'is_renewal', v.is_renewal,
      'created_at', v.created_at,
      'reviewed_at', v.reviewed_at,
      'id_front_path', v.id_front_path,
      'id_back_path', v.id_back_path,
      'selfie_path', v.selfie_path,
      'provider_name', p.name,
      'provider_email', p.email,
      'provider_phone', p.phone_number,
      'provider_avatar', p.avatar_url
    ) as row,
    v.created_at as row_created
    from public.provider_verifications v
    left join public.profiles p on p.id = v.provider_id
    where p_status is null or p_status = 'all' or v.status = p_status
  ) s;
  return v_out;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_kyc_review(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caller uuid := auth.uid(); v_rec record;
begin
  perform public._require_admin();
  select * into v_rec from public.provider_verifications where id = p_id;
  if v_rec.id is null then raise exception 'KYC tapılmadı'; end if;

  if p_approve then
    update public.provider_verifications
       set status='approved', rejection_reason=null, admin_notes=p_notes,
           reviewed_by=v_caller, reviewed_at=now()
     where id=p_id;
    update public.profiles
       set is_verified=true, verification_status='approved',
           last_kyc_approved_at=now()
     where id=v_rec.provider_id;
  else
    if coalesce(trim(p_reason),'')='' then raise exception 'İmtina səbəbi tələb olunur'; end if;
    update public.provider_verifications
       set status='rejected', rejection_reason=p_reason, admin_notes=p_notes,
           reviewed_by=v_caller, reviewed_at=now()
     where id=p_id;
    update public.profiles
       set is_verified=false, verification_status='rejected'
     where id=v_rec.provider_id;
  end if;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, case when p_approve then 'kyc_approve' else 'kyc_reject' end,
            'provider_verification', p_id::text,
            jsonb_build_object('provider_id', v_rec.provider_id, 'reason', p_reason));
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_list_users_with_meta()
 RETURNS TABLE(id uuid, name text, email text, phone_number text, avatar_url text, role text, is_active boolean, created_at timestamp with time zone, auth_email text, auth_meta jsonb, provider text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_is_admin boolean;
begin
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  return query
    select p.id, p.name, p.email, p.phone_number, p.avatar_url,
           p.role,
           coalesce(p.is_active, true) as is_active,
           p.created_at,
           au.email as auth_email,
           au.raw_user_meta_data as auth_meta,
           coalesce(
             au.raw_app_meta_data->>'provider',
             (au.raw_app_meta_data->'providers'->>0),
             'email'
           ) as provider
      from public.profiles p
      left join auth.users au on au.id = p.id
     order by p.created_at desc nulls last;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_process_withdrawal(p_id uuid, p_status text, p_admin_notes text DEFAULT NULL::text, p_external_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_wd          record;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;
  if p_status not in ('processed','rejected') then
    raise exception 'Invalid status (must be processed or rejected)';
  end if;

  select * into v_wd from public.withdrawals where id = p_id;
  if v_wd.id is null then raise exception 'Withdrawal not found'; end if;
  if v_wd.status <> 'pending' then
    raise exception 'Withdrawal already %', v_wd.status;
  end if;

  if p_status = 'rejected' then
    update public.profiles
       set balance = coalesce(balance, 0) + v_wd.amount_requested
     where id = v_wd.provider_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_wd.provider_id, 'refund', v_wd.amount_requested, 0,
       'Nağdlaşdırma rədd edildi: ' || coalesce(p_admin_notes,'—'),
       v_wd.id::text, auth.uid());
  end if;

  update public.withdrawals
     set status       = p_status,
         admin_notes  = coalesce(p_admin_notes, admin_notes),
         external_id  = coalesce(p_external_id, external_id),
         processed_at = now()
   where id = p_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (auth.uid(), 'withdrawal_' || p_status, 'withdrawal', p_id::text,
            jsonb_build_object('amount', v_wd.amount_requested,
                               'net', v_wd.net_amount, 'notes', p_admin_notes,
                               'external_id', p_external_id));
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_reject_brigade_application(p_application_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_app    record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_app from public.brigade_applications where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status;
  end if;

  update public.brigade_applications
     set status = 'rejected',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_reason
   where id = p_application_id;

  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_app.applicant_id,
      'Briqada müraciəti imtina edildi',
      coalesce(p_reason, 'Müraciətiniz qəbul olunmadı.'),
      'brigade_rejected',
      p_application_id::text,
      '/brigades'
    );
  exception when others then null;
  end;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_reject', 'brigade_application', p_application_id::text,
            jsonb_build_object('reason', p_reason));
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_reject_provider_request(p_request_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_req    record;
  v_is_admin boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = v_caller
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) into v_is_admin;
  if not v_is_admin then raise exception 'Forbidden: admin only'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Request already %', v_req.status;
  end if;

  update public.provider_requests
     set status = 'rejected',
         decided_at = now(),
         decided_by = v_caller,
         admin_note = p_reason
   where id = p_request_id;

  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (
      v_req.user_id,
      'Provayder müraciəti imtina edildi',
      coalesce(p_reason, 'Müraciətiniz qəbul olunmadı.'),
      'provider_rejected',
      p_request_id::text,
      '/account'
    );
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid();

  if v_caller_role is null
     or lower(v_caller_role) not in ('admin', 'master', 'superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;

  if p_new_role not in ('customer', 'provider', 'admin') then
    raise exception 'Invalid role: %', p_new_role;
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_target_user_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.admin_update_commission(p_key text, p_value numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if lower(coalesce(v_caller_role,'')) not in ('admin','master','superadmin') then
    raise exception 'Forbidden: caller is not an admin';
  end if;
  if p_key not in (
    'commission_on_accept','commission_on_complete','commission_on_withdrawal',
    'min_withdrawal_amount','commission_customer_service_fee','cash_deposit_pct',
    'brigade_member_commission_pct','brigade_commission_on_accept','brigade_commission_on_complete',
    'bonus_on_complete'
  ) then raise exception 'Invalid config key: %', p_key; end if;
  if p_value is null then raise exception 'Value cannot be null'; end if;
  if p_value < 0 then raise exception 'Value must be >= 0'; end if;
  if p_key in (
    'commission_on_accept','commission_on_complete','commission_on_withdrawal',
    'commission_customer_service_fee','cash_deposit_pct','brigade_member_commission_pct',
    'brigade_commission_on_accept','brigade_commission_on_complete','bonus_on_complete'
  ) and p_value > 100 then raise exception 'Percentage value must be <= 100'; end if;
  insert into public.platform_config (key, value, description)
  values (p_key, to_jsonb(p_value), null)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.apply_for_brigade(p_name text, p_description text DEFAULT NULL::text, p_categories text[] DEFAULT '{}'::text[], p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_app_id uuid;
  v_app_name  text;
  v_app_email text;
  v_app_phone text;
  v_meta jsonb;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name required'; end if;

  -- Pending varsa imtina
  if exists (
    select 1 from public.brigade_applications
     where applicant_id = v_caller and status = 'pending'
  ) then
    raise exception 'Sizin artıq aktiv müraciətiniz var';
  end if;

  -- Profil + auth.users metadata-dan applicant snapshot tutub yazırıq
  select coalesce(p.name, ''),
         coalesce(p.email, ''),
         coalesce(p.phone_number, '')
    into v_app_name, v_app_email, v_app_phone
    from public.profiles p
   where p.id = v_caller;

  begin
    select au.raw_user_meta_data, au.email
      into v_meta, v_app_email
      from auth.users au
     where au.id = v_caller;
    -- Email-ı profillə birləşdir
    if v_app_email is null or v_app_email = '' then
      v_app_email := coalesce(v_meta->>'email', '');
    end if;
    if v_app_name is null or v_app_name = '' then
      v_app_name := coalesce(
        v_meta->>'full_name',
        v_meta->>'name',
        v_meta->>'display_name',
        ''
      );
    end if;
    if v_app_phone is null or v_app_phone = '' then
      v_app_phone := coalesce(v_meta->>'phone', v_meta->>'phone_number', '');
    end if;
  exception when others then null;
  end;

  insert into public.brigade_applications (
    applicant_id, name, description, categories,
    contact_phone, contact_email, address, logo_url,
    applicant_name, applicant_email, applicant_phone
  ) values (
    v_caller, p_name, p_description, coalesce(p_categories, '{}'),
    p_contact_phone, p_contact_email, p_address, p_logo_url,
    nullif(v_app_name, ''), nullif(v_app_email, ''), nullif(v_app_phone, '')
  )
  returning id into v_app_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_apply', 'brigade_application', v_app_id::text,
            jsonb_build_object('name', p_name));
  exception when others then null;
  end;

  return v_app_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.apply_service_promotion(p_service_id uuid, p_promotion_type text, p_promotion_days integer, p_payment_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment record;
  v_now     timestamptz := now();
  v_until   timestamptz;
begin
  select id, user_id, status, amount, metadata
    into v_payment
    from public.payments
   where id = p_payment_id;

  if not found then
    raise exception 'Payment % not found', p_payment_id;
  end if;

  if (v_payment.metadata->>'purpose') is distinct from 'service_promotion' then
    raise exception 'Payment % is not a service_promotion', p_payment_id;
  end if;

  perform 1
    from public.services s
   where s.id = p_service_id
     and s.provider_id = v_payment.user_id;
  if not found then
    raise exception 'Service % does not belong to payment user', p_service_id;
  end if;

  if p_promotion_days is null or p_promotion_days <= 0 or p_promotion_days > 365 then
    raise exception 'Invalid promotion_days: %', p_promotion_days;
  end if;

  if p_promotion_type not in ('vip','premium') then
    raise exception 'Invalid promotion_type: %', p_promotion_type;
  end if;

  v_until := greatest(v_now, coalesce(
              (select promotion_expires_at from public.services where id = p_service_id), v_now))
             + (p_promotion_days || ' days')::interval;

  update public.services
     set promotion_type       = p_promotion_type,
         promotion_expires_at = v_until,
         updated_at           = v_now
   where id = p_service_id;

  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (
    v_payment.user_id,
    'service_promotion_applied',
    'service',
    p_service_id,
    jsonb_build_object(
      'promotion_type', p_promotion_type,
      'days',           p_promotion_days,
      'until',          v_until,
      'payment_id',     p_payment_id
    )
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.approve_kyc(p_verification_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_ver    record;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select coalesce(role, '') into v_role from public.profiles where id = v_caller;
  if lower(v_role) not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY');
  end if;

  select * into v_ver from public.provider_verifications
    where id = p_verification_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_NOT_FOUND');
  end if;

  if v_ver.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_ver.status);
  end if;

  update public.provider_verifications
     set status = 'approved',
         admin_notes = p_notes,
         reviewed_by = v_caller,
         reviewed_at = now()
   where id = p_verification_id;

  -- Profile flag-larını yenilə
  update public.profiles
     set is_verified = true,
         verification_status = 'approved'
   where id = v_ver.provider_id;

  return jsonb_build_object('ok', true, 'provider_id', v_ver.provider_id);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.audit_log_sync_actor()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.actor is null and new.actor_id is not null then
    new.actor := new.actor_id;
  elsif new.actor_id is null and new.actor is not null then
    new.actor_id := new.actor;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.auto_broadcast_opportunity(p_opp_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp        record;
  v_inserted   int := 0;
  v_brigade_id uuid;
  v_member_id  uuid;
begin
  select id, category_id, subcategory_id, status, created_by
    into v_opp
    from public.opportunities
   where id = p_opp_id;
  if v_opp.id is null then return 0; end if;

  -- Bu opportunity-yə artıq accepted/in_progress assignment varsa, skip
  if exists (
    select 1 from public.brigade_assignments
     where source_id = p_opp_id::text
       and status in ('accepted', 'in_progress', 'completed')
  ) then
    return 0;
  end if;

  -- Uyğun briqadaları tap: brigade_prices-də həmin category üçün
  -- aktiv qiyməti olan, briqada özü is_active=true (əgər sahə varsa)
  for v_brigade_id, v_member_id in
    select distinct bp.brigade_id, bm.id
      from public.brigade_prices bp
      join public.brigade_members bm on bm.brigade_id = bp.brigade_id
     where bp.category_id = v_opp.category_id
       and bp.is_active = true
       and (bp.subcategory_id is null or bp.subcategory_id = v_opp.subcategory_id)
       and bm.is_active = true
       and bm.is_online = true
       and bm.profile_id <> coalesce(v_opp.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
       -- Bloklananları çıxar
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocked_id = bm.profile_id
            and ub.scope = 'global'
       )
  loop
    begin
      insert into public.brigade_assignments
        (brigade_id, member_id, source_type, source_id,
         assigned_by, status, priority)
      values
        (v_brigade_id, v_member_id, 'opportunity', p_opp_id::text,
         null, 'offered', 5);
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      null;  -- artıq broadcast olunmuş
    end;
  end loop;

  return v_inserted;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.auto_release_completed_escrow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
  v_rec   record;
begin
  for v_rec in
    select o.id as offer_id, opp.id as opp_id
    from public.opportunities_offers o
    join public.opportunities opp on opp.id = o.opportunity_id
    where opp.status = 'completed'
      and opp.completed_at < (now() - interval '24 hours')
      and o.status = 'accepted'
      and o.escrow_released_at is null
      and not exists (
        select 1 from public.disputes d
        where d.opportunity_id = opp.id
          and d.status in ('open', 'under_review')
      )
    for update of o skip locked
    limit 100
  loop
    begin
      perform public.release_offer_to_provider(v_rec.offer_id);
      update public.opportunities_offers
         set escrow_released_at = now()
       where id = v_rec.offer_id;
      v_count := v_count + 1;
    exception when others then
      -- Sakit keç, növbəti dövrdə təkrar cəhd
      null;
    end;
  end loop;
  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.auto_release_on_opportunity_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer_id uuid; v_provider_id uuid; v_brigade_id uuid;
  v_locked_amt numeric; v_commission_pct numeric; v_commission_amt numeric;
  v_release_amt numeric; v_brigade_pct numeric; v_brigade_cut numeric; v_worker_amt numeric;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  v_offer_id := new.accepted_offer_id;
  if v_offer_id is null then return new; end if;

  select oo.provider_id, oo.brigade_id into v_provider_id, v_brigade_id
    from public.opportunities_offers oo where oo.id = v_offer_id;
  if v_provider_id is null then return new; end if;

  select amount into v_locked_amt from public.transactions
   where related_id = v_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then
    update public.opportunities_offers set status='completed' where id=v_offer_id and status<>'completed';
    return new;
  end if;
  if exists (select 1 from public.transactions where related_id=v_offer_id::text and type='escrow_release') then
    return new;
  end if;

  -- Komanda işi üçün ayrıca tamamlama komissiyası; yoxdursa fərdi faizə fallback
  select coalesce(
    (select (value)::text::numeric from public.platform_config
       where key = case when v_brigade_id is not null
                        then 'brigade_commission_on_complete' else 'commission_on_complete' end),
    (select (value)::text::numeric from public.platform_config where key = 'commission_on_complete'),
    0
  ) into v_commission_pct;
  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt := v_locked_amt - v_commission_amt;
  if v_release_amt < 0 then v_release_amt := 0; end if;

  -- Komanda sifarişidirsə: işçinin payından komanda faizini ayır
  v_brigade_cut := 0;
  if v_brigade_id is not null then
    select coalesce((value)::text::numeric, 0) into v_brigade_pct
      from public.platform_config where key = 'brigade_member_commission_pct';
    v_brigade_cut := round(v_release_amt * coalesce(v_brigade_pct,0) / 100, 2);
    if v_brigade_cut > v_release_amt then v_brigade_cut := v_release_amt; end if;
  end if;
  v_worker_amt := v_release_amt - v_brigade_cut;

  update public.provider_wallets
     set locked_balance = greatest(coalesce(locked_balance,0) - v_locked_amt, 0),
         balance        = coalesce(balance, 0) + v_worker_amt,
         total_earned   = coalesce(total_earned, 0) + v_worker_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  if v_brigade_cut > 0 and v_brigade_id is not null then
    update public.brigades set balance = coalesce(balance,0) + v_brigade_cut, updated_at = now()
     where id = v_brigade_id;
    begin
      insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
      values (v_provider_id, 'brigade_payout', v_brigade_cut, 0,
        'Komanda payı (' || v_brigade_pct || '%) offer ' || left(v_offer_id::text,8), v_offer_id::text, v_provider_id);
    exception when others then null; end;
  end if;

  update public.opportunities_offers set status='completed' where id=v_offer_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, related_id, created_by)
  values (v_provider_id, 'escrow_release', v_worker_amt, 0,
    'Auto-release: escrow ' || v_locked_amt || ' ₼ − komissiya (' || v_commission_pct || '%) '
      || v_commission_amt || ' ₼' || case when v_brigade_cut>0 then ' − komanda ' || v_brigade_cut || ' ₼' else '' end
      || ' = ' || v_worker_amt || ' ₼',
    v_offer_id::text, coalesce(auth.uid(), v_provider_id));

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.block_user(p_blocked_id uuid, p_reason text DEFAULT NULL::text, p_scope text DEFAULT 'global'::text, p_brigade_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_id     uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_blocked_id then raise exception 'Cannot block yourself'; end if;
  if p_scope not in ('global', 'brigade', 'customer') then
    raise exception 'Invalid scope';
  end if;

  -- Brigade scope-da yoxla ki, caller həmin brigade-in dispatcher/owner-idirmi
  if p_scope = 'brigade' then
    if p_brigade_id is null then raise exception 'brigade_id required'; end if;
    if not is_brigade_dispatcher(p_brigade_id, v_caller) then
      raise exception 'Forbidden: only brigade owner/dispatcher';
    end if;

    -- Brigade-dən üzvü çıxar
    update public.brigade_members
       set is_active = false
     where brigade_id = p_brigade_id and profile_id = p_blocked_id;
  end if;

  -- Block sətrini yarat (ON CONFLICT DO NOTHING)
  insert into public.user_blocks (blocker_id, blocked_id, reason, scope, brigade_id)
  values (v_caller, p_blocked_id, p_reason, p_scope, p_brigade_id)
  on conflict do nothing
  returning id into v_id;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'user_block', 'user', p_blocked_id::text,
            jsonb_build_object('scope', p_scope, 'brigade_id', p_brigade_id, 'reason', p_reason));
  exception when others then null;
  end;

  return v_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_assign_order(p_brigade_id uuid, p_source_type text, p_source_id text, p_member_ids uuid[], p_notes text DEFAULT NULL::text, p_priority smallint DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_count       integer := 0;
  v_member_id   uuid;
begin
  v_caller_role := public.brigade_role(p_brigade_id);
  if v_caller_role is null or v_caller_role not in ('owner', 'dispatcher') then
    raise exception 'Forbidden: only owner/dispatcher can assign orders';
  end if;

  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    raise exception 'Must provide at least one member_id';
  end if;

  foreach v_member_id in array p_member_ids loop
    -- Ensure the member belongs to this brigade
    if not exists (
      select 1 from public.brigade_members bm
      where bm.id = v_member_id
        and bm.brigade_id = p_brigade_id
        and bm.is_active = true
    ) then
      raise exception 'Member % does not belong to brigade %', v_member_id, p_brigade_id;
    end if;

    insert into public.brigade_assignments
      (brigade_id, member_id, source_type, source_id, assigned_by, notes, priority)
    values
      (p_brigade_id, v_member_id, p_source_type, p_source_id, auth.uid(), p_notes, p_priority)
    on conflict (brigade_id, source_id, member_id) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_assignment_complete(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_assignment record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select a.*, m.profile_id as member_profile_id, m.brigade_id as bid
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;

  -- Member özü VƏ YA dispatcher tamamlanmış kimi qeyd edə bilər
  if v_assignment.member_profile_id <> v_caller
     and not is_brigade_dispatcher(v_assignment.bid, v_caller) then
    raise exception 'Forbidden';
  end if;
  if v_assignment.status not in ('accepted', 'in_progress') then
    raise exception 'Assignment cannot be completed from %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = 'completed',
         completed_at = now()
   where id = p_assignment_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_assignment_respond(p_assignment_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_assignment record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_action not in ('accept', 'decline') then
    raise exception 'Invalid action (accept | decline)';
  end if;

  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden: only assigned member can respond';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'Assignment already %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = case when p_action = 'accept' then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_assignment_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_assignment_start(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_a record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select a.*, m.profile_id as member_profile_id
    into v_a
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id
   for update of a;
  if v_a.id is null then raise exception 'Assignment not found'; end if;
  if v_a.member_profile_id <> v_caller then
    raise exception 'Forbidden: only assigned member can start';
  end if;
  if v_a.status not in ('accepted','assigned') then
    raise exception 'Cannot start from status %', v_a.status;
  end if;
  update public.brigade_assignments
     set status = 'in_progress', responded_at = coalesce(responded_at, now())
   where id = p_assignment_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_dispatch_assign(p_brigade_id uuid, p_opportunity_id uuid, p_member_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller          uuid := auth.uid();
  v_opp             record;
  v_member          record;
  v_cur             record;
  v_commission_pct  numeric;
  v_commission_amt  numeric;
  v_brigade_bal     numeric;
  v_offer_id        uuid;
  v_existing_asg    record;
  v_assignment_id   uuid;
  v_profile_id      uuid;
  v_brigade_name    text;
  v_dispatcher_name text;
  v_worker_name     text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Təklif məbləği müsbət olmalıdır';
  end if;
  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Yalnız briqada sahibi və ya dispatcher sifariş yönləndirə bilər';
  end if;

  select id, status, budget, created_by, accepted_offer_id
    into v_opp from public.opportunities where id = p_opportunity_id for update;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizi yönləndirə bilməzsiniz';
  end if;

  -- Başqası (başqa briqada/işçi) götürübsə
  if v_opp.accepted_offer_id is not null
     or v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb';
  end if;
  if exists (select 1 from public.brigade_assignments
             where source_id = p_opportunity_id::text
               and brigade_id <> p_brigade_id
               and status in ('accepted', 'in_progress', 'completed')) then
    raise exception 'ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb';
  end if;

  -- ── RE-ROUTE + 10 SANİYƏ COOLDOWN ──────────────────────────────────
  -- Bu briqadanın bu sifariş üzrə cari aktiv təyinatı (istənilən işçi)
  select id, member_id, status, assigned_at into v_cur
    from public.brigade_assignments
   where brigade_id = p_brigade_id
     and source_id  = p_opportunity_id::text
     and status in ('assigned', 'accepted', 'in_progress')
   order by assigned_at desc
   limit 1;

  if v_cur.id is not null and v_cur.member_id <> p_member_id then
    -- İş artıq qəbul edilib/başlayıbsa dəyişmək olmaz
    if v_cur.status in ('accepted', 'in_progress') then
      raise exception 'Bu sifariş artıq işçi tərəfindən qəbul edilib — işçini dəyişmək olmaz';
    end if;
    -- 10 saniyə cooldown (son yönləndirmədən)
    if now() - v_cur.assigned_at < interval '10 seconds' then
      raise exception 'COOLDOWN: Yönləndirməni dəyişmək üçün 10 saniyə gözləyin (%s)',
        ceil(extract(epoch from (interval '10 seconds' - (now() - v_cur.assigned_at))))::int;
    end if;
    -- Köhnə işçinin təyinatını ləğv et
    update public.brigade_assignments
       set status = 'cancelled', responded_at = now()
     where id = v_cur.id;
  end if;

  -- İşçi
  select bm.id, bm.profile_id into v_member
    from public.brigade_members bm
   where bm.id = p_member_id and bm.brigade_id = p_brigade_id and bm.is_active = true;
  if v_member.id is null then raise exception 'İşçi bu briqadanın aktiv üzvü deyil'; end if;
  v_profile_id := v_member.profile_id;
  if v_profile_id = v_opp.created_by then
    raise exception 'İşçi sifarişin sahibi ola bilməz';
  end if;

  -- Komissiya (briqada balansı operativ gate)
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * coalesce(v_commission_pct, 0) / 100, 2);
  select coalesce(balance, 0) into v_brigade_bal from public.brigades where id = p_brigade_id;
  if v_brigade_bal < v_commission_amt then
    raise exception 'NO_BALANCE: Briqada balansında minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
      v_commission_amt, v_commission_pct, v_brigade_bal;
  end if;

  -- Təklif işçinin adından
  select id into v_offer_id from public.opportunities_offers
   where opportunity_id = p_opportunity_id and brigade_id = p_brigade_id and status = 'pending' limit 1;
  if v_offer_id is null then
    insert into public.opportunities_offers
      (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)
    values (p_opportunity_id, v_profile_id, p_brigade_id, p_amount, 'pending', p_notes)
    returning id into v_offer_id;
  else
    update public.opportunities_offers
       set provider_id = v_profile_id, offer_amount = p_amount, notes = coalesce(p_notes, notes)
     where id = v_offer_id;
  end if;

  -- İşçiyə təyinat
  select * into v_existing_asg from public.brigade_assignments
   where brigade_id = p_brigade_id and source_id = p_opportunity_id::text and member_id = p_member_id;
  if v_existing_asg.id is null then
    insert into public.brigade_assignments
      (brigade_id, member_id, source_type, source_id, assigned_by, status, notes, priority)
    values (p_brigade_id, p_member_id, 'opportunity', p_opportunity_id::text, v_caller, 'assigned', p_notes, 5)
    returning id into v_assignment_id;
  else
    update public.brigade_assignments
       set status = 'assigned', assigned_by = v_caller, notes = coalesce(p_notes, notes),
           responded_at = null, assigned_at = now()
     where id = v_existing_asg.id returning id into v_assignment_id;
    select name into v_brigade_name from public.brigades where id = p_brigade_id;
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (v_profile_id, coalesce(v_brigade_name, 'Briqada') || ' — yeni təyinat',
      'Sifariş sənə təyin edildi. Qəbul və ya rədd et.',
      'brigade_assignment', v_assignment_id::text, '/account/master/incoming');
  end if;

  begin
    select name into v_brigade_name    from public.brigades where id = p_brigade_id;
    select name into v_dispatcher_name from public.profiles where id = v_caller;
    select name into v_worker_name     from public.profiles where id = v_profile_id;
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_dispatch_assign', 'opportunity_offer', v_offer_id::text,
            jsonb_build_object('brigade_id', p_brigade_id, 'brigade_name', v_brigade_name,
              'opportunity_id', p_opportunity_id, 'member_id', p_member_id,
              'worker_profile_id', v_profile_id, 'worker_name', v_worker_name,
              'dispatcher_id', v_caller, 'dispatcher_name', v_dispatcher_name,
              'rerouted', v_cur.id is not null and v_cur.member_id <> p_member_id,
              'on_behalf_of_worker', true, 'amount', p_amount));
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'offer_id', v_offer_id, 'assignment_id', v_assignment_id,
    'provider_id', v_profile_id, 'amount', p_amount, 'required_balance', v_commission_amt,
    'rerouted', v_cur.id is not null and v_cur.member_id <> p_member_id);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_dispatch_order(p_brigade_id uuid, p_source_id text, p_member_ids uuid[], p_priority integer DEFAULT 5, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_inserted int := 0;
  v_member_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Forbidden: only brigade owner/dispatcher can dispatch';
  end if;

  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    raise exception 'At least one member_id required';
  end if;

  -- Hər member üçün assignment yarat (uniqueness constraint duplicate-i tutar)
  foreach v_member_id in array p_member_ids
  loop
    begin
      insert into public.brigade_assignments
        (brigade_id, member_id, source_type, source_id,
         assigned_by, status, notes, priority)
      values
        (p_brigade_id, v_member_id, 'opportunity', p_source_id,
         v_caller, 'assigned', p_notes, p_priority);
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      -- Bu member-ə artıq təyin edilib — keç
      null;
    end;
  end loop;

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      v_caller,
      'brigade_dispatch',
      'brigade_assignment',
      p_source_id,
      jsonb_build_object(
        'brigade_id', p_brigade_id,
        'member_count', v_inserted,
        'priority', p_priority
      )
    );
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_distribute_balance(p_brigade_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select owner_id, coalesce(balance, 0)
    into v_owner_id, v_brigade_bal
    from public.brigades
   where id = p_brigade_id
   for update;
  if v_owner_id is null then raise exception 'Briqada tapılmadı'; end if;
  if v_owner_id <> v_caller then
    raise exception 'Yalnız briqada sahibi pul bölgüsü edə bilər';
  end if;

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
    raise exception 'NO_BALANCE: Briqada balansı yetərli deyil (lazım: % AZN, mövcud: % AZN)',
      v_total, v_brigade_bal;
  end if;

  update public.brigades
     set balance    = balance - v_total,
         updated_at = now()
   where id = p_brigade_id
   returning balance into v_new_brigade;

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

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_caller, 'brigade_payout', -v_total, v_new_brigade,
     'Üzvlərə pul bölgüsü (' || v_count || ' nəfər)',
     p_brigade_id::text, v_caller);

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'brigade_payout', 'brigade', p_brigade_id::text,
            jsonb_build_object('total', v_total, 'count', v_count, 'allocations', p_allocations));
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true, 'total', v_total, 'count', v_count, 'brigade_balance', v_new_brigade
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_pick_worker(p_brigade_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- İlk online işçi (məsafə yoxlanmır hələlik)
  select id from public.brigade_members
   where brigade_id = p_brigade_id
     and is_active = true
     and is_online = true
   order by last_heartbeat desc nulls last, joined_at asc
   limit 1;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_place_offer(p_brigade_id uuid, p_opportunity_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller         uuid := auth.uid();
  v_brigade_bal    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_opp            record;
  v_offer_id       uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid məbləği müsbət olmalıdır';
  end if;

  -- Yalnız dispatcher/owner
  if not is_brigade_dispatcher(p_brigade_id, v_caller) then
    raise exception 'Yalnız briqada sahibi və ya dispatcher təklif verə bilər';
  end if;

  -- Komissiya
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);

  -- Briqada balansı yoxla
  select coalesce(balance, 0) into v_brigade_bal
    from public.brigades where id = p_brigade_id;
  if v_brigade_bal < v_commission_amt then
    raise exception 'NO_BALANCE: Briqada balansında minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
      v_commission_amt, v_commission_pct, v_brigade_bal;
  end if;

  -- Opportunity yoxla
  select id, status, created_by into v_opp
    from public.opportunities where id = p_opportunity_id;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizə təklif verə bilməzsiniz';
  end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'Sifariş artıq aktiv deyil';
  end if;

  -- Bu briqada artıq təklif veribsə skip
  if exists (
    select 1 from public.opportunities_offers
     where opportunity_id = p_opportunity_id
       and brigade_id     = p_brigade_id
       and status         = 'pending'
  ) then
    raise exception 'Briqada artıq bu sifarişə təklif verib';
  end if;

  -- provider_id = dispatcher (kim göndərdi) — briqada təklifi olduğu
  -- brigade_id ilə fərqləndirilir
  insert into public.opportunities_offers
    (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)
  values
    (p_opportunity_id, v_caller, p_brigade_id, p_amount, 'pending', p_notes)
  returning id into v_offer_id;

  return jsonb_build_object(
    'ok', true,
    'offer_id', v_offer_id,
    'amount', p_amount,
    'required_balance', v_commission_amt
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_role(p_brigade_id uuid, p_profile_id uuid DEFAULT auth.uid())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select bm.role
  from public.brigade_members bm
  where bm.brigade_id = p_brigade_id
    and bm.profile_id = p_profile_id
    and bm.is_active = true
  limit 1
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.brigade_top_up_from_owner(p_brigade_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller        uuid := auth.uid();
  v_owner_id      uuid;
  v_owner_balance numeric;
  v_new_brigade   numeric;
  v_new_owner     numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select owner_id into v_owner_id
    from public.brigades where id = p_brigade_id;
  if v_owner_id is null then raise exception 'Briqada tapılmadı'; end if;
  if v_owner_id <> v_caller then
    raise exception 'Yalnız briqada sahibi top-up edə bilər';
  end if;

  select coalesce(balance, 0) into v_owner_balance
    from public.profiles where id = v_caller;
  if v_owner_balance < p_amount then
    raise exception 'INSUFFICIENT_BALANCE: Şəxsi balans yetərli deyil (cari: % ₼)',
      v_owner_balance;
  end if;

  -- Atomik köçürmə
  update public.profiles
     set balance = balance - p_amount
   where id = v_caller and coalesce(balance, 0) >= p_amount
   returning balance into v_new_owner;
  if v_new_owner is null then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  update public.brigades
     set balance = coalesce(balance, 0) + p_amount,
         updated_at = now()
   where id = p_brigade_id
   returning balance into v_new_brigade;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_caller, 'admin_adjust', -p_amount, v_new_owner,
     'Briqada balansına köçürmə (' || p_brigade_id::text || ')',
     p_brigade_id::text, v_caller);

  return jsonb_build_object(
    'ok', true,
    'brigade_balance', v_new_brigade,
    'owner_balance', v_new_owner
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.cancel_brigade_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_app    record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_app from public.brigade_applications where id = p_application_id;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.applicant_id <> v_caller then raise exception 'Forbidden'; end if;
  if v_app.status <> 'pending' then
    raise exception 'Cannot cancel %', v_app.status;
  end if;

  update public.brigade_applications
     set status = 'cancelled', decided_at = now()
   where id = p_application_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.cancel_opportunity(p_opportunity_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_opp      record;
  v_offer    record;
  v_refunded numeric := 0;
  v_deposit  numeric := 0;
  v_escrow   numeric;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select * into v_opp from public.opportunities
   where id = p_opportunity_id for update;
  if v_opp.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  v_is_admin := exists (select 1 from public.profiles
    where id = v_caller and lower(coalesce(role,'')) in ('admin','master','superadmin'));
  if v_opp.created_by <> v_caller and not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  if v_opp.status not in ('pending','open','new','active','accepted') then
    return jsonb_build_object('ok', false, 'error', 'NOT_CANCELLABLE',
                              'current_status', v_opp.status);
  end if;

  -- Qəbul edilmiş təklif varsa — pul geri qaytarılır
  if v_opp.accepted_offer_id is not null then
    select * into v_offer from public.opportunities_offers
     where id = v_opp.accepted_offer_id for update;

    if v_offer.id is not null and v_offer.status = 'accepted' then
      -- İdempotency: bu offer üçün refund artıq varsa təkrarlanmır
      if not exists (
        select 1 from public.transactions
         where type = 'refund'
           and payment_id = concat('refund:', v_offer.id::text)
      ) then
        if v_offer.payment_method = 'card' then
          -- Escrow-nu provayder cüzdanından aç
          select amount into v_escrow from public.transactions
           where related_id = v_offer.id::text and type = 'escrow_lock'
           order by created_at desc limit 1;
          if v_escrow is not null then
            update public.provider_wallets
               set locked_balance = greatest(coalesce(locked_balance,0) - v_escrow, 0),
                   updated_at = now()
             where provider_id = v_offer.provider_id;
          end if;
          -- Müştəriyə tam məbləğ geri
          v_refunded := v_offer.offer_amount;
          update public.profiles
             set balance = coalesce(balance,0) + v_refunded
           where id = v_opp.created_by;
          insert into public.transactions
            (user_id, type, amount, balance_after, description, related_id,
             payment_id, created_by)
          select v_opp.created_by, 'refund', v_refunded, p.balance,
                 'Sifariş ləğvi — geri qaytarma', v_offer.id::text,
                 concat('refund:', v_offer.id::text), v_caller
            from public.profiles p where p.id = v_opp.created_by;
        elsif v_offer.payment_method = 'cash' then
          -- Nağd: qarantili depozit geri qaytarılır
          select abs(amount) into v_deposit from public.transactions
           where related_id = v_offer.id::text and type = 'cash_deposit_lock'
           order by created_at desc limit 1;
          if coalesce(v_deposit,0) > 0 then
            v_refunded := v_deposit;
            update public.profiles
               set balance = coalesce(balance,0) + v_deposit
             where id = v_opp.created_by;
            insert into public.transactions
              (user_id, type, amount, balance_after, description, related_id,
               payment_id, created_by)
            select v_opp.created_by, 'refund', v_deposit, p.balance,
                   'Sifariş ləğvi — depozit geri qaytarıldı', v_offer.id::text,
                   concat('refund:', v_offer.id::text), v_caller
              from public.profiles p where p.id = v_opp.created_by;
          end if;
        end if;
      end if;

      update public.opportunities_offers
         set status = 'rejected', updated_at = now()
       where id = v_offer.id;

      -- Provayderə bildiriş
      insert into public.notifications (user_id, type, title, body, related_id)
      values (v_offer.provider_id, 'order_cancelled', 'Sifariş ləğv edildi',
              coalesce('Səbəb: ' || nullif(trim(p_reason), ''), 'Müştəri sifarişi ləğv etdi'),
              p_opportunity_id::text);
    end if;
  end if;

  -- Bütün gözləyən təkliflər bağlanır
  update public.opportunities_offers
     set status = 'rejected', updated_at = now()
   where opportunity_id = p_opportunity_id and status = 'pending';

  update public.opportunities
     set status = 'cancelled',
         cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'Müştəri ləğv etdi'),
         accepted_offer_id = null,
         provider_id = null
   where id = p_opportunity_id;

  return jsonb_build_object('ok', true, 'refunded', v_refunded);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.cancel_provider_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_req    record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_req from public.provider_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.user_id <> v_caller then raise exception 'Forbidden'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Cannot cancel %', v_req.status;
  end if;

  update public.provider_requests
     set status = 'cancelled', decided_at = now()
   where id = p_request_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.cancel_stale_pending_opportunities()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
  v_rec   record;
begin
  for v_rec in
    select id from public.opportunities
    where status in ('pending', 'open', 'new')
      and created_at < (now() - interval '2 hours')
    for update skip locked
  loop
    -- Direct update — trigger-lər service_role bypass üzərində işləyəcək
    update public.opportunities
       set status = 'cancelled',
           cancellation_reason = 'AUTO_CANCEL_STALE_PENDING'
     where id = v_rec.id;

    -- Bütün pending offer-ləri də cancel et
    update public.opportunities_offers
       set status = 'cancelled'
     where opportunity_id = v_rec.id
       and status = 'pending';

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.claim_opportunity(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller       uuid := auth.uid();
  v_assignment   record;
  v_member_uid   uuid;
  v_other_count  int;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  -- Bu assignment-ı kilidlə
  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id
   for update;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden: only assigned member can claim';
  end if;
  if v_assignment.status not in ('offered', 'assigned') then
    raise exception 'Assignment already %', v_assignment.status;
  end if;

  -- Başqa biri artıq qəbul edibmi? (eyni source_id üçün)
  select count(*) into v_other_count
    from public.brigade_assignments
   where source_id = v_assignment.source_id
     and id <> v_assignment.id
     and status in ('accepted', 'in_progress', 'completed');
  if v_other_count > 0 then
    -- Bu offer-i avtomatik expired et
    update public.brigade_assignments
       set status = 'expired', responded_at = now()
     where id = v_assignment.id;
    raise exception 'Sifariş artıq başqa işçi tərəfindən qəbul edildi';
  end if;

  -- Qəbul et
  update public.brigade_assignments
     set status = 'accepted', responded_at = now()
   where id = v_assignment.id;

  -- Eyni opportunity üzrə qalan offerləri expired et
  update public.brigade_assignments
     set status = 'expired', responded_at = now()
   where source_id = v_assignment.source_id
     and id <> v_assignment.id
     and status in ('offered', 'assigned');

  -- Audit
  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'opportunity_claim', 'brigade_assignment',
            v_assignment.id::text,
            jsonb_build_object('source_id', v_assignment.source_id,
                               'brigade_id', v_assignment.brigade_id));
  exception when others then null;
  end;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.cleanup_wallet_on_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if lower(coalesce(new.role, '')) not in ('provider', 'pro', 'seller')
     and lower(coalesce(old.role, '')) in ('provider', 'pro', 'seller') then
    -- Provider-dən çıxır — wallet aktiv pulu varsa, xəbərdarlıq lazımdır
    if exists (
      select 1 from public.provider_wallets
       where provider_id = new.id
         and (coalesce(balance, 0) > 0 or coalesce(locked_balance, 0) > 0)
    ) then
      raise notice 'Role change: % had wallet balance, kept for audit', new.id;
    end if;
    -- Sıfırla, sətri sax — audit üçün
    update public.provider_wallets
       set balance = 0, locked_balance = 0, updated_at = now()
     where provider_id = new.id;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.convert_bonus_to_balance(p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id        uuid := auth.uid();
  v_new_bonus      numeric;
  v_new_balance    numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_credited_amt   numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Komissiya faizi platform_config-dən
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_bonus_convert';

  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);
  v_credited_amt   := p_amount - v_commission_amt;

  -- 1. provider_wallets.bonus_balance-dan çıx (atomic)
  update public.provider_wallets
     set bonus_balance = bonus_balance - p_amount
   where provider_id = v_user_id
     and coalesce(bonus_balance, 0) >= p_amount
   returning bonus_balance into v_new_bonus;

  if v_new_bonus is null then
    raise exception 'Insufficient bonus balance';
  end if;

  -- 2. profiles.balance-ə net məbləği əlavə et
  update public.profiles
     set balance = coalesce(balance, 0) + v_credited_amt
   where id = v_user_id
   returning balance into v_new_balance;

  -- 3. Konvertasiya transaksiyası
  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'bonus_convert', v_credited_amt, v_new_balance,
     'Bonus → Balans (komissiya: ' || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     null, v_user_id);

  -- 4. Platform komissiyası (varsa)
  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_user_id, 'platform_revenue', v_commission_amt, 0,
       'Bonus konvertasiya komissiyası (' || v_commission_pct || '%)',
       null, v_user_id);
  end if;

  -- 5. Bonus log
  begin
    insert into public.provider_bonus_logs
      (provider_id, amount, type, source, created_at, reason)
    values
      (v_user_id, p_amount, 'conversion', 'bonus_to_main_balance',
       now(),
       'Bonus əsas balansa çevrildi (komissiya: '
         || v_commission_pct || '%, net: ' || v_credited_amt || ' ₼)');
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'amount_requested', p_amount,
    'commission_pct', v_commission_pct,
    'commission_amt', v_commission_amt,
    'credited', v_credited_amt,
    'new_balance', v_new_balance
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.create_booking_with_fee(p_service_id bigint, p_date date, p_time text, p_package_name text DEFAULT NULL::text, p_package_price numeric DEFAULT NULL::numeric, p_package_duration text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_fee constant numeric := 1.00;
  v_provider uuid;
  v_price numeric;
  v_total numeric;
  v_balance numeric;
  v_booking_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if p_date is null or coalesce(trim(p_time), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select provider_id, price into v_provider, v_price
    from services where id = p_service_id;
  if v_provider is null then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_NOT_FOUND');
  end if;

  v_total := coalesce(p_package_price, v_price, 0);

  update profiles set balance = coalesce(balance, 0) - v_fee
   where id = v_uid and coalesce(balance, 0) >= v_fee
   returning balance into v_balance;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE', 'fee', v_fee);
  end if;

  insert into bookings (customer_id, provider_id, service_id, date, time, status,
                        total_amount, package_name, package_price, package_duration,
                        notes, fee_paid)
  values (v_uid, v_provider, p_service_id, p_date, p_time, 'pending',
          v_total, p_package_name, p_package_price, p_package_duration,
          nullif(trim(coalesce(p_notes, '')), ''), true)
  returning id into v_booking_id;

  insert into transactions (user_id, type, amount, balance_after, description, related_id)
  values (v_uid, 'booking_charge', -v_fee, v_balance, 'Sifariş komissiyası', v_booking_id::text);

  insert into transactions (user_id, type, amount, description, related_id)
  values (null, 'platform_revenue', v_fee, 'Sifariş komissiyası', v_booking_id::text);

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id,
                            'fee', v_fee, 'balance', v_balance);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.credit_balance(p_user_id uuid, p_amount numeric, p_payment_id bigint, p_reason text DEFAULT 'top_up'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_balance numeric;
  v_already boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Idempotency: bu ödəniş üçün artıq top_up yazılıbsa təkrar kreditləmə.
  select exists(
    select 1 from public.transactions
    where type = 'top_up' and related_id = p_payment_id::text
  ) into v_already;

  if v_already then
    select balance into v_new_balance from public.profiles where id = p_user_id;
    return v_new_balance;
  end if;

  update public.profiles
     set balance = coalesce(balance, 0) + p_amount
   where id = p_user_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, payment_id)
  values
    (p_user_id, 'top_up', p_amount, v_new_balance,
     coalesce(p_reason, 'Balance top-up'), p_payment_id::text, null);

  return v_new_balance;
end$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.decline_brigade_invite(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_invite
  from public.brigade_invites
  where token = p_token and status = 'pending'
  for update;

  if v_invite is null then
    raise exception 'Invite not found or already responded';
  end if;

  update public.brigade_invites
  set status = 'declined', responded_at = now()
  where id = v_invite.id;

  return jsonb_build_object('ok', true);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.decline_offer(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_assignment record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select a.*, m.profile_id as member_profile_id
    into v_assignment
    from public.brigade_assignments a
    join public.brigade_members m on m.id = a.member_id
   where a.id = p_assignment_id;

  if v_assignment.id is null then raise exception 'Assignment not found'; end if;
  if v_assignment.member_profile_id <> v_caller then
    raise exception 'Forbidden';
  end if;
  if v_assignment.status not in ('offered', 'assigned') then
    raise exception 'Cannot decline %', v_assignment.status;
  end if;

  update public.brigade_assignments
     set status = 'declined', responded_at = now()
   where id = p_assignment_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.dispatch_fcm_on_new_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_function_url constant text :=
    'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/send-fcm';

  v_anon_key constant text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
begin
  perform net.http_post(
    url     := v_function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body    := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    coalesce(new.body, ''),
      'data',    jsonb_build_object(
        'type',       new.type,
        'related_id', coalesce(new.related_id, ''),
        'notif_id',   new.id::text
      )
    )
  );
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.expire_stale_offers(p_threshold_seconds integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  with updated as (
    update public.brigade_assignments
       set status = 'expired',
           responded_at = now()
     where status in ('offered', 'assigned')
       and assigned_by is null
       and assigned_at < now() - make_interval(secs => p_threshold_seconds)
     returning id
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.extract_profile_fields_from_auth(p_email text, p_meta jsonb, p_phone text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select jsonb_build_object(
    'name', coalesce(
      nullif(p_meta->>'full_name', ''),
      nullif(p_meta->>'name', ''),
      nullif(p_meta->>'display_name', ''),
      nullif(split_part(p_email, '@', 1), '')
    ),
    'email', coalesce(
      nullif(p_email, ''),
      nullif(p_meta->>'email', '')
    ),
    'phone_number', coalesce(
      nullif(p_phone, ''),
      nullif(p_meta->>'phone', ''),
      nullif(p_meta->>'phone_number', '')
    ),
    'avatar_url', coalesce(
      nullif(p_meta->>'avatar_url', ''),
      nullif(p_meta->>'picture', '')
    )
  );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.get_commission_rates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_object_agg(key, (value)::text::numeric)
    from public.platform_config
   where key in (
     'commission_on_accept',
     'commission_on_complete',
     'commission_on_withdrawal',
     'commission_on_bonus_convert',
     'bonus_on_complete',
     'min_withdrawal_amount'
   );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.get_user_opportunities(p_user_id uuid)
 RETURNS TABLE(id uuid, title text, date date, status text, budget numeric, created_at timestamp with time zone, offer_count bigint)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  select
    o.id,
    o.title,
    o.date,
    o.status,
    o.budget,
    o.created_at,
    count(of.id) as offer_count
  from
    opportunities o
    left join opportunities_offers of on o.id = of.opportunity_id
  where
    o.created_by = p_user_id
  group by
    o.id
  order by
    o.created_at desc;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.give_bonus_after_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Yalnız "completed" statusuna keçdikdə və əvvəllər bu olmayıbsa
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    -- Bonus 1 AZN və ya dinamik hesablanmış
    UPDATE profiles
    SET
      bonus_balance = bonus_balance + 1,
      total_bonus_earned = total_bonus_earned + 1
    WHERE id = NEW.provider_id;
  END IF;
  RETURN NEW;
END;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.give_bonus_after_offer_completion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Yalnız "completed" statusuna keçdikdə və əvvəllər bu olmayıbsa
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    -- Bonus miqdarı (məsələn 1 AZN sabit, ya da dinamik)
    UPDATE profiles
    SET
      bonus_balance = bonus_balance + 1,
      total_bonus_earned = total_bonus_earned + 1
    WHERE id = NEW.provider_id;
  END IF;
  RETURN NEW;
END;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_avatar text;
  v_role text;
  v_email text;
  v_phone text;
begin
  v_email := nullif(trim(coalesce(new.email, '')), '');
  v_phone := nullif(trim(coalesce(new.phone, '')), '');

  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'given_name', ''),
    -- email varsa @-dən əvvəlki hissə (UUID DEYİL)
    case when v_email is not null then split_part(v_email, '@', 1) end
  );

  v_avatar := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', '')
  );

  v_role := coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'customer');

  insert into public.profiles (id, role, name, email, phone_number, avatar_url, created_at)
  values (new.id, v_role, v_name, v_email, v_phone, v_avatar, now())
  on conflict (id) do update set
    name         = coalesce(nullif(public.profiles.name, ''),         excluded.name),
    email        = coalesce(nullif(public.profiles.email, ''),        excluded.email),
    phone_number = coalesce(nullif(public.profiles.phone_number, ''), excluded.phone_number),
    avatar_url   = coalesce(nullif(public.profiles.avatar_url, ''),   excluded.avatar_url);

  return new;
exception when others then
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.home_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'providers', (select count(*) from profiles where role = 'provider'),
    'services',  (select count(*) from services),
    'bookings',  (select count(*) from bookings),
    'top_providers', coalesce((
      select jsonb_agg(p) from (
        select pr.id, pr.name, pr.avatar_url, pr.rating, pr.is_verified,
               (select count(*) from provider_reviews rv where rv.provider_id = pr.id)::int as reviews_count
        from profiles pr
        where pr.role = 'provider'
        order by pr.rating desc nulls last
        limit 8
      ) p
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(c) from (
        select g.category, g.count,
               coalesce(sc.label_ru, t.ru) as label_ru,
               coalesce(sc.label_en, t.en) as label_en,
               coalesce(sc.label_zh, t.zh) as label_zh
        from (
          select trim(category) as category, count(*)::int as count
          from services
          where coalesce(trim(category), '') <> ''
          group by trim(category)
          order by count(*) desc
          limit 12
        ) g
        left join lateral (
          select label_ru, label_en, label_zh
          from service_categories
          where trim(label) = g.category
          limit 1
        ) sc on true
        left join service_text_translations t on t.az = g.category
      ) c
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(ct) from (
        select trim(split_part(location, ',', 1)) as city, count(*)::int as count
        from services
        where coalesce(trim(split_part(location, ',', 1)), '') <> ''
        group by trim(split_part(location, ',', 1))
        order by count(*) desc
        limit 10
      ) ct
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r) from (
        select id, title, category, location, created_at
        from services
        order by created_at desc
        limit 5
      ) r
    ), '[]'::jsonb)
  );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.increment_user_balance(user_id_param uuid, amount_param numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update profiles set balance = coalesce(balance, 1) + amount_param where id = user_id_param;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.is_admin_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select lower(role) in ('admin','master','superadmin')
       from public.profiles where id = auth.uid()),
    false
  );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.is_brigade_dispatcher(p_brigade_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.brigade_members
     where brigade_id = p_brigade_id
       and profile_id = p_user_id
       and is_active = true
       and role in ('owner', 'dispatcher')
  );
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.lock_offer_payment(p_offer_id uuid, p_amount numeric, p_payment_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_provider_id      uuid;
  v_commission_pct   numeric;
  v_commission_amt   numeric;
  v_provider_amount  numeric;
begin
  select provider_id into v_provider_id
    from public.opportunities_offers where id = p_offer_id;
  if v_provider_id is null then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  select (value)::text::numeric into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';

  v_commission_amt  := round(p_amount * coalesce(v_commission_pct,0) / 100, 2);
  v_provider_amount := p_amount - v_commission_amt;

  insert into public.provider_wallets (provider_id, locked_balance)
  values (v_provider_id, v_provider_amount)
  on conflict (provider_id) do update
    set locked_balance = public.provider_wallets.locked_balance + v_provider_amount,
        updated_at     = now();

  update public.opportunities_offers
     set status = 'accepted', paid_at = now()
   where id = p_offer_id;

  update public.opportunities_offers
     set status = 'rejected'
   where opportunity_id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   )
     and id <> p_offer_id
     and status = 'pending';

  update public.opportunities
     set status = 'active', accepted_offer_id = p_offer_id
   where id = (
     select opportunity_id from public.opportunities_offers where id = p_offer_id
   );

  insert into public.transactions
    (user_id, type, amount, description, related_id, payment_id)
  values
    (v_provider_id, 'escrow_lock', v_provider_amount,
     'Müştəri ödənişi escrow-a düşdü (qəbul komissiyası: ' || coalesce(v_commission_pct,0)
       || '%, ' || v_commission_amt || ' ₼; ödəniş #' || p_payment_id || ')',
     p_offer_id::text, null);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.log_opportunity_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_actor uuid := auth.uid();
  v_role  text;
begin
  if new.status is distinct from old.status then
    select coalesce(role, '') into v_role from public.profiles where id = v_actor;

    insert into public.opportunity_audit_log (
      opportunity_id, old_status, new_status,
      actor_id, actor_role, reason
    ) values (
      new.id, old.status, new.status,
      v_actor,
      case
        when v_actor is null then 'system'
        when v_actor = old.created_by then 'customer'
        when v_actor = old.provider_id then 'provider'
        else coalesce(v_role, 'unknown')
      end,
      new.cancellation_reason
    );
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.lookup_brigade_invite(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite record;
  v_brigade record;
begin
  select id, brigade_id, role, invited_email, invited_phone, expires_at, status
    into v_invite
    from public.brigade_invites
   where token = p_token;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_invite.status <> 'pending' then
    return jsonb_build_object('valid', false, 'reason', v_invite.status);
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  select id, name, slug into v_brigade
    from public.brigades
   where id = v_invite.brigade_id;

  -- PII məhdud — invitee email/phone qaytarmırıq (referrer leak-ı qarşısı alınır)
  return jsonb_build_object(
    'valid',         true,
    'brigade_id',    v_brigade.id,
    'brigade_name',  v_brigade.name,
    'brigade_slug',  v_brigade.slug,
    'role',          v_invite.role,
    'expires_at',    v_invite.expires_at
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.lookup_brigade_invite(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'token', i.token,
    'status', i.status,
    'intended_role', i.intended_role,
    'commission_pct', i.commission_pct,
    'expires_at', i.expires_at,
    'is_expired', i.expires_at <= now(),
    'invited_email', i.email,
    'invited_phone', i.phone,
    'brigade', jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'description', b.description,
      'logo_url', b.logo_url,
      'is_verified', b.is_verified
    )
  )
  from public.brigade_invites i
  join public.brigades b on b.id = i.brigade_id
  where i.token = p_token
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.notifications
  set is_read = true
  where user_id = auth.uid() and is_read = false;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.my_pending_brigade_invites()
 RETURNS TABLE(token uuid, intended_role text, brigade_id uuid, brigade_name text, brigade_logo text, invited_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select coalesce(p.email, au.email) as my_email,
           nullif(right(regexp_replace(coalesce(p.phone_number, au.phone, ''), '[^0-9]', '', 'g'), 9), '') as my_phone9
    from auth.users au
    left join public.profiles p on p.id = au.id
    where au.id = auth.uid()
  )
  select i.token, i.intended_role, b.id, b.name, b.logo_url, i.created_at, i.expires_at
  from public.brigade_invites i
  join public.brigades b on b.id = i.brigade_id
  cross join me
  where i.status = 'pending'
    and i.expires_at > now()
    and (
      (i.email is not null and me.my_email is not null and lower(i.email) = lower(me.my_email))
      or
      (i.phone is not null and me.my_phone9 is not null
        and right(regexp_replace(i.phone, '[^0-9]', '', 'g'), 9) = me.my_phone9)
    )
  order by i.created_at desc
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.normalize_profile_email()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.email is not null and trim(new.email) = '' then
    new.email := null;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notifications_unread_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(count(*)::integer, 0)
  from public.notifications
  where user_id = auth.uid() and is_read = false;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_customer_on_new_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer_id uuid;
  v_provider_name text;
  v_opp_title text;
begin
  -- Yalnız yeni pending offer üçün
  if new.status <> 'pending' then return new; end if;

  select op.created_by, op.title into v_customer_id, v_opp_title
    from public.opportunities op
   where op.id = new.opportunity_id;

  if v_customer_id is null then return new; end if;

  select coalesce(name, 'Provayder') into v_provider_name
    from public.profiles where id = new.provider_id;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    v_customer_id,
    'Yeni təklif: ' || coalesce(v_provider_name,'Provayder'),
    coalesce(v_opp_title,'Sifarişiniz') || ' — ' ||
      coalesce(new.offer_amount::text,'') || ' ₼',
    'new_offer',
    new.id::text,
    '/my-opportunities'
  );

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_member_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile_id   uuid;
  v_brigade_name text;
  v_opp_title    text;
  v_kind         text;
  v_title        text;
  v_body         text;
begin
  if new.status not in ('offered', 'assigned') then return new; end if;

  select profile_id into v_profile_id
    from public.brigade_members where id = new.member_id;
  if v_profile_id is null then return new; end if;

  select name into v_brigade_name from public.brigades where id = new.brigade_id;
  begin
    select op.title into v_opp_title
      from public.opportunities op
     where op.id::text = new.source_id;
  exception when others then v_opp_title := null;
  end;

  v_kind  := case when new.status = 'offered' then 'brigade_offer' else 'brigade_assignment' end;
  v_title := coalesce(v_brigade_name, 'Briqada') || ' — ' ||
             case when new.status = 'offered' then 'yeni sifariş' else 'yeni təyinat' end;
  v_body  := coalesce(v_opp_title, 'Sifariş') || ' — ' ||
             case when new.status = 'offered'
                  then 'ilk qəbul edən qazanır'
                  else 'sənə təyin edildi'
             end;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    v_profile_id, v_title, v_body, v_kind, new.id::text,
    '/account/master/incoming'
  );

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_on_booking_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
      v_title text;
      v_body  text;
    begin
      if new.status is distinct from old.status then
        case new.status
          when 'confirmed' then
            v_title := 'Sifariş qəbul edildi';
            v_body  := 'Provayder sifarişinizi qəbul etdi.';
          when 'completed' then
            v_title := 'Sifariş tamamlandı';
            v_body  := 'Sifariş uğurla tamamlandı — rəy bildirə bilərsiniz.';
          when 'cancelled' then
            v_title := 'Sifariş ləğv edildi';
            v_body  := 'Bu sifariş ləğv edildi.';
          else
            v_title := 'Sifariş statusu dəyişdi';
            v_body  := concat('Yeni status: ', new.status);
        end case;

        if new.customer_id is not null then
          insert into public.notifications (user_id, type, title, body, related_id)
          values (new.customer_id, concat('booking_', new.status), v_title, v_body, new.id::text);
        end if;
        if new.provider_id is not null and new.provider_id <> new.customer_id then
          insert into public.notifications (user_id, type, title, body, related_id)
          values (new.provider_id, concat('booking_', new.status), v_title, v_body, new.id::text);
        end if;
      end if;
      return new;
    end;
    $function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_on_dispute_opened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    new.against_user,
    'dispute_opened',
    'Sizin barənizdə şikayət açıldı',
    'Sifariş #' || substring(new.opportunity_id::text, 1, 8) || ' üçün şikayət baxılır.',
    new.opportunity_id::text
  );
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_on_dispute_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_title text;
  v_body  text;
begin
  if new.status is distinct from old.status
     and new.status in ('resolved_customer', 'resolved_provider') then

    if new.status = 'resolved_customer' then
      v_title := 'Şikayət müştərinin lehinə həll olundu';
      v_body  := 'Pul müştərinin balansına qaytarıldı.';
    else
      v_title := 'Şikayət provayderin lehinə həll olundu';
      v_body  := 'Pul provayderə ötürüldü.';
    end if;

    insert into public.notifications (user_id, type, title, body, related_id)
    values
      (new.raised_by, 'dispute_resolved', v_title, v_body, new.opportunity_id::text),
      (new.against_user, 'dispute_resolved', v_title, v_body, new.opportunity_id::text);
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_on_kyc_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_title text;
  v_body  text;
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected') then

    if new.status = 'approved' then
      v_title := 'KYC təsdiq olundu';
      v_body  := 'Artıq sifariş təkliflərinə cavab verə bilərsiniz.';
    else
      v_title := 'KYC rədd edildi';
      v_body  := coalesce(new.rejection_reason, 'Yenidən cəhd edə bilərsiniz.');
    end if;

    insert into public.notifications (user_id, type, title, body, related_id)
    values (new.provider_id, concat('kyc_', new.status), v_title, v_body, new.id::text);
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_on_opportunity_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_title text;
  v_body  text;
begin
  if new.status is distinct from old.status then
    case new.status
      when 'accepted' then
        v_title := 'Sifariş qəbul edildi';
        v_body  := 'Provayder sifarişinizi qəbul etdi.';
      when 'i-am-here' then
        v_title := 'Provayder ünvanda';
        v_body  := 'Provayder ünvana çatıb.';
      when 'ongoing' then
        v_title := 'İş başladı';
        v_body  := 'Sifariş üzərində iş başladı.';
      when 'completed' then
        v_title := 'İş tamamlandı';
        v_body  := 'Sifariş uğurla tamamlandı.';
      when 'cancelled' then
        v_title := 'Sifariş ləğv edildi';
        v_body  := 'Sifariş ləğv edildi.';
      else
        v_title := 'Sifariş statusu dəyişdi';
        v_body  := concat('Yeni status: ', new.status);
    end case;

    -- Müştəriyə
    if new.created_by is not null then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (new.created_by, concat('status_', new.status), v_title, v_body, new.id::text);
    end if;

    -- Provayderə (təyin olunubsa)
    if new.provider_id is not null and new.provider_id <> new.created_by then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (new.provider_id, concat('status_', new.status), v_title, v_body, new.id::text);
    end if;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_provider_on_new_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    begin
      if new.provider_id is not null and new.provider_id <> new.customer_id then
        insert into public.notifications (user_id, type, title, body, related_id)
        values (
          new.provider_id,
          'new_booking',
          'Yeni sifariş',
          'Sizə yeni sifariş gəldi.',
          new.id::text
        );
      end if;
      return new;
    end;
    $function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_provider_on_offer_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp_title text;
  v_title text;
  v_kind text;
begin
  -- Yalnız status faktiki dəyişəndə
  if new.status = old.status then return new; end if;
  if new.provider_id is null then return new; end if;

  select coalesce(title,'Sifariş') into v_opp_title
    from public.opportunities where id = new.opportunity_id;

  if new.status = 'accepted' then
    v_title := 'Təklifin qəbul edildi!';
    v_kind := 'offer_accepted';
  elsif new.status = 'rejected' then
    v_title := 'Təklifin rədd edildi';
    v_kind := 'offer_rejected';
  elsif new.status = 'completed' then
    v_title := 'İş tamamlandı və ödəniş açıldı';
    v_kind := 'offer_completed';
  else
    return new;
  end if;

  insert into public.notifications (user_id, title, body, kind, related_id, link)
  values (
    new.provider_id,
    v_title,
    v_opp_title || ' — ' || coalesce(new.offer_amount::text,'') || ' ₼',
    v_kind,
    new.id::text,
    '/account/services'
  );

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.notify_providers_on_new_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text := lower(coalesce(new.status,''));
  v_cat_id text := coalesce(new.category_id::text,'');
  v_subcat_id text := coalesce(new.subcategory_id::text,'');
  v_title text := coalesce(new.title, 'Yeni sifariş');
begin
  -- Yalnız "açıq" status olduqda bildiriş göndər
  if v_status not in ('pending','open','new','') then
    return new;
  end if;

  -- Uyğun provayderlərə (specialty / category match) notification insert
  insert into public.notifications (user_id, title, body, kind, related_id, link)
  select
    p.id,
    'Yeni sifariş: ' || v_title,
    coalesce(new.description, new.location, 'Detallara baxın'),
    'new_opportunity',
    new.id::text,
    '/account/services'  -- web link; mobil app öz routing-ini bilir
  from public.profiles p
  where lower(coalesce(p.role,'')) in ('provider','pro','seller')
    and p.id <> new.created_by
    and (
      -- specialties UUID kimi saxlanır (yeni axın)
      (p.specialties is not null and (
        v_cat_id <> '' and p.specialties @> array[v_cat_id]
        or
        v_subcat_id <> '' and p.specialties @> array[v_subcat_id]
      ))
      -- Heç bir filter yoxsa, hər kəsə xəbər ver
      or coalesce(array_length(p.specialties, 1), 0) = 0
    );

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.open_conversation(p_opportunity_id uuid, p_peer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller   uuid := auth.uid();
  v_customer uuid;
  v_provider uuid;
  v_id       uuid;
  v_opp_creator uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select created_by into v_opp_creator
    from public.opportunities where id = p_opportunity_id;
  if v_opp_creator is null then raise exception 'Opportunity not found'; end if;

  if v_caller = v_opp_creator then
    v_customer := v_caller;
    v_provider := p_peer_id;
  else
    v_customer := v_opp_creator;
    v_provider := v_caller;
  end if;

  if v_caller <> v_customer and v_caller <> v_provider then
    raise exception 'Forbidden';
  end if;

  insert into public.conversations (opportunity_id, customer_id, provider_id)
  values (p_opportunity_id, v_customer, v_provider)
  on conflict (
    coalesce(opportunity_id::text, 'support_' || coalesce(category, 'general')),
    customer_id,
    provider_id
  )
  do update set last_message_at = public.conversations.last_message_at
  returning id into v_id;

  return v_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.open_dispute(p_opportunity_id uuid, p_reason text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller        uuid := auth.uid();
  v_opp           record;
  v_offer         record;
  v_against       uuid;
  v_dispute_id    uuid;
  v_hours_passed  numeric;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  -- Opportunity yüklə
  select * into v_opp from public.opportunities
    where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OPPORTUNITY_NOT_FOUND');
  end if;

  -- Yalnız completed-də şikayət olur
  if v_opp.status <> 'completed' then
    return jsonb_build_object(
      'ok', false,
      'error', 'OPPORTUNITY_NOT_COMPLETED',
      'current_status', v_opp.status
    );
  end if;

  -- 24 saat window
  v_hours_passed := extract(epoch from (now() - coalesce(v_opp.completed_at, v_opp.updated_at))) / 3600.0;
  if v_hours_passed > 24 then
    return jsonb_build_object(
      'ok', false,
      'error', 'DISPUTE_WINDOW_EXPIRED',
      'hours_passed', round(v_hours_passed, 1)
    );
  end if;

  -- Çağıran ya müştəri, ya provider olmalıdır
  if v_caller <> v_opp.created_by and v_caller <> v_opp.provider_id then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  -- Qarşı tərəfi təyin et
  v_against := case
    when v_caller = v_opp.created_by then v_opp.provider_id
    else v_opp.created_by
  end;

  if v_against is null then
    return jsonb_build_object('ok', false, 'error', 'NO_COUNTERPARTY');
  end if;

  -- Accepted offer
  select * into v_offer from public.opportunities_offers
    where opportunity_id = p_opportunity_id
      and status in ('accepted', 'refunded')
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_ACCEPTED_OFFER');
  end if;

  -- Mövcud aktiv dispute?
  if exists (
    select 1 from public.disputes
    where opportunity_id = p_opportunity_id
      and status in ('open', 'under_review')
  ) then
    return jsonb_build_object('ok', false, 'error', 'DISPUTE_ALREADY_OPEN');
  end if;

  -- Insert dispute (RLS bypass: security definer)
  insert into public.disputes (
    opportunity_id, offer_id, raised_by, against_user,
    reason, description, status
  ) values (
    p_opportunity_id, v_offer.id, v_caller, v_against,
    p_reason, p_description, 'open'
  )
  returning id into v_dispute_id;

  -- Opportunity status → disputed
  update public.opportunities
     set status = 'disputed'
   where id = p_opportunity_id;

  return jsonb_build_object(
    'ok', true,
    'dispute_id', v_dispute_id,
    'opportunity_id', p_opportunity_id
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.open_support_conversation(p_category text DEFAULT 'general'::text, p_user_role text DEFAULT 'customer'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_support uuid;
  v_id      uuid;
  v_raw     text;
  v_cat     text := coalesce(nullif(trim(p_category),  ''), 'general');
  v_role    text := coalesce(nullif(trim(p_user_role), ''), 'customer');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_role not in ('customer','provider') then
    raise exception 'Invalid user_role: %', v_role;
  end if;
  if v_cat not in ('general','order','payment','kyc','complaint','provider') then
    raise exception 'Invalid category: %', v_cat;
  end if;

  select value::text into v_raw
    from public.platform_config where key = 'support_user_id';
  if v_raw is null then
    raise exception 'Support agent not configured';
  end if;
  v_support := trim(both '"' from v_raw)::uuid;

  if v_caller = v_support then
    raise exception 'Cannot open support chat with yourself';
  end if;

  insert into public.conversations (opportunity_id, customer_id, provider_id, category, user_role)
  values (null, v_caller, v_support, v_cat, v_role)
  on conflict (coalesce(opportunity_id::text, 'support_' || coalesce(category, 'general')), customer_id, provider_id)
  do update set
    last_message_at = public.conversations.last_message_at,
    user_role       = excluded.user_role
  returning id into v_id;

  return v_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.place_bid(p_opportunity_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller         uuid := auth.uid();
  v_balance        numeric;
  v_role           text;
  v_verified       boolean;
  v_kyc_at         timestamptz;
  v_bid_id         uuid;
  v_opp            record;
  v_commission_pct numeric;
  v_commission_amt numeric;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid məbləği müsbət olmalıdır';
  end if;

  select lower(coalesce(role,'')), coalesce(balance, 0),
         coalesce(is_verified, false), last_kyc_approved_at
    into v_role, v_balance, v_verified, v_kyc_at
    from public.profiles where id = v_caller;

  if v_role not in ('provider','admin','master','superadmin') then
    raise exception 'Yalnız provayder təklif verə bilər';
  end if;

  -- KYC şərti (yalnız provayderlər üçün; adminlər test məqsədli azaddır)
  if v_role = 'provider' then
    if not v_verified
       or v_kyc_at is null
       or v_kyc_at <= now() - interval '14 days' then
      raise exception 'KYC_REQUIRED: Şəxsiyyət təsdiqiniz yoxdur və ya vaxtı bitib';
    end if;
  end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_accept';
  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);

  if v_balance < v_commission_amt then
    raise exception 'NO_BALANCE: balansda minimum % AZN olmalıdır (komissiya faizi: %), cari: % AZN',
      v_commission_amt, v_commission_pct, v_balance;
  end if;

  select id, status, created_by into v_opp
    from public.opportunities where id = p_opportunity_id;
  if v_opp.id is null then raise exception 'Sifariş tapılmadı'; end if;
  if v_opp.created_by = v_caller then
    raise exception 'Öz sifarişinizə təklif verə bilməzsiniz';
  end if;
  if v_opp.status not in ('open', 'pending', 'new', 'active') then
    raise exception 'Sifariş artıq aktiv deyil (status: %)', v_opp.status;
  end if;

  if exists (
    select 1 from public.opportunities_offers
     where opportunity_id = p_opportunity_id
       and provider_id    = v_caller
       and status         = 'pending'
  ) then
    raise exception 'Bu sifarişə artıq aktiv təklifiniz var';
  end if;

  insert into public.opportunities_offers
    (opportunity_id, provider_id, offer_amount, status)
  values
    (p_opportunity_id, v_caller, p_amount, 'pending')
  returning id into v_bid_id;

  return jsonb_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'amount', p_amount,
    'required_balance', v_commission_amt
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.refresh_bot_locations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Abşeron yarımadası quru sahələr (dəniz/göl deyil, faktiki yaşayış yerləri)
  v_coords constant numeric[][] := array[
    -- Bakı şəhər
    array[40.4082, 49.8531],  -- Bakı mərkəz (Fəvvarələr meydanı)
    array[40.3953, 49.8127],  -- Yasamal
    array[40.3805, 49.8590],  -- Səbail (28 May)
    array[40.4514, 49.8014],  -- Binəqədi
    array[40.4127, 49.8636],  -- Nərimanov
    array[40.4015, 49.9095],  -- Nizami
    array[40.4577, 49.9617],  -- Sabunçu
    array[40.4093, 49.9742],  -- Suraxanı
    array[40.3892, 49.9531],  -- Xətai
    array[40.4262, 49.8918],  -- Nəsimi (Akademiya)
    -- Abşeron qəsəbələri
    array[40.5215, 49.9890],  -- Maştağa
    array[40.5078, 50.0913],  -- Buzovna
    array[40.4861, 50.1480],  -- Mərdəkan
    array[40.5410, 50.1467],  -- Şüvəlan
    array[40.5630, 50.0260],  -- Bilgəh
    array[40.5810, 49.9020],  -- Pirşağa
    array[40.4520, 49.9650],  -- Nardaran
    array[40.4350, 49.9450],  -- Bakıxanov
    -- Cənub və qərb
    array[40.5896, 49.6685],  -- Sumqayıt
    array[40.3927, 49.7530],  -- Lökbatan
    array[40.3650, 49.6300],  -- Qaradağ (Sahil)
    array[40.4950, 49.7240]   -- Mehdiabad
  ];
  v_bot record;
  v_idx int;
  v_lat numeric;
  v_lng numeric;
  v_count int := 0;
begin
  for v_bot in
    select id from public.profiles
     where email like 'bot_provider_%@ellit.bot'
  loop
    -- Random base koordinat
    v_idx := 1 + floor(random() * array_length(v_coords, 1))::int;
    -- Random kiçik offset (±0.004 ≈ 400m), şəhər daxili
    v_lat := v_coords[v_idx][1] + (random() - 0.5) * 0.008;
    v_lng := v_coords[v_idx][2] + (random() - 0.5) * 0.008;

    update public.profiles set
      latitude = v_lat,
      longitude = v_lng,
      is_online = true,
      last_seen_at = now()
    where id = v_bot.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.refund_no_show_providers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := 0;
  v_offer record;
  v_res   jsonb;
begin
  -- 30 dəqiqə əvvəl accepted, hələ i-am-here olmayan
  for v_offer in
    select o.id as offer_id, o.opportunity_id, o.updated_at, opp.status as opp_status
    from public.opportunities_offers o
    join public.opportunities opp on opp.id = o.opportunity_id
    where o.status = 'accepted'
      and opp.status = 'accepted'                            -- hələ ünvana çatmayıb
      and o.updated_at < (now() - interval '30 minutes')
    for update of o skip locked
  loop
    v_res := public.refund_offer_payment(
      v_offer.offer_id,
      'AUTO_REFUND_PROVIDER_NO_SHOW'
    );
    if (v_res->>'ok')::boolean then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.refund_offer_payment(p_offer_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer       record;
  v_opp         record;
  v_customer    uuid;
  v_amount      numeric;
  v_payment_id  text;
  v_caller      uuid := auth.uid();
  v_caller_role text;
begin
  -- 1. Caller authorization
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select coalesce(role, '') into v_caller_role
  from public.profiles where id = v_caller;

  -- 2. Offer-i çıxar
  select * into v_offer
  from public.opportunities_offers
  where id = p_offer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_FOUND');
  end if;

  if v_offer.status not in ('accepted') then
    return jsonb_build_object(
      'ok', false,
      'error', 'OFFER_NOT_REFUNDABLE',
      'current_status', v_offer.status
    );
  end if;

  -- 3. Opportunity-ni çıxar
  select * into v_opp
  from public.opportunities
  where id = v_offer.opportunity_id
  for update;

  v_customer := v_opp.created_by;
  v_amount   := v_offer.offer_amount;

  -- 4. Authorization: yalnız müştəri, admin və ya provider özü refund tələb edə bilir
  if v_caller <> v_customer
     and v_caller <> v_offer.provider_id
     and lower(coalesce(v_caller_role, '')) not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  -- 5. Idempotency: bu offer üçün artıq refund varsa təkrarlama
  if exists (
    select 1 from public.transactions
    where type = 'refund'
      and payment_id = concat('refund:', p_offer_id::text)
  ) then
    return jsonb_build_object('ok', true, 'already_refunded', true);
  end if;

  -- 6. Pul hərəkəti — atomik
  begin
    -- locked_balance-dan çıx (müştəri)
    update public.profiles
       set locked_balance = greatest(coalesce(locked_balance, 0) - v_amount, 0)
     where id = v_customer;

    -- balance-a əlavə et (müştəri)
    update public.profiles
       set balance = coalesce(balance, 0) + v_amount
     where id = v_customer;

    -- Transaction log
    insert into public.transactions (user_id, type, amount, balance_after, payment_id, created_at)
    select v_customer,
           'refund',
           v_amount,
           p.balance,
           concat('refund:', p_offer_id::text),
           now()
    from public.profiles p where p.id = v_customer;

    -- Offer və opportunity statusu
    update public.opportunities_offers
       set status = 'refunded'
     where id = p_offer_id;

    -- Status trigger validation üçün — service_role bypass aktivdir
    update public.opportunities
       set status = 'refunded',
           cancellation_reason = coalesce(p_reason, 'Refund issued')
     where id = v_opp.id;

  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'refunded_amount', v_amount,
    'customer_id', v_customer,
    'opportunity_id', v_opp.id
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.reject_kyc(p_verification_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_ver    record;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select coalesce(role, '') into v_role from public.profiles where id = v_caller;
  if lower(v_role) not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY');
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;

  select * into v_ver from public.provider_verifications
    where id = p_verification_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_NOT_FOUND');
  end if;

  if v_ver.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'NOT_PENDING');
  end if;

  update public.provider_verifications
     set status = 'rejected',
         rejection_reason = p_reason,
         reviewed_by = v_caller,
         reviewed_at = now()
   where id = p_verification_id;

  update public.profiles
     set is_verified = false,
         verification_status = 'rejected'
   where id = v_ver.provider_id;

  return jsonb_build_object('ok', true, 'provider_id', v_ver.provider_id);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.release_offer_to_provider(p_offer_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller         uuid := auth.uid();
  v_provider_id    uuid;
  v_opp_id         uuid;
  v_method         text;
  v_offer_amount   numeric;
  v_offer_status   text;
  v_locked_amt     numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_release_amt    numeric;
  v_bonus_pct      numeric;
  v_bonus_amt      numeric;
  v_bonus_base     numeric;
  v_opp_status     text;
  v_is_admin       boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  -- KİLİD: eyni təklifə paralel iki release cəhdi növbəyə düşür;
  -- birincisi bitəndə ikincisi 'completed' görüb dayanır → ikiqat ödəniş yoxdur
  select oo.provider_id, op.id, oo.payment_method, oo.offer_amount, oo.status, op.status
    into v_provider_id, v_opp_id, v_method, v_offer_amount, v_offer_status, v_opp_status
    from public.opportunities_offers oo
    join public.opportunities op on op.id = oo.opportunity_id
   where oo.id = p_offer_id
   for update of oo;

  if v_provider_id is null then raise exception 'Offer not found'; end if;
  if v_offer_status = 'completed' then
    raise exception 'ALREADY_RELEASED: bu təklif artıq tamamlanıb';
  end if;

  select coalesce((value)::text::numeric, 0) into v_bonus_pct
    from public.platform_config where key = 'bonus_on_complete';

  v_is_admin := exists (select 1 from public.profiles
                         where id = v_caller and role in ('admin','master','superadmin'));

  if v_opp_status = 'pending_review' then
    if not v_is_admin then
      raise exception 'Only admin can approve pending_review jobs';
    end if;
  else
    if not exists (select 1 from public.opportunities where id = v_opp_id and created_by = v_caller) then
      raise exception 'Only customer can complete the offer';
    end if;
  end if;

  if v_method = 'cash' or v_method is null then
    update public.opportunities_offers
       set status = 'completed',
           payout_status = case when v_opp_status = 'pending_review' then 'paid' else payout_status end,
           admin_approved_at = case when v_is_admin then now() else admin_approved_at end,
           admin_approved_by = case when v_is_admin then v_caller else admin_approved_by end
     where id = p_offer_id;
    update public.opportunities
       set status = 'completed', completed_at = now() where id = v_opp_id;

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'admin_adjust', 0, 0,
       'Nağd sifariş tamamlandı, offer ' || left(p_offer_id::text, 8),
       p_offer_id::text, v_caller);

    v_bonus_base := v_offer_amount;
    v_bonus_amt  := round(v_bonus_base * v_bonus_pct / 100, 2);
    if v_bonus_amt > 0 then
      insert into public.provider_wallets (provider_id, bonus_balance)
      values (v_provider_id, v_bonus_amt)
      on conflict (provider_id) do update
        set bonus_balance = public.provider_wallets.bonus_balance + v_bonus_amt,
            updated_at    = now();

      insert into public.transactions
        (user_id, type, amount, balance_after, description, related_id, created_by)
      values
        (v_provider_id, 'bonus_earn', v_bonus_amt, 0,
         'Tamamlama bonusu (nağd, ' || v_bonus_pct || '%)',
         p_offer_id::text, v_caller);

      begin
        insert into public.provider_bonus_logs
          (provider_id, amount, type, source, reason)
        values
          (v_provider_id, v_bonus_amt, 'completion', 'cash_order',
           'Tamamlama bonusu (' || v_bonus_pct || '%)');
      exception when others then null;
      end;
    end if;

    return 0;
  end if;

  select amount into v_locked_amt
    from public.transactions
   where related_id = p_offer_id::text and type = 'escrow_lock'
   order by created_at desc limit 1;

  if v_locked_amt is null then raise exception 'No escrow found'; end if;

  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_complete';

  v_commission_amt := round(v_locked_amt * v_commission_pct / 100, 2);
  v_release_amt    := v_locked_amt - v_commission_amt;

  update public.provider_wallets
     set locked_balance = locked_balance - v_locked_amt,
         total_earned   = coalesce(total_earned, 0) + v_release_amt,
         updated_at     = now()
   where provider_id = v_provider_id;

  update public.profiles
     set balance = coalesce(balance, 0) + v_release_amt
   where id = v_provider_id;

  update public.opportunities_offers
     set status = 'completed', escrow_released_at = now(),
         payout_status = case when v_opp_status = 'pending_review' then 'paid' else payout_status end,
         admin_approved_at = case when v_is_admin then now() else admin_approved_at end,
         admin_approved_by = case when v_is_admin then v_caller else admin_approved_by end
   where id = p_offer_id;
  update public.opportunities
     set status = 'completed', completed_at = now() where id = v_opp_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_provider_id, 'escrow_release', v_release_amt, 0,
     'İş tamamlandı (tamamlama komissiyası: '
       || v_commission_pct || '%, ' || v_commission_amt || ' ₼)',
     p_offer_id::text, v_caller);

  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'platform_revenue', v_commission_amt, 0,
       'Tamamlama komissiyası (' || v_commission_pct || '%)',
       p_offer_id::text, v_caller);
  end if;

  v_bonus_amt := round(v_release_amt * v_bonus_pct / 100, 2);
  if v_bonus_amt > 0 then
    insert into public.provider_wallets (provider_id, bonus_balance)
    values (v_provider_id, v_bonus_amt)
    on conflict (provider_id) do update
      set bonus_balance = public.provider_wallets.bonus_balance + v_bonus_amt,
          updated_at    = now();

    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_provider_id, 'bonus_earn', v_bonus_amt, 0,
       'Tamamlama bonusu (kart, ' || v_bonus_pct || '%)',
       p_offer_id::text, v_caller);

    begin
      insert into public.provider_bonus_logs
        (provider_id, amount, type, source, reason)
      values
        (v_provider_id, v_bonus_amt, 'completion', 'card_order',
         'Tamamlama bonusu (' || v_bonus_pct || '%)');
    exception when others then null;
    end;
  end if;

  return v_release_amt;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.request_password_change_otp()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recent int;
  v_otp text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select count(*) into v_recent
    from password_otps
   where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  update password_otps set used = true
   where user_id = v_uid and not used;

  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into password_otps (user_id, phone, otp, expires_at)
  values (v_uid, '', v_otp, now() + interval '5 minutes');

  insert into notifications (user_id, type, title, body, related_id)
  values (
    v_uid,
    'password_otp',
    'Parol yeniləmə kodu',
    'Təsdiq kodunuz: ' || v_otp || ' (5 dəqiqə etibarlıdır)',
    'password_otp'
  );

  return jsonb_build_object('ok', true);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.request_password_reset_email(p_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_email text;
  v_recent int;
  v_local text;
  v_domain text;
  v_hint text;
  v_anon_key constant text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2dnh0bmpmanRxcmhwZWNzdnBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTA2NTgsImV4cCI6MjA2MDkyNjY1OH0.RXjZWgQnS8nNEaFYzkjk-GlzS_Im2UiQzZgVW6nzCYk';
begin
  v_uid := public._find_user_by_identifier(p_identifier);

  -- Sadalama qorunması: tapılmasa da eyni cavab
  if v_uid is null then
    return jsonb_build_object('ok', true);
  end if;

  -- Saatda 3 email limiti (marker sətirlər phone='email_fallback')
  select count(*) into v_recent from password_otps
   where user_id = v_uid and phone = 'email_fallback'
     and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then
    return jsonb_build_object('ok', true);
  end if;

  -- Supabase Auth-un standart bərpa emaili (serverdən, email sızdırılmadan)
  perform net.http_post(
    url := 'https://fvvxtnjfjtqrhpecsvpd.supabase.co/auth/v1/recover?redirect_to=' ||
           'https%3A%2F%2Fellit.az%2Freset-password',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key
    ),
    body := jsonb_build_object('email', v_email, 'gotrue_meta_security', jsonb_build_object())
  );

  insert into password_otps (user_id, phone, otp, expires_at, used)
  values (v_uid, 'email_fallback', '000000', now(), true);

  -- Maskalanmış görüntü: a•••@g•••.com
  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_hint := left(v_local, 1) || '•••@' || left(v_domain, 1) || '•••' ||
            case when position('.' in v_domain) > 0
                 then substring(v_domain from '\.[^.]+$') else '' end;

  return jsonb_build_object('ok', true, 'email_hint', v_hint);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.request_password_reset_otp(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_recent int;
  v_otp text;
begin
  v_uid := public._find_user_by_identifier(p_email);

  -- Tapılmasa da eyni cavab — veb yenə formaya keçir (sadalama qorunması)
  if v_uid is null then
    return jsonb_build_object('ok', true, 'channel', 'push');
  end if;

  select count(*) into v_recent from password_otps
   where user_id = v_uid and coalesce(phone,'') <> 'email_fallback'
     and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  update password_otps set used = true
   where user_id = v_uid and not used and coalesce(phone,'') <> 'email_fallback';

  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');
  insert into password_otps (user_id, phone, otp, expires_at)
  values (v_uid, '', v_otp, now() + interval '5 minutes');

  insert into notifications (user_id, type, title, body, related_id)
  values (v_uid, 'password_otp', 'Parol yeniləmə kodu',
          'Təsdiq kodunuz: ' || v_otp || ' (5 dəqiqə etibarlıdır)',
          'password_otp');

  return jsonb_build_object('ok', true, 'channel', 'push');
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.request_provider_role(p_message text DEFAULT NULL::text, p_company_name text DEFAULT NULL::text, p_experience_years integer DEFAULT NULL::integer, p_specialties text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_req_id uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select lower(coalesce(role,'')) into v_role from public.profiles where id = v_caller;
  if v_role in ('provider','admin','master','superadmin') then
    raise exception 'Siz artıq provayder/admin statusundasınız';
  end if;

  if exists (
    select 1 from public.provider_requests
     where user_id = v_caller and status = 'pending'
  ) then
    raise exception 'Sizin artıq aktiv müraciətiniz var';
  end if;

  insert into public.provider_requests
    (user_id, message, company_name, experience_years, specialties)
  values
    (v_caller, p_message, p_company_name, p_experience_years, coalesce(p_specialties, '{}'))
  returning id into v_req_id;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, 'provider_request', 'provider_request', v_req_id::text,
            jsonb_build_object('message', p_message));
  exception when others then null;
  end;

  return v_req_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_bank_card text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id        uuid := auth.uid();
  v_min            numeric;
  v_commission_pct numeric;
  v_commission_amt numeric;
  v_net_amt        numeric;
  v_balance_after  numeric;
  v_id             uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_bank_card is null or length(trim(p_bank_card)) < 8 then
    raise exception 'Bank card / IBAN required';
  end if;

  select coalesce((value)::text::numeric, 0) into v_min
    from public.platform_config where key = 'min_withdrawal_amount';
  select coalesce((value)::text::numeric, 0) into v_commission_pct
    from public.platform_config where key = 'commission_on_withdrawal';

  if v_min > 0 and p_amount < v_min then
    raise exception 'Minimum withdrawal amount: % ₼', v_min;
  end if;

  -- Tək mənbə: profiles.balance
  update public.profiles
     set balance = balance - p_amount
   where id = v_user_id
     and coalesce(balance, 0) >= p_amount
   returning balance into v_balance_after;

  if v_balance_after is null then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  v_commission_amt := round(p_amount * v_commission_pct / 100, 2);
  v_net_amt        := p_amount - v_commission_amt;

  insert into public.withdrawals
    (provider_id, amount_requested, commission_percent, commission_amount,
     net_amount, bank_card)
  values
    (v_user_id, p_amount, v_commission_pct, v_commission_amt, v_net_amt,
     p_bank_card)
  returning id into v_id;

  insert into public.transactions
    (user_id, type, amount, balance_after, description, related_id, created_by)
  values
    (v_user_id, 'withdrawal', -p_amount, v_balance_after,
     'Nağdlaşdırma sorğusu (komissiya: ' || v_commission_pct
       || '%, ' || v_commission_amt || ' ₼ → net: ' || v_net_amt || ' ₼)',
     v_id::text, v_user_id);

  -- Komissiya platform_revenue
  if v_commission_amt > 0 then
    insert into public.transactions
      (user_id, type, amount, balance_after, description, related_id, created_by)
    values
      (v_user_id, 'platform_revenue', v_commission_amt, 0,
       'Nağdlaşdırma komissiyası (' || v_commission_pct || '%)',
       v_id::text, v_user_id);
  end if;

  return v_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.require_cancellation_reason()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'cancelled'
     and (new.cancellation_reason is null or btrim(new.cancellation_reason) = '') then
    raise exception 'CANCELLATION_REASON_REQUIRED'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.reset_password_with_otp(p_email text, p_otp text, p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_row record;
begin
  if length(coalesce(p_new_password,'')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'PASSWORD_TOO_SHORT');
  end if;

  v_uid := public._find_user_by_identifier(p_email);
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'WRONG_CODE');
  end if;

  select * into v_row from password_otps
   where user_id = v_uid and not used
   order by created_at desc limit 1;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'NO_OTP');
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  if v_row.attempts >= 5 then
    update password_otps set used = true where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;
  if v_row.otp <> regexp_replace(coalesce(p_otp,''), '\D', '', 'g') then
    update password_otps set attempts = attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'WRONG_CODE',
                              'attempts_left', 5 - v_row.attempts - 1);
  end if;

  update password_otps set used = true where id = v_row.id;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;
  delete from auth.sessions where user_id = v_uid;

  insert into notifications (user_id, type, title, body, related_id)
  values (v_uid, 'security', 'Parolunuz yeniləndi 🔐',
          'Hesabınızın parolu indicə dəyişdirildi. Siz deyilsinizsə dərhal dəstəyə yazın.',
          'password_reset');

  return jsonb_build_object('ok', true);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.resolve_dispute(p_dispute_id uuid, p_resolution text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_dispute record;
  v_res    jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  -- Admin yoxlaması
  select coalesce(role, '') into v_role from public.profiles where id = v_caller;
  if lower(v_role) not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY');
  end if;

  if p_resolution not in ('customer', 'provider') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RESOLUTION');
  end if;

  select * into v_dispute from public.disputes
    where id = p_dispute_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DISPUTE_NOT_FOUND');
  end if;

  if v_dispute.status not in ('open', 'under_review') then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RESOLVED');
  end if;

  -- Pul hərəkəti
  if p_resolution = 'customer' then
    -- Refund (Faza 1 RPC-si)
    v_res := public.refund_offer_payment(v_dispute.offer_id, concat('DISPUTE_RESOLVED_CUSTOMER: ', coalesce(p_notes, '')));
  else
    -- Release (mövcud RPC)
    perform public.release_offer_to_provider(v_dispute.offer_id);

    -- Mark released
    update public.opportunities_offers
       set escrow_released_at = now()
     where id = v_dispute.offer_id;

    -- Opportunity statusu → completed
    update public.opportunities
       set status = 'completed'
     where id = v_dispute.opportunity_id;

    v_res := jsonb_build_object('ok', true, 'released', true);
  end if;

  -- Dispute status
  update public.disputes
     set status = case when p_resolution = 'customer'
                       then 'resolved_customer'
                       else 'resolved_provider' end,
         resolution_notes = p_notes,
         resolved_by      = v_caller,
         resolved_at      = now()
   where id = p_dispute_id;

  return jsonb_build_object(
    'ok', true,
    'resolution', p_resolution,
    'payment_result', v_res
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.revoke_kyc(p_provider_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_was_verified boolean;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select coalesce(role, '') into v_role from public.profiles where id = v_caller;
  if lower(v_role) not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_ONLY');
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;

  -- Provider-i yoxla
  select is_verified into v_was_verified
  from public.profiles where id = p_provider_id;

  if v_was_verified is null then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_NOT_FOUND');
  end if;

  if v_was_verified = false then
    return jsonb_build_object('ok', false, 'error', 'NOT_VERIFIED');
  end if;

  -- Profile flag-larını yenilə
  update public.profiles
     set is_verified = false,
         verification_status = 'resubmit_required'
   where id = p_provider_id;

  -- Son approved verification-ı 'cancelled' et ki sonuncu rejection_reason
  -- görünsün (yenidən submit lazımdır)
  update public.provider_verifications
     set status = 'cancelled',
         rejection_reason = p_reason,
         reviewed_by = v_caller,
         reviewed_at = now()
   where id = (
     select id from public.provider_verifications
     where provider_id = p_provider_id and status = 'approved'
     order by reviewed_at desc nulls last, created_at desc
     limit 1
   );

  -- Notification (revoke bildiriş)
  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    p_provider_id,
    'kyc_revoked',
    'KYC təsdiqi ləğv edildi',
    'Səbəb: ' || p_reason || '. Yenidən sənəd yükləyin.',
    p_provider_id::text
  );

  return jsonb_build_object('ok', true, 'provider_id', p_provider_id);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.set_member_online(p_is_online boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  update public.brigade_members
     set is_online = p_is_online,
         last_heartbeat = now()
   where profile_id = v_caller and is_active = true;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.set_opportunity_completed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.set_self_role(p_new_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_current text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_role not in ('customer', 'provider') then
    raise exception 'Invalid role: % (only customer/provider allowed via self-service)', p_new_role;
  end if;

  select role into v_current from public.profiles where id = v_uid;

  -- Admin/master öz rolunu downgrade edə bilməz — qaqalmayan superadmin riski
  if lower(coalesce(v_current,'')) in ('admin','master','superadmin') then
    raise exception 'Forbidden: admin role cannot be changed via self-service';
  end if;

  update public.profiles
     set role = p_new_role,
         updated_at = now()
   where id = v_uid;

  -- Audit
  insert into public.audit_log (actor, action, target_type, target_id, payload)
  values (
    v_uid, 'self_role_change', 'profile', v_uid,
    jsonb_build_object('from', v_current, 'to', p_new_role)
  );

  return p_new_role;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.submit_kyc(p_id_front_path text, p_id_back_path text, p_selfie_path text, p_full_name text DEFAULT NULL::text, p_id_number text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_id     uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  -- KYC göndərmə hamı üçün açıqdır. Lakin RLS gating yalnız verified
  -- provider-in təklif verə bilməsini təmin edir. Sənədlər təsdiqləndikdən
  -- sonra istifadəçi role-unu provider-ə dəyişdirə bilər.

  -- Path validation — sahibi öz user_id ilə başlamalıdır
  if not (
    p_id_front_path like (v_caller::text || '/%') and
    p_id_back_path  like (v_caller::text || '/%') and
    p_selfie_path   like (v_caller::text || '/%')
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PATH');
  end if;

  -- Mövcud pending varsa, onu cancel et
  update public.provider_verifications
     set status = 'cancelled', updated_at = now()
   where provider_id = v_caller and status = 'pending';

  -- Yeni cəhd
  insert into public.provider_verifications (
    provider_id, id_front_path, id_back_path, selfie_path,
    full_name_on_id, id_number, birth_date, status
  ) values (
    v_caller, p_id_front_path, p_id_back_path, p_selfie_path,
    p_full_name, p_id_number, p_birth_date, 'pending'
  )
  returning id into v_id;

  -- Profile status
  update public.profiles
     set verification_status = 'pending'
   where id = v_caller;

  return jsonb_build_object(
    'ok', true,
    'verification_id', v_id,
    'status', 'pending'
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.submit_kyc_renewal(p_selfie_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller     uuid := auth.uid();
  v_role       text;
  v_last       record;
  v_new_id     uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  -- Provider role yoxla
  select coalesce(role, '') into v_role from public.profiles where id = v_caller;
  if lower(v_role) not in ('provider', 'pro', 'seller') then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_PROVIDER');
  end if;

  -- Path validation — öz user_id-ı ilə başlamalı
  if not (p_selfie_path like (v_caller::text || '/%')) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PATH');
  end if;

  -- Sonuncu approved verification-ı tap (sənəd path-larını reuse üçün)
  select * into v_last
  from public.provider_verifications
  where provider_id = v_caller and status = 'approved'
  order by reviewed_at desc nulls last, created_at desc
  limit 1;

  if not found then
    -- İlk dəfə KYC göndərməyibsə, renewal işləməz — full KYC göndərsin
    return jsonb_build_object('ok', false, 'error', 'NO_PRIOR_APPROVED_KYC');
  end if;

  -- Mövcud pending varsa, onu cancel et
  update public.provider_verifications
     set status = 'cancelled', updated_at = now()
   where provider_id = v_caller and status = 'pending';

  -- Yeni renewal cəhdi (sənəd path-ları reuse, selfie yeni)
  insert into public.provider_verifications (
    provider_id, id_front_path, id_back_path, selfie_path,
    full_name_on_id, id_number, birth_date,
    status, is_renewal
  ) values (
    v_caller,
    v_last.id_front_path,
    v_last.id_back_path,
    p_selfie_path,
    v_last.full_name_on_id,
    v_last.id_number,
    v_last.birth_date,
    'pending',
    true
  )
  returning id into v_new_id;

  update public.profiles
     set verification_status = 'pending'
   where id = v_caller;

  return jsonb_build_object(
    'ok', true,
    'verification_id', v_new_id,
    'status', 'pending',
    'is_renewal', true
  );
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.sync_phone_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- phone və phone_number-i həmişə eyni saxla
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles' and column_name='phone'
  ) then
    if new.phone is distinct from old.phone and new.phone_number is not distinct from old.phone_number then
      new.phone_number := new.phone;
    elsif new.phone_number is distinct from old.phone_number and new.phone is not distinct from old.phone then
      new.phone := new.phone_number;
    end if;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.sync_profile_online_state()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.is_online is distinct from old.is_online then
    new.availability_status := case when new.is_online then 'online' else 'offline' end;
    -- Köhnə `status` sütunu varsa
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='profiles' and column_name='status'
    ) then
      new.status := case when new.is_online then 'online' else 'offline' end;
    end if;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.sync_provider_wallet_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and new.balance is distinct from old.balance then
    update public.provider_wallets
       set balance    = new.balance,
           updated_at = now()
     where provider_id = new.id;
    if not found then
      insert into public.provider_wallets (provider_id, balance)
      values (new.id, new.balance)
      on conflict (provider_id) do nothing;
    end if;
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.tg_brigade_assignment_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member_profile uuid;
  v_action         text;
begin
  begin
    select profile_id into v_member_profile from public.brigade_members where id = new.member_id;
    if tg_op = 'INSERT' then
      v_action := 'assignment_' || new.status;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := 'assignment_' || new.status;
    else
      return new;
    end if;
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      coalesce(new.assigned_by, v_member_profile),
      v_action, 'brigade_assignment', new.id::text,
      jsonb_build_object(
        'brigade_id', new.brigade_id, 'member_id', new.member_id,
        'member_profile_id', v_member_profile, 'source_id', new.source_id,
        'status', new.status,
        'old_status', case when tg_op = 'UPDATE' then old.status else null end
      )
    );
  exception when others then null;
  end;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.tg_brigade_prices_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.tg_opportunity_auto_broadcast()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Yalnız təzə açıq sifarişlər
  if coalesce(new.status, '') not in ('open', 'pending', 'new', 'active') then
    return new;
  end if;
  if new.category_id is null then return new; end if;

  begin
    perform public.auto_broadcast_opportunity(new.id);
  exception when others then
    -- Broadcast uğursuzluğu sifarişin yaranmasını blok etməsin
    null;
  end;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.tg_sync_profile_from_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_fields jsonb;
begin
  v_fields := public.extract_profile_fields_from_auth(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    new.phone
  );

  -- Profili upsert et — boş olan sahələri doldur, mövcud dəyərləri pozma
  insert into public.profiles (id, name, email, phone_number, avatar_url, role)
  values (
    new.id,
    v_fields->>'name',
    v_fields->>'email',
    v_fields->>'phone_number',
    v_fields->>'avatar_url',
    'customer'
  )
  on conflict (id) do update set
    name         = coalesce(nullif(public.profiles.name, ''),         excluded.name),
    email        = coalesce(nullif(public.profiles.email, ''),        excluded.email),
    phone_number = coalesce(nullif(public.profiles.phone_number, ''), excluded.phone_number),
    avatar_url   = coalesce(nullif(public.profiles.avatar_url, ''),   excluded.avatar_url);

  return new;
exception when others then
  -- Auth axınını blok etməsin
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.unblock_user(p_block_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_block  record;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select * into v_block from public.user_blocks where id = p_block_id;
  if v_block.id is null then raise exception 'Block not found'; end if;

  -- Yalnız blocker özü və ya admin
  if v_block.blocker_id <> v_caller
     and not exists (
       select 1 from public.profiles p
        where p.id = v_caller
          and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
     ) then
    raise exception 'Forbidden';
  end if;

  delete from public.user_blocks where id = p_block_id;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.update_config_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.validate_opportunity_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_allowed boolean;
begin
  if new.status = old.status then return new; end if; -- no-op
  v_allowed := case
    when old.status in ('pending','open','new') and new.status in ('accepted','cancelled') then true
    when old.status = 'accepted'      and new.status in ('i-am-here','ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'i-am-here'     and new.status in ('ongoing','pending_review','completed','cancelled','refunded') then true
    when old.status = 'ongoing'       and new.status in ('pending_review','completed','cancelled','refunded') then true
    when old.status = 'pending_review' and new.status in ('completed','rejected','refunded') then true
    when old.status = 'completed'     and new.status in ('disputed','refunded') then true
    when old.status = 'disputed'      and new.status in ('completed','refunded') then true
    else false
  end;
  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: % -> % (opportunity %)', old.status, new.status, old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.validate_opportunity_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_allowed boolean := false;
begin
  -- Status dəyişməyibsə qarışmırıq
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Service role və admin role bypass edə bilir (admin paneldə manual müdaxilə)
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role' then
    return new;
  end if;

  -- Keçid matriksi
  v_allowed := case
    when old.status in ('pending', 'open', 'new') and new.status in ('accepted', 'cancelled') then true
    when old.status = 'accepted'   and new.status in ('i-am-here', 'ongoing', 'cancelled', 'refunded') then true
    when old.status = 'i-am-here'  and new.status in ('ongoing', 'cancelled', 'refunded') then true
    when old.status = 'ongoing'    and new.status in ('completed', 'cancelled', 'refunded') then true
    when old.status = 'completed'  and new.status in ('disputed', 'refunded') then true
    when old.status = 'disputed'   and new.status in ('completed', 'refunded') then true
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: % -> % (opportunity %)',
      old.status, new.status, old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.validate_promo_code(p_code text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_promo record;
  v_discount numeric := 0;
  v_uses integer;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_code is null or length(trim(p_code)) = 0 then
    return jsonb_build_object('valid', false, 'message', 'Kod boşdur');
  end if;
  select * into v_promo from public.promo_codes where upper(code) = upper(trim(p_code));
  if v_promo.id is null then return jsonb_build_object('valid', false, 'message', 'Promo kod tapılmadı'); end if;
  if not v_promo.is_active then return jsonb_build_object('valid', false, 'message', 'Kod aktiv deyil'); end if;
  if v_promo.starts_at is not null and now() < v_promo.starts_at then
    return jsonb_build_object('valid', false, 'message', 'Kod hələ aktiv deyil'); end if;
  if v_promo.expires_at is not null and now() > v_promo.expires_at then
    return jsonb_build_object('valid', false, 'message', 'Kodun vaxtı keçib'); end if;
  if v_promo.min_order_amount is not null and p_amount < v_promo.min_order_amount then
    return jsonb_build_object('valid', false, 'message', 'Minimum sifariş məbləği: ' || v_promo.min_order_amount || ' ₼'); end if;
  if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('valid', false, 'message', 'Kodun limiti dolub'); end if;
  if v_promo.per_user_limit is not null then
    select count(*) into v_uses from public.promo_redemptions where promo_id = v_promo.id and user_id = v_caller;
    if v_uses >= v_promo.per_user_limit then
      return jsonb_build_object('valid', false, 'message', 'Siz bu kodu artıq istifadə etmisiniz'); end if;
  end if;
  if v_promo.discount_type = 'percent' then
    v_discount := round(p_amount * v_promo.discount_value / 100, 2);
  else
    v_discount := v_promo.discount_value;
  end if;
  if v_discount > p_amount then v_discount := p_amount; end if;
  return jsonb_build_object('valid', true, 'promo_id', v_promo.id, 'code', v_promo.code,
    'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value,
    'discount', v_discount, 'final', p_amount - v_discount, 'message', 'Promo kod tətbiq olundu');
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.verify_password_change_otp(p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  select * into v_row
    from password_otps
   where user_id = v_uid and not used
   order by created_at desc
   limit 1;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'NO_OTP');
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  if v_row.attempts >= 5 then
    update password_otps set used = true where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  if v_row.otp <> regexp_replace(coalesce(p_otp, ''), '\D', '', 'g') then
    update password_otps set attempts = attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'WRONG_CODE',
                              'attempts_left', 5 - v_row.attempts - 1);
  end if;

  update password_otps set used = true where id = v_row.id;
  return jsonb_build_object('ok', true);
end;
$function$


-- ════════════════

CREATE OR REPLACE FUNCTION public.worker_earnings(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caller uuid := auth.uid(); v_platform_pct numeric; v_brigade_pct numeric; v_out jsonb;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  select coalesce((value)::text::numeric, 0) into v_platform_pct from public.platform_config where key='commission_on_accept';
  select coalesce((value)::text::numeric, 0) into v_brigade_pct from public.platform_config where key='brigade_member_commission_pct';

  with rows as (
    select op.id, op.title, op.completed_at, oo.offer_amount::numeric as amount,
           oo.brigade_id, oo.payment_method
    from public.opportunities op
    join public.opportunities_offers oo on oo.id = op.accepted_offer_id
    where oo.provider_id = v_caller and op.status='completed' and op.completed_at is not null
      and op.completed_at >= p_from and op.completed_at <= p_to
  ),
  calc as (
    select *,
      round(amount * v_platform_pct/100, 2) as platform_amt,
      case when brigade_id is not null then round(amount * v_brigade_pct/100, 2) else 0 end as brigade_cut
    from rows
  ),
  calc2 as (
    select *, round(amount - platform_amt - brigade_cut, 2) as worker_net,
           case when brigade_id is not null then v_brigade_pct else 0 end as brigade_pct
    from calc
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'count', (select count(*) from calc2),
    'gross', coalesce((select sum(amount) from calc2),0),
    'platform_total', coalesce((select sum(platform_amt) from calc2),0),
    'brigade_total', coalesce((select sum(brigade_cut) from calc2),0),
    'net_total', coalesce((select sum(worker_net) from calc2),0),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'completed_at', completed_at, 'amount', amount,
        'is_brigade', brigade_id is not null, 'payment_method', payment_method,
        'worker_pct', (100 - platform_amt/nullif(amount,0)*100 - brigade_pct), 'worker_net', worker_net,
        'brigade_cut', brigade_cut, 'platform_amt', platform_amt
      ) order by completed_at desc) from calc2), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$
