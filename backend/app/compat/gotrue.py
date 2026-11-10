"""Supabase Auth (GoTrue) HTTP API-nin uyğun təqdimatı — `/auth/v1/*`.

`supabase.auth.*` (veb: @supabase/auth-js, mobil: gotrue-dart) məhz bu
marşrutlarla danışır. Protokolun forması klient kitabxanalarından götürülüb;
kimlik məntiqi isə backend-in mövcud auth qatıdır (`app/api/v1/auth.py`):
eyni parol hash-ləri, eyni JWT access/refresh token-lər (`app/core/security`),
eyni lockout və refresh rotasiyası. Supabase xidməti ilə əlaqə yoxdur.

Marşrutlar:
    POST /signup                       qeydiyyat (e-poçt və ya telefon) → sessiya
    POST /token?grant_type=password    e-poçt/telefon + parol
    POST /token?grant_type=refresh_token
    POST /token?grant_type=id_token    Apple / Google native ID token
    POST /token?grant_type=pkce        OAuth / bərpa kodunun sessiyaya dəyişdirilməsi
    GET  /user, PUT /user              cari istifadəçi; parol / metadata yeniləmə
    POST /logout?scope=global|local|others
    POST /recover                      parol bərpası e-poçtu
    GET  /verify, POST /verify         bərpa keçidi / token_hash
    GET  /authorize, GET /callback     Google OAuth (kod axını)
    GET  /settings, GET /health

Xəta formatı (hər iki klientin anladığı "köhnə" GoTrue forması):
    {"code": <http status>, "error_code": "<kod>", "msg": "<mətn>"}
`X-Supabase-Api-Version` cavab başlığı QƏSDƏN göndərilmir — əks halda klientlər
kodu `code` sahəsindən sətir kimi oxumağa çalışır.

Təhlükəsizlik qərarları:
  * `redirect_to` yalnız icazə siyahısındakı ünvanlara (SITE_URL +
    AUTH_REDIRECT_URLS) gedə bilər; uyğun gəlməyəndə SITE_URL işlənir.
  * Mobil deep-link (http/https olmayan sxem) yalnız PKCE ilə — token-lər
    heç vaxt başqa tətbiqin tuta biləcəyi URL fraqmentinə yazılmır.
  * OAuth `state` imzalı və 10 dəqiqəlikdir, brauzerə cookie ilə bağlanır və
    bir dəfə işlənir; Google ID token-i `nonce` ilə həmin sorğuya bağlanır.
  * PKCE və bərpa kodları Redis-də hash kimi saxlanır, qısa ömürlüdür və
    bir dəfə işlənir (yanlış verifier də kodu yandırır).
  * Refresh rotasiyası `/api/v1/auth/refresh` ilə eynidir: rotasiyadan çıxmış
    token-in təkrar istifadəsi bütün sessiyaları bağlayır. Yeganə fərq —
    REFRESH_REUSE_INTERVAL (standart 10 san) ərzində eyni token-in ikinci
    göndərilməsi (iki brauzer tabı / itmiş cavab) oğurluq sayılmır və ilk
    rotasiyanın verdiyi eyni yeni token-i alır.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from html import escape as html_escape
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.routing import APIRoute
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import auth as auth_core
from app.api.v1.auth import AuthFailure
from app.compat.context import bearer_token
from app.core import oauth as oauth_core
from app.core.config import settings
from app.core.security import decode_token, hash_password, verify_password
from app.db.session import get_db, redis
from app.models.user import User
from app.services import mailer
from app.services.identity import identifier_key, normalize_phone
from app.services.notify import dispatch, insert_notification

log = logging.getLogger("ellit.gotrue")


# ══ Parametrlər ═══════════════════════════════════════════════════
# `app/core/config.py`-a köçürülənə qədər mühit dəyişənlərindən oxunur.
# Eyni adlı sahə Settings-ə əlavə olunan kimi avtomatik oradan götürüləcək.
def _cfg(name: str, default: str = "") -> str:
    val = getattr(settings, name, None)
    if val is None:
        val = os.environ.get(name)
    return default if val is None else str(val).strip()


def _cfg_int(name: str, default: int) -> int:
    try:
        return int(_cfg(name, str(default)))
    except ValueError:
        return default


_MOBILE_DEEP_LINK = "io.supabase.ellitbooking://login-callback/"


def site_url() -> str:
    """SITE_URL — veb tətbiqin əsas ünvanı (yönləndirmələrin standart hədəfi)."""
    val = _cfg("SITE_URL")
    if val:
        return val
    origins = settings.cors_origins_list
    return origins[0] if origins else "http://localhost:5173"


def redirect_allow_list() -> list[str]:
    """SITE_URL + AUTH_REDIRECT_URLS (vergüllə). AUTH_REDIRECT_URLS verilməyibsə:
    CORS origin-ləri + mobil tətbiqin deep-link ünvanı."""
    raw = os.environ.get("AUTH_REDIRECT_URLS")
    if getattr(settings, "AUTH_REDIRECT_URLS", None) is not None:
        raw = str(settings.AUTH_REDIRECT_URLS)
    if raw is None:
        extra = [*settings.cors_origins_list, _MOBILE_DEEP_LINK]
    else:
        extra = [u.strip() for u in raw.split(",") if u.strip()]
    return [site_url(), *extra]


def api_external_url(request: Request) -> str | None:
    """Bu API-nin kənardan görünən ünvanı (Google `redirect_uri`, e-poçt keçidləri).
    API_EXTERNAL_URL verilməyibsə yalnız production OLMAYAN mühitdə sorğunun
    öz ünvanına düşürük — production-da Host başlığına etibar edilmir (əks
    halda saxta Host ilə bərpa keçidini başqa serverə yönəltmək olardı)."""
    val = _cfg("API_EXTERNAL_URL")
    if val:
        return val.rstrip("/")
    if settings.ENV != "production":
        return str(request.base_url).rstrip("/")
    return None


def _password_min_length() -> int:
    return max(_cfg_int("PASSWORD_MIN_LENGTH", 6), 1)


_PASSWORD_MAX_LENGTH = 128


def _refresh_reuse_interval() -> int:
    return max(_cfg_int("REFRESH_REUSE_INTERVAL", 10), 0)


def _signup_roles() -> set[str]:
    """Qeydiyyatda metadata ilə özünə təyin edilə bilən rollar. Standart: yalnız
    `customer` — usta (provider) rolu admin təsdiqi ilə verilir
    (`request_provider_role`), admin rolları isə heç vaxt klientdən gəlmir."""
    roles = {r.strip() for r in _cfg("SIGNUP_ALLOWED_ROLES", "customer").split(",") if r.strip()}
    return (roles & {"customer", "provider"}) or {"customer"}


def _google_oauth() -> tuple[str, str]:
    return _cfg("GOOGLE_OAUTH_CLIENT_ID"), _cfg("GOOGLE_OAUTH_CLIENT_SECRET")


_OAUTH_STATE_TTL = 600        # /authorize → /callback
_PKCE_CODE_TTL = 300          # /callback → /token?grant_type=pkce
_RECOVERY_TTL = 3600          # bərpa keçidi
_MAX_METADATA_BYTES = 16 * 1024


# ══ Xətalar ═══════════════════════════════════════════════════════
class GoTrueError(Exception):
    def __init__(self, status: int, code: str, msg: str, **extra: Any) -> None:
        super().__init__(msg)
        self.status, self.code, self.msg, self.extra = status, code, msg, extra

    def response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status,
            content={"code": self.status, "error_code": self.code, "msg": self.msg, **self.extra},
        )


_INVALID_CREDENTIALS = ("invalid_credentials", "Invalid login credentials")


def _from_failure(e: AuthFailure) -> GoTrueError:
    """Paylaşılan auth qatının rədd səbəbi → GoTrue xətası (klientlərin
    axtardığı dəqiq mətn və kodlarla)."""
    code = e.code
    if code in ("email_taken", "phone_taken"):
        return GoTrueError(422, "user_already_exists", "User already registered")
    if code == "locked":
        return GoTrueError(429, "over_request_rate_limit", auth_core.failure_message("locked"))
    if code == "invalid_credentials":
        return GoTrueError(400, *_INVALID_CREDENTIALS)
    if code == "inactive":
        return GoTrueError(400, "user_banned", "User is banned")
    if code == "refresh_reused":
        return GoTrueError(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used")
    if code == "user_gone":
        return GoTrueError(400, "refresh_token_not_found", "Invalid Refresh Token: User Not Found")
    return GoTrueError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found")


class _GoTrueRoute(APIRoute):
    """Bu router-dəki bütün xətaları GoTrue formatına çevirir (app səviyyəli
    exception handler-ə ehtiyac qalmır)."""

    def get_route_handler(self) -> Callable:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except GoTrueError as e:
                return e.response()
            except AuthFailure as e:
                return _from_failure(e).response()
            except RequestValidationError:
                return GoTrueError(400, "validation_failed", "Invalid request parameters").response()
            except HTTPException as e:
                msg = e.detail if isinstance(e.detail, str) else "Request failed"
                return GoTrueError(e.status_code, "unexpected_failure", msg).response()
            except Exception:  # noqa: BLE001
                log.exception("auth/v1 gözlənilməz xəta: %s %s", request.method, request.url.path)
                return GoTrueError(
                    500, "unexpected_failure",
                    "Unexpected failure, please check server logs for more information",
                ).response()

        return handler


router = APIRouter(route_class=_GoTrueRoute)


# ══ Kiçik köməkçilər ══════════════════════════════════════════════
def _now() -> int:
    return int(time.time())


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _ts(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


async def _json_body(request: Request) -> dict:
    try:
        raw = await request.body()
        data = json.loads(raw) if raw.strip() else {}
    except (ValueError, UnicodeDecodeError) as e:
        raise GoTrueError(400, "bad_json", "Could not parse request body as JSON") from e
    if not isinstance(data, dict):
        raise GoTrueError(400, "bad_json", "Request body must be a JSON object")
    return data


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


async def _take(key: str) -> str | None:
    """Açarı oxu VƏ sil — atomik (bir dəfəlik kodlar üçün)."""
    async with redis.pipeline(transaction=True) as pipe:
        pipe.get(key)
        pipe.delete(key)
        value, _ = await pipe.execute()
    return value


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _check_password_strength(password: Any) -> str:
    if not isinstance(password, str) or not password:
        raise GoTrueError(400, "validation_failed", "Signup requires a valid password")
    if len(password) > _PASSWORD_MAX_LENGTH:
        raise GoTrueError(
            400, "validation_failed",
            f"Password cannot be longer than {_PASSWORD_MAX_LENGTH} characters",
        )
    minimum = _password_min_length()
    if len(password) < minimum:
        raise GoTrueError(
            422, "weak_password", f"Password should be at least {minimum} characters.",
            weak_password={"reasons": ["length"]},
        )
    return password


# ══ redirect_to icazə siyahısı ════════════════════════════════════
_BAD_URL_CHARS = re.compile(r"[\x00-\x20\x7f\\]")


def _split(url: str):
    """URL-i təhlil edir; şübhəli formadırsa None (boşluq/idarə simvolu, tərs
    kəsik, `user@host`, sxemsiz və ya hostsuz ünvan)."""
    if not url or len(url) > 2048 or _BAD_URL_CHARS.search(url):
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if not scheme or not parts.netloc or "@" in parts.netloc:
        return None
    host = (parts.hostname or "").lower()
    if not host:
        return None
    if port is None and scheme in ("http", "https"):
        port = 443 if scheme == "https" else 80
    return scheme, host, port, parts.path or "", parts


def _is_web(url: str) -> bool:
    sp = _split(url)
    return sp is not None and sp[0] in ("http", "https")


def is_allowed_redirect(url: str) -> bool:
    """`url` icazə siyahısındakı qeydlərdən birinə uyğundursa True.

    Qeyd yalnız origin-dirsə (`https://ellit.az`) həmin origin-in istənilən
    yolu qəbul olunur; yolu varsa — dəqiq uyğunluq (son `/` nəzərə alınmır),
    sonu `*` ilə bitirsə — prefiks. Sxem, host və port həmişə dəqiq müqayisə
    olunur (alt-domen, oxşar host və ya başqa sxem keçmir)."""
    target = _split(url)
    if target is None:
        return False
    t_scheme, t_host, t_port, t_path, _ = target
    for entry in redirect_allow_list():
        wildcard = entry.endswith("*")
        pattern = _split(entry.rstrip("*") if wildcard else entry)
        if pattern is None:
            continue
        p_scheme, p_host, p_port, p_path, _ = pattern
        if (t_scheme, t_host, t_port) != (p_scheme, p_host, p_port):
            continue
        if wildcard:
            if t_path.startswith(p_path):
                return True
        elif p_path in ("", "/"):
            # veb origin → istənilən yol; tətbiq sxemi → yalnız həmin ünvan
            if t_scheme in ("http", "https") or t_path in ("", "/"):
                return True
        elif t_path.rstrip("/") == p_path.rstrip("/"):
            return True
    return False


def safe_redirect(url: str | None) -> str:
    """İcazəli `redirect_to` və ya (uyğun gəlməyəndə) SITE_URL — GoTrue kimi."""
    if url and is_allowed_redirect(url):
        return url
    return site_url()


def _with_fragment(url: str, params: dict) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, p.path, p.query, urlencode(params)))


def _with_query(url: str, params: dict) -> str:
    p = urlsplit(url)
    query = "&".join(x for x in (p.query, urlencode(params)) if x)
    return urlunsplit((p.scheme, p.netloc, p.path, query, ""))


def _error_redirect(target: str, *, pkce: bool, error: str, code: str, description: str,
                    status: int = 302) -> RedirectResponse:
    params = {"error": error, "error_code": code, "error_description": description}
    url = _with_query(target, params) if pkce else _with_fragment(target, params)
    return RedirectResponse(url, status_code=status)


# ══ İstifadəçi obyekti ════════════════════════════════════════════
def _as_dict(value: Any) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return dict(value) if isinstance(value, dict) else {}


async def _load_metadata(db: AsyncSession, user_id: uuid.UUID) -> tuple[dict, datetime | None]:
    row = (
        await db.execute(
            text("select user_metadata, last_sign_in_at from users where id = :i"),
            {"i": user_id},
        )
    ).first()
    if row is None:
        return {}, None
    return _as_dict(row.user_metadata), row.last_sign_in_at


async def _save_metadata(db: AsyncSession, user_id: uuid.UUID, meta: dict) -> None:
    await db.execute(
        text("update users set user_metadata = cast(:m as jsonb) where id = :i"),
        {"m": json.dumps(meta, ensure_ascii=False), "i": user_id},
    )


async def user_payload(db: AsyncSession, user: User) -> dict:
    """GoTrue `User` obyekti — klientlərin oxuduğu sahələrlə."""
    meta, last_sign_in = await _load_metadata(db, user.id)
    oauth_rows = (
        await db.execute(
            text(
                "select id, provider, provider_sub, created_at from oauth_identities"
                " where user_id = :i order by created_at"
            ),
            {"i": user.id},
        )
    ).all()

    created = _ts(user.created_at)
    updated = _ts(user.updated_at) or created
    last = _ts(last_sign_in)
    email, phone = user.email or "", user.phone or ""

    identities: list[dict] = []

    def add_identity(identity_id: str, provider: str, sub: str, data: dict, at: str | None) -> None:
        identities.append({
            "identity_id": identity_id, "id": sub, "user_id": str(user.id),
            "identity_data": data, "provider": provider,
            "last_sign_in_at": last or at, "created_at": at, "updated_at": at,
            **({"email": email} if email and provider != "phone" else {}),
        })

    if user.password_hash:
        if email:
            add_identity(str(uuid.uuid5(user.id, "email")), "email", str(user.id),
                         {"sub": str(user.id), "email": email,
                          "email_verified": bool(user.email_verified), "phone_verified": False},
                         created)
        if phone:
            add_identity(str(uuid.uuid5(user.id, "phone")), "phone", str(user.id),
                         {"sub": str(user.id), "phone": phone,
                          "email_verified": False, "phone_verified": True},
                         created)
    for r in oauth_rows:
        add_identity(str(r.id), r.provider, r.provider_sub,
                     {"sub": r.provider_sub, **({"email": email} if email else {}),
                      "email_verified": True, "phone_verified": False},
                     _ts(r.created_at))

    providers = [i["provider"] for i in identities]
    # Əsas provayder: hesabı YARADAN üsul. OAuth kimliyi hesabla eyni anda
    # yaranıbsa hesab OAuth ilə açılıb; əks halda parol (email/phone) hesabıdır.
    primary = providers[0] if providers else ("email" if email else "phone")
    if oauth_rows and user.created_at is not None:
        first = oauth_rows[0]
        if abs((first.created_at - user.created_at).total_seconds()) < 5:
            primary = first.provider
            providers = [primary, *[p for p in providers if p != primary]]

    # Klientin göndərdiyi metadata əsasdır; standart GoTrue açarları yalnız
    # yoxdursa əlavə olunur
    view = dict(meta)
    view.setdefault("sub", str(user.id))
    if email:
        view.setdefault("email", email)
    view.setdefault("email_verified", bool(user.email_verified))
    view.setdefault("phone_verified", bool(phone) and bool(user.password_hash))

    payload = {
        "id": str(user.id),
        "aud": "authenticated",
        "role": "authenticated",
        "email": email,
        "phone": phone,
        "app_metadata": {"provider": primary, "providers": providers or [primary]},
        "user_metadata": view,
        "identities": identities,
        "created_at": created,
        "updated_at": updated,
        "last_sign_in_at": last,
        "is_anonymous": False,
    }
    # Bu sistemdə ayrıca təsdiq addımı yoxdur: hesab yaranan kimi aktivdir
    if email:
        payload["email_confirmed_at"] = created
    if phone:
        payload["phone_confirmed_at"] = created
    payload["confirmed_at"] = created
    return payload


# ══ Sessiya ═══════════════════════════════════════════════════════
async def _session_payload(db: AsyncSession, user: User, tokens: auth_core.TokenOut) -> dict:
    try:
        expires_at = int(jwt.get_unverified_claims(tokens.access_token)["exp"])
    except Exception:  # noqa: BLE001
        expires_at = _now() + settings.ACCESS_TOKEN_MINUTES * 60
    return {
        "access_token": tokens.access_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_MINUTES * 60,
        "expires_at": expires_at,
        "refresh_token": tokens.refresh_token,
        "user": await user_payload(db, user),
    }


async def _start_session(db: AsyncSession, request: Request, user: User) -> auth_core.TokenOut:
    """Yeni giriş: `last_sign_in_at` yenilənir və backend-in adi token cütü verilir."""
    await db.execute(
        text("update users set last_sign_in_at = now() where id = :i"), {"i": user.id}
    )
    return await auth_core._issue_tokens(db, user, request)  # commit daxildir


async def _current_user(request: Request, db: AsyncSession) -> tuple[User, dict]:
    token = bearer_token(request)
    if not token:
        raise GoTrueError(401, "no_authorization", "This endpoint requires a Bearer token")
    try:
        claims = decode_token(token, "access")
        user_id = uuid.UUID(claims["sub"])
    except ExpiredSignatureError as e:
        raise GoTrueError(
            403, "bad_jwt",
            "invalid JWT: unable to parse or verify signature, token is expired",
        ) from e
    except (JWTError, KeyError, ValueError) as e:
        raise GoTrueError(403, "bad_jwt", "invalid JWT: unable to parse or verify signature") from e
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise GoTrueError(403, "user_not_found", "User from sub claim in JWT does not exist")
    if not user.is_active:
        raise GoTrueError(403, "user_banned", "User is banned")
    return user, claims


# ══ POST /signup ══════════════════════════════════════════════════
_NAME_KEYS = ("full_name", "name", "display_name", "given_name")


def _profile_name(data: dict, email: str | None) -> str | None:
    """`handle_new_user` trigger-i ilə eyni seçim: metadata adı, yoxdursa
    e-poçtun @-dən əvvəlki hissəsi."""
    for key in _NAME_KEYS:
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()[:120]
    return email.split("@", 1)[0][:120] if email else None


@router.post("/signup")
async def signup(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    body = await _json_body(request)
    email = _str(body.get("email")).lower() or None
    phone_raw = _str(body.get("phone")) or None
    data = body.get("data")
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise GoTrueError(400, "validation_failed", "User metadata must be a JSON object")
    if len(json.dumps(data, ensure_ascii=False).encode()) > _MAX_METADATA_BYTES:
        raise GoTrueError(400, "validation_failed", "User metadata is too large")

    if not email and not phone_raw:
        raise GoTrueError(422, "anonymous_provider_disabled", "Anonymous sign-ins are disabled")
    if email and phone_raw:
        raise GoTrueError(
            400, "validation_failed",
            "Only an email address or phone number should be provided on signup.",
        )
    phone = None
    if email:
        if len(email) > 320 or not _EMAIL_RE.match(email):
            raise GoTrueError(
                400, "validation_failed", "Unable to validate email address: invalid format"
            )
    else:
        phone = normalize_phone(phone_raw)
        if phone is None:
            raise GoTrueError(
                400, "validation_failed", "Invalid phone number format (E.164 required)"
            )
    password = _check_password_strength(body.get("password"))

    # Rol: klient yalnız icazəli siyahıdakı rolu seçə bilər; qalan hər şey
    # (o cümlədən admin/master/superadmin) → customer
    wanted = data.get("role")
    role = wanted if isinstance(wanted, str) and wanted in _signup_roles() else "customer"

    user = await auth_core.create_account(
        db, email=email, phone=phone, password=password,
        name=_profile_name(data, email), role=role, commit=False,
    )
    await _save_metadata(db, user.id, data)
    tokens = await _start_session(db, request, user)
    # Təsdiq addımı yoxdur → klient dərhal sessiya alır (`data.session` dolu)
    return await _session_payload(db, user, tokens)


# ══ POST /token ═══════════════════════════════════════════════════
@router.post("/token")
async def token(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    grant = request.query_params.get("grant_type", "")
    body = await _json_body(request)
    if grant == "password":
        user = await _grant_password(request, db, body)
        tokens = await _start_session(db, request, user)
    elif grant == "refresh_token":
        user, tokens = await _grant_refresh(request, db, body)
    elif grant == "id_token":
        user = await _grant_id_token(db, body)
        tokens = await _start_session(db, request, user)
    elif grant == "pkce":
        user = await _grant_pkce(db, body)
        tokens = await _start_session(db, request, user)
    else:
        raise GoTrueError(400, "validation_failed", "unsupported_grant_type")
    return await _session_payload(db, user, tokens)


async def _grant_password(request: Request, db: AsyncSession, body: dict) -> User:
    identifier = _str(body.get("email")) or _str(body.get("phone"))
    password = body.get("password")
    if not identifier or not isinstance(password, str) or not password:
        raise GoTrueError(400, *_INVALID_CREDENTIALS)
    if len(identifier) > 320 or len(password) > _PASSWORD_MAX_LENGTH:
        raise GoTrueError(400, *_INVALID_CREDENTIALS)
    # Lockout, "hesab yoxdur"/"parol səhvdir" fərqsizliyi və bcrypt → Argon2
    # keçidi /api/v1/auth/login ilə eyni funksiyadadır
    return await auth_core.authenticate_password(db, identifier, password, _client_ip(request))


async def _grant_refresh(
    request: Request, db: AsyncSession, body: dict
) -> tuple[User, auth_core.TokenOut]:
    refresh_token = body.get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token:
        raise GoTrueError(400, "validation_failed", "refresh_token required")
    return await auth_core.rotate_refresh_session(
        db, request, refresh_token, reuse_interval=_refresh_reuse_interval()
    )


# ── ID token (Apple / Google native giriş) ────────────────────────
def _check_nonce(token_nonce: str | None, raw_nonce: str) -> None:
    """Klient provayderə nonce-un SHA-256 hash-ini, bizə isə özünü göndərir;
    ID token-dəki `nonce` həmin hash olmalıdır (replay qoruması)."""
    if bool(token_nonce) != bool(raw_nonce):
        raise GoTrueError(
            400, "validation_failed",
            "Passed nonce and nonce in id_token should either both exist or not.",
        )
    if raw_nonce and not hmac.compare_digest(_sha256(raw_nonce), str(token_nonce)):
        raise GoTrueError(400, "validation_failed", "Nonces mismatch")


async def _verify_google_id_token(id_token: str, audiences: list[str]) -> dict:
    # google-auth sinxrondur (sertifikatları şəbəkədən çəkir) → thread pool
    return await run_in_threadpool(oauth_core.verify_google_token, id_token, audiences)


def _google_audiences() -> list[str]:
    web_id, _ = _google_oauth()
    return [*settings.google_client_ids_list, *([web_id] if web_id else [])]


_OAUTH_META_REFRESH = ("avatar_url", "picture", "email_verified", "phone_verified")


async def _oauth_sign_in(db: AsyncSession, info: dict) -> User:
    """OAuth kimliyi → istifadəçi (tap / yarat / e-poçtla bağla) + GoTrue-dakı
    kimi provayder məlumatı `user_metadata`-ya yazılır (klientlər `name`,
    `full_name`, `avatar_url`, `picture`, `email` oxuyur)."""
    user = await auth_core.oauth_find_or_create(db, info, None)
    meta, _ = await _load_metadata(db, user.id)
    claims = {
        "iss": "https://accounts.google.com" if info["provider"] == "google"
        else "https://appleid.apple.com",
        "sub": info["sub"], "provider_id": info["sub"],
        "email": info.get("email"), "email_verified": bool(info.get("email")),
        "phone_verified": False,
        "name": info.get("name"), "full_name": info.get("name"),
        "avatar_url": info.get("avatar_url"), "picture": info.get("avatar_url"),
    }
    changed = False
    for key, val in claims.items():
        if val is None:
            continue
        # İstifadəçinin özü dəyişdiyi sahələr (məs. ad) üzərinə yazılmır
        if key not in meta or (key in _OAUTH_META_REFRESH and meta[key] != val):
            meta[key] = val
            changed = True
    if changed:
        await _save_metadata(db, user.id, meta)
        await db.commit()
    return user


async def _grant_id_token(db: AsyncSession, body: dict) -> User:
    provider = _str(body.get("provider")).lower()
    id_token = body.get("id_token")
    raw_nonce = body.get("nonce") if isinstance(body.get("nonce"), str) else ""
    if not isinstance(id_token, str) or not id_token:
        raise GoTrueError(400, "validation_failed", "id_token required")
    try:
        if provider == "apple":
            info = await oauth_core.verify_apple_token(id_token)
        elif provider == "google":
            audiences = _google_audiences()
            if not audiences:
                # Auditoriya təyin olunmayıbsa İSTƏNİLƏN tətbiq üçün verilmiş
                # Google token-i keçərdi — ona görə provayder bağlı sayılır
                raise GoTrueError(
                    400, "validation_failed", "Provider (issuer \"https://accounts.google.com\") is not enabled"
                )
            info = await _verify_google_id_token(id_token, audiences)
        else:
            raise GoTrueError(400, "validation_failed", f"Provider \"{provider}\" is not supported for ID tokens")
    except oauth_core.OAuthError as e:
        raise GoTrueError(400, "validation_failed", f"Bad ID token: {e}") from e
    _check_nonce(info.get("nonce"), raw_nonce)
    return await _oauth_sign_in(db, info)


# ── PKCE: bir dəfəlik kodun sessiyaya dəyişdirilməsi ───────────────
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")


def _pkce_params(code_challenge: Any, method: Any) -> tuple[str, str] | None:
    """(challenge, method) və ya PKCE istənməyibsə None."""
    if code_challenge is None or code_challenge == "":
        return None
    if not isinstance(code_challenge, str) or not _CHALLENGE_RE.match(code_challenge):
        raise GoTrueError(
            400, "validation_failed", "code challenge has to be between 43 and 128 characters"
        )
    method = (method if isinstance(method, str) and method else "s256").lower()
    if method not in ("s256", "plain"):
        raise GoTrueError(400, "validation_failed", "code challenge method must be s256 or plain")
    return code_challenge, method


def _pkce_matches(verifier: str, challenge: str, method: str) -> bool:
    if method == "plain":
        candidate = verifier
    else:
        digest = hashlib.sha256(verifier.encode("ascii", "ignore")).digest()
        candidate = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return hmac.compare_digest(candidate, challenge)


async def _issue_pkce_code(user_id: uuid.UUID, challenge: str, method: str, kind: str) -> str:
    code = secrets.token_urlsafe(32)
    await redis.setex(
        f"gotrue:pkce:{_sha256(code)}", _PKCE_CODE_TTL,
        json.dumps({"uid": str(user_id), "cc": challenge, "ccm": method, "kind": kind}),
    )
    return code


async def _grant_pkce(db: AsyncSession, body: dict) -> User:
    auth_code, verifier = body.get("auth_code"), body.get("code_verifier")
    if not isinstance(auth_code, str) or not auth_code or not isinstance(verifier, str) or not verifier:
        raise GoTrueError(
            400, "validation_failed",
            "invalid request: both auth code and code verifier should be non-empty",
        )
    # Kod oxunan kimi silinir: ikinci cəhd (düzgün verifier ilə belə) keçmir,
    # yanlış verifier ilə sınaq da kodu yandırır
    raw = await _take(f"gotrue:pkce:{_sha256(auth_code)}")
    if raw is None:
        raise GoTrueError(404, "flow_state_not_found", "invalid flow state, no valid flow state found")
    flow = json.loads(raw)
    if not _pkce_matches(verifier, flow["cc"], flow["ccm"]):
        raise GoTrueError(
            400, "bad_code_verifier",
            "code challenge does not match previously saved code verifier",
        )
    user = (
        await db.execute(select(User).where(User.id == uuid.UUID(flow["uid"])))
    ).scalar_one_or_none()
    if user is None:
        raise GoTrueError(404, "flow_state_not_found", "invalid flow state, no valid flow state found")
    if not user.is_active:
        raise GoTrueError(400, "user_banned", "User is banned")
    return user


# ══ GET /user, PUT /user ══════════════════════════════════════════
@router.get("/user")
async def get_user(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    user, _ = await _current_user(request, db)
    return await user_payload(db, user)


@router.put("/user")
async def update_user(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    user, claims = await _current_user(request, db)
    body = await _json_body(request)

    # E-poçt/telefon dəyişikliyi təsdiq (OTP) tələb edir; bu axın burada yoxdur
    # və klientlər onu çağırmır. Giriş identifikatorunu təsdiqsiz dəyişməyə
    # icazə vermirik.
    new_email = _str(body.get("email")).lower()
    if new_email and new_email != (user.email or ""):
        raise GoTrueError(422, "email_change_not_supported",
                          "E-poçt ünvanının dəyişdirilməsi bu API ilə dəstəklənmir")
    new_phone = _str(body.get("phone"))
    if new_phone and normalize_phone(new_phone) != (user.phone or ""):
        raise GoTrueError(422, "phone_change_not_supported",
                          "Telefon nömrəsinin dəyişdirilməsi bu API ilə dəstəklənmir")

    data = body.get("data")
    if data is not None and not isinstance(data, dict):
        raise GoTrueError(400, "validation_failed", "User metadata must be a JSON object")

    password_changed = False
    if body.get("password") is not None:
        password = _check_password_strength(body.get("password"))
        if user.password_hash and verify_password(password, user.password_hash)[0]:
            raise GoTrueError(
                422, "same_password",
                "New password should be different from the old password.",
            )
        user.password_hash = hash_password(password)
        password_changed = True

    if data is not None:
        meta, _ = await _load_metadata(db, user.id)
        for key, val in data.items():
            if val is None:
                meta.pop(key, None)        # GoTrue: null → açar silinir
            else:
                meta[key] = val
        if len(json.dumps(meta, ensure_ascii=False).encode()) > _MAX_METADATA_BYTES:
            raise GoTrueError(400, "validation_failed", "User metadata is too large")
        await _save_metadata(db, user.id, meta)

    notice_id = None
    title, text_body = "Parolunuz yeniləndi 🔐", (
        "Hesabınızın parolu dəyişdirildi. Bunu siz etməmisinizsə, dərhal "
        "dəstək xidməti ilə əlaqə saxlayın."
    )
    if password_changed:
        notice_id = await insert_notification(
            db, user_id=user.id, ntype="security", title=title, body=text_body
        )
    await db.commit()

    if password_changed:
        # Parol dəyişəndə BAŞQA cihazlardakı sessiyalar bağlanır; sorğunu edən
        # sessiya qalır (klient yeni token almır, sonrakı refresh işləməlidir).
        # Cari sessiya müəyyən edilə bilmirsə hamısı bağlanır.
        keep = await auth_core.current_refresh_jti(claims)
        await auth_core.revoke_sessions(db, user.id, keep_jti=keep)
        try:  # uğursuz giriş kilidləri sıfırlanır — yeni parolla dərhal girmək olsun
            for ident in filter(None, (user.email, user.phone)):
                async for key in redis.scan_iter(match=f"lock:{identifier_key(ident)}:*"):
                    await redis.delete(key)
        except Exception:  # noqa: BLE001
            pass
        dispatch(user.id, title, text_body, {"type": "security", "notif_id": notice_id})
    return await user_payload(db, user)


# ══ POST /logout ══════════════════════════════════════════════════
@router.post("/logout")
async def logout(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    user, claims = await _current_user(request, db)
    scope = request.query_params.get("scope", "global")
    if scope not in ("global", "local", "others"):
        raise GoTrueError(400, "validation_failed", f"Unsupported logout scope {scope!r}")
    current = await auth_core.current_refresh_jti(claims)
    if scope == "global" or (scope == "local" and current is None):
        # `local` üçün cari sessiya tapılmırsa ehtiyatlı variant: hamısı bağlanır
        await auth_core.revoke_sessions(db, user.id)
    elif scope == "local":
        await auth_core.revoke_sessions(db, user.id, only_jti=current)
    elif current is not None:
        await auth_core.revoke_sessions(db, user.id, keep_jti=current)
    return Response(status_code=204)


# ══ POST /recover, /verify ════════════════════════════════════════
def _recovery_mail(link: str) -> tuple[str, str, str]:
    subject = "Ellit — parolun bərpası"
    minutes = _RECOVERY_TTL // 60
    body = (
        "Parolunuzu yeniləmək üçün bu keçidə daxil olun:\n\n"
        f"{link}\n\n"
        f"Keçid {minutes} dəqiqə etibarlıdır və yalnız bir dəfə işləyir. Bu sorğunu "
        "siz etməmisinizsə, məktubu nəzərə almayın — parolunuz dəyişməyəcək.\n\nEllit.az"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;'
        'padding:24px;color:#0A0F1E">'
        '<h2 style="color:#2563EB;margin:0 0 12px">Ellit</h2>'
        "<p>Parolunuzu yeniləmək üçün düyməyə basın:</p>"
        f'<p style="margin:20px 0"><a href="{html_escape(link, quote=True)}" '
        'style="background:#2563EB;color:#fff;text-decoration:none;font-weight:700;'
        'padding:12px 20px;border-radius:10px;display:inline-block">Parolu yenilə</a></p>'
        f'<p style="color:#64748B">Keçid {minutes} dəqiqə etibarlıdır və yalnız bir dəfə '
        "işləyir. Bu sorğunu siz etməmisinizsə, məktubu nəzərə almayın — parolunuz "
        "dəyişməyəcək.</p></div>"
    )
    return subject, body, html


async def _recover_rate_limit(identifier: str) -> None:
    """Saatlıq limit identifikatora görədir (hesabın olub-olmamasından asılı
    deyil) — `/auth/password-reset/email` ilə eyni sayğac."""
    key = f"otp:mail:{identifier_key(identifier)}"
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, 3600)
    except Exception:  # noqa: BLE001 — Redis əlçatmazdırsa buraxırıq
        return
    if n > settings.OTP_MAX_PER_HOUR:
        raise GoTrueError(
            429, "over_email_send_rate_limit",
            "Çox sorğu göndərildi — bir saat sonra yenidən cəhd edin",
        )


@router.post("/recover")
async def recover(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Parol bərpası e-poçtu. Cavab hesabın olub-olmamasını açmır."""
    body = await _json_body(request)
    email = _str(body.get("email")).lower()
    if not email or len(email) > 320 or not _EMAIL_RE.match(email):
        raise GoTrueError(400, "validation_failed", "Unable to validate email address: invalid format")
    pkce = _pkce_params(body.get("code_challenge"), body.get("code_challenge_method"))
    redirect_to = safe_redirect(request.query_params.get("redirect_to"))
    await _recover_rate_limit(email)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.is_active:
        return {}
    base = api_external_url(request)
    if base is None or not mailer.mail_enabled():
        log.warning("Bərpa e-poçtu göndərilmədi: %s",
                    "API_EXTERNAL_URL təyin olunmayıb" if base is None else "SMTP aktiv deyil")
        return {}

    token_value = secrets.token_urlsafe(32)
    digest = _sha256(token_value)
    record = {"uid": str(user.id)}
    if pkce:
        record.update(cc=pkce[0], ccm=pkce[1])
    # Yeni keçid əvvəlkini etibarsız edir
    previous = await redis.getset(f"gotrue:recovery:user:{user.id}", digest)
    if previous:
        await redis.delete(f"gotrue:recovery:{previous}")
    await redis.expire(f"gotrue:recovery:user:{user.id}", _RECOVERY_TTL)
    await redis.setex(f"gotrue:recovery:{digest}", _RECOVERY_TTL, json.dumps(record))

    link = f"{base}/auth/v1/verify?" + urlencode(
        {"token": token_value, "type": "recovery", "redirect_to": redirect_to}
    )
    await mailer.send_mail(user.email, *_recovery_mail(link))
    return {}


async def _consume_recovery(db: AsyncSession, token_value: str) -> tuple[User, dict] | None:
    if not token_value:
        return None
    raw = await _take(f"gotrue:recovery:{_sha256(token_value)}")
    if raw is None:
        return None
    record = json.loads(raw)
    user = (
        await db.execute(select(User).where(User.id == uuid.UUID(record["uid"])))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    try:
        await redis.delete(f"gotrue:recovery:user:{user.id}")
    except Exception:  # noqa: BLE001
        pass
    # Keçidə basmaq e-poçta sahibliyi sübut edir
    if user.email and not user.email_verified:
        user.email_verified = True
    return user, record


_OTP_EXPIRED = ("otp_expired", "Email link is invalid or has expired")


@router.get("/verify")
async def verify_link(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """E-poçtdakı bərpa keçidi → icazəli `redirect_to`-ya sessiya ilə yönləndirmə
    (klient `PASSWORD_RECOVERY` hadisəsi alır və `updateUser({password})` çağırır)."""
    q = request.query_params
    redirect_to = safe_redirect(q.get("redirect_to"))
    found = await _consume_recovery(db, q.get("token", "")) if q.get("type") == "recovery" else None
    if found is None:
        return _error_redirect(redirect_to, pkce=False, error="access_denied",
                               code=_OTP_EXPIRED[0], description=_OTP_EXPIRED[1], status=303)
    user, record = found
    if record.get("cc"):
        await db.commit()
        code = await _issue_pkce_code(user.id, record["cc"], record["ccm"], "recovery")
        return RedirectResponse(_with_query(redirect_to, {"code": code}), status_code=303)
    if not _is_web(redirect_to):
        await db.commit()
        return _error_redirect(redirect_to, pkce=True, error="invalid_request",
                               code="validation_failed",
                               description="PKCE flow is required for this redirect URL", status=303)
    tokens = await _start_session(db, request, user)
    session = await _session_payload(db, user, tokens)
    fragment = {k: session[k] for k in
                ("access_token", "expires_at", "expires_in", "refresh_token", "token_type")}
    fragment["type"] = "recovery"
    return RedirectResponse(_with_fragment(redirect_to, fragment), status_code=303)


@router.post("/verify")
async def verify_otp(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """`verifyOtp({type: 'recovery', token_hash})` — bərpa keçidindəki token-in
    birbaşa sessiyaya dəyişdirilməsi. Başqa OTP növləri bu sistemdə yoxdur
    (parol OTP-ləri RPC-lərlə işləyir)."""
    body = await _json_body(request)
    found = None
    if body.get("type") == "recovery":
        found = await _consume_recovery(db, _str(body.get("token_hash")) or _str(body.get("token")))
    if found is None:
        raise GoTrueError(403, "otp_expired", "Token has expired or is invalid")
    user, _ = found
    tokens = await _start_session(db, request, user)
    return await _session_payload(db, user, tokens)


@router.post("/otp")
async def otp(request: Request) -> dict:
    """Magic link / SMS OTP ilə giriş bu sistemdə yoxdur (klientlər çağırmır)."""
    raise GoTrueError(422, "otp_disabled", "OTP ilə giriş aktiv deyil")


# ══ Google OAuth: GET /authorize → Google → GET /callback ═════════
_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _callback_url(base: str) -> str:
    return f"{base}/auth/v1/callback"


def _state_cookie(nonce: str) -> str:
    return f"ellit_oauth_{nonce[:12]}"


def _google_nonce(nonce: str) -> str:
    return _sha256(f"google-id-token:{nonce}")


def _encode_state(payload: dict) -> str:
    now = _now()
    return jwt.encode(
        {**payload, "type": "oauth_state", "iat": now, "exp": now + _OAUTH_STATE_TTL},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )


async def _google_exchange_code(code: str, redirect_uri: str) -> str:
    """Avtorizasiya kodu → Google ID token (server-server, client secret ilə)."""
    client_id, client_secret = _google_oauth()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(_GOOGLE_TOKEN_URL, data={
                "code": code, "client_id": client_id, "client_secret": client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code",
            })
    except httpx.HTTPError as e:
        raise oauth_core.OAuthError(f"Google ilə əlaqə alınmadı: {type(e).__name__}") from e
    if resp.status_code != 200:
        raise oauth_core.OAuthError(f"Google kodu qəbul etmədi (HTTP {resp.status_code})")
    id_token = resp.json().get("id_token")
    if not id_token:
        raise oauth_core.OAuthError("Google cavabında id_token yoxdur")
    return id_token


@router.get("/authorize")
async def authorize(request: Request) -> Response:
    q = request.query_params
    provider = _str(q.get("provider")).lower()
    client_id, client_secret = _google_oauth()
    base = api_external_url(request)
    if provider != "google" or not client_id or not client_secret or base is None:
        # Apple veb OAuth axını qurulmayıb (mobil native `signInWithIdToken` işlədir)
        raise GoTrueError(400, "validation_failed", "Unsupported provider: provider is not enabled")

    redirect_to = safe_redirect(q.get("redirect_to"))
    pkce = _pkce_params(q.get("code_challenge"), q.get("code_challenge_method"))
    if pkce is None and not _is_web(redirect_to):
        raise GoTrueError(
            400, "validation_failed", "PKCE flow is required for this redirect URL"
        )

    nonce = secrets.token_urlsafe(24)
    state = _encode_state({
        "n": nonce, "p": provider, "r": redirect_to,
        **({"cc": pkce[0], "ccm": pkce[1]} if pkce else {}),
    })
    url = _GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "redirect_uri": _callback_url(base),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": _google_nonce(nonce),
    })
    resp = RedirectResponse(url, status_code=302)
    # `state` bu brauzerə bağlanır: /callback yalnız /authorize-ı açan brauzerdən
    # gələrsə qəbul olunur (login CSRF / başqasının kodu ilə giriş qoruması)
    resp.set_cookie(
        _state_cookie(nonce), nonce, max_age=_OAUTH_STATE_TTL, httponly=True,
        secure=base.startswith("https://"), samesite="lax",
        path=urlsplit(_callback_url(base)).path,
    )
    return resp


@router.get("/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    q = request.query_params
    base = api_external_url(request)
    client_id, _ = _google_oauth()

    def fail(target: str, pkce: bool, description: str, *, error: str = "server_error",
             code: str = "unexpected_failure", nonce: str | None = None) -> Response:
        resp = _error_redirect(target, pkce=pkce, error=error, code=code, description=description)
        if nonce and base:
            resp.delete_cookie(_state_cookie(nonce), path=urlsplit(_callback_url(base)).path)
        return resp

    try:
        state = decode_token(q.get("state", ""), "oauth_state")
        nonce, redirect_to = state["n"], state["r"]
    except (JWTError, KeyError):
        return fail(site_url(), False, "OAuth state is invalid or expired",
                    error="invalid_request", code="bad_oauth_state")
    pkce = (state["cc"], state.get("ccm", "s256")) if state.get("cc") else None
    is_pkce = pkce is not None
    # `state` imzalıdır, amma ünvan yenə yoxlanır (siyahı arada dəyişə bilər)
    if not is_allowed_redirect(redirect_to) or base is None or not client_id:
        return fail(site_url(), False, "OAuth state is invalid or expired",
                    error="invalid_request", code="bad_oauth_state")

    cookie = request.cookies.get(_state_cookie(nonce), "")
    if not hmac.compare_digest(cookie, nonce):
        return fail(redirect_to, is_pkce, "OAuth state does not belong to this browser session",
                    error="invalid_request", code="bad_oauth_state")
    # Bir `state` yalnız bir dəfə işlənir
    if not await redis.set(f"gotrue:oauth:state:{_sha256(nonce)}", "1", nx=True,
                           ex=_OAUTH_STATE_TTL + 60):
        return fail(redirect_to, is_pkce, "OAuth state has already been used",
                    error="invalid_request", code="bad_oauth_state", nonce=nonce)

    if q.get("error"):
        return fail(redirect_to, is_pkce, q.get("error_description") or q.get("error", ""),
                    error="access_denied", code="provider_error", nonce=nonce)
    code = q.get("code")
    if not code:
        return fail(redirect_to, is_pkce, "OAuth callback with missing authorization code",
                    error="invalid_request", code="bad_oauth_callback", nonce=nonce)

    try:
        id_token = await _google_exchange_code(code, _callback_url(base))
        info = await _verify_google_id_token(id_token, [client_id])
    except oauth_core.OAuthError as e:
        log.warning("Google OAuth alınmadı: %s", e)
        return fail(redirect_to, is_pkce, "Unable to exchange external code", nonce=nonce)
    # ID token məhz BU avtorizasiya sorğusu üçün verilib?
    if not hmac.compare_digest(str(info.get("nonce") or ""), _google_nonce(nonce)):
        return fail(redirect_to, is_pkce, "ID token nonce mismatch",
                    error="invalid_request", code="bad_oauth_callback", nonce=nonce)

    try:
        user = await _oauth_sign_in(db, info)
    except AuthFailure:
        return fail(redirect_to, is_pkce, "User is banned",
                    error="access_denied", code="user_banned", nonce=nonce)

    if pkce:
        # Sessiya yalnız `code_verifier` sahibinə veriləcək (/token?grant_type=pkce)
        auth_code = await _issue_pkce_code(user.id, pkce[0], pkce[1], "oauth")
        resp: Response = RedirectResponse(_with_query(redirect_to, {"code": auth_code}),
                                          status_code=302)
    else:
        tokens = await _start_session(db, request, user)
        session = await _session_payload(db, user, tokens)
        fragment = {k: session[k] for k in
                    ("access_token", "expires_at", "expires_in", "refresh_token", "token_type")}
        resp = RedirectResponse(_with_fragment(redirect_to, fragment), status_code=302)
    resp.delete_cookie(_state_cookie(nonce), path=urlsplit(_callback_url(base)).path)
    return resp


# ══ GET /settings, /health ════════════════════════════════════════
@router.get("/settings")
async def gotrue_settings(request: Request) -> dict:
    client_id, client_secret = _google_oauth()
    google = bool(client_id and client_secret and api_external_url(request))
    apple = bool(settings.APPLE_BUNDLE_ID or settings.APPLE_SERVICE_ID)
    return {
        "external": {
            "email": True, "phone": True, "google": google, "apple": apple,
            "anonymous_users": False,
        },
        "disable_signup": False,
        "mailer_autoconfirm": True,
        "phone_autoconfirm": True,
        "sms_provider": "",
        "saml_enabled": False,
    }


@router.get("/health")
async def gotrue_health() -> dict:
    return {
        "name": "GoTrue",
        "version": "ellit-compat",
        "description": "Ellit auth — Supabase Auth (GoTrue) uyğun API",
    }
