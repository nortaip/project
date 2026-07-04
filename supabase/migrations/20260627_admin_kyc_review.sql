-- ============================================================================
-- Admin KYC yoxlaması: siyahı + təsdiq/imtina RPC-ləri
-- provider_verifications RLS "own kyc read" olduğundan admin birbaşa oxuya
-- bilmir → security definer RPC. Yeniləmə də bloklanıb → RPC ilə.
-- ============================================================================

-- Storage: KYC şəkillərini bütün admin rolları görə bilsin (signed URL üçün)
drop policy if exists "kyc read admin only" on storage.objects;
create policy "kyc read admin only" on storage.objects
  for select using (
    bucket_id = 'kyc-documents'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and lower(coalesce(profiles.role,'')) = any (array['admin','support','master','superadmin'])
    )
  );

create or replace function public._require_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
  ) then raise exception 'Forbidden: admin only'; end if;
end;
$$;

create or replace function public.admin_kyc_list(p_status text default null)
returns jsonb
language plpgsql security definer set search_path = public stable
as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(row order by row_created desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', v.id, 'provider_id', v.provider_id,
      'full_name_on_id', v.full_name_on_id, 'id_number', v.id_number,
      'birth_date', v.birth_date, 'status', v.status,
      'rejection_reason', v.rejection_reason, 'admin_notes', v.admin_notes,
      'is_renewal', v.is_renewal, 'created_at', v.created_at, 'reviewed_at', v.reviewed_at,
      'id_front_path', v.id_front_path, 'id_back_path', v.id_back_path, 'selfie_path', v.selfie_path,
      'provider_name', p.name, 'provider_email', p.email,
      'provider_phone', p.phone_number, 'provider_avatar', p.avatar_url
    ) as row,
    v.created_at as row_created
    from public.provider_verifications v
    left join public.profiles p on p.id = v.provider_id
    where p_status is null or p_status = 'all' or v.status = p_status
  ) s;
  return v_out;
end;
$$;

create or replace function public.admin_kyc_review(
  p_id uuid, p_approve boolean, p_reason text default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_caller uuid := auth.uid(); v_rec record;
begin
  perform public._require_admin();
  select * into v_rec from public.provider_verifications where id = p_id;
  if v_rec.id is null then raise exception 'KYC tapılmadı'; end if;

  if p_approve then
    update public.provider_verifications
       set status='approved', rejection_reason=null, admin_notes=p_notes,
           reviewed_by=v_caller, reviewed_at=now(), updated_at=now()
     where id=p_id;
    update public.profiles set is_verified=true where id=v_rec.provider_id;
  else
    if coalesce(trim(p_reason),'')='' then raise exception 'İmtina səbəbi tələb olunur'; end if;
    update public.provider_verifications
       set status='rejected', rejection_reason=p_reason, admin_notes=p_notes,
           reviewed_by=v_caller, reviewed_at=now(), updated_at=now()
     where id=p_id;
  end if;

  begin
    insert into public.notifications (user_id, title, body, kind, related_id, link)
    values (v_rec.provider_id,
      case when p_approve then 'Kimlik təsdiqləndi' else 'Kimlik yoxlaması rədd edildi' end,
      case when p_approve then 'Profiliniz təsdiqli nişanı aldı.' else coalesce(p_reason,'Sənədləri yenidən yükləyin.') end,
      'kyc_review', p_id::text, '/account');
  exception when others then null;
  end;

  begin
    insert into public.audit_log (actor, action, target_type, target_id, payload)
    values (v_caller, case when p_approve then 'kyc_approve' else 'kyc_reject' end,
            'provider_verification', p_id::text,
            jsonb_build_object('provider_id', v_rec.provider_id, 'reason', p_reason));
  exception when others then null;
  end;
end;
$$;

revoke execute on function public.admin_kyc_list(text) from public, anon;
revoke execute on function public.admin_kyc_review(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_kyc_list(text) to authenticated;
grant execute on function public.admin_kyc_review(uuid, boolean, text, text) to authenticated;
notify pgrst, 'reload schema';
