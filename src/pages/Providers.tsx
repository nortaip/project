import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Briefcase, Loader2, MapPin, Search, ShieldCheck, Star, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card,
  EmptyState,
  Input,
  PageContainer,
  SectionHeader,
} from '../components/ui';
import { SEO, breadcrumbJsonLd } from '../components/SEO';

interface Provider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  role: string | null;
  rating: number | null;
  is_verified: boolean | null;
  specialties: string[] | null;
  experience_years: number | null;
  address: string | null;
  status: string | null;
}

export function Providers() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('profiles')
      .select(
        'id, name, avatar_url, role, rating, is_verified, specialties, experience_years, address, status',
      )
      .eq('role', 'provider')
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(200)
      .then(({ data }) => {
        setProviders((data ?? []) as Provider[]);
        setLoading(false);
      });
  }, []);

  const allSpecialties = useMemo(() => {
    const set = new Set<string>();
    providers.forEach((p) => {
      (p.specialties ?? []).forEach((s) => set.add(s));
    });
    return Array.from(set).sort();
  }, [providers]);

  const filtered = useMemo(() => {
    return providers.filter((p) => {
      if (search && !(p.name ?? '').toLowerCase().includes(search.toLowerCase()))
        return false;
      if (filter && !(p.specialties ?? []).includes(filter)) return false;
      return true;
    });
  }, [providers, search, filter]);

  return (
    <PageContainer size="xl">
      <SEO
        title={t('providers.title')}
        description={t('providers.subtitle', { count: providers.length })}
        canonical="https://ellit.az/providers"
        jsonLd={breadcrumbJsonLd([
          { name: 'Ana səhifə', url: 'https://ellit.az/' },
          { name: 'Provayderlər', url: 'https://ellit.az/providers' },
        ])}
      />
      <SectionHeader
        title={t('providers.title')}
        subtitle={t('providers.subtitle', { count: providers.length })}
      />

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <Input
          hasIcon
          placeholder={t('providers.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Specialty filter chips */}
      {allSpecialties.length > 0 && (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
              !filter
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-border text-ink-soft hover:border-brand-300'
            }`}
          >
            {t('providers.filterAll')}
          </button>
          {allSpecialties.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
                filter === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-border text-ink-soft hover:border-brand-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={36} className="animate-spin text-brand-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Briefcase size={32} />}
            title={t('providers.emptyTitle')}
            description={t('providers.emptyBody')}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const initials = (provider.name ?? '?')[0]?.toUpperCase() ?? '?';

  return (
    <Link
      to={`/provider/${provider.id}`}
      className="bg-white rounded-2xl border border-border p-4 hover:border-brand-300 transition-colors block"
    >
      <div className="flex items-center gap-3">
        {provider.avatar_url ? (
          <img
            src={provider.avatar_url}
            alt={provider.name ?? ''}
            className="w-14 h-14 rounded-2xl object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-extrabold text-ink truncate">
              {provider.name ?? '—'}
            </h3>
            {provider.is_verified && (
              <ShieldCheck size={16} className="text-success shrink-0" />
            )}
          </div>
          {(provider.rating ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
              <Star size={12} className="text-warning fill-warning" />
              {(provider.rating ?? 0).toFixed(1)}
              {provider.experience_years ? (
                <span className="ml-2">
                  · {provider.experience_years} il təcrübə
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {(provider.specialties ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {(provider.specialties ?? []).slice(0, 3).map((s) => (
            <span
              key={s}
              className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
            >
              {s}
            </span>
          ))}
          {(provider.specialties ?? []).length > 3 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-surface-alt text-muted font-semibold">
              +{(provider.specialties ?? []).length - 3}
            </span>
          )}
        </div>
      )}

      {provider.address && (
        <div className="mt-3 flex items-center gap-1 text-xs text-muted">
          <MapPin size={12} className="shrink-0" />
          <span className="truncate">{provider.address}</span>
        </div>
      )}
    </Link>
  );
}

export default Providers;
