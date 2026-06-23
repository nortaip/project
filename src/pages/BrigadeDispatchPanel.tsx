import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import {
  Banknote,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Maximize2,
  MapPin,
  Send,
  UserCheck,
  UserPlus,
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
  /** Tam ekran rejimində render olunursa "Tam ekran" düyməsi gizlədilir */
  fullscreen?: boolean;
}

export default function BrigadeDispatchPanel({
  brigadeId,
  brigadeCategories,
  brigadeBalance,
  fullscreen = false,
}: Props) {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [myOffers, setMyOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionPct, setCommissionPct] = useState(0);
  const [offerOpp, setOfferOpp] = useState<OpportunityRow | null>(null);
  const [assignOpp, setAssignOpp] = useState<OpportunityRow | null>(null);
  // Bu briqadanın artıq işçiyə yönləndirdiyi açıq sifarişlər (RLS yalnız öz
  // briqadasının assignment-larını göstərir) → buton "Yönləndirilib" olur.
  const [dispatchedOppIds, setDispatchedOppIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'open' | 'execution'>('open');
  const [showMap, setShowMap] = useState(false);
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

      // Kateqoriyanı həm label, həm id üzrə uyğunlaşdır (data yazılışından
      // asılı olmasın deyə). Uyğun tapılmasa boş massiv → aşağıda BÜTÜN açıq
      // sifarişlər göstərilir ki, yeni sifariş komandadan gizli qalmasın.
      const matchingCatIds = allCategories
        .filter((c) =>
          brigadeCategories.some(
            (bc) =>
              bc.toLowerCase() === c.label.toLowerCase() || bc === c.id,
          ),
        )
        .map((c) => c.id);

      // 3. Açıq sifarişlər — kateqoriya uyğunluğu varsa filtrlə, yoxsa hamısı
      let oppQuery = supabase
        .from('opportunities')
        .select(
          'id, title, description, location, date, status, budget, category_id, created_at',
        )
        .in('status', ['pending', 'open', 'new', 'active'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (matchingCatIds.length > 0) {
        oppQuery = oppQuery.in('category_id', matchingCatIds);
      }
      const { data: oppData } = await oppQuery;
      setOpportunities((oppData ?? []) as OpportunityRow[]);

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
      const dispatched = new Set<string>();
      for (const a of (asgRows ?? []) as Array<Record<string, unknown>>) {
        const sid = String(a.source_id);
        const st = String(a.status);
        // Açıq sifariş üçün source_id = opportunity_id — aktiv yönləndirmələri izlə
        if (['offered', 'assigned', 'accepted', 'in_progress'].includes(st)) {
          dispatched.add(sid);
        }
        const name =
          ((a.member as { profile?: { name?: string } } | null)?.profile?.name) ?? null;
        (asgByOffer[sid] ??= []).push({
          id: String(a.id),
          member_id: String(a.member_id),
          status: st,
          completed_at: (a.completed_at as string | null) ?? null,
          name,
        });
      }
      setDispatchedOppIds(dispatched);

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

  const dispatchOrder = async (
    opp: OpportunityRow,
    memberId: string,
    method: 'cash' | 'card',
    notes: string,
  ) => {
    const { error } = await supabase.rpc('brigade_dispatch_assign', {
      p_brigade_id: brigadeId,
      p_opportunity_id: opp.id,
      p_member_id: memberId,
      p_method: method,
      p_notes: notes.trim() || null,
    });
    if (error) {
      // Server-side qoruma: sifariş artıq başqasına bağlıdırsa
      if (error.message.includes('ALREADY_TAKEN')) {
        throw new Error('Bu sifariş artıq başqasına bağlanıb — başqa işçi/briqada götürüb.');
      }
      if (error.message.includes('NO_BALANCE')) {
        throw new Error('Briqada balansı komissiya üçün yetərli deyil. Əvvəlcə balansı artırın.');
      }
      throw new Error(error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {!fullscreen && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={() => navigate(`/brigades/${brigadeId}/dispatch`)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-brand-600 text-white hover:bg-brand-700 text-sm font-bold transition-colors"
          >
            <Maximize2 size={14} /> Tam ekran panel
          </button>
        </div>
      )}

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
        <div className="space-y-3">
          {/* Xəritə toggle */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-surface-bg text-ink-soft hover:bg-border text-sm font-bold transition-colors"
            >
              <MapPin size={14} />
              {showMap ? 'Xəritəni gizlə' : 'Xəritə'}
            </button>
          </div>

          {showMap && mapPoints.length > 0 && (
            <OpportunitiesMap
              points={mapPoints}
              activeId={activeId}
              onSelect={setActiveId}
              className="h-[360px] rounded-3xl overflow-hidden border border-border shadow-card"
            />
          )}

          {/* Admin cədvəl */}
          <OpenOrdersTable
            opportunities={opportunities}
            activeId={activeId}
            categoryById={categoryById}
            offeredOppIds={offeredOppIds}
            dispatchedOppIds={dispatchedOppIds}
            hasWorkers={workers.length > 0}
            onActivate={setActiveId}
            onOffer={setOfferOpp}
            onAssign={setAssignOpp}
          />
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

      {assignOpp && (
        <AssignWorkerModal
          opp={assignOpp}
          workers={workers}
          brigadeBalance={brigadeBalance}
          commissionPct={commissionPct}
          onSubmit={(memberId, method, notes) =>
            dispatchOrder(assignOpp, memberId, method, notes)
          }
          onClose={() => setAssignOpp(null)}
          onDone={async () => {
            setAssignOpp(null);
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

function OpenOrdersTable({
  opportunities,
  activeId,
  categoryById,
  offeredOppIds,
  dispatchedOppIds,
  hasWorkers,
  onActivate,
  onOffer,
  onAssign,
}: {
  opportunities: OpportunityRow[];
  activeId: string | null;
  categoryById: Record<string, string>;
  offeredOppIds: Record<string, OfferRow>;
  dispatchedOppIds: Set<string>;
  hasWorkers: boolean;
  onActivate: (id: string) => void;
  onOffer: (opp: OpportunityRow) => void;
  onAssign: (opp: OpportunityRow) => void;
}) {
  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-bg text-muted">
            <tr className="text-left">
              <th className="px-4 py-3 font-bold">Sifariş</th>
              <th className="px-4 py-3 font-bold">Kateqoriya</th>
              <th className="px-4 py-3 font-bold whitespace-nowrap">Büdcə</th>
              <th className="px-4 py-3 font-bold whitespace-nowrap">Tarix</th>
              <th className="px-4 py-3 font-bold text-right">Əməliyyat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {opportunities.map((opp) => (
              <OpenRow
                key={opp.id}
                opp={opp}
                active={opp.id === activeId}
                categoryLabel={opp.category_id ? categoryById[opp.category_id] : null}
                existing={offeredOppIds[opp.id]}
                dispatched={dispatchedOppIds.has(opp.id)}
                hasWorkers={hasWorkers}
                onActivate={() => onActivate(opp.id)}
                onOffer={() => onOffer(opp)}
                onAssign={() => onAssign(opp)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OpenRow({
  opp,
  active,
  categoryLabel,
  existing,
  dispatched,
  hasWorkers,
  onActivate,
  onOffer,
  onAssign,
}: {
  opp: OpportunityRow;
  active: boolean;
  categoryLabel: string | null;
  existing?: OfferRow;
  dispatched: boolean;
  hasWorkers: boolean;
  onActivate: () => void;
  onOffer: () => void;
  onAssign: () => void;
}) {
  const coords = parseCoords(opp.location);
  return (
    <tr
      onClick={onActivate}
      className={`cursor-pointer align-top transition-colors ${
        active ? 'bg-brand-50' : 'hover:bg-surface-bg/60'
      }`}
    >
      <td className="px-4 py-3">
        <div className="font-bold text-ink line-clamp-1">{opp.title || 'Yeni sifariş'}</div>
        <div className="text-xs text-muted inline-flex items-center gap-1 line-clamp-1">
          <MapPin size={11} /> {coords ? 'Xəritədə qeyd olunub' : opp.location || '—'}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-xs font-bold">
          {categoryLabel || '—'}
        </span>
      </td>
      <td className="px-4 py-3 font-extrabold text-ink whitespace-nowrap">
        {opp.budget != null ? `${opp.budget} ₼` : '—'}
      </td>
      <td className="px-4 py-3 text-muted whitespace-nowrap text-xs">
        <span className="inline-flex items-center gap-1">
          <Calendar size={11} />
          {new Date(opp.created_at).toLocaleDateString('az', {
            day: '2-digit',
            month: 'short',
          })}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-2 justify-end">
          {dispatched ? (
            <span className="inline-flex px-2 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700">
              <UserCheck size={13} className="mr-1" /> Yönləndirilib
            </span>
          ) : (
            <Button
              size="sm"
              variant="primary"
              leftIcon={<UserPlus size={14} />}
              disabled={!hasWorkers}
              title={hasWorkers ? undefined : 'Əvvəlcə komandaya işçi əlavə edin'}
              onClick={(e) => {
                e.stopPropagation();
                onAssign();
              }}
            >
              Yönləndir
            </Button>
          )}
          {existing ? (
            <span
              className={`inline-flex px-2 py-1 rounded-lg text-xs font-bold ${
                existing.status === 'accepted'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {existing.status === 'accepted'
                ? 'Qəbul edildi'
                : `Təklif: ${existing.offer_amount} ₼`}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Send size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                onOffer();
              }}
            >
              Təklif
            </Button>
          )}
        </div>
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

// ── İşçiyə yönləndir modalı ────────────────────────────────────────────────

function AssignWorkerModal({
  opp,
  workers,
  brigadeBalance,
  commissionPct,
  onSubmit,
  onClose,
  onDone,
}: {
  opp: OpportunityRow;
  workers: ExecMember[];
  brigadeBalance: number;
  commissionPct: number;
  onSubmit: (memberId: string, method: 'cash' | 'card', notes: string) => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [memberId, setMemberId] = useState(workers[0]?.id ?? '');
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commission = ((opp.budget ?? 0) * commissionPct) / 100;
  const insufficient = commission > brigadeBalance;

  const handleSubmit = async () => {
    setError(null);
    if (!memberId) {
      setError('İşçi seçin');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(memberId, method, notes);
      message.success('Sifariş işçiyə yönləndirildi');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">İşçiyə yönləndir</h2>
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
            <p className="font-extrabold text-ink mb-1">{opp.title || 'Yeni sifariş'}</p>
            {opp.budget != null && (
              <p className="text-sm text-muted">Müştəri büdcəsi: {opp.budget} AZN</p>
            )}
          </div>

          <Field label="İşçi" required>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
            >
              <option value="">İşçi seç…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || 'İşçi'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ödəniş üsulu" required>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod('cash')}
                className={`flex items-center justify-center gap-2 h-12 rounded-2xl border-[1.5px] font-bold text-sm transition-colors ${
                  method === 'cash'
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-border bg-surface-alt text-muted hover:text-ink'
                }`}
              >
                <Banknote size={16} /> Nağd
              </button>
              <button
                type="button"
                onClick={() => setMethod('card')}
                className={`flex items-center justify-center gap-2 h-12 rounded-2xl border-[1.5px] font-bold text-sm transition-colors ${
                  method === 'card'
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-border bg-surface-alt text-muted hover:text-ink'
                }`}
              >
                <CreditCard size={16} /> Kart
              </button>
            </div>
          </Field>

          <Field label="Qeyd (istəyə bağlı)">
            <Textarea
              placeholder="İşçiyə qeyd: vaxt, ünvan detalı və s."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </Field>

          <div
            className={`rounded-xl border p-3 text-sm ${
              insufficient
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            <div className="flex items-center gap-2">
              {insufficient ? <Clock size={14} /> : <CheckCircle2 size={14} />}
              <span>
                Komissiya rezervi: <b>{commissionPct}%</b> = <b>{commission.toFixed(2)} ₼</b>
              </span>
            </div>
            <p className="text-xs mt-1 opacity-80">
              Briqada balansı: <b>{brigadeBalance.toFixed(2)} ₼</b>
              {insufficient && ' — yetərli deyil!'}
            </p>
            <p className="text-xs mt-1 opacity-80">
              İşçi imtina etsə və ya sifarişi başqası götürsə, rezerv geri qaytarılır.
            </p>
          </div>

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
              disabled={!memberId || insufficient}
            >
              Yönləndir
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
