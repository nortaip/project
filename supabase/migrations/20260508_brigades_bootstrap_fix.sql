-- ============================================================================
--  Brigade Bootstrap Fix — 2026-05-08
--
--  Problem: brigade_members INSERT RLS chicken-and-egg ilə bloklanır.
--  brigade_role() funksiyası member-likdən asılıdır, amma ilk owner hələ
--  member deyil → INSERT bloklanır → user heç vaxt member ola bilmir.
--
--  Həll:
--    1. RLS policy brigades.owner_id-ni də qəbul edir
--    2. Trigger brigada yaradıldıqda owner-i avtomatik member kimi əlavə edir
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fix 1: RLS policy yenilənir — brigade owner həmişə member idarə edə bilər║
-- ╚══════════════════════════════════════════════════════════════════════════╝

drop policy if exists "owner manages members" on public.brigade_members;
create policy "owner manages members"
  on public.brigade_members
  for all
  to authenticated
  using (
    -- Brigada owner-i (brigades.owner_id) həmişə member idarə edir
    exists (
      select 1 from public.brigades b
      where b.id = brigade_members.brigade_id
        and b.owner_id = auth.uid()
    )
    -- Və ya artıq owner/dispatcher kimi qeydə alınmış member
    or public.brigade_role(brigade_members.brigade_id) in ('owner', 'dispatcher')
  )
  with check (
    exists (
      select 1 from public.brigades b
      where b.id = brigade_members.brigade_id
        and b.owner_id = auth.uid()
    )
    or public.brigade_role(brigade_members.brigade_id) in ('owner', 'dispatcher')
  );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fix 2: Brigada yaradıldıqda owner avtomatik member olsun                 ║
-- ║ Bu trigger client kodunu sadələşdirir — INSERT iki yerə yazmağa lazım    ║
-- ║ qalmır.                                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public._brigade_auto_add_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.brigade_members (brigade_id, profile_id, role, is_active)
  values (new.id, new.owner_id, 'owner', true)
  on conflict (brigade_id, profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_brigade_auto_owner on public.brigades;
create trigger trg_brigade_auto_owner
  after insert on public.brigades
  for each row
  execute function public._brigade_auto_add_owner_member();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Verification                                                              ║
-- ║                                                                          ║
-- ║   Test brigada yaradıb owner-in avtomatik member olduğunu yoxla:         ║
-- ║                                                                          ║
-- ║   insert into brigades (owner_id, name) values (auth.uid(), 'Test');     ║
-- ║   -- Bu sorğu işlədikdən sonra:                                          ║
-- ║   select * from brigade_members where profile_id = auth.uid();           ║
-- ║   -- Burada role='owner' row görəcəksən.                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
