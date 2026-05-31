-- ============================================================================
-- Fix: open_conversation ON CONFLICT clause mismatch
-- ============================================================================
-- Səbəb: 20260531_support_categories.sql conversations_unique_pair index-ini
-- dəyişdirdi (artıq `support_general` formatı istifadə edir), amma
-- `open_conversation` RPC köhnə `'support'` formatlı ON CONFLICT-ə müraciət
-- edir → 42P10 xətası: "no unique or exclusion constraint matching".

create or replace function public.open_conversation(
  p_opportunity_id uuid,
  p_peer_id        uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_customer uuid;
  v_provider uuid;
  v_id       uuid;
  v_opp_creator uuid;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select created_by into v_opp_creator
    from public.opportunities where id = p_opportunity_id;
  if v_opp_creator is null then raise exception 'Opportunity not found'; end if;

  if v_caller = v_opp_creator then
    v_customer := v_caller;
    v_provider := p_peer_id;
  else
    v_customer := v_opp_creator;
    v_provider := v_caller;
  end if;

  if v_caller <> v_customer and v_caller <> v_provider then
    raise exception 'Forbidden';
  end if;

  insert into public.conversations (opportunity_id, customer_id, provider_id)
  values (p_opportunity_id, v_customer, v_provider)
  on conflict (
    coalesce(opportunity_id::text, 'support_' || coalesce(category, 'general')),
    customer_id,
    provider_id
  )
  do update set last_message_at = public.conversations.last_message_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_conversation(uuid, uuid) from public, anon;
grant   execute on function public.open_conversation(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
