-- ============================================================================
-- Chat / Messaging sistemi (conversations + chat_messages cədvəlləri)
--
-- Qeyd: `messages` adı artıq başqa məqsədlə istifadə olunduğu üçün
-- bu sistem `chat_messages` adından istifadə edir.
-- ============================================================================

create table if not exists public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  opportunity_id         uuid references public.opportunities(id) on delete cascade,
  customer_id            uuid not null references auth.users(id) on delete cascade,
  provider_id            uuid not null references auth.users(id) on delete cascade,
  created_at             timestamptz not null default now(),
  last_message_at        timestamptz,
  last_message_preview   text,
  unique (opportunity_id, customer_id, provider_id)
);

create index if not exists conversations_customer_idx
  on public.conversations (customer_id, last_message_at desc nulls last);
create index if not exists conversations_provider_idx
  on public.conversations (provider_id, last_message_at desc nulls last);

create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid not null references auth.users(id) on delete cascade,
  body              text not null,
  attachments       text[],
  created_at        timestamptz not null default now(),
  read_at           timestamptz
);

create index if not exists chat_messages_conv_created_idx
  on public.chat_messages (conversation_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "conv read" on public.conversations;
create policy "conv read"
  on public.conversations for select
  using (auth.uid() = customer_id or auth.uid() = provider_id);

drop policy if exists "conv insert" on public.conversations;
create policy "conv insert"
  on public.conversations for insert
  with check (auth.uid() = customer_id or auth.uid() = provider_id);

drop policy if exists "conv update" on public.conversations;
create policy "conv update"
  on public.conversations for update
  using (auth.uid() = customer_id or auth.uid() = provider_id);

drop policy if exists "chat_msg read" on public.chat_messages;
create policy "chat_msg read"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
    )
  );

drop policy if exists "chat_msg insert" on public.chat_messages;
create policy "chat_msg insert"
  on public.chat_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
    )
  );

drop policy if exists "chat_msg mark read" on public.chat_messages;
create policy "chat_msg mark read"
  on public.chat_messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
        and auth.uid() <> chat_messages.sender_id
    )
  );

create or replace function public._touch_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.body, 120)
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_conv on public.chat_messages;
create trigger chat_messages_touch_conv
  after insert on public.chat_messages
  for each row execute function public._touch_conversation_after_message();

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
  on conflict (opportunity_id, customer_id, provider_id)
  do update set last_message_at = public.conversations.last_message_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_conversation(uuid, uuid) from public, anon;
grant   execute on function public.open_conversation(uuid, uuid) to authenticated;

-- Realtime publication — chat_messages və conversations
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

notify pgrst, 'reload schema';
