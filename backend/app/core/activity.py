"""HTTP fəaliyyət jurnalı: hər əməliyyat sorğusu (yazı) server jurnalına
Azərbaycan dilində təsvirlə yazılır — admin panel → Server jurnalı.

Yazılır: GET-dən başqa bütün sorğular, istənilən 5xx, yavaş sorğular (> 3 s).
Yazılmır: OPTIONS, /health, realtime, yalnız oxuyan RPC-lər (home_overview,
admin statistikası…) və tez-tez təkrarlanan uğurlu yazılar (ustanın canlı
yeri hər 20 s-də profilə, push tokeni yeniləməsi) — bunlar xəta verəndə
yenə yazılır. Gövdə və başlıqlar yazılmır.
"""
from __future__ import annotations

import logging
import time

from fastapi import Request

from app.services import live

log = logging.getLogger("ellit.http")

SLOW_MS = 3000

# (metod, yolun başlanğıcı) → təsvir. İlk uyğun gələn götürülür.
_LABELS: list[tuple[str, str, str]] = [
    ("POST", "/auth/v1/signup", "Qeydiyyat"),
    ("POST", "/auth/v1/token", "Giriş"),
    ("POST", "/auth/v1/logout", "Çıxış"),
    ("POST", "/auth/v1/recover", "Parol bərpası"),
    ("POST", "/auth/v1/otp", "OTP kod istəyi"),
    ("POST", "/auth/v1/verify", "OTP kod təsdiqi"),
    ("PUT", "/auth/v1/user", "Hesab dəyişikliyi"),
    ("POST", "/api/v1/auth/login", "Giriş"),
    ("POST", "/api/v1/auth/register", "Qeydiyyat"),
    ("POST", "/api/v1/password", "Parol əməliyyatı"),
    ("POST", "/rest/v1/opportunities", "Yeni sifariş"),
    ("PATCH", "/rest/v1/opportunities_offers", "Təklif dəyişikliyi"),
    ("PATCH", "/rest/v1/opportunities", "Sifariş dəyişikliyi"),
    ("DELETE", "/rest/v1/opportunities", "Sifarişin silinməsi"),
    ("POST", "/rest/v1/provider_reviews", "Rəy"),
    ("POST", "/rest/v1/chat_messages", "Çat mesajı"),
    ("POST", "/rest/v1/provider_verifications", "KYC müraciəti"),
    ("PATCH", "/rest/v1/provider_verifications", "KYC qərarı"),
    ("POST", "/rest/v1/disputes", "Şikayət"),
    ("PATCH", "/rest/v1/profiles", "Profil dəyişikliyi"),
    ("POST", "/rest/v1/provider_prices", "Usta qiymətləri"),
    ("PATCH", "/rest/v1/provider_prices", "Usta qiymətləri"),
    ("POST", "/storage/v1/object/sign", "Fayl linki"),
    ("POST", "/storage/v1/object", "Fayl yükləmə"),
    ("PUT", "/storage/v1/object", "Fayl yükləmə"),
    ("DELETE", "/storage/v1/object", "Fayl silmə"),
    ("POST", "/functions/v1/payment-webhook", "Epoint ödəniş cavabı"),
    ("POST", "/functions/v1/", "Funksiya"),
    ("POST", "/api/v1/offers/", "Təklif əməliyyatı"),
    ("POST", "/api/v1/admin/", "Admin əməliyyatı"),
    ("POST", "/api/v1/kyc/", "KYC əməliyyatı"),
    ("POST", "/api/v1/withdrawals", "Nağdlaşdırma"),
    ("POST", "/api/v1/payments", "Ödəniş"),
]

# Uğurlu olanda yazılmayan, çox tez-tez təkrarlanan yazılar (metod, yol)
_NOISY: tuple[tuple[str, str], ...] = (
    ("PATCH", "/rest/v1/profiles"),       # canlı yer hər 20 s, onlayn statusu
    ("POST", "/rest/v1/user_devices"),     # push tokeni yeniləməsi
    ("PATCH", "/rest/v1/user_devices"),
    ("POST", "/storage/v1/object/sign"),   # admin şəkil linkləri (çox sayda)
    ("POST", "/rest/v1/notifications"),
    ("PATCH", "/rest/v1/notifications"),   # "oxundu" işarəsi
)
_SKIP_PREFIXES = ("/health", "/realtime/", "/ws", "/docs", "/openapi.json")

_RPC_PREFIX = "/rest/v1/rpc/"
# RPC adı → təsvir (dəqiq ad üzrə)
_RPC_LABELS: dict[str, str] = {
    "place_bid": "Təklif vermə",
    "brigade_place_offer": "Briqadanın təklifi",
    "accept_offer_with_payment": "Təklifin qəbulu və ödəniş",
    "decline_offer": "Təklifin rədd edilməsi",
    "release_offer_to_provider": "İşin tamamlanması / admin təsdiqi",
    "refund_offer_payment": "Pulun geri qaytarılması",
    "cancel_opportunity": "Sifarişin ləğvi",
    "claim_opportunity": "Briqadanın sifariş götürməsi",
    "create_booking_with_fee": "Rezervasiya",
    "request_withdrawal": "Nağdlaşdırma istəyi",
    "convert_bonus_to_balance": "Bonusun balansa çevrilməsi",
    "request_provider_role": "Usta olmaq müraciəti",
    "submit_kyc": "KYC müraciəti",
    "open_dispute": "Şikayət açılması",
    "add_dispute_evidence": "Şikayətə sübut",
    "block_user": "İstifadəçinin bloklanması",
    "open_conversation": "Çatın açılması",
    "open_support_conversation": "Dəstək çatının açılması",
    "set_member_online": "Briqada üzvü onlayn/oflayn",
    "apply_for_brigade": "Briqadaya müraciət",
    "cancel_brigade_application": "Briqada müraciətinin ləğvi",
    "accept_brigade_invite": "Briqada dəvətinin qəbulu",
    "decline_brigade_invite": "Briqada dəvətinin rəddi",
    "brigade_dispatch_order": "Briqada: sifarişin paylanması",
    "brigade_dispatch_assign": "Briqada: üzvə tapşırıq",
    "brigade_assignment_respond": "Briqada: tapşırığa cavab",
    "brigade_assignment_start": "Briqada: işə başlama",
    "brigade_assignment_complete": "Briqada: işin bitməsi",
    "brigade_top_up_from_owner": "Briqada: balans artırma",
    "brigade_distribute_balance": "Briqada: balans bölgüsü",
    "request_password_reset_otp": "Parol bərpası kodu",
    "request_password_reset_email": "Parol bərpası məktubu",
    "reset_password_with_otp": "Parol bərpası",
    "request_password_change_otp": "Parol dəyişmə kodu",
    "verify_password_change_otp": "Parol dəyişmə təsdiqi",
    "admin_credit_balance": "Admin: balans artırma",
    "admin_adjust_balance": "Admin: balans düzəlişi",
    "admin_credit_bonus": "Admin: bonus",
    "admin_set_user_role": "Admin: rol dəyişikliyi",
    "admin_delete_user": "Admin: istifadəçinin silinməsi",
    "admin_approve_provider_request": "Admin: usta müraciətinin təsdiqi",
    "admin_reject_provider_request": "Admin: usta müraciətinin rəddi",
    "admin_approve_brigade_application": "Admin: briqada müraciətinin təsdiqi",
    "admin_reject_brigade_application": "Admin: briqada müraciətinin rəddi",
    "admin_complete_opportunity": "Admin: sifarişin tamamlanması",
    "admin_kyc_review": "Admin: KYC qərarı",
    "admin_update_commission": "Admin: komissiya dəyişikliyi",
    "admin_live_overview": "Admin: canlı monitor",
    "admin_live_feed": "Admin: canlı axın",
}
# Yalnız oxuyan (POST ilə çağırılan) RPC-lər — uğurlu olanda yazılmır
_RPC_READS = frozenset({
    "home_overview", "get_commission_rates", "validate_promo_code", "worker_earnings",
    "brigade_role", "my_pending_brigade_invites", "lookup_brigade_invite",
    "admin_dashboard_stats", "admin_dashboard_daily", "admin_list_users_with_meta",
    "admin_companies_list", "admin_company_detail", "admin_kyc_list",
    "admin_live_overview", "admin_live_feed",     # canlı monitor (bir neçə saniyədən bir)
    "admin_pending_counts",                        # menyudakı saylar (hər 10 san.)
    "expire_stale_offers",            # tətbiq açılanda avtomatik təmizlik
    "mark_all_notifications_read",
})


def _rpc_name(path: str) -> str | None:
    if not path.startswith(_RPC_PREFIX):
        return None
    return path[len(_RPC_PREFIX):].strip("/") or None


def describe(method: str, path: str) -> str:
    rpc = _rpc_name(path)
    if rpc:
        return _RPC_LABELS.get(rpc) or f"RPC: {rpc}"
    for m, prefix, label in _LABELS:
        if method == m and path.startswith(prefix):
            if label == "Funksiya":
                return f"{label}: {path.rsplit('/', 1)[-1]}"
            return label
    return f"{method} {path}"


def _caller(request: Request) -> tuple[str | None, str | None]:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None, None
    try:
        from app.core.security import decode_token

        p = decode_token(auth[7:].strip(), "access")
        return p.get("sub"), p.get("role")
    except Exception:  # noqa: BLE001 — anon açar və ya etibarsız token
        return None, None


_GRANT_LABELS = {
    "password": "Giriş",
    "id_token": "Google / Apple ilə giriş",
    "pkce": "Google / Apple ilə giriş",
    "refresh_token": "Token yeniləmə",
}


async def activity_log(request: Request, call_next):
    method = request.method
    path = request.url.path
    if method == "OPTIONS" or path.startswith(_SKIP_PREFIXES):
        return await call_next(request)
    t0 = time.perf_counter()
    status = 500
    try:
        resp = await call_next(request)
        status = resp.status_code
        return resp
    finally:
        ms = int((time.perf_counter() - t0) * 1000)
        label = describe(method, path)
        refresh = False
        if path == "/auth/v1/token":
            grant = request.query_params.get("grant_type") or ""
            label = _GRANT_LABELS.get(grant, label)
            refresh = grant == "refresh_token"
        write = method != "GET" and method != "HEAD"
        if write and status < 400 and (
                refresh                          # hər saat avtomatik — səs-küy
                or any(method == m and path.startswith(p) for m, p in _NOISY)
                or _rpc_name(path) in _RPC_READS):
            write = False
        if status >= 500 or ms >= SLOW_MS:
            write = True
        uid, role = _caller(request)
        if uid is None:
            # giriş / qeydiyyat: token cavabda verilir — kimin daxil olduğunu
            # gotrue `_start_session` request.state-ə yazır
            uid, role = getattr(request.state, "live_user", None) or (None, None)
        if write:
            ip = request.client.host if request.client else None
            level = (logging.ERROR if status >= 500
                     else logging.WARNING if status >= 400 or ms >= SLOW_MS
                     else logging.INFO)
            fmt = ("%s — UĞURSUZ %s: %s %s (%d ms)" if status >= 400
                   else "%s — %s %s → %s (%d ms)")
            args = ((label, status, method, path, ms) if status >= 400
                    else (label, method, path, status, ms))
            log.log(level, fmt, *args,
                    extra={"ctx": {"method": method, "path": path, "status": status,
                                   "ms": ms, "user": uid, "role": role, "ip": ip}})
        # Canlı monitor: onlayn izi + canlı axın (fon tapşırığı, sorğunu ləngitmir)
        if uid or write:
            live.spawn(live.on_request(
                method=method, path=path, status=status, ms=ms, uid=uid, role=role,
                client=live.client_kind(request.headers), label=label, logged=write))
