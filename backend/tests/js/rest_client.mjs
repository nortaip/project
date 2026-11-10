// /rest/v1 uyğunluq testi — HƏQİQİ @supabase/supabase-js klienti ilə.
// tests/compat_rest.py tərəfindən işə salınır (CTX mühit dəyişəni: JSON).
import { createRequire } from 'node:module';
const require = createRequire('/home/user/project/package.json');
const { createClient } = require('@supabase/supabase-js');

const ctx = JSON.parse(process.env.CTX);
const mk = (token) => createClient(ctx.url, 'anon-key-placeholder', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
});
const anon = mk(null), c1 = mk(ctx.tok.cust1), c2 = mk(ctx.tok.cust2),
      p1 = mk(ctx.tok.prov1), p2 = mk(ctx.tok.prov2), adm = mk(ctx.tok.admin);
const id = ctx.id;
let n = 0;
function check(name, cond, extra = '') {
  n++;
  console.log(`  [${cond ? '✓' : '✗ FAIL'}] ${name} ${cond ? '' : extra}`);
  if (!cond) { console.log(`JS TEST UĞURSUZ: ${name}`); process.exit(1); }
}
const J = (x) => JSON.stringify(x).slice(0, 300);

// ── oxunuş ──
let r = await anon.from('service_categories').select('id,label').order('label');
check('anonim kataloq oxuyur', !r.error && r.data.length === 2 && r.data[0].label === 'Elektrik', J(r));
r = await c1.from('profiles').select('id,name,role').eq('id', id.cust1).single();
check('eq + single → obyekt', !r.error && r.data.id === id.cust1 && r.data.role === 'customer', J(r));
r = await c1.from('profiles').select('id').eq('id', '00000000-0000-4000-8000-000000000000').maybeSingle();
check('maybeSingle, sətir yoxdur → null (xətasız)', r.data === null && r.error === null, J(r));
r = await c1.from('profiles').select('id').eq('id', '00000000-0000-4000-8000-000000000000').single();
check('single, sətir yoxdur → PGRST116', r.data === null && r.error?.code === 'PGRST116', J(r));
r = await c1.from('profiles').select('id').in('id', [id.cust1, id.prov1]);
check('in filtri', !r.error && r.data.length === 2, J(r));
r = await c1.from('profiles').select('id,name').or('name.ilike.%Usta Bir%,email.ilike.%yoxdur%');
check('or + ilike', !r.error && r.data.length === 1 && r.data[0].id === id.prov1, J(r));
r = await c1.from('profiles').select('id').ilike('name', '%usta%').order('name', { ascending: false });
check('ilike + order desc', !r.error && r.data.length === 2 && r.data[0].id === id.prov2, J(r));
r = await c1.from('profiles').select('id').contains('specialties', [id.cat]);
check('contains (massiv sütunu)', !r.error && r.data.length === 1 && r.data[0].id === id.prov1, J(r));
r = await c1.from('opportunities').select('id,title').is('provider_id', null).eq('created_by', id.cust1);
check('is null', !r.error && r.data.length === 1, J(r));
r = await c1.from('opportunities').select('id').not('accepted_offer_id', 'is', null);
check('not is null', !r.error && r.data.length === 0, J(r));
r = await c1.from('opportunities_offers').select('id,offer_amount').gte('offer_amount', 60).eq('opportunity_id', id.opp);
check('gte (numeric) — ədəd kimi qayıdır', !r.error && r.data.length === 1 && r.data[0].offer_amount === 80, J(r));
r = await c1.from('opportunities_offers').select('id').neq('provider_id', id.prov1).eq('opportunity_id', id.opp);
check('neq', !r.error && r.data.length === 1, J(r));
r = await c1.from('opportunities').select('id').match({ created_by: id.cust1, status: 'pending' });
check('match', !r.error && r.data.length === 1, J(r));
r = await c1.from('notifications').select('id,title,created_at').order('created_at', { ascending: false }).limit(1);
check('order + limit', !r.error && r.data.length === 1 && r.data[0].title === 'Üçüncü', J(r));
r = await c1.from('notifications').select('id').order('created_at', { ascending: true }).range(1, 2);
check('range(1,2)', !r.error && r.data.length === 2, J(r));
r = await c1.from('notifications').select('*', { count: 'exact', head: true }).eq('is_read', false);
check('count exact + head', !r.error && r.count === 2 && r.data === null, J(r));
r = await c1.from('notifications').select('id', { count: 'exact' }).limit(1);
check('count exact + data', !r.error && r.count === 3 && r.data.length === 1, J(r));
r = await c1.from('opportunities').select('id, foto:extra_answers->>foto, extra_answers->otaq').eq('extra_answers->>foto', 'var');
check('JSON yolu: select + filtr', !r.error && r.data.length === 1 && r.data[0].foto === 'var' && r.data[0].otaq === 3, J(r));
r = await c1.from('public_profiles').select('id,name').eq('id', id.prov1).maybeSingle();
check('görünüş (public_profiles)', !r.error && r.data?.name === 'Usta Bir', J(r));

// ── iç-içə əlaqələr (klientlərin faktiki select-ləri) ──
r = await c1.from('opportunities')
  .select('id, title, description, created_at, status, opportunities_offers!fk_opportunity(id, status, created_at, offer_amount, provider_id, provider_profile:profiles(name, phone_number))')
  .eq('created_by', id.cust1);
check('sifariş + təkliflər (1→çox, FK hint) + iç-içə profil',
  !r.error && r.data.length === 1 && r.data[0].opportunities_offers.length === 2 &&
  r.data[0].opportunities_offers.some(o => o.provider_profile?.name === 'Usta Bir'), J(r));
r = await p1.from('opportunities_offers')
  .select('id, offer_amount, status, created_at, opportunity:opportunities!fk_opportunity(title, location, description, budget, date, user:profiles!fk_opportunity_created_by(name, email, phone_number))')
  .eq('provider_id', id.prov1);
check('təklif → sifariş → müştəri (çox→1 zənciri, alias)',
  !r.error && r.data.length === 1 && r.data[0].opportunity?.title === 'Kran sızır' &&
  r.data[0].opportunity.user?.name === 'Müştəri Bir', J(r));
r = await c1.from('bookings')
  .select('id, date, time, status, total_amount, package_duration, customer_id, fee_paid, service:services(title, location, images), provider:profiles!provider_id(name, phone_number, avatar_url)')
  .eq('customer_id', id.cust1);
check('bron + elan + usta (sütun adı ilə hint)',
  !r.error && r.data.length === 1 && r.data[0].service?.title === 'Kombi təmiri' &&
  r.data[0].provider?.name === 'Usta Bir' && r.data[0].fee_paid === true, J(r));
r = await p1.from('bookings')
  .select('id, date, time, package_duration, total_amount, status, services(title, images, location), profiles:customer_id(id, name, email, phone_number)')
  .eq('provider_id', id.prov1);
check('bron: FK sütunu əlaqə kimi (profiles:customer_id)',
  !r.error && r.data.length === 1 && r.data[0].profiles?.id === id.cust1 && r.data[0].services?.title === 'Kombi təmiri', J(r));
r = await c1.from('opportunities').select('*, category:service_categories(id, label), subcategory:service_subcategories(id, category_id, label)').eq('id', id.opp).single();
check('* + iki çox→1 əlaqə', !r.error && r.data.category?.label === 'Santexnik' && r.data.subcategory?.label === 'Kran' && r.data.title === 'Kran sızır', J(r));
r = await c1.from('service_categories').select('*, service_subcategories(label)').eq('id', id.cat).single();
check('1→çox massiv', !r.error && Array.isArray(r.data.service_subcategories) && r.data.service_subcategories.length === 1, J(r));
r = await c1.from('service_categories').select('id, service_subcategories(label)').eq('id', id.cat2).single();
check('1→çox: boş massiv (null yox)', !r.error && Array.isArray(r.data.service_subcategories) && r.data.service_subcategories.length === 0, J(r));
r = await p1.from('brigade_assignments').select('*, member:brigade_members(*, profile:profiles(id, name, avatar_url))').eq('brigade_id', id.brigade);
check('təyinat → üzv → profil', !r.error && r.data.length === 1 && r.data[0].member?.profile?.id === id.prov1, J(r));
r = await p1.from('brigade_members').select('brigade_id, brigades:brigades(*)').eq('profile_id', id.prov1);
check('üzvlük → briqada (alias = cədvəl adı)', !r.error && r.data.length === 1 && r.data[0].brigades?.name === 'Ellit Komanda', J(r));
r = await c1.from('opportunities_offers').select('id, opportunities!fk_opportunity!inner(status)').eq('opportunities.status', 'pending').eq('opportunity_id', id.opp);
check('!inner + əlaqə üzrə filtr (uyğun)', !r.error && r.data.length === 2, J(r));
r = await c1.from('opportunities_offers').select('id, opportunities!fk_opportunity!inner(status)').eq('opportunities.status', 'completed').eq('opportunity_id', id.opp);
check('!inner + əlaqə üzrə filtr (uyğun deyil → boş)', !r.error && r.data.length === 0, J(r));
r = await c1.from('service_categories').select('id, service_subcategories(label)').order('label', { referencedTable: 'service_subcategories', ascending: false }).eq('id', id.cat);
check('əlaqə daxilində sıralama', !r.error && r.data.length === 1, J(r));

// ── yazı ──
r = await c1.from('opportunities').insert({ title: 'Yeni sifariş', status: 'pending', created_by: id.cust1, date: '2026-12-25', category_id: id.cat, extra_answers: { a: [1, 2] } }).select().single();
check('insert + select().single()', !r.error && r.data.title === 'Yeni sifariş' && r.data.status === 'pending' && r.data.created_by === id.cust1 && r.data.extra_answers.a[1] === 2, J(r));
const newOpp = r.data.id;
r = await c1.from('opportunities').update({ title: 'Dəyişdi', description: 'x' }).eq('id', newOpp).select('id,title').single();
check('update + select', !r.error && r.data.title === 'Dəyişdi', J(r));
r = await c1.from('opportunities').update({ title: 'Minimal' }).eq('id', newOpp);
check('update (return=minimal)', !r.error && r.data === null && r.status === 204, J(r));
r = await c1.from('user_devices').upsert({ user_id: id.cust1, fcm_token: 'tok-1', platform: 'android' }, { onConflict: 'user_id,fcm_token' });
check('upsert (yeni)', !r.error, J(r));
r = await c1.from('user_devices').upsert({ user_id: id.cust1, fcm_token: 'tok-1', platform: 'ios' }, { onConflict: 'user_id,fcm_token' }).select();
check('upsert (mövcud → yenilənir, dublikat yox)', !r.error && r.data.length === 1 && r.data[0].platform === 'ios', J(r));
r = await c1.from('user_devices').select('id').eq('user_id', id.cust1);
check('upsert-dən sonra 1 sətir', !r.error && r.data.length === 1, J(r));
r = await c1.from('user_devices').insert([{ user_id: id.cust1, fcm_token: 'tok-2', platform: 'web' }, { user_id: id.cust1, fcm_token: 'tok-3' }]).select('fcm_token');
check('toplu insert (fərqli açarlı obyektlər)', !r.error && r.data.length === 2, J(r));
r = await c1.from('user_devices').delete().eq('fcm_token', 'tok-2').select();
check('delete + select', !r.error && r.data.length === 1, J(r));
r = await c1.from('user_devices').delete().eq('user_id', id.cust1);
check('delete (minimal)', !r.error && r.status === 204, J(r));
r = await c1.from('notifications').update({ is_read: true }).eq('user_id', id.cust1).eq('is_read', false).select('id');
check('öz bildirişlərini oxunmuş edir', !r.error && r.data.length === 2, J(r));

// ── RLS və qorunan sütunlar ──
r = await c1.from('notifications').select('id').eq('user_id', id.cust2);
check('başqasının bildirişləri görünmür', !r.error && r.data.length === 0, J(r));
r = await c1.from('notifications').select('id', { count: 'exact', head: true });
check('count da RLS-ə tabedir', r.count === 3, J(r));
r = await c1.from('notifications').update({ title: 'hack' }).eq('user_id', id.cust2).select();
check('başqasının bildirişi dəyişmir', !r.error && r.data.length === 0, J(r));
r = await c1.from('profiles').update({ balance: 999999, is_verified: true, role: 'admin', name: 'Müştəri Bir Yeni' }).eq('id', id.cust1).select('balance,is_verified,role,name').single();
check('öz profilində ad dəyişir, balans/təsdiq/rol dəyişmir',
  !r.error && r.data.name === 'Müştəri Bir Yeni' && r.data.balance === 100 && r.data.is_verified === false && r.data.role === 'customer', J(r));
r = await c1.from('profiles').update({ name: 'hack' }).eq('id', id.cust2).select();
check('başqasının profili dəyişmir', !r.error && r.data.length === 0, J(r));
r = await c1.from('provider_wallets').update({ balance: 5 }).eq('provider_id', id.prov1).select();
check('cüzdana yazı qadağandır (GRANT yoxdur)', r.error?.code === '42501', J(r));
r = await c1.from('opportunities').insert({ title: 'Saxta', created_by: id.cust2, date: '2026-12-25' }).select();
check('başqasının adından sifariş yaradıla bilmir', r.error?.code === '42501' && r.status === 403, J(r));
r = await anon.from('opportunities').select('id');
check('anonim sifarişləri oxuya bilmir', r.error?.code === '42501' && r.status === 401, J(r));
r = await anon.from('profiles').update({ name: 'anon' }).eq('id', id.cust1).select();
check('anonim profil dəyişə bilmir', (r.error && [401, 403].includes(r.status)) || (!r.error && r.data.length === 0), J(r));
r = await c1.from('service_categories').insert({ label: 'Saxta kateqoriya' }).select();
check('adi istifadəçi kataloqa yaza bilmir', r.error?.code === '42501', J(r));
r = await adm.from('service_categories').insert({ label: 'Admin kateqoriyası' }).select().single();
check('admin kataloqa yazır', !r.error && r.data.label === 'Admin kateqoriyası', J(r));
r = await adm.from('profiles').update({ balance: 250 }).eq('id', id.cust2).select('balance').single();
check('admin balansı dəyişə bilir', !r.error && r.data.balance === 250, J(r));
r = await p2.from('bookings').select('id');
check('kənar usta bronu görmür', !r.error && r.data.length === 0, J(r));
r = await c2.from('services').update({ title: 'hack' }).eq('id', id.service).select();
check('başqasının elanı dəyişmir', !r.error && r.data.length === 0, J(r));
r = await p1.from('services').update({ title: 'Kombi təmiri və baxışı', promotion_paid: true }).eq('id', id.service).select('title,promotion_paid').single();
check('sahib elanı dəyişir, pullu təşviq sütunu dəyişmir', !r.error && r.data.title === 'Kombi təmiri və baxışı' && r.data.promotion_paid === false, J(r));

// ── xəta formaları ──
r = await c1.from('users').select('*');
check('daxili cədvəl (users) görünmür', r.error?.code === 'PGRST205' && r.status === 404, J(r));
r = await c1.from('yoxdur').select('*');
check('olmayan cədvəl → PGRST205', r.error?.code === 'PGRST205', J(r));
r = await c1.from('profiles').select('yox_sutun');
check('olmayan sütun → 42703', r.error?.code === '42703' && r.status === 400, J(r));
r = await c1.from('profiles').update({ name: 'x' });
check('filtrsiz update rədd olunur', r.error?.code === '21000', J(r));
r = await c1.from('user_devices').delete();
check('filtrsiz delete rədd olunur', r.error?.code === '21000', J(r));
r = await c1.from('profiles').select('id').eq('id', 'uuid-deyil');
check('yanlış tipli dəyər → 22P02 (400)', r.error?.code === '22P02' && r.status === 400, J(r));
r = await c1.rpc('mövcud_olmayan_rpc', { a: 1 });
check('qeydiyyatsız RPC → PGRST202', r.error?.code === 'PGRST202' && r.status === 404, J(r));
r = await c1.from('opportunities').insert({ title: 'Tarixsiz', created_by: id.cust1 }).select();
check('NOT NULL pozuntusu → 23502', r.error?.code === '23502' && r.status === 400, J(r));

console.log(`JS REST: ${n} yoxlama keçdi`);
