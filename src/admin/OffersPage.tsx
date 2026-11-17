import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  Clock,
  FileText,
  Hourglass,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Tag,
  Undo2,
  User as UserIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
} from '../components/ui';
import ChatModal from '../components/ChatModal';
import { MessageButton, OfferTermsInfo } from '../components/OfferTermsInfo';
import { useChatUnread } from '../lib/chat';
import {
  buildProposedAtTimestamp,
  compareVisitDay,
  fmtAzn,
  formatVisitDay,
  formatYmd,
  isYmdInSchedule,
  MAX_SCHEDULE_DAYS,
  scheduleBounds,
  stripErrorCode,
  toBakuParts,
} from '../lib/offerTerms';

type OfferStatus = 'pending' | 'accepted' | 'won' | 'lost' | string;

interface Offer {
  id: string;
  offer_amount: number;
  status: OfferStatus;
  created_at: string;
  opportunity_id: string | null;
  payout_status?: string | null;
  // Təklifin şərtləri
  proposed_at: string | null;
  price_unit: string | null;
  unit_price: number | string | null;
  quantity: number | string | null;
  notes: string | null;
  opportunity: {
    id?: string | null;
    title: string;
    location: string | null;
    description?: string | null;
    budget?: number | null;
    date?: string | null;
    status?: string | null;
    created_by?: string | null;
    user?: {
      id?: string | null;
      name?: string | null;
      email?: string | null;
      phone_number?: string | null;
      avatar_url?: string | null;
    } | null;
  } | null;
}

const STATUS_CONFIG: Record<
  OfferStatus,
  { label: string; cls: string }
> = {
  won:       { label: 'QAZANILDI',  cls: 'bg-success/10 text-success' },
  accepted:  { label: 'QƏBUL EDİLDİ', cls: 'bg-brand-50 text-brand-700' },
  pending:   { label: 'GÖZLƏMƏDƏ', cls: 'bg-warning/10 text-warning' },
  lost:      { label: 'İTİRİLDİ',  cls: 'bg-danger/5 text-danger' },
  completed: { label: 'TAMAMLANDI', cls: 'bg-success/10 text-success' },
  rejected:  { label: 'RƏDD EDİLDİ', cls: 'bg-danger/5 text-danger' },
  expired:   { label: 'VAXTI BİTİB', cls: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'GERİ GÖTÜRÜLDÜ', cls: 'bg-gray-100 text-gray-600' },
};

const NO_DAY = '__none__';

export default function OffersPage() {
  const { t } = useTranslation();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [chatOffer, setChatOffer] = useState<Offer | null>(null);
  const { unreadFor, reload: reloadUnread } = useChatUnread(userId);

  const fetchOffers = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('opportunities_offers')
      .select(
        `
          id,
          offer_amount,
          status,
          created_at,
          opportunity_id,
          payout_status,
          proposed_at,
          price_unit,
          unit_price,
          quantity,
          notes,
          opportunity:opportunities!fk_opportunity (
            id,
            title,
            location,
            description,
            budget,
            date,
            status,
            created_by,
            user:profiles!fk_opportunity_created_by (
              id,
              name,
              email,
              phone_number,
              avatar_url
            )
          )
        `,
      )
      .eq('provider_id', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Offers fetch error:', error);
      return [];
    }
    return data as unknown as Offer[];
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    setOffers(await fetchOffers(userId));
  }, [userId, fetchOffers]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      setOffers(await fetchOffers(user.id));
      setLoading(false);
    })();
  }, [fetchOffers]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`offers_for_user_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities_offers',
          filter: `provider_id=eq.${userId}`,
        },
        async () => setOffers(await fetchOffers(userId)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchOffers]);

  // Aktiv işlər (qəbul olunmuş) gəliş gününə görə; gözləyənlər də
  const active = useMemo(
    () =>
      offers
        .filter((o) => o.status === 'accepted')
        .sort((a, b) => compareVisitDay(a.proposed_at, b.proposed_at)),
    [offers],
  );
  const pending = useMemo(
    () =>
      offers
        .filter((o) => o.status === 'pending')
        .sort((a, b) => compareVisitDay(a.proposed_at, b.proposed_at)),
    [offers],
  );
  const history = useMemo(
    () => offers.filter((o) => o.status !== 'accepted' && o.status !== 'pending'),
    [offers],
  );

  // Aktiv işləri gün üzrə qruplaşdır — eyni günə düşən işlər aydın görünsün
  const activeByDay = useMemo(() => {
    const groups: { key: string; items: Offer[] }[] = [];
    for (const o of active) {
      const key = toBakuParts(o.proposed_at)?.ymd ?? NO_DAY;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(o);
      else groups.push({ key, items: [o] });
    }
    return groups;
  }, [active]);

  const peerOf = (o: Offer) => o.opportunity?.user?.id ?? o.opportunity?.created_by ?? null;

  return (
    <div>
      <SectionHeader
        title={t('offers.title')}
        subtitle={t('offers.subtitleCount', { count: offers.length })}
      />

      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : offers.length === 0 ? (
        <EmptyState
          title={t('offers.emptyTitle')}
          description={t('offers.emptyBody')}
        />
      ) : (
        <div className="space-y-8">
          {/* ── Aktiv işlər ─────────────────────────────────────── */}
          {active.length > 0 && (
            <section>
              <SectionTitle
                icon={<Briefcase size={18} className="text-emerald-600" />}
                title={`${t('offerTerms.provider.activeJobs')} (${active.length})`}
                hint={t('offerTerms.provider.activeJobsHint')}
              />
              <div className="space-y-5">
                {activeByDay.map((g) => (
                  <div key={g.key}>
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarClock size={14} className="text-brand-600" />
                      <span className="text-sm font-extrabold text-ink">
                        {g.key === NO_DAY ? t('offerTerms.noVisitDay') : formatYmd(g.key)}
                      </span>
                      <span className="text-xs text-muted">
                        · {t('offerTerms.provider.jobsCount', { count: g.items.length })}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {g.items.map((offer) => (
                        <ActiveJobCard
                          key={offer.id}
                          offer={offer}
                          unread={unreadFor(offer.opportunity_id ?? offer.opportunity?.id, peerOf(offer))}
                          onMessage={() => setChatOffer(offer)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Gözləyən təkliflər ──────────────────────────────── */}
          {pending.length > 0 && (
            <section>
              <SectionTitle
                icon={<Hourglass size={18} className="text-amber-600" />}
                title={`${t('offerTerms.provider.pendingOffers')} (${pending.length})`}
                hint={t('offerTerms.provider.pendingHint')}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pending.map((offer) => (
                  <PendingOfferCard
                    key={offer.id}
                    offer={offer}
                    unread={unreadFor(offer.opportunity_id ?? offer.opportunity?.id, peerOf(offer))}
                    onMessage={() => setChatOffer(offer)}
                    onChanged={reload}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Keçmiş təkliflər ────────────────────────────────── */}
          {history.length > 0 && (
            <section>
              <SectionTitle
                icon={<FileText size={18} className="text-muted" />}
                title={`${t('offerTerms.provider.history')} (${history.length})`}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {history.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {chatOffer && peerOf(chatOffer) && (chatOffer.opportunity_id ?? chatOffer.opportunity?.id) && (
        <ChatModal
          opportunityId={(chatOffer.opportunity_id ?? chatOffer.opportunity?.id) as string}
          peerId={peerOf(chatOffer) as string}
          peerName={chatOffer.opportunity?.user?.name ?? t('offerTerms.provider.customer')}
          peerAvatar={chatOffer.opportunity?.user?.avatar_url ?? null}
          peerPhone={
            chatOffer.status === 'accepted' ? chatOffer.opportunity?.user?.phone_number ?? null : null
          }
          subtitle={chatOffer.opportunity?.title ?? null}
          onClose={() => {
            setChatOffer(null);
            void reloadUnread();
          }}
        />
      )}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-lg font-extrabold text-ink">{title}</h3>
      </div>
      {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const statusCfg = STATUS_CONFIG[status] ?? {
    label: status.toUpperCase(),
    cls: 'bg-surface-bg text-ink-soft',
  };
  return (
    <span
      className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wider ${statusCfg.cls}`}
    >
      {statusCfg.label}
    </span>
  );
}

/** Sifarişin məkanı + müştərinin istədiyi gün. */
function OpportunityMeta({ offer }: { offer: Offer }) {
  const { t } = useTranslation();
  const op = offer.opportunity;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {op?.location && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <MapPin size={12} className="shrink-0" />
          <span className="truncate max-w-[220px]">{op.location}</span>
        </span>
      )}
      {op?.date && (
        <span className="inline-flex items-center gap-1">
          <Clock size={12} />
          {t('offerTerms.customerPreferredDay')}: {formatYmd(op.date, { weekday: false })}
        </span>
      )}
      {op?.budget != null && (
        <span className="inline-flex items-center gap-1 text-success font-bold">
          <Tag size={12} />
          Büdcə: {op.budget} ₼
        </span>
      )}
    </div>
  );
}

function AmountRow({ offer, label }: { offer: Offer; label: string }) {
  return (
    <div className="flex items-end justify-between pt-3 border-t border-border">
      <div>
        <div className="text-[11px] uppercase font-bold tracking-wide text-muted">{label}</div>
        <div className="text-2xl font-extrabold text-brand-700">{fmtAzn(offer.offer_amount)}</div>
      </div>
      <div className="text-right text-[11px] text-muted inline-flex items-center gap-1">
        <Clock size={11} />
        {new Date(offer.created_at).toLocaleString('az-AZ', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  );
}

// ── Qəbul olunmuş (aktiv) iş ──────────────────────────────────────
function ActiveJobCard({
  offer,
  unread,
  onMessage,
}: {
  offer: Offer;
  unread: number;
  onMessage: () => void;
}) {
  const { t } = useTranslation();
  const op = offer.opportunity;
  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3 border-emerald-200">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-extrabold text-base sm:text-lg text-ink line-clamp-2 flex-1">
          {op?.title ?? 'Naməlum sorğu'}
        </h3>
        <StatusPill status={offer.status} />
      </div>

      <OfferTermsInfo offer={offer} agreed />
      <OpportunityMeta offer={offer} />

      <AmountRow offer={offer} label={t('offers.yourOffer')} />

      {/* Müştəri əlaqə məlumatları */}
      <div className="p-4 rounded-2xl bg-brand-50 border border-brand-100">
        <div className="flex items-center gap-2 mb-3">
          <UserIcon size={16} className="text-brand-600" />
          <h4 className="text-sm font-extrabold text-brand-700">{t('offers.customerContact')}</h4>
        </div>
        <div className="space-y-1.5 text-sm">
          {op?.user?.name && (
            <div className="flex items-center gap-2 text-ink-soft">
              <FileText size={14} className="text-muted shrink-0" />
              <span className="font-bold">{op.user.name}</span>
            </div>
          )}
          {op?.user?.phone_number && (
            <a
              href={`tel:${op.user.phone_number}`}
              className="flex items-center gap-2 text-brand-600 hover:underline"
            >
              <Phone size={14} className="shrink-0" />
              <span>{op.user.phone_number}</span>
            </a>
          )}
          {op?.user?.email && (
            <a
              href={`mailto:${op.user.email}`}
              className="flex items-center gap-2 text-brand-600 hover:underline"
            >
              <Mail size={14} className="shrink-0" />
              <span className="truncate">{op.user.email}</span>
            </a>
          )}
        </div>
        <div className="mt-3">
          <MessageButton onClick={onMessage} unread={unread} className="bg-white" />
        </div>
      </div>
    </Card>
  );
}

// ── Gözləyən təklif: tarixi dəyiş / geri götür / mesaj ───────────
function PendingOfferCard({
  offer,
  unread,
  onMessage,
  onChanged,
}: {
  offer: Offer;
  unread: number;
  onMessage: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const op = offer.opportunity;
  const bounds = useMemo(() => scheduleBounds(), []);
  const current = toBakuParts(offer.proposed_at);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(current?.ymd ?? bounds.min);
  const [time, setTime] = useState(current?.hasTime ? current.hm : '');
  const [busy, setBusy] = useState<'save' | 'withdraw' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function startEdit() {
    const p = toBakuParts(offer.proposed_at);
    const initial = p && p.ymd >= bounds.min ? p.ymd : bounds.min;
    setDate(initial);
    setTime(p?.hasTime ? p.hm : '');
    setErr(null);
    setOk(null);
    setEditing(true);
  }

  async function saveDate() {
    setErr(null);
    setOk(null);
    if (!isYmdInSchedule(date)) {
      setErr(t('offerTerms.errors.dateRange', { max: MAX_SCHEDULE_DAYS }));
      return;
    }
    setBusy('save');
    const { data, error } = await supabase
      .from('opportunities_offers')
      .update({ proposed_at: buildProposedAtTimestamp(date, time || null) })
      .eq('id', offer.id)
      .select('id, status, proposed_at')
      .maybeSingle();
    setBusy(null);
    if (error) {
      setErr(stripErrorCode(error.message));
      return;
    }
    if (!data) {
      setErr(t('offerTerms.errors.notChanged'));
      return;
    }
    setEditing(false);
    setOk(t('offerTerms.provider.rescheduled'));
    await onChanged();
  }

  async function withdraw() {
    if (!window.confirm(t('offerTerms.confirm.withdraw'))) return;
    setErr(null);
    setOk(null);
    setBusy('withdraw');
    const { data, error } = await supabase
      .from('opportunities_offers')
      .update({ status: 'cancelled' })
      .eq('id', offer.id)
      .select('id, status')
      .maybeSingle();
    setBusy(null);
    if (error) {
      setErr(stripErrorCode(error.message));
      return;
    }
    // Server icazəsiz keçidi səssizcə saxlayır (məs. artıq qəbul olunub)
    if (!data || (data as { status?: string }).status !== 'cancelled') {
      setErr(t('offerTerms.errors.notChanged'));
      await onChanged();
      return;
    }
    await onChanged();
  }

  const preview = formatVisitDay(buildProposedAtTimestamp(date, time || null));

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-extrabold text-base sm:text-lg text-ink line-clamp-2 flex-1">
          {op?.title ?? 'Naməlum sorğu'}
        </h3>
        <StatusPill status={offer.status} />
      </div>

      <OfferTermsInfo offer={offer} />
      <OpportunityMeta offer={offer} />

      {editing && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-3">
          <p className="text-xs font-bold text-ink-soft mb-2">{t('offerTerms.provider.rescheduleTitle')}</p>
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
            <input
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 px-3 rounded-xl bg-white border-[1.5px] border-border focus:border-brand-600 outline-none text-sm text-ink"
              aria-label={t('offerTerms.visitDay')}
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-10 px-3 rounded-xl bg-white border-[1.5px] border-border focus:border-brand-600 outline-none text-sm text-ink"
              aria-label={t('offerTerms.bid.timeLabel')}
              title={t('offerTerms.bid.timeLabel')}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{t('offerTerms.bid.timeHint')}</p>
          {preview && (
            <p className="mt-1 text-xs text-emerald-800">
              {t('offerTerms.bid.customerWillSee')}: <b>{preview}</b>
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="primary"
              onClick={saveDate}
              loading={busy === 'save'}
              disabled={busy !== null}
            >
              {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-1.5 text-xs flex items-start gap-1.5">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}
      {ok && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1.5 text-xs">
          {ok}
        </div>
      )}

      <AmountRow offer={offer} label={t('offers.yourOffer')} />

      <div className="flex flex-wrap gap-2">
        {!editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={startEdit}
            disabled={busy !== null}
            leftIcon={<CalendarClock size={14} />}
          >
            {t('offerTerms.actions.reschedule')}
          </Button>
        )}
        <MessageButton onClick={onMessage} unread={unread} />
        <Button
          size="sm"
          variant="outline"
          onClick={withdraw}
          disabled={busy !== null}
          loading={busy === 'withdraw'}
          leftIcon={busy === 'withdraw' ? undefined : <Undo2 size={14} />}
        >
          {t('offerTerms.actions.withdraw')}
        </Button>
      </div>
    </Card>
  );
}

// ── Keçmiş təklif (tamamlanmış / rədd / geri götürülmüş) ──────────
function OfferCard({ offer }: { offer: Offer }) {
  const { t } = useTranslation();
  const op = offer.opportunity;

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3 opacity-80">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-extrabold text-base text-ink line-clamp-2 flex-1">
          {op?.title ?? 'Naməlum sorğu'}
        </h3>
        <StatusPill status={offer.status} />
      </div>

      <OpportunityMeta offer={offer} />
      {offer.proposed_at && (
        <div className="text-xs text-muted inline-flex items-center gap-1">
          <CalendarClock size={12} />
          {t('offerTerms.visitDay')}: {formatVisitDay(offer.proposed_at)}
        </div>
      )}

      <AmountRow offer={offer} label={t('offers.yourOffer')} />
    </Card>
  );
}
