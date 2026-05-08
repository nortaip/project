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

(async () => {
  try {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await Promise.all([generateServicesSitemap(), generateProvidersSitemap()]);
    console.log('[sitemap] ✅ Done.');
  } catch (e) {
    console.error('[sitemap] FATAL:', e);
    process.exit(1);
  }
})();
