# Ellit.az — SEO Guide

Bu sənəd Ellit.az saytının axtarış sistemləri (Google, Yandex, Bing) üçün necə optimallaşdırıldığını və prerendering strategiyasını izah edir.

---

## 1. SEO Stack — nə əlavə olundu

### 1.1 Meta tag-lər (`<head>`)
- `index.html` — **default** meta tag-lər (title, description, keywords, robots, canonical, OG, Twitter, hreflang)
- `theme-color: #2563EB` — mobil brauzer ünvan paneli üçün
- `apple-touch-icon`, `apple-mobile-web-app-capable` — iOS Safari "Add to Home Screen" üçün
- Preconnect / dns-prefetch — Supabase + Google Fonts üçün
- Structured data (`<script type="application/ld+json">`):
  - `Organization` (Ellit.az)
  - `WebSite` + `SearchAction` (sayt-daxili axtarış üçün Google sitelinks search box)

### 1.2 Per-page meta — `<SEO>` component
[`src/components/SEO.tsx`](src/components/SEO.tsx) — `react-helmet-async` üzərində qurulmuş wrapper.

**Tətbiq olunduğu səhifələr:**
| Səhifə | Title | JSON-LD |
|---|---|---|
| `/` (RandomUsers) | default | Organization |
| `/services` | "Bütün xidmətlər" | BreadcrumbList |
| `/book/:id` (BookService) | service title | Service + BreadcrumbList |
| `/providers` | "Provayderlər" | BreadcrumbList |
| `/provider/:id` | provider name | Person + BreadcrumbList |
| `/about` | "Haqqımızda" | Organization |
| `/privacy` | "Məxfilik Siyasəti" | — |
| `/login`, `/signup` | "Daxil ol" / "Qeydiyyat" | — |

**JSON-LD helper-lər:**
- `organizationJsonLd()` — Organization schema (homepage + about)
- `serviceJsonLd({ name, price, ... })` — Service schema (BookService)
- `personJsonLd({ name, image, url })` — Person schema (ProviderProfile)
- `breadcrumbJsonLd(items)` — BreadcrumbList schema

### 1.3 Sitemap & robots
- [`public/robots.txt`](public/robots.txt) — auth-only və admin route-ları disallow
- [`public/sitemap.xml`](public/sitemap.xml) — statik public səhifələr
- [`public/sitemap-index.xml`](public/sitemap-index.xml) — bütün sitemap-ləri birləşdirir
- [`scripts/generate-sitemap.mjs`](scripts/generate-sitemap.mjs) — dinamik (services + providers) sitemap generatoru

**Generasiya etmək:**
```bash
npm run sitemap:gen        # yalnız sitemap-ləri yenilə
npm run build:full         # sitemap + vite build (production deploy üçün)
```

---

## 2. KRİTİK PROBLEM — Client-side rendering və SEO

Ellit.az **Vite + React SPA**-dır. Bu o deməkdir ki:

1. Brauzer `https://ellit.az/services/abc` ünvanına gəldikdə server boş `<div id="root"></div>` qaytarır.
2. JavaScript yüklənir, React render edir, `react-helmet-async` `<head>`-i dolduruyur.
3. Yalnız bu mərhələdə `<title>` və meta tag-lər doğru olur.

**Problem:** Bəzi axtarış sistemləri (xüsusilə Yandex, Bing) JavaScript-i icra etmir və ya gözləmir. Google JavaScript-i icra edir, amma:
- Render gecikir (1-2 həftə)
- Dynamic content (məs. `serviceJsonLd`) bəzən tutulmur
- `<title>` və `<meta description>` snippet sürətli olmalıdır

**Həll seçimləri** (sıralanıb — sadədən mürəkkəbə):

---

## 3. Seçim A: `vite-plugin-prerender` (TÖVSİYƏ — sürətli giriş)

**Nə edir:** `vite build` zamanı seçilmiş route-ları headless Chrome ilə prerender edir, statik HTML yazır. Hər route üçün `dist/services/index.html`, `dist/about/index.html` və s.

**Üstünlüklər:**
- Backend dəyişməz qalır
- Hostinq (Vercel/Netlify/Cloudflare Pages) eynən qalır
- Build-də 1 dəfə işləyir

**Çatışmazlıqlar:**
- Yalnız **statik** route-lar üçün uyğundur (`/`, `/services`, `/about`, `/privacy`, `/login`)
- Dinamik route-lar (`/book/:id`, `/provider/:id`) üçün — yalnız siyahı **build vaxtı məlumdursa** işləyir (10000+ servis varsa praktiki deyil)

**Setup:**
```bash
npm install --save-dev vite-plugin-prerender
```

```ts
// vite.config.ts
import prerender from 'vite-plugin-prerender';

export default defineConfig({
  plugins: [
    react(),
    prerender({
      staticDir: path.join(__dirname, 'dist'),
      routes: ['/', '/services', '/providers', '/about', '/privacy', '/login', '/signup'],
      renderer: '@prerenderer/renderer-puppeteer',
      rendererOptions: {
        renderAfterTime: 1500, // wait for Helmet to finish
      },
    }),
  ],
});
```

**Bu yanaşmanın daxili limit-i 100-200 səhifədir.** Hər servis/provayder üçün ayrıca səhifə lazımdırsa, **Seçim B** və ya **C**-yə keç.

---

## 4. Seçim B: SSR via Next.js migration (UZUNMÜDDƏTLİ — TÖVSİYƏ)

**Nə edir:** Vite + React SPA-nı Next.js App Router-a köçür. Hər səhifə server-də render olunur. SEO və performance üçün ən yaxşı seçim.

**Üstünlüklər:**
- Bütün route-lar (statik + dinamik) server-side render olur
- Dynamic OG image (Vercel `next/og` ilə)
- ISR (Incremental Static Regeneration) — servislər kəşlənir, dəyişəndə təzələnir
- Streaming SSR (sürətli FCP)
- File-based routing zatən React Router-a uyğundur — migration nisbətən hamar
- Vercel-də pulsuz hostinq

**Çatışmazlıqlar:**
- Migration **ciddi işdir** — bütün `useNavigate`, `useParams`, `Link`-lər yenilənir
- Ant Design SSR ilə kiçik problemlər (`StyleProvider` lazımdır)
- Supabase auth — Server Components üçün `@supabase/ssr` paketi
- 1-2 həftəlik effort

**Migration sırası (təxmini):**
1. `npm create next-app@latest ellit-web --ts --app --tailwind`
2. `src/pages/*.tsx` → `app/[route]/page.tsx`
3. `useAuthStore` (Zustand) → server-side `createServerClient` + client component-lər
4. Supabase RLS yenidən yoxlanmalı (server keyləri ilə client keylərini ayırd et)
5. Edge Functions (FCM, Epoint webhook) — Next.js API routes-a köçür və ya Supabase-də qalır
6. `index.html` meta-larını `app/layout.tsx`-ə köçür
7. `<SEO>` component-i → `export const metadata` per page
8. Sitemap → `app/sitemap.ts` (Next.js native)
9. Vercel-də deploy + DNS-i Vercel-ə yönəlt

---

## 5. Seçim C: Edge prerender / Bot detection

**Nə edir:** Cloudflare Worker / Vercel Edge Function — User-Agent string-ə baxır. Əgər bot-dursa (`Googlebot`, `YandexBot`, `bingbot`), səhifəni headless Chrome ilə render edib qaytarır. İnsan istifadəçilər üçün adi SPA.

**Servis variantları:**
- **Prerender.io** — paid SaaS, sadə setup
- **rendertron** — Google open-source, self-hosted
- **Cloudflare HTML Rewriter + Browser Rendering API** — yeni, ucuz

**Üstünlüklər:**
- Kod dəyişikliyi yoxdur
- Bütün route-lar avtomatik dəstəklənir
- Cache mexanizmi yaxşıdır (24 saatlıq TTL)

**Çatışmazlıqlar:**
- Aylıq xərc (Prerender.io: $90/ay başlanğıc)
- "Cloaking" risk — Google fərqli content görsə cəzalandırır (amma bu setup standartdır)
- Bütün infrastruktur yenidir, debug çətindir

---

## 6. Hansını seç?

| Vəziyyət | Tövsiyə |
|---|---|
| **İndi sürətli SEO lazımdır** | Seçim A (`vite-plugin-prerender`) — statik səhifələr üçün. Servislər üçün Google bot zatən render edir. |
| **3-6 ay perspektivə uzunmüddət investisiya** | Seçim B (Next.js) — uzun müddətli ən yaxşı yatırım |
| **Heç nə dəyişmək istəmirəm** | Seçim C (Prerender.io) — ay başına $90 ödənişlə |
| **Hibrid** | Seçim A statik səhifələrə + Seçim C dinamik route-lara |

---

## 7. İndi tətbiq olunan SEO siyahısı (✅)

- [x] Per-page `<title>` və `<meta description>` — `<SEO>` component
- [x] Canonical URL hər səhifədə
- [x] Open Graph + Twitter Card
- [x] hreflang (az/ru/en)
- [x] JSON-LD: Organization, WebSite, Service, Person, BreadcrumbList
- [x] `robots.txt` (auth route-ları disallow)
- [x] Static sitemap (`sitemap.xml`)
- [x] Dynamic sitemap (`sitemap-services.xml`, `sitemap-providers.xml`)
- [x] Sitemap index (`sitemap-index.xml`)
- [x] Preconnect to Supabase + Google Fonts
- [x] `theme-color` + Apple PWA meta
- [x] Defolt OG image (`og-default.png` — qoymalısan: 1200x630)
- [x] Sitemap auto-generation script (`npm run sitemap:gen`)

## 8. Hələ qoymalı olduqlarınız (manual)

- [ ] **`og-default.png`** — `public/` qovluğuna 1200x630 brand-li sosial paylaşım şəkli qoy
- [ ] **`logo.png`** — `public/logo.png` 512x512 (JSON-LD üçün)
- [ ] **`apple-touch-icon.png`** — `public/apple-touch-icon.png` 180x180
- [ ] **Google Search Console** verifikasiyası (`<meta name="google-site-verification" content="...">` `index.html`-ə əlavə et)
- [ ] **Yandex Webmaster** verifikasiyası
- [ ] **Bing Webmaster Tools** verifikasiyası
- [ ] Sitemap-i hər 3 platformaya submit et
- [ ] **Core Web Vitals** ölçü: PageSpeed Insights, Lighthouse
- [ ] **Image optimization**: `<img loading="lazy">`, WebP, doğru `alt` text
- [ ] Yazılı `alt` mətnləri kateqoriya/servis şəkillərində
- [ ] Internal linking — kateqoriya səhifələrindən servis səhifələrinə breadcrumb
- [ ] FAQ schema (Service səhifələrinin altında FAQ varsa)

## 9. Test komandaları

```bash
# Lokal preview
npm run build && npm run preview

# Sitemap generasiya
npm run sitemap:gen

# Meta tag-ləri yoxla (curl + grep)
curl -s https://ellit.az/services | grep -E '<title>|<meta name="description"'

# Rich Results Test (Google)
# https://search.google.com/test/rich-results

# Mobile-Friendly Test
# https://search.google.com/test/mobile-friendly
```

---

**Status:** SEO infrastruktur hazırdır. Statik səhifələr üçün indi prerender əlavə etmək kifayətdir. Dinamik route-lar üçün Google bot 1-2 həftəyə index edəcək; tələsiklik yoxdursa Seçim A ilə davam et, sonra B-yə keç.
