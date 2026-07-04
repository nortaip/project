import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
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

interface Cat {
  id: string;
  label: string;
}
interface ProviderRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  is_verified: boolean | null;
}

const URL = 'https://ellit.az/usta-xidmeti';

/**
 * "Usta xidməti" üçün xüsusi SEO landing səhifəsi.
 * Hədəf açar sözlər: usta xidməti, usta sifariş et, peşəkar usta,
 * evə usta çağır, onlayn usta, Bakıda usta.
 */
export default function UstaXidmeti() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [catRes, provRes] = await Promise.all([
        supabase
          .from('service_categories')
          .select('id,label,is_active')
          .eq('is_active', true)
          .order('label'),
        supabase
          .from('profiles')
          .select('id,name,avatar_url,rating,is_verified')
          .eq('role', 'provider')
          .eq('is_verified', true)
          .order('rating', { ascending: false, nullsFirst: false })
          .limit(12),
      ]);
      if (cancelled) return;
      setCats(((catRes.data as Cat[]) ?? []).filter((c) => c.label));
      setProviders((provRes.data as ProviderRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const faq = useMemo(
    () => [
      {
        question: 'Onlayn usta xidmətini necə sifariş edim?',
        answer:
          'Ellit.az-da sizə lazım olan usta xidmətini (santexnik, elektrik, kondisioner ustası, mebel ustası və s.) seçin, sorğunuzu yaradın və dəqiqələr içində yoxlanılmış ustalardan təkliflər alın. Ən uyğun qiymət və reytinqi seçib təhlükəsiz ödəyin.',
      },
      {
        question: 'Usta xidmətinin qiyməti nə qədərdir?',
        answer:
          'Usta xidmətinin qiyməti işin növündən və həcmindən asılıdır. Sorğu yaratdıqdan sonra bir neçə ustadan pulsuz təklif alıb qiymətləri müqayisə edə bilərsiniz — heç bir ilkin ödəniş tələb olunmur.',
      },
      {
        question: 'Evə usta çağıra bilərəmmi?',
        answer:
          'Bəli. Ünvanınızı və vaxtı qeyd edin, usta birbaşa evinizə gəlsin. Bütün ustalar yoxlanılır, gəliş vaxtı və mərhələləri tətbiq üzərindən izləyə bilərsiniz.',
      },
      {
        question: 'Ustalar etibarlıdırmı?',
        answer:
          'Bəli. Bütün ustalar şəxsiyyət və peşəkar təcrübə sənədləri ilə yoxlanılır, müştəri rəyləri ilə qiymətləndirilir. Ödənişlər iş tamamlanana qədər təhlükəsiz saxlanılır.',
      },
    ],
    [],
  );

  const title = 'Usta xidməti — onlayn usta sifariş et | Bakı və bütün Azərbaycan';
  const description =
    'Usta xidməti lazımdır? Ellit.az-da yoxlanılmış ustalardan onlayn usta sifariş edin — santexnik, elektrik, kondisioner, mebel və yüzlərlə usta xidməti. Dəqiqələr içində təklif alın, qiymət müqayisə edin, evə usta çağırın. Təhlükəsiz ödəniş və zəmanət.';

  return (
    <PageContainer size="xl">
      <SEO
        title={title}
        description={description}
        canonical={URL}
        type="website"
        jsonLd={[
          serviceJsonLd({
            name: 'Usta xidməti',
            description,
            price: 0,
            category: 'Usta xidməti',
          }),
          breadcrumbJsonLd([
            { name: 'Ana səhifə', url: 'https://ellit.az/' },
            { name: 'Usta xidməti', url: URL },
          ]),
          faqPageJsonLd(faq),
        ]}
      />

      {/* Breadcrumb */}
      <nav className="text-xs text-muted mb-3 flex items-center gap-1.5">
        <Link to="/" className="hover:text-brand-600">
          Ana səhifə
        </Link>
        <span>/</span>
        <span className="text-ink-soft font-semibold">Usta xidməti</span>
      </nav>

      {/* Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-accent-500 text-white p-6 sm:p-10 mb-8">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-bold border border-white/20 mb-4">
          <Wrench size={14} /> Onlayn usta xidməti
        </span>
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight max-w-3xl">
          Usta xidməti — yoxlanılmış ustadan onlayn sifariş et
        </h1>
        <p className="mt-3 text-white/90 max-w-2xl leading-relaxed text-sm sm:text-base">
          Santexnik, elektrik, kondisioner ustası, mebel ustası və yüzlərlə usta
          xidmətini Ellit.az üzərindən sifariş edin. Sorğu yaradın, dəqiqələr
          içində təkliflər alın, ən uyğun ustanı seçib evinizə çağırın.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/services"
            className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 transition-colors shadow-card"
          >
            Usta sifariş et <ArrowRight size={18} />
          </Link>
          <span className="inline-flex items-center gap-4 text-sm font-semibold text-white/90">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={15} /> Yoxlanılmış ustalar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={15} /> Dəqiqələr içində təklif
            </span>
          </span>
        </div>
      </div>

      {/* Usta kateqoriyaları */}
      {cats.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight mb-4">
            Usta xidməti növləri
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cats.map((c) => (
              <Link
                key={c.id}
                to={`/xidmet/${slugify(c.label)}`}
                className="group bg-white rounded-2xl border border-border p-4 hover:border-brand-300 transition-colors flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                  <Wrench size={18} />
                </div>
                <span className="font-bold text-ink leading-tight line-clamp-2">
                  {c.label}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top ustalar */}
      {providers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight mb-4">
            Reytinqi yüksək ustalar
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {providers.map((p) => (
              <Link
                key={p.id}
                to={`/provider/${p.id}`}
                className="bg-white rounded-2xl border border-border p-4 hover:border-brand-300 transition-colors flex items-center gap-3"
              >
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt={p.name ?? 'Usta'}
                    loading="lazy"
                    className="w-14 h-14 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
                    {(p.name ?? '?')[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-extrabold text-ink truncate">
                      {p.name ?? '—'}
                    </h3>
                    {p.is_verified && (
                      <ShieldCheck size={15} className="text-success shrink-0" />
                    )}
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

      {/* SEO mətn */}
      <section className="max-w-3xl mb-10">
        <h2 className="text-xl font-extrabold text-ink tracking-tight mb-3">
          Ellit.az ilə usta xidməti
        </h2>
        <p className="text-ink-soft leading-relaxed">
          Ellit.az Azərbaycanın onlayn usta və xidmət marketpleysidir. Evdə və ya
          ofisdə usta xidməti lazım olduqda — istər santexnik, istər elektrik,
          istər kondisioner, qaz, mebel və ya təmir ustası — sadəcə sorğu yaradın.
          Yoxlanılmış ustalar sizə dəqiqələr içində təklif göndərir. Təklifləri
          qiymət və reytinqə görə müqayisə edin, ən uyğun ustanı seçin və işi
          platforma üzərindən təhlükəsiz idarə edin. Ustanın gəlişini və işin
          mərhələlərini canlı izləyə bilərsiniz, ödəniş isə iş tamamlanana qədər
          qorunur. Bakıda və bütün Azərbaycanda peşəkar usta xidmətini bir kliklə
          sifariş edin.
        </p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mb-12">
        <h2 className="text-xl font-extrabold text-ink tracking-tight mb-4">
          Usta xidməti — tez-tez verilən suallar
        </h2>
        <div className="space-y-3">
          {faq.map((f) => (
            <div
              key={f.question}
              className="bg-white rounded-2xl border border-border p-4"
            >
              <h3 className="font-bold text-ink flex items-start gap-2">
                <CheckCircle2 size={18} className="text-brand-600 shrink-0 mt-0.5" />
                {f.question}
              </h3>
              <p className="mt-1.5 text-sm text-ink-soft leading-relaxed pl-7">
                {f.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-3xl bg-surface-alt border border-border p-6 sm:p-8 text-center mb-10">
        <Sparkles size={28} className="text-brand-600 mx-auto mb-3" />
        <h2 className="text-xl sm:text-2xl font-extrabold text-ink mb-2">
          İndi usta xidməti sifariş et
        </h2>
        <p className="text-ink-soft max-w-xl mx-auto mb-5">
          Sorğunu yarat, yoxlanılmış ustalardan təklif al və ən uyğununu seç.
          Qeydiyyat pulsuzdur.
        </p>
        <Link
          to="/services"
          className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors shadow-brand-soft"
        >
          Sifariş yarat <ArrowRight size={18} />
        </Link>
      </section>
    </PageContainer>
  );
}
