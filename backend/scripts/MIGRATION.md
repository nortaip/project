# Supabase → öz PostgreSQL köçürmə planı (Faza 1-2)

## 1. Sxem + data dump (Supabase-dən)
```bash
# Connection string: Supabase Dashboard → Settings → Database → Connection string (direct)
pg_dump "$SUPABASE_DB_URL" \
  --schema=public --no-owner --no-privileges \
  -F c -f ellit_public.dump

# Auth istifadəçiləri (email + bcrypt hash-lər):
pg_dump "$SUPABASE_DB_URL" \
  --schema=auth --table=auth.users --no-owner --no-privileges \
  -F c -f ellit_auth_users.dump
```

## 2. Yeni bazaya import
```bash
pg_restore -d "$NEW_DB_URL" --no-owner ellit_public.dump
```

## 3. Auth köçürməsi (Faza 2 skripti)
`scripts/migrate_auth_users.py`:
  - auth.users → users cədvəli (id → legacy_supabase_id, email, encrypted_password → password_hash)
  - bcrypt hash-lər olduğu kimi saxlanır — istifadəçi ilk login-də
    şəffaf şəkildə Argon2-yə keçirilir (security.py bunu edir)
  - identities → oauth_identities (google/apple sub-ları)

## 4. RPC-lərin API-yə köçürülməsi (Faza 3-4 xəritəsi)
| Supabase RPC | Yeni API endpoint |
|---|---|
| accept_offer_with_payment | POST /api/v1/offers/{id}/accept |
| release_offer_to_provider | POST /api/v1/offers/{id}/complete |
| cancel_opportunity        | POST /api/v1/opportunities/{id}/cancel |
| brigade_place_offer       | POST /api/v1/brigades/{id}/offers |
| brigade_dispatch_order    | POST /api/v1/brigades/{id}/dispatch |
| submit_kyc / renewal      | POST /api/v1/kyc/... |
| open_conversation         | POST /api/v1/chat/conversations |

## 5. Storage
Supabase Storage bucket-ları → MinIO/R2 (rclone ilə):
```bash
rclone copy supabase-s3:avatars minio:ellit/avatars
```
