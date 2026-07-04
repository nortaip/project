# Migration Checklist - May 30, 2026

## Critical Migrations (MUST APPLY)

### 1. **20260529_admin_approval_workflow.sql** ⚠️ CRITICAL
**Why**: Fixes payment release for card payments after admin approval
**What it does**:
- Recreates `release_offer_to_provider()` RPC function
- Allows admin approval of pending_review jobs
- Fixes locked balance → account balance transfer

**Status**: Created, not yet applied

**Apply**: 
```bash
supabase push  # OR manually in SQL Editor
```

---

### 2. **20260529_status_transition_pending_review.sql** ⚠️ CRITICAL
**Why**: Enables pending_review status transitions
**What it does**:
- Updates opportunity status validation trigger
- Allows: ongoing → pending_review → completed
- Required for admin approval workflow

**Status**: Created, not yet applied

---

### 3. **20260529_completion_evidence.sql** ⚠️ CRITICAL
**Why**: Stores job completion photos and signatures
**What it does**:
- Adds `completion_photos`, `customer_signature_url` columns to opportunities_offers
- Adds `payout_status` check constraint
- Adds `admin_approved_at`, `admin_approved_by` fields

**Status**: Created, not yet applied

---

### 4. **20260526_support_chat.sql**
**Why**: Enables 24/7 support chat between users and admin
**What it does**:
- Creates RPC: `open_support_conversation()`
- Sets up support_user_id in platform_config
- Adds unique index for support conversations (opportunity_id = NULL)

**Status**: Likely applied, verify exists

**Requires**: 
- `20260526_chat_messaging.sql` (must run first)

---

### 5. **20260529_fix_constraints.sql**
**Why**: Foreign keys and status constraints
**What it does**:
- Adds FK: opportunities_offers.opportunity_id → opportunities.id
- Updates status check constraint to include: pending_review, rejected

**Status**: Created, not yet applied

---

### 6. **20260529_fix_fk_provider.sql**
**Why**: Missing provider foreign key
**What it does**:
- Adds FK: opportunities_offers.provider_id → profiles.id

**Status**: Created, not yet applied

---

## Configuration Required

### 1. Set Support Admin User
```sql
-- Find admin user ID
SELECT id, email FROM auth.users WHERE role = 'admin' LIMIT 1;

-- Update platform_config
UPDATE public.platform_config 
SET value = '"<ADMIN_UUID_HERE>"'::jsonb 
WHERE key = 'support_user_id';
```

---

## Application Order

**MUST follow this order:**

1. ✅ `20260526_chat_messaging.sql` (prerequisite)
2. ✅ `20260526_support_chat.sql` 
3. ⚠️ `20260529_completion_evidence.sql` 
4. ⚠️ `20260529_status_transition_pending_review.sql`
5. ⚠️ `20260529_fix_constraints.sql`
6. ⚠️ `20260529_fix_fk_provider.sql`
7. ⚠️ `20260529_admin_approval_workflow.sql` (LAST - recreates functions)

---

## How to Apply

### Option A: CLI (Recommended)
```bash
cd /Users/nesrullazadeasif/project
supabase push
```

### Option B: Manual (Supabase Dashboard)
1. Go to: https://app.supabase.com → Select project
2. Click "SQL Editor" → "New Query"
3. Copy content from each migration file
4. Execute in order
5. Verify no errors

---

## Post-Application Checks

```sql
-- Check support_user_id is set
SELECT value FROM public.platform_config WHERE key = 'support_user_id';

-- Check function exists
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'release_offer_to_provider';

-- Check columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'opportunities_offers' 
AND column_name IN ('completion_photos', 'payout_status', 'admin_approved_at');
```

---

## Rollback (if needed)

If something breaks, contact Supabase support or revert migrations:
```sql
-- Drop new functions
DROP FUNCTION IF EXISTS public.release_offer_to_provider(uuid) CASCADE;

-- Remove new columns
ALTER TABLE opportunities_offers DROP COLUMN IF EXISTS completion_photos;
ALTER TABLE opportunities_offers DROP COLUMN IF EXISTS payout_status;
```

---

## Testing After Migration

See `TEST_CHECKLIST.md` for complete workflow tests.