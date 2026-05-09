import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Phone,
  Star,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, SectionHeader } from '../components/ui';
import ReviewModal from './ReviewModal';

type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'completed';

interface Offer {
  id: string;
  status: OfferStatus;
  created_at: string;
  offer_amount: number | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_phone: string | null;
}

interface OpportunityWithOffers {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  status?: string | null;
  offers: Offer[];
}

const STATUS_CLS: Record<OfferStatus, string> = {
  pending:   'bg-warning/10 text-warning',
  accepted:  'bg-brand-50 text-brand-700',
  rejected:  'bg-danger/5 text-danger',
  completed: 'bg-success/10 text-success',
};
const STATUS_KEY: Record<OfferStatus, string> = {
  pending:   'offers.status.pending',
  accepted:  'offers.status.accepted',
  rejected:  'offers.status.lost',
  completed: 'won.badge',
};

export default function ServicesPage() {
  const { t } = useTranslation();
  const [opportunities, setOpportunities] = useState<OpportunityWithOffers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [updatingOfferId, setUpdatingOfferId] = useState<string | null>(null);
  const [reviewOfferId, setReviewOfferId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Auth ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError(t('balance.errors.loginRequired'));
        setLoading(false);
        return;
      }
      setUserId(user.id);
    })();
  }, []);

  // ── Fetch opportunities + nested offers ───────────────────────
  const fetchAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchErr } = await supabase
      .from('opportunities')
      .select(
        `
          id, title, description, created_at, status,
          opportunities_offers!fk_opportunity (
            id, status, created_at, offer_amount, provider_id,
            provider_profile:profiles(name, phone_number)
          )
        `,
      )
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (fetchErr) {
      setError('Sorğular yüklənmədi: ' + fetchErr.message);
      setOpportunities([]);
      setLoading(false);
      return;
    }

    const formatted: OpportunityWithOffers[] = (data ?? []).map((op) => {
      const opAny = op as {
        id: string;
        title: string;
        description: string | null;
        created_at: string;
        status?: string;
        opportunities_offers: Array<{
          id: string;
          status: OfferStatus;
          created_at: string;
          offer_amount: number | null;
          provider_id: string | null;
          provider_profile?: { name?: string; phone_number?: string } | null;
        }>;
      };
      return {
        id: opAny.id,
        title: opAny.title,
        description: opAny.description,
        created_at: opAny.created_at,
        status: opAny.status ?? null,
        offers: (opAny.opportunities_offers ?? [])
          .map((o) => ({
            id: o.id,
            status: o.status,
            created_at: o.created_at,
            offer_amount: o.offer_amount,
            provider_id: o.provider_id,
            provider_name: o.provider_profile?.name ?? null,
            provider_phone: o.provider_profile?.phone_number ?? null,
          }))
          .sort((a, b) => {
            // accepted/completed birinci
            const order: Record<OfferStatus, number> = {
              accepted: 0,
              completed: 1,
              pending: 2,
              rejected: 3,
            };
            return order[a.status] - order[b.status];
          }),
      };
    });

    setOpportunities(formatted);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) fetchAll();
  }, [userId, fetchAll]);

  // ── Refund commission for rejected offers ─────────────────────
  const repayCommissionsForRejectedOffers = async (
    offers: { id: string; provider_id: string; offer_amount: number }[],
  ) => {
    for (const o of offers) {
      const refund = parseFloat((o.offer_amount * 0.1).toFixed(2));

      await supabase.from('provider_commissions_logs').insert({
        provider_id: o.provider_id,
        offer_id: o.id,
        amount: refund,
        type: 'refund',
        source: 'Təklif imtinası',
        status: 'refunded',
        refunded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      await supabase.rpc('admin_credit_bonus', {
        p_target_user_id: o.provider_id,
        p_amount: refund,
        p_reason: `Bid refund (offer ${o.id})`,
      });
      await supabase.rpc('admin_credit_balance', {
        p_target_user_id: o.provider_id,
        p_amount: refund,
        p_reason: `Bid refund — main balance (offer ${o.id})`,
      });
    }
  };

  // ── Update offer status (accept / reject / completed) ─────────
  const updateOfferStatus = async (
    offerId: string,
    newStatus: 'accepted' | 'rejected' | 'completed',
  ) => {
    setUpdatingOfferId(offerId);
    setError(null);

    try {
      const { data: offerToUpdate, error: fetchErr } = await supabase
        .from('opportunities_offers')
        .select('opportunity_id')
        .eq('id', offerId)
        .single();
      if (fetchErr || !offerToUpdate) {
        setError('Təklif tapılmadı.');
        return;
      }
      const opportunityId = offerToUpdate.opportunity_id;

      const { error: updateErr } = await supabase
        .from('opportunities_offers')
        .update({ status: newStatus })
        .eq('id', offerId);
      if (updateErr) {
        setError('Status yenilənmədi: ' + updateErr.message);
        return;
      }

      if (newStatus === 'accepted') {
        // Digər pending təklifləri rədd et
        const { data: others } = await supabase
          .from('opportunities_offers')
          .select('id, provider_id, offer_amount')
          .eq('opportunity_id', opportunityId)
          .eq('status', 'pending')
          .neq('id', offerId);

        if (others && others.length > 0) {
          await supabase
            .from('opportunities_offers')
            .update({ status: 'rejected' })
            .in('id', others.map((o) => o.id));
          await repayCommissionsForRejectedOffers(
            others as { id: string; provider_id: string; offer_amount: number }[],
          );
        }

        await supabase
          .from('opportunities')
          .update({ status: 'active', accepted_offer_id: offerId })
          .eq('id', opportunityId);
      } else if (newStatus === 'completed') {
        setReviewOfferId(offerId);
      }

      await fetchAll();
    } catch (err) {
      setError('Gözlənilməz xəta: ' + (err as Error).message);
    } finally {
      setUpdatingOfferId(null);
    }
  };

  // ── Submit review + complete ──────────────────────────────────
  const submitReview = async (rating: number, comment: string) => {
    if (!reviewOfferId) return;
    setUpdatingOfferId(reviewOfferId);

    const { data: offerData, error: offerErr } = await supabase
      .from('opportunities_offers')
      .select('provider_id, offer_amount, opportunity_id')
      .eq('id', reviewOfferId)
      .single();
    if (offerErr || !offerData?.provider_id) {
      setError('Təklif məlumatı tapılmadı.');
      setUpdatingOfferId(null);
      return;
    }

    // Insert review
    const { error: reviewErr } = await supabase.from('provider_reviews').insert({
      provider_id: offerData.provider_id,
      offer_id: reviewOfferId,
      rating,
      comment,
    });
    if (reviewErr) {
      setError('Reytinq əlavə olunmadı: ' + reviewErr.message);
      setUpdatingOfferId(null);
      return;
    }

    // Cashback bonus
    const offerAmount = offerData.offer_amount || 0;
    const commission = offerAmount * 0.1;
    const cashbackPct = rating === 5 ? 0.25 : rating === 4 ? 0.2 : 0;
    if (cashbackPct > 0) {
      const cashback = commission * cashbackPct;
      await supabase.from('provider_bonus_logs').insert({
        provider_id: offerData.provider_id,
        amount: cashback,
        type: 'cashback',
        source: 'review_cashback',
        created_at: new Date().toISOString(),
        reason: `Review cashback (${rating}★)`,
      });
      await supabase.rpc('admin_credit_bonus', {
        p_target_user_id: offerData.provider_id,
        p_amount: cashback,
        p_reason: `Review cashback (${rating}★)`,
      });
    }

    // Mark completed
    await supabase
      .from('opportunities_offers')
      .update({ status: 'completed' })
      .eq('id', reviewOfferId);
    await supabase
      .from('opportunities')
      .update({ status: 'completed' })
      .eq('id', offerData.opportunity_id);

    setReviewOfferId(null);
    setUpdatingOfferId(null);
    await fetchAll();
  };

  return (
    <div>
      <SectionHeader
        title={t('services.title')}
        subtitle={t('services.subtitleCount', { count: opportunities.length })}
      />

      {error && (
        <div className="mb-5 p-4 rounded-2xl bg-danger/5 border border-danger/20 flex items-start gap-3">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <span className="text-sm text-danger">{error}</span>
        </div>
      )}

      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : opportunities.length === 0 ? (
        <EmptyState
          title={t('services.emptyTitle')}
          description={t('services.emptyBody')}
        />
      ) : (
        <div className="space-y-4">
          {opportunities.map((op) => (
            <OpportunityRow
              key={op.id}
              opportunity={op}
              expanded={expandedId === op.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === op.id ? null : op.id))
              }
              updatingOfferId={updatingOfferId}
              onAccept={(offerId) => updateOfferStatus(offerId, 'accepted')}
              onReject={(offerId) => updateOfferStatus(offerId, 'rejected')}
              onComplete={(offerId) => updateOfferStatus(offerId, 'completed')}
            />
          ))}
        </div>
      )}

      <ReviewModal
        isOpen={!!reviewOfferId}
        onClose={() => setReviewOfferId(null)}
        onSubmit={submitReview}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
function OpportunityRow({
  opportunity,
  expanded,
  onToggle,
  updatingOfferId,
  onAccept,
  onReject,
  onComplete,
}: {
  opportunity: OpportunityWithOffers;
  expanded: boolean;
  onToggle: () => void;
  updatingOfferId: string | null;
  onAccept: (offerId: string) => void;
  onReject: (offerId: string) => void;
  onComplete: (offerId: string) => void;
}) {
  const { t } = useTranslation();
  const offers = opportunity.offers;
  const pendingCount = offers.filter((o) => o.status === 'pending').length;
  const acceptedOffer = offers.find((o) => o.status === 'accepted' || o.status === 'completed');
  const isCompleted = opportunity.status === 'completed';

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      {/* Header — clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-5 text-left hover:bg-surface-bg transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-base sm:text-lg text-ink line-clamp-1">
              {opportunity.title}
            </h3>
            {opportunity.description && (
              <p className="mt-1 text-sm text-muted line-clamp-2">
                {opportunity.description}
              </p>
            )}
          </div>
          <ChevronDown
            size={20}
            className={`shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>

        <div className="flex flex-wrap gap-3 items-center text-xs">
          <span className="inline-flex items-center gap-1 text-muted">
            <Calendar size={12} />
            {new Date(opportunity.created_at).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          {isCompleted ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success font-bold">
              <CheckCircle2 size={12} />
              {t('services.completed')}
            </span>
          ) : acceptedOffer ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-bold">
              <CheckCircle2 size={12} />
              {t('services.providerSelected')}
            </span>
          ) : pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning/10 text-warning font-bold">
              <Inbox size={12} />
              {t('services.newOffersBadge', { count: pendingCount })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-bg text-muted font-bold">
              <Clock size={12} />
              {t('services.waitingOffers')}
            </span>
          )}
        </div>
      </button>

      {/* Expanded — offers list */}
      {expanded && (
        <div className="border-t border-border bg-surface-bg/40">
          {offers.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted italic">
              {t('services.noOffers')}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {offers.map((offer) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  updating={updatingOfferId === offer.id}
                  onAccept={() => onAccept(offer.id)}
                  onReject={() => onReject(offer.id)}
                  onComplete={() => onComplete(offer.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
function OfferRow({
  offer,
  updating,
  onAccept,
  onReject,
  onComplete,
}: {
  offer: Offer;
  updating: boolean;
  onAccept: () => void;
  onReject: () => void;
  onComplete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <li className="p-4 sm:p-5 bg-white">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand-gradient text-white flex items-center justify-center font-extrabold shrink-0">
            {(offer.provider_name ?? '?')[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-ink truncate">
              {offer.provider_name ?? '—'}
            </div>
            {offer.provider_phone && (offer.status === 'accepted' || offer.status === 'completed') && (
              <a
                href={`tel:${offer.provider_phone}`}
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-0.5"
              >
                <Phone size={11} /> {offer.provider_phone}
              </a>
            )}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              <Clock size={11} />
              {timeAgo(offer.created_at, t)}
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          {offer.offer_amount != null && (
            <div className="text-xl font-extrabold text-success">
              {offer.offer_amount} ₼
            </div>
          )}
          <span
            className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${STATUS_CLS[offer.status]}`}
          >
            {t(STATUS_KEY[offer.status])}
          </span>
        </div>
      </div>

      {/* Actions */}
      {offer.status === 'pending' && offer.offer_amount != null && (
        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-3">
          <Button
            variant="outline"
            size="md"
            onClick={onReject}
            disabled={updating}
            leftIcon={<XCircle size={16} />}
            fullWidth
          >
            {t('services.actions.reject')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onAccept}
            disabled={updating}
            loading={updating}
            leftIcon={!updating ? <CheckCircle2 size={16} /> : undefined}
            fullWidth
          >
            {t('services.actions.accept')}
          </Button>
        </div>
      )}
      {offer.status === 'accepted' && (
        <Button
          variant="primary"
          size="md"
          onClick={onComplete}
          disabled={updating}
          loading={updating}
          leftIcon={!updating ? <Star size={16} /> : undefined}
          fullWidth
        >
          {t('services.actions.complete')}
        </Button>
      )}
      {offer.status === 'rejected' && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <FileText size={12} />
          {t('services.rejectedNote')}
        </div>
      )}
    </li>
  );
}

function timeAgo(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('time.now');
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
  return t('time.daysAgo', { count: Math.floor(diff / 86400) });
}
