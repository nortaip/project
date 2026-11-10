// Əsl @supabase/supabase-js klienti ilə Storage + Realtime yoxlaması.
//
// İşə salma (server artıq işləyir, baza təmizdir):
//   node tests/js/storage_realtime_client.mjs http://127.0.0.1:18102 \
//        postgresql://ellit@127.0.0.1:55432/ellit_storage_rt
// İkinci arqument (və ya PG_DSN) — test sətirlərini SQL ilə yazmaq üçün (psql).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BASE = (process.argv[2] || 'http://127.0.0.1:18102').replace(/\/$/, '');
const DSN = process.argv[3] || process.env.PG_DSN;
if (!DSN) {
  console.error('PostgreSQL DSN lazımdır (2-ci arqument və ya PG_DSN)');
  process.exit(2);
}
const ANON = 'anon-key-placeholder';

function check(name, cond, extra = '') {
  console.log(`  [${cond ? '✓' : '✗ FAIL'}] ${name} ${extra}`);
  if (!cond) {
    console.error(`TEST UĞURSUZ: ${name}`);
    process.exit(1);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q, ...params) => {
  // parametrlər psql dəyişənləri kimi ötürülür (:'p1') — SQL-ə mətn kimi yapışdırılmır
  const args = [DSN, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'];
  params.forEach((p, i) => args.push('-v', `p${i + 1}=${p}`));
  return execFileSync('psql', args, { input: q, encoding: 'utf8' }).trim();
};

async function register(tag, role) {
  const r = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `js-${tag}-${randomUUID().slice(0, 8)}@test.az`,
                           password: 'Guclu!Parol1', name: `JS ${tag}`, role }),
  });
  const body = await r.json();
  check(`qeydiyyat (${tag})`, r.status === 201);
  return { id: String(body.user_id), token: body.access_token };
}

function client(user) {
  const c = createClient(BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${user.token}` } },
  });
  c.realtime.setAuth(user.token);
  return c;
}

function subscribe(c, name, opts, onEvent) {
  return new Promise((resolve, reject) => {
    const ch = c.channel(name)
      .on('postgres_changes', opts, onEvent)
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve(ch);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err || new Error(status));
      });
  });
}

async function waitFor(pred, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await sleep(25);
  }
  return null;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(300).fill(7)]);

async function main() {
  console.log(`── supabase-js → ${BASE} ──`);
  const A = await register('a', 'customer');
  const B = await register('b', 'customer');
  const sa = client(A);
  const sb = client(B);

  console.log('\n── Storage ──');
  const path = `${A.id}/js-${Date.now()}.png`;
  const bucket = sa.storage.from('opportunity-photos');
  let { data, error } = await bucket.upload(path, new Blob([PNG], { type: 'image/png' }),
                                            { cacheControl: '3600', upsert: false });
  check('upload (Blob → multipart)', !error && data?.path === path && data?.fullPath === `opportunity-photos/${path}`,
        JSON.stringify(error || data));
  ({ data, error } = await bucket.upload(path, new Blob([PNG], { type: 'image/png' })));
  check('dublikat upload → error (409 Duplicate)', error && /already exists/.test(error.message || ''),
        JSON.stringify(error));
  const rawPath = `${A.id}/js-raw-${Date.now()}.png`;
  ({ data, error } = await bucket.upload(rawPath, PNG.buffer, { contentType: 'image/png' }));
  check('upload (ArrayBuffer → xam gövdə)', !error && data?.path === rawPath, JSON.stringify(error));
  ({ error } = await sb.storage.from('opportunity-photos').upload(`${A.id}/hijack.png`,
                                                                   new Blob([PNG], { type: 'image/png' })));
  check('başqasının qovluğuna upload → error', !!error, JSON.stringify(error));
  ({ error } = await bucket.upload(`${A.id}/fake.png`, new Blob(['<html>not png</html>'], { type: 'image/png' })));
  check('saxta məzmun (image/png elan edilib, HTML) → error', !!error && /mime type/.test(error.message),
        JSON.stringify(error));

  const { data: pub } = bucket.getPublicUrl(path);
  check('getPublicUrl formatı', pub.publicUrl === `${BASE}/storage/v1/object/public/opportunity-photos/${path}`,
        pub.publicUrl);
  let r = await fetch(pub.publicUrl);
  const got = new Uint8Array(await r.arrayBuffer());
  check('public URL fetch → eyni baytlar', r.status === 200 && got.length === PNG.length
        && got.every((v, i) => v === PNG[i]) && r.headers.get('content-type') === 'image/png');
  ({ data, error } = await bucket.createSignedUrl(path, 60));
  check('createSignedUrl', !error && data?.signedUrl?.startsWith(`${BASE}/storage/v1/object/sign/opportunity-photos/`),
        JSON.stringify(error));
  r = await fetch(data.signedUrl);
  check('imzalı URL fetch → 200', r.status === 200);
  ({ data, error } = await bucket.download(path));
  check('download (Bearer)', !error && data && data.size === PNG.length, JSON.stringify(error));

  ({ data, error } = await sb.storage.from('opportunity-photos').remove([path]));
  check('başqası remove → [] (heç nə silinmir)', !error && Array.isArray(data) && data.length === 0);
  ({ data, error } = await bucket.remove([path, rawPath]));
  check('remove → silinən obyektlər', !error && data.length === 2 && data.some((o) => o.name === path),
        JSON.stringify(error || data));
  r = await fetch(pub.publicUrl);
  const errBody = await r.json();
  check('silinmiş fayl → 404 {statusCode, error, message}', r.status === 404 && errBody.statusCode === '404'
        && typeof errBody.message === 'string');
  ({ error } = await sa.storage.from('no-such-bucket').upload('x.png', new Blob([PNG], { type: 'image/png' })));
  check('naməlum bucket → error', !!error && /Bucket not found/.test(error.message), JSON.stringify(error));

  console.log('\n── Realtime (postgres_changes) ──');
  const filtered = [];
  const unfiltered = [];
  const chA = await subscribe(sa, `notifications_user_${A.id}`,
    { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${A.id}` },
    (p) => filtered.push(p));
  check('filtrli kanal SUBSCRIBED', !!chA);
  const chAll = await subscribe(sa, 'all-notifications',
    { event: '*', schema: 'public', table: 'notifications' }, (p) => unfiltered.push(p));
  check('filtrsiz kanal SUBSCRIBED', !!chAll);
  const otherSide = [];
  await subscribe(sb, `notifications_user_${B.id}`,
    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${B.id}` },
    (p) => otherSide.push(p));

  // dinləyici açılışdan dərhal sonra hazır olmaya bilər — isinma
  let warm = null;
  for (let i = 0; i < 40 && !warm; i++) {
    sql(`insert into notifications (user_id, title) values (:'p1', 'isinma')`, A.id);
    warm = await waitFor(() => filtered.find((p) => p.new?.title === 'isinma'), 300);
  }
  check('realtime işləyir (isinma)', !!warm);
  await sleep(300);
  filtered.length = 0;
  unfiltered.length = 0;

  const title = `JS bildiriş ${randomUUID().slice(0, 6)}`;
  const nid = sql(`insert into notifications (user_id, title, type) values (:'p1', :'p2', 'info') returning id`,
                  A.id, title);
  const ev = await waitFor(() => filtered.find((p) => p.new?.id === nid));
  check('callback INSERT ilə çağırıldı, payload.new düzgündür',
        ev && ev.eventType === 'INSERT' && ev.schema === 'public' && ev.table === 'notifications'
        && ev.new.user_id === A.id && ev.new.title === title && ev.new.is_read === false
        && typeof ev.commit_timestamp === 'string', JSON.stringify(ev)?.slice(0, 200));
  check('filtrsiz kanal da aldı', !!(await waitFor(() => unfiltered.find((p) => p.new?.id === nid))));

  sql(`update notifications set is_read = true where id = :'p1'`, nid);
  const upd = await waitFor(() => filtered.find((p) => p.eventType === 'UPDATE' && p.new?.id === nid));
  check('UPDATE: payload.new.is_read === true, payload.old yalnız id',
        upd && upd.new.is_read === true && JSON.stringify(upd.old) === JSON.stringify({ id: nid }),
        JSON.stringify(upd?.old));

  const bTitle = `B-nin gizli bildirişi ${randomUUID().slice(0, 6)}`;
  sql(`insert into notifications (user_id, title) values (:'p1', :'p2')`, B.id, bTitle);
  check('B öz bildirişini aldı', !!(await waitFor(() => otherSide.find((p) => p.new?.title === bTitle))));
  await sleep(1500);
  const leaked = [...filtered, ...unfiltered].find((p) => p.new?.title === bTitle);
  check('A başqa istifadəçinin sətri üçün HEÇ BİR hadisə almadı', !leaked, JSON.stringify(leaked));

  await sa.removeAllChannels();
  await sb.removeAllChannels();
  console.log('\nJS SUPABASE-JS STORAGE + REALTIME TESTİ KEÇDİ ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error('TEST XƏTASI:', e);
  process.exit(1);
});
