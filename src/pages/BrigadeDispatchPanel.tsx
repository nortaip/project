import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';

interface Member {
  id: string;
  profile_id: string;
  role: 'owner' | 'dispatcher' | 'member';
  commission_pct: number | null;
  profile: {
    name: string | null;
    avatar_url: string | null;
    phone_number: string | null;
  } | null;
}

interface OfferRow {
  id: string;
  opportunity_id: string;
  offer_amount: number | null;
  status: string;
  created_at: string;
}

interface OpportunityRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  date: string | null;
  status: string | null;
  budget: number | null;
  created_by: string;
}

interface Assignment {
  id: string;
  brigade_id: string;
  member_id: string;
  source_id: string;
  status:
    | 'assigned'
    | 'accepted'
    | 'declined'
    | 'in_progress'
    | 'completed'
    | 'cancelled';
  priority: number;
  notes: string | null;
  assigned_at: string;
  responded_at: string | null;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-rose-50 text-rose-700 border-rose-200',
  in_progress: 'bg-brand-50 text-brand-700 border-brand-200',
  completed: 'bg-violet-50 text-violet-700 border-violet-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Təyin edildi',
  accepted: 'Qəbul etdi',
  declined: 'Rədd etdi',
  in_progress: 'İcra olunur',
  completed: 'Tamamlandı',
  cancelled: 'Ləğv edildi',
};

interface Props {
  brigadeId: string;
  brigadeOwnerId: string;
}

/**
 * Brigade dispatch paneli — owner/dispatcher sifarişləri işçilərə paylayır.
 */
export default function BrigadeDispatchPanel({ brigadeId, brigadeOwnerId }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [opportunities, setOpportunities] = useState<Record<string, OpportunityRow>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState<OfferRow | null>(null);

  useEffect(() => {
    void load();
    // Real-time
    const channel = supabase
      .channel(`brigade-dispatch-${brigadeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brigade_assignments' },
        () => void load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opportunities_offers' },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadeId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // 1. Brigade üzvləri (members + profile)
      const { data: memRaw } = await supabase
        .from('brigade_members')
        .select('id, profile_id, role, commission_pct, is_active')
        .eq('brigade_id', brigadeId)
        .eq('is_active', true);

      const memList = (memRaw ?? []) as Array<{
        id: string;
        profile_id: string;
        role: 'owner' | 'dispatcher' | 'member';
        commission_pct: number | null;
        is_active: boolean;
      }>;

      let profilesById: Record<
        string,
        { name: string | null; avatar_url: string | null; phone_number: string | null }
      > = {};
      const profileIds = memList.map((m) => m.profile_id);
      if (profileIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, avatar_url, phone_number')
          .in('id', profileIds);
        for (const p of (profs ?? []) as Array<{
          id: string;
          name: string | null;
          avatar_url: string | null;
          phone_number: string | null;
        }>) {
          profilesById[p.id] = {
            name: p.name,
            avatar_url: p.avatar_url,
            phone_number: p.phone_number,
          };
        }
      }

      setMembers(
        memList.map((m) => ({
          id: m.id,
          profile_id: m.profile_id,
          role: m.role,
          commission_pct: m.commission_pct,
          profile: profilesById[m.profile_id] ?? null,
        })),
      );

      // 2. Brigade owner-in active offerləri (provider = owner)
      const { data: offRaw } = await supabase
        .from('opportunities_offers')
        .select('id, opportunity_id, offer_amount, status, created_at')
        .eq('provider_id', brigadeOwnerId)
        .in('status', ['accepted', 'pending'])
        .order('created_at', { ascending: false });

      const offerList = (offRaw ?? []) as OfferRow[];
      setOffers(offerList);

      // 3. Opportunities
      const oppIds = offerList.map((o) => o.opportunity_id);
      if (oppIds.length > 0) {
        const { data: oppRaw } = await supabase
          .from('opportunities')
          .select('id, title, description, location, date, status, budget, created_by')
          .in('id', oppIds);
        const oppMap: Record<string, OpportunityRow> = {};
        for (const o of (oppRaw ?? []) as OpportunityRow[]) {
          oppMap[o.id] = o;
        }
        setOpportunities(oppMap);
      }

      // 4. Mövcud assignments
      const { data: asnRaw } = await supabase
        .from('brigade_assignments')
        .select('*')
        .eq('brigade_id', brigadeId)
        .order('assigned_at', { ascending: false });
      setAssignments((asnRaw ?? []) as Assignment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const assignmentsByOffer = useMemo(() => {
    const map: Record<string, Assignment[]> = {};
    for (const a of assignments) {
      if (!map[a.source_id]) map[a.source_id] = [];
      map[a.source_id].push(a);
    }
    return map;
  }, [assignments]);

  return (
    <div>
      {/* Members snapshot */}
      <div className="bg-white rounded-2xl border border-border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold text-ink flex items-center gap-2">
            <Users size={18} className="text-brand-600" />
            İşçilər ({members.length})
          </h3>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-muted hover:text-ink flex items-center gap-1 font-bold"
          >
            <RefreshCw size={12} /> Yenilə
          </button>
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-muted">Hələ işçi yoxdur. Dəvət göndərin.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-alt text-xs"
              >
                <span className="w-5 h-5 rounded-full bg-brand-gradient text-white flex items-center justify-center font-extrabold text-[10px]">
                  {(m.profile?.name ?? '?')[0]?.toUpperCase()}
                </span>
                <span className="font-bold text-ink">{m.profile?.name ?? '—'}</span>
                <span className="text-[10px] uppercase font-extrabold text-muted">
                  {m.role}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Offers list */}
      <div className="bg-white rounded-2xl border border-border p-4">
        <h3 className="font-extrabold text-ink mb-3 flex items-center gap-2">
          <FileText size={18} className="text-brand-600" />
          Sifarişlər ({offers.length})
        </h3>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 size={24} className="inline-block animate-spin text-brand-600" />
          </div>
        ) : offers.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">
            Hələ təyin olunmuş sifariş yoxdur.
          </p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => {
              const opp = opportunities[offer.opportunity_id];
              const offerAssignments = assignmentsByOffer[offer.id] ?? [];
              return (
                <div
                  key={offer.id}
                  className="rounded-xl border border-border p-3"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-extrabold text-ink truncate">
                        {opp?.title ?? 'Sifariş'}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {opp?.location ?? '—'}
                        {opp?.date && ` · ${opp.date}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-extrabold text-emerald-700">
                        {Number(offer.offer_amount ?? 0).toFixed(0)} ₼
                      </p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-extrabold border ${STATUS_COLORS[offer.status] ?? STATUS_COLORS.assigned}`}
                      >
                        {offer.status}
                      </span>
                    </div>
                  </div>

                  {/* Existing assignments */}
                  {offerAssignments.length > 0 && (
                    <div className="space-y-1.5 my-3">
                      {offerAssignments.map((a) => {
                        const member = members.find((m) => m.id === a.member_id);
                        return (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 p-2 rounded-lg bg-surface-alt text-xs"
                          >
                            <UserCheck size={12} className="text-muted" />
                            <span className="font-bold text-ink truncate flex-1">
                              {member?.profile?.name ?? 'İşçi'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border font-bold ${STATUS_COLORS[a.status]}`}
                            >
                              {STATUS_LABELS[a.status] ?? a.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Dispatch button */}
                  <button
                    type="button"
                    onClick={() => setDispatchOpen(offer)}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-bold border border-brand-200"
                  >
                    <Send size={14} />
                    İşçi(lər)ə yönləndir
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dispatchOpen && (
        <DispatchModal
          offer={dispatchOpen}
          opportunity={opportunities[dispatchOpen.opportunity_id]}
          members={members.filter((m) => m.role !== 'owner')}
          brigadeId={brigadeId}
          existingAssignments={assignmentsByOffer[dispatchOpen.id] ?? []}
          onClose={() => setDispatchOpen(null)}
          onDispatched={() => {
            setDispatchOpen(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DispatchModal({
  offer,
  opportunity,
  members,
  brigadeId,
  existingAssignments,
  onClose,
  onDispatched,
}: {
  offer: OfferRow;
  opportunity: OpportunityRow | undefined;
  members: Member[];
  brigadeId: string;
  existingAssignments: Assignment[];
  onClose: () => void;
  onDispatched: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Artıq təyin olunmuş member-lər
  const alreadyAssigned = new Set(existingAssignments.map((a) => a.member_id));

  async function submit() {
    if (selected.size === 0) {
      setError('Ən azı bir işçi seçin');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        'brigade_dispatch_order',
        {
          p_brigade_id: brigadeId,
          p_source_id: offer.id,
          p_member_ids: Array.from(selected),
          p_priority: priority,
          p_notes: notes.trim() || null,
        },
      );
      if (rpcErr) throw rpcErr;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      message.success(`${inserted} işçiyə təyin edildi`);
      onDispatched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border">
          <h3 className="font-extrabold text-ink text-lg">
            Sifarişi işçiyə yönləndir
          </h3>
          {opportunity && (
            <p className="text-sm text-muted mt-1 truncate">
              {opportunity.title} · {Number(offer.offer_amount ?? 0).toFixed(0)} ₼
            </p>
          )}
        </div>

        <div className="p-5">
          <p className="text-xs font-bold text-ink-soft mb-2">
            İşçi seç ({selected.size})
          </p>
          {members.length === 0 ? (
            <p className="text-sm text-muted">Aktiv işçi yoxdur. Briqada-ya dəvət göndərin.</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => {
                const isAssigned = alreadyAssigned.has(m.id);
                const isChecked = selected.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={isAssigned}
                    onClick={() => !isAssigned && toggle(m.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors flex items-center gap-3 ${
                      isAssigned
                        ? 'bg-surface-alt border-border opacity-60 cursor-not-allowed'
                        : isChecked
                          ? 'bg-brand-50 border-brand-300'
                          : 'bg-white border-border hover:border-brand-300'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-brand-gradient text-white flex items-center justify-center font-extrabold text-sm shrink-0">
                      {(m.profile?.name ?? '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-ink truncate">
                        {m.profile?.name ?? '—'}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {m.role} {m.commission_pct ? `· ${m.commission_pct}%` : ''}
                      </p>
                    </div>
                    {isAssigned ? (
                      <span className="text-[10px] uppercase font-bold text-muted">
                        təyin edilib
                      </span>
                    ) : (
                      <div
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                          isChecked
                            ? 'bg-brand-600 border-brand-600'
                            : 'border-border'
                        }`}
                      >
                        {isChecked && (
                          <CheckCircle2 size={12} className="text-white" />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4">
            <label className="block text-xs font-bold text-ink-soft mb-1">
              Prioritet (1-10, 10 = ən vacib)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
            />
          </div>

          <div className="mt-3">
            <label className="block text-xs font-bold text-ink-soft mb-1">
              Qeyd (opsional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="İşçi üçün təlimat..."
              className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
            />
          </div>

          {error && (
            <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-surface-alt"
          >
            Bağla
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || selected.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Yönləndir
          </button>
        </div>
      </div>
    </div>
  );
}

// Used colors / icons (avoid unused-import linter complaints)
void Clock;
void XCircle;
