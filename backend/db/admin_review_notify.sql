-- İş admin yoxlamasına düşəndə (opportunities.status → pending_review) bütün
-- adminlərə bildiriş: "Yeni iş təsdiq gözləyir" → admin panelinin İş
-- təsdiqləri səhifəsi. Hansı yolla olursa olsun işləyir (mobil müştəri /usta
-- /rest/v1 ilə, veb RPC, API) — əvvəl adminə heç bir xəbər getmirdi.
-- Supabase-dən sinxronla gələn sətirlər (replica rejimi) trigger-i işə salmır.

create or replace function public.ellit_n_admin_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric;
  v_amt    text;
begin
  if new.status is distinct from 'pending_review'
     or old.status is not distinct from 'pending_review' then
    return new;
  end if;
  select offer_amount into v_amount
    from public.opportunities_offers where id = new.accepted_offer_id;
  v_amt := case when v_amount is null then ''
                else ' — ' || rtrim(rtrim(v_amount::text, '0'), '.') || ' ₼' end;
  insert into public.notifications (user_id, type, kind, title, body, related_id, link)
  select p.id, 'admin_review', 'admin_review', 'Yeni iş təsdiq gözləyir',
         coalesce(nullif(trim(new.title), ''), 'Sifariş') || v_amt
           || '. İş təsdiqləri bölməsində yoxlayın.',
         new.id::text, '/Administrator/job-completions'
    from public.profiles p
   where lower(coalesce(p.role, '')) in ('admin', 'master', 'superadmin');
  return new;
end $$;

drop trigger if exists ellit_n_admin_review on public.opportunities;
create trigger ellit_n_admin_review after update of status on public.opportunities
  for each row execute function public.ellit_n_admin_review();
