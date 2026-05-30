# Next Steps - Action Plan

## 🎯 What's Done

✅ Code for all features written  
✅ Migrations created  
✅ Routes configured  
✅ UI/UX complete  

**What's left**: 2 steps

---

## Step 1️⃣: Apply Migrations to Supabase

### Quick Option (If using Supabase CLI)
```bash
cd /Users/nesrullazadeasif/project
supabase push
```

### Manual Option (SQL Editor)
1. Go to: https://app.supabase.com/projects
2. Select your project
3. Click "SQL Editor" → "New Query"
4. Copy-paste these migrations **in this exact order**:

```
MIGRATION #1: 20260526_chat_messaging.sql (if doesn't exist)
MIGRATION #2: 20260526_support_chat.sql
MIGRATION #3: 20260529_completion_evidence.sql
MIGRATION #4: 20260529_status_transition_pending_review.sql
MIGRATION #5: 20260529_fix_constraints.sql
MIGRATION #6: 20260529_fix_fk_provider.sql
MIGRATION #7: 20260529_admin_approval_workflow.sql (LAST)
```

Files located in: `/Users/nesrullazadeasif/project/supabase/migrations/`

---

## Step 2️⃣: Configure Support Admin User

After migrations apply, run in Supabase SQL Editor:

### Find Admin User
```sql
SELECT id, email FROM auth.users 
WHERE email LIKE '%admin%' 
   OR email LIKE '%@ellit%'
LIMIT 5;
```

Copy the admin's UUID (the `id` field)

### Set Support User
```sql
UPDATE public.platform_config 
SET value = '"PASTE_ADMIN_UUID_HERE"'::jsonb 
WHERE key = 'support_user_id';
```

Example:
```sql
UPDATE public.platform_config 
SET value = '"a1b2c3d4-e5f6-7890-abcd-ef1234567890"'::jsonb 
WHERE key = 'support_user_id';
```

### Verify
```sql
SELECT value FROM public.platform_config 
WHERE key = 'support_user_id';
```

Should return: `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"` (with quotes)

---

## Step 3️⃣ (Optional): Create Storage Bucket

If "completion-evidence" bucket doesn't exist:

1. Supabase Dashboard → Storage
2. Click "New Bucket"
3. Name: `completion-evidence`
4. Make Public: YES
5. Create

---

## 🧪 Quick Test

After migrations applied:

### Test 1: Provider Registration (Flutter/Web)
```
1. Create new provider account
2. When registering, check provider safety checkbox
3. Submit should work only WITH checkbox
```

### Test 2: Job Completion
```
1. Provider accepts job
2. Provider taps "İşə bitir"
3. Upload photos + signature
4. Status becomes "pending_review"
```

### Test 3: Admin Approval
```
1. Go to: /Administrator/job-completions
2. See pending completions
3. Click "Bax" → view evidence
4. Click "Təsdiqlə"
5. Check provider balance increased
```

### Test 4: Support Chat
```
1. User: Go to /support
2. Type message
3. Admin: Go to /Administrator/support
4. See conversation, reply
5. User sees reply in real-time
```

---

## 📝 Complete Checklists

### Migration Checklist
📄 See: `MIGRATION_CHECKLIST.md`

### Testing Checklist  
📄 See: `TEST_CHECKLIST.md`

### Implementation Summary
📄 See: `IMPLEMENTATION_SUMMARY.md`

---

## 🎯 One-Line Summary

**All code done. Just run migrations + set support_user_id = admin_uuid. Then test.**

---

## ❓ Troubleshooting

### "Function not found" error
→ Make sure you ran migration #7 (admin_approval_workflow.sql) LAST

### Support chat not working
→ Check support_user_id is set in platform_config with correct UUID

### Locked balance not releasing
→ Make sure migration #7 was applied (recreates the function)

### Photos won't upload
→ Create "completion-evidence" storage bucket in Supabase

---

## 📊 Status

| Task | Status | Files |
|------|--------|-------|
| Provider safety | ✅ Done | register.dart, Signup.tsx |
| Customer safety | ✅ Done | waiting_for_offers_screen.dart, AcceptOfferModal.tsx |
| Job completion flow | ✅ Done | job_completion_screen.dart, JobCompletionsPage.tsx |
| Admin approval | ✅ Done | JobCompletionsPage.tsx |
| Support chat | ✅ Done | support_chat_screen.dart, SupportChat.tsx, SupportPage.tsx |
| Migrations | ⏳ Pending | 7 SQL files in migrations/ |
| Config | ⏳ Pending | Set support_user_id |
| Testing | ⏳ Pending | See TEST_CHECKLIST.md |

---

## Next Action

👉 **Run migrations to Supabase**

```bash
supabase push
# OR manually apply in SQL Editor
```

Then set support_user_id, then test.

Done! 🎉