-- Status bildirişləri tam Azərbaycan dilində.
--
-- notify_triggers.sql-də siyahıda olmayan statuslar texniki adla gedirdi:
-- "Sifariş statusu dəyişdi — Yeni status: pending_review". İndi bütün
-- statusların (opportunities_status_check, bookings_status_check) öz mətni
-- var; naməlum status olsa belə texniki ad göstərilmir. Alıcılar dəyişmir
-- (müştəri + usta, Supabase ilə eyni). Köhnə bildirişlər də düzəldilir.

create or replace function public.ellit_opportunity_status_text(p_status text)
returns text[] language sql immutable as $$
  select case p_status
    when 'accepted'       then array['Sifariş qəbul edildi', 'Provayder sifarişinizi qəbul etdi.']
    when 'i-am-here'      then array['Provayder ünvanda', 'Provayder ünvana çatıb.']
    when 'ongoing'        then array['İş başladı', 'Sifariş üzərində iş başladı.']
    when 'pending_review' then array['İş təsdiqə göndərildi',
                                     'İş bitdi — admin təsdiqindən sonra ödəniş tamamlanacaq.']
    when 'completed'      then array['İş tamamlandı', 'Sifariş uğurla tamamlandı.']
    when 'cancelled'      then array['Sifariş ləğv edildi', 'Sifariş ləğv edildi.']
    when 'disputed'       then array['Şikayət açıldı',
                                     'Sifariş üzrə şikayət açıldı — dəstək komandası araşdırır.']
    when 'refunded'       then array['Ödəniş geri qaytarıldı', 'Sifarişin ödənişi geri qaytarıldı.']
    when 'rejected'       then array['İş təsdiqlənmədi',
                                     'Admin işin tamamlanmasını təsdiqləmədi — dəstək komandası sizinlə əlaqə saxlayacaq.']
    when 'pending'        then array['Sifariş yenidən açıldı', 'Sifariş yenidən ustaların təkliflərinə açıqdır.']
    when 'open'           then array['Sifariş yenidən açıldı', 'Sifariş yenidən ustaların təkliflərinə açıqdır.']
    when 'new'            then array['Sifariş yenidən açıldı', 'Sifariş yenidən ustaların təkliflərinə açıqdır.']
    when 'active'         then array['Sifariş yenidən açıldı', 'Sifariş yenidən ustaların təkliflərinə açıqdır.']
    else array['Sifariş yeniləndi', 'Sifarişinizin vəziyyəti dəyişdi.']
  end
$$;

create or replace function public.ellit_booking_status_text(p_status text)
returns text[] language sql immutable as $$
  select case p_status
    when 'confirmed' then array['Sifariş qəbul edildi', 'Provayder sifarişinizi qəbul etdi.']
    when 'completed' then array['Sifariş tamamlandı', 'Sifariş uğurla tamamlandı — rəy bildirə bilərsiniz.']
    when 'cancelled' then array['Sifariş ləğv edildi', 'Bu sifariş ləğv edildi.']
    when 'pending'   then array['Sifariş gözləmədədir', 'Sifariş provayderin cavabını gözləyir.']
    else array['Sifariş yeniləndi', 'Sifarişinizin vəziyyəti dəyişdi.']
  end
$$;

-- ── Sifariş statusu → müştəri + təyin olunmuş usta ───────────────
create or replace function public.ellit_n_opportunity_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_txt text[];
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status then
    return new;
  end if;
  v_txt := public.ellit_opportunity_status_text(new.status);
  if new.created_by is not null then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.created_by, 'status_' || new.status, 'status_' || new.status,
            v_txt[1], v_txt[2], new.id::text);
  end if;
  if new.provider_id is not null and new.provider_id is distinct from new.created_by then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.provider_id, 'status_' || new.status, 'status_' || new.status,
            v_txt[1], v_txt[2], new.id::text);
  end if;
  return new;
end $$;

-- ── Booking statusu → müştəri + provayder ─────────────────────────
create or replace function public.ellit_n_booking_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_txt text[];
begin
  if not public.ellit_via_rest() or new.status is not distinct from old.status then
    return new;
  end if;
  v_txt := public.ellit_booking_status_text(new.status);
  if new.customer_id is not null then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.customer_id, 'booking_' || new.status, 'booking_' || new.status,
            v_txt[1], v_txt[2], new.id::text);
  end if;
  if new.provider_id is not null and new.provider_id is distinct from new.customer_id then
    insert into public.notifications (user_id, type, kind, title, body, related_id)
    values (new.provider_id, 'booking_' || new.status, 'booking_' || new.status,
            v_txt[1], v_txt[2], new.id::text);
  end if;
  return new;
end $$;

-- ── Artıq göndərilmiş "Yeni status: …" bildirişləri ───────────────
update public.notifications n
   set title = t.txt[1], body = t.txt[2]
  from (select id, case when type like 'booking\_%'
                        then public.ellit_booking_status_text(substr(body, 14))
                        else public.ellit_opportunity_status_text(substr(body, 14))
                   end as txt
          from public.notifications
         where body like 'Yeni status: %') t
 where n.id = t.id;
