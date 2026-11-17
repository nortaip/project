-- Usta gözləmədə olan təklifin gəliş gününü dəyişəndə müştəriyə bildiriş.
-- (Yeni təklif / status bildirişləri kimi yalnız /rest/v1 yazılarında —
-- db/notify_triggers.sql; push növbəsi notifications trigger-i ilə gedir.)
create or replace function public.ellit_n_offer_rescheduled() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_title    text;
  v_name     text;
begin
  if not public.ellit_via_rest() or new.proposed_at is not distinct from old.proposed_at
     or new.proposed_at is null or new.status <> 'pending' then
    return new;
  end if;
  select created_by, title into v_customer, v_title
    from public.opportunities where id = new.opportunity_id;
  if v_customer is null then return new; end if;
  select coalesce(name, 'Usta') into v_name from public.profiles where id = new.provider_id;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  values (v_customer, 'offer_rescheduled', 'offer_rescheduled',
          coalesce(v_name, 'Usta') || ' gəliş gününü dəyişdi',
          coalesce(v_title, 'Sifarişiniz') || ' — yeni gün: '
            || to_char(new.proposed_at at time zone 'Asia/Baku', 'DD.MM.YYYY')
            || case when to_char(new.proposed_at at time zone 'Asia/Baku', 'HH24:MI') = '00:00'
                    then '' else ' ' || to_char(new.proposed_at at time zone 'Asia/Baku', 'HH24:MI') end,
          new.id::text, '/my-opportunities');
  return new;
end $$;

drop trigger if exists ellit_n_offer_rescheduled on public.opportunities_offers;
create trigger ellit_n_offer_rescheduled after update of proposed_at on public.opportunities_offers
  for each row execute function public.ellit_n_offer_rescheduled();
