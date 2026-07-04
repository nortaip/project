-- Debug Support Chat Sync Issue
-- Run this in Supabase SQL Editor to diagnose the problem

-- 1. Check if support_user_id is set correctly
SELECT 'STEP 1: Support User Config' as step;
SELECT key, value FROM public.platform_config
WHERE key = 'support_user_id';

-- If value shows "00000000-0000-0000-0000-000000000000" → WRONG!
-- Set correct UUID:
-- UPDATE public.platform_config
-- SET value = '"REAL_ADMIN_UUID"'::jsonb
-- WHERE key = 'support_user_id';

---

-- 2. Check if conversations exist
SELECT 'STEP 2: Existing Conversations' as step;
SELECT id, customer_id, provider_id, opportunity_id, created_at, last_message_at
FROM public.conversations
WHERE opportunity_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- If 0 rows → conversations not created
-- If rows exist → check if admin can see them (next step)

---

-- 3. Check if chat_messages exist
SELECT 'STEP 3: Chat Messages' as step;
SELECT COUNT(*) as total_messages,
       MIN(created_at) as first_message,
       MAX(created_at) as last_message
FROM public.chat_messages;

-- Also check messages for support conversations
SELECT msg.id, msg.sender_id, msg.body, msg.created_at, conv.id as conv_id
FROM public.chat_messages msg
LEFT JOIN public.conversations conv ON msg.conversation_id = conv.id
WHERE conv.opportunity_id IS NULL
ORDER BY msg.created_at DESC
LIMIT 10;

---

-- 4. Check support user exists in auth.users
SELECT 'STEP 4: Support User in Auth' as step;

-- Get the UUID from platform_config
WITH support_uuid AS (
  SELECT TRIM('"' FROM value::text)::uuid as uuid
  FROM public.platform_config
  WHERE key = 'support_user_id'
)
SELECT u.id, u.email, u.raw_user_meta_data
FROM auth.users u, support_uuid
WHERE u.id = support_uuid.uuid;

-- If 0 rows → UUID doesn't exist in auth.users → CREATE IT!

---

-- 5. Check admin user exists
SELECT 'STEP 5: Admin Users' as step;
SELECT id, email, raw_user_meta_data->>'role' as role
FROM auth.users
WHERE raw_user_meta_data->>'role' = 'admin'
LIMIT 5;

---

-- 6. Check RLS policies
SELECT 'STEP 6: RLS Policies on conversations' as step;
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'conversations'
ORDER BY policyname;

---

-- 7. Try to select conversations as admin
SELECT 'STEP 7: Admin Permissions' as step;

-- Check if there are any conversations visible
-- (This simulates what admin sees)
SELECT COUNT(*) as visible_conversations
FROM public.conversations
WHERE opportunity_id IS NULL;

---

-- 8. Check profiles table for role
SELECT 'STEP 8: Admin Profile' as step;
SELECT id, email, role
FROM public.profiles
WHERE role IN ('admin', 'master', 'superadmin')
LIMIT 5;

---

-- SOLUTION CHECKLIST

-- If STEP 2 shows 0 rows:
-- → Conversations not created
-- → Run on mobile: Profile → Dəstək → open chat
-- → This should create conversation
-- → Then rerun this debug SQL

-- If STEP 2 shows rows but admin sees nothing:
-- → RLS policy blocking access
-- → Check STEP 6 output
-- → Or support_user_id wrong (check STEP 1)

-- If STEP 4 shows 0 rows:
-- → Support user UUID doesn't exist
-- → Create new admin user or use existing admin UUID
-- → Update STEP 1 value

-- If STEP 7 shows 0:
-- → RLS blocking admin access
-- → Run this to fix RLS:

DROP POLICY IF EXISTS "conv read" ON public.conversations;
CREATE POLICY "conv read"
  ON public.conversations FOR SELECT
  USING (
    (auth.uid() = customer_id OR auth.uid() = provider_id)
    OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'superadmin')
    )
  );

NOTIFY pgrst, 'reload schema';

---

-- After fixing, test:
-- 1. Mobile: Send test message
-- 2. Admin: Refresh page (F5)
-- 3. Admin panel: Should see conversation