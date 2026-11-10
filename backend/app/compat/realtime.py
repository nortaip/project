"""Supabase Realtime-uyğun /realtime/v1/websocket — `postgres_changes`.

Klientlər (realtime-js, Dart `realtime_client`) Phoenix kanal protokolu ilə
danışır (vsn=1.0.0, JSON obyekt: {topic, event, payload, ref, join_ref}):

    phoenix / heartbeat                → phx_reply ok
    realtime:<ad> / phx_join           payload.config.postgres_changes = [{event, schema, table, filter?}]
                                       payload.access_token = istifadəçi tokeni
                                       → phx_reply ok {postgres_changes: [{id, ...eyni sahələr}]} + system
    realtime:<ad> / access_token       token yeniləmə
    realtime:<ad> / phx_leave          → phx_reply ok + phx_close
    server → postgres_changes          {ids: [...], data: {schema, table, commit_timestamp, type,
                                        columns, record, old_record, errors}}

Broadcast və presence HEÇ bir klientdə istifadə olunmur — tətbiq edilməyib.

Dəyişiklik axını və təhlükəsizlik
---------------------------------
Nəşr olunan hər cədvəldə `ellit_notify_change` trigger-i var (db/rls.sql):
`pg_notify('ellit_rt', {t, op, pk, id, ts})` — sətrin MƏZMUNU bildirişdə yoxdur.
Hər proses BİR ayrıca asyncpg bağlantısı ilə `LISTEN ellit_rt` edir. Hər hadisə
üçün sətir hər abunəçi istifadəçinin öz RLS konteksti ilə (`rls_connection`)
yenidən oxunur: RLS sətri gizlədirsə, o istifadəçi heç nə almır. Sorğu
istifadəçi başına birdir (soket/kanal başına yox); kanalın `filter`-i oxunmuş
sətrə Python-da tətbiq olunur.

DELETE: sətir artıq yoxdur, yəni kimin onu görə bildiyi yoxlanıla bilməz. Ona
görə (a) yalnız əsas açar göndərilir (`old_record = {pk: id}`), (b) hadisə
yalnız filtri məhz həmin əsas açarla ödənən abunəçilərə (məs. `id=eq.<id>` —
açarı onsuz da bilirdilər) və adminlərə çatdırılır. Qalanlarına DELETE
göndərilmir (Supabase-dən daha sərt: orada DELETE hamıya gedirdi).

Vaxtı bitmiş token: kanal yeni `access_token` gələnə qədər heç nə almır.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import decimal
import itertools
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import asyncpg
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.engine import make_url

from app.compat.context import ADMIN_ROLES, Caller, caller_from_token, rls_connection
from app.compat.errors import ApiError
from app.db.session import engine
from app.db.tunnel import resolve_database_url

log = logging.getLogger("ellit.realtime")
router = APIRouter()

NOTIFY_CHANNEL = "ellit_rt"

# ── Limitlər ──────────────────────────────────────────────────────
MAX_MESSAGE_BYTES = 64 * 1024      # klient mesajı
MAX_CHANNELS_PER_SOCKET = 100
MAX_BINDINGS_PER_CHANNEL = 20
MAX_SOCKETS = 10_000               # proses başına
MAX_SOCKETS_PER_USER = 20          # proses başına
SEND_QUEUE = 256                   # soket başına göndəriş növbəsi (mesaj)
SEND_TIMEOUT = 10.0                # bir mesajın göndərilməsi (san)
IDLE_TIMEOUT = 120.0               # klientdən heartbeat gəlməsə (klient 30 san-dən bir göndərir)
EVENT_QUEUE = 10_000               # emal gözləyən bildirişlər
QUERY_CONCURRENCY = 4              # eyni anda RLS oxunuşları (API pool-unu boğmasın)
QUERY_TIMEOUT_MS = 5000

_EVENTS = ("INSERT", "UPDATE", "DELETE")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_NUMERIC = {"int2", "int4", "int8", "float4", "float8", "numeric", "oid"}
_INTS = {"int2", "int4", "int8", "oid"}
_TIMES = {"timestamptz", "timestamp", "date"}
_PK_CASTS = {"uuid", "int2", "int4", "int8", "text", "varchar"}


# ── Sxem keşi: nəşr olunan cədvəllər və sütunları (kataloqdan) ────
_schema: dict[str, dict[str, str]] | None = None      # cədvəl → {sütun: tip (typname)}

_SCHEMA_SQL = """
select c.relname as tbl, a.attname as col, ty.typname as typ
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type ty on ty.oid = a.atttypid
 where tg.tgname = 'ellit_notify_change' and not tg.tgisinternal
 order by c.relname, a.attnum
"""


async def _load_schema(conn: asyncpg.Connection) -> None:
    global _schema
    tables: dict[str, dict[str, str]] = {}
    for r in await conn.fetch(_SCHEMA_SQL):
        if _IDENT.match(r["tbl"]) and _IDENT.match(r["col"]):
            tables.setdefault(r["tbl"], {})[r["col"]] = r["typ"]
    _schema = tables


async def _get_schema() -> dict[str, dict[str, str]] | None:
    if _schema is None:
        try:
            async with engine.connect() as sa_conn:
                raw = await sa_conn.get_raw_connection()
                await _load_schema(raw.driver_connection)
        except Exception:  # noqa: BLE001
            log.exception("realtime: sxem oxunmadı")
    return _schema


# ── Filtr (`sütun=eq.dəyər`, neq/lt/lte/gt/gte, `in.(a,b)`) ───────
_FILTER = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$", re.S)


def _split_in(body: str) -> list[str]:
    """`(a,"b,c",d)` → ['a', 'b,c', 'd'] (Dart klienti sətirləri dırnağa alır)."""
    if not (body.startswith("(") and body.endswith(")")):
        raise ValueError("in")
    out, cur, quoted, i, s = [], [], False, 0, body[1:-1]
    while i < len(s):
        ch = s[i]
        if quoted and ch == "\\" and i + 1 < len(s):
            cur.append(s[i + 1])
            i += 1
        elif ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append("".join(cur))
    return [v.strip() for v in out] if s.strip() else []


def _coerce(value: Any, typ: str) -> Any:
    """Dəyəri sütun tipinə görə müqayisə oluna bilən formaya salır (alınmasa ValueError)."""
    if typ in _NUMERIC:
        try:
            return decimal.Decimal(str(value))
        except decimal.InvalidOperation as e:
            raise ValueError(str(value)) from e
    if typ == "bool":
        if isinstance(value, bool):
            return value
        low = str(value).lower()
        if low in ("true", "t"):
            return True
        if low in ("false", "f"):
            return False
        raise ValueError(str(value))
    if typ == "uuid":
        return uuid.UUID(str(value))
    if typ in _TIMES:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T", 1))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


@dataclass(frozen=True)
class Filter:
    column: str
    op: str
    typ: str
    values: tuple            # sütun tipinə çevrilmiş dəyər(lər)

    @classmethod
    def parse(cls, raw: str, columns: dict[str, str]) -> "Filter":
        m = _FILTER.match(raw)
        if not m or m.group(1) not in columns:
            raise ValueError(raw)
        column, op, body = m.groups()
        typ = columns[column]
        items = _split_in(body) if op == "in" else [body]
        if len(items) > 100:
            raise ValueError(raw)
        return cls(column, op, typ, tuple(_coerce(v, typ) for v in items))

    def matches(self, record: dict) -> bool:
        raw = record.get(self.column)
        if raw is None:
            return False                      # SQL-də NULL ilə müqayisə heç vaxt doğru deyil
        try:
            v = _coerce(raw, self.typ)
            if self.op == "eq":
                return v == self.values[0]
            if self.op == "neq":
                return v != self.values[0]
            if self.op == "in":
                return v in self.values
            x = self.values[0]
            return {"lt": v < x, "lte": v <= x, "gt": v > x, "gte": v >= x}[self.op]
        except (ValueError, TypeError):
            return False


# ── Soket / kanal vəziyyəti ───────────────────────────────────────
@dataclass(eq=False)
class Binding:
    id: int
    event: str                 # '*' | INSERT | UPDATE | DELETE
    table: str
    filter: Filter | None


@dataclass(eq=False)
class Channel:
    sock: "Socket"
    topic: str
    join_ref: str | None
    bindings: list[Binding] = field(default_factory=list)
    caller: Caller | None = None       # None → token vaxtı bitib (çatdırılma dayanıb)
    exp: float | None = None           # tokenin bitmə vaxtı (anonim üçün None)
    token: str | None = None
    alive: bool = True
    expiry_notified: bool = False

    def live(self, now: float) -> bool:
        return (self.alive and self.caller is not None
                and (self.exp is None or self.exp > now))


_binding_ids = itertools.count(1)
_sockets: set["Socket"] = set()
_by_table: dict[str, set[Channel]] = {}
_user_sockets: dict[uuid.UUID, set["Socket"]] = {}


def _dumps(msg: dict) -> str:
    return json.dumps(msg, ensure_ascii=False, separators=(",", ":"))


class Socket:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.channels: dict[str, Channel] = {}
        self.queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=SEND_QUEUE)
        self.task = asyncio.current_task()
        self.killed = False
        self.close_code = 1000
        self.users: set[uuid.UUID] = set()

    # — göndəriş: heç vaxt bloklanmır; yavaş klient öz soketini itirir —
    def send(self, msg: dict) -> None:
        if self.killed:
            return
        try:
            self.queue.put_nowait(_dumps(msg))
        except asyncio.QueueFull:
            self.kill(1013)

    def kill(self, code: int = 1011) -> None:
        if not self.killed:
            self.killed, self.close_code = True, code
            if self.task is not None:
                self.task.cancel()

    async def writer(self) -> None:
        try:
            while True:
                item = await self.queue.get()
                if item is None:
                    return
                await asyncio.wait_for(self.ws.send_text(item), SEND_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — bağlı/ilişmiş klient
            self.kill(1011)

    def reply(self, topic: str, ref: Any, status: str, response: dict) -> None:
        self.send({"topic": topic, "event": "phx_reply", "ref": ref,
                   "payload": {"status": status, "response": response}})

    def system(self, ch_topic: str, status: str, message: str) -> None:
        self.send({"topic": ch_topic, "event": "system", "ref": None, "payload": {
            "channel": ch_topic.removeprefix("realtime:"), "extension": "postgres_changes",
            "message": message, "status": status}})

    # — identifikasiya —
    def _authenticate(self, ch: Channel, token: Any) -> str | None:
        """Kanalın kimliyini tokendən təyin edir. Xəta mətni və ya None qaytarır."""
        token = token if isinstance(token, str) and token else None
        if token is not None and token == ch.token and ch.caller is not None:
            return None                        # eyni token (heartbeat-də təkrar göndərilir)
        try:
            caller = caller_from_token(token)
        except ApiError:                       # vaxtı bitib → yenilənənə qədər susur
            ch.caller, ch.exp, ch.token = None, None, None
            return "Token has expired"
        uid = caller.user_id
        if uid is not None and self not in _user_sockets.get(uid, ()):
            if len(_user_sockets.get(uid, ())) >= MAX_SOCKETS_PER_USER:
                ch.caller, ch.exp, ch.token = None, None, None
                return "Too many connections for this user"
            _user_sockets.setdefault(uid, set()).add(self)
            self.users.add(uid)
        exp = caller.claims.get("exp") if uid is not None else None
        ch.caller, ch.token = caller, token
        ch.exp = float(exp) if isinstance(exp, (int, float)) else None
        ch.expiry_notified = False
        return None

    # — kanal —
    def _drop(self, ch: Channel) -> None:
        ch.alive = False
        self.channels.pop(ch.topic, None)
        for b in ch.bindings:
            subs = _by_table.get(b.table)
            if subs is not None:
                subs.discard(ch)
                if not subs:
                    _by_table.pop(b.table, None)

    async def _join(self, topic: str, payload: dict, ref: Any, join_ref: Any) -> None:
        old = self.channels.get(topic)
        if old is not None:
            self._drop(old)                    # Phoenix: təkrar join köhnəni əvəz edir
        if len(self.channels) >= MAX_CHANNELS_PER_SOCKET:
            return self.reply(topic, ref, "error", {"reason": "Too many channels"})
        config = payload.get("config")
        wanted = (config.get("postgres_changes") if isinstance(config, dict) else None) or []
        if (not isinstance(wanted, list) or len(wanted) > MAX_BINDINGS_PER_CHANNEL
                or not all(isinstance(w, dict) for w in wanted)):
            return self.reply(topic, ref, "error", {"reason": "Invalid postgres_changes config"})
        for w in wanted:
            for key in ("event", "schema", "table", "filter"):
                if w.get(key) is not None and not isinstance(w[key], str):
                    return self.reply(topic, ref, "error",
                                      {"reason": "Invalid postgres_changes config"})
        schema = await _get_schema()
        if schema is None:
            return self.reply(topic, ref, "error", {"reason": "Realtime is unavailable"})

        ch = Channel(self, topic, str(join_ref) if join_ref is not None else None)
        auth_error = self._authenticate(ch, payload.get("access_token"))
        if auth_error and auth_error != "Token has expired":
            return self.reply(topic, ref, "error", {"reason": auth_error})

        echo, problems = [], []
        for w in wanted:
            bid = next(_binding_ids)
            # klient cavabdakı event/schema/table/filter-i göndərdiyi ilə hərfi müqayisə edir
            echo.append({**{k: w[k] for k in ("event", "schema", "table", "filter") if k in w},
                         "id": bid})
            event, table = w.get("event", ""), w.get("table", "")
            columns = schema.get(table)
            try:
                if (event != "*" and event.upper() not in _EVENTS) or w.get("schema") != "public" \
                        or columns is None:
                    raise ValueError
                flt = Filter.parse(w["filter"], columns) if w.get("filter") else None
            except (ValueError, TypeError):
                problems.append(f"[event: {event}, schema: {w.get('schema')}, table: {table},"
                                f" filters: {w.get('filter') or ''}]")
                continue
            ch.bindings.append(Binding(bid, "*" if event == "*" else event.upper(), table, flt))

        self.channels[topic] = ch
        for b in ch.bindings:
            _by_table.setdefault(b.table, set()).add(ch)
        self.reply(topic, ref, "ok", {"postgres_changes": echo})
        if problems:
            self.system(topic, "error", "Unable to subscribe to changes with given parameters."
                        " Please check Realtime is enabled for the given connect parameters: "
                        + ", ".join(problems))
        elif wanted:
            self.system(topic, "ok", "Subscribed to PostgreSQL")
        if auth_error:
            ch.expiry_notified = True
            self.system(topic, "error", auth_error)

    async def handle(self, msg: dict) -> None:
        topic, event, ref = msg.get("topic"), msg.get("event"), msg.get("ref")
        payload = msg.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        if not isinstance(topic, str) or not isinstance(event, str) or len(topic) > 255:
            return
        if topic == "phoenix":
            if event == "heartbeat":
                self.reply(topic, ref, "ok", {})
            return
        if event == "phx_join":
            return await self._join(topic, payload, ref, msg.get("join_ref") or ref)
        ch = self.channels.get(topic)
        if ch is None:
            if ref is not None:
                self.reply(topic, ref, "error", {"reason": "Channel is not joined"})
            return
        if event == "access_token":
            error = self._authenticate(ch, payload.get("access_token"))
            if error:
                ch.expiry_notified = True
                self.system(topic, "error", error)
        elif event == "phx_leave":
            self._drop(ch)
            self.reply(topic, ref, "ok", {})
            self.send({"topic": topic, "event": "phx_close", "ref": ch.join_ref, "payload": {}})
        elif ref is not None:
            # broadcast / presence və s. — tətbiq edilməyib
            self.reply(topic, ref, "error", {"reason": f"Unsupported event: {event[:40]}"})

    def cleanup(self) -> None:
        for ch in list(self.channels.values()):
            self._drop(ch)
        for uid in self.users:
            socks = _user_sockets.get(uid)
            if socks is not None:
                socks.discard(self)
                if not socks:
                    _user_sockets.pop(uid, None)
        _sockets.discard(self)


@router.websocket("/websocket")
async def websocket_endpoint(ws: WebSocket) -> None:
    if len(_sockets) >= MAX_SOCKETS:
        await ws.close(code=1013)
        return
    await ws.accept()
    sock = Socket(ws)
    _sockets.add(sock)
    writer = asyncio.create_task(sock.writer())
    try:
        while True:
            try:
                frame = await asyncio.wait_for(ws.receive(), IDLE_TIMEOUT)
            except asyncio.TimeoutError:
                sock.close_code = 1001
                break
            if frame["type"] == "websocket.disconnect":
                break
            data = frame.get("text")
            if data is None:
                continue                        # ikili çərçivələr istifadə olunmur
            if len(data) > MAX_MESSAGE_BYTES:
                sock.close_code = 1009
                break
            try:
                msg = json.loads(data)
            except ValueError:
                continue
            if isinstance(msg, dict):
                await sock.handle(msg)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        if not sock.killed:                     # server dayanır
            raise
    finally:
        sock.killed = True
        sock.cleanup()
        writer.cancel()
        try:
            await asyncio.wait_for(ws.close(code=sock.close_code), 2)
        except BaseException:  # noqa: BLE001 — artıq bağlıdır / ilişib
            pass


def _drop_all_sockets(code: int = 1012) -> None:
    """Hadisə itkisi ola bilərdi (dinləyici qopdu / növbə daşdı): klientlər yenidən
    qoşulub abunə olsun (mobil `.stream()` abunədən sonra məlumatı təzədən oxuyur)."""
    for sock in list(_sockets):
        sock.kill(code)


# ── Hadisənin paylanması ──────────────────────────────────────────
_query_sem = asyncio.Semaphore(QUERY_CONCURRENCY)


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


async def _fetch_row(caller: Caller, table: str, pk: str, pk_type: str, pk_value: str) -> dict | None:
    """Sətri MƏHZ bu istifadəçinin RLS konteksti ilə oxuyur (görünmürsə None)."""
    where = (f"t.{_q(pk)} = cast($1 as text)::{pk_type}" if pk_type in _PK_CASTS
             else f"t.{_q(pk)}::text = cast($1 as text)")
    sql = f"select row_to_json(t)::text from public.{_q(table)} t where {where}"
    async with _query_sem:
        async with rls_connection(caller) as conn:
            await conn.execute(f"set local statement_timeout = {QUERY_TIMEOUT_MS}")
            raw = await conn.fetchval(sql, pk_value)
    return json.loads(raw) if raw else None


async def _admin_ids(user_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    async with engine.connect() as sa_conn:
        raw = await sa_conn.get_raw_connection()
        rows = await raw.driver_connection.fetch(
            "select id from public.profiles where id = any($1::uuid[])"
            " and lower(coalesce(role, '')) = any($2::text[])", user_ids, list(ADMIN_ROLES))
    return {r["id"] for r in rows}


def _deliver(items: list[tuple[Channel, Binding]], uid: uuid.UUID | None, data: dict,
             probe: dict, allow_unfiltered: bool = True) -> None:
    """`probe` — filtrlərin yoxlandığı sətir. Kanal başına bir mesaj (ids = uyğun binding-lər)."""
    now = time.time()
    per_channel: dict[Channel, list[int]] = {}
    for ch, b in items:
        if not ch.live(now) or ch.caller.user_id != uid:
            continue                           # sorğu gedərkən çıxıb / token dəyişib / bitib
        if b.filter is None:
            if not allow_unfiltered:
                continue
        elif not b.filter.matches(probe):
            continue
        per_channel.setdefault(ch, []).append(b.id)
    for ch, ids in per_channel.items():
        ch.sock.send({"topic": ch.topic, "event": "postgres_changes", "ref": None,
                      "payload": {"ids": ids, "data": data}})


async def _dispatch(evt: dict) -> None:
    table, op, pk, pk_value, ts = (evt.get(k) for k in ("t", "op", "pk", "id", "ts"))
    columns = (_schema or {}).get(table)
    subs = _by_table.get(table)
    if not subs or columns is None or pk not in columns or op not in _EVENTS or pk_value is None:
        return
    now = time.time()
    groups: dict[uuid.UUID | None, list[tuple[Channel, Binding]]] = {}
    for ch in list(subs):
        if not ch.live(now):
            if ch.alive and not ch.expiry_notified:
                ch.expiry_notified = True
                ch.sock.system(ch.topic, "error", "Token has expired")
            continue
        for b in ch.bindings:
            if b.table == table and b.event in ("*", op):
                groups.setdefault(ch.caller.user_id, []).append((ch, b))
    if not groups:
        return
    pk_type = columns[pk]
    base = {"schema": "public", "table": table, "commit_timestamp": ts, "type": op, "errors": None}

    if op == "DELETE":
        key: Any = int(pk_value) if pk_type in _INTS and str(pk_value).lstrip("-").isdigit() \
            else pk_value
        old = {pk: key}
        data = {**base, "columns": [{"name": pk, "type": pk_type}], "old_record": old}
        try:
            admins = await _admin_ids([u for u in groups if u is not None])
        except Exception:  # noqa: BLE001
            log.exception("realtime: admin yoxlaması alınmadı")
            admins = set()
        for uid, items in groups.items():
            keyed = [(ch, b) for ch, b in items if b.filter is not None and b.filter.column == pk]
            if uid in admins:
                # admin: filtrsiz və ya açar filtri ödənən abunələr
                keyed += [(ch, b) for ch, b in items if b.filter is None]
            _deliver(keyed, uid, data, old)
        return

    column_list = [{"name": c, "type": t} for c, t in columns.items()]

    async def one_user(uid: uuid.UUID | None, items: list[tuple[Channel, Binding]]) -> None:
        try:
            record = await _fetch_row(items[0][0].caller, table, pk, pk_type, str(pk_value))
        except Exception:  # noqa: BLE001
            log.warning("realtime: %s sətri oxunmadı (istifadəçi %s)", table, uid, exc_info=True)
            return
        if record is None:
            return                              # RLS gizlədir (və ya sətir artıq yoxdur)
        data = {**base, "columns": column_list, "record": record}
        if op == "UPDATE":
            data["old_record"] = {pk: record.get(pk)}
        _deliver(items, uid, data, record)

    await asyncio.gather(*(one_user(u, i) for u, i in groups.items()))


# ── LISTEN dinləyicisi ────────────────────────────────────────────
_events: asyncio.Queue[str] | None = None
_tasks: list[asyncio.Task] = []
_listen_conn: asyncpg.Connection | None = None


def _connect_kwargs() -> dict:
    """SQLAlchemy DSN → asyncpg arqumentləri (SSH tuneli varsa lokal uc)."""
    url = make_url(resolve_database_url())
    kw: dict[str, Any] = {"host": url.host, "port": url.port, "user": url.username,
                          "password": url.password, "database": url.database}
    ssl = url.query.get("ssl") or url.query.get("sslmode")
    if ssl:
        kw["ssl"] = ssl
    return {k: v for k, v in kw.items() if v is not None}


def _on_notify(_conn: Any, _pid: int, _channel: str, payload: str) -> None:
    if _events is None:
        return
    try:
        _events.put_nowait(payload)
    except asyncio.QueueFull:
        log.error("realtime: hadisə növbəsi daşdı — klientlər yenidən qoşulacaq")
        while not _events.empty():
            _events.get_nowait()
        _drop_all_sockets()


async def _listen_forever() -> None:
    global _listen_conn
    backoff = 1.0
    first = True
    while True:
        conn: asyncpg.Connection | None = None
        try:
            conn = await asyncpg.connect(**_connect_kwargs(), timeout=10)
            await _load_schema(conn)
            lost = asyncio.Event()
            conn.add_termination_listener(lambda _c: lost.set())
            await conn.add_listener(NOTIFY_CHANNEL, _on_notify)
            _listen_conn = conn
            if not first:
                _drop_all_sockets()             # fasilədə hadisə itə bilərdi
            first, backoff = False, 1.0
            log.info("realtime: LISTEN %s aktivdir", NOTIFY_CHANNEL)
            while not lost.is_set():
                try:
                    await asyncio.wait_for(lost.wait(), 30)
                except asyncio.TimeoutError:
                    # səssiz qopmanı (məs. SSH tuneli) aşkar etmək üçün
                    await asyncio.wait_for(conn.execute("select 1"), 10)
            log.warning("realtime: dinləyici bağlantısı qopdu")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("realtime: dinləyici xətası (%s) — %ss sonra yenidən", e, backoff)
        finally:
            _listen_conn = None
            if conn is not None:
                try:
                    await asyncio.wait_for(conn.close(), 5)
                except BaseException:  # noqa: BLE001
                    conn.terminate()
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


async def _dispatch_forever() -> None:
    assert _events is not None
    while True:
        payload = await _events.get()
        try:
            evt = json.loads(payload)
            if isinstance(evt, dict):
                await _dispatch(evt)            # ardıcıl: hadisələrin sırası qorunur
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("realtime: hadisə emal olunmadı")


async def start() -> None:
    """Tətbiq açılışında çağırılır: LISTEN dinləyicisi + paylayıcı (arxa planda —
    baza hələ hazır deyilsə açılışı saxlamır, özü təkrar cəhd edir)."""
    global _events, _query_sem
    if _tasks:
        return
    _events = asyncio.Queue(maxsize=EVENT_QUEUE)
    _query_sem = asyncio.Semaphore(QUERY_CONCURRENCY)
    _tasks.append(asyncio.create_task(_listen_forever(), name="ellit-rt-listen"))
    _tasks.append(asyncio.create_task(_dispatch_forever(), name="ellit-rt-dispatch"))


async def stop() -> None:
    """Tətbiq bağlananda çağırılır: dinləyici bağlantısı və soketlər bağlanır."""
    global _events
    tasks, _tasks[:] = list(_tasks), []
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _drop_all_sockets(1001)
    _events = None
