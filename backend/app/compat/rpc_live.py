"""Canlı monitor RPC-ləri (admin panel → Canlı monitor).

  admin_live_overview(p_cell_km, p_category_id) — saylar, xəritə nöqtələri
      (onlayn ustalar, usta gözləyən sifarişlər), tələb/təklif əmsalı zonaları
      və indi tətbiqdə olan istifadəçilər;
  admin_live_feed(p_after, p_limit)              — canlı axın (Redis stream).

Əmsal (Uber "surge" kimi), hər altıbucaqlı zona üçün:
    tələb  = zonada usta gözləyən sifarişlər (son 3 gün, hələ usta seçilməyib)
    təklif = zonada onlayn və boş ustalar (botlar və hazırda işdə olanlar sayılmır)
    əmsal  = tələb / max(təklif, 0.5), 1.0 … 3.0 aralığına salınır
  → x1.0 yaşıl (usta kifayətdir), x1.5+ sarı, x2.0+ narıncı, x2.5+ qırmızı.
Əmsal yalnız göstəricidir — qiymətlərə avtomatik təsir etmir.
"""
from __future__ import annotations

import math
import time
import uuid
from typing import Any

from sqlalchemy import text

from app.compat.rpc import rpc
from app.compat.rpc_admin import AdminCtx, _db_admin
from app.services import live

WAITING = ("pending", "open", "new", "active")
ACTIVE_JOB = ("accepted", "i-am-here", "ongoing")
BOT_EMAIL = "bot_provider_%@ellit.bot"
COEF_MAX = 3.0
_KM_LAT = 110.574


def _num(v: Any, default: float, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return min(max(x, lo), hi) if math.isfinite(x) else default


def _cat(v: Any) -> str | None:
    if v in (None, ""):
        return None
    try:
        return str(uuid.UUID(str(v)))
    except ValueError:
        return None


# ── Altıbucaqlı tor (uclu-yuxarı, eksenel koordinatlar) ───────────
class HexGrid:
    def __init__(self, cell_km: float, lat0: float) -> None:
        self.s = cell_km / math.sqrt(3)            # mərkəzdən küncə (zonanın eni = cell_km)
        self.kx = 111.320 * math.cos(math.radians(lat0))

    def _xy(self, lat: float, lng: float) -> tuple[float, float]:
        return lng * self.kx, lat * _KM_LAT

    def _ll(self, x: float, y: float) -> list[float]:
        return [round(y / _KM_LAT, 6), round(x / self.kx, 6)]

    def cell(self, lat: float, lng: float) -> tuple[int, int]:
        x, y = self._xy(lat, lng)
        q = (math.sqrt(3) / 3 * x - y / 3) / self.s
        r = (2 / 3 * y) / self.s
        # kub koordinatlarında yuvarlaqlaşdırma
        cx, cz = q, r
        cy = -cx - cz
        rx, ry, rz = round(cx), round(cy), round(cz)
        dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
        if dx > dy and dx > dz:
            rx = -ry - rz
        elif dy <= dz:
            rz = -rx - ry
        return int(rx), int(rz)

    def center(self, q: int, r: int) -> tuple[float, float]:
        return self.s * (math.sqrt(3) * q + math.sqrt(3) / 2 * r), self.s * 1.5 * r

    def polygon(self, q: int, r: int) -> list[list[float]]:
        x, y = self.center(q, r)
        return [self._ll(x + self.s * math.cos(math.radians(60 * i - 30)),
                         y + self.s * math.sin(math.radians(60 * i - 30)))
                for i in range(6)]


def coefficient(demand: int, supply: int) -> float:
    if demand <= 0:
        return 1.0
    return round(min(max(demand / max(supply, 0.5), 1.0), COEF_MAX), 1)


def zones(providers: list[dict], orders: list[dict], cell_km: float) -> list[dict]:
    pts = [(p["lat"], p["lng"]) for p in providers] + [(o["lat"], o["lng"]) for o in orders]
    if not pts:
        return []
    lat0 = sorted(p[0] for p in pts)[len(pts) // 2]
    grid = HexGrid(cell_km, lat0)
    acc: dict[tuple[int, int], dict] = {}
    for p in providers:
        if p["bot"] or p["busy"]:
            continue
        z = acc.setdefault(grid.cell(p["lat"], p["lng"]), {"demand": 0, "supply": 0, "new_1h": 0})
        z["supply"] += 1
    now = time.time()
    for o in orders:
        z = acc.setdefault(grid.cell(o["lat"], o["lng"]), {"demand": 0, "supply": 0, "new_1h": 0})
        z["demand"] += 1
        if o["created_ts"] and now - o["created_ts"] <= 3600:
            z["new_1h"] += 1
    out = []
    for (q, r), z in acc.items():
        x, y = grid.center(q, r)
        coef = coefficient(z["demand"], z["supply"])
        out.append({"id": f"{q},{r}", "center": grid._ll(x, y), "polygon": grid.polygon(q, r),
                    **z, "coefficient": coef})
    out.sort(key=lambda z: (-z["coefficient"], -z["demand"]))
    return out


async def _names(db, ids: list[str]) -> dict[str, dict]:
    ids = [i for i in dict.fromkeys(ids) if live.is_uuid(i)]
    if not ids:
        return {}
    rows = (await db.execute(text(
        "select p.id::text as id, p.name, p.email, p.role,"
        "       (select d.platform from user_devices d where d.user_id = p.id"
        "         order by d.last_seen desc nulls last limit 1) as platform"
        "  from profiles p where p.id = any(cast(:ids as uuid[]))"), {"ids": ids})).mappings()
    return {r["id"]: dict(r) for r in rows}


@rpc("admin_live_overview", admin=True)
@_db_admin
async def admin_live_overview(a: AdminCtx, p_cell_km=2, p_category_id=None):
    db = a.db
    cell_km = _num(p_cell_km, 2.0, 0.5, 20.0)
    cat = _cat(p_category_id)

    cats = {r.id: r.label for r in (await db.execute(text(
        "select id::text as id, label from service_categories"))).all()}

    prov_rows = (await db.execute(text(
        "select p.id::text as id, p.name, p.latitude as lat, p.longitude as lng,"
        "       p.last_seen_at, p.specialties, p.avatar_url,"
        "       (coalesce(p.is_bot, false) or coalesce(p.email, '') like :bot) as bot,"
        "       exists(select 1 from opportunities o where o.provider_id = p.id"
        "              and o.status = any(cast(:active as text[]))) as busy"
        "  from profiles p"
        " where p.role = 'provider' and p.is_online"
        "   and p.latitude is not null and p.longitude is not null"
        "   and (cast(:cat as text) is null or p.specialties @> array[cast(:cat as text)])"
        " order by p.last_seen_at desc nulls last limit 3000"),
        {"bot": BOT_EMAIL, "active": list(ACTIVE_JOB), "cat": cat})).mappings().all()

    order_rows = (await db.execute(text(
        "select o.id::text as id, o.title, o.status, o.location,"
        "       cast(o.latitude as float8) as lat, cast(o.longitude as float8) as lng,"
        "       o.created_at, extract(epoch from o.created_at) as created_ts,"
        "       o.category_id::text as category_id, o.created_by::text as created_by,"
        "       (select count(*) from opportunities_offers f"
        "         where f.opportunity_id = o.id) as offers"
        "  from opportunities o"
        " where o.status = any(cast(:waiting as text[])) and o.provider_id is null"
        "   and o.created_at > now() - interval '3 days'"
        "   and o.latitude is not null and o.longitude is not null"
        "   and (cast(:cat as text) is null or o.category_id = cast(:cat as uuid))"
        " order by o.created_at desc limit 3000"),
        {"waiting": list(WAITING), "cat": cat})).mappings().all()

    c = (await db.execute(text(
        "with t as (select (date_trunc('day', now() at time zone 'Asia/Baku')"
        "                   at time zone 'Asia/Baku') as d0)"
        "select"
        " (select count(*) from opportunities, t where created_at >= t.d0) as orders_today,"
        " (select count(*) from opportunities where created_at > now() - interval '1 hour')"
        "   as orders_1h,"
        " (select count(*) from opportunities_offers, t where created_at >= t.d0) as offers_today,"
        " (select count(*) from opportunities where status = any(cast(:active as text[])))"
        "   as jobs_active,"
        " (select count(*) from opportunities where status = 'pending_review') as pending_review,"
        " (select count(*) from opportunities, t where status = 'completed'"
        "   and coalesce(completed_at, created_at) >= t.d0) as completed_today,"
        " (select count(*) from profiles, t where created_at >= t.d0) as signups_today,"
        " (select count(*) from opportunities where status = any(cast(:waiting as text[]))"
        "   and provider_id is null and created_at > now() - interval '3 days') as orders_waiting"),
        {"active": list(ACTIVE_JOB), "waiting": list(WAITING)})).mappings().one()

    try:
        pres = await live.presence_snapshot()
    except Exception:  # noqa: BLE001 — Redis əlçatmazdırsa qalan məlumat yenə göstərilsin
        pres = {"online_total": 0, "active_15m": 0, "active_today": 0, "users": [],
                "unavailable": True}
    in_app = {u["id"]: u for u in pres["users"]}

    providers = [{
        "id": r["id"], "name": r["name"], "lat": float(r["lat"]), "lng": float(r["lng"]),
        "bot": bool(r["bot"]), "busy": bool(r["busy"]), "in_app": r["id"] in in_app,
        "avatar_url": r["avatar_url"],
        "last_seen_at": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
        "categories": [cats[s] for s in (r["specialties"] or []) if s in cats][:4],
    } for r in prov_rows]
    orders = [{
        "id": r["id"], "title": r["title"], "status": r["status"], "location": r["location"],
        "lat": r["lat"], "lng": r["lng"], "offers": int(r["offers"] or 0),
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "created_ts": float(r["created_ts"]) if r["created_ts"] is not None else None,
        "category": cats.get(r["category_id"] or ""), "created_by": r["created_by"],
    } for r in order_rows]

    names = await _names(db, list(in_app))
    users = []
    for u in pres["users"]:
        n = names.get(u["id"], {})
        users.append({**u, "name": n.get("name"), "email": n.get("email"),
                      "role": n.get("role") or u["role"], "platform": n.get("platform")})

    by_role: dict[str, int] = {}
    by_client: dict[str, int] = {}
    for u in users:
        by_role[u["role"] or "?"] = by_role.get(u["role"] or "?", 0) + 1
        by_client[u["client"]] = by_client.get(u["client"], 0) + 1

    real = [p for p in providers if not p["bot"]]
    free = [p for p in real if not p["busy"]]
    zs = zones(providers, orders, cell_km)
    return {
        "generated_at": time.time(),
        "cell_km": cell_km,
        "category_id": cat,
        "counts": {
            "providers_online": len(real),
            "providers_free": len(free),
            "providers_busy": len(real) - len(free),
            "providers_bots": len(providers) - len(real),
            "in_app_total": pres["online_total"],
            "customers_in_app": by_role.get("customer", 0),
            "providers_in_app": by_role.get("provider", 0),
            "admins_in_app": sum(by_role.get(r, 0) for r in ("admin", "master", "superadmin")),
            "mobile_in_app": by_client.get("mobile", 0),
            "web_in_app": by_client.get("web", 0),
            "active_15m": pres["active_15m"],
            "active_today": pres["active_today"],
            **{k: int(v or 0) for k, v in c.items()},
        },
        "city": {"demand": len(orders), "supply": len(free),
                 "coefficient": coefficient(len(orders), len(free))},
        "presence_unavailable": bool(pres.get("unavailable")),
        "providers": providers,
        "orders": orders,
        "zones": zs,
        "users": users,
    }


@rpc("admin_live_feed", admin=True)
@_db_admin
async def admin_live_feed(a: AdminCtx, p_after=None, p_limit=80):
    after = str(p_after) if p_after not in (None, "") else None
    if after is not None and not all(ch.isdigit() or ch == "-" for ch in after):
        after = None
    limit = int(_num(p_limit, 80, 1, 300))
    items = await live.feed(after, limit)
    names = await _names(a.db, [i["user"] for i in items if i["user"]])
    for i in items:
        n = names.get(i["user"] or "", {})
        i["name"] = n.get("name")
        i["email"] = n.get("email")
        if n.get("role"):
            i["role"] = n["role"]
    return {"items": items, "last_id": items[0]["id"] if items else after}
