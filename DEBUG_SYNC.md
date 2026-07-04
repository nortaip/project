# Debug Support Chat Sync

## Problem
Mobile yazır → Web admin görmür (sync işləmir)

## Root Cause Fixed ✅
Real-time subscription-da sender profil məlumatı yoxdu.

**Before**: `payload.new.sender_name` = undefined  
**After**: Profil sorgusundan sender_name alınır

---

## Test Sync (3 Browser)

### Setup
- **Browser 1**: Mobile (Chrome mobile view) - User support
- **Browser 2**: Admin panel - Support page
- **Browser 3**: Browser DevTools console (debug)

### Test Steps

#### 1. Open Browsers
```
1. User: http://localhost:5173/support
2. Admin: http://localhost:5173/Administrator/support
3. Keep both visible side-by-side
```

#### 2. User Types Message
```
Mobile: Salam admin! 
Click send
```

#### 3. Check Admin Panel
```
Should see message appear INSTANTLY
(no refresh needed)
```

#### 4. Admin Replies
```
Admin: Salam! Sən necəsən?
Click send
```

#### 5. Check Mobile
```
Should see admin reply INSTANTLY
```

---

## If Not Working - Debug

### Check 1: Real-Time Enabled?
Supabase Dashboard → Database → Replication
- ✅ `conversations` - ENABLED?
- ✅ `chat_messages` - ENABLED?

If not enabled, enable them!

### Check 2: Support User UUID Correct?
```sql
SELECT value FROM public.platform_config 
WHERE key = 'support_user_id';
```

Should return UUID like: `"550e8400-e29b-41d4-a716-446655440000"`

If shows: `"00000000-0000-0000-0000-000000000000"` → WRONG!
Fix: Set correct support user UUID

### Check 3: Browser Console
**Check for errors**:
1. Open DevTools → Console (F12)
2. Send message
3. Look for errors
4. Check network tab

### Check 4: Database Level
```sql
-- Check if message inserted
SELECT * FROM public.chat_messages 
ORDER BY created_at DESC 
LIMIT 5;

-- Check conversation
SELECT id, last_message_at, last_message_preview 
FROM public.conversations 
WHERE opportunity_id IS NULL 
LIMIT 5;
```

### Check 5: RLS Policies
Admin should be able to read all support conversations:
```sql
SELECT * FROM public.conversations 
WHERE opportunity_id IS NULL;
-- Should return rows
```

---

## Common Issues

### "Mesaj görmür"
**Check**: Real-time enabled in Supabase Dashboard

### "Mesaj yazıldı ama admin görmür"
**Check**: Support user UUID doğru mu?
```sql
SELECT value FROM public.platform_config WHERE key = 'support_user_id';
```

### "Mesajlar duplicate görünür"
**Check**: Refresh the page, clear local cache
```
Ctrl+Shift+Delete → Clear browsing data
```

### "Subscription error" console-da
**Check**: 
1. User authenticated?
2. Real-time permissions correct?
3. No RLS policy blocking?

---

## Force Sync Test

If real-time not working, manual refresh works:
```
Admin: Press F5 to refresh
Mobile: Pull down to refresh
```

If messages appear after refresh → Real-time is broken
If messages don't appear → Database issue

---

## Code Changes Made

**SupportPage.tsx**:
- Added async sender fetch in real-time callback
- Messages now have proper sender_name

**SupportChat.tsx**:
- Real-time payload properly formatted
- Consistent with initial message format

---

## Expected Behavior

| Action | Time | Visible |
|--------|------|---------|
| User types | 0ms | - |
| Message sent | 100ms | User sees checkmark |
| DB insert | 150ms | - |
| Real-time event | 200ms | Admin sees message |
| User sees admin reply | 250ms | User sees message |

**Total latency**: ~250ms (local network)

---

## Test Checklist

- [ ] Real-time enabled in Supabase
- [ ] Support user UUID set correctly
- [ ] Mobile can open support (no FK error)
- [ ] Admin can see all conversations
- [ ] User message appears in admin in < 1s
- [ ] Admin reply appears on mobile in < 1s
- [ ] Multiple admins can see same conversation
- [ ] New conversations appear instantly

---

## Still Not Working?

Run this in Supabase SQL Editor:

```sql
-- Verify setup
SELECT 'Config' as check_type, value as result 
FROM public.platform_config WHERE key = 'support_user_id'
UNION ALL
SELECT 'Chat messages count', COUNT(*)::text 
FROM public.chat_messages
UNION ALL
SELECT 'Support convs count', COUNT(*)::text 
FROM public.conversations WHERE opportunity_id IS NULL;
```

Results show if data is there.

Contact support if still broken!