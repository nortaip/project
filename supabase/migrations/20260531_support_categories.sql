-- ============================================================================
-- Support chat categorization: per-category conversations + user role tagging
-- ============================================================================
-- Adds:
--   1. conversations.category   text (e.g. 'order','payment','kyc','complaint','provider','general')
--   2. conversations.user_role  text ('customer' | 'provider') — who initiated support
--   3. Rebuilt unique index so each user can have one conversation PER category
--   4. RPC open_support_conversation(p_category, p_user_role) — idempotent

alter table public.conversations
  add column if not exists category  text,
  add column if not exists user_role text;

create index if not exists conversations_category_idx
  on public.conversations (category)
  where opportunity_id is null;

create index if not exists conversations_user_role_idx
  on public.conversations (user_role)
  where opportunity_id is null;

-- Rebuild unique index to allow multiple support conversations per user
-- (one per category). For peer chats (opportunity_id NOT NULL), category is ignored.
drop index if exists conversations_unique_pair;
create unique index conversations_unique_pair
  on public.conversations (
    coalesce(opportunity_id::text, 'support_' || coalesce(category, 'general')),
    customer_id,
    provider_id
  );

-- ── Updated RPC ─────────────────────────────────────────────────────────
drop function if exists public.open_support_conversation();
drop function if exists public.open_support_conversation(text, text);

create or replace function public.open_support_conversation(
  p_category  text default 'general',
  p_user_role text default 'customer'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_support uuid;
  v_id      uuid;
  v_raw     text;
  v_cat     text := coalesce(nullif(trim(p_category),  ''), 'general');
  v_role    text := coalesce(nullif(trim(p_user_role), ''), 'customer');
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_role not in ('customer','provider') then
    raise exception 'Invalid user_role: %', v_role;
  end if;
  if v_cat not in ('general','order','payment','kyc','provider') then
    raise exception 'Invalid category: %', v_cat;
  end if;

  select value::text into v_raw
    from public.platform_config where key = 'support_user_id';
  if v_raw is null then
    raise exception 'Support agent not configured';
  end if;
  v_support := trim(both '"' from v_raw)::uuid;

  if v_caller = v_support then
    raise exception 'Cannot open support chat with yourself';
  end if;

  insert into public.conversations (opportunity_id, customer_id, provider_id, category, user_role)
  values (null, v_caller, v_support, v_cat, v_role)
  on conflict (coalesce(opportunity_id::text, 'support_' || coalesce(category, 'general')), customer_id, provider_id)
  do update set
    last_message_at = public.conversations.last_message_at,
    user_role       = excluded.user_role
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_support_conversation(text, text) from public, anon;
grant   execute on function public.open_support_conversation(text, text) to authenticated;

notify pgrst, 'reload schema';
