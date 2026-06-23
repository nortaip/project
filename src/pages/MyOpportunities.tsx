import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Sparkles,
  Star,
  User,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Button, Card, EmptyState, PageContainer } from '../components/ui';
import AcceptOfferModal from '../admin/AcceptOfferModal';

interface Offer {
  id: string;
  status: string;
  offer_amount: number | null;
  payment_method: string | null;
  created_at: string;
  provider_id: string;
  brigade_id: string | null;
  brigade?: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
  provider: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    phone_number: string | null;
    rating: number | null;
  } | null;
}

interface Opportunity {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  date: string | null;
  status: string | null;
  budget: number | null;
  created_at: string;
  category_id: string | null;
  offers: Offer[];
}

type StatusFilter = 'all' | 'pending' | 'active' | 'completed' | 'cancelled';

const FILTERS: { key: StatusFilter; labelKey: string; defaultLabel: string }[] = [
  { key: 'all', labelKey: 'myOpp.filterAll', defaultLabel: 'Hamısı' },
  { key: 'pending', labelKey: 'myOpp.filterPending', defaultLabel: 'Gözləyən' },
  { key: 'active', labelKey: 'myOpp.filterActive', defaultLabel: 'Aktiv' },
  { key: 'completed', labelKey: 'myOpp.filterCompleted', defaultLabel: 'Tamamlanmış' },
  { key: 'cancelled', labelKey: 'myOpp.filterCancelled', defaultLabel: 'Ləğv olunmuş' },
];

export default function MyOpportunities() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // Session-i birbaşa Supabase-dən oxu — store hydration race-i həll edir
      const { data: authData } = await supabase.auth.getSession();
      const uid = authData.session?.user?.id ?? user?.id;
      if (cancelled) return;
      if (!uid) {
        navigate('/login', { replace: true });
        return;
      }
      void load();

      channel = supabase
        .channel(`my-opps-${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'opportunities_offers',
          },
          () => {
            void load();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'opportunities',
            filter: `created_by=eq.${uid}`,
          },
          () => {
            void load();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Session-dan uid — store hydration race-i həll edir
      const { data: authData } = await supabase.auth.getSession();
      const uid = authData.session?.user?.id ?? user?.id;
      if (!uid) {
        setError('Not authenticated');
        return;
      }

      const { data: oppRows, error: oErr } = await supabase
        .from('opportunities')
        .select('*')
        .eq('created_by', uid)
        .order('created_at', { ascending: false });
      if (oErr) throw oErr;

      const opps = (oppRows ?? []) as Opportunity[];
      const ids = opps.map((o) => o.id);

      // Defensive 2-step query: əvvəlcə offer-lər, sonra ayrıca provider profilləri
      let offersByOpp: Record<string, Offer[]> = {};
      if (ids.length > 0) {
        const { data: offerRows, error: offErr } = await supabase
          .from('opportunities_offers')
          .select('*')
          .in('opportunity_id', ids)
          .order('created_at', { ascending: true });
        if (offErr) {
          console.error('Offer fetch error:', offErr);
        }

        const rawOffers = (offerRows ?? []) as Array<
          {
            id: string;
            opportunity_id: string;
            provider_id: string;
            brigade_id?: string | null;
            status: string;
            offer_amount: number | null;
            payment_method?: string | null;
            created_at: string;
          }
        >;

        // Provider profillərini ayrı sorğu ilə yüklə
        const providerIds = Array.from(
          new Set(rawOffers.map((r) => r.provider_id).filter(Boolean)),
        );
        let profilesById: Record<string, Offer['provider']> = {};
        if (providerIds.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, name, avatar_url, phone_number, rating')
            .in('id', providerIds);
          for (const p of (profs ?? []) as NonNullable<Offer['provider']>[]) {
            profilesById[p.id] = p;
          }
        }

        // Brigades məlumatları
        const brigadeIds = Array.from(
          new Set(
            rawOffers
              .map((r) => r.brigade_id)
              .filter((b): b is string => !!b),
          ),
        );
        let brigadesById: Record<string, NonNullable<Offer['brigade']>> = {};
        if (brigadeIds.length > 0) {
          const { data: brigs } = await supabase
            .from('brigades')
            .select('id, name, logo_url')
            .in('id', brigadeIds);
          for (const b of (brigs ?? []) as NonNullable<Offer['brigade']>[]) {
            brigadesById[b.id] = b;
          }
        }

        for (const row of rawOffers) {
          const enriched: Offer = {
            id: row.id,
            status: row.status,
            offer_amount: row.offer_amount,
            payment_method: row.payment_method ?? null,
            created_at: row.created_at,
            provider_id: row.provider_id,
            brigade_id: row.brigade_id ?? null,
            brigade: row.brigade_id ? brigadesById[row.brigade_id] ?? null : null,
            provider: profilesById[row.provider_id] ?? null,
          };
          if (!offersByOpp[row.opportunity_id]) {
            offersByOpp[row.opportunity_id] = [];
          }
          offersByOpp[row.opportunity_id].push(enriched);
        }
      }

      setOpportunities(
        opps.map((o) => ({ ...o, offers: offersByOpp[o.id] ?? [] })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return opportunities;
    if (filter === 'pending') {
      return opportunities.filter(
        (o) => !o.status || o.status === 'pending' || o.status === 'open',
      );
    }
    if (filter === 'active') {
      return opportunities.filter(
        (o) =>
          o.status === 'active' || o.status === 'accepted' || o.status === 'ongoing',
      );
    }
    return opportunities.filter((o) => o.status === filter);
  }, [opportunities, filter]);

  const counts = useMemo(() => {
    const c = {
      total: opportunities.length,
      pending: 0,
      active: 0,
      completed: 0,
    };
    for (const o of opportunities) {
      if (!o.status || o.status === 'pending' || o.status === 'open') c.pending++;
      else if (o.status === 'active' || o.status === 'accepted' || o.status === 'ongoing')
        c.active++;
      else if (o.status === 'completed') c.completed++;
    }
    return c;
  }, [opportunities]);

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <PageContainer size="lg">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-ink mb-4"
      >
        <ChevronLeft size={16} /> {t('common.back', { defaultValue: 'Geri' })}
      </button>

      <div className="flex items-center gap-2 mb-2">
        <FileText size={24} className="text-brand-600" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
          {t('myOpp.title', { defaultValue: 'Sifarişlərim' })}
        </h1>
      </div>
      <p className="text-muted text-sm mb-5">
        {t('myOpp.subtitle', {
          defaultValue: 'Bütün sorğularınız və daxil olan təkliflər',
        })}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <MiniStat
          label={t('myOpp.statTotal', { defaultValue: 'Cəmi' })}
          value={counts.total}
          tint="brand"
        />
        <MiniStat
          label={t('myOpp.statPending', { defaultValue: 'Gözləyən' })}
          value={counts.pending}
          tint="amber"
        />
        <MiniStat
          label={t('myOpp.statActive', { defaultValue: 'Aktiv' })}
          value={counts.active}
          tint="emerald"
        />
        <MiniStat
          label={t('myOpp.statCompleted', { defaultValue: 'Tamamlanmış' })}
          value={counts.completed}
          tint="violet"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-colors ${
              filter === f.key
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-ink-soft border-border hover:border-brand-300'
            }`}
          >
            {t(f.labelKey, { defaultValue: f.defaultLabel })}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-muted">
          <Loader2 size={28} className="animate-spin inline-block" />
          <p className="mt-3 font-bold">
            {t('common.loading', { defaultValue: 'Yüklənir...' })}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} />}
          title={t('myOpp.emptyTitle', { defaultValue: 'Sorğu yoxdur' })}
          description={t('myOpp.emptyBody', {
            defaultValue: 'Bu filtrə uyğun sifariş tapılmadı.',
          })}
          action={
            <Link to="/services">
              <Button variant="primary" size="md">
                {t('myOpp.createNew', { defaultValue: 'Yeni sorğu yarat' })}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opp={opp}
              expanded={expanded.has(opp.id)}
              onToggle={() => toggle(opp.id)}
              onAfterAction={load}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

// ─── components ─────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'brand' | 'amber' | 'emerald' | 'violet';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className={`rounded-2xl p-4 ${tints[tint]}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-75">
        {label}
      </p>
      <p className="text-2xl font-extrabold mt-1">{value}</p>
    </div>
  );
}

function OpportunityCard({
  opp,
  expanded,
  onToggle,
  onAfterAction,
}: {
  opp: Opportunity;
  expanded: boolean;
  onToggle: () => void;
  onAfterAction: () => void;
}) {
  const { t } = useTranslation();
  const offers = opp.offers ?? [];
  const acceptedOffer = offers.find((o) => o.status === 'accepted' || o.status === 'completed');
  const pendingOffers = offers.filter((o) => o.status === 'pending');

  return (
    <Card variant="default" padding="md">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-extrabold text-ink text-lg truncate">
              {opp.title || t('myOpp.untitled', { defaultValue: 'Adsız sifariş' })}
            </h3>
            <StatusBadge status={opp.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} />
              {opp.date ? formatDate(opp.date) : formatDate(opp.created_at)}
            </span>
            {opp.location && (
              <span className="inline-flex items-center gap-1 truncate max-w-[180px]">
                <MapPin size={12} /> {opp.location}
              </span>
            )}
            {opp.budget != null && (
              <span className="inline-flex items-center gap-1 font-bold text-ink-soft">
                {Number(opp.budget).toFixed(0)} ₼
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 text-sm font-extrabold text-brand-700">
            <Sparkles size={14} />
            {offers.length}
          </div>
          <p className="text-xs text-muted">
            {t('myOpp.offers', { defaultValue: 'təklif' })}
          </p>
        </div>
        <ChevronDown
          size={20}
          className={`text-muted shrink-0 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {opp.description && expanded && (
        <p className="text-sm text-muted mt-3 leading-relaxed">
          {opp.description}
        </p>
      )}

      {/* Offers */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-border">
          {offers.length === 0 ? (
            <p className="text-sm text-muted text-center py-3">
              {t('myOpp.noOffers', {
                defaultValue: 'Hələ təklif gəlməyib. Provayderləri gözləyin.',
              })}
            </p>
          ) : (
            <div className="space-y-2">
              {/* Qəbul edilən təklif ön planda */}
              {acceptedOffer && (
                <OfferRow
                  offer={acceptedOffer}
                  opportunityId={opp.id}
                  primary
                  onAfterAction={onAfterAction}
                />
              )}
              {!acceptedOffer && pendingOffers.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">
                    {t('myOpp.pendingOffers', {
                      defaultValue: 'Gözləyən təkliflər',
                    })}
                  </p>
                  {pendingOffers.map((o) => (
                    <OfferRow
                      key={o.id}
                      offer={o}
                      opportunityId={opp.id}
                      onAfterAction={onAfterAction}
                    />
                  ))}
                </div>
              )}
              {/* Rədd edilmiş təkliflər */}
              {offers
                .filter(
                  (o) => o.status === 'rejected' || o.status === 'cancelled',
                )
                .map((o) => (
                  <OfferRow
                    key={o.id}
                    offer={o}
                    opportunityId={opp.id}
                    muted
                    onAfterAction={onAfterAction}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function OfferRow({
  offer,
  opportunityId: _opportunityId,
  primary = false,
  muted = false,
  onAfterAction,
}: {
  offer: Offer;
  opportunityId: string;
  primary?: boolean;
  muted?: boolean;
  onAfterAction: () => void;
}) {
  const { t } = useTranslation();
  const provider = offer.provider;
  const initial = (provider?.name?.[0] ?? '?').toUpperCase();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function reject() {
    if (rejecting) return;
    if (!window.confirm(t('myOpp.rejectConfirm', { defaultValue: 'Bu təklifi rədd etmək istəyirsən?' }))) return;
    setRejecting(true);
    setErrMsg(null);
    const { error } = await supabase
      .from('opportunities_offers')
      .update({ status: 'rejected' })
      .eq('id', offer.id);
    setRejecting(false);
    if (error) {
      setErrMsg(error.message);
      return;
    }
    onAfterAction();
  }

  async function markComplete() {
    if (completing) return;
    if (
      !window.confirm(
        t('myOpp.completeConfirm', {
          defaultValue:
            'İş tamamlandığını təsdiqləyirsən? Bundan sonra provayderə ödəniş açılacaq.',
        }),
      )
    )
      return;
    setCompleting(true);
    setErrMsg(null);
    const { error } = await supabase.rpc('release_offer_to_provider', {
      p_offer_id: offer.id,
    });
    setCompleting(false);
    if (error) {
      setErrMsg(error.message);
      return;
    }
    onAfterAction();
  }

  const showAcceptReject = offer.status === 'pending';
  const showMarkComplete = offer.status === 'accepted';

  return (
    <>
      <div
        className={`p-3 rounded-xl border ${
          primary
            ? 'bg-emerald-50 border-emerald-200'
            : muted
              ? 'bg-surface-alt border-transparent opacity-60'
              : 'bg-surface-alt border-transparent hover:border-brand-200 transition-colors'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center font-extrabold text-brand-700 shrink-0 overflow-hidden">
            {offer.brigade?.logo_url ? (
              <img
                src={offer.brigade.logo_url}
                alt={offer.brigade.name}
                className="w-full h-full object-cover"
              />
            ) : provider?.avatar_url ? (
              <img
                src={provider.avatar_url}
                alt={provider?.name ?? '?'}
                className="w-full h-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink text-sm truncate">
              {offer.brigade?.name ??
                provider?.name ??
                t('myOpp.unknownProvider', { defaultValue: 'Provayder' })}
            </p>
            <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap">
              {offer.brigade_id ? (
                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-700">
                  BRİQADA
                </span>
              ) : (
                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-surface-alt text-ink-soft">
                  TƏK PROVAYDER
                </span>
              )}
              <StatusBadge status={offer.status} small />
              {!offer.brigade_id && provider?.rating != null && provider.rating > 0 && (
                <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold">
                  <Star size={11} fill="currentColor" /> {Number(provider.rating ?? 0).toFixed(1)}
                </span>
              )}
              {offer.payment_method && (
                <span className="text-muted">
                  {offer.payment_method === 'cash'
                    ? t('myOpp.cash', { defaultValue: 'nağd' })
                    : t('myOpp.card', { defaultValue: 'kart' })}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-extrabold text-ink">
              {Number(offer.offer_amount ?? 0).toFixed(0)} ₼
            </p>
            {provider?.phone_number && (
              <a
                href={`tel:${provider.phone_number}`}
                className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-0.5 mt-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={11} /> {t('myOpp.call', { defaultValue: 'Zəng' })}
              </a>
            )}
          </div>
        </div>

        {/* Accept / Reject düymələri — pending təklif */}
        {showAcceptReject && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAcceptOpen(true)}
              leftIcon={<CheckCircle2 size={14} />}
            >
              {t('myOpp.accept', { defaultValue: 'Qəbul et' })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={reject}
              disabled={rejecting}
              leftIcon={
                rejecting ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />
              }
            >
              {t('myOpp.reject', { defaultValue: 'İmtina' })}
            </Button>
          </div>
        )}

        {/* "Sifariş tamamlandı" düyməsi — accepted təklif */}
        {showMarkComplete && (
          <div className="mt-3 pt-3 border-t border-emerald-200">
            <div className="rounded-lg bg-emerald-100 px-3 py-2 mb-2 text-xs text-emerald-800 font-bold">
              {t('myOpp.activeInfo', {
                defaultValue:
                  'Provayder işə başlayıb. İş bitdikdə aşağıdakı düyməni basın.',
              })}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={markComplete}
              disabled={completing}
              leftIcon={
                completing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )
              }
            >
              {t('myOpp.markComplete', { defaultValue: 'Sifariş tamamlandı' })}
            </Button>
          </div>
        )}

        {errMsg && (
          <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-1.5 text-xs flex items-start gap-1.5">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{errMsg}</span>
          </div>
        )}
      </div>

      {acceptOpen && (
        <AcceptOfferModal
          offerId={offer.id}
          amount={Number(offer.offer_amount ?? 0)}
          providerName={provider?.name ?? undefined}
          onClose={() => setAcceptOpen(false)}
          onSuccess={() => {
            setAcceptOpen(false);
            onAfterAction();
          }}
        />
      )}
    </>
  );
}

function StatusBadge({
  status,
  small = false,
}: {
  status: string | null | undefined;
  small?: boolean;
}) {
  const s = (status ?? 'pending').toLowerCase();
  const map: Record<string, { cls: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
    pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Gözləyir', Icon: Clock },
    open: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Açıq', Icon: Clock },
    new: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Yeni', Icon: Clock },
    active: { cls: 'bg-brand-50 text-brand-700 border-brand-200', label: 'Aktiv', Icon: User },
    ongoing: { cls: 'bg-brand-50 text-brand-700 border-brand-200', label: 'Davam edir', Icon: User },
    accepted: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Qəbul edilib', Icon: CheckCircle2 },
    completed: { cls: 'bg-violet-50 text-violet-700 border-violet-200', label: 'Tamamlanıb', Icon: CheckCircle2 },
    rejected: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rədd', Icon: XCircle },
    cancelled: { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Ləğv', Icon: XCircle },
  };
  const m = map[s] ?? { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: s, Icon: Clock };
  const Icon = m.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-bold ${m.cls} ${
        small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <Icon size={small ? 10 : 12} /> {m.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('az', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return '—';
  }
}
