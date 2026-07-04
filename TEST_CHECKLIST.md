# Test Checklist - Complete Workflow

## Pre-Test Setup

- [ ] Migrations applied to Supabase
- [ ] support_user_id configured in platform_config
- [ ] Run `flutter clean && flutter pub get` (mobile)
- [ ] Run `npm install` (web)
- [ ] Have 2 devices/browsers ready (customer + provider)

---

## 1. Provider Registration Safety

### Flutter
- [ ] Create new provider account
- [ ] See "Provayder razılığı" checkbox on registration
- [ ] Try submit WITHOUT checking box → snackbar error
- [ ] Check box and submit → registration completes

### Web
- [ ] Go to /signup → select "Provayder" role
- [ ] See "Provayder razılığı" section
- [ ] Checkbox must be checked before submit button enables
- [ ] Test validation works

---

## 2. Customer Safety Warning (Before Accepting Bid)

### Flutter
- [ ] Create service request as customer
- [ ] Provider bids on request
- [ ] Customer sees bid offer
- [ ] Click "Qəbul et" → Safety dialog appears:
  - [ ] Title: "Təhlükəsizlik xəbərdarlığı"
  - [ ] Body: Warning about checking provider identity
  - [ ] 3 bullets visible
  - [ ] "Ləğv et" button cancels
  - [ ] "Başa düşdüm" proceeds to confirm

### Web (Not yet implemented in web)
- [ ] Similar dialog should appear

---

## 3. Job Completion Workflow

### 3a. Provider Submits Evidence (Flutter)

- [ ] Provider accepts job → "ongoing" status
- [ ] Provider taps "İşə bitir" button → JobCompletionScreen
- [ ] Take photos:
  - [ ] Camera button works
  - [ ] Gallery button works
  - [ ] Can add multiple photos
  - [ ] Can delete photos
- [ ] Draw signature:
  - [ ] Can write signature
  - [ ] Can clear signature
- [ ] Submit button:
  - [ ] Disabled until photos + signature present
  - [ ] Shows loading spinner while uploading
  - [ ] Uploads to "completion-evidence" bucket
  - [ ] Success snackbar shown
- [ ] Opportunity status changes to "pending_review"

### 3b. Admin Approves (Web)

- [ ] Admin goes to /Administrator/support → NO, wrong page
- [ ] Admin goes to /Administrator/job-completions
- [ ] Lists all pending completions
- [ ] Click "Bax" on completion
- [ ] Modal shows:
  - [ ] Job photos gallery (thumbnail navigation)
  - [ ] Customer signature image
  - [ ] Job amount, completion date
  - [ ] Provider name
- [ ] Click "Təsdiqlə":
  - [ ] Updates payout_status → "approved"
  - [ ] Calls release_offer_to_provider RPC
  - [ ] Provider balance increases by (amount - commission)
  - [ ] Opportunity status → "completed"
  - [ ] Success toast shown
  - [ ] Completion removed from list

### 3c. Verify Payment Released

- [ ] Provider balance increased:
  - [ ] Check /account/balance (Flutter)
  - [ ] Or /balance (Web customer) if provider
- [ ] Check transactions log shows:
  - [ ] "escrow_release"
  - [ ] Commission deduction
  - [ ] Bonus earning (if configured)

---

## 4. Provider Map Screen - No Customer Button

### Flutter
- [ ] Provider in active job (ongoing status)
- [ ] Action panel shows:
  - [ ] ✅ "Provider tamamlası buton var" (Provider can finish)
  - [ ] ❌ "Customer bitir düymə YOK" (No customer button)
  - [ ] This prevents customer from bypassing admin approval

### When pending_review status
- [ ] Shows "Admin nəzərdən keçirir"
- [ ] No action buttons visible
- [ ] Waiting message shown

---

## 5. Support Chat (24/7)

### Flutter User Side
- [ ] Profile → Settings → Support (or bottom button)
- [ ] Opens SupportChatScreen
- [ ] Type message and send
- [ ] Message appears on admin side

### Web User Side
- [ ] Go to /support
- [ ] Opens SupportChat component
- [ ] Type message
- [ ] Real-time sync

### Web Admin Side
- [ ] Go to /Administrator/support
- [ ] Lists all user conversations
- [ ] Click conversation
- [ ] See message history
- [ ] Type reply
- [ ] User gets message in real-time

---

## 6. Safety Features - Web Customer

### AcceptOfferModal
- [ ] Customer clicks accept offer
- [ ] Modal shows:
  - [ ] Amber safety box warning about checking provider identity
  - [ ] Checkbox: "Anladım, davam edirəm"
  - [ ] Confirm button DISABLED until checkbox checked
  - [ ] After checking box, button ENABLED

### MyOpportunities
- [ ] Bid cards show amber safety banner
- [ ] "pending_review" status shows proper message
- [ ] Mark complete button only shows for accepted offers (not pending_review)

---

## 7. Edge Cases & Validation

- [ ] Cannot accept offer with same email (provider == customer)
- [ ] Cannot complete job twice
- [ ] Admin approval without evidence shows error
- [ ] Support conversation creates automatically on first message
- [ ] Multiple bids on same opportunity work correctly
- [ ] Commission correctly deducted from locked balance

---

## 8. Performance & UX

- [ ] Job completion photos upload without timeout
- [ ] Admin panel loads list quickly (< 2s)
- [ ] Support messages sync in real-time (< 1s)
- [ ] No duplicate messages on refresh
- [ ] Navigation between pages smooth

---

## 9. Database Integrity Checks

```sql
-- Run in Supabase SQL Editor

-- Check opportunity statuses
SELECT status, COUNT(*) FROM public.opportunities 
GROUP BY status;

-- Check offer payouts
SELECT payout_status, COUNT(*) FROM public.opportunities_offers 
GROUP BY payout_status;

-- Check provider wallets
SELECT provider_id, balance, locked_balance 
FROM public.provider_wallets 
LIMIT 5;

-- Check conversations
SELECT COUNT(*) FROM public.conversations 
WHERE opportunity_id IS NULL; -- Support chats
```

---

## 10. Error Scenarios

- [ ] Network disconnection during upload → retry works
- [ ] Invalid photo format → error message
- [ ] Missing signature → snackbar error
- [ ] Admin rejects (future feature) → proper error handling
- [ ] Support user not configured → clear error message

---

## Sign-Off

- [ ] All safety features working
- [ ] Payment release working
- [ ] Support chat working
- [ ] No data integrity issues
- [ ] Performance acceptable

**Tested by**: _______________  
**Date**: _______________  
**Issues found**: _______________