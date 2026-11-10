// Veb tətbiqin (React + supabase-js) öz Python backend-imizlə brauzerdə tam yoxlanışı.
// Supabase-ə gedən istənilən sorğu bloklanır və sayılır — 0 olmalıdır.
// Veb build: VITE_API_URL=$API npx vite build; server: uvicorn app.main:app (CORS_ORIGINS-də WEB olmalıdır).
// Veb tətbiq → öz Python backend-imiz (brauzerdə, həqiqi istifadəçi axını)
const { chromium } = require('playwright');
// İşə salma: WEB=http://127.0.0.1:4173 API=http://127.0.0.1:18400 PG_DSN=postgresql://… node web_flow.cjs <ekran-qovluğu>
const WEB = process.env.WEB || 'http://127.0.0.1:4173';
const API = process.env.API || API;
const PG_DSN = process.env.PG_DSN || 'postgresql://ellit@127.0.0.1:55432/ellit_browser';
const shots = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'az-AZ' });
  const page = await ctx.newPage();
  const problems = [], supabaseHits = [], apiCalls = [], wsFrames = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => { if (typeof f.payload === 'string') wsFrames.push(f.payload); });
  });
  await ctx.route(/supabase\.co/, (route) => { supabaseHits.push(route.request().url()); route.abort(); });
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes(API + '/')) {
      apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace(API, '').slice(0, 140)}`);
      if (r.status() >= 400) {
        let body = ''; try { body = (await r.text()).slice(0, 200); } catch {}
        problems.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(API, '').slice(0, 160)} ${body}`);
      }
    }
  });
  const step = async (name, fn) => {
    try { await fn(); console.log('  [✓] ' + name); }
    catch (e) { console.log('  [✗] ' + name + ' — ' + String(e).split('\n')[0].slice(0, 300)); }
  };

  await step('ana səhifə açılır', async () => {
    await page.goto(WEB + '/', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${shots}/01-home.png` });
  });
  await step('qeydiyyat (telefon + parol)', async () => {
    await page.goto(WEB + '/signup', { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Adınız və soyadınız').fill('Brauzer Test');
    await page.getByPlaceholder('example@mail.com').fill('brauzer@ellit-test.az');
    await page.getByPlaceholder('+994(50)1234567').click();
    await page.getByPlaceholder('+994(50)1234567').pressSequentially('501112233');
    await page.getByPlaceholder('Minimum 6 simvol').fill('Brauzer#Parol1');
    const boxes = page.locator('input[type="checkbox"]');
    for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check({ force: true }).catch(() => {});
    await page.screenshot({ path: `${shots}/02-signup-filled.png` });
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
  });
  await step('çıxış (sessiya silinir) → /login', async () => {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await ctx.clearCookies();
    await page.goto(WEB + '/login', { waitUntil: 'networkidle' });
    if (!page.url().includes('/login')) throw new Error('login səhifəsi açılmadı: ' + page.url());
  });
  await step('giriş (telefon + parol) → yönləndirmə', async () => {
    await page.waitForLoadState('networkidle');
    const phoneTab = page.getByRole('button', { name: /telefon/i }).first();
    if (await phoneTab.count()) await phoneTab.click().catch(() => {});
    const tel = page.locator('input[type="tel"]');
    if (await tel.count()) { await tel.first().click(); await tel.first().pressSequentially('501112233'); }
    else await page.locator('input[type="email"]').fill('brauzer@ellit-test.az');
    await page.locator('input[type="password"]').fill('Brauzer#Parol1');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${shots}/03-after-login.png` });
  });
  for (const [path, name] of [['/account', 'hesab səhifəsi'], ['/notifications', 'bildirişlər'],
                              ['/my-opportunities', 'sifarişlərim'], ['/balance', 'balans'],
                              ['/settings', 'ayarlar'], ['/brigades', 'briqadalar']]) {
    await step(name + ' (' + path + ')', async () => {
      await page.goto(WEB + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${shots}/page${path.replace(/\//g, '_')}.png` });
      if (page.url().includes('/login')) throw new Error('girişə qaytarıldı');
    });
  }
  const { execSync } = require('child_process');
  const sql = (q) => execSync(`psql '${PG_DSN}' -tAq -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
  await step('sifarişlərim: bazadakı sifariş görünür', async () => {
    const uid = sql("select id from users where phone='994501112233'");
    const cat = sql("select id from service_categories where label='Santexnik'");
    sql(`insert into opportunities (title, description, created_by, date, category_id, status, location) values ('Brauzer sifarişi', 'Kran dəyişimi', '${uid}', '2026-12-20', '${cat}', 'pending', 'Bakı')`);
    await page.goto(WEB + '/my-opportunities', { waitUntil: 'networkidle' });
    await page.getByText('Brauzer sifarişi').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${shots}/04-my-opportunities.png` });
  });
  await step('canlı yenilənmə: yeni bildiriş websocket ilə gəlir, zəngdə say artır', async () => {
    const uid = sql("select id from users where phone='994501112233'");
    await page.goto(WEB + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);   // kanala qoşulma
    const before = wsFrames.length;
    sql(`insert into notifications (user_id, type, title, body) values ('${uid}', 'info', 'Canlı bildiriş testi', 'Realtime işləyir')`);
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      if (wsFrames.slice(before).some((f) => f.includes('postgres_changes') && f.includes('Canlı bildiriş testi'))) break;
      await page.waitForTimeout(200);
    }
    if (!wsFrames.slice(before).some((f) => f.includes('Canlı bildiriş testi')))
      throw new Error('websocket hadisəsi gəlmədi; kadrlar: ' + wsFrames.slice(-3).join(' | ').slice(0, 300));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/05-live-notification.png` });
  });
  await step('başqasının bildirişi websocket ilə gəlmir', async () => {
    const other = sql("insert into users (email, role) values ('kenar@ellit-test.az', 'customer') returning id");
    sql(`insert into profiles (id, name, role) values ('${other}', 'Kənar', 'customer')`);
    const before = wsFrames.length;
    sql(`insert into notifications (user_id, type, title, body) values ('${other}', 'info', 'GİZLİ başqasının', 'sızmamalıdır')`);
    await page.waitForTimeout(3000);
    if (wsFrames.slice(before).some((f) => f.includes('GİZLİ')))
      throw new Error('başqasının sətri sızdı!');
  });
  await step('səhifə yeniləndikdə sessiya qalır', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    if (page.url().includes('/login')) throw new Error('sessiya itdi');
  });
  console.log('\nSUPABASE.CO SORĞULARI: ' + supabaseHits.length);
  supabaseHits.slice(0, 10).forEach((u) => console.log('   ' + u));
  console.log('BACKEND SORĞULARI: ' + apiCalls.length);
  const uniq = [...new Set(apiCalls.map((c) => c.replace(/\?.*$/, '')))];
  uniq.forEach((c) => console.log('   ' + c));
  console.log('\nPROBLEMLƏR: ' + problems.length);
  [...new Set(problems)].slice(0, 40).forEach((p) => console.log('   ' + p));
  await browser.close();
})();
