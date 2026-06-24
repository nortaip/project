import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Headphones,
  Heart,
  Home,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { motion, useInView, animate, type Variants } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { SEO, organizationJsonLd } from './SEO';

const APP_STORE_URL = 'https://apps.apple.com/az/app/ellit-az/id6770102709';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=asifdev.ellit_booking';

interface TopProvider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  reviews_count: number | null;
  is_verified: boolean | null;
}

interface CategoryRow {
  category: string;
  count: number;
}

interface RecentService {
  id: string;
  title: string;
  category: string;
  location: string | null;
  created_at: string;
}

interface PlatformStats {
  providers: number;
  services: number;
  bookings: number;
}

// ── Motion presets (refined / serious easing) ──────────────────────────────
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const popIn: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
};

export function RandomUsers() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState('');
  const [providers, setProviders] = useState<TopProvider[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stats, setStats] = useState<PlatformStats>({ providers: 0, services: 0, bookings: 0 });
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [recent, setRecent] = useState<RecentService[]>([]);

  // ── Data fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [
        { data: prv },
        { data: catLocData },
        { data: rec },
        { count: providerCount },
        { count: serviceCount },
        { count: bookingCount },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id,name,avatar_url,rating,reviews_count,is_verified,role')
          .eq('role', 'provider')
          .order('rating', { ascending: false })
          .limit(8),
        supabase
          .from('services')
          .select('category,location')
          .limit(500),
        supabase
          .from('services')
          .select('id,title,category,location,created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'provider'),
        supabase.from('services').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('*', { count: 'exact', head: true }),
      ]);

      if (cancelled) return;
      setProviders((prv as TopProvider[]) ?? []);
      setRecent((rec as RecentService[]) ?? []);

      // Distinct kateqoriya + şəhər count
      const catCounts = new Map<string, number>();
      const locCounts = new Map<string, number>();
      ((catLocData as { category: string; location: string | null }[]) ?? []).forEach((r) => {
        const c = (r.category ?? '').trim();
        if (c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
        const l = (r.location ?? '').trim();
        // Yalnız 1-ci şəhər hissəsi (məs. "Bakı, Yasamal" → "Bakı")
        const city = l.split(',')[0]?.trim();
        if (city) locCounts.set(city, (locCounts.get(city) ?? 0) + 1);
      });
      setCategories(
        [...catCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([category, count]) => ({ category, count })),
      );
      setCities(
        [...locCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([city, count]) => ({ city, count })),
      );

      setStats({
        providers: providerCount ?? 0,
        services: serviceCount ?? 0,
        bookings: bookingCount ?? 0,
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Search submit ──────────────────────────────────────────────────────
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set('q', searchInput.trim());
    navigate(`/services${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const heroStats = useMemo(
    () => [
      { value: stats.providers, suffix: '+', labelKey: 'home.stats.providers' },
      { value: stats.services, suffix: '+', labelKey: 'home.stats.services' },
      { value: stats.bookings, suffix: '+', labelKey: 'home.stats.bookings' },
    ],
    [stats],
  );

  const trustItems = useMemo(() => trustFeatures(i18n.language), [i18n.language]);

  return (
    <div className="bg-surface">
      <SEO
        canonical="https://ellit.az/"
        jsonLd={organizationJsonLd()}
        alternates={[
          { lang: 'az', href: 'https://ellit.az/' },
          { lang: 'ru', href: 'https://ellit.az/ru/' },
          { lang: 'en', href: 'https://ellit.az/en/' },
          { lang: 'x-default', href: 'https://ellit.az/' },
        ]}
      />

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative overflow-hidden bg-brand-gradient text-white">
        {/* Animated aurora field */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl"
          animate={{ y: [0, 28, 0], x: [0, -18, 0], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-accent-300/20 blur-3xl"
          animate={{ y: [0, -24, 0], x: [0, 22, 0], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-white/5 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Subtle grid for a serious / structured feel */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 70%)',
          }}
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-20 sm:pt-24 sm:pb-32"
        >
          <motion.div variants={fadeUp} className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs sm:text-sm font-bold border border-white/20">
              <Sparkles size={14} />
              {t('home.badge')}
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-center text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight max-w-4xl mx-auto"
          >
            {t('home.titlePart1')}{' '}
            <span className="bg-gradient-to-r from-white to-accent-200 bg-clip-text text-transparent">
              {t('home.titleHighlight')}
            </span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mt-4 text-center text-base sm:text-lg lg:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed"
          >
            {t('home.subtitle')}
          </motion.p>

          <motion.form
            variants={fadeUp}
            onSubmit={onSearch}
            className="mt-8 max-w-2xl mx-auto bg-white rounded-2xl shadow-card-lg p-2 flex items-center gap-2 ring-1 ring-white/40"
          >
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('home.searchPlaceholder')}
                className="w-full h-12 pl-11 pr-3 bg-transparent text-ink placeholder:text-muted text-sm sm:text-base focus:outline-none"
                aria-label={t('common.search')}
              />
            </div>
            <motion.button
              type="submit"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="h-12 px-5 sm:px-7 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm sm:text-base transition-colors shadow-brand-soft inline-flex items-center gap-2"
            >
              <span className="hidden sm:inline">{t('home.searchButton')}</span>
              <ArrowRight size={18} />
            </motion.button>
          </motion.form>

          {/* Live numbers (animated count-up) */}
          <motion.div
            variants={fadeUp}
            className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto"
          >
            {heroStats.map((s) => (
              <div key={s.labelKey} className="text-center">
                <div className="text-2xl sm:text-4xl font-extrabold leading-none tracking-tight">
                  <CountUp value={s.value} suffix={s.suffix} />
                </div>
                <div className="mt-2 text-xs sm:text-sm text-white/80 font-medium">{t(s.labelKey)}</div>
              </div>
            ))}
          </motion.div>

          {/* Hero CTA pair */}
          <motion.div
            variants={fadeUp}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/services"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 transition-colors shadow-card"
              >
                {t('home.browseServices')} <ArrowRight size={18} />
              </Link>
            </motion.div>
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white/10 backdrop-blur-sm border border-white/30 text-white font-bold hover:bg-white/20 transition-colors"
              >
                {t('home.becomeProvider')}
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Wave divider */}
        <svg
          aria-hidden
          className="block w-full h-12 sm:h-16 -mb-px"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
        >
          <path d="M0,40 C320,80 720,0 1440,50 L1440,80 L0,80 Z" fill="white" />
        </svg>
      </section>

      {/* ═══════════════════ TRUST / WHY US ═══════════════════ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 sm:-mt-10 relative z-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          {trustItems.map((item) => (
            <motion.div
              key={item.title}
              variants={popIn}
              whileHover={{ y: -4 }}
              className="group bg-white rounded-3xl border border-border p-4 sm:p-5 shadow-card hover:shadow-card-lg hover:border-brand-200 transition-all"
            >
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center shadow-brand-soft group-hover:scale-105 transition-transform">
                <item.icon size={20} />
              </div>
              <div className="mt-3.5 text-sm sm:text-base font-extrabold text-ink">{item.title}</div>
              <div className="mt-1 text-xs sm:text-sm text-muted leading-relaxed">{item.body}</div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ═══════════════════ REAL CATEGORY ROW (DB-dən) ═══════════════════ */}
      {categories.length > 0 && (
        <Reveal as="section" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <SectionHeader
            title={t('home.categories.title')}
            subtitle={t('home.categories.subtitleCount', { count: categories.length })}
            actionLabel={t('home.categories.all')}
            actionHref="/services"
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((c) => (
              <motion.div key={c.category} variants={popIn} className="shrink-0">
                <Link
                  to={`/services?category=${encodeURIComponent(c.category)}`}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-2xl bg-white border border-border hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-all text-sm font-bold text-ink-soft"
                >
                  {c.category}
                  <span className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-extrabold">
                    {c.count}
                  </span>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </Reveal>
      )}

      {/* ═══════════════════ CITIES / REGIONS ═══════════════════ */}
      {cities.length > 0 && (
        <Reveal as="section" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <SectionHeader title={t('home.cities.title')} subtitle={t('home.cities.subtitle')} />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.15 }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
          >
            {cities.map((c) => (
              <motion.div key={c.city} variants={popIn} whileHover={{ y: -3 }}>
                <Link
                  to={`/services?location=${encodeURIComponent(c.city)}`}
                  className="group flex items-center gap-3 p-4 rounded-2xl bg-white border border-border hover:border-brand-300 hover:shadow-card transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center group-hover:bg-brand-600 group-hover:text-white transition-colors">
                    <MapPin size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-ink truncate group-hover:text-brand-600 transition-colors">
                      {c.city}
                    </div>
                    <div className="text-xs text-muted">{t('home.cities.serviceCount', { count: c.count })}</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </Reveal>
      )}

      {/* ═══════════════════ TOP PROVIDERS ═══════════════════ */}
      {providers.length > 0 && (
        <section className="bg-surface-bg py-14">
          <Reveal className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <SectionHeader
              title={t('home.topProviders.title')}
              subtitle={t('home.topProviders.subtitle')}
              actionLabel={t('home.topProviders.viewAll')}
              actionHref="/providers"
            />
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.15 }}
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4"
            >
              {providers.map((p) => (
                <motion.div key={p.id} variants={popIn} whileHover={{ y: -4 }}>
                  <Link
                    to={`/provider/${p.id}`}
                    className="group block bg-white rounded-2xl border border-border p-4 text-center hover:border-brand-300 hover:shadow-card-lg transition-all"
                  >
                    <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-2xl overflow-hidden bg-brand-gradient">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.name ?? 'Provayder'}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white text-2xl font-extrabold">
                          {(p.name ?? '?')[0]?.toUpperCase()}
                        </div>
                      )}
                      {p.is_verified && (
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                          <CheckCircle2 size={14} className="text-success fill-success/20" />
                        </div>
                      )}
                    </div>
                    <h3 className="mt-3 text-sm font-bold text-ink line-clamp-1 group-hover:text-brand-600 transition-colors">
                      {p.name ?? '—'}
                    </h3>
                    {Number(p.rating ?? 0) > 0 && (
                      <div className="mt-1 inline-flex items-center justify-center gap-1 text-xs text-muted">
                        <Star size={11} className="fill-warning text-warning" />
                        <span className="font-bold text-ink-soft">{Number(p.rating ?? 0).toFixed(1)}</span>
                        {p.reviews_count ? <span>· {p.reviews_count}</span> : null}
                      </div>
                    )}
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          </Reveal>
        </section>
      )}

      {/* ═══════════════════ RECENT ACTIVITY ═══════════════════ */}
      {recent.length > 0 && (
        <Reveal as="section" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <SectionHeader
            title={t('home.recent.title')}
            subtitle={t('home.recent.subtitle')}
            actionLabel={t('home.topProviders.viewAll')}
            actionHref="/services"
          />
          <div className="bg-white rounded-3xl border border-border overflow-hidden divide-y divide-border">
            {recent.map((s) => (
              <Link
                key={s.id}
                to={`/book/${s.id}`}
                className="group flex items-center gap-4 p-4 hover:bg-surface-bg transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-success animate-pulse-soft shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink line-clamp-1 group-hover:text-brand-600 transition-colors">
                      {s.title}
                    </span>
                    <span className="text-[11px] uppercase font-bold tracking-wide text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                      {s.category}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                    {s.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} />
                        {s.location}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {timeAgo(s.created_at, t)}
                    </span>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted shrink-0 group-hover:text-brand-600 transition-colors" />
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {/* ═══════════════════ MOBILE APP DOWNLOAD ═══════════════════ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 text-white p-8 sm:p-12 lg:p-16 shadow-card-lg">
            {/* Layered depth — dot grid + glows */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
                backgroundSize: '22px 22px',
              }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-12 w-80 h-80 rounded-full bg-white/10 blur-3xl"
              animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-accent-200/20 blur-3xl" />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-1/3 left-1/4 w-40 h-40 rounded-full bg-cyan-300/20 blur-2xl"
              animate={{ y: [0, 20, 0], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
              <div>
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-bold border border-white/20">
                  <Sparkles size={14} /> {t('home.app.badge')}
                </span>
                <h2 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight max-w-2xl">
                  {t('home.app.title')}
                </h2>
                <p className="mt-3 text-white/90 text-base sm:text-lg max-w-xl leading-relaxed">
                  {t('home.app.subtitle')}
                </p>

                {/* Trust chips */}
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/12 backdrop-blur-sm text-xs font-bold border border-white/15">
                    <Star size={13} className="fill-amber-300 text-amber-300" /> 4.9 reytinq
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/12 backdrop-blur-sm text-xs font-bold border border-white/15">
                    <ShieldCheck size={13} /> Təhlükəsiz ödəniş
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/12 backdrop-blur-sm text-xs font-bold border border-white/15">
                    <Zap size={13} className="text-amber-300" /> Anlıq bildiriş
                  </span>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <motion.a
                    href={APP_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={{ y: -3, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="inline-flex items-center gap-3 h-14 px-5 rounded-2xl bg-ink text-white hover:bg-black transition-colors shadow-lg shadow-black/20"
                    aria-label="App Store"
                  >
                    <AppleLogo />
                    <div className="text-left leading-tight">
                      <div className="text-[11px] text-white/70 font-medium">App Store</div>
                      <div className="text-base font-extrabold">{t('home.app.download')}</div>
                    </div>
                  </motion.a>
                  <motion.a
                    href={PLAY_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={{ y: -3, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="inline-flex items-center gap-3 h-14 px-5 rounded-2xl bg-ink text-white hover:bg-black transition-colors shadow-lg shadow-black/20"
                    aria-label="Google Play"
                  >
                    <PlayLogo />
                    <div className="text-left leading-tight">
                      <div className="text-[11px] text-white/70 font-medium">Google Play</div>
                      <div className="text-base font-extrabold">{t('home.app.download')}</div>
                    </div>
                  </motion.a>
                </div>
              </div>

              {/* 3D phone scene */}
              <div
                className="hidden lg:block relative pr-10"
                style={{ perspective: '1400px' }}
              >
                <Phone3DScene />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <Reveal as="section" className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-extrabold uppercase tracking-wide mb-3">
            <Headphones size={13} /> FAQ
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-ink tracking-tight">
            {t('home.faq.title')}
          </h2>
          <p className="mt-2 text-base text-muted">
            {t('home.faq.subtitleBefore')}{' '}
            <Link to="/about" className="text-brand-600 font-bold hover:underline">
              {t('home.faq.contactLink')}
            </Link>{' '}
            {t('home.faq.subtitleAfter')}
          </p>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <FAQItem key={i} q={t(`home.faq.q${i}`)} a={t(`home.faq.a${i}`)} />
          ))}
        </div>
      </Reveal>

      {/* ═══════════════════ PROVIDER CTA ═══════════════════ */}
      <Reveal as="section" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 text-white p-8 sm:p-12 shadow-card-lg">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
              backgroundSize: '22px 22px',
            }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-white/10 blur-3xl"
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.75, 0.5] }}
            transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-bold border border-white/20">
                <BadgeCheck size={14} /> {t('home.providerCta.button')}
              </span>
              <h2 className="mt-4 text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight">
                {t('home.providerCta.title')}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-white/90 max-w-xl leading-relaxed">
                {t('home.providerCta.subtitle')}
              </p>
            </div>
            <motion.div whileHover={{ y: -3, scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/signup"
                className="inline-flex items-center justify-center gap-2 h-13 px-7 rounded-2xl bg-white text-brand-700 font-extrabold hover:bg-brand-50 transition-colors shadow-lg shadow-black/20"
              >
                {t('home.providerCta.button')} <ArrowRight size={18} />
              </Link>
            </motion.div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

// ── Helpers / sub-components ───────────────────────────────────────────

function formatStat(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toString();
}

/** Scroll-triggered count-up. value=0 → "—". */
function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || value <= 0) return;
    const controls = animate(0, value, {
      duration: 1.4,
      ease: EASE,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value]);

  if (value <= 0) return <span ref={ref}>—</span>;
  return (
    <span ref={ref}>
      {formatStat(display)}
      {suffix && <span className="text-accent-200">{suffix}</span>}
    </span>
  );
}

/** Section reveal wrapper (fade-up on scroll). */
function Reveal({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section';
}) {
  const Comp = as === 'section' ? motion.section : motion.div;
  return (
    <Comp
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </Comp>
  );
}

function timeAgo(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('time.now');
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
  if (diff < 604800) return t('time.daysAgo', { count: Math.floor(diff / 86400) });
  return new Date(iso).toLocaleDateString();
}

/** Localized trust strip — locale fayllarından asılı olmasın deyə inline. */
function trustFeatures(lang: string) {
  const L = lang?.startsWith('ru') ? 'ru' : lang?.startsWith('en') ? 'en' : 'az';
  const data = {
    az: [
      { icon: BadgeCheck, title: 'Yoxlanılmış ustalar', body: 'Hər provayder təsdiqlənir və qiymətləndirilir.' },
      { icon: ShieldCheck, title: 'Təhlükəsiz ödəniş', body: 'Ödənişlər qorunur, iş bitənə qədər saxlanılır.' },
      { icon: Zap, title: 'Sürətli cavab', body: 'Dəqiqələr içində təkliflər alın.' },
      { icon: Headphones, title: 'Daimi dəstək', body: 'Komandamız hər addımda yanınızdadır.' },
    ],
    ru: [
      { icon: BadgeCheck, title: 'Проверенные мастера', body: 'Каждый исполнитель проверен и имеет рейтинг.' },
      { icon: ShieldCheck, title: 'Безопасная оплата', body: 'Платежи защищены до завершения работы.' },
      { icon: Zap, title: 'Быстрый отклик', body: 'Получайте предложения за минуты.' },
      { icon: Headphones, title: 'Поддержка 24/7', body: 'Мы рядом на каждом шаге.' },
    ],
    en: [
      { icon: BadgeCheck, title: 'Verified pros', body: 'Every provider is vetted and rated.' },
      { icon: ShieldCheck, title: 'Secure payments', body: 'Funds are protected until the job is done.' },
      { icon: Zap, title: 'Fast responses', body: 'Get offers within minutes.' },
      { icon: Headphones, title: 'Always supported', body: 'Our team is with you every step.' },
    ],
  } as const;
  return data[L];
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left hover:bg-surface-bg transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm sm:text-base font-bold text-ink">{q}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180 text-brand-600' : ''}`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-4 sm:px-5 pb-5 text-sm sm:text-base text-ink-soft leading-relaxed">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  actionHref,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-6 gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 w-1.5 h-7 sm:h-9 rounded-full bg-gradient-to-b from-brand-500 to-accent-500 shrink-0"
        />
        <div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-ink tracking-tight">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm sm:text-base text-muted">{subtitle}</p>}
        </div>
      </div>
      {actionLabel && actionHref && (
        <Link
          to={actionHref}
          className="group shrink-0 inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-700"
        >
          {actionLabel}
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

function AppleLogo() {
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.78.9-2.05 1.6-3.13 1.51-.13-1.1.43-2.27 1.1-3.02.77-.85 2.13-1.49 3.16-1.51zM20.9 17.18c-.55 1.27-.81 1.84-1.52 2.97-.99 1.57-2.39 3.52-4.12 3.54-1.54.01-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.02-3.06-1.79-4.05-3.36-2.76-4.37-3.05-9.5-1.35-12.23 1.21-1.94 3.12-3.08 4.92-3.08 1.83 0 2.98 1 4.5 1 1.46 0 2.35-1 4.47-1 1.6 0 3.3.87 4.51 2.38-3.96 2.17-3.32 7.82.79 9.78z" />
    </svg>
  );
}

function PlayLogo() {
  return (
    <svg width={22} height={22} viewBox="0 0 512 512" aria-hidden>
      {/* left blue spine */}
      <path fill="#00C3FF" d="M48 28v456c0 9 5 17 13 20l239-248L61 8c-8 3-13 11-13 20z" />
      {/* top green facet */}
      <path fill="#00EE76" d="m300 256 76-79L91 9a23 23 0 0 0-30 19l239 228z" />
      {/* bottom red facet */}
      <path fill="#FF3B41" d="m300 256-239 228a23 23 0 0 0 30 19l285-168-76-79z" />
      {/* right yellow point */}
      <path fill="#FFC500" d="m376 177-76 79 76 79 86-50c15-9 15-49 0-58l-86-50z" />
    </svg>
  );
}

// ── 3D phone scene with floating glass cards ──────────────────────────────
function Phone3DScene() {
  return (
    <motion.div
      className="relative"
      style={{ transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, rotateY: -28, rotateX: 10, y: 50 }}
      whileInView={{ opacity: 1, rotateY: -16, rotateX: 6, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 1.1, ease: EASE }}
    >
      <div aria-hidden className="absolute -inset-10 rounded-[3.5rem] bg-white/15 blur-3xl" />

      {/* phone — continuous 3D float */}
      <motion.div
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ y: [0, -16, 0], rotateZ: [-0.6, 0.6, -0.6] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <PhoneMockup />
      </motion.div>

      {/* Floating: new offer */}
      <FloatingCard className="-left-20 top-6" depth={70} delay={0.5} float={10}>
        <span className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
          <Bell size={15} />
        </span>
        <span>
          <span className="block text-ink">Yeni təklif</span>
          <span className="block text-[10px] text-muted font-semibold">indicə gəldi</span>
        </span>
      </FloatingCard>

      {/* Floating: payment confirmed */}
      <FloatingCard className="-left-12 bottom-16" depth={100} delay={1.1} float={8}>
        <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <CheckCircle2 size={15} />
        </span>
        <span>
          <span className="block text-ink">Ödəniş təsdiqləndi</span>
          <span className="block text-[10px] text-emerald-600 font-semibold">təhlükəsiz escrow</span>
        </span>
      </FloatingCard>

      {/* Floating: rating */}
      <FloatingCard className="-right-6 top-28" depth={50} delay={0.8} float={12}>
        <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center">
          <Star size={15} className="fill-amber-400" />
        </span>
        <span>
          <span className="block text-ink">4.9 / 5.0</span>
          <span className="block text-[10px] text-muted font-semibold">2.4k rəy</span>
        </span>
      </FloatingCard>
    </motion.div>
  );
}

function FloatingCard({
  className,
  depth = 60,
  delay = 0,
  float = 8,
  children,
}: {
  className?: string;
  depth?: number;
  delay?: number;
  float?: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={`absolute z-20 ${className ?? ''}`}
      initial={{ opacity: 0, scale: 0.8, z: depth }}
      whileInView={{ opacity: 1, scale: 1, z: depth }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      <motion.div
        animate={{ y: [0, -float, 0] }}
        transition={{ duration: 4 + depth / 40, repeat: Infinity, ease: 'easeInOut', delay }}
        className="flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-2xl bg-white/95 backdrop-blur-md text-ink text-xs font-extrabold shadow-2xl ring-1 ring-black/5 whitespace-nowrap"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function PhoneMockup() {
  const services: Array<{
    label: string;
    sub: string;
    Icon: typeof Home;
    tile: string;
    fg: string;
  }> = [
    { label: 'Ev təmizliyi', sub: '120+ mütəxəssis', Icon: Home, tile: 'bg-brand-50', fg: 'text-brand-600' },
    { label: 'Avto təmiri', sub: '80+ mütəxəssis', Icon: Car, tile: 'bg-cyan-50', fg: 'text-cyan-600' },
    { label: 'Gözəllik', sub: '60+ mütəxəssis', Icon: Heart, tile: 'bg-rose-50', fg: 'text-rose-500' },
  ];
  return (
    <div className="relative w-[272px] h-[560px] rounded-[3rem] bg-ink p-[5px] shadow-2xl ring-1 ring-white/10">
      <div aria-hidden className="absolute -left-[3px] top-28 w-[3px] h-12 rounded-l bg-white/15" />
      <div aria-hidden className="absolute -left-[3px] top-44 w-[3px] h-16 rounded-l bg-white/15" />
      <div aria-hidden className="absolute -right-[3px] top-40 w-[3px] h-20 rounded-r bg-white/15" />
      <div className="relative w-full h-full rounded-[2.7rem] bg-white overflow-hidden flex flex-col">
        {/* Dynamic island */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-24 h-7 bg-black rounded-full z-20" />

        {/* Header */}
        <div className="bg-brand-gradient px-4 pt-9 pb-4 text-white">
          <div className="flex items-center justify-between text-[10px] font-bold mb-3 px-0.5">
            <span>9:41</span>
            <span className="w-4 h-2.5 rounded-[2px] border border-white/70 relative">
              <span className="absolute inset-[1px] right-[3px] bg-white rounded-[1px]" />
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center font-extrabold text-sm ring-2 ring-white/30">
              N
            </div>
            <div className="leading-tight">
              <div className="text-white/80 text-[10px] font-medium">Salam,</div>
              <div className="text-white text-base font-extrabold">İstifadəçi</div>
            </div>
            <span className="ml-auto relative">
              <Bell size={18} className="text-white/90" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-brand-600" />
            </span>
          </div>
          <div className="mt-3 bg-white rounded-2xl px-3 py-2.5 flex items-center gap-2 shadow-sm">
            <Search size={15} className="text-muted" />
            <span className="text-xs text-muted font-medium">Xidmət axtar...</span>
          </div>
        </div>

        {/* Active order strip */}
        <div className="px-3 pt-3">
          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-2.5 flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
              <MapPin size={16} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-extrabold text-ink">Usta yoldadır</div>
              <div className="text-[9px] text-emerald-700 font-semibold">10 dəq · canlı izləmə</div>
            </div>
            <span className="text-[9px] font-extrabold text-emerald-700 bg-white px-2 py-1 rounded-lg">Aktiv</span>
          </div>
        </div>

        {/* Services */}
        <div className="flex-1 px-3 pt-3 space-y-2 overflow-hidden">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-extrabold text-ink">Populyar xidmətlər</span>
            <span className="text-[10px] font-bold text-brand-600">Hamısı</span>
          </div>
          {services.map(({ label, sub, Icon, tile, fg }) => (
            <div
              key={label}
              className="bg-white rounded-2xl border border-border p-2 flex items-center gap-2.5 shadow-[0_1px_4px_rgba(0,0,0,.04)]"
            >
              <div className={`w-10 h-10 rounded-xl ${tile} ${fg} flex items-center justify-center shrink-0`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-extrabold text-ink">{label}</div>
                <div className="text-[9px] text-muted font-semibold">{sub}</div>
              </div>
              <Star size={11} className="fill-amber-400 text-amber-400" />
            </div>
          ))}
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border bg-white px-6 py-2.5 flex items-center justify-between">
          {[Home, Search, CreditCard, Heart].map((Icon, i) => (
            <span key={i} className={i === 0 ? 'text-brand-600' : 'text-muted'}>
              <Icon size={18} className={i === 0 ? 'fill-brand-100' : ''} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
