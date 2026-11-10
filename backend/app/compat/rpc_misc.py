"""RPC handler-ləri: şikayətlər, KYC, parol bərpası/dəyişməsi.

Qaydalar: app/compat/rpc.py. Hər handler köhnə SQL funksiyasının adını,
arqument adlarını və klientlərin oxuduğu cavab formasını saxlayır
(`{ok: true, ...}` / `{ok: false, error: 'KOD', ...}` — HTTP 200), iş məntiqi
isə mövcud Python portlarındadır:

    open_dispute, add_dispute_evidence      → app/api/v1/disputes.py
    submit_kyc, submit_kyc_renewal          → app/api/v1/kyc.py
    request_password_reset_otp / _email,
    reset_password_with_otp,
    request_password_change_otp,
    verify_password_change_otp              → app/api/v1/password.py

Çağıranın kimliyi həmişə token-dən (ctx.user_id) götürülür — SQL-dəki
auth.uid() qarşılığı; arqumentlərdə istifadəçi id-si qəbul edilmir.
"""
from __future__ import annotations

import re
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from app.api.v1 import disputes, kyc, password
from app.compat.errors import ApiError, RpcError, from_pg
from app.compat.rpc import RpcContext, rpc
from app.models.user import User

_NON_DIGIT = re.compile(r"\D")


# ── Köməkçilər ────────────────────────────────────────────────────
async def _active_user(ctx: RpcContext) -> User | None:
    """Token sahibinin `users` sətri; hesab silinib/deaktiv edilibsə None."""
    if ctx.user_id is None:
        return None
    user = (
        await ctx.db.execute(select(User).where(User.id == ctx.user_id))
    ).scalar_one_or_none()
    return user if user is not None and user.is_active else None


def _uuid(value, arg: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError) as e:
        # PostgREST: uuid-ə çevrilməyən arqument → 22P02
        raise RpcError(f'invalid input syntax for type uuid: "{value}"',
                       code="22P02", details=arg) from e


def _text(value) -> str:
    return "" if value is None else str(value)


def _pg_error(exc: DBAPIError) -> ApiError:
    """Baza məhdudiyyəti pozuntusu (CHECK və s.) → PostgREST formatında xəta."""
    orig = exc.orig
    return from_pg(getattr(orig, "__cause__", None) or orig, True)


# ── Şikayətlər ────────────────────────────────────────────────────
@rpc("open_dispute")
async def open_dispute(ctx: RpcContext, p_opportunity_id: str, p_reason: str,
                       p_description: str) -> dict:
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "NOT_AUTHENTICATED"}
    opp_id = _uuid(p_opportunity_id, "p_opportunity_id")
    try:
        return await disputes.open_dispute_core(
            ctx.db, user_id=user.id, opportunity_id=opp_id,
            reason=_text(p_reason), description=_text(p_description))
    except disputes.DisputeError as e:
        await ctx.db.rollback()
        return {"ok": False, "error": e.code, **e.extra}
    except DBAPIError as e:
        # disputes_reason_check / disputes_description_check (SQL-də də exception idi)
        await ctx.db.rollback()
        raise _pg_error(e) from e


@rpc("add_dispute_evidence")
async def add_dispute_evidence(ctx: RpcContext, p_dispute_id: str, p_file_path: str,
                               p_file_type: str, p_size_bytes: int | None = None) -> dict:
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "NOT_AUTHENTICATED"}
    dispute_id = _uuid(p_dispute_id, "p_dispute_id")
    size: int | None = None
    if p_size_bytes is not None:
        try:
            size = int(p_size_bytes)
        except (ValueError, TypeError) as e:
            raise RpcError(f'invalid input syntax for type integer: "{p_size_bytes}"',
                           code="22P02", details="p_size_bytes") from e
    try:
        return await disputes.add_evidence_core(
            ctx.db, user_id=user.id, dispute_id=dispute_id,
            file_path=_text(p_file_path), file_type=_text(p_file_type), size_bytes=size)
    except disputes.DisputeError as e:
        await ctx.db.rollback()
        return {"ok": False, "error": e.code, **e.extra}
    except DBAPIError as e:
        await ctx.db.rollback()
        raise _pg_error(e) from e


# ── KYC ───────────────────────────────────────────────────────────
@rpc("submit_kyc")
async def submit_kyc(ctx: RpcContext, p_id_front_path: str, p_id_back_path: str,
                     p_selfie_path: str, p_full_name: str | None = None,
                     p_id_number: str | None = None,
                     p_birth_date: str | None = None) -> dict:
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "NOT_AUTHENTICATED"}
    birth: date | None = None
    if p_birth_date:
        try:
            birth = date.fromisoformat(str(p_birth_date)[:10])
        except ValueError as e:
            raise RpcError(f'invalid input syntax for type date: "{p_birth_date}"',
                           code="22007", details="p_birth_date") from e
    try:
        return await kyc.submit_kyc_core(
            ctx.db, user_id=user.id, id_front_path=_text(p_id_front_path),
            id_back_path=_text(p_id_back_path), selfie_path=_text(p_selfie_path),
            full_name_on_id=p_full_name, id_number=p_id_number, birth_date=birth)
    except kyc.KycSubmitError as e:
        await ctx.db.rollback()
        return {"ok": False, "error": e.code}
    except DBAPIError as e:
        await ctx.db.rollback()
        raise _pg_error(e) from e


@rpc("submit_kyc_renewal")
async def submit_kyc_renewal(ctx: RpcContext, p_selfie_path: str) -> dict:
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "NOT_AUTHENTICATED"}
    try:
        # Rol token-dən deyil, bazadan (users.role) — köhnəlmiş token rolu keçməsin
        return await kyc.renewal_core(
            ctx.db, user_id=user.id, role=user.role, selfie_path=_text(p_selfie_path))
    except kyc.KycSubmitError as e:
        await ctx.db.rollback()
        return {"ok": False, "error": e.code}
    except DBAPIError as e:
        await ctx.db.rollback()
        raise _pg_error(e) from e


# ── Parol bərpası / dəyişməsi ─────────────────────────────────────
# password.py xəta kodları → klientlərin budaqlandığı kodlar
# (ForgotPassword.tsx, change_password_screen.dart)
_OTP_CODE_MAP = {"TOO_MANY_REQUESTS": "RATE_LIMITED"}


def _otp_fail(exc: HTTPException) -> dict:
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    code = str(detail.get("code") or "ERROR")
    out: dict = {"ok": False, "error": _OTP_CODE_MAP.get(code, code)}
    if "attempts_left" in detail:
        out["attempts_left"] = detail["attempts_left"]
    return out


def _identifier(value) -> str | None:
    ident = _text(value).strip()
    return ident if 3 <= len(ident) <= 320 else None


@rpc("request_password_reset_otp", anon=True)
async def request_password_reset_otp(ctx: RpcContext, p_email: str) -> dict:
    """"Parolu unutdum" — kod göndərişi. Cavab hesabın mövcudluğunu açmır."""
    ident = _identifier(p_email)
    if ident is not None:
        try:
            await password.reset_request(ctx.db, ident)
        except HTTPException as e:
            return _otp_fail(e)          # yalnız RATE_LIMITED (identifikatora görə)
    return {"ok": True, "channel": "push"}


@rpc("request_password_reset_email", anon=True)
async def request_password_reset_email(ctx: RpcContext, p_identifier: str) -> dict:
    """"Kod gəlmədi?" — kodu hesabın e-poçtuna göndərir; yalnız maskalanmış
    ünvan qayıdır. Hesab/e-poçt yoxdursa SQL-dəki kimi `{ok: true}` (ipucusuz)."""
    ident = _identifier(p_identifier)
    if ident is None:
        return {"ok": True}
    try:
        res = await password.reset_request_email(ctx.db, ident)
    except HTTPException as e:
        fail = _otp_fail(e)
        if fail["error"] == "NO_EMAIL":
            return {"ok": True}          # sadalama qoruması
        return fail                      # RATE_LIMITED | EMAIL_NOT_CONFIGURED | EMAIL_FAILED
    # channel='email_code' — veb səhifə keçid ekranı əvəzinə kod formasını açır
    # (köhnə Supabase funksiyası keçid göndərirdi və bu sahəni qaytarmırdı)
    return {"ok": True, "email_hint": res["email_hint"], "channel": "email_code"}


@rpc("reset_password_with_otp", anon=True)
async def reset_password_with_otp(ctx: RpcContext, p_email: str, p_otp: str,
                                  p_new_password: str) -> dict:
    new_password = _text(p_new_password)
    if len(new_password) < 8:
        return {"ok": False, "error": "PASSWORD_TOO_SHORT"}
    if len(new_password) > 128:
        return {"ok": False, "error": "PASSWORD_TOO_LONG"}
    ident = _identifier(p_email)
    if ident is None:
        return {"ok": False, "error": "NO_OTP"}
    try:
        # SQL: regexp_replace(p_otp, '\D', '', 'g') — yalnız rəqəmlər müqayisə olunur
        await password.reset_confirm(
            ctx.db, ident, _NON_DIGIT.sub("", _text(p_otp)), new_password)
    except HTTPException as e:
        return _otp_fail(e)   # WRONG_CODE(+attempts_left) | EXPIRED | TOO_MANY_ATTEMPTS | NO_OTP
    return {"ok": True}


@rpc("request_password_change_otp")
async def request_password_change_otp(ctx: RpcContext) -> dict:
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "AUTH_REQUIRED"}
    try:
        await password.change_request(ctx.db, user)
    except HTTPException as e:
        return _otp_fail(e)              # RATE_LIMITED
    return {"ok": True}


@rpc("verify_password_change_otp")
async def verify_password_change_otp(ctx: RpcContext, p_otp: str) -> dict:
    """Yalnız kodu yoxlayır (və yandırır). Parolu klient ayrıca
    `auth.updateUser({password})` ilə yazır — SQL funksiyası da belə idi."""
    user = await _active_user(ctx)
    if user is None:
        return {"ok": False, "error": "AUTH_REQUIRED"}
    try:
        await password.change_verify(ctx.db, user, _NON_DIGIT.sub("", _text(p_otp)))
    except HTTPException as e:
        return _otp_fail(e)   # WRONG_CODE(+attempts_left) | EXPIRED | TOO_MANY_ATTEMPTS | NO_OTP
    return {"ok": True}
