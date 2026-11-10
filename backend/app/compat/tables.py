"""PostgREST-uyğun cədvəl sorğuları: /rest/v1/<cədvəl>.

supabase-js / supabase_flutter-in `from('t').select(...).eq(...)` çağırışları
PostgREST URL qrammatikası ilə gəlir. Bu modul həmin qrammatikanı SQL-ə çevirir
və sorğunu **çağıranın RLS konteksti ilə** icra edir (`rls_connection`):
hansı sətirlərin görünüb-dəyişə biləcəyinə PostgreSQL siyasətləri qərar verir.

Dəstəklənənlər (klientlərin faktiki istifadəsi əsasında):
  select    sütunlar, `*`, alias (`a:col`), cast (`col::text`), JSON yolu
            (`col->k->>k2`), iç-içə əlaqələr `alias:rel!hint!inner(...)`
  filtrlər  eq neq gt gte lt lte like ilike is in cs cd ov, `not.` prefiksi,
            `or=(...)` / `and=(...)` (iç-içə), əlaqə üzrə filtr (`rel.col=eq.x`)
  sıra      `order=col.desc.nullslast`, `rel.order=...`; limit/offset, Range
  yazı      POST (insert / upsert: Prefer resolution=..., on_conflict),
            PATCH, DELETE; `Prefer: return=representation` + select
  digər     `Prefer: count=exact` (Content-Range), HEAD, tək obyekt
            (`Accept: application/vnd.pgrst.object+json`)

Təhlükəsizlik:
  * Bütün identifikatorlar (cədvəl/sütun/əlaqə) sxem keşinə qarşı yoxlanır,
    bütün dəyərlər bind parametridir — SQL-ə mətn kimi heç nə yapışdırılmır.
  * PATCH/DELETE filtrsiz qəbul edilmir (Supabase-dəki safeupdate kimi).
  * Backend-in daxili cədvəlləri (users, refresh_sessions ...) ümumiyyətlə görünmür.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qsl

import asyncpg
from fastapi import APIRouter, Request, Response

from app.compat.context import Caller, get_caller, rls_connection
from app.compat.errors import ApiError, from_pg
from app.db.session import engine

router = APIRouter(tags=["compat-rest"])

MAX_ROWS = 1000
_HIDDEN = {"users", "oauth_identities", "refresh_sessions", "alembic_version", "password_otps"}
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_CASTS = {"text", "int", "integer", "int4", "int8", "bigint", "numeric", "float8", "float4",
          "double precision", "date", "timestamp", "timestamptz", "uuid", "boolean", "bool",
          "json", "jsonb"}
_RESERVED = {"select", "order", "limit", "offset", "on_conflict", "columns", "and", "or",
             "not.and", "not.or"}


# ════════════════════════════════ Sxem keşi ════════════════════════════════
@dataclass
class Table:
    name: str
    kind: str                                   # r = cədvəl, v = görünüş
    columns: dict[str, str] = field(default_factory=dict)   # ad → tip (format_type)
    pk: list[str] = field(default_factory=list)


@dataclass
class ForeignKey:
    name: str
    src: str
    src_cols: list[str]
    dst: str
    dst_cols: list[str]


@dataclass
class Schema:
    tables: dict[str, Table]
    fks: list[ForeignKey]
    loaded: float


_schema: Schema | None = None
_SCHEMA_TTL = 300.0


async def load_schema(force: bool = False) -> Schema:
    global _schema
    if _schema is not None and not force and time.monotonic() - _schema.loaded < _SCHEMA_TTL:
        return _schema
    async with engine.connect() as sa_conn:
        conn: asyncpg.Connection = (await sa_conn.get_raw_connection()).driver_connection
        cols = await conn.fetch(
            """
            select c.relname as t, c.relkind::text as kind, a.attname as col,
                   format_type(a.atttypid, a.atttypmod) as typ
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              join pg_attribute a on a.attrelid = c.oid
             where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
               and a.attnum > 0 and not a.attisdropped
             order by c.relname, a.attnum
            """
        )
        pks = await conn.fetch(
            """
            select c.relname as t, a.attname as col
              from pg_index i
              join pg_class c on c.oid = i.indrelid
              join pg_namespace n on n.oid = c.relnamespace
              join unnest(i.indkey) with ordinality k(attnum, ord) on true
              join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
             where n.nspname = 'public' and i.indisprimary
             order by c.relname, k.ord
            """
        )
        fks = await conn.fetch(
            """
            select con.conname as name, c.relname as src, fc.relname as dst,
                   (select array_agg(a.attname order by k.ord)
                      from unnest(con.conkey) with ordinality k(attnum, ord)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as src_cols,
                   (select array_agg(a.attname order by k.ord)
                      from unnest(con.confkey) with ordinality k(attnum, ord)
                      join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as dst_cols
              from pg_constraint con
              join pg_class c on c.oid = con.conrelid
              join pg_class fc on fc.oid = con.confrelid
              join pg_namespace n on n.oid = c.relnamespace
              join pg_namespace fn on fn.oid = fc.relnamespace
             where n.nspname = 'public' and fn.nspname = 'public' and con.contype = 'f'
             order by con.conname
            """
        )
    tables: dict[str, Table] = {}
    for r in cols:
        if r["t"] in _HIDDEN:
            continue
        t = tables.setdefault(r["t"], Table(name=r["t"], kind=r["kind"]))
        t.columns[r["col"]] = r["typ"]
    for r in pks:
        if r["t"] in tables:
            tables[r["t"]].pk.append(r["col"])
    _schema = Schema(
        tables=tables,
        fks=[ForeignKey(r["name"], r["src"], list(r["src_cols"]), r["dst"], list(r["dst_cols"]))
             for r in fks if r["src"] in tables and r["dst"] in tables],
        loaded=time.monotonic(),
    )
    return _schema


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def _bad(message: str, code: str = "PGRST100", status: int = 400, **kw) -> ApiError:
    return ApiError(status, code, message, **kw)


# ════════════════════════════════ Ayrışdırma ═══════════════════════════════
def _split_top(s: str, sep: str = ",") -> list[str]:
    """Mötərizə və qoşa dırnaq daxilini nəzərə alaraq üst səviyyədə bölür."""
    out, depth, quote, cur = [], 0, False, []
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            cur.append(ch)
            if ch == "\\" and i + 1 < len(s):
                cur.append(s[i + 1])
                i += 1
            elif ch == '"':
                quote = False
        elif ch == '"':
            quote = True
            cur.append(ch)
        elif ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            cur.append(ch)
        elif ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    if depth != 0 or quote:
        raise _bad("Sorğu ifadəsində bağlanmamış mötərizə və ya dırnaq var")
    out.append("".join(cur))
    return out


@dataclass
class FieldItem:
    column: str
    path: list[tuple[str, str]]          # [('->', 'k'), ('->>', 'k2')]
    alias: str | None
    cast: str | None


@dataclass
class EmbedItem:
    rel: str
    alias: str | None
    hint: str | None
    inner: bool
    items: list


_FIELD = re.compile(
    r"^(?:(?P<alias>[A-Za-z_][A-Za-z0-9_]*):(?!:))?"
    r"(?P<col>[A-Za-z_][A-Za-z0-9_]*|\*)"
    r"(?P<path>(?:->>?[A-Za-z0-9_]+)*)"
    r"(?:::(?P<cast>[A-Za-z0-9_ ]+))?$"
)
_EMBED = re.compile(
    r"^(?:(?P<alias>[A-Za-z_][A-Za-z0-9_]*):)?"
    r"(?P<rel>[A-Za-z_][A-Za-z0-9_]*)"
    r"(?P<mods>(?:![A-Za-z_][A-Za-z0-9_]*)*)\((?P<body>.*)\)$",
    re.S,
)
_PATH = re.compile(r"(->>?)([A-Za-z0-9_]+)")


def parse_select(s: str) -> list:
    s = re.sub(r"\s+", "", s or "") or "*"
    items: list = []
    for part in _split_top(s):
        if not part:
            continue
        m = _EMBED.match(part)
        if m:
            mods = [x for x in m.group("mods").split("!") if x]
            inner = "inner" in mods
            hint = next((x for x in mods if x not in ("inner", "left")), None)
            items.append(EmbedItem(m.group("rel"), m.group("alias"), hint, inner,
                                   parse_select(m.group("body"))))
            continue
        m = _FIELD.match(part)
        if not m:
            raise _bad(f"select ifadəsi başa düşülmədi: {part[:60]}")
        cast = m.group("cast")
        if cast and cast.lower() not in _CASTS:
            raise _bad(f"İcazəsiz cast: {cast}")
        items.append(FieldItem(m.group("col"), _PATH.findall(m.group("path") or ""),
                               m.group("alias"), cast.lower() if cast else None))
    return items


@dataclass
class Cond:
    """Yarpaq şərt (col op value) və ya məntiqi qrup."""
    kind: str                              # 'leaf' | 'and' | 'or'
    negate: bool = False
    column: str = ""
    path: list = field(default_factory=list)
    op: str = ""
    value: str = ""
    children: list = field(default_factory=list)


_COLREF = re.compile(r"^(?P<col>[A-Za-z_][A-Za-z0-9_]*)(?P<path>(?:->>?[A-Za-z0-9_]+)*)$")
_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "cs", "cd", "ov"}


def _leaf(colref: str, expr: str) -> Cond:
    m = _COLREF.match(colref)
    if not m:
        raise _bad(f"Filtr sütunu başa düşülmədi: {colref[:60]}")
    negate = False
    if expr.startswith("not."):
        negate, expr = True, expr[4:]
    op, sep, value = expr.partition(".")
    if not sep or op not in _OPS:
        raise _bad(f"Dəstəklənməyən filtr operatoru: {expr[:40]}")
    return Cond("leaf", negate, m.group("col"), _PATH.findall(m.group("path") or ""), op, value)


def parse_logic(kind: str, body: str, negate: bool = False) -> Cond:
    body = body.strip()
    if not (body.startswith("(") and body.endswith(")")):
        raise _bad("or/and ifadəsi mötərizədə olmalıdır")
    node = Cond(kind, negate)
    for part in _split_top(body[1:-1]):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(not\.)?(and|or)(\(.*\))$", part, re.S)
        if m:
            node.children.append(parse_logic(m.group(2), m.group(3), bool(m.group(1))))
            continue
        colref, sep, expr = part.partition(".")
        if not sep:
            raise _bad(f"Şərt başa düşülmədi: {part[:60]}")
        node.children.append(_leaf(colref, expr))
    return node


def _unquote(v: str) -> str:
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return re.sub(r"\\(.)", r"\1", v[1:-1])
    return v


def _in_list(value: str) -> list[str]:
    if not (value.startswith("(") and value.endswith(")")):
        raise _bad("in filtri (a,b,c) formasında olmalıdır")
    inner = value[1:-1]
    return [_unquote(x) for x in _split_top(inner)] if inner != "" else []


# ════════════════════════════════ SQL qurucu ═══════════════════════════════
class Builder:
    def __init__(self, schema: Schema) -> None:
        self.schema = schema
        self.args: list = []
        self._alias = 0

    def param(self, value) -> str:
        self.args.append(value)
        return f"${len(self.args)}"

    def alias(self) -> str:
        self._alias += 1
        return f"t{self._alias}"

    def table(self, name: str) -> Table:
        t = self.schema.tables.get(name)
        if t is None:
            raise ApiError(404, "PGRST205",
                           f"Could not find the table 'public.{name}' in the schema cache")
        return t

    def column(self, t: Table, col: str) -> str:
        if col not in t.columns:
            raise ApiError(400, "42703", f"column {t.name}.{col} does not exist")
        return t.columns[col]

    # ── sütun ifadəsi ──
    def colexpr(self, t: Table, a: str, col: str, path: list) -> tuple[str, str]:
        """(SQL ifadəsi, tip) — JSON yolu varsa tip text/jsonb olur."""
        typ = self.column(t, col)
        expr = f"{a}.{_q(col)}"
        if not path:
            return expr, typ
        for arrow, key in path:
            expr += f" {arrow} " + (key if key.isdigit() else "'" + key.replace("'", "''") + "'")
        return f"({expr})", ("text" if path[-1][0] == "->>" else "jsonb")

    # ── şərtlər ──
    def cond_sql(self, t: Table, a: str, c: Cond) -> str:
        if c.kind in ("and", "or"):
            parts = [self.cond_sql(t, a, ch) for ch in c.children]
            if not parts:
                sql = "true" if c.kind == "and" else "false"
            else:
                sql = "(" + f" {c.kind} ".join(parts) + ")"
            return f"not {sql}" if c.negate else sql

        expr, typ = self.colexpr(t, a, c.column, c.path)
        op, v = c.op, c.value
        if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
            sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            sql = f"{expr} {sym} ({self.param(_unquote(v))}::text)::{typ}"
        elif op in ("like", "ilike"):
            sql = f"{expr}::text {op} {self.param(_unquote(v).replace('*', '%'))}::text"
        elif op == "is":
            word = v.lower()
            if word not in ("null", "true", "false", "unknown"):
                raise _bad("is filtri yalnız null/true/false/unknown qəbul edir")
            sql = f"{expr} is {word}"
        elif op == "in":
            sql = f"{expr} = any(({self.param(_in_list(v))}::text[])::{typ}[])"
        else:  # cs / cd / ov
            sym = {"cs": "@>", "cd": "<@", "ov": "&&"}[op]
            if op == "ov" and typ in ("json", "jsonb"):
                raise _bad("ov operatoru yalnız massivlər üçündür")
            if typ.endswith("[]") and v.startswith("(") and v.endswith(")"):
                v = "{" + v[1:-1] + "}"       # (a,b) → {a,b}
            cast = "jsonb" if typ in ("json", "jsonb") else typ
            lhs = f"{expr}::jsonb" if typ == "json" else expr
            sql = f"{lhs} {sym} ({self.param(v)}::text)::{cast}"
        return f"not ({sql})" if c.negate else sql

    # ── əlaqənin həlli ──
    def resolve(self, parent: Table, e: EmbedItem) -> tuple[Table, list[tuple[str, str]], bool]:
        """(hədəf cədvəl, [(parent sütunu, hədəf sütunu)], çoxluq?)"""
        s = self.schema
        cands: list[tuple[ForeignKey, bool]] = []      # (fk, many)
        if e.rel in s.tables:
            for fk in s.fks:
                if fk.src == parent.name and fk.dst == e.rel:
                    cands.append((fk, False))          # çox → bir: obyekt
                if fk.src == e.rel and fk.dst == parent.name:
                    cands.append((fk, True))           # bir → çox: massiv
            if e.hint:
                cands = [(fk, m) for fk, m in cands
                         if fk.name == e.hint or e.hint in fk.src_cols or e.hint in fk.dst_cols]
        else:
            # rel = parent-in FK sütunu və ya FK constraint adı (məs. profiles:customer_id(...))
            for fk in s.fks:
                if fk.src == parent.name and (fk.name == e.rel or fk.src_cols == [e.rel]):
                    cands.append((fk, False))
        if not cands:
            raise ApiError(
                400, "PGRST200",
                f"Could not find a relationship between '{parent.name}' and '{e.rel}'"
                " in the schema cache",
                hint="Xarici açar (FK) tapılmadı")
        # Eyni sütunlar üzrə təkrarlanan FK-lar bir əlaqə sayılır; qalan
        # qeyri-müəyyənlikdə valideynin öz FK-sı (çox → bir) üstün tutulur
        uniq: dict[tuple, tuple[ForeignKey, bool]] = {}
        for fk, m in cands:
            uniq.setdefault((m, tuple(fk.src_cols), tuple(fk.dst_cols), fk.src, fk.dst), (fk, m))
        cands = sorted(uniq.values(), key=lambda x: x[1])
        if len(cands) > 1 and e.alias:
            # Qeyri-müəyyənlikdə alias-a uyğun sütun seçilir (customer → customer_id)
            pref = [(fk, m) for fk, m in cands
                    if any(c == f"{e.alias}_id" or c.startswith(e.alias) for c in
                           (fk.dst_cols if m else fk.src_cols))]
            cands = pref or cands
        fk, many = cands[0]
        target = self.table(fk.src if many else fk.dst)
        pairs = (list(zip(fk.dst_cols, fk.src_cols)) if many
                 else list(zip(fk.src_cols, fk.dst_cols)))
        return target, pairs, many

    # ── select siyahısı (rekursiv) ──
    def fields(self, t: Table, a: str, items: list, embedded: dict, inner_out: list) -> str:
        """`embedded` — əlaqə adı/alias → {filters, order, limit, offset}."""
        out: list[str] = []
        for it in items:
            if isinstance(it, FieldItem):
                if it.column == "*":
                    out.append(f"{a}.*")
                    continue
                expr, _ = self.colexpr(t, a, it.column, it.path)
                if it.cast:
                    expr = f"cast({expr} as {it.cast})"
                name = it.alias or (it.path[-1][1] if it.path else it.column)
                out.append(f"{expr} as {_q(name)}")
                continue
            target, pairs, many = self.resolve(t, it)
            ea = self.alias()
            opts = embedded.get(it.alias or "") or embedded.get(it.rel) or {}
            where = [f"{ea}.{_q(tc)} = {a}.{_q(pc)}" for pc, tc in pairs]
            where += [self.cond_sql(target, ea, c) for c in opts.get("filters", [])]
            sub_inner: list[str] = []
            cols = self.fields(target, ea, it.items, opts.get("nested", {}), sub_inner)
            where += sub_inner
            sub = f"select {cols} from public.{_q(target.name)} as {ea} where " + " and ".join(where)
            if many:
                sub += self.order_sql(target, ea, opts.get("order"))
                if opts.get("limit") is not None:
                    sub += f" limit {int(opts['limit'])}"
                if opts.get("offset"):
                    sub += f" offset {int(opts['offset'])}"
                expr = f"(select coalesce(json_agg(row_to_json(_e)), '[]'::json) from ({sub}) _e)"
            else:
                expr = f"(select row_to_json(_e) from ({sub} limit 1) _e)"
            out.append(f"{expr} as {_q(it.alias or it.rel)}")
            if it.inner:
                inner_out.append(
                    f"exists (select 1 from public.{_q(target.name)} as {ea} where "
                    + " and ".join(where) + ")")
        return ", ".join(out) if out else f"{a}.*"

    def order_sql(self, t: Table, a: str, spec: str | None) -> str:
        if not spec:
            return ""
        parts = []
        for term in _split_top(spec):
            bits = term.strip().split(".")
            m = _COLREF.match(bits[0])
            if not m:
                raise _bad(f"order ifadəsi başa düşülmədi: {term[:40]}")
            expr, _ = self.colexpr(t, a, m.group("col"), _PATH.findall(m.group("path") or ""))
            direction, nulls = "asc", ""
            for b in bits[1:]:
                if b in ("asc", "desc"):
                    direction = b
                elif b == "nullsfirst":
                    nulls = " nulls first"
                elif b == "nullslast":
                    nulls = " nulls last"
                else:
                    raise _bad(f"order ifadəsi başa düşülmədi: {term[:40]}")
            parts.append(f"{expr} {direction}{nulls}")
        return " order by " + ", ".join(parts)


# ════════════════════════════════ Sorğu parametrləri ═══════════════════════
@dataclass
class Query:
    select: str | None = None
    order: str | None = None
    limit: int | None = None
    offset: int = 0
    on_conflict: str | None = None
    columns: str | None = None
    filters: list = field(default_factory=list)          # üst səviyyə Cond-lar
    embedded: dict = field(default_factory=dict)         # rel → opts


def _int(v: str, what: str) -> int:
    try:
        n = int(v)
    except ValueError as e:
        raise _bad(f"{what} tam ədəd olmalıdır") from e
    if n < 0:
        raise _bad(f"{what} mənfi ola bilməz")
    return n


def parse_query(raw_qs: str, range_header: str | None) -> Query:
    q = Query()
    for key, value in parse_qsl(raw_qs, keep_blank_values=True):
        if key == "select":
            q.select = value
        elif key == "order":
            q.order = value
        elif key == "limit":
            q.limit = _int(value, "limit")
        elif key == "offset":
            q.offset = _int(value, "offset")
        elif key == "on_conflict":
            q.on_conflict = value
        elif key == "columns":
            q.columns = value
        elif key in ("and", "or", "not.and", "not.or"):
            q.filters.append(parse_logic(key.split(".")[-1], value, key.startswith("not.")))
        elif "." in key and not re.search(r"->", key.split(".", 1)[0]):
            # əlaqə üzrə: rel.col=eq.x | rel.order=.. | rel.limit=.. | rel.or=(..)
            rel, _, rest = key.partition(".")
            if not _IDENT.match(rel):
                raise _bad(f"Parametr başa düşülmədi: {key[:60]}")
            opts = q.embedded.setdefault(rel, {"filters": []})
            if rest == "order":
                opts["order"] = value
            elif rest == "limit":
                opts["limit"] = _int(value, "limit")
            elif rest == "offset":
                opts["offset"] = _int(value, "offset")
            elif rest in ("and", "or"):
                opts["filters"].append(parse_logic(rest, value))
            else:
                opts["filters"].append(_leaf(rest, value))
        else:
            q.filters.append(_leaf(key, value))
    if range_header and q.limit is None:
        m = re.match(r"^\s*(\d+)-(\d*)\s*$", range_header)
        if m:
            q.offset = int(m.group(1))
            if m.group(2):
                q.limit = max(int(m.group(2)) - q.offset + 1, 0)
    return q


def _prefer(request: Request) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (request.headers.get("prefer") or "").split(","):
        k, _, v = part.strip().partition("=")
        if k:
            out[k.lower()] = v.lower()
    return out


def _wants_object(request: Request) -> bool:
    return "application/vnd.pgrst.object+json" in (request.headers.get("accept") or "")


def _where(b: Builder, t: Table, a: str, q: Query, extra: list[str]) -> str:
    parts = [b.cond_sql(t, a, c) for c in q.filters] + extra
    return (" where " + " and ".join(parts)) if parts else ""


def _inner_conds(b: Builder, t: Table, a: str, items: list, embedded: dict) -> list[str]:
    """`!inner` əlaqələrinin valideyn üçün EXISTS şərtləri (count sorğusu üçün)."""
    out: list[str] = []
    for it in items:
        if isinstance(it, EmbedItem) and it.inner:
            target, pairs, _many = b.resolve(t, it)
            ea = b.alias()
            opts = embedded.get(it.alias or "") or embedded.get(it.rel) or {}
            w = [f"{ea}.{_q(tc)} = {a}.{_q(pc)}" for pc, tc in pairs]
            w += [b.cond_sql(target, ea, c) for c in opts.get("filters", [])]
            w += _inner_conds(b, target, ea, it.items, opts.get("nested", {}))
            out.append(f"exists (select 1 from public.{_q(target.name)} as {ea} where "
                       + " and ".join(w) + ")")
    return out


def _rows_response(rows: list[str], request: Request, status: int,
                   headers: dict | None = None) -> Response:
    if _wants_object(request):
        if len(rows) != 1:
            return ApiError(
                406, "PGRST116",
                "JSON object requested, multiple (or no) rows returned",
                details=f"The result contains {len(rows)} rows").response()
        body = rows[0]
    else:
        body = "[" + ",".join(rows) + "]"
    return Response(content=body, status_code=status, media_type="application/json",
                    headers=headers)


async def _run(caller: Caller, fn):
    """RLS bağlantısında icra + PostgreSQL xətalarının PostgREST formatına çevrilməsi."""
    try:
        async with rls_connection(caller) as conn:
            return await fn(conn)
    except asyncpg.PostgresError as e:
        if getattr(e, "sqlstate", "") in ("42P01", "42703"):
            await load_schema(force=True)        # sxem dəyişibsə keşi təzələ
        raise from_pg(e, caller.authenticated) from e


# ════════════════════════════════ Marşrutlar ═══════════════════════════════
@router.api_route("/{table}", methods=["GET", "HEAD"])
async def read(table: str, request: Request) -> Response:
    try:
        caller = get_caller(request)
        schema = await load_schema()
        q = parse_query(request.url.query, request.headers.get("range"))
        b = Builder(schema)
        t = b.table(table)
        a = "t0"
        items = parse_select(q.select or "*")
        inner: list[str] = []
        cols = b.fields(t, a, items, q.embedded, inner)
        where = _where(b, t, a, q, inner)
        limit = min(q.limit if q.limit is not None else MAX_ROWS, MAX_ROWS)
        head = request.method == "HEAD"
        count_mode = _prefer(request).get("count")
        sql = (f"select row_to_json(_r)::text from (select {cols} from public.{_q(t.name)} as {a}"
               f"{where}{b.order_sql(t, a, q.order)} limit {limit} offset {q.offset}) _r")
        # count: eyni şərtlər, öz parametr siyahısı ilə (select sütunları lazım deyil)
        wb = Builder(schema)
        count_sql = (f"select count(*) from public.{_q(t.name)} as {a}"
                     f"{_where(wb, t, a, q, _inner_conds(wb, t, a, items, q.embedded))}")

        async def work(conn: asyncpg.Connection):
            rows = [] if head else [r[0] for r in await conn.fetch(sql, *b.args)]
            total = None
            if count_mode in ("exact", "planned", "estimated"):
                total = await conn.fetchval(count_sql, *wb.args)
            elif head:
                # HEAD count-suz: yalnız mövcudluq/icazə yoxlaması
                await conn.fetchval(f"select 1 from public.{_q(t.name)} limit 1")
            return rows, total

        rows, total = await _run(caller, work)
        n = len(rows) if not head else (min(total, limit) if total is not None else 0)
        span = f"{q.offset}-{q.offset + n - 1}" if n else "*"
        headers = {"Content-Range": f"{span}/{total if total is not None else '*'}"}
        if head:
            return Response(status_code=200, media_type="application/json", headers=headers)
        return _rows_response(rows, request, 200, headers)
    except ApiError as e:
        return e.response()


async def _json_body(request: Request):
    raw = await request.body()
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError as e:
        raise _bad("Sorğu gövdəsi düzgün JSON deyil", "PGRST102") from e


def _check_cols(b: Builder, t: Table, cols: list[str]) -> None:
    for c in cols:
        if c not in t.columns:
            raise ApiError(
                400, "PGRST204",
                f"Could not find the '{c}' column of '{t.name}' in the schema cache")


def _returning(b: Builder, t: Table, q: Query, mutation: str) -> str:
    """Yazı əməliyyatını CTE-yə büküb `select` ifadəsini nəticəyə tətbiq edir."""
    inner: list[str] = []
    cols = b.fields(t, "t0", parse_select(q.select or "*"), q.embedded, inner)
    return (f"with _m as ({mutation} returning *) select row_to_json(_r)::text"
            f" from (select {cols} from _m as t0) _r")


@router.post("/{table}")
async def insert(table: str, request: Request) -> Response:
    try:
        caller = get_caller(request)
        schema = await load_schema()
        q = parse_query(request.url.query, None)
        prefer = _prefer(request)
        b = Builder(schema)
        t = b.table(table)
        if t.kind != "r":
            raise _bad(f"'{t.name}' görünüşdür — yazı mümkün deyil", "PGRST105", 405)
        body = await _json_body(request)
        rows = body if isinstance(body, list) else ([body] if body is not None else [])
        if not all(isinstance(r, dict) for r in rows):
            raise _bad("Gövdə JSON obyekti və ya obyektlər massivi olmalıdır", "PGRST102")
        representation = prefer.get("return") == "representation"
        if not rows:
            return (_rows_response([], request, 201) if representation
                    else Response(status_code=201))
        cols = ([c for c in q.columns.replace('"', "").split(",") if c] if q.columns
                else list(rows[0].keys()))
        _check_cols(b, t, cols)
        col_list = ", ".join(_q(c) for c in cols)
        payload = b.param(json.dumps(rows))
        if cols:
            sql = (f"insert into public.{_q(t.name)} ({col_list}) select {col_list}"
                   f" from json_populate_recordset(null::public.{_q(t.name)}, ({payload}::text)::json)")
        else:
            sql = f"insert into public.{_q(t.name)} default values"
        resolution = prefer.get("resolution")
        if resolution in ("merge-duplicates", "ignore-duplicates"):
            target = ([c for c in q.on_conflict.replace('"', "").split(",") if c]
                      if q.on_conflict else list(t.pk))
            _check_cols(b, t, target)
            if not target:
                raise _bad("Upsert üçün on_conflict və ya əsas açar lazımdır")
            updates = [c for c in cols if c not in target]
            if resolution == "merge-duplicates" and updates:
                sql += (f" on conflict ({', '.join(_q(c) for c in target)}) do update set "
                        + ", ".join(f"{_q(c)} = excluded.{_q(c)}" for c in updates))
            else:
                sql += f" on conflict ({', '.join(_q(c) for c in target)}) do nothing"

        if representation:
            final = _returning(b, t, q, sql)

            async def work(conn: asyncpg.Connection):
                return [r[0] for r in await conn.fetch(final, *b.args)]

            return _rows_response(await _run(caller, work), request, 201)

        async def work_min(conn: asyncpg.Connection):
            await conn.execute(sql, *b.args)

        await _run(caller, work_min)
        return Response(status_code=201)
    except ApiError as e:
        return e.response()


@router.patch("/{table}")
async def update(table: str, request: Request) -> Response:
    try:
        caller = get_caller(request)
        schema = await load_schema()
        q = parse_query(request.url.query, None)
        prefer = _prefer(request)
        b = Builder(schema)
        t = b.table(table)
        if t.kind != "r":
            raise _bad(f"'{t.name}' görünüşdür — yazı mümkün deyil", "PGRST105", 405)
        body = await _json_body(request)
        if not isinstance(body, dict):
            raise _bad("Gövdə JSON obyekti olmalıdır", "PGRST102")
        representation = prefer.get("return") == "representation"
        cols = list(body.keys())
        _check_cols(b, t, cols)
        if not q.filters:
            raise ApiError(400, "21000", "UPDATE requires a WHERE clause")
        if not cols:
            return (_rows_response([], request, 200) if representation
                    else Response(status_code=204))
        payload = b.param(json.dumps(body))
        sets = ", ".join(f"{_q(c)} = _b.{_q(c)}" for c in cols)
        sql = (f"update public.{_q(t.name)} as t0 set {sets}"
               f" from json_populate_record(null::public.{_q(t.name)}, ({payload}::text)::json) _b"
               f"{_where(b, t, 't0', q, [])}")
        if representation:
            # CTE daxilində `returning *` hər iki cədvəlin sütunlarını verərdi → t0.*
            mutation = sql
            inner: list[str] = []
            sel = b.fields(t, "t0", parse_select(q.select or "*"), q.embedded, inner)
            final = (f"with _m as ({mutation} returning t0.*) select row_to_json(_r)::text"
                     f" from (select {sel} from _m as t0) _r")

            async def work(conn: asyncpg.Connection):
                return [r[0] for r in await conn.fetch(final, *b.args)]

            return _rows_response(await _run(caller, work), request, 200)

        async def work_min(conn: asyncpg.Connection):
            await conn.execute(sql, *b.args)

        await _run(caller, work_min)
        return Response(status_code=204)
    except ApiError as e:
        return e.response()


@router.delete("/{table}")
async def delete(table: str, request: Request) -> Response:
    try:
        caller = get_caller(request)
        schema = await load_schema()
        q = parse_query(request.url.query, None)
        prefer = _prefer(request)
        b = Builder(schema)
        t = b.table(table)
        if t.kind != "r":
            raise _bad(f"'{t.name}' görünüşdür — yazı mümkün deyil", "PGRST105", 405)
        if not q.filters:
            raise ApiError(400, "21000", "DELETE requires a WHERE clause")
        sql = f"delete from public.{_q(t.name)} as t0{_where(b, t, 't0', q, [])}"
        if prefer.get("return") == "representation":
            final = _returning(b, t, q, sql)

            async def work(conn: asyncpg.Connection):
                return [r[0] for r in await conn.fetch(final, *b.args)]

            return _rows_response(await _run(caller, work), request, 200)

        async def work_min(conn: asyncpg.Connection):
            await conn.execute(sql, *b.args)

        await _run(caller, work_min)
        return Response(status_code=204)
    except ApiError as e:
        return e.response()
