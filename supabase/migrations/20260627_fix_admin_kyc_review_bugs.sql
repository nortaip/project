-- FIX: admin_kyc_review buqları
--  1) profiles.verification_status təyin olunmurdu (yalnız is_verified) →
--     app verification_status-a baxırsa təsdiq tam işləmirdi
--  2) trg_notify_kyc_decision trigger-i onsuz da bildiriş göndərir →
--     funksiyadakı əl ilə bildiriş İKİQAT olurdu (silindi)
--  3) reject zamanı is_verified=false + verification_status='rejected'
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
           reviewed_by=v_caller, reviewed_at=now()
     where id=p_id;
    update public.profiles
       set is_verified=true, verification_status='approved'
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
$$;
notify pgrst, 'reload schema';
