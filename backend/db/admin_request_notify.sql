-- Yeni müraciət gələndə bütün adminlərə bildiriş (veb admin paneli + mobil push).
--   * usta olmaq müraciəti         provider_requests      → /Administrator/providers
--   * KYC (ilk və ya təkrar)        provider_verifications → /Administrator/kyc
--   * briqada / şirkət müraciəti    brigade_applications   → /Administrator/brigades
--   * nağdlaşdırma istəyi           withdrawals            → /Administrator/withdrawals
--   * şikayət                       disputes               (admin səhifəsi hələ yoxdur)
--   * dəstək çatına yeni mesaj      chat_messages          → /Administrator/support
--     (admin söhbəti oxuyana qədər yalnız ilk mesaj üçün — hər mesaj üçün yox)
-- İş təsdiqi (pending_review) üçün bildiriş artıq var: db/admin_review_notify.sql.
--
-- type = 'admin_request', kind = müraciət növü. Hansı yolla yaranırsa yaransın
-- işləyir (mobil, veb, API). Supabase-dən sinxronla gələn sətirlər (replica
-- rejimi) trigger-ləri işə salmır — onlar admin panelindəki saylarda görünür.

create or replace function public.ellit_notify_admins(
  p_kind text, p_title text, p_body text, p_related text, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  select p.id, 'admin_request', p_kind, p_title, left(p_body, 300), p_related, p_link
    from public.profiles p
   where lower(coalesce(p.role, '')) in ('admin', 'master', 'superadmin')
     and exists (select 1 from public.users u where u.id = p.id);
end $$;

create or replace function public.ellit_profile_label(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(trim(p.name), ''), nullif(trim(p.email), ''))
                     from public.profiles p where p.id = p_id), 'İstifadəçi')
$$;

-- ── Usta olmaq müraciəti ─────────────────────────────────────────
create or replace function public.ellit_na_provider_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from 'pending' then return new; end if;
  perform public.ellit_notify_admins(
    'provider_request', 'Yeni usta müraciəti',
    public.ellit_profile_label(new.user_id) || ' usta olmaq istəyir'
      || coalesce(' (' || nullif(trim(new.company_name), '') || ')', '') || '.',
    new.id::text, '/Administrator/providers');
  return new;
end $$;

drop trigger if exists ellit_na_provider_request on public.provider_requests;
create trigger ellit_na_provider_request after insert on public.provider_requests
  for each row execute function public.ellit_na_provider_request();

-- ── KYC (sənəd yoxlaması) ────────────────────────────────────────
create or replace function public.ellit_na_kyc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from 'pending'
     or (tg_op = 'UPDATE' and old.status is not distinct from 'pending') then
    return new;
  end if;
  perform public.ellit_notify_admins(
    'kyc',
    case when coalesce(new.is_renewal, false) then 'KYC yenilənməsi' else 'Yeni KYC müraciəti' end,
    coalesce(nullif(trim(new.full_name_on_id), ''), public.ellit_profile_label(new.provider_id))
      || ' sənədlərini yoxlamaya göndərdi.',
    new.id::text, '/Administrator/kyc');
  return new;
end $$;

drop trigger if exists ellit_na_kyc on public.provider_verifications;
create trigger ellit_na_kyc after insert or update of status on public.provider_verifications
  for each row execute function public.ellit_na_kyc();

-- ── Briqada / şirkət müraciəti ───────────────────────────────────
create or replace function public.ellit_na_brigade_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from 'pending' then return new; end if;
  perform public.ellit_notify_admins(
    'brigade_application', 'Yeni briqada müraciəti',
    coalesce(nullif(trim(new.name), ''), 'Briqada') || ' — '
      || coalesce(nullif(trim(new.applicant_name), ''), public.ellit_profile_label(new.applicant_id))
      || '.',
    new.id::text, '/Administrator/brigades');
  return new;
end $$;

drop trigger if exists ellit_na_brigade_application on public.brigade_applications;
create trigger ellit_na_brigade_application after insert on public.brigade_applications
  for each row execute function public.ellit_na_brigade_application();

-- ── Nağdlaşdırma ─────────────────────────────────────────────────
create or replace function public.ellit_na_withdrawal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from 'pending' then return new; end if;
  perform public.ellit_notify_admins(
    'withdrawal', 'Yeni nağdlaşdırma istəyi',
    public.ellit_profile_label(new.provider_id) || ' — '
      || rtrim(rtrim(new.amount_requested::text, '0'), '.') || ' ₼.',
    new.id::text, '/Administrator/withdrawals');
  return new;
end $$;

drop trigger if exists ellit_na_withdrawal on public.withdrawals;
create trigger ellit_na_withdrawal after insert on public.withdrawals
  for each row execute function public.ellit_na_withdrawal();

-- ── Şikayət ──────────────────────────────────────────────────────
create or replace function public.ellit_na_dispute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ellit_notify_admins(
    'dispute', 'Yeni şikayət',
    public.ellit_profile_label(new.raised_by) || ': '
      || case new.reason
           when 'work_not_done' then 'iş görülməyib'
           when 'poor_quality' then 'keyfiyyətsiz iş'
           when 'damage' then 'ziyan vurulub'
           when 'no_show' then 'usta gəlməyib'
           when 'overcharged' then 'artıq pul alınıb'
           when 'rude_behavior' then 'kobud davranış'
           when 'theft' then 'oğurluq'
           else 'digər' end
      || ' (sifariş #' || left(new.opportunity_id::text, 8) || ').',
    new.id::text, null);
  return new;
end $$;

drop trigger if exists ellit_na_dispute on public.disputes;
create trigger ellit_na_dispute after insert on public.disputes
  for each row execute function public.ellit_na_dispute();

-- ── Dəstək çatı: istifadəçidən yeni mesaj ────────────────────────
create or replace function public.ellit_na_support_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = new.conversation_id;
  -- dəstək söhbəti: sifarişə bağlı deyil, kateqoriyası var; yazan istifadəçinin özüdür
  if not found or c.opportunity_id is not null or c.category is null
     or new.sender_id is distinct from c.customer_id then
    return new;
  end if;
  -- admin əvvəlki mesajları hələ oxumayıbsa (çatı açmayıb) — artıq xəbəri var
  if exists (select 1 from public.chat_messages m
              where m.conversation_id = new.conversation_id and m.id <> new.id
                and m.sender_id = c.customer_id and m.read_at is null) then
    return new;
  end if;
  perform public.ellit_notify_admins(
    'support_message', 'Dəstək çatında yeni mesaj',
    public.ellit_profile_label(new.sender_id) || ': '
      || coalesce(nullif(trim(new.body), ''), '📎 fayl'),
    c.id::text, '/Administrator/support');
  return new;
end $$;

drop trigger if exists ellit_na_support_message on public.chat_messages;
create trigger ellit_na_support_message after insert on public.chat_messages
  for each row execute function public.ellit_na_support_message();

revoke all on function public.ellit_notify_admins(text, text, text, text, text),
  public.ellit_profile_label(uuid) from public;
