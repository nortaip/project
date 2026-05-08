import { Award, Clock, Globe, Phone, Shield, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageContainer, StatTile } from '../components/ui';
import { SEO, organizationJsonLd } from '../components/SEO';

const STATS = [
  { icon: Users, value: '10K+', key: 'users' },
  { icon: Shield, value: '500+', key: 'providers' },
  { icon: Award, value: '50+', key: 'categories' },
  { icon: Clock, value: '5+', key: 'years' },
];

const VALUES = [
  { icon: Shield, key: 'trust' },
  { icon: Globe, key: 'reach' },
  { icon: Phone, key: 'support' },
];

export const About = () => {
  const { t } = useTranslation();

  return (
    <div className="bg-surface">
      <SEO
        title="Haqqımızda"
        description="Ellit.az — Azərbaycanın aparıcı onlayn xidmət marketpleysi. Etibarlı provayderlər, sürətli sifariş və zəmanətli xidmət."
        canonical="https://ellit.az/about"
        jsonLd={organizationJsonLd()}
      />
      {/* Hero — gradient banner */}
      <div className="relative bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            {t('about.title') || 'Ellit haqqında'}
          </h1>
          <p className="text-lg sm:text-xl text-white/90 max-w-3xl mx-auto leading-relaxed">
            {t('about.subtitle') ||
              'Azərbaycanda gündəlik xidmətləri rahat və təhlükəsiz şəkildə sifariş etmək üçün qurulmuş ən böyük platforma'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <PageContainer size="xl" className="py-12 sm:py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {STATS.map((s) => (
            <StatTile
              key={s.key}
              label={t(`about.stats.${s.key}.label`) || s.key}
              value={s.value}
              icon={<s.icon size={18} />}
            />
          ))}
        </div>
      </PageContainer>

      {/* Values */}
      <PageContainer size="xl" className="pb-12 sm:pb-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight">
            {t('about.values.title') || 'Dəyərlərimiz'}
          </h2>
          <p className="mt-2 text-muted">
            {t('about.values.subtitle') || 'Hər müştəri üçün ən yaxşısı'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {VALUES.map((v) => (
            <div
              key={v.key}
              className="bg-white rounded-3xl border border-border p-6 text-center hover:border-brand-300 transition-colors"
            >
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 text-brand-600 flex items-center justify-center mb-4">
                <v.icon size={26} />
              </div>
              <h3 className="text-lg font-extrabold text-ink mb-1">
                {t(`about.values.${v.key}.title`) || v.key}
              </h3>
              <p className="text-sm text-muted">
                {t(`about.values.${v.key}.description`) ||
                  'Detallı təsvir tezliklə əlavə olunacaq'}
              </p>
            </div>
          ))}
        </div>
      </PageContainer>
    </div>
  );
};

export default About;
