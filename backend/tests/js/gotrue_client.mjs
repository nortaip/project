// /auth/v1 uyğunluq testi — HƏQİQİ @supabase/supabase-js klienti ilə.
// Server özü işə salınmır; ünvan arqument kimi verilir:
//   node tests/js/gotrue_client.mjs http://127.0.0.1:18101
// Server PASSWORD_MIN_LENGTH=6 (standart) və SMTP-siz işləməlidir.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/project/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = (process.argv[2] || 'http://127.0.0.1:18101').replace(/\/$/, '');
const mk = () => createClient(BASE, 'anon-key-placeholder', {
  auth: { autoRefreshToken: false, detectSessionInUrl: false },
});

let n = 0;
function check(name, cond, extra = '') {
  n++;
  console.log(`  [${cond ? '✓' : '✗ FAIL'}] ${name} ${cond ? '' : extra}`);
  if (!cond) { console.log(`JS TEST UĞURSUZ: ${name}`); process.exit(1); }
}
const J = (x) => JSON.stringify(x, (k, v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 20) + '…' : v)).slice(0, 400);
const uniq = Date.now().toString(36);
const email = `js_${uniq}@test.az`;
const phoneDigits = `99455${String(Date.now()).slice(-7)}`;
const phone = `+${phoneDigits}`;

const sb = mk();
const events = [];
sb.auth.onAuthStateChange((event, session) => events.push([event, session?.user?.id ?? null]));

// ── signUp (veb Signup.tsx kimi: telefon + metadata; store/auth.ts kimi: e-poçt) ──
let r = await sb.auth.signUp({
  email, password: 'parol123',
  options: { data: { name: 'JS İstifadəçi', role: 'admin', phone, specialties: [] } },
});
check('signUp → error yoxdur', r.error === null, J(r.error));
check('signUp → data.session dolu (təsdiq addımı yoxdur)',
  !!r.data.session?.access_token && !!r.data.session?.refresh_token
  && typeof r.data.session.expires_at === 'number' && r.data.session.token_type === 'bearer', J(r.data));
check('signUp → data.user', r.data.user?.email === email && r.data.user?.role === 'authenticated'
  && r.data.user?.aud === 'authenticated' && !!r.data.user?.created_at, J(r.data.user));
check('signUp → user_metadata saxlanıldı',
  r.data.user.user_metadata.name === 'JS İstifadəçi' && r.data.user.user_metadata.phone === phone, J(r.data.user));
const uid = r.data.user.id;
await new Promise((res) => setTimeout(res, 20));
check('onAuthStateChange: SIGNED_IN', events.some(([e, id]) => e === 'SIGNED_IN' && id === uid), J(events));

r = await sb.from('profiles').select('id,name,role').eq('id', uid).single();
check('profil yaradıldı və rol admin DEYİL', !r.error && r.data.name === 'JS İstifadəçi'
  && r.data.role === 'customer', J(r));

r = await mk().auth.signUp({ email, password: 'basqa123' });
check('təkrar signUp → "User already registered" (422)',
  r.data.user === null && r.error?.message === 'User already registered' && r.error?.status === 422
  && r.error?.code === 'user_already_exists', J(r.error));
r = await mk().auth.signUp({ email: `zeif_${uniq}@test.az`, password: '123' });
check('zəif parol → AuthWeakPasswordError', r.error?.name === 'AuthWeakPasswordError'
  && r.error?.status === 422 && r.error?.reasons?.[0] === 'length', J(r.error));
const phoneClient = mk();
r = await phoneClient.auth.signUp({ phone, password: 'telefon1', options: { data: { name: 'Telefonlu' } } });
check('signUp(phone) → sessiya', r.error === null && !!r.data.session
  && r.data.user.phone === phoneDigits, J(r));

// ── getUser / getSession ──
r = await sb.auth.getUser();
check('getUser', r.error === null && r.data.user.id === uid
  && r.data.user.app_metadata.provider === 'email', J(r));
r = await sb.auth.getSession();
check('getSession', r.error === null && r.data.session?.user?.id === uid, J(r));

// ── signOut ──
r = await sb.auth.signOut();
check('signOut → error yoxdur', r.error === null, J(r));
r = await sb.auth.getSession();
check('signOut-dan sonra sessiya yoxdur', r.data.session === null);
check('onAuthStateChange: SIGNED_OUT', events.some(([e]) => e === 'SIGNED_OUT'), J(events));
r = await sb.auth.getUser();
check('signOut-dan sonra getUser → AuthSessionMissingError',
  r.data.user === null && r.error?.name === 'AuthSessionMissingError', J(r.error));

// ── signInWithPassword (e-poçt, sonra telefon) ──
r = await sb.auth.signInWithPassword({ email: email.toUpperCase(), password: 'parol123' });
check('signInWithPassword(email)', r.error === null && r.data.user?.id === uid && !!r.data.session, J(r));
const firstSession = r.data.session;
r = await mk().auth.signInWithPassword({ phone, password: 'telefon1' });
check('signInWithPassword(phone, +994…)', r.error === null && r.data.user?.phone === phoneDigits, J(r));
r = await mk().auth.signInWithPassword({ phone: phoneDigits, password: 'telefon1' });
check('signInWithPassword(phone, + işarəsiz — Login.tsx kimi)', r.error === null && !!r.data.session, J(r));

// ── updateUser (data, sonra parol) ──
r = await sb.auth.updateUser({ data: { name: 'Yeni Ad', role: 'customer' } });
check('updateUser({data})', r.error === null && r.data.user.user_metadata.name === 'Yeni Ad'
  && r.data.user.user_metadata.phone === phone, J(r));
check('onAuthStateChange: USER_UPDATED', events.some(([e]) => e === 'USER_UPDATED'), J(events));
r = await sb.auth.updateUser({ password: 'parol123' });
check('eyni parol → "same" mətnli xəta (change_password_screen.dart)',
  r.error?.status === 422 && r.error.message.includes('same') && r.error.code === 'same_password', J(r.error));
r = await sb.auth.updateUser({ password: 'YeniParol99' });
check('updateUser({password})', r.error === null && r.data.user.id === uid, J(r));
r = await mk().auth.signInWithPassword({ email, password: 'YeniParol99' });
check('yeni parolla giriş', r.error === null && !!r.data.session, J(r.error));

// ── refreshSession + vaxtı çatan sessiyanın avtomatik yenilənməsi ──
const before = (await sb.auth.getSession()).data.session;
r = await sb.auth.refreshSession();
check('refreshSession → yeni cüt', r.error === null && r.data.session.refresh_token !== before.refresh_token
  && r.data.session.access_token !== before.access_token && r.data.user.id === uid, J(r));
check('onAuthStateChange: TOKEN_REFRESHED', events.some(([e]) => e === 'TOKEN_REFRESHED'), J(events));
// saxlanmış sessiyanın vaxtını "keçmiş" et → getSession özü refresh etməlidir
const stored = JSON.parse(await sb.auth.storage.getItem(sb.auth.storageKey));
stored.expires_at = Math.floor(Date.now() / 1000) - 5;
await sb.auth.storage.setItem(sb.auth.storageKey, JSON.stringify(stored));
r = await sb.auth.getSession();
check('vaxtı keçmiş sessiya getSession-da avtomatik yenilənir',
  r.error === null && r.data.session.refresh_token !== stored.refresh_token
  && r.data.session.expires_at > Date.now() / 1000, J(r));
// iki tab eyni refresh token-i eyni anda göndərir
const cur = r.data.session;
const tabA = mk(), tabB = mk();
const [ra, rb] = await Promise.all([
  tabA.auth.refreshSession({ refresh_token: cur.refresh_token }),
  tabB.auth.refreshSession({ refresh_token: cur.refresh_token }),
]);
check('iki tab eyni anda refresh → hər ikisi uğurlu, eyni varis token',
  ra.error === null && rb.error === null && ra.data.session.refresh_token === rb.data.session.refresh_token,
  J([ra.error, rb.error]));
r = await mk().auth.refreshSession({ refresh_token: 'zibil' });
check('etibarsız refresh token → xəta', r.data.session === null && r.error?.status === 400, J(r.error));
r = await mk().auth.refreshSession({ refresh_token: firstSession.refresh_token });
check('parol dəyişəndən sonra köhnə sessiya etibarsız', r.error?.status === 400, J(r.error));

// ── resetPasswordForEmail ──
r = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'http://localhost:5173/reset-password' });
check('resetPasswordForEmail → error yoxdur', r.error === null, J(r));
r = await sb.auth.resetPasswordForEmail('yoxdur@test.az');
check('resetPasswordForEmail (naməlum) → eyni cavab', r.error === null, J(r));

// ── yanlış parol / naməlum istifadəçi ──
r = await mk().auth.signInWithPassword({ email, password: 'sehv-parol' });
check('yanlış parol → "Invalid login credentials" (400)',
  r.data.user === null && r.data.session === null && r.error?.message === 'Invalid login credentials'
  && r.error?.status === 400 && r.error?.code === 'invalid_credentials' && r.error?.name === 'AuthApiError', J(r.error));
r = await mk().auth.signInWithPassword({ phone: '+994709999999', password: 'parol123' });
check('naməlum telefon → eyni xəta', r.error?.message === 'Invalid login credentials', J(r.error));

// ── signInWithOAuth URL-i (brauzer yönləndirməsi olmadan) ──
r = await mk().auth.signInWithOAuth({ provider: 'google',
  options: { redirectTo: 'http://localhost:5173/', skipBrowserRedirect: true } });
check('signInWithOAuth → /authorize URL', r.error === null
  && r.data.url.startsWith(`${BASE}/auth/v1/authorize?provider=google`), J(r));

// ── signOut (global) digər cihazları da çıxarır ──
const other = mk();
await other.auth.signInWithPassword({ email, password: 'YeniParol99' });
const otherRefresh = (await other.auth.getSession()).data.session.refresh_token;
r = await sb.auth.signOut();
check('signOut (global)', r.error === null, J(r));
r = await mk().auth.refreshSession({ refresh_token: otherRefresh });
check('global signOut digər cihazın sessiyasını da bağladı', r.error?.status === 400, J(r.error));
r = await phoneClient.auth.signOut({ scope: 'local' });
check('signOut({scope:"local"})', r.error === null, J(r));

console.log(`GOTRUE JS TESTLƏRİ KEÇDİ ✓ (${n} yoxlama)`);
process.exit(0);
