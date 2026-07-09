"""Google və Apple Sign-In — ID token-lərin SERVER tərəfdə yoxlanması.

Klient yalnız provayderdən aldığı identity token-i göndərir; biz onu
provayderin açıq açarları ilə yoxlayırıq. Klientə etibar edilmir.
"""
from __future__ import annotations

import time

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import jwt

from app.core.config import settings


class OAuthError(Exception):
    pass


# ── Google ────────────────────────────────────────────────────────
def verify_google_token(token: str) -> dict:
    """Google ID token → {sub, email, name, picture}. Yanlışsa OAuthError."""
    try:
        info = google_id_token.verify_oauth2_token(
            token, google_requests.Request()
        )
    except Exception as e:  # imza/expiry/format xətaları
        raise OAuthError(f"Google token etibarsızdır: {e}") from e

    allowed = settings.google_client_ids_list
    if allowed and info.get("aud") not in allowed:
        raise OAuthError("Google token bu tətbiq üçün deyil (aud uyğunsuz)")
    if not info.get("email_verified", False):
        raise OAuthError("Google email təsdiqlənməyib")
    return {
        "provider": "google",
        "sub": info["sub"],
        "email": info.get("email"),
        "name": info.get("name"),
        "avatar_url": info.get("picture"),
    }


# ── Apple ─────────────────────────────────────────────────────────
_APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
_apple_keys_cache: dict = {"keys": None, "fetched_at": 0.0}


async def _apple_public_keys() -> list[dict]:
    if _apple_keys_cache["keys"] and time.time() - _apple_keys_cache["fetched_at"] < 3600:
        return _apple_keys_cache["keys"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(_APPLE_KEYS_URL)
        resp.raise_for_status()
        keys = resp.json()["keys"]
    _apple_keys_cache.update(keys=keys, fetched_at=time.time())
    return keys


async def verify_apple_token(identity_token: str) -> dict:
    """Apple identity token → {sub, email}. İmza Apple açıq açarı ilə yoxlanır."""
    try:
        header = jwt.get_unverified_header(identity_token)
        keys = await _apple_public_keys()
        key = next((k for k in keys if k["kid"] == header["kid"]), None)
        if key is None:
            raise OAuthError("Apple açarı tapılmadı")
        allowed_aud = [a for a in (settings.APPLE_BUNDLE_ID, settings.APPLE_SERVICE_ID) if a]
        payload = jwt.decode(
            identity_token,
            key,
            algorithms=["RS256"],
            audience=allowed_aud,
            issuer="https://appleid.apple.com",
        )
    except OAuthError:
        raise
    except Exception as e:
        raise OAuthError(f"Apple token etibarsızdır: {e}") from e

    return {
        "provider": "apple",
        "sub": payload["sub"],
        "email": payload.get("email"),
        "name": None,  # Apple adı yalnız ilk dəfə klientdə verir
        "avatar_url": None,
    }
