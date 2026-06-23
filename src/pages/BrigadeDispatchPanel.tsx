import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { message } from 'antd';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Field, Input, Textarea } from '../components/ui';
import OpportunitiesMap, { type MapPoint } from '../admin/OpportunitiesMap';
import { parseCoords } from '../admin/opportunityUtils';

interface OpportunityRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  date: string | null;
  status: string | null;
  budget: number | null;
  category_id: string | null;
  created_at: string;
}

interface CategoryRow {
  id: string;
  label: string;
}

interface OfferRow {
  id: string;
  opportunity_id: string;
  offer_amount: number | null;
  status: string;
  created_at: string;
}

interface ExecMember {
  id: string;
  profile_id: string;
  role: string;
  name: string | null;
}

interface ExecAssignment {
  id: string;
  member_id: string;
  status: string;
  completed_at: string | null;
  name: string | null;
}

interface ExecOrder {
  offer_id: string;
  opportunity_id: string;
  title: string | null;
  location: string | null;
  amount: number | null;
  offer_status: string;
  created_at: string;
  assignments: ExecAssignment[];
}

interface Props {
  brigadeId: string;
  brigadeOwnerId: string;
  brigadeCategories: string[];
  brigadeBalance: number;
}

export default function BrigadeDispatchPanel({
  brigadeId,
  brigadeCategories,
  brigadeBalance,
}: Props) {
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [myOffers, setMyOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionPct, setCommissionPct] = useState(0);
  const [offerOpp, setOfferOpp] = useState<OpportunityRow | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'open' | 'execution'>('open');
  const [orders, setOrders] = useState<ExecOrder[]>([]);
  const [members, setMembers] = useState<ExecMember[]>([]);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // Real-time: yeni sifariş / təklif gəldikcə paneli avtomatik yenilə
    const channel = supabase
      .channel(`brigade-dispatch-${brigadeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opportunities' },
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

  const load = async () => {
    setLoading(true);
    try {
      // 1. Komissiya faizi
      const { data: rates } = await supabase.rpc('get_commission_rates');
      if (rates && typeof rates === 'object') {
        setCommissionPct(
          Number((rates as Record<string, number>).commission_on_accept ?? 0),
        );
      }

      // 2. Kateqoriya ID-lərini briqada label-larına görə tap
      const { data: cats } = await supabase
        .from('service_categories')
        .select('id, label');
      const allCategories = (cats ?? []) as CategoryRow[];
      setCategories(allCategories);

      const matchingCatIds = allCategories
        .filter((c) =>
          brigadeCategories.some(
            (bc) => bc.toLowerCase() === c.label.toLowerCase(),
          ),
        )
        .map((c) => c.id);

      // 3. Bu kateqoriyalara uyğun açıq sifarişlər
      let opps: OpportunityRow[] = [];
      if (matchingCatIds.length > 0) {
        const { data } = await supabase
          .from('opportunities')
          .select(
            'id, title, description, location, date, status, budget, category_id, created_at',
          )
          .in('category_id', matchingCatIds)
          .in('status', ['pending', 'open', 'new', 'active'])
          .order('created_at', { ascending: false })
          .limit(100);
        opps = (data ?? []) as OpportunityRow[];
      }
      setOpportunities(opps);

      // 4. Briqadanın artıq verdiyi təkliflər
      const { data: offers } = await supabase
        .from('opportunities_offers')
        .select('id, opportunity_id, offer_amount, status, created_at')
        .eq('brigade_id', brigadeId)
        .order('created_at', { ascending: false })
        .limit(100);
      setMyOffers((offers ?? []) as OfferRow[]);

      // 5. İcra: aktiv üzvlər (işçilər)
      const { data: memRows } = await supabase
        .from('brigade_members')
        .select('id, profile_id, role, is_active, profile:profiles(name)')
        .eq('brigade_id', brigadeId)
        .eq('is_active', true);
      const mems: ExecMember[] = (memRows ?? []).map((m: Record<string, unknown>) => ({
        id: String(m.id),
        profile_id: String(m.profile_id),
        role: String(m.role),
        name: ((m.profile as { name?: string } | null)?.name) ?? null,
      }));
      setMembers(mems);

      // 6. İcra: briqadanın qəbul edilmiş / tamamlanmış təklifləri
      const { data: accOffers } = await supabase
        .from('opportunities_offers')
        .select('id, opportunity_id, offer_amount, status, created_at')
        .eq('brigade_id', brigadeId)
        .in('status', ['accepted', 'completed'])
        .order('created_at', { ascending: false })
        .limit(100);
      const acc = (accOffers ?? []) as OfferRow[];

      // Sifariş başlıqları
      const oppIds = Array.from(new Set(acc.map((o) => o.opportunity_id)));
      const oppMap: Record<string, { title: string | null; location: string | null }> = {};
      if (oppIds.length > 0) {
        const { data: opps2 } = await supabase
          .from('opportunities')
          .select('id, title, location')
          .in('id', oppIds);
        for (const o of (opps2 ?? []) as Array<{ id: string; title: string | null; location: string | null }>) {
          oppMap[o.id] = { title: o.title, location: o.location };
        }
      }

      // Təyinatlar (kim icra edir)
      const { data: asgRows } = await supabase
        .from('brigade_assignments')
        .select('id, member_id, source_id, status, completed_at, member:brigade_members(profile:profiles(name))')
        .eq('brigade_id', brigadeId)
        .order('assigned_at', { ascending: false })
        .limit(200);
      const asgByOffer: Record<string, ExecAssignment[]> = {};
      for (const a of (asgRows ?? []) as Array<Record<string, unknown>>) {
        const sid = String(a.source_id);
        const name =
          ((a.member as { profile?: { name?: string } } | null)?.profile?.name) ?? null;
        (asgByOffer[sid] ??= []).push({
          id: String(a.id),
          member_id: String(a.member_id),
          status: String(a.status),
          completed_at: (a.completed_at as string | null) ?? null,
          name,
        });
      }

      setOrders(
        acc.map((o) => ({
          offer_id: o.id,
          opportunity_id: o.opportunity_id,
          title: oppMap[o.opportunity_id]?.title ?? null,
          location: oppMap[o.opportunity_id]?.location ?? null,
          amount: o.offer_amount,
          offer_status: o.status,
          created_at: o.created_at,
          assignments: asgByOffer[o.id] ?? [],
        })),
      );
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const offeredOppIds = useMemo(() => {
    const m: Record<string, OfferRow> = {};
    for (const o of myOffers) {
      if (o.status === 'pending' || o.status === 'accepted') {
        m[o.opportunity_id] = o;
      }
    }
    return m;
  }, [myOffers]);

  const categoryById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.label;
    return m;
  }, [categories]);

  // Xəritə üçün koordinatı olan sifarişlər (bütün sifarişlər anlıq görünür)
  const mapPoints = useMemo<MapPoint[]>(
    () =>
      opportunities
        .map((opp) => {
          const coords = parseCoords(opp.location);
          return coords
            ? {
                id: opp.id,
                coords,
                title: opp.title || 'Yeni sifariş',
                subtitle: opp.budget != null ? `${opp.budget} ₼` : undefined,
              }
            : null;
        })
        .filter((p): p is MapPoint => !!p),
    [opportunities],
  );

  // Dashboard statistikası
  const stats = useMemo(() => {
    let pendingOffers = 0;
    let acceptedOffers = 0;
    for (const o of myOffers) {
      if (o.status === 'pending') pendingOffers++;
      else if (o.status === 'accepted') acceptedOffers++;
    }
    return {
      open: opportunities.length,
      onMap: mapPoints.length,
      pendingOffers,
      acceptedOffers,
    };
  }, [opportunities, myOffers, mapPoints]);

  const assignWorker = async (offerId: string, memberId: string) => {
    if (!memberId) return;
    setAssignBusy(offerId);
    const { error } = await supabase.rpc('brigade_dispatch_order', {
      p_brigade_id: brigadeId,
      p_source_id: offerId,
      p_member_ids: [memberId],
    });
    setAssignBusy(null);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('İşçi təyin edildi');
    await load();
  };

  const workers = useMemo(
    () => members.filter((m) => m.role === 'member' || m.role === 'dispatcher'),
    [members],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Dashboard stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={<Wallet size={18} />}
          label="Briqada balansı"
          value={`${brigadeBalance.toFixed(2)} ₼`}
          hint={`Komissiya: ${commissionPct}%`}
          tint="brand"
        />
        <StatCard
          icon={<Briefcase size={18} />}
          label="Açıq sifariş"
          value={String(stats.open)}
          hint={`${stats.onMap} xəritədə`}
          tint="emerald"
        />
        <StatCard
          icon={<Clock size={18} />}
          label="Gözləyən təklif"
          value={String(stats.pendingOffers)}
          tint="amber"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Qəbul edilən"
          value={String(stats.acceptedOffers)}
          tint="violet"
        />
      </div>

      {/* Görünüş keçidi (admin üslubu) */}
      <div className="flex gap-2 mb-4 border-b border-border">
        <ViewTab
          label="Açıq sifarişlər"
          count={opportunities.length}
          active={view === 'open'}
          onClick={() => setView('open')}
        />
        <ViewTab
          label="İcra / Sifarişlər"
          count={orders.length}
          active={view === 'execution'}
          onClick={() => setView('execution')}
        />
      </div>

      {view === 'execution' ? (
        <ExecutionTable
          orders={orders}
          workers={workers}
          assignBusy={assignBusy}
          onAssign={assignWorker}
        />
      ) : opportunities.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Briefcase size={32} />}
            title="Uyğun açıq sifariş yoxdur"
            description="Briqadanızın kateqoriyalarına uyğun yeni sifariş gəldikcə burada anlıq görünəcək."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4">
          {/* Sifariş siyahısı */}
          <div className="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
            {opportunities.map((opp) => {
              const existing = offeredOppIds[opp.id];
              return (
                <OpportunityCard
                  key={opp.id}
                  opp={opp}
                  active={opp.id === activeId}
                  hasLocation={!!parseCoords(opp.location)}
                  categoryLabel={
                    opp.category_id ? categoryById[opp.category_id] : null
                  }
                  existingOffer={existing}
                  onActivate={() => setActiveId(opp.id)}
                  onOffer={() => setOfferOpp(opp)}
                />
              );
            })}
          </div>

          {/* Canlı xəritə (komanda paneli) */}
          <div className="hidden lg:block">
            <OpportunitiesMap
              points={mapPoints}
              activeId={activeId}
              onSelect={setActiveId}
              className="sticky top-4 h-[calc(100vh-9rem)] rounded-3xl overflow-hidden border border-border shadow-card"
            />
            {mapPoints.length === 0 && (
              <p className="text-center text-xs text-muted mt-2">
                Bu sifarişlərdə xəritə koordinatı yoxdur.
              </p>
            )}
          </div>
        </div>
      )}

      {offerOpp && (
        <PlaceOfferModal
          brigadeId={brigadeId}
          opp={offerOpp}
          brigadeBalance={brigadeBalance}
          commissionPct={commissionPct}
          onClose={() => setOfferOpp(null)}
          onDone={async () => {
            setOfferOpp(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-bold transition-colors ${
        active ? 'text-brand-700' : 'text-muted hover:text-ink'
      }`}
    >
      {label}
      {count != null && <span className="ml-1.5 text-xs font-extrabold opacity-70">{count}</span>}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-brand-600 rounded-full" />
      )}
    </button>
  );
}

const ASG_STATUS: Record<string, { label: string; cls: string }> = {
  assigned: { label: 'Təyin edildi', cls: 'bg-amber-50 text-amber-700' },
  accepted: { label: 'Qəbul edildi', cls: 'bg-blue-50 text-blue-700' },
  in_progress: { label: 'Davam edir', cls: 'bg-brand-50 text-brand-700' },
  completed: { label: 'Tamamlandı', cls: 'bg-emerald-50 text-emerald-700' },
  declined: { label: 'Rədd edildi', cls: 'bg-rose-50 text-rose-700' },
  cancelled: { label: 'Ləğv edildi', cls: 'bg-gray-100 text-gray-600' },
};

function ExecutionTable({
  orders,
  workers,
  assignBusy,
  onAssign,
}: {
  orders: ExecOrder[];
  workers: ExecMember[];
  assignBusy: string | null;
  onAssign: (offerId: string, memberId: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <Card variant="default" padding="lg">
        <EmptyState
          icon={<Briefcase size={32} />}
          title="İcra üçün sifariş yoxdur"
          description="Müştəri təklifinizi qəbul etdikdə sifariş burada görünəcək və işçi təyin edə bilərsiniz."
        />
      </Card>
    );
  }
  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-bg text-muted">
            <tr className="text-left">
              <th className="px-4 py-3 font-bold">Sifariş</th>
              <th className="px-4 py-3 font-bold whitespace-nowrap">Məbləğ</th>
              <th className="px-4 py-3 font-bold">İcraçı</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold text-right">Əməliyyat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => (
              <ExecRow
                key={o.offer_id}
                order={o}
                workers={workers}
                busy={assignBusy === o.offer_id}
                onAssign={onAssign}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExecRow({
  order,
  workers,
  busy,
  onAssign,
}: {
  order: ExecOrder;
  workers: ExecMember[];
  busy: boolean;
  onAssign: (offerId: string, memberId: string) => void;
}) {
  const [sel, setSel] = useState('');
  const a = order.assignments[0];
  const completed = order.offer_status === 'completed' || a?.status === 'completed';
  return (
    <tr className="hover:bg-surface-bg/50 align-top">
      <td className="px-4 py-3">
        <div className="font-bold text-ink line-clamp-1">{order.title || 'Sifariş'}</div>
        {order.location && (
          <div className="text-xs text-muted line-clamp-1 inline-flex items-center gap-1">
            <MapPin size={11} /> {order.location}
          </div>
        )}
      </td>
      <td className="px-4 py-3 font-extrabold text-ink whitespace-nowrap">
        {order.amount != null ? `${order.amount} ₼` : '—'}
      </td>
      <td className="px-4 py-3">
        {order.assignments.length > 0 ? (
          <div className="flex flex-col gap-1">
            {order.assignments.map((as) => (
              <span key={as.id} className="inline-flex items-center gap-1 font-bold text-ink">
                <UserCheck size={13} className="text-brand-600" />
                {as.name || 'İşçi'}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted">— təyin olunmayıb</span>
        )}
      </td>
      <td className="px-4 py-3">
        {a ? (
          <span
            className={`inline-flex px-2 py-0.5 rounded-md text-xs font-bold ${
              ASG_STATUS[a.status]?.cls ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {ASG_STATUS[a.status]?.label ?? a.status}
          </span>
        ) : (
          <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-700">
            Gözləyir
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {completed ? (
          <span className="text-emerald-600 font-bold inline-flex items-center gap-1 justify-end w-full">
            <CheckCircle2 size={14} /> Tamam
          </span>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            <select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              className="h-9 rounded-lg border border-border bg-white px-2 text-xs font-medium max-w-[150px]"
            >
              <option value="">İşçi seç…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || 'İşçi'}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={!sel || busy}
              loading={busy}
              onClick={() => onAssign(order.offer_id, sel)}
            >
              {order.assignments.length > 0 ? 'Yenidən' : 'Təyin et'}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tint: 'brand' | 'amber' | 'emerald' | 'violet';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <Card variant="default" padding="md" className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tints[tint]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted font-bold uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-lg font-extrabold text-ink leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-muted truncate">{hint}</p>}
      </div>
    </Card>
  );
}

function OpportunityCard({
  opp,
  active,
  hasLocation,
  categoryLabel,
  existingOffer,
  onActivate,
  onOffer,
}: {
  opp: OpportunityRow;
  active: boolean;
  hasLocation: boolean;
  categoryLabel: string | null;
  existingOffer?: OfferRow;
  onActivate: () => void;
  onOffer: () => void;
}) {
  const dt = new Date(opp.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card
      variant="default"
      padding="md"
      onClick={onActivate}
      className={`cursor-pointer transition-all ${
        active
          ? 'ring-2 ring-brand-500 border-brand-300 shadow-card-lg'
          : 'hover:border-brand-200 hover:shadow-card-lg'
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-extrabold text-ink">
              {opp.title ?? 'Yeni sifariş'}
            </h3>
            {categoryLabel && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-brand-50 text-brand-700">
                {categoryLabel}
              </span>
            )}
            {existingOffer && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                  existingOffer.status === 'accepted'
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                {existingOffer.status === 'accepted'
                  ? 'Qəbul edildi'
                  : `Sizin təklif: ${existingOffer.offer_amount} ₼`}
              </span>
            )}
          </div>
          {opp.description && (
            <p className="text-sm text-muted line-clamp-2 mb-2">
              {opp.description}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            {opp.budget != null && (
              <span className="inline-flex items-center gap-1 font-bold text-brand-700">
                <Wallet size={14} /> Büdcə: {opp.budget} AZN
              </span>
            )}
            {(hasLocation || opp.location) && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {hasLocation ? 'Xəritədə qeyd olunub' : opp.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-muted">
              <Calendar size={14} /> {dt}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          {existingOffer ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-alt text-muted text-sm font-bold cursor-default"
            >
              <CheckCircle2 size={14} /> Təklif verilib
            </button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Send size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                onOffer();
              }}
            >
              Təklif ver
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function PlaceOfferModal({
  brigadeId,
  opp,
  brigadeBalance,
  commissionPct,
  onClose,
  onDone,
}: {
  brigadeId: string;
  opp: OpportunityRow;
  brigadeBalance: number;
  commissionPct: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(opp.budget ? String(opp.budget) : '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = parseFloat(amount) || 0;
  const requiredBalance = (num * commissionPct) / 100;
  const insufficient = requiredBalance > brigadeBalance;

  const handleSubmit = async () => {
    setError(null);
    if (num <= 0) {
      setError('Düzgün məbləğ daxil edin');
      return;
    }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('brigade_place_offer', {
      p_brigade_id: brigadeId,
      p_opportunity_id: opp.id,
      p_amount: num,
      p_notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (rpcErr) {
      if (rpcErr.message.includes('NO_BALANCE')) {
        setError('Briqada balansı yetərli deyil. Əvvəlcə balansı artırın.');
      } else {
        setError(rpcErr.message);
      }
      return;
    }
    message.success('Təklif göndərildi');
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">Briqadadan təklif ver</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-surface-alt rounded-xl p-3">
            <p className="font-extrabold text-ink mb-1">{opp.title}</p>
            {opp.budget != null && (
              <p className="text-sm text-muted">Müştəri büdcəsi: {opp.budget} AZN</p>
            )}
          </div>

          <Field label="Təklif məbləği (₼)" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="Qeyd (istəyə bağlı)">
            <Textarea
              placeholder="İşin müddəti, daxil olan xidmətlər və s."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </Field>

          {num > 0 && (
            <div
              className={`rounded-xl border p-3 text-sm ${
                insufficient
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <div className="flex items-center gap-2">
                {insufficient ? (
                  <Clock size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                <span>
                  Komissiya: <b>{commissionPct}%</b> = <b>{requiredBalance.toFixed(2)} ₼</b>
                </span>
              </div>
              <p className="text-xs mt-1 opacity-80">
                Briqada balansı: <b>{brigadeBalance.toFixed(2)} ₼</b>
                {insufficient && ' — yetərli deyil!'}
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" size="lg" fullWidth onClick={onClose} disabled={submitting}>
              Ləğv et
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleSubmit}
              disabled={num <= 0 || insufficient}
            >
              Təklif ver
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
