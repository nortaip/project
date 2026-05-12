-- ============================================================================
-- Admin başqa istifadəçilərin profilini update edə bilməlidir
--
-- Problem: profiles RLS update policy yalnız `auth.uid() = id` icazə verir
-- → Admin Users səhifəsində telefon, ad və s. dəyişdiklərində update fail olur
-- (heç bir error verir, sadəcə 0 sətir update olunur)
--
-- Düzəliş: admin/master/superadmin role-larına bütün profilləri update etmə
-- icazəsi verən yeni policy.
-- ============================================================================

-- Köhnə policy-i sil
drop policy if exists "users update own profile" on public.profiles;

-- Yenisi: öz profilini hər kəs, admin isə hamısını
create policy "users update own profile or admin update any"
  on public.profiles
  for update
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  )
  with check (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );

-- ── phone və phone_number sütunlarını sinxronlaşdır (legacy + new naming) ──
do $$
begin
  -- phone_number sütunu yoxdursa əlavə et
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name='phone_number'
  ) then
    alter table public.profiles add column phone_number text;
  end if;

  -- phone sütunu mövcuddursa, dəyərləri köçür
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name='phone'
  ) then
    -- phone və phone_number arasında sinxron — boş olanı doldur
    update public.profiles
       set phone_number = phone
     where phone is not null
       and (phone_number is null or phone_number = '');
    update public.profiles
       set phone = phone_number
     where phone_number is not null
       and (phone is null or phone = '');
  end if;
end$$;

-- Sync trigger: iki sütun arasında avtomatik sinxronizasiya
create or replace function public.sync_phone_columns()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists trg_sync_phone on public.profiles;
create trigger trg_sync_phone
  before update on public.profiles
  for each row execute function public.sync_phone_columns();

notify pgrst, 'reload schema';
