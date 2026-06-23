import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, PageContainer } from '../components/ui';
import { SEO, personJsonLd, breadcrumbJsonLd } from '../components/SEO';

interface Provider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  is_verified: boolean | null;
  specialties: string[] | null;
  experience_years: number | null;
  address: string | null;
  email: string | null;
  phone_number: string | null;
  company_name: string | null;
}

interface ServiceItem {
  id: string;
  title: string;
  description: string | null;
  price: number;
  category: string;
  images: string[] | null;
  rating: number | null;
}

export function ProviderProfile() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    void Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase
        .from('services')
        .select('id, title, description, price, category, images, rating')
        .eq('provider_id', id),
    ]).then(([pResp, sResp]) => {
      setProvider(pResp.data as Provider);
      setServices((sResp.data ?? []) as ServiceItem[]);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!provider) {
    return (
      <PageContainer size="md">
        <Card variant="elevated" padding="lg" className="text-center">
          <h1 className="text-xl font-extrabold text-ink mb-2">Provayder tapılmadı</h1>
          <Link to="/providers">
            <Button variant="primary" size="md">
              Provayder siyahısı
            </Button>
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const initials = (provider.name ?? '?')[0]?.toUpperCase() ?? '?';

  return (
    <PageContainer size="lg">
      <SEO
        title={provider.name ?? 'Provayder'}
        description={`${provider.name ?? 'Provayder'} — Ellit.az üzərindən onlayn xidmət sifariş edin. Etibarlı və zəmanətli.`}
        canonical={`https://ellit.az/provider/${provider.id}`}
        type="profile"
        image={provider.avatar_url ?? undefined}
        jsonLd={[
          personJsonLd({
            name: provider.name ?? 'Provayder',
            image: provider.avatar_url,
            url: `https://ellit.az/provider/${provider.id}`,
          }),
          breadcrumbJsonLd([
            { name: 'Ana səhifə', url: 'https://ellit.az/' },
            { name: 'Provayderlər', url: 'https://ellit.az/providers' },
            { name: provider.name ?? 'Provayder', url: `https://ellit.az/provider/${provider.id}` },
          ]),
        ]}
      />
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={16} /> {t('providerProfile.back')}
      </button>

      {/* Hero */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {provider.avatar_url ? (
            <img
              src={provider.avatar_url}
              alt={provider.name ?? ''}
              className="w-24 h-24 rounded-3xl object-cover shrink-0"
            />
          ) : (
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center text-4xl font-extrabold shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                {provider.name ?? '—'}
              </h1>
              {provider.is_verified && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-success bg-success/10 px-2 py-1 rounded-lg">
                  <ShieldCheck size={14} /> {t('providerProfile.verified')}
                </span>
              )}
            </div>

            {provider.company_name && (
              <p className="mt-1 text-muted">{provider.company_name}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted">
              {(provider.rating ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 font-bold text-warning">
                  <Star size={14} className="fill-warning" />
                  {Number(provider.rating ?? 0).toFixed(1)}
                </span>
              )}
              {provider.experience_years && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase size={14} /> {t('providerProfile.experience', { count: provider.experience_years })}
                </span>
              )}
              {provider.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {provider.address}
                </span>
              )}
            </div>

            {(provider.specialties ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(provider.specialties ?? []).map((s) => (
                  <span
                    key={s}
                    className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contact CTA */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {provider.phone_number && (
            <a
              href={`tel:${provider.phone_number}`}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-border bg-white text-ink font-bold hover:border-brand-300 transition-colors"
            >
              <Phone size={16} /> {t('providerProfile.callPhone')}
            </a>
          )}
          {provider.email && (
            <a
              href={`mailto:${provider.email}`}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-border bg-white text-ink font-bold hover:border-brand-300 transition-colors"
            >
              <Mail size={16} /> Email
            </a>
          )}
          <button
            type="button"
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-gradient text-white font-bold shadow-brand"
          >
            <MessageSquare size={16} /> {t('providerProfile.contact')}
          </button>
        </div>
      </Card>

      {/* Services */}
      <h2 className="text-xl font-extrabold text-ink mb-3">
        {t('providerProfile.services')} ({services.length})
      </h2>
      {services.length === 0 ? (
        <Card variant="default" padding="lg" className="text-center text-muted">
          {t('providerProfile.noServices')}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s) => (
            <Link
              key={s.id}
              to={`/book/${s.id}`}
              className="block bg-white rounded-2xl border border-border overflow-hidden hover:border-brand-300 transition-colors"
            >
              <div
                className="w-full h-36 bg-cover bg-center bg-surface-alt"
                style={{
                  backgroundImage: s.images?.[0]
                    ? `url(${s.images[0]})`
                    : 'linear-gradient(135deg, #EFF4FF, #ECFEFF)',
                }}
              />
              <div className="p-4">
                <span className="text-xs uppercase font-bold tracking-wide text-brand-600">
                  {s.category}
                </span>
                <h3 className="mt-1 font-extrabold text-ink line-clamp-2 leading-tight">
                  {s.title}
                </h3>
                <div className="mt-3 flex items-center justify-between">
                  {(s.rating ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Star size={12} className="text-warning fill-warning" />
                      {Number(s.rating ?? 0).toFixed(1)}
                    </span>
                  )}
                  <span className="font-extrabold text-ink">
                    {Number(s.price).toFixed(0)} ₼
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export default ProviderProfile;
