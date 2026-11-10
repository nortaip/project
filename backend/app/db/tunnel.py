"""SSH tuneli — PostgreSQL-ə SSH üzərindən şifrəli qoşulma.

Nə üçün: baza ayrı serverdədirsə PostgreSQL portunu (5432) internetə açmaq
lazım gəlmir. Backend serverə SSH ilə qoşulur və lokal bir portu serverdəki
PostgreSQL-ə yönləndirir; SQLAlchemy/alembic həmin lokal porta bağlanır.

    backend ──(127.0.0.1:<lokal port>)──► SSH ──► server ──► 127.0.0.1:5432

Dizayn:
  * Tunel öz event loop-u olan arxa plan thread-ində yaşayır — beləliklə
    həm async API (uvicorn), həm sync alembic eyni kodu işlədir.
  * Bağlantı qopsa avtomatik bərpa olunur (eksponensial gözləmə, max 30s);
    lokal port dəyişmir, ona görə connection pool yenidən qoşula bilir
    (pool_pre_ping ölü bağlantıları özü atır).
  * Host açarı defolt olaraq YOXLANIR (known_hosts və ya fingerprint).
    Yoxlamasız rejim yalnız SSH_STRICT_HOST_KEY=false ilə, açıq şəkildə.
  * Hər uvicorn worker-i öz tunelini açır (SSH_LOCAL_PORT=0 → boş port).

Əl ilə yoxlama:
    python -m app.db.tunnel            # tunel + SELECT version()
    python -m app.db.tunnel --fingerprint   # serverin host açarı izini göstər
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import threading
from dataclasses import dataclass

import asyncssh
from sqlalchemy.engine import make_url

from app.core.config import settings

log = logging.getLogger("ellit.tunnel")


class TunnelError(RuntimeError):
    pass


@dataclass(frozen=True)
class TunnelConfig:
    ssh_host: str
    ssh_port: int
    ssh_user: str
    remote_host: str
    remote_port: int
    password: str = ""
    key_path: str = ""
    key_passphrase: str = ""
    known_hosts: str = ""
    fingerprint: str = ""
    strict_host_key: bool = True
    local_port: int = 0
    keepalive: int = 15
    connect_timeout: int = 15


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _PinnedKeyClient(asyncssh.SSHClient):
    """Host açarını SHA256 izi ilə yoxlayır (known_hosts faylı əvəzinə)."""

    def __init__(self, fingerprint: str) -> None:
        self._fingerprint = fingerprint.strip()

    def validate_host_public_key(self, host, addr, port, key) -> bool:  # noqa: ANN001
        return key.get_fingerprint("sha256") == self._fingerprint


class SSHTunnel:
    """Arxa plan thread-ində yaşayan, özünü bərpa edən lokal port yönləndirməsi."""

    def __init__(self, cfg: TunnelConfig) -> None:
        self.cfg = cfg
        self.local_port = cfg.local_port or _free_port()
        self._ready = threading.Event()
        self._stop = threading.Event()
        self._error: BaseException | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._wake: asyncio.Event | None = None

    # ── bağlantı parametrləri ────────────────────────────────────
    def _connect_kwargs(self) -> dict:
        c = self.cfg
        kw: dict = {
            "host": c.ssh_host,
            "port": c.ssh_port,
            "username": c.ssh_user or None,
            "keepalive_interval": c.keepalive,
            "keepalive_count_max": 3,
            "connect_timeout": c.connect_timeout,
            "login_timeout": c.connect_timeout,
        }
        if c.key_path:
            if not os.path.isfile(c.key_path):
                raise TunnelError(f"SSH açar faylı tapılmadı: {c.key_path}")
            kw["client_keys"] = [c.key_path]
            if c.key_passphrase:
                kw["passphrase"] = c.key_passphrase
        if c.password:
            kw["password"] = c.password
        if not c.key_path and not c.password:
            # Nə açar, nə parol verilib → ssh-agent / ~/.ssh defolt açarları
            pass
        elif not c.key_path:
            kw["client_keys"] = None  # yalnız parol — təsadüfi lokal açar sınanmasın

        if not c.strict_host_key:
            log.warning("SSH host açarı YOXLANMIR (SSH_STRICT_HOST_KEY=false)")
            kw["known_hosts"] = None
        elif c.fingerprint:
            # İz ilə bərkitmə: known_hosts-da olmayan açar yalnız iz uyğun
            # gələrsə qəbul edilir. Yoxlama autentifikasiyadan ƏVVƏL baş verir,
            # yəni parol/açar saxta serverə göndərilmir.
            kw["client_factory"] = lambda: _PinnedKeyClient(c.fingerprint)
            kw["server_host_key_algs"] = "default"
        elif c.known_hosts:
            if not os.path.isfile(c.known_hosts):
                raise TunnelError(f"known_hosts faylı tapılmadı: {c.known_hosts}")
            kw["known_hosts"] = c.known_hosts
        # əks halda asyncssh defoltu: ~/.ssh/known_hosts
        return kw

    async def _open(self) -> asyncssh.SSHClientConnection:
        return await asyncssh.connect(**self._connect_kwargs())

    # ── thread gövdəsi ───────────────────────────────────────────
    async def _serve(self) -> None:
        self._wake = asyncio.Event()
        backoff = 1.0
        while not self._stop.is_set():
            conn = None
            try:
                conn = await self._open()
                listener = await conn.forward_local_port(
                    "127.0.0.1", self.local_port,
                    self.cfg.remote_host, self.cfg.remote_port,
                )
                log.info("SSH tuneli açıqdır: 127.0.0.1:%s → %s → %s:%s",
                         self.local_port, self.cfg.ssh_host,
                         self.cfg.remote_host, self.cfg.remote_port)
                self._error = None
                self._ready.set()
                backoff = 1.0
                closed = asyncio.ensure_future(conn.wait_closed())
                wake = asyncio.ensure_future(self._wake.wait())
                await asyncio.wait({closed, wake}, return_when=asyncio.FIRST_COMPLETED)
                wake.cancel()
                listener.close()
                if self._stop.is_set():
                    conn.close()
                    await closed
                    return
                log.warning("SSH bağlantısı qopdu — bərpa olunur")
            except (OSError, asyncssh.Error, TunnelError, asyncio.TimeoutError) as e:
                self._error = e
                if not self._ready.is_set():
                    # İlk qoşulma alınmadı → start() dərhal xəta versin
                    self._ready.set()
                    return
                log.warning("SSH tuneli qurula bilmədi (%s) — %.0fs sonra təkrar", e, backoff)
            finally:
                if conn is not None:
                    conn.close()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 30.0)

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        try:
            self._loop.run_until_complete(self._serve())
        finally:
            self._loop.close()

    # ── xarici interfeys ─────────────────────────────────────────
    def start(self) -> int:
        """Tuneli açır, lokal portu qaytarır. İlk qoşulma alınmasa TunnelError."""
        if self._thread is not None:
            return self.local_port
        self._thread = threading.Thread(target=self._run, name="ssh-tunnel", daemon=True)
        self._thread.start()
        if not self._ready.wait(self.cfg.connect_timeout + 10):
            self.stop()
            raise TunnelError("SSH tuneli vaxtında açılmadı")
        if self._error is not None:
            err = self._error
            self.stop()
            raise TunnelError(f"SSH tuneli açıla bilmədi: {err}") from err
        return self.local_port

    def stop(self) -> None:
        self._stop.set()
        loop, wake = self._loop, self._wake
        if loop is not None and wake is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(wake.set)
            except RuntimeError:
                pass
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=5)
        self._thread = None


# ── Proses səviyyəli tək tunel ───────────────────────────────────
_tunnel: SSHTunnel | None = None
_lock = threading.Lock()


def tunnel_enabled() -> bool:
    return bool(settings.SSH_HOST.strip())


def _config_from_settings(remote_host: str, remote_port: int) -> TunnelConfig:
    return TunnelConfig(
        ssh_host=settings.SSH_HOST.strip(),
        ssh_port=settings.SSH_PORT,
        ssh_user=settings.SSH_USER.strip(),
        remote_host=remote_host,
        remote_port=remote_port,
        password=settings.SSH_PASSWORD,
        key_path=os.path.expanduser(settings.SSH_KEY_PATH.strip()),
        key_passphrase=settings.SSH_KEY_PASSPHRASE,
        known_hosts=os.path.expanduser(settings.SSH_KNOWN_HOSTS.strip()),
        fingerprint=settings.SSH_HOST_FINGERPRINT.strip(),
        strict_host_key=settings.SSH_STRICT_HOST_KEY,
        local_port=settings.SSH_LOCAL_PORT,
        keepalive=settings.SSH_KEEPALIVE,
        connect_timeout=settings.SSH_CONNECT_TIMEOUT,
    )


def resolve_database_url(url: str | None = None) -> str:
    """İstifadə olunacaq DSN. SSH_HOST verilibsə tunel açılır və DSN-in
    host/portu lokal tunel ucu ilə əvəzlənir; əks halda olduğu kimi qayıdır."""
    global _tunnel
    raw = url or settings.DATABASE_URL
    if not tunnel_enabled():
        return raw
    parsed = make_url(raw)
    with _lock:
        if _tunnel is None:
            _tunnel = SSHTunnel(
                _config_from_settings(parsed.host or "127.0.0.1", parsed.port or 5432)
            )
            _tunnel.start()
        port = _tunnel.local_port
    return parsed.set(host="127.0.0.1", port=port).render_as_string(hide_password=False)


def close_tunnel() -> None:
    global _tunnel
    with _lock:
        if _tunnel is not None:
            _tunnel.stop()
            _tunnel = None


async def fetch_host_fingerprint(host: str, port: int = 22) -> str:
    """Serverin host açarının SHA256 izini qaytarır (giriş etmədən)."""
    key = await asyncssh.get_server_host_key(host, port)
    if key is None:
        raise TunnelError("Server host açarı alına bilmədi")
    return key.get_fingerprint("sha256")


def _cli() -> None:
    import sys

    if not tunnel_enabled():
        raise SystemExit("SSH_HOST təyin olunmayıb (.env)")
    if "--fingerprint" in sys.argv:
        fp = asyncio.run(fetch_host_fingerprint(settings.SSH_HOST.strip(), settings.SSH_PORT))
        print(f"{settings.SSH_HOST}:{settings.SSH_PORT} host açarı izi:\n  {fp}")
        print("Bunu serverdə `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` "
              "çıxışı ilə tutuşdurun, sonra .env-ə yazın:\n"
              f"  SSH_HOST_FINGERPRINT={fp}")
        return

    from sqlalchemy import create_engine, text

    dsn = resolve_database_url().replace("postgresql+asyncpg://", "postgresql://")
    try:
        with create_engine(dsn).connect() as c:
            ver = c.execute(text("select version()")).scalar()
            db = c.execute(text("select current_database()")).scalar()
        print(f"SSH tuneli OK ✓  ({settings.SSH_HOST} → lokal port {make_url(dsn).port})")
        print(f"Baza: {db}\n{ver}")
    finally:
        close_tunnel()


if __name__ == "__main__":
    _cli()
