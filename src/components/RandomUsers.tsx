import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  MapPin,
  Search,
  Sparkles,
  Star,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { SEO, organizationJsonLd } from './SEO';

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

export function RandomUsers() {
  const { t: _t } = useTranslation();
  void _t;
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
      { value: stats.providers, suffix: '+', label: 'Mütəxəssis' },
      { value: stats.services, suffix: '+', label: 'Xidmət' },
      { value: stats.bookings, suffix: '+', label: 'Tamamlanmış sifariş' },
    ],
    [stats],
  );

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
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-accent-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-white/5 blur-3xl" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-20 sm:pt-24 sm:pb-32">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs sm:text-sm font-bold border border-white/20">
              <Sparkles size={14} />
              Azərbaycanın #1 onlayn xidmət marketpleysi
            </span>
          </div>

          <h1 className="text-center text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight max-w-4xl mx-auto">
            Etibarlı mütəxəssis,{' '}
            <span className="bg-gradient-to-r from-white to-accent-200 bg-clip-text text-transparent">
              bir kliklə
            </span>
          </h1>
          <p className="mt-4 text-center text-base sm:text-lg lg:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed">
            Yüzlərlə təsdiqlənmiş provayderdən onlayn sifariş et. Sürətli, təhlükəsiz, zəmanətli.
          </p>

          <form
            onSubmit={onSearch}
            className="mt-8 max-w-2xl mx-auto bg-white rounded-2xl shadow-card-lg p-2 flex items-center gap-2"
          >
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Hansı xidməti axtarırsız? (məs. ev təmizliyi)"
                className="w-full h-12 pl-11 pr-3 bg-transparent text-ink placeholder:text-muted text-sm sm:text-base focus:outline-none"
                aria-label="Xidmət axtar"
              />
            </div>
            <button
              type="submit"
              className="h-12 px-5 sm:px-7 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm sm:text-base transition-colors shadow-brand-soft inline-flex items-center gap-2"
            >
              <span className="hidden sm:inline">Axtar</span>
              <ArrowRight size={18} />
            </button>
          </form>

          {/* Live numbers */}
          <div className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            {heroStats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl sm:text-4xl font-extrabold leading-none tracking-tight">
                  {formatStat(s.value)}
                  {s.value > 0 && <span className="text-accent-200">{s.suffix}</span>}
                </div>
                <div className="mt-2 text-xs sm:text-sm text-white/80 font-medium">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Hero CTA pair */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/services"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 transition-colors shadow-card"
            >
              Xidmətlərə bax <ArrowRight size={18} />
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white/10 backdrop-blur-sm border border-white/30 text-white font-bold hover:bg-white/20 transition-colors"
            >
              Provayder kimi qoşul
            </Link>
          </div>
        </div>

        {/* Wave divider */}
        <svg
          aria-hidden
          className="block w-full h-12 sm:h-16 -mb-px"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
        >
          <path
            d="M0,40 C320,80 720,0 1440,50 L1440,80 L0,80 Z"
            fill="white"
          />
        </svg>
      </section>

      {/* ═══════════════════ REAL CATEGORY ROW (DB-dən) ═══════════════════ */}
      {categories.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <SectionHeader
            title="Populyar kateqoriyalar"
            subtitle={`${categories.length} fərqli xidmət kateqoriyası`}
            actionLabel="Hamısı"
            actionHref="/services"
          />
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c) => (
              <Link
                key={c.category}
                to={`/services?category=${encodeURIComponent(c.category)}`}
                className="shrink-0 inline-flex items-center gap-2 h-11 px-4 rounded-2xl bg-white border border-border hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-all text-sm font-bold text-ink-soft"
              >
                {c.category}
                <span className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-extrabold">
                  {c.count}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════════ CITIES / REGIONS ═══════════════════ */}
      {cities.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <SectionHeader
            title="Şəhərlər üzrə xidmət"
            subtitle="Yaşadığın şəhərdə mövcud olan xidmətlər"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {cities.map((c) => (
              <Link
                key={c.city}
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
                  <div className="text-xs text-muted">{c.count} xidmət</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════════ TOP PROVIDERS ═══════════════════ */}
      {providers.length > 0 && (
        <section className="bg-surface-bg py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <SectionHeader
              title="Reytinqli mütəxəssislər"
              subtitle="Təsdiqlənmiş və ən çox rəy almış provayderlər"
              actionLabel="Hamısı"
              actionHref="/providers"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
              {providers.map((p) => (
                <Link
                  key={p.id}
                  to={`/provider/${p.id}`}
                  className="group bg-white rounded-2xl border border-border p-4 text-center hover:border-brand-300 hover:shadow-card transition-all"
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
                  {(p.rating ?? 0) > 0 && (
                    <div className="mt-1 inline-flex items-center justify-center gap-1 text-xs text-muted">
                      <Star size={11} className="fill-warning text-warning" />
                      <span className="font-bold text-ink-soft">{(p.rating ?? 0).toFixed(1)}</span>
                      {p.reviews_count ? <span>· {p.reviews_count}</span> : null}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════════ RECENT ACTIVITY ═══════════════════ */}
      {recent.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <SectionHeader
            title="Son əlavə olunan xidmətlər"
            subtitle="Provayderlərimiz dayanmadan yeni xidmətlər əlavə edir"
            actionLabel="Hamısı"
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
                      {timeAgo(s.created_at)}
                    </span>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted shrink-0 group-hover:text-brand-600 transition-colors" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════════ MOBILE APP DOWNLOAD ═══════════════════ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 text-white p-8 sm:p-12 lg:p-16 shadow-card-lg">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-12 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-accent-200/20 blur-3xl" />

          <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-bold border border-white/20">
                <Sparkles size={14} /> Mobil tətbiq
              </span>
              <h2 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight max-w-2xl">
                Ellit.az — sənin cibində
              </h2>
              <p className="mt-3 text-white/90 text-base sm:text-lg max-w-xl leading-relaxed">
                Sürətli sifariş, anlıq bildiriş, mobil ödəniş. iOS və Android üçün indi yüklə.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <a
                  href="https://apps.apple.com/az/app/ellit-az/id0000000000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 h-14 px-5 rounded-xl bg-ink text-white hover:bg-black transition-colors"
                  aria-label="App Store-dan yüklə"
                >
                  <AppleLogo />
                  <div className="text-left leading-tight">
                    <div className="text-[11px] text-white/70 font-medium">App Store</div>
                    <div className="text-base font-extrabold">İndi yüklə</div>
                  </div>
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=az.ellit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 h-14 px-5 rounded-xl bg-ink text-white hover:bg-black transition-colors"
                  aria-label="Google Play-dən yüklə"
                >
                  <PlayLogo />
                  <div className="text-left leading-tight">
                    <div className="text-[11px] text-white/70 font-medium">Google Play</div>
                    <div className="text-base font-extrabold">İndi yüklə</div>
                  </div>
                </a>
              </div>
            </div>

            {/* Phone mockup */}
            <div className="hidden lg:flex justify-center">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-ink tracking-tight">
            Tez-tez verilən suallar
          </h2>
          <p className="mt-2 text-base text-muted">
            Əgər cavabı tapmasan, bizə{' '}
            <Link to="/about" className="text-brand-600 font-bold hover:underline">
              əlaqə
            </Link>{' '}
            səhifəsindən yaza bilərsən.
          </p>
        </div>
        <div className="space-y-3">
          {FAQ_ITEMS.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      {/* ═══════════════════ PROVIDER CTA ═══════════════════ */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="relative overflow-hidden rounded-3xl border-2 border-dashed border-brand-200 bg-brand-50 p-8 sm:p-10">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-brand-700 tracking-tight">
                Provayder kimi qoşul
              </h2>
              <p className="mt-2 text-sm sm:text-base text-ink-soft max-w-xl">
                Pulsuz qeydiyyat, 0% giriş haqqı. Yalnız uğurlu işdən komissiya tutulur.
              </p>
            </div>
            <Link
              to="/signup"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors shadow-brand-soft"
            >
              Qeydiyyatdan keç <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Helpers / sub-components ───────────────────────────────────────────

function formatStat(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'indicə';
  if (diff < 3600) return `${Math.floor(diff / 60)} dəq əvvəl`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat əvvəl`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} gün əvvəl`;
  return new Date(iso).toLocaleDateString('az-AZ');
}

const FAQ_ITEMS = [
  {
    q: 'Ellit.az necə işləyir?',
    a: 'Saytdan və ya mobil tətbiqdən sənə lazım olan xidməti seç, tarixi və saatı təyin et, ödənişi onlayn et. Provayder təsdiqlədikdən sonra xidmət vaxtında çatdırılır.',
  },
  {
    q: 'Provayderlər doğrudan da yoxlanılır?',
    a: 'Bəli. Hər provayder qeydiyyatdan keçəndə şəxsiyyət və peşəkar təcrübə sənədləri əl ilə yoxlanılır. Yoxlanışdan keçənlərə "Təsdiqlənmiş" nişanı verilir.',
  },
  {
    q: 'Ödənişlərim təhlükəsizdir?',
    a: 'Bütün ödənişlər Epoint ödəniş sistemi vasitəsi ilə bank səviyyəsində SSL şifrələmə ilə qorunur. Kart məlumatların heç vaxt bizim serverə düşmür.',
  },
  {
    q: 'Sifarişi ləğv edə bilərəmmi?',
    a: 'Bəli, xidmət başlamadan ən azı 4 saat öncə sifarişi ləğv etsən, ödəniş tam geri qaytarılır. Sonradan ləğvlər üçün ləğv siyasəti tətbiq olunur.',
  },
  {
    q: 'Provayder kimi qoşulmaq pulludurmu?',
    a: 'Xeyr, qeydiyyat və profil yaratmaq tamamilə pulsuzdur. Yalnız uğurla tamamlanmış sifarişdən kiçik komissiya tutulur — heç bir gizli xərc yoxdur.',
  },
];

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
      <div>
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-ink tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm sm:text-base text-muted">{subtitle}</p>}
      </div>
      {actionLabel && actionHref && (
        <Link
          to={actionHref}
          className="shrink-0 inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
        >
          {actionLabel} <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

function AppleLogo() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.564 12.79c-.024-2.41 1.97-3.564 2.06-3.62-1.124-1.643-2.873-1.868-3.494-1.894-1.486-.151-2.903.876-3.658.876-.756 0-1.92-.854-3.157-.83-1.624.024-3.122.943-3.957 2.394-1.687 2.928-.43 7.262 1.21 9.638.804 1.166 1.762 2.474 3.02 2.428 1.214-.05 1.673-.785 3.143-.785 1.469 0 1.881.785 3.157.76 1.305-.024 2.131-1.186 2.927-2.357.92-1.353 1.297-2.66 1.32-2.728-.029-.013-2.534-.973-2.57-3.882zM15.13 5.33c.668-.81 1.12-1.93.996-3.05-.962.04-2.13.642-2.82 1.45-.62.71-1.16 1.85-1.014 2.94 1.073.083 2.17-.546 2.838-1.34z" />
    </svg>
  );
}

function PlayLogo() {
  return (
    <svg width={24} height={24} viewBox="0 0 512 512" aria-hidden>
      <path fill="#34A853" d="M325.3 234.3 104.6 13.5l257.4 148.2-36.7 72.6z" />
      <path fill="#FBBC04" d="m467.3 271.2-79.3 45.7-43.5-43.5 43.5-43.5 79.3 45.5c8 4.6 8 16.3 0 21z" />
      <path fill="#EA4335" d="M104.6 498.5 325.3 277.7l36.7 72.6-257.4 148.2z" />
      <path fill="#4285F4" d="M104.6 13.5c-3.7 0-7 1.4-9.5 4-2.7 2.6-4.1 6-4.1 9.7v457.6c0 3.7 1.4 7.1 4.1 9.7 2.5 2.6 5.8 4 9.5 4l263.6-242.5L104.6 13.5z" />
    </svg>
  );
}

function PhoneMockup() {
  return (
    <div className="relative w-64 h-[500px] rounded-[3rem] bg-ink p-3 shadow-2xl ring-4 ring-white/10">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-6 bg-ink rounded-b-2xl z-10" />
      <div className="w-full h-full rounded-[2.4rem] bg-gradient-to-b from-brand-50 to-white overflow-hidden flex flex-col">
        <div className="bg-brand-gradient p-4 pt-10">
          <div className="text-white/80 text-[10px] font-medium">Salam,</div>
          <div className="text-white text-lg font-extrabold">İstifadəçi</div>
          <div className="mt-3 bg-white rounded-xl px-3 py-2 flex items-center gap-2">
            <Search size={14} className="text-muted" />
            <span className="text-xs text-muted">Xidmət axtar...</span>
          </div>
        </div>
        <div className="flex-1 p-3 space-y-2">
          {['Ev təmizliyi', 'Avto təmiri', 'Gözəllik'].map((c, i) => (
            <div key={c} className="bg-white rounded-xl border border-border p-2 flex items-center gap-2">
              <div className={`w-9 h-9 rounded-lg ${
                i === 0 ? 'bg-brand-100' : i === 1 ? 'bg-accent-100' : 'bg-warning/20'
              }`} />
              <div className="flex-1">
                <div className="text-[11px] font-bold text-ink">{c}</div>
                <div className="text-[9px] text-muted">12 mütəxəssis</div>
              </div>
              <Star size={10} className="fill-warning text-warning" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
