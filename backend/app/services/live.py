"""Canlı monitor (admin panel → Canlı monitor): kim indi tətbiqdədir və nə edir.

Redis-də iki struktur (bütün API prosesləri üçün ortaq):

  * presence — `ellit:presence` ZSET (istifadəçi ID → son görülmə, epoch s) və
    hər istifadəçi üçün `ellit:presence:u:<id>` HASH (rol, mobil/veb, son
    hərəkət). Mənbələr: hər tokenli HTTP sorğusu (app/core/activity.py) və
    realtime websocket heartbeat-i (30 s-dən bir — tətbiq açıq olduqca).
    "Onlayn" = son ONLINE_WINDOW saniyədə görünüb.
  * canlı axın — `ellit:live` STREAM (son FEED_MAXLEN hadisə): əməliyyatlar
    ("Yeni sifariş", "Təklif vermə" …), baxışlar ("Sifarişlərə baxır"),
    uğursuz cəhdlər və "Tətbiqi açdı". Bazaya yazılmır — yaddaş məhduddur.

Sorğunu ləngitməmək üçün hər şey fon tapşırığında və proses daxilində
seyrəldilərək (TOUCH_EVERY / VIEW_EVERY) yazılır; Redis xətası sorğuya
təsir etmir. Sorğu gövdəsi, query parametrləri və tokenlər yazılmır.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

log = logging.getLogger("ellit.live")

PRESENCE_KEY = "ellit:presence"
USER_KEY = "ellit:presence:u:"
FEED_KEY = "ellit:live"
FEED_MAXLEN = 3000
ONLINE_WINDOW = 120          # s — bu müddətdə görünən "onlayn" sayılır
TOUCH_EVERY = 20             # s — eyni istifadəçinin presence yazısı (proses daxilində)
VIEW_EVERY = 60              # s — eyni baxış hadisəsi təkrarlanmır
PRESENCE_KEEP = 3 * 86400    # s — köhnə presence qeydləri silinir
BAKU = timezone(timedelta(hours=4))
ADMIN_ROLES = ("admin", "master", "superadmin")

_last_touch: dict[str, float] = {}
_last_view: dict[tuple[str, str], float] = {}
_tasks: set[asyncio.Task] = set()

# GET sorğuları → "nə edir" (yalnız mənalı ekranlar; tez-tez sorğulanan
# bildiriş sayğacı, banner və s. yazılmır)
_VIEWS: list[tuple[str, str]] = [
    ("/rest/v1/opportunities_offers", "Təkliflərə baxır"),
    ("/rest/v1/opportunities", "Sifarişlərə baxır"),
    ("/rest/v1/service_subcategories", "Xidmət seçir"),
    ("/rest/v1/service_categories", "Kateqoriyalara baxır"),
    ("/rest/v1/conversations", "Çatları açıb"),
    ("/rest/v1/messages", "Çatda yazışır"),
    ("/rest/v1/chat_messages", "Çatda yazışır"),
    ("/rest/v1/provider_reviews", "Rəylərə baxır"),
    ("/rest/v1/provider_wallets", "Balansına baxır"),
    ("/rest/v1/wallet_transactions", "Balansına baxır"),
    ("/rest/v1/bookings", "Rezervasiyalara baxır"),
    ("/rest/v1/disputes", "Şikayətlərə baxır"),
    ("/rest/v1/provider_verifications", "KYC bölməsində"),
    ("/rest/v1/brigades", "Briqada bölməsində"),
    ("/rest/v1/withdrawals", "Nağdlaşdırmaya baxır"),
]
_RPC_VIEWS: dict[str, str] = {
    "home_overview": "Ana səhifədə",
    "worker_earnings": "Qazancına baxır",
    "validate_promo_code": "Promo kod yoxlayır",
    "admin_dashboard_stats": "Admin paneldə",
    "admin_live_overview": "Canlı monitorda",
}


def client_kind(headers) -> str:
    """Mobil tətbiq (Flutter/Dart) və ya veb (brauzer)."""
    info = (headers.get("x-client-info") or "").lower()
    ua = (headers.get("user-agent") or "").lower()
    if "flutter" in info or "dart" in info or "dart/" in ua or "dart:io" in ua:
        return "mobile"
    if "supabase-js" in info or "mozilla" in ua:
        return "web"
    return "other"


def view_label(method: str, path: str) -> str | None:
    if method != "GET":
        return None
    for prefix, label in _VIEWS:
        if path.startswith(prefix):
            return label
    return None


def rpc_view_label(path: str) -> str | None:
    if not path.startswith("/rest/v1/rpc/"):
        return None
    return _RPC_VIEWS.get(path[len("/rest/v1/rpc/"):].strip("/"))


def _prune(d: dict, now: float, ttl: float) -> None:
    if len(d) > 20000:
        for k in [k for k, t in d.items() if now - t > ttl]:
            d.pop(k, None)


def spawn(coro) -> None:
    """Fon tapşırığı — sorğunun cavabını gözlətmir, xəta sorğuya təsir etmir."""
    try:
        t = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def touch(uid: str, role: str | None, client: str, *,
                activity: str | None = None, now: float | None = None) -> None:
    """İstifadəçini "onlayn" işarələ (+ son hərəkət). Oflayndan gəlibsə
    canlı axına "Tətbiqi açdı" yazılır."""
    now = now or time.time()
    last = _last_touch.get(uid, 0.0)
    if activity is None and now - last < TOUCH_EVERY:
        return
    _last_touch[uid] = now
    _prune(_last_touch, now, ONLINE_WINDOW)
    from app.db.session import redis

    try:
        fields = {"role": role or "", "client": client, "seen": int(now)}
        if activity:
            fields.update(act=activity, act_at=int(now))
        pipe = redis.pipeline(transaction=False)
        pipe.zscore(PRESENCE_KEY, uid)
        pipe.zadd(PRESENCE_KEY, {uid: now})
        pipe.hset(USER_KEY + uid, mapping=fields)
        pipe.expire(USER_KEY + uid, PRESENCE_KEEP)
        prev = (await pipe.execute())[0]
        if prev is None or now - float(prev) > ONLINE_WINDOW:
            await _feed({"kind": "online", "uid": uid, "role": role or "", "client": client,
                         "label": "Sayta daxil oldu" if client == "web" else "Tətbiqi açdı"},
                        now)
    except Exception as e:  # noqa: BLE001 — presence ikinci dərəcəlidir
        log.debug("presence yazılmadı: %s", e)


async def _feed(item: dict, now: float) -> None:
    from app.db.session import redis

    item = {k: ("" if v is None else str(v)) for k, v in item.items()}
    item["t"] = f"{now:.3f}"
    await redis.xadd(FEED_KEY, item, maxlen=FEED_MAXLEN, approximate=True)


async def on_request(*, method: str, path: str, status: int, ms: int, uid: str | None,
                     role: str | None, client: str, label: str | None,
                     logged: bool) -> None:
    """HTTP sorğusundan sonra (fon tapşırığı): presence + canlı axın."""
    now = time.time()
    try:
        view = view_label(method, path) or rpc_view_label(path)
        activity = None
        if logged and status < 400 and not view:
            activity = label                       # əməliyyat ("Yeni sifariş")
        elif view and status < 400:
            key = (uid or "-", view)
            if now - _last_view.get(key, 0.0) >= VIEW_EVERY:
                _last_view[key] = now
                _prune(_last_view, now, VIEW_EVERY)
                activity = view
            elif uid:
                await touch(uid, role, client, now=now)
                return
        if uid:
            await touch(uid, role, client, activity=activity, now=now)
        if logged or activity:
            kind = ("error" if status >= 500 else "fail" if status >= 400
                    else "view" if activity and activity == view else "action")
            if kind == "view" and (role or "") in ADMIN_ROLES:
                return                    # adminin öz baxışları axını doldurmasın
            await _feed({"kind": kind, "uid": uid, "role": role, "client": client,
                         "label": activity or label or f"{method} {path}",
                         "status": status, "ms": ms,
                         "path": f"{method} {path}"}, now)
    except Exception as e:  # noqa: BLE001
        log.debug("canlı axın yazılmadı: %s", e)


# ── Admin üçün oxuma ───────────────────────────────────────────────
def _today_start() -> float:
    d = datetime.now(BAKU)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


async def presence_snapshot(limit: int = 500) -> dict:
    """Onlayn istifadəçilər (son ONLINE_WINDOW s) + bu günün aktivləri."""
    from app.db.session import redis

    now = time.time()
    await redis.zremrangebyscore(PRESENCE_KEY, "-inf", now - PRESENCE_KEEP)
    pipe = redis.pipeline(transaction=False)
    pipe.zrevrangebyscore(PRESENCE_KEY, "+inf", now - ONLINE_WINDOW,
                          start=0, num=limit, withscores=True)
    pipe.zcount(PRESENCE_KEY, now - ONLINE_WINDOW, "+inf")
    pipe.zcount(PRESENCE_KEY, now - 900, "+inf")
    pipe.zcount(PRESENCE_KEY, _today_start(), "+inf")
    online, n_online, n_15m, n_today = await pipe.execute()
    pipe = redis.pipeline(transaction=False)
    for uid, _ in online:
        pipe.hgetall(USER_KEY + uid)
    metas = await pipe.execute() if online else []
    users = []
    for (uid, seen), meta in zip(online, metas):
        users.append({
            "id": uid, "seen": seen, "role": meta.get("role") or None,
            "client": meta.get("client") or "other",
            "activity": meta.get("act") or None,
            "activity_at": float(meta["act_at"]) if meta.get("act_at") else None,
        })
    return {"online_total": n_online, "active_15m": n_15m, "active_today": n_today,
            "users": users}


async def feed(after: str | None = None, limit: int = 100) -> list[dict]:
    """Canlı axın: `after` verilsə ondan sonrakılar (köhnədən yeniyə),
    yoxsa son `limit` hadisə (yenidən köhnəyə)."""
    from app.db.session import redis

    if after:
        rows = await redis.xrange(FEED_KEY, min=f"({after}", max="+", count=limit)
        rows.reverse()
    else:
        rows = await redis.xrevrange(FEED_KEY, max="+", min="-", count=limit)
    out = []
    for sid, f in rows:
        out.append({
            "id": sid, "t": float(f.get("t") or 0), "kind": f.get("kind") or "action",
            "user": f.get("uid") or None, "role": f.get("role") or None,
            "client": f.get("client") or None, "label": f.get("label") or "",
            "status": int(f["status"]) if f.get("status") else None,
            "ms": int(f["ms"]) if f.get("ms") else None, "path": f.get("path") or None,
        })
    return out


def is_uuid(v: str | None) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except (ValueError, TypeError):
        return False
