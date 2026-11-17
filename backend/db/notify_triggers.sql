-- Bildiriş trigger-ləri + push növbəsi.
--
-- Supabase-də bildirişləri bazanın öz trigger-ləri yaradırdı (sifariş, təklif,
-- status, booking, briqada, şikayət, KYC) və hər bildiriş FCM push ilə
-- göndərilirdi. Bu backend-də həmin hadisələrin RPC / API yolları Python-da
-- bildiriş yaradır (app/services/notify.py), amma klientlər bir çox yazını
-- birbaşa /rest/v1 ilə edir (məs. sifarişin yaranması, təklif, status). Bu
-- trigger-lər YALNIZ /rest/v1 yazılarında işləyir (`app.via_rest = on`,
-- app/compat/context.py → rls_connection) — Python yolları ilə ikiqat olmasın.
--
-- notifications cədvəlinə düşən HƏR sətir (haradan gəlməsindən asılı olmayaraq)
-- `pg_notify('ellit_push', id)` edir; worker (app/services/push_listener.py)
-- onu FCM ilə istifadəçinin cihazlarına göndərir. Supabase-dən sinxronla gələn
-- sətirlər (session_replication_role = replica) trigger-ləri işə salmır —
-- onların push-unu Supabase özü göndərib.

create or replace function public.ellit_via_rest() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.via_rest', true), '') = 'on'
$$;

-- Usta ixtisası: kateqoriya ID-si (mobil) və ya adı (veb qeydiyyatı) ola bilər
create or replace function public.ellit_specialty_keys(p_cat uuid, p_sub uuid) returns text[]
language sql stable as $$
  select array_remove(array[
    p_cat::text, p_sub::text,
    (select label from public.service_categories where id = p_cat),
    (select label from public.service_subcategories where id = p_sub)
  ], null)
$$;

-- ── Yeni sifariş → uyğun ixtisaslı ONLAYN ustalar ─────────────────
create or replace function public.ellit_n_new_opportunity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_keys text[];
begin
  if not public.ellit_via_rest() then return new; end if;
  if lower(coalesce(new.status, '')) not in ('pending', 'open', 'new', '') then
    return new;
  end if;
  v_keys := public.ellit_specialty_keys(new.category_id, new.subcategory_id);
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  select p.id, 'new_opportunity', 'new_opportunity',
         'Yeni sifariş: ' || coalesce(new.title, 'Yeni sifariş'),
         coalesce(new.description, new.location, 'Detallara baxın'),
         new.id::text, '/account/services'
    from public.profiles p
   where lower(coalesce(p.role, '')) in ('provider', 'pro', 'seller')
     and p.id is distinct from new.created_by
     and coalesce(p.is_online, false)
     and (coalesce(array_length(p.specialties, 1), 0) = 0
          or p.specialties && v_keys);
  return new;
end $$;

-- ── Sifariş statusu → müştəri + təyin olunmuş usta ───────────────
create or replace function public.ellit_n_opportunity_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body  text;
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status then
    return new;
  end if;
  case new.status
    when 'accepted'  then v_title := 'Sifariş qəbul edildi'; v_body := 'Provayder sifarişinizi qəbul etdi.';
    when 'i-am-here' then v_title := 'Provayder ünvanda';    v_body := 'Provayder ünvana çatıb.';
    when 'ongoing'   then v_title := 'İş başladı';           v_body := 'Sifariş üzərində iş başladı.';
    when 'completed' then v_title := 'İş tamamlandı';        v_body := 'Sifariş uğurla tamamlandı.';
    when 'cancelled' then v_title := 'Sifariş ləğv edildi';  v_body := 'Sifariş ləğv edildi.';
    else v_title := 'Sifariş statusu dəyişdi'; v_body := concat('Yeni status: ', new.status);
  end case;
  if new.created_by is not null then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.created_by, 'status_' || new.status, 'status_' || new.status,
            v_title, v_body, new.id::text);
  end if;
  if new.provider_id is not null and new.provider_id is distinct from new.created_by then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.provider_id, 'status_' || new.status, 'status_' || new.status,
            v_title, v_body, new.id::text);
  end if;
  return new;
end $$;

-- ── Yeni təklif → müştəri ────────────────────────────────────────
create or replace function public.ellit_n_new_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_title    text;
  v_name     text;
begin
  if not public.ellit_via_rest() or new.status <> 'pending' then return new; end if;
  select created_by, title into v_customer, v_title
    from public.opportunities where id = new.opportunity_id;
  if v_customer is null then return new; end if;
  select coalesce(name, 'Provayder') into v_name from public.profiles where id = new.provider_id;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  values (v_customer, 'new_offer', 'new_offer',
          'Yeni təklif: ' || coalesce(v_name, 'Provayder'),
          coalesce(v_title, 'Sifarişiniz') || ' — ' || coalesce(new.offer_amount::text, '') || ' ₼',
          new.id::text, '/my-opportunities');
  return new;
end $$;

-- ── Təklif statusu → usta ────────────────────────────────────────
create or replace function public.ellit_n_offer_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opp  text;
  v_title text;
  v_kind text;
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status
     or new.provider_id is null then
    return new;
  end if;
  if new.status = 'accepted' then
    v_title := 'Təklifin qəbul edildi!'; v_kind := 'offer_accepted';
  elsif new.status = 'rejected' then
    v_title := 'Təklifin rədd edildi'; v_kind := 'offer_rejected';
  elsif new.status = 'completed' then
    v_title := 'İş tamamlandı və ödəniş açıldı'; v_kind := 'offer_completed';
  else
    return new;
  end if;
  select coalesce(title, 'Sifariş') into v_opp from public.opportunities where id = new.opportunity_id;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  values (new.provider_id, v_kind, v_kind, v_title,
          coalesce(v_opp, 'Sifariş') || ' — ' || coalesce(new.offer_amount::text, '') || ' ₼',
          new.id::text, '/account/services');
  return new;
end $$;

-- ── Booking: yeni + status ───────────────────────────────────────
create or replace function public.ellit_n_new_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.ellit_via_rest() and new.provider_id is not null
     and new.provider_id is distinct from new.customer_id then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.provider_id, 'new_booking', 'new_booking', 'Yeni sifariş',
            'Sizə yeni sifariş gəldi.', new.id::text);
  end if;
  return new;
end $$;

create or replace function public.ellit_n_booking_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body  text;
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status then
    return new;
  end if;
  case new.status
    when 'confirmed' then v_title := 'Sifariş qəbul edildi'; v_body := 'Provayder sifarişinizi qəbul etdi.';
    when 'completed' then v_title := 'Sifariş tamamlandı'; v_body := 'Sifariş uğurla tamamlandı — rəy bildirə bilərsiniz.';
    when 'cancelled' then v_title := 'Sifariş ləğv edildi'; v_body := 'Bu sifariş ləğv edildi.';
    else v_title := 'Sifariş statusu dəyişdi'; v_body := concat('Yeni status: ', new.status);
  end case;
  if new.customer_id is not null then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.customer_id, 'booking_' || new.status, 'booking_' || new.status,
            v_title, v_body, new.id::text);
  end if;
  if new.provider_id is not null and new.provider_id is distinct from new.customer_id then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.provider_id, 'booking_' || new.status, 'booking_' || new.status,
            v_title, v_body, new.id::text);
  end if;
  return new;
end $$;

-- ── Briqada: təyinat və dəvət ────────────────────────────────────
create or replace function public.ellit_n_brigade_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
  v_brigade text;
  v_opp     text;
  v_kind    text;
begin
  if not public.ellit_via_rest() or new.status not in ('offered', 'assigned') then
    return new;
  end if;
  select profile_id into v_profile from public.brigade_members where id = new.member_id;
  if v_profile is null then return new; end if;
  select name into v_brigade from public.brigades where id = new.brigade_id;
  select title into v_opp from public.opportunities where id::text = new.source_id;
  v_kind := case when new.status = 'offered' then 'brigade_offer' else 'brigade_assignment' end;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  values (v_profile, v_kind, v_kind,
          coalesce(v_brigade, 'Briqada') || ' — '
            || case when new.status = 'offered' then 'yeni sifariş' else 'yeni təyinat' end,
          coalesce(v_opp, 'Sifariş') || ' — '
            || case when new.status = 'offered' then 'ilk qəbul edən qazanır' else 'sənə təyin edildi' end,
          new.id::text, '/account/master/incoming');
  return new;
end $$;

create or replace function public.ellit_n_brigade_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid;
  v_brigade text;
begin
  if not public.ellit_via_rest() then return new; end if;
  if new.email is not null then
    select id into v_user from public.users where email = lower(new.email) limit 1;
  end if;
  if v_user is null and new.phone is not null then
    select id into v_user from public.users
     where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9)
         = right(regexp_replace(new.phone, '\D', '', 'g'), 9)
       and length(regexp_replace(new.phone, '\D', '', 'g')) >= 9
     limit 1;
  end if;
  if v_user is null then return new; end if;
  select name into v_brigade from public.brigades where id = new.brigade_id;
  insert into public.notifications (user_id, type, kind, title, body, related_id)
  values (v_user, 'brigade_invite', 'brigade_invite',
          coalesce(v_brigade, 'Şirkət') || ' sizi dəvət edir',
          'Şirkətə ' || case new.intended_role when 'dispatcher' then 'dispatcher' else 'işçi' end
            || ' kimi qatılmaq üçün dəvət aldınız.',
          new.token::text);
  return new;
end $$;

-- ── Şikayət və KYC ───────────────────────────────────────────────
create or replace function public.ellit_n_dispute_opened() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.ellit_via_rest() and new.against_user is not null then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.against_user, 'dispute_opened', 'dispute_opened',
            'Sizin barənizdə şikayət açıldı',
            'Sifariş #' || substring(new.opportunity_id::text, 1, 8) || ' üçün şikayət baxılır.',
            new.opportunity_id::text);
  end if;
  return new;
end $$;

create or replace function public.ellit_n_dispute_resolved() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body  text;
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status
     or new.status not in ('resolved_customer', 'resolved_provider') then
    return new;
  end if;
  if new.status = 'resolved_customer' then
    v_title := 'Şikayət müştərinin lehinə həll olundu'; v_body := 'Pul müştərinin balansına qaytarıldı.';
  else
    v_title := 'Şikayət provayderin lehinə həll olundu'; v_body := 'Pul provayderə ötürüldü.';
  end if;
  insert into public.notifications (user_id, type, kind, title, body, related_id)
  select u, 'dispute_resolved', 'dispute_resolved', v_title, v_body, new.opportunity_id::text
    from unnest(array[new.raised_by, new.against_user]) u where u is not null;
  return new;
end $$;

create or replace function public.ellit_n_kyc_decision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status
     or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  insert into public.notifications (user_id, type, kind, title, body, related_id)
  values (new.provider_id, 'kyc_' || new.status, 'kyc_' || new.status,
          case when new.status = 'approved' then 'KYC təsdiq olundu' else 'KYC rədd edildi' end,
          case when new.status = 'approved' then 'Artıq sifariş təkliflərinə cavab verə bilərsiniz.'
               else coalesce(new.rejection_reason, 'Yenidən cəhd edə bilərsiniz.') end,
          new.id::text);
  return new;
end $$;

-- ── Çat: söhbətin son mesajı (Supabase _touch_conversation_after_message) ──
-- + qarşı tərəfə bildiriş (tətbiq bağlı olanda da mesaj xəbəri gəlsin)
create or replace function public.ellit_chat_message_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv public.conversations%rowtype;
  v_to   uuid;
  v_from text;
begin
  update public.conversations
     set last_message_at = new.created_at, last_message_preview = left(new.body, 120)
   where id = new.conversation_id
  returning * into v_conv;
  if public.ellit_via_rest() and v_conv.id is not null then
    v_to := case when new.sender_id = v_conv.customer_id then v_conv.provider_id
                 else v_conv.customer_id end;
    if v_to is not null and v_to is distinct from new.sender_id then
      select coalesce(name, 'İstifadəçi') into v_from from public.profiles where id = new.sender_id;
      insert into public.notifications (user_id, type, kind, title, body, related_id)
      values (v_to, 'chat', 'chat', coalesce(v_from, 'Yeni mesaj'),
              left(coalesce(new.body, ''), 140), new.conversation_id::text);
    end if;
  end if;
  return new;
end $$;

-- ── Hər yeni bildiriş → push növbəsi ─────────────────────────────
create or replace function public.ellit_push_on_notification() returns trigger
language plpgsql as $$
begin
  perform pg_notify('ellit_push', new.id::text);
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('opportunities',        'ellit_n_new_opportunity',      'after insert'),
    ('opportunities',        'ellit_n_opportunity_status',   'after update of status'),
    ('opportunities_offers', 'ellit_n_new_offer',            'after insert'),
    ('opportunities_offers', 'ellit_n_offer_status',         'after update of status'),
    ('bookings',             'ellit_n_new_booking',          'after insert'),
    ('bookings',             'ellit_n_booking_status',       'after update of status'),
    ('brigade_assignments',  'ellit_n_brigade_assignment',   'after insert or update of status'),
    ('brigade_invites',      'ellit_n_brigade_invite',       'after insert'),
    ('disputes',             'ellit_n_dispute_opened',       'after insert'),
    ('disputes',             'ellit_n_dispute_resolved',     'after update of status'),
    ('provider_verifications','ellit_n_kyc_decision',        'after update of status'),
    ('chat_messages',        'ellit_chat_message_after_insert', 'after insert'),
    ('notifications',        'ellit_push_on_notification',   'after insert')
  ) as v(tbl, fn, ev) loop
    execute format('drop trigger if exists %I on public.%I', r.fn, r.tbl);
    execute format('create trigger %I %s on public.%I for each row execute function public.%I()',
                   r.fn, r.ev, r.tbl, r.fn);
  end loop;
end $$;
