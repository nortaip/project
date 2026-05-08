import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Filter,
  Grid3x3,
  Loader2,
  MapPin,
  Search,
  Star,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageContainer,
  SectionHeader,
} from '../components/ui';
import { SEO, breadcrumbJsonLd } from '../components/SEO';

interface Category {
  id: string;
  label: string;
}

interface Service {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  location: string | null;
  rating: number | null;
  reviews_count: number | null;
  images: string[] | null;
  provider_id: string;
}

export function Services() {
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    params.get('category'),
  );
  const [minPrice, setMinPrice] = useState(params.get('min') ?? '');
  const [maxPrice, setMaxPrice] = useState(params.get('max') ?? '');
  const [minRating, setMinRating] = useState(params.get('rating') ?? '');

  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // URL params sinxronizasiya
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (selectedCategory) next.set('category', selectedCategory);
    if (minPrice) next.set('min', minPrice);
    if (maxPrice) next.set('max', maxPrice);
    if (minRating) next.set('rating', minRating);
    setParams(next, { replace: true });
  }, [search, selectedCategory, minPrice, maxPrice, minRating, setParams]);

  // İlk yükləmə — kateqoriyalar və xidmətlər
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from('service_categories').select('id, label').order('label'),
      supabase.from('services').select('*').limit(200),
    ]).then(([catResp, svcResp]) => {
      if (cancelled) return;
      setCategories((catResp.data ?? []) as Category[]);
      setServices((svcResp.data ?? []) as Service[]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (selectedCategory && s.category !== selectedCategory) return false;
      if (
        search &&
        !s.title.toLowerCase().includes(search.toLowerCase()) &&
        !(s.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (minPrice && Number(s.price) < Number(minPrice)) return false;
      if (maxPrice && Number(s.price) > Number(maxPrice)) return false;
      if (minRating && (s.rating ?? 0) < Number(minRating)) return false;
      return true;
    });
  }, [services, search, selectedCategory, minPrice, maxPrice, minRating]);

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory(null);
    setMinPrice('');
    setMaxPrice('');
    setMinRating('');
  };

  const activeFilters =
    Number(Boolean(selectedCategory)) +
    Number(Boolean(minPrice || maxPrice)) +
    Number(Boolean(minRating));

  return (
    <PageContainer size="xl">
      <SEO
        title="Bütün xidmətlər"
        description="Azərbaycanda etibarlı provayderlərdən təmizlik, təmir, gözəllik və yüzlərlə xidməti axtar və onlayn sifariş et."
        canonical="https://ellit.az/services"
        jsonLd={breadcrumbJsonLd([
          { name: 'Ana səhifə', url: 'https://ellit.az/' },
          { name: 'Xidmətlər', url: 'https://ellit.az/services' },
        ])}
      />
      <SectionHeader
        title="Xidmətlər"
        subtitle="Etibarlı provayderlərdən onlayn sifariş et"
      />

      {/* Search bar */}
      <div className="relative mb-4">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <Input
          hasIcon
          hasRightAdornment={Boolean(search)}
          placeholder="Xidmət, kateqoriya və ya açar söz..."
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

      {/* Category chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        <CategoryChip
          label="Hamısı"
          active={!selectedCategory}
          onClick={() => setSelectedCategory(null)}
        />
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            label={c.label}
            active={selectedCategory === c.label}
            onClick={() => setSelectedCategory(c.label)}
          />
        ))}
      </div>

      {/* Filter toggle */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Filter size={16} />}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Filtrlər
          {activeFilters > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-md bg-brand-600 text-white text-[10px] font-extrabold">
              {activeFilters}
            </span>
          )}
        </Button>

        <span className="text-sm text-muted">
          {loading
            ? 'Yüklənir...'
            : `${filtered.length} nəticə`}
        </span>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <Card variant="default" padding="md" className="mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Min. qiymət (₼)">
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
            </Field>
            <Field label="Max. qiymət (₼)">
              <Input
                type="number"
                min={0}
                placeholder="100"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </Field>
            <Field label="Min. reytinq">
              <select
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
              >
                <option value="">Hər reytinq</option>
                <option value="3">3+ ★</option>
                <option value="4">4+ ★</option>
                <option value="4.5">4.5+ ★</option>
              </select>
            </Field>
          </div>
          {activeFilters > 0 && (
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X size={14} />}
                onClick={clearFilters}
              >
                Filtrləri sıfırla
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={36} className="animate-spin text-brand-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Grid3x3 size={32} />}
            title="Nəticə tapılmadı"
            description="Filtrləri dəyişin və ya başqa açar söz yoxlayın"
            action={
              activeFilters > 0 ? (
                <Button variant="primary" size="md" onClick={clearFilters}>
                  Filtrləri sıfırla
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
        active
          ? 'bg-brand-600 text-white'
          : 'bg-white border border-border text-ink-soft hover:border-brand-300'
      }`}
    >
      {label}
    </button>
  );
}

function ServiceCard({ service }: { service: Service }) {
  return (
    <Link
      to={`/book/${service.id}`}
      className="block bg-white rounded-2xl border border-border overflow-hidden hover:border-brand-300 transition-colors group"
    >
      <div
        className="w-full h-44 bg-cover bg-center bg-surface-alt"
        style={{
          backgroundImage: service.images?.[0]
            ? `url(${service.images[0]})`
            : 'linear-gradient(135deg, #EFF4FF, #ECFEFF)',
        }}
      />
      <div className="p-4">
        <span className="text-xs uppercase font-bold tracking-wide text-brand-600">
          {service.category}
        </span>
        <h3 className="mt-1 font-extrabold text-ink line-clamp-2 leading-tight group-hover:text-brand-700 transition-colors">
          {service.title}
        </h3>
        {service.description && (
          <p className="mt-1 text-sm text-muted line-clamp-2">
            {service.description}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-muted">
            {(service.rating ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star size={12} className="text-warning fill-warning" />
                {(service.rating ?? 0).toFixed(1)}
                {service.reviews_count ? ` (${service.reviews_count})` : ''}
              </span>
            )}
            {service.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} />
                <span className="truncate max-w-[110px]">{service.location}</span>
              </span>
            )}
          </div>
          <span className="font-extrabold text-ink">
            {Number(service.price).toFixed(0)} ₼
          </span>
        </div>
      </div>
    </Link>
  );
}

export default Services;
