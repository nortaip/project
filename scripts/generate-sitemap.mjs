#!/usr/bin/env node
/**
 * Ellit.az — Dinamik sitemap generator
 *
 * İstifadə:
 *   node scripts/generate-sitemap.mjs
 *
 * Build-də:
 *   "build": "node scripts/generate-sitemap.mjs && vite build"
 *
 * Çıxış:
 *   public/sitemap-services.xml
 *   public/sitemap-providers.xml
 *
 * .env tələb edir:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SITE_URL = 'https://ellit.az';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[sitemap] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// AZ-aware slug (src/lib/slug.ts ilə uyğun)
const AZ_MAP = {
  ə: 'e', Ə: 'e', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o',
  ü: 'u', Ü: 'u', ç: 'c', Ç: 'c', ş: 's', Ş: 's',
};
const slugify = (input) =>
  String(input ?? '')
    .trim()
    .replace(/[əƏğĞıİöÖüÜçÇşŞ]/g, (c) => AZ_MAP[c] ?? c)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const urlEntry = (loc, { lastmod, changefreq = 'weekly', priority = 0.7 } = {}) => `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod.split('T')[0]}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

const wrap = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items.join('\n')}
</urlset>
`;

async function generateServicesSitemap() {
  console.log('[sitemap] Fetching services...');
  const { data, error } = await supabase
    .from('services')
    .select('id, updated_at, status')
    .eq('status', 'active')
    .limit(50000);

  if (error) {
    console.warn('[sitemap] services fetch failed:', error.message);
    return;
  }

  const items = (data ?? []).map((s) =>
    urlEntry(`${SITE_URL}/services/${s.id}`, {
      lastmod: s.updated_at,
      changefreq: 'weekly',
      priority: 0.8,
    }),
  );

  const out = path.join(PUBLIC_DIR, 'sitemap-services.xml');
  await fs.writeFile(out, wrap(items), 'utf-8');
  console.log(`[sitemap] ✔ ${out} (${items.length} URLs)`);
}

async function generateProvidersSitemap() {
  console.log('[sitemap] Fetching providers...');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, updated_at, role, status')
    .eq('role', 'provider')
    .eq('status', 'active')
    .limit(50000);

  if (error) {
    console.warn('[sitemap] providers fetch failed:', error.message);
    return;
  }

  const items = (data ?? []).map((p) =>
    urlEntry(`${SITE_URL}/provider/${p.id}`, {
      lastmod: p.updated_at,
      changefreq: 'weekly',
      priority: 0.7,
    }),
  );

  const out = path.join(PUBLIC_DIR, 'sitemap-providers.xml');
  await fs.writeFile(out, wrap(items), 'utf-8');
  console.log(`[sitemap] ✔ ${out} (${items.length} URLs)`);
}

async function generateCategoriesSitemap() {
  console.log('[sitemap] Fetching categories...');
  // Landing-lər services.category mətninə əsaslanır (ana səhifə bunlara link verir).
  // Deaktiv kanonik kateqoriyaların slug-ları istisna olunur.
  const [{ data: svc, error: svcErr }, { data: canon }] = await Promise.all([
    supabase.from('services').select('category').limit(50000),
    supabase.from('service_categories').select('label, is_active'),
  ]);

  if (svcErr) {
    console.warn('[sitemap] categories fetch failed:', svcErr.message);
    return;
  }

  const inactiveSlugs = new Set(
    (canon ?? [])
      .filter((c) => c.is_active === false)
      .map((c) => slugify(c.label)),
  );

  const seen = new Set();
  const items = [];
  for (const row of svc ?? []) {
    const slug = slugify((row.category ?? '').trim());
    if (!slug || seen.has(slug) || inactiveSlugs.has(slug)) continue;
    seen.add(slug);
    items.push(
      urlEntry(`${SITE_URL}/xidmet/${slug}`, { changefreq: 'weekly', priority: 0.9 }),
    );
  }

  const out = path.join(PUBLIC_DIR, 'sitemap-categories.xml');
  await fs.writeFile(out, wrap(items), 'utf-8');
  console.log(`[sitemap] ✔ ${out} (${items.length} URLs)`);
}

(async () => {
  try {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await Promise.all([
      generateServicesSitemap(),
      generateProvidersSitemap(),
      generateCategoriesSitemap(),
    ]);
    console.log('[sitemap] ✅ Done.');
  } catch (e) {
    console.error('[sitemap] FATAL:', e);
    process.exit(1);
  }
})();
