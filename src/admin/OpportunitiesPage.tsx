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
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
import {
  parseCoords,
  parseExtras,
  useQuestionLabels,
  type QLabels,
} from './opportunityUtils';

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

const DEFAULT_CENTER: [number, number] = [40.4093, 49.8671]; // Bakı

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
  const [activeId, setActiveId] = useState<string | null>(null);

  const questionLabels = useQuestionLabels();

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

  // Xəritə üçün koordinatı olan sorğular
  const mapPoints = useMemo(
    () =>
      filtered
        .map((op) => ({ op, coords: parseCoords(op.location) }))
        .filter((p): p is { op: Opportunity; coords: [number, number] } => !!p.coords),
    [filtered],
  );

  const activeCoords =
    mapPoints.find((p) => p.op.id === activeId)?.coords ?? null;

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

      {/* List + Map */}
      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('opportunities.emptyTitle')}
          description={
            specialties.length === 0
              ? t('opportunities.emptyBody')
              : t('opportunities.noSpecialtyBody')
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4">
          {/* Cards */}
          <div className="space-y-4 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
            {filtered.map((op) => (
              <OpportunityCard
                key={op.id}
                op={op}
                active={op.id === activeId}
                hasLocation={!!parseCoords(op.location)}
                categoryLabel={getCategoryLabel(op.category_id)}
                subcategoryLabel={getSubcategoryLabel(op.subcategory_id)}
                questionLabels={questionLabels}
                onActivate={() => setActiveId(op.id)}
                onBid={() => setSelected(op)}
                onDetail={() => setDetailOf(op)}
              />
            ))}
          </div>

          {/* Map panel (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-4 h-[calc(100vh-7rem)] rounded-3xl overflow-hidden border border-border shadow-card">
              <MapContainer
                center={mapPoints[0]?.coords ?? DEFAULT_CENTER}
                zoom={11}
                scrollWheelZoom
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap'
                />
                {mapPoints.map(({ op, coords }) => (
                  <Marker
                    key={op.id}
                    position={coords}
                    icon={pinIcon(op.id === activeId)}
                    eventHandlers={{ click: () => setActiveId(op.id) }}
                  >
                    <Popup>
                      <div className="text-sm font-bold">{op.title || '—'}</div>
                      {op.budget != null && (
                        <div className="text-xs">{op.budget} ₼</div>
                      )}
                    </Popup>
                  </Marker>
                ))}
                <FlyTo center={activeCoords} />
              </MapContainer>
            </div>
            {mapPoints.length === 0 && (
              <p className="text-center text-xs text-muted mt-2">
                {t('opportunities.noMapPoints', {
                  defaultValue: 'Bu sorğularda xəritə koordinatı yoxdur.',
                })}
              </p>
            )}
          </div>
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
          questionLabels={questionLabels}
          onClose={() => setDetailOf(null)}
          onBid={() => setSelected(detailOf)}
        />
      )}
    </div>
  );
}

// ─── Map helpers ─────────────────────────────────────────────────────
function pinIcon(active: boolean): L.DivIcon {
  const size = active ? 38 : 30;
  const color = active ? '#1D4ED8' : '#2563EB';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;transform:translate(-50%,-100%);
      display:flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}"
        stroke="white" stroke-width="1.5" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))">
        <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/>
        <circle cx="12" cy="9" r="2.6" fill="white" stroke="none"/>
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [0, 0],
  });
}

function FlyTo({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [center, map]);
  return null;
}

// ════════════════════════════════════════════════════════════════════
function OpportunityCard({
  op,
  active,
  hasLocation,
  categoryLabel,
  subcategoryLabel,
  questionLabels,
  onActivate,
  onBid,
  onDetail,
}: {
  op: Opportunity;
  active: boolean;
  hasLocation: boolean;
  categoryLabel: string;
  subcategoryLabel: string;
  questionLabels: QLabels;
  onActivate: () => void;
  onBid: () => void;
  onDetail: () => void;
}) {
  const { t } = useTranslation();
  const completed = op.status === 'completed';
  const avail = availability(op.status);

  const extras = useMemo(
    () => parseExtras(op.extra_answers, questionLabels, 4),
    [op.extra_answers, questionLabels],
  );

  return (
    <Card
      variant="default"
      padding="md"
      onClick={onActivate}
      className={`flex flex-col gap-3 cursor-pointer transition-all ${
        active
          ? 'ring-2 ring-brand-500 border-brand-300 shadow-card-lg'
          : 'hover:border-brand-200 hover:shadow-card-lg'
      }`}
    >
      {/* Availability + category */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 mb-2">
            <span className={`w-2 h-2 rounded-full ${avail.dot}`} />
            <span className={`text-[11px] font-extrabold uppercase tracking-wide ${avail.text}`}>
              {t(avail.key, { defaultValue: avail.fallback })}
            </span>
          </div>
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
        </div>

        {op.budget != null && (
          <div className="text-right shrink-0">
            <div className="text-lg font-extrabold text-success leading-none">
              {op.budget} ₼
            </div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wide mt-0.5">
              {t('opportunities.budget')}
            </div>
          </div>
        )}
      </div>

      {/* Title */}
      {op.title && (
        <h3 className="font-extrabold text-ink text-base leading-tight line-clamp-1">
          {op.title}
        </h3>
      )}

      {/* Location */}
      <div className="flex items-center gap-1.5 text-sm text-ink-soft">
        <MapPin size={14} className="text-brand-500 shrink-0" />
        <span className="truncate">
          {hasLocation
            ? t('opportunities.onMap', { defaultValue: 'Xəritədə qeyd olunub' })
            : op.location || t('opportunityDetail.noLocation')}
        </span>
      </div>

      {/* Description */}
      {op.description && (
        <p className="text-sm text-muted leading-relaxed line-clamp-2">{op.description}</p>
      )}

      {/* Extras (label həll olunub — UUID yox) */}
      {extras.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {extras.map((e) => (
            <span
              key={e.key}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-bg text-xs text-ink-soft max-w-full"
            >
              {e.label && <span className="font-bold text-muted">{e.label}:</span>}
              <span className="truncate">{e.value}</span>
            </span>
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
        <span className="inline-flex items-center gap-1">
          <Briefcase size={12} />
          {timeAgo(op.created_at, t)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDetail();
          }}
          className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm font-bold transition-colors"
        >
          <Eye size={15} />
          {t('opportunityDetail.viewDetails')}
        </button>
        {completed ? (
          <span className="inline-flex items-center gap-1 px-3 h-11 rounded-xl bg-surface-bg text-muted text-xs font-bold">
            <CheckCircle2 size={14} /> {t('opportunities.completed')}
          </span>
        ) : (
          <Button
            size="md"
            variant="primary"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onBid();
            }}
            leftIcon={<Tag size={15} />}
          >
            {t('opportunities.bid')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function availability(status?: string | null): {
  dot: string;
  text: string;
  key: string;
  fallback: string;
} {
  const s = (status ?? 'pending').toLowerCase();
  if (s === 'completed')
    return { dot: 'bg-gray-400', text: 'text-gray-500', key: 'opportunities.statusCompleted', fallback: 'Tamamlanıb' };
  if (s === 'active' || s === 'accepted' || s === 'ongoing')
    return { dot: 'bg-brand-500', text: 'text-brand-600', key: 'opportunities.statusActive', fallback: 'Aktiv' };
  return { dot: 'bg-emerald-500', text: 'text-emerald-600', key: 'opportunities.statusOpen', fallback: 'Açıq sifariş' };
}

function timeAgo(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('time.now');
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
  return t('time.daysAgo', { count: Math.floor(diff / 86400) });
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
