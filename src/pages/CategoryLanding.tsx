import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageContainer } from '../components/ui';
import {
  SEO,
  serviceJsonLd,
  breadcrumbJsonLd,
  faqPageJsonLd,
} from '../components/SEO';
import { slugify } from '../lib/slug';

interface Category {
  id: string;
  label: string;
  label_ru: string | null;
  label_en: string | null;
}
interface ServiceRow {
  id: string;
  title: string;
  price: number | null;
  rating: number | null;
  location: string | null;
  images: string[] | null;
}
interface ProviderRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  is_verified: boolean | null;
}

export default function CategoryLanding() {
  const { slug } = useParams<{ slug: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      // Kanonik kateqoriyalar (deaktivləri kəsmək + ustalarla əlaqə üçün) +
      // xidmətlərdəki kateqoriya mətnləri (ana səhifə bunlara link verir)
      const [canonRes, svcCatRes] = await Promise.all([
        supabase.from('service_categories').select('id,label,is_active'),
        supabase.from('services').select('category').limit(2000),
      ]);
      const canon = (canonRes.data as { id: string; label: string; is_active: boolean | null }[]) ?? [];
      const canonMatch = canon.find((c) => slugify(c.label) === slug);

      // Deaktiv kanonik kateqoriya → landing yox
      if (canonMatch && canonMatch.is_active === false) {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
        return;
      }

      let label = canonMatch?.label ?? '';
      const categoryId = canonMatch?.id ?? null;
      if (!label) {
        const set = new Set(
          ((svcCatRes.data as { category: string | null }[]) ?? [])
            .map((r) => (r.category ?? '').trim())
            .filter(Boolean),
        );
        label = [...set].find((c) => slugify(c) === slug) ?? '';
      }
      if (!label) {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
        return;
      }

      const [svcRes, provRes] = await Promise.all([
        supabase
          .from('services')
          .select('id,title,price,rating,location,images')
          .eq('category', label)
          .limit(48),
        categoryId
          ? supabase
              .from('profiles')
              .select('id,name,avatar_url,rating,is_verified,specialties')
              .eq('role', 'provider')
              .contains('specialties', [categoryId])
              .order('rating', { ascending: false, nullsFirst: false })
              .limit(24)
          : Promise.resolve({ data: [] as ProviderRow[] }),
      ]);
      if (cancelled) return;
      setCategory({ id: categoryId ?? label, label, label_ru: null, label_en: null });
      setServices((svcRes.data as ServiceRow[]) ?? []);
      setProviders((provRes.data as ProviderRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const label = category?.label ?? '';
  const url = `https://ellit.az/xidmet/${slug}`;

  const faq = useMemo(
    () => [
      {
        question: `${label} xidmətini onlayn necə sifariş edim?`,
        answer: `Ellit.az-da "${label}" kateqoriyasını seçin, sorğunuzu yaradın və yoxlanılmış ustalardan dəqiqələr içində təkliflər alın. Ən uyğununu seçib təhlükəsiz ödəyin.`,
      },
      {
        question: `${label} qiyməti nə qədərdir?`,
        answer: `Qiymət işin həcmindən asılıdır. Sorğu yaratdıqdan sonra bir neçə ustadan təklif alıb qiymətləri müqayisə edə bilərsiniz — heç bir ilkin ödəniş tələb olunmur.`,
      },
      {
        question: `Ustalar etibarlıdırmı?`,
        answer: `Bəli. Bütün provayderlər yoxlanılır və müştəri rəyləri ilə qiymətləndirilir. Ödənişlər iş bitənə qədər təhlükəsiz saxlanılır.`,
      },
    ],
    [label],
  );

  if (loading) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-24">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (notFound || !category) {
    return (
      <PageContainer size="md">
        <SEO title="Kateqoriya tapılmadı" noindex canonical={url} />
        <div className="text-center py-16">
          <h1 className="text-xl font-extrabold text-ink mb-3">Kateqoriya tapılmadı</h1>
          <Link to="/services" className="text-brand-600 font-bold hover:underline">
            Bütün xidmətlər
          </Link>
        </div>
      </PageContainer>
    );
  }

  const title = `${label} — onlayn xidmət sifarişi | usta və mütəxəssis`;
  const description = `${label} üzrə yoxlanılmış ustalardan onlayn xidmət sifariş edin. Dəqiqələr içində təkliflər alın, qiymətləri müqayisə edin, təhlükəsiz ödəyin. Ellit.az — Azərbaycanın xidmət marketpleysi.`;

  return (
    <PageContainer size="xl">
      <SEO
        title={title}
        description={description}
        canonical={url}
        type="website"
        jsonLd={[
          serviceJsonLd({
            name: `${label} xidməti`,
            description,
            price: services.length
              ? Math.min(...services.map((s) => Number(s.price ?? 0)).filter((n) => n > 0))
              : 0,
            category: label,
          }),
          breadcrumbJsonLd([
            { name: 'Ana səhifə', url: 'https://ellit.az/' },
            { name: 'Xidmətlər', url: 'https://ellit.az/services' },
            { name: label, url },
          ]),
          faqPageJsonLd(faq),
        ]}
      />

      {/* Hero */}
      <nav className="text-xs text-muted mb-3 flex items-center gap-1.5">
        <Link to="/" className="hover:text-brand-600">Ana səhifə</Link>
        <span>/</span>
        <Link to="/services" className="hover:text-brand-600">Xidmətlər</Link>
        <span>/</span>
        <span className="text-ink-soft font-semibold">{label}</span>
      </nav>

      <div className="rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-accent-500 text-white p-6 sm:p-10 mb-8">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-bold border border-white/20 mb-4">
          <Sparkles size={14} /> Ellit.az
        </span>
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight max-w-2xl">
          {label} — onlayn sifariş
        </h1>
        <p className="mt-3 text-white/90 max-w-2xl leading-relaxed text-sm sm:text-base">
          {label} üzrə yoxlanılmış ustalardan dəqiqələr içində təkliflər alın, qiymətləri müqayisə
          edin və işi təhlükəsiz şəkildə sifariş edin.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to={`/services?category=${encodeURIComponent(label)}`}
            className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 transition-colors shadow-card"
          >
            Sifariş yarat <ArrowRight size={18} />
          </Link>
          <span className="inline-flex items-center gap-4 text-sm font-semibold text-white/90">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} /> Təhlükəsiz ödəniş</span>
            <span className="inline-flex items-center gap-1.5"><Star size={15} className="fill-white" /> Yoxlanılmış ustalar</span>
          </span>
        </div>
      </div>

      {/* Providers */}
      {providers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight mb-4">
            {label} üzrə ustalar ({providers.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {providers.map((p) => (
              <Link
                key={p.id}
                to={`/provider/${p.id}`}
                className="bg-white rounded-2xl border border-border p-4 hover:border-brand-300 transition-colors flex items-center gap-3"
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt={p.name ?? ''} loading="lazy" className="w-14 h-14 rounded-2xl object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
                    {(p.name ?? '?')[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-extrabold text-ink truncate">{p.name ?? '—'}</h3>
                    {p.is_verified && <ShieldCheck size={15} className="text-success shrink-0" />}
                  </div>
                  {Number(p.rating ?? 0) > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                      <Star size={12} className="text-warning fill-warning" />
                      {Number(p.rating ?? 0).toFixed(1)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Services */}
      {services.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight mb-4">
            {label} xidmətləri ({services.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => (
              <Link
                key={s.id}
                to={`/book/${s.id}`}
                className="block bg-white rounded-2xl border border-border overflow-hidden hover:border-brand-300 transition-colors"
              >
                <div
                  className="w-full h-32 bg-cover bg-center bg-surface-alt"
                  style={{
                    backgroundImage: s.images?.[0]
                      ? `url(${s.images[0]})`
                      : 'linear-gradient(135deg, #EFF4FF, #ECFEFF)',
                  }}
                />
                <div className="p-4">
                  <h3 className="font-extrabold text-ink line-clamp-2 leading-tight">{s.title}</h3>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    {s.location && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted truncate">
                        <MapPin size={12} /> {s.location}
                      </span>
                    )}
                    {Number(s.price ?? 0) > 0 && (
                      <span className="font-extrabold text-ink">{Number(s.price).toFixed(0)} ₼</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SEO intro text */}
      <section className="prose-sm max-w-3xl mb-10">
        <h2 className="text-xl font-extrabold text-ink tracking-tight mb-3">
          Ellit.az ilə {label} sifarişi
        </h2>
        <p className="text-ink-soft leading-relaxed">
          Ellit.az Azərbaycanın onlayn xidmət marketpleysidir. {label} üzrə ehtiyacınız olduqda
          sadəcə sorğu yaradın — yoxlanılmış və qiymətləndirilmiş ustalar sizə təklif göndərsin.
          Təklifləri qiymət və reytinqə görə müqayisə edin, ən uyğununu seçin və işi platforma
          üzərindən təhlükəsiz idarə edin. Ödənişlər iş tamamlanana qədər qorunur.
        </p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mb-12">
        <h2 className="text-xl font-extrabold text-ink tracking-tight mb-4">Tez-tez verilən suallar</h2>
        <div className="space-y-3">
          {faq.map((f) => (
            <div key={f.question} className="bg-white rounded-2xl border border-border p-4">
              <h3 className="font-bold text-ink flex items-start gap-2">
                <CheckCircle2 size={18} className="text-brand-600 shrink-0 mt-0.5" />
                {f.question}
              </h3>
              <p className="mt-1.5 text-sm text-ink-soft leading-relaxed pl-7">{f.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
