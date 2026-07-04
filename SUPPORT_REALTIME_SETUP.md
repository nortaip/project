# Support Chat - Real-Time + All Admins Setup

## New Feature

✅ **Hər admin dəstəyi görsün** - Single support_user_id deyil  
✅ **Real-time mesajlar** - Instant updates without refresh  
✅ **Generic support user** - Placeholder account for conversations  

---

## Setup Steps

### Step 1: Create Support User in Supabase Auth

1. Go to: https://app.supabase.com → Authentication → Users
2. Click "Add User"
3. Fill:
   - **Email**: `support@ellit.az` (or any email)
   - **Password**: [strong password]
   - **Auto confirm**: YES
4. Click "Create User"
5. Copy the **User ID** (UUID)

Example: `550e8400-e29b-41d4-a716-446655440000`

---

### Step 2: Apply Migration

**SQL Editor-da çalışdır**:
```bash
# OR manually in SQL Editor
supabase push
```

Migration: `20260531_support_for_all_admins.sql`

This updates:
- ✅ RLS policies (all admins can see support conversations)
- ✅ Real-time configuration
- ✅ Support user placeholder UUID

---

### Step 3: Set Support User UUID

**SQL Editor-da**:
```sql
UPDATE public.platform_config 
SET value = '"550e8400-e29b-41d4-a716-446655440000"'::jsonb 
WHERE key = 'support_user_id';
```

Replace UUID with the one from Step 1!

---

### Step 4: Enable Real-Time (Supabase Dashboard)

1. Go to: Database → Replication
2. Enable replication for these tables:
   - ✅ `conversations`
   - ✅ `chat_messages`

(Usually already enabled, but verify)

---

## How It Works

### User Opens Support
1. User → /support or Profile → Dəstək
2. Calls `open_support_conversation()`
3. Creates conversation with:
   - customer_id = user's ID
   - provider_id = support@ellit.az UUID
   - opportunity_id = NULL (marks as support)

### Admin Views Support
1. Admin → /Administrator/support
2. Sees **ALL** support conversations (not filtered)
3. Opens conversation → sees messages in real-time
4. Types reply → appears instantly for user

### Real-Time Magic
- User types → admin sees **instantly**
- Admin replies → user sees **instantly**
- New conversations appear in list **without refresh**
- New messages appear **without refresh**

No polling, no delays. True real-time via Supabase Realtime!

---

## Architecture

```
USER TYPES MESSAGE
    ↓
chat_messages INSERT
    ↓
Supabase Realtime event
    ↓
ADMIN SEES INSTANTLY
(no refresh needed)

SAME FOR ADMIN REPLIES → USER SEES INSTANTLY
```

---

## Testing

### Test 1: User Can Open Support
```
1. Flutter: Profile → Dəstək
2. Web: /support
3. Should open chat (no error)
```

### Test 2: Admin Can See All Conversations
```
1. Go to /Administrator/support
2. Should list all support conversations
3. No filtering by admin role
```

### Test 3: Real-Time Messages
```
1. User types message in one browser
2. Admin looks in another browser
3. Message appears INSTANTLY (no refresh)
4. Admin replies
5. User sees reply INSTANTLY
```

### Test 4: Multiple Admins
```
1. Two admins open same conversation
2. First admin replies
3. Both see message instantly
```

---

## Troubleshooting

### "No support conversations" error
→ Check support_user_id is set correctly

### Messages don't appear instantly
→ Check Realtime is enabled in Supabase Dashboard
→ Check browser console for subscription errors

### Admin can't see conversations
→ Check user role = 'admin' in profiles table
→ Check RLS policies applied (migration #20260531)

### "Foreign key constraint" error
→ Support user UUID doesn't exist in auth.users
→ Create support user first, then set UUID

---

## Files Changed

- `supabase/migrations/20260531_support_for_all_admins.sql` ← NEW
- `src/MasterAdmin/SupportPage.tsx` ← Real-time subscriptions added
- `src/pages/SupportChat.tsx` ← Real-time subscriptions added

---

## Benefits

🚀 **All admins share support load** - No single point of contact  
⚡ **Real-time** - No refresh needed  
📱 **Mobile friendly** - Works on Flutter + Web  
🔒 **Secure** - RLS policies enforce permissions  

---

## Next

1. Create support user (Step 1)
2. Apply migration (Step 2)
3. Set UUID (Step 3)
4. Enable Realtime (Step 4)
5. Test!

**Done!** 🎉