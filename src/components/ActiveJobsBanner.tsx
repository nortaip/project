import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Briefcase, CalendarClock, ChevronRight, MapPin, Phone, PlayCircle } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { useChatUnread } from '../lib/chat';
import {
  compareVisitDay,
  fmtAzn,
  formatVisitDay,
  priceBreakdown,
  relativeDayLabel,
} from '../lib/offerTerms';
import ChatModal from './ChatModal';
import { MessageButton } from './OfferTermsInfo';

interface JobOpportunity {
  id: string;
  title: string | null;
  location: string | null;
  budget: number | null;
  status?: string | null;
  created_by?: string | null;
}

interface CustomerInfo {
  id: string;
  name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
}

/** Briqada təyinatı (dispetçer tərəfindən verilən iş). */
interface BrigadeJob {
  kind: 'brigade';
  id: string;
  brigade_id: string;
  source_id: string;
  status: 'accepted' | 'in_progress';
  assigned_at: string;
  opportunity?: JobOpportunity | null;
  brigade?: { id: string; name: string } | null;
  /** Qəbul olunmuş təklifin gəliş günü (məlumdursa). */
  proposed_at?: string | null;
  customer?: CustomerInfo | null;
}

/** Ustanın öz təklifi qəbul olunub — aktiv iş. */
interface OfferJob {
  kind: 'offer';
  id: string;
  opportunity_id: string;
  offer_amount: number | string | null;
  proposed_at: string | null;
  price_unit: string | null;
  unit_price: number | string | null;
  quantity: number | string | null;
  opportunity?: JobOpportunity | null;
  customer?: CustomerInfo | null;
}

type ActiveJob = BrigadeJob | OfferJob;

/**
 * Provayder/işçinin əsas səhifəsində bütün aktiv işləri göstərən banner:
 * qəbul olunmuş öz təklifləri + briqada təyinatları, gəliş gününə görə
 * sıralanmış. Usta köhnə işi bitməmiş yeni (gələcək tarixli) işlər götürə
 * bilir — hamısı burada bir yerdə görünür.
 */
export default function ActiveJobsBanner() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [chatJob, setChatJob] = useState<ActiveJob | null>(null);
  const { unreadFor, reload: reloadUnread } = useChatUnread(user?.id ?? null);

  useEffect(() => {
    if (!user) return;
    void load();
    const channel = supabase
      .channel('active-jobs-banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brigade_assignments' },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities_offers',
          filter: `provider_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadBrigadeJobs = async (): Promise<BrigadeJob[]> => {
    const { data: members } = await supabase
      .from('brigade_members')
      .select('id')
      .eq('profile_id', user!.id)
      .eq('is_active', true);
    const memberIds = (members ?? []).map((m) => m.id);
    if (memberIds.length === 0) return [];

    const { data, error } = await supabase
      .from('brigade_assignments')
      .select(
        'id, brigade_id, source_id, status, assigned_at, brigade:brigades(id, name)',
      )
      .in('member_id', memberIds)
      .in('status', ['accepted', 'in_progress'])
      .order('assigned_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as unknown as Omit<BrigadeJob, 'kind'>[]).map((r) => ({
      ...r,
      kind: 'brigade' as const,
    }));
  };

  const loadOfferJobs = async (): Promise<OfferJob[]> => {
    const { data, error } = await supabase
      .from('opportunities_offers')
      .select(
        'id, opportunity_id, offer_amount, proposed_at, price_unit, unit_price, quantity',
      )
      .eq('provider_id', user!.id)
      .eq('status', 'accepted')
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as unknown as Omit<OfferJob, 'kind'>[]).map((r) => ({
      ...r,
      kind: 'offer' as const,
    }));
  };

  const load = async () => {
    try {
      const [brigadeJobs, offerJobs] = await Promise.all([
        loadBrigadeJobs().catch((e) => {
          console.error('ActiveJobsBanner brigade load error:', e);
          return [] as BrigadeJob[];
        }),
        loadOfferJobs().catch((e) => {
          console.error('ActiveJobsBanner offers load error:', e);
          return [] as OfferJob[];
        }),
      ]);

      const oppIds = Array.from(
        new Set([
          ...brigadeJobs.map((r) => r.source_id),
          ...offerJobs.map((r) => r.opportunity_id),
        ]),
      ).filter(Boolean);
      let oppMap: Record<string, JobOpportunity> = {};
      let customerMap: Record<string, CustomerInfo> = {};
      if (oppIds.length > 0) {
        const { data: opps } = await supabase
          .from('opportunities')
          .select('id, title, location, budget, status, created_by')
          .in('id', oppIds);
        oppMap = Object.fromEntries(
          ((opps ?? []) as JobOpportunity[]).map((o) => [o.id, o]),
        );
        const customerIds = Array.from(
          new Set(
            Object.values(oppMap)
              .map((o) => o.created_by)
              .filter((x): x is string => !!x),
          ),
        );
        if (customerIds.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, name, phone_number, avatar_url')
            .in('id', customerIds);
          customerMap = Object.fromEntries(
            ((profs ?? []) as CustomerInfo[]).map((p) => [p.id, p]),
          );
        }
      }
      const customerOf = (oppId: string) => {
        const by = oppMap[oppId]?.created_by;
        return by ? customerMap[by] ?? null : null;
      };

      // Briqada işi ilə eyni sifarişdəki qəbul olunmuş təklif — tək kart kimi
      const offerByOpp = new Map(offerJobs.map((o) => [o.opportunity_id, o]));
      const brigadeOppIds = new Set(brigadeJobs.map((b) => b.source_id));

      const merged: ActiveJob[] = [
        ...brigadeJobs.map((r) => ({
          ...r,
          opportunity: oppMap[r.source_id] ?? null,
          customer: customerOf(r.source_id),
          proposed_at: offerByOpp.get(r.source_id)?.proposed_at ?? null,
        })),
        ...offerJobs
          .filter((o) => !brigadeOppIds.has(o.opportunity_id))
          .map((o) => ({
            ...o,
            opportunity: oppMap[o.opportunity_id] ?? null,
            customer: customerOf(o.opportunity_id),
          })),
      ];
      merged.sort((a, b) => {
        const d = compareVisitDay(a.proposed_at, b.proposed_at);
        if (d !== 0) return d;
        const ta = a.kind === 'brigade' ? Date.parse(a.assigned_at) : 0;
        const tb = b.kind === 'brigade' ? Date.parse(b.assigned_at) : 0;
        return tb - ta;
      });
      setJobs(merged);
    } catch (e) {
      console.error('ActiveJobsBanner load error:', e);
    }
  };

  const handleStart = async (job: BrigadeJob) => {
    setBusy(job.id);
    const { error } = await supabase
      .from('brigade_assignments')
      .update({ status: 'in_progress' })
      .eq('id', job.id);
    setBusy(null);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('İş başladı');
    await load();
  };

  const handleComplete = async (job: BrigadeJob) => {
    if (!confirm('İşi tamamladığını qeyd edirsən?')) return;
    setBusy(job.id);
    const { error } = await supabase.rpc('brigade_assignment_complete', {
      p_assignment_id: job.id,
    });
    setBusy(null);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('Tamamlandı');
    await load();
  };

  const hasOfferJobs = useMemo(() => jobs.some((j) => j.kind === 'offer'), [jobs]);

  if (jobs.length === 0) return null;

  const oppIdOf = (j: ActiveJob) => (j.kind === 'brigade' ? j.source_id : j.opportunity_id);

  return (
    <div className="mb-5 bg-gradient-to-br from-brand-50 to-accent-50 border-2 border-brand-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Briefcase size={18} className="text-brand-700" />
          <h3 className="text-base font-extrabold text-ink">
            Aktiv işlərim ({jobs.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => navigate(hasOfferJobs ? '/account/offers' : '/account/incoming')}
          className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
        >
          Hamısı <ChevronRight size={14} />
        </button>
      </div>
      <p className="text-xs text-muted mb-3">{t('offerTerms.provider.activeJobsHint')}</p>

      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
        {jobs.map((j) => {
          const isInProgress =
            j.kind === 'brigade'
              ? j.status === 'in_progress'
              : ['ongoing', 'i-am-here', 'in_progress'].includes(j.opportunity?.status ?? '');
          const visit = formatVisitDay(j.proposed_at);
          const rel = relativeDayLabel(j.proposed_at);
          const breakdown = j.kind === 'offer' ? priceBreakdown(j) : null;
          const unread = unreadFor(oppIdOf(j), j.customer?.id ?? j.opportunity?.created_by);
          return (
            <div
              key={`${j.kind}-${j.id}`}
              className={`shrink-0 w-72 bg-white rounded-xl p-3 border flex flex-col ${
                isInProgress
                  ? 'border-amber-300'
                  : 'border-brand-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                    isInProgress
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-brand-50 text-brand-700'
                  }`}
                >
                  {isInProgress ? 'Davam edir' : 'Qəbul edildi'}
                </span>
                {j.kind === 'brigade' && (
                  <span className="text-xs text-muted truncate">
                    {j.brigade?.name ?? '—'}
                  </span>
                )}
              </div>
              <p className="font-extrabold text-ink text-sm line-clamp-1">
                {j.opportunity?.title ?? 'Sifariş'}
              </p>

              {/* Gəliş günü */}
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                <CalendarClock size={12} className="text-emerald-600 shrink-0" />
                {visit ? (
                  <span className="font-bold text-ink truncate">{visit}</span>
                ) : (
                  <span className="italic text-muted">{t('offerTerms.noVisitDay')}</span>
                )}
                {rel && (
                  <span className="shrink-0 px-1.5 py-px rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase">
                    {rel}
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {j.kind === 'offer' ? (
                  <span className="font-bold text-brand-700">
                    {fmtAzn(j.offer_amount)}
                    {breakdown && <span className="font-medium text-muted"> · {breakdown}</span>}
                  </span>
                ) : (
                  j.opportunity?.budget != null && (
                    <span className="font-bold text-brand-700">
                      {j.opportunity.budget} AZN
                    </span>
                  )
                )}
                {j.opportunity?.location && (
                  <span className="inline-flex items-center gap-1 truncate max-w-full">
                    <MapPin size={11} className="shrink-0" />
                    <span className="truncate">{j.opportunity.location}</span>
                  </span>
                )}
              </div>
              {j.customer?.name && (
                <p className="mt-1 text-xs text-ink-soft truncate">
                  {t('offerTerms.provider.customer')}: <b>{j.customer.name}</b>
                </p>
              )}

              <div className="mt-auto pt-3 flex flex-col gap-2">
                {j.kind === 'brigade' &&
                  (!isInProgress ? (
                    <button
                      type="button"
                      onClick={() => handleStart(j)}
                      disabled={busy === j.id}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      <PlayCircle size={14} /> İşi başlat
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleComplete(j)}
                      disabled={busy === j.id}
                      className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      Tamamla
                    </button>
                  ))}
                {(j.customer?.id || j.opportunity?.created_by) && (
                  <div className="flex gap-2">
                    <MessageButton
                      onClick={() => setChatJob(j)}
                      unread={unread}
                      className="flex-1 h-8 text-xs"
                    />
                    {j.customer?.phone_number && (
                      <a
                        href={`tel:${j.customer.phone_number}`}
                        className="h-8 w-9 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center shrink-0"
                        title={t('offerTerms.actions.call')}
                        aria-label={t('offerTerms.actions.call')}
                      >
                        <Phone size={14} />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {chatJob && (chatJob.customer?.id || chatJob.opportunity?.created_by) && (
        <ChatModal
          opportunityId={oppIdOf(chatJob)}
          peerId={(chatJob.customer?.id ?? chatJob.opportunity?.created_by) as string}
          peerName={chatJob.customer?.name ?? t('offerTerms.provider.customer')}
          peerAvatar={chatJob.customer?.avatar_url ?? null}
          peerPhone={chatJob.customer?.phone_number ?? null}
          subtitle={chatJob.opportunity?.title ?? null}
          onClose={() => {
            setChatJob(null);
            void reloadUnread();
          }}
        />
      )}
    </div>
  );
}
