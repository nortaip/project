# Support Admin UUID Fix

## Problem
```
PostgrestException: Key (provider_id)=(00000000-0000-0000-0000-000000000000) 
is not present in table "users"
```

Support admin UUID hələ default (all zeros) dəyərdir. Bu UUID auth.users cədvəlində yoxdur.

---

## Fix

### Step 1: Supabase Dashboard-da SQL Editor aç
https://app.supabase.com → SQL Editor

### Step 2: Admin user UUID-ni tap
```sql
SELECT id, email, raw_user_meta_data 
FROM auth.users 
WHERE email LIKE '%admin%' 
   OR raw_user_meta_data->>'role' = 'admin'
LIMIT 5;
```

Nəticədən **id** sütununu kopyala (məsələn: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

### Step 3: platform_config-u güncəllə
```sql
UPDATE public.platform_config 
SET value = '"a1b2c3d4-e5f6-7890-abcd-ef1234567890"'::jsonb 
WHERE key = 'support_user_id';
```

**DİQQƏT**: UUID-i tırnak daxilində qoy (`"..."`)

### Step 4: Verify
```sql
SELECT value FROM public.platform_config 
WHERE key = 'support_user_id';
```

Should show: `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"` (tırnaqlar daxilində)

---

## Admin User Yoxdursa

Yeni admin user yarat:

```sql
-- Supabase Admin Panel istifadə edər
-- Authentication → Users → Add User
-- Email: admin@ellit.az
-- Password: [strong password]
```

Sonra tapdığın UUID-i istifadə et.

---

## Sonra
✅ User support açıqlamağa cəhd et → işləməsi lazım

Support chat açılacaq!