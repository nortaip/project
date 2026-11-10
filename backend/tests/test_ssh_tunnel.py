"""SSH tuneli testi — proses daxilində qaldırılan real SSH serveri ilə.

Konteynerdə sshd olmadığından asyncssh-in öz server tərəfi istifadə olunur:
protokol baxımından həqiqi SSH serveridir (açar mübadiləsi, host açarı,
parol/açar autentifikasiyası, direct-tcpip port yönləndirməsi).

Yoxlanılır:
  1. açar + host izi (fingerprint) ilə tunel → PostgreSQL sorğusu
  2. yanlış host izi rədd olunur (saxta server qoruması)
  3. known_hosts faylı ilə doğrulama; naməlum host rədd olunur
  4. parol ilə giriş; yanlış parol rədd olunur
  5. bağlantı qopanda tunel özü bərpa olunur (eyni lokal port)
  6. alembic miqrasiyası + bütün E2E paketi tunel üzərindən keçir

İşə salma:  python tests/test_ssh_tunnel.py
(DATABASE_URL — SSH serverindən görünən PostgreSQL ünvanı)
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncssh  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.db.tunnel import SSHTunnel, TunnelConfig, TunnelError  # noqa: E402

SSH_USER, SSH_PASS = "ellit", "tunel-test-parol"
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


class _Server(asyncssh.SSHServer):
    forwarded = 0
    conns: list[asyncssh.SSHServerConnection] = []

    def connection_made(self, conn):  # noqa: ANN001
        _Server.conns.append(conn)

    def begin_auth(self, username: str) -> bool:
        return True

    def password_auth_supported(self) -> bool:
        return True

    def validate_password(self, username: str, password: str) -> bool:
        return username == SSH_USER and password == SSH_PASS

    def connection_requested(self, dest_host, dest_port, orig_host, orig_port):  # noqa: ANN001
        _Server.forwarded += 1
        return True  # asyncssh hədəfə özü qoşulur (standart direct-tcpip)


def _query(port: int, url) -> str:
    dsn = url.set(drivername="postgresql", host="127.0.0.1", port=port)
    eng = create_engine(dsn, pool_pre_ping=True)
    try:
        with eng.connect() as c:
            return c.execute(text("select current_database()")).scalar()
    finally:
        eng.dispose()


async def main() -> None:
    url = make_url(os.environ["DATABASE_URL"])
    remote_host, remote_port = url.host or "127.0.0.1", url.port or 5432
    tmp = tempfile.mkdtemp(prefix="ellit-ssh-")

    host_key = asyncssh.generate_private_key("ssh-ed25519")
    client_key = asyncssh.generate_private_key("ssh-ed25519")
    key_path = os.path.join(tmp, "id_ed25519")
    client_key.write_private_key(key_path)
    os.chmod(key_path, 0o600)
    auth_keys = os.path.join(tmp, "authorized_keys")
    client_key.write_public_key(auth_keys)
    fingerprint = host_key.get_fingerprint("sha256")

    server = await asyncssh.listen(
        "127.0.0.1", 0, server_host_keys=[host_key], server_factory=_Server,
        authorized_client_keys=auth_keys,
    )
    ssh_port = server.get_port()
    known_hosts = os.path.join(tmp, "known_hosts")
    with open(known_hosts, "w") as f:
        f.write(f"[127.0.0.1]:{ssh_port} {host_key.export_public_key().decode()}")
    empty_known = os.path.join(tmp, "known_hosts_empty")
    open(empty_known, "w").close()

    def cfg(**kw) -> TunnelConfig:
        base = dict(ssh_host="127.0.0.1", ssh_port=ssh_port, ssh_user=SSH_USER,
                    remote_host=remote_host, remote_port=remote_port,
                    connect_timeout=8, keepalive=2)
        base.update(kw)
        return TunnelConfig(**base)

    async def open_tunnel(c: TunnelConfig) -> SSHTunnel:
        t = SSHTunnel(c)
        await asyncio.to_thread(t.start)
        return t

    async def expect_refused(c: TunnelConfig) -> str:
        try:
            t = await open_tunnel(c)
        except TunnelError as e:
            return str(e)
        t.stop()
        return ""

    try:
        # ── 1. Açar + host izi ──
        t = await open_tunnel(cfg(key_path=key_path, fingerprint=fingerprint))
        db = await asyncio.to_thread(_query, t.local_port, url)
        check("açar + host izi ilə tunel, PostgreSQL sorğusu", db == url.database, db)
        check("trafik həqiqətən SSH serverindən keçir", _Server.forwarded >= 1)

        # ── 5. Qopma → avtomatik bərpa (eyni port) ──
        port_before = t.local_port
        for conn in list(_Server.conns):
            conn.abort()
        _Server.conns.clear()
        deadline, db2 = time.time() + 20, None
        while time.time() < deadline:
            await asyncio.sleep(0.5)
            try:
                db2 = await asyncio.to_thread(_query, t.local_port, url)
                break
            except Exception:  # noqa: BLE001 — bərpa gözlənilir
                continue
        check("bağlantı qopandan sonra tunel özü bərpa olundu",
              db2 == url.database and t.local_port == port_before)
        t.stop()
        await asyncio.sleep(0.3)
        try:
            await asyncio.to_thread(_query, port_before, url)
            closed = False
        except Exception:  # noqa: BLE001
            closed = True
        check("stop() lokal portu bağlayır", closed)

        # ── 2. Yanlış host izi ──
        err = await expect_refused(cfg(key_path=key_path,
                                       fingerprint="SHA256:" + "A" * 43))
        check("yanlış host izi rədd olunur", "Host key is not trusted" in err, err[:90])

        # ── 3. known_hosts ──
        t = await open_tunnel(cfg(key_path=key_path, known_hosts=known_hosts))
        check("known_hosts ilə doğrulama", await asyncio.to_thread(_query, t.local_port, url) == url.database)
        t.stop()
        err = await expect_refused(cfg(key_path=key_path, known_hosts=empty_known))
        check("naməlum host rədd olunur (boş known_hosts)", bool(err), err[:90])

        # ── 4. Parol ──
        t = await open_tunnel(cfg(password=SSH_PASS, fingerprint=fingerprint))
        check("parol ilə giriş", await asyncio.to_thread(_query, t.local_port, url) == url.database)
        t.stop()
        err = await expect_refused(cfg(password="sehv-parol", fingerprint=fingerprint))
        check("yanlış parol rədd olunur", "Permission denied" in err, err[:90])
        err = await expect_refused(cfg(ssh_port=1, key_path=key_path, fingerprint=fingerprint))
        check("əlçatmaz SSH serveri aydın xəta verir", "açıla bilmədi" in err, err[:90])

        # ── 6. Miqrasiya + tam E2E paket tunel üzərindən ──
        env = dict(os.environ)
        env.update({
            "SSH_HOST": "127.0.0.1", "SSH_PORT": str(ssh_port), "SSH_USER": SSH_USER,
            "SSH_KEY_PATH": key_path, "SSH_HOST_FINGERPRINT": fingerprint,
        })
        before = _Server.forwarded

        async def run(*cmd: str) -> tuple[int, str]:
            p = await asyncio.create_subprocess_exec(
                *cmd, cwd=BACKEND_DIR, env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            out, _ = await p.communicate()
            return p.returncode, out.decode("utf-8", "replace")

        rc, out = await run(sys.executable, "-m", "app.db.tunnel")
        check("`python -m app.db.tunnel` əl yoxlaması", rc == 0 and "SSH tuneli OK" in out,
              out.strip().splitlines()[-1][:90] if out.strip() else "")
        rc, out = await run(sys.executable, "-m", "alembic", "upgrade", "head")
        check("alembic miqrasiyası tunel üzərindən", rc == 0, out[-200:])
        if "--skip-e2e" not in sys.argv:
            for script, marker in (("tests/e2e_smoke.py", "BÜTÜN E2E TESTLƏR KEÇDİ"),
                                   ("tests/e2e_auth_recovery.py", "AUTH BƏRPA E2E TESTLƏRİ KEÇDİ")):
                rc, out = await run(sys.executable, script)
                check(f"{script} tunel üzərindən", rc == 0 and marker in out, out[-300:] if rc else "")
            check("E2E sorğuları SSH üzərindən getdi",
                  _Server.forwarded - before >= 3, f"{_Server.forwarded - before} yönləndirmə")
    finally:
        server.close()

    print("\nSSH TUNEL TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
