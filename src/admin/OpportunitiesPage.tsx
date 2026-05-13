import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import OpportunityDetailModal from './OpportunityDetailModal';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  MapPin,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
} from '../components/ui';
import ActiveJobsBanner from '../components/ActiveJobsBanner';
import OpportunityBidModal from './OpportunityBidModal';

interface Opportunity {
  id: string;
  title: string;
  description: string;
  location: string | null;
  date: string;
  status?: string | null;
  category_id: string;
  subcategory_id: string;
  extra_answers: string;
  budget?: number | null;
  created_at: string;
}

interface NamedRow {
  id: string;
  label: string;
}

export default function OpportunitiesPage() {
  const { t } = useTranslation();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [categories, setCategories] = useState<NamedRow[]>([]);
  const [subcategories, setSubcategories] = useState<NamedRow[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [detailOf, setDetailOf] = useState<Opportunity | null>(null);

  // ── Fetch user specialties ────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('specialties')
        .eq('id', user.id)
        .single();
      if (data?.specialties) setSpecialties(data.specialties as string[]);
    })();
  }, []);

  // ── Fetch categories + subcategories ──────────────────────────
  useEffect(() => {
    (async () => {
      const [{ data: cats }, { data: subs }] = await Promise.all([
        supabase.from('service_categories').select('id,label'),
        supabase.from('service_subcategories').select('id,label'),
      ]);
      setCategories((cats as NamedRow[]) ?? []);
      setSubcategories((subs as NamedRow[]) ?? []);
    })();
  }, []);

  // ── Fetch opportunities + realtime ────────────────────────────
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const fetchAndSubscribe = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Opportunities fetch error:', error);
      } else {
        setOpportunities((data as Opportunity[]) ?? []);
      }
      setLoading(false);

      channel = supabase
        .channel('public:opportunities_channel')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'opportunities' },
          fetchAndSubscribe,
        )
        .subscribe();
    };
    fetchAndSubscribe();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const getCategoryLabel = (id: string) => categories.find((c) => c.id === id)?.label || '—';
  const getSubcategoryLabel = (id: string) =>
    subcategories.find((c) => c.id === id)?.label || '';

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((op) => {
      if (specialties.length > 0) {
        const catLabel = getCategoryLabel(op.category_id);
        if (!specialties.includes(catLabel)) return false;
      }
      if (!q) return true;
      const haystack = [
        op.title,
        op.description,
        op.location ?? '',
        getCategoryLabel(op.category_id),
        getSubcategoryLabel(op.subcategory_id),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities, specialties, search, categories, subcategories]);

  return (
    <div>
      <SectionHeader
        title={t('opportunities.title')}
        subtitle={t('opportunities.subtitleCount', { count: filtered.length })}
      />

      <ActiveJobsBanner />

      <InfoBanner />

      {/* Search */}
      <div className="relative mb-5 max-w-md">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <Input
          hasIcon
          placeholder={t('opportunities.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : filtered.length === 0 ? (
        // Empty: yalnız "no requests" göstər (specialty filtri tətbiq olunsa belə
        // bütün sorğular ekranda görünməlidir əgər seçilmiş ixtisas yoxdursa)
        <EmptyState
          title={t('opportunities.emptyTitle')}
          description={
            specialties.length === 0
              ? t('opportunities.emptyBody')
              : t('opportunities.noSpecialtyBody')
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((op) => (
            <OpportunityCard
              key={op.id}
              op={op}
              categoryLabel={getCategoryLabel(op.category_id)}
              subcategoryLabel={getSubcategoryLabel(op.subcategory_id)}
              onBid={() => setSelected(op)}
              onDetail={() => setDetailOf(op)}
            />
          ))}
        </div>
      )}

      {selected && (
        <OpportunityBidModal opportunity={selected} onClose={() => setSelected(null)} />
      )}
      {detailOf && (
        <OpportunityDetailModal
          opportunity={detailOf}
          categoryLabel={getCategoryLabel(detailOf.category_id)}
          subcategoryLabel={getSubcategoryLabel(detailOf.subcategory_id)}
          onClose={() => setDetailOf(null)}
          onBid={() => setSelected(detailOf)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
function InfoBanner() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="mb-5 p-4 sm:p-5 rounded-3xl bg-brand-50 border border-brand-100 flex items-start gap-3">
      <div className="w-10 h-10 rounded-2xl bg-brand-600 text-white flex items-center justify-center shrink-0">
        <Info size={18} />
      </div>
      <div className="flex-1 text-sm text-ink-soft">
        <p className="font-bold text-ink mb-1">{t('opportunities.infoTitle')}</p>
        <p>{t('opportunities.infoBody')}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted hover:text-ink transition-colors"
        aria-label={t('common.close')}
      >
        <X size={18} />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
function OpportunityCard({
  op,
  categoryLabel,
  subcategoryLabel,
  onBid,
  onDetail,
}: {
  op: Opportunity;
  categoryLabel: string;
  subcategoryLabel: string;
  onBid: () => void;
  onDetail: () => void;
}) {
  const { t } = useTranslation();
  const completed = op.status === 'completed';

  const extras = useMemo(() => {
    try {
      const parsed = JSON.parse(op.extra_answers || '{}');
      return Object.entries(parsed)
        .filter(([k, v]) => v && String(v).trim() && k !== 'title' && k !== 'description')
        .slice(0, 4) as [string, string][];
    } catch {
      return [];
    }
  }, [op.extra_answers]);

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold uppercase tracking-wide">
              {categoryLabel}
            </span>
            {subcategoryLabel && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-bg text-ink-soft text-[11px] font-bold">
                {subcategoryLabel}
              </span>
            )}
          </div>
          {op.budget != null && (
            <div className="mt-2 flex items-center gap-1.5 text-success font-extrabold">
              <Tag size={14} />
              <span>{t('opportunities.budget')}: {op.budget} ₼</span>
            </div>
          )}
        </div>

        {completed ? (
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-bg text-muted text-xs font-bold">
            <CheckCircle2 size={14} /> {t('opportunities.completed')}
          </span>
        ) : (
          <Button size="sm" variant="primary" onClick={onBid}>
            {t('opportunities.bid')}
          </Button>
        )}
      </div>

      {/* Description */}
      {op.description && (
        <p className="text-sm text-ink-soft leading-relaxed line-clamp-3">{op.description}</p>
      )}

      {/* Extras */}
      {extras.length > 0 && (
        <div className="bg-surface-bg rounded-2xl p-3 space-y-1">
          {extras.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 text-xs">
              <span className="font-bold text-muted capitalize shrink-0">
                {k.replace(/_/g, ' ')}:
              </span>
              <span className="text-ink-soft flex-1 line-clamp-1">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Calendar size={12} />
          {new Date(op.date).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
        {op.location && (
          <span className="inline-flex items-center gap-1 truncate">
            <MapPin size={12} />
            {op.location}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Briefcase size={12} />
          {timeAgo(op.created_at, t)}
        </span>
      </div>

      {/* Detail button */}
      <button
        type="button"
        onClick={onDetail}
        className="w-full mt-1 inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm font-bold transition-colors"
      >
        <Eye size={14} />
        {t('opportunityDetail.viewDetails')}
      </button>
    </Card>
  );
}

function timeAgo(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('time.now');
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
  return t('time.daysAgo', { count: Math.floor(diff / 86400) });
}
