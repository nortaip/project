-- ============================================================================
-- Admin "Şirkətlər" (briqadalar) paneli + tam loglama
--
--   1. brigade_assignments → audit_log trigger (assign/accept/decline/
--      complete/cancel/expire — işçinin hər hərəkəti loglanır)
--   2. admin_companies_list()        — bütün şirkətlərin xülasəsi (admin)
--   3. admin_company_detail(brigade) — şirkətin hər şeyi: işçilər (% ilə),
--      sifarişlər, maliyyə (işçiyə köçürmələr), loglar
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. brigade_assignments → audit_log (bütün status dəyişiklikləri)          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.tg_brigade_assignment_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_profile uuid;
  v_action         text;
begin
  begin
    select profile_id into v_member_profile
      from public.brigade_members where id = new.member_id;

    if tg_op = 'INSERT' then
      v_action := 'assignment_' || new.status;       -- assignment_offered / _assigned
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := 'assignment_' || new.status;       -- _accepted/_declined/_completed/...
    else
      return new;
    end if;

    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (
      coalesce(new.assigned_by, v_member_profile),
      v_action,
      'brigade_assignment',
      new.id::text,
      jsonb_build_object(
        'brigade_id',         new.brigade_id,
        'member_id',          new.member_id,
        'member_profile_id',  v_member_profile,
        'source_id',          new.source_id,
        'status',             new.status,
        'old_status',         case when tg_op = 'UPDATE' then old.status else null end
      )
    );
  exception when others then
    null;  -- loglama heç vaxt əsas əməliyyatı pozmasın
  end;
  return new;
end;
$$;

drop trigger if exists trg_brigade_assignment_audit on public.brigade_assignments;
create trigger trg_brigade_assignment_audit
  after insert or update on public.brigade_assignments
  for each row execute function public.tg_brigade_assignment_audit();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. admin_companies_list                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_companies_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.profiles
     where id = v_caller and lower(coalesce(role,'')) in ('admin','master','superadmin')
  ) then
    raise exception 'Forbidden: admin only';
  end if;

  return coalesce((
    select jsonb_agg(x order by (x->>'name'))
      from (
        select jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'is_verified', b.is_verified,
          'is_active', b.is_active,
          'balance', b.balance,
          'rating', b.rating,
          'total_orders', b.total_orders,
          'created_at', b.created_at,
          'owner_name', (select name from public.profiles where id = b.owner_id),
          'member_count', (select count(*) from public.brigade_members bm
                            where bm.brigade_id = b.id and bm.is_active),
          'online_count', (select count(*) from public.brigade_members bm
                            where bm.brigade_id = b.id and bm.is_active and bm.is_online),
          'offer_count',  (select count(*) from public.opportunities_offers oo
                            where oo.brigade_id = b.id)
        ) as x
        from public.brigades b
      ) t
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_companies_list() from public, anon;
grant   execute on function public.admin_companies_list() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. admin_company_detail                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_company_detail(p_brigade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_brigade  jsonb;
  v_members  jsonb;
  v_orders   jsonb;
  v_finance  jsonb;
  v_logs     jsonb;
begin
  if not exists (
    select 1 from public.profiles
     where id = v_caller and lower(coalesce(role,'')) in ('admin','master','superadmin')
  ) then
    raise exception 'Forbidden: admin only';
  end if;

  -- Şirkət
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'description', b.description,
    'is_verified', b.is_verified, 'is_active', b.is_active,
    'balance', b.balance, 'rating', b.rating, 'total_orders', b.total_orders,
    'categories', b.categories, 'contact_phone', b.contact_phone,
    'contact_email', b.contact_email, 'address', b.address,
    'created_at', b.created_at,
    'owner_name', (select name from public.profiles where id = b.owner_id),
    'owner_id', b.owner_id
  ) into v_brigade
  from public.brigades b where b.id = p_brigade_id;

  if v_brigade is null then raise exception 'Şirkət tapılmadı'; end if;

  -- İşçilər (komissiya %-i ilə)
  select coalesce(jsonb_agg(jsonb_build_object(
    'member_id', bm.id,
    'profile_id', bm.profile_id,
    'name', p.name,
    'avatar_url', p.avatar_url,
    'role', bm.role,
    'commission_pct', bm.commission_pct,
    'is_active', bm.is_active,
    'is_online', bm.is_online,
    'joined_at', bm.joined_at,
    'done_count', (select count(*) from public.brigade_assignments ba
                    where ba.member_id = bm.id and ba.status = 'completed')
  ) order by bm.role, p.name), '[]'::jsonb) into v_members
  from public.brigade_members bm
  join public.profiles p on p.id = bm.profile_id
  where bm.brigade_id = p_brigade_id;

  -- Sifarişlər (şirkət təklifləri + təyin olunan işçi)
  select coalesce(jsonb_agg(jsonb_build_object(
    'offer_id', oo.id,
    'opportunity_id', oo.opportunity_id,
    'title', op.title,
    'amount', oo.offer_amount,
    'status', oo.status,
    'payment_method', oo.payment_method,
    'created_at', oo.created_at,
    'worker_name', (
      select p2.name from public.brigade_assignments ba
      join public.brigade_members bm2 on bm2.id = ba.member_id
      join public.profiles p2 on p2.id = bm2.profile_id
      where ba.brigade_id = p_brigade_id
        and ba.source_id = oo.opportunity_id::text
      order by ba.assigned_at desc limit 1
    ),
    'worker_status', (
      select ba.status from public.brigade_assignments ba
      where ba.brigade_id = p_brigade_id
        and ba.source_id = oo.opportunity_id::text
      order by ba.assigned_at desc limit 1
    )
  ) order by oo.created_at desc), '[]'::jsonb) into v_orders
  from public.opportunities_offers oo
  left join public.opportunities op on op.id = oo.opportunity_id
  where oo.brigade_id = p_brigade_id;

  -- Maliyyə (balans hərəkətləri + işçiyə köçürmələr)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'type', t.type,
    'amount', t.amount,
    'description', t.description,
    'created_at', t.created_at,
    'user_name', (select name from public.profiles where id = t.user_id)
  ) order by t.created_at desc), '[]'::jsonb) into v_finance
  from public.transactions t
  where t.related_id = p_brigade_id::text
  limit 200;

  -- Loglar (audit_log — şirkətə aid hər şey)
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) into v_logs
  from (
    select jsonb_build_object(
      'id', a.id,
      'action', a.action,
      'target_type', a.target_type,
      'created_at', a.created_at,
      'actor_name', (select name from public.profiles where id = a.actor),
      'payload', a.payload
    ) as x
    from public.audit_log a
    where a.target_id = p_brigade_id::text
       or a.payload->>'brigade_id' = p_brigade_id::text
    order by a.created_at desc
    limit 300
  ) s;

  return jsonb_build_object(
    'brigade', v_brigade,
    'members', v_members,
    'orders', v_orders,
    'finance', v_finance,
    'logs', v_logs
  );
end;
$$;

revoke execute on function public.admin_company_detail(uuid) from public, anon;
grant   execute on function public.admin_company_detail(uuid) to authenticated;


notify pgrst, 'reload schema';
