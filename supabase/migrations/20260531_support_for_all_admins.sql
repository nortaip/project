-- Support chat for ALL admins (not single support_user_id)
-- Real-time updates: any admin can see & reply to support conversations

-- 1. Create generic "support" user if doesn't exist
-- This is a placeholder user for support conversations
-- All admins can see conversations linked to this user

-- Insert into platform_config: generic support user UUID
-- NOTE: Run this AFTER creating the support user in Supabase Auth Dashboard
insert into public.platform_config (key, value, description)
values (
  'support_user_id',
  '"00000000-0000-0000-0000-000000000001"'::jsonb,
  'Generic support user UUID (placeholder, set to real support user after creation)'
)
on conflict (key) do nothing;

-- 2. Update RLS policies to allow ANY ADMIN to read support conversations
-- Remove old restrictive policy
drop policy if exists "conv read" on public.conversations;

-- New policy: Users can read their own conversations + admins can read all
create policy "conv read"
  on public.conversations for select
  using (
    -- User can read their own conversations
    (auth.uid() = customer_id or auth.uid() = provider_id)
    or
    -- Any admin can read all conversations (for support)
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'master', 'superadmin')
    )
  );

-- 3. Update chat_messages RLS to allow admins to read/write
drop policy if exists "chat_msg read" on public.chat_messages;
create policy "chat_msg read"
  on public.chat_messages for select
  using (
    -- Conversation participants can read
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
    )
    or
    -- Admins can read all messages (for support)
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'master', 'superadmin')
    )
  );

drop policy if exists "chat_msg insert" on public.chat_messages;
create policy "chat_msg insert"
  on public.chat_messages for insert
  with check (
    auth.uid() = sender_id
    and (
      -- Conversation participants can send
      exists (
        select 1 from public.conversations c
        where c.id = chat_messages.conversation_id
          and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
      )
      or
      -- Admins can send messages to support conversations
      exists (
        select 1 from public.conversations c
        where c.id = chat_messages.conversation_id
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin', 'master', 'superadmin')
          )
      )
    )
  );

-- 4. Enable real-time for support conversations
-- Make sure replication is enabled for conversations and chat_messages tables
-- (This is done in Supabase Dashboard, but document it here)

notify pgrst, 'reload schema';
