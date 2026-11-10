# Klient keçidi — Supabase çağırışları → yeni API

> **Qısa yol (tövsiyə olunan):** backend Supabase protokollarını özü təqdim
> edir (`/rest/v1`, `/auth/v1`, `/storage/v1`, `/realtime/v1`,
> `/functions/v1`). Klient kodu dəyişmir — veb-də `VITE_API_URL`, mobil-də
> `API_URL` yeni serverə yönəldilir. Aşağıdakı cədvəl klientləri gələcəkdə
> birbaşa `/api/v1` endpointlərinə keçirmək istəsəniz istinad üçündür.

Bütün endpointlər: `https://api.ellit.az/api/v1` (Authorization: Bearer <access_token>)

## Auth
| Köhnə (Supabase) | Yeni API |
|---|---|
| supabase.auth.signUp | POST /auth/register {email və/və ya phone, password, name, role} |
| supabase.auth.signInWithPassword | POST /auth/login {identifier (e-poçt və ya telefon), password} |
| signInWithIdToken(google) | POST /auth/google {id_token} |
| signInWithIdToken(apple) | POST /auth/apple {identity_token, name?} |
| refreshSession | POST /auth/refresh {refresh_token} |
| signOut | POST /auth/logout {refresh_token} |
| updateUser(password) | POST /auth/change-password {current_password, new_password} |
| rpc('request_password_reset_otp') | POST /auth/password-reset/request {identifier} |
| rpc('request_password_reset_email') / resetPasswordForEmail | POST /auth/password-reset/email {identifier} → {email_hint} |
| rpc('reset_password_with_otp') | POST /auth/password-reset/confirm {identifier, otp, new_password} |
| rpc('request_password_change_otp') | POST /auth/password-change/request |
| rpc('verify_password_change_otp') | POST /auth/password-change/confirm {otp, new_password} |

Parol bərpası xətaları `detail.code` ilə gəlir: `WRONG_CODE` (+`attempts_left`),
`EXPIRED`, `TOO_MANY_ATTEMPTS`, `NO_OTP`, `TOO_MANY_REQUESTS` (429),
`SAME_PASSWORD`, `NO_EMAIL`. `request` cavabı hesabın olub-olmamasını açmır.
Telefon istənilən formatda göndərilə bilər (+994…, 0…, 9 rəqəm).

Token qaydası: access 15 dəq → 401 gələndə refresh ilə yenilə (rotasiya
olunur — köhnə refresh atılır, cavabdakı yenisi saxlanır).

## Domen
| Köhnə | Yeni |
|---|---|
| from('service_categories').select | GET /catalog/categories |
| from('service_questions')... | GET /catalog/categories/{id}/questions |
| from('banners')... | GET /catalog/banners |
| from('opportunities').insert | POST /opportunities |
| from('opportunities').select (mine) | GET /opportunities/mine |
| açıq sifarişlər (provayder) | GET /opportunities/open |
| rpc('cancel_opportunity') | POST /opportunities/{id}/cancel {reason} |
| from('opportunities_offers').insert | POST /offers |
| təkliflər siyahısı | GET /offers/by-opportunity/{id} |
| rpc('accept_offer_with_payment') | POST /offers/{id}/accept {method, promo_code?} |
| rpc('release_offer_to_provider') | POST /offers/{id}/complete |
| rpc('brigade_place_offer') | POST /brigades/{id}/offers |
| rpc('brigade_dispatch_order') | POST /brigades/{id}/dispatch |
| KYC submit/status/renewal | POST /kyc/submit, GET /kyc/status, POST /kyc/renewal |
| rpc('open_conversation') | POST /chat/conversations |
| chat_messages stream | GET/POST /chat/conversations/{id}/messages + WS |
| from('notifications') | GET /notifications, POST /notifications/read-all |
| user_devices insert | POST /notifications/devices {platform, fcm_token} |
| balans artırma edge func | POST /payments/top-up → checkout_url |
| from('transactions') | GET /payments/transactions |
| withdrawals | POST /withdrawals, GET /withdrawals/mine |
| onlayn ustalar (xəritə) | GET /profiles/online/providers?lat=..&lng=..&radius_km=.. |

## Fayllar (supabase.storage əvəzi)
| Köhnə | Yeni |
|---|---|
| storage.from(bucket).upload | POST /storage/{bucket} (multipart `file`) → {path, url} |
| getPublicUrl | GET /storage/public/{bucket}/{yol} (tokensiz) |
| createSignedUrl / download | GET /storage/object/{bucket}/{yol} (Bearer token) |

Bucket adları dəyişməyib (service-images, opportunity-photos, completion-evidence,
banners, make-33c80158-profile-photos, kyc-documents, dispute-evidence).

## Realtime (postgres_changes əvəzi)
WebSocket: `wss://api.ellit.az/ws?token=<access_token>`

Gələn hadisələr: offer.new, chat.message, kyc.decision, assignment.new,
payment.completed, payment.failed, withdrawal.processed
Göndərilən: {"action":"ping"} | {"action":"presence","online":true}
| {"action":"location","lat":..,"lng":..} (provayder canlı yeri)
