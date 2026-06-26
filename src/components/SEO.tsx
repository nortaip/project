import { Helmet } from 'react-helmet-async';

/**
 * `<script>` daxilində `</script>` istifadəçi controlled string-də gəlsə
 * tag-ı bağlayıb XSS yaradır. JSON.stringify defolt olaraq `<` escape etmir.
 * U+2028/U+2029 line-separator-ları da JS parser-ı qıra bilər.
 *
 * Regex `new RegExp` ilə qurulur — U+2028/U+2029 literal regex-də
 * line terminator kimi parse olunduğu üçün source kodda saxlamaq olmur.
 */
const UNSAFE_JSON_LD_CHARS = new RegExp('[<\\u2028\\u2029]', 'g');
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    UNSAFE_JSON_LD_CHARS,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const DEFAULT_TITLE = 'Ellit.az — Onlayn Xidmət Marketpleysi';
const DEFAULT_DESCRIPTION =
  'Azərbaycanda etibarlı provayderlərdən təmizlik, təmir, gözəllik və yüzlərlə xidməti onlayn sifariş edin. Sürətli, təhlükəsiz və zəmanətli.';
const DEFAULT_OG_IMAGE = 'https://ellit.az/og-default.png';
const SITE_NAME = 'Ellit.az';
const SITE_URL = 'https://ellit.az';
const TWITTER_HANDLE = '@ellitaz';

interface Props {
  /** Page title (sonuna ` — Ellit.az` əlavə olunur) */
  title?: string;
  /** Meta description (max 160 char tövsiyə olunur) */
  description?: string;
  /** Canonical URL (defolt: cari URL) */
  canonical?: string;
  /** OG image URL */
  image?: string;
  /** Page type */
  type?: 'website' | 'article' | 'product' | 'profile';
  /** noindex flag — yalnız private səhifələr üçün */
  noindex?: boolean;
  /** JSON-LD structured data (push complex objects here) */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Hreflang alternates */
  alternates?: { lang: string; href: string }[];
}

/**
 * Universal SEO meta tags component.
 *
 * İstifadə:
 * ```tsx
 * <SEO
 *   title="Təmizlik xidməti"
 *   description="..."
 *   type="product"
 *   image="https://ellit.az/services/123.jpg"
 *   jsonLd={{ '@context': 'https://schema.org', '@type': 'Service', ... }}
 * />
 * ```
 */
export function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  canonical,
  image = DEFAULT_OG_IMAGE,
  type = 'website',
  noindex = false,
  jsonLd,
  alternates,
}: Props) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : DEFAULT_TITLE;
  const url =
    canonical ?? (typeof window !== 'undefined' ? window.location.href : SITE_URL);

  const jsonLdArray = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="az_AZ" />
      <meta property="og:locale:alternate" content="ru_RU" />
      <meta property="og:locale:alternate" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* hreflang */}
      {(alternates ?? []).map((alt) => (
        <link
          key={alt.lang}
          rel="alternate"
          hrefLang={alt.lang}
          href={alt.href}
        />
      ))}

      {/* JSON-LD Structured Data — `<` və separator-lar escape olunur ki,
          istifadəçi controlled string-lər (provider name, service description)
          `</script>` injection vasitəsilə XSS yarada bilməsin. */}
      {jsonLdArray.map((data, i) => (
        <script key={i} type="application/ld+json">
          {safeJsonLd(data)}
        </script>
      ))}
    </Helmet>
  );
}

/**
 * Helper: Organization JSON-LD (homepage)
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [
      'https://www.facebook.com/ellitaz',
      'https://www.instagram.com/ellitaz',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Support',
      areaServed: 'AZ',
      availableLanguage: ['Azerbaijani', 'Russian', 'English'],
    },
  };
}

/**
 * Helper: WebSite + SearchAction JSON-LD (homepage).
 * Google-da "sitelinks search box" aktivləşdirir — istifadəçi birbaşa
 * axtarış nəticələrindən ellit.az daxilində xidmət axtara bilir.
 */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: ['az', 'ru', 'en'],
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/services?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Helper: FAQPage JSON-LD.
 * Homepage FAQ-larını Google-un genişlənən "rich result"-larına çevirir →
 * SERP-də daha çox yer + yüksək klik nisbəti.
 */
export function faqPageJsonLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}

/**
 * Helper: Service JSON-LD (BookService səhifəsi üçün)
 */
export function serviceJsonLd(args: {
  name: string;
  description?: string | null;
  price: number;
  currency?: string;
  category?: string;
  image?: string;
  providerName?: string;
  rating?: number | null;
  reviewCount?: number | null;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: args.name,
    description: args.description ?? '',
    serviceType: args.category,
    image: args.image,
    provider: args.providerName
      ? { '@type': 'Person', name: args.providerName }
      : undefined,
    offers: {
      '@type': 'Offer',
      price: args.price,
      priceCurrency: args.currency ?? 'AZN',
      availability: 'https://schema.org/InStock',
    },
    aggregateRating:
      args.rating && args.reviewCount && args.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: args.rating,
            reviewCount: args.reviewCount,
          }
        : undefined,
  };
}

/**
 * Helper: Person JSON-LD (provider profili üçün)
 */
export function personJsonLd(args: {
  name: string;
  image?: string | null;
  url?: string;
  jobTitle?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: args.name,
    image: args.image,
    url: args.url,
    jobTitle: args.jobTitle ?? 'Service Provider',
  };
}

/**
 * Helper: BreadcrumbList JSON-LD
 */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
