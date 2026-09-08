import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Wallet,
  TrendingUp,
  CreditCard,
  Clock,
  Banknote,
  Users,
  Trophy,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────
interface Payment {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled' | string;
  provider: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

interface Txn {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  description: string | null;
  related_id: string | null;
  payment_id: string | null;
  created_at: string;
}

interface Withdrawal {
  id: string;
  provider_id: string;
  amount_requested: number;
  commission_percent: number;
  commission_amount: number;
  net_amount: number;
  bank_card: string | null;
  status: 'pending' | 'processed' | 'rejected' | string;
  requested_at: string;
  processed_at: string | null;
}

interface Profile {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
}

type RangeKey = '7d' | '30d' | '90d' | 'all';
type Tab = 'payments' | 'withdrawals' | 'top_providers' | 'top_customers';

const RANGES: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: '7d', label: 'Son 7 gün', days: 7 },
  { key: '30d', label: 'Son 30 gün', days: 30 },
  { key: '90d', label: 'Son 90 gün', days: 90 },
  { key: 'all', label: 'Hamısı', days: null },
];

function fmtMoney(n: number, decimals = 2): string {
  return new Intl.NumberFormat('az-AZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('az', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [tab, setTab] = useState<Tab>('payments');

  useEffect(() => {
    void load();
  }, [range]);

  async function load() {
    setLoading(true);
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const fromIso =
      days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;

    const baseFilter = (q: ReturnType<typeof supabase.from>) =>
      fromIso ? q.gte('created_at', fromIso) : q;

    // QEYD: .limit(10000) müvəqqəti hədd artırmasıdır — düzgün həll server tərəfdə
    // aqreqasiyadır (RPC/view ilə cəmləri DB-də hesablamaq).
    const [pRes, tRes, wRes] = await Promise.all([
      baseFilter(
        supabase
          .from('payments')
          .select(
            'id, user_id, amount, currency, status, provider, description, metadata, created_at, completed_at',
          )
          .order('created_at', { ascending: false })
          .limit(10000),
      ),
      baseFilter(
        supabase
          .from('transactions')
          .select('id, user_id, type, amount, description, related_id, payment_id, created_at')
          .order('created_at', { ascending: false })
          .limit(10000),
      ),
      (fromIso
        ? supabase
            .from('withdrawals')
            .select(
              'id, provider_id, amount_requested, commission_percent, commission_amount, net_amount, bank_card, status, requested_at, processed_at',
            )
            .gte('requested_at', fromIso)
            .order('requested_at', { ascending: false })
            .limit(10000)
        : supabase
            .from('withdrawals')
            .select(
              'id, provider_id, amount_requested, commission_percent, commission_amount, net_amount, bank_card, status, requested_at, processed_at',
            )
            .order('requested_at', { ascending: false })
            .limit(10000)),
    ]);

    const payList = (pRes.data ?? []) as Payment[];
    const txList = (tRes.data ?? []) as Txn[];
    const wdList = (wRes.data ?? []) as Withdrawal[];

    setPayments(payList);
    setTransactions(txList);
    setWithdrawals(wdList);

    const userIds = Array.from(
      new Set<string>([
        ...payList.map((p) => p.user_id),
        ...txList.map((t) => t.user_id),
        ...wdList.map((w) => w.provider_id),
      ].filter(Boolean)),
    );
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, name, phone_number, email')
        .in('id', userIds);
      const map: Record<string, Profile> = {};
      for (const p of (profs ?? []) as Profile[]) map[p.id] = p;
      setProfiles(map);
    }
    setLoading(false);
  }

  // ─── Aggregates ───────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const completedPayments = payments.filter((p) => p.status === 'completed');
    const gmv = completedPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Accept commission: payment.amount - corresponding escrow_lock.amount
    const lockByPayment = new Map<string, number>();
    const lockByOffer = new Map<string, number>();
    const releaseByOffer = new Map<string, number>();
    for (const t of transactions) {
      if (t.type === 'escrow_lock' && t.payment_id) {
        lockByPayment.set(t.payment_id, Number(t.amount));
      }
      if (t.type === 'escrow_lock' && t.related_id) {
        lockByOffer.set(t.related_id, Number(t.amount));
      }
      if (t.type === 'escrow_release' && t.related_id) {
        releaseByOffer.set(t.related_id, Number(t.amount));
      }
    }
    let acceptCommission = 0;
    for (const p of completedPayments) {
      const purpose = (p.metadata?.purpose as string | undefined) ?? '';
      if (purpose === 'service_payment') {
        const locked = lockByPayment.get(p.id) ?? Number(p.amount);
        acceptCommission += Number(p.amount) - locked;
      }
    }

    let completeCommission = 0;
    for (const [offerId, locked] of lockByOffer) {
      const released = releaseByOffer.get(offerId);
      if (released != null) {
        completeCommission += locked - released;
      }
    }

    // Yalnız icra olunmuş (processed) çıxarışların komissiyası gəlir sayılır
    const withdrawalCommission = withdrawals
      .filter((w) => w.status === 'processed')
      .reduce((s, w) => s + Number(w.commission_amount), 0);

    const platformRevenue = acceptCommission + completeCommission + withdrawalCommission;

    const pendingWithdrawalsAmount = withdrawals
      .filter((w) => w.status === 'pending')
      .reduce((s, w) => s + Number(w.amount_requested), 0);
    const pendingWithdrawalsCount = withdrawals.filter((w) => w.status === 'pending').length;

    return {
      gmv,
      platformRevenue,
      acceptCommission,
      completeCommission,
      withdrawalCommission,
      completedPaymentsCount: completedPayments.length,
      avgTicket: completedPayments.length > 0 ? gmv / completedPayments.length : 0,
      pendingWithdrawalsAmount,
      pendingWithdrawalsCount,
      uniquePayers: new Set(completedPayments.map((p) => p.user_id)).size,
    };
  }, [payments, transactions, withdrawals]);

  const dailySeries = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    const bucketCount = Math.min(days, 30);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buckets: Array<{ date: Date; gmv: number; revenue: number }> = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({ date: d, gmv: 0, revenue: 0 });
    }
    const bucketOf = (iso: string) => {
      const t = new Date(iso);
      t.setHours(0, 0, 0, 0);
      const diff = Math.floor((now.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
      if (diff < 0 || diff >= bucketCount) return -1;
      return bucketCount - 1 - diff;
    };
    for (const p of payments) {
      if (p.status !== 'completed' || !p.completed_at) continue;
      const idx = bucketOf(p.completed_at);
      if (idx >= 0) buckets[idx].gmv += Number(p.amount);
    }
    // Daily revenue: approximate by counting accept commissions per day from transactions
    const lockByPaymentId = new Map<string, number>();
    for (const t of transactions) {
      if (t.type === 'escrow_lock' && t.payment_id) {
        lockByPaymentId.set(t.payment_id, Number(t.amount));
      }
    }
    for (const p of payments) {
      if (p.status !== 'completed' || !p.completed_at) continue;
      const purpose = (p.metadata?.purpose as string | undefined) ?? '';
      if (purpose !== 'service_payment') continue;
      const idx = bucketOf(p.completed_at);
      if (idx < 0) continue;
      const locked = lockByPaymentId.get(p.id) ?? Number(p.amount);
      buckets[idx].revenue += Number(p.amount) - locked;
    }
    for (const w of withdrawals) {
      if (w.status !== 'processed') continue;
      const idx = bucketOf(w.requested_at);
      if (idx < 0) continue;
      buckets[idx].revenue += Number(w.commission_amount);
    }
    return buckets;
  }, [payments, transactions, withdrawals, range]);

  const topProviders = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of transactions) {
      if (t.type !== 'escrow_release') continue;
      const cur = map.get(t.user_id) ?? { total: 0, count: 0 };
      cur.total += Number(t.amount);
      cur.count += 1;
      map.set(t.user_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [transactions]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const p of payments) {
      if (p.status !== 'completed') continue;
      const cur = map.get(p.user_id) ?? { total: 0, count: 0 };
      cur.total += Number(p.amount);
      cur.count += 1;
      map.set(p.user_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [payments]);

  function exportCsv() {
    const rows: string[] = [];
    rows.push(['ID', 'Tarix', 'İstifadəçi', 'Tip', 'Məbləğ ₼', 'Status', 'Açıqlama'].join(','));
    for (const p of payments) {
      const u = profiles[p.user_id];
      rows.push(
        [
          p.id,
          fmtDateTime(p.created_at),
          (u?.name ?? p.user_id).replace(/,/g, ' '),
          'payment',
          p.amount.toString(),
          p.status,
          (
            (p.description ?? '') +
            (isFailedStatus(p.status) && paymentFailureReason(p.metadata)
              ? ` — Səbəb: ${paymentFailureReason(p.metadata)}`
              : '')
          ).replace(/[\n,]/g, ' '),
        ].join(','),
      );
    }
    for (const w of withdrawals) {
      const u = profiles[w.provider_id];
      rows.push(
        [
          w.id,
          fmtDateTime(w.requested_at),
          (u?.name ?? w.provider_id).replace(/,/g, ' '),
          'withdrawal',
          (-w.amount_requested).toString(),
          w.status,
          `Komissiya: ${w.commission_amount} ₼ → Net: ${w.net_amount} ₼`,
        ].join(','),
      );
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ellit-hesabat-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header / Range */}
      <div className="bg-white border border-border rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-ink">Gəlir hesabatı</h2>
          <p className="text-xs text-muted">
            Bütün platforma əməliyyatlarının tam mənzərəsi
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-colors ${
                range === r.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-ink-soft border-border hover:border-brand-300'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading}
            className="ml-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold bg-ink text-white hover:bg-ink/90 disabled:opacity-50"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Toplam dövriyyə (GMV)"
          value={loading ? '…' : `${fmtMoney(metrics.gmv, 0)} ₼`}
          hint={`${metrics.completedPaymentsCount} uğurlu ödəniş`}
          icon={<Banknote size={18} />}
          tint="brand"
        />
        <KpiCard
          label="Platform geliri"
          value={loading ? '…' : `${fmtMoney(metrics.platformRevenue, 2)} ₼`}
          hint={`Ortalama: ${fmtMoney(metrics.avgTicket, 0)} ₼ / sifariş`}
          icon={<TrendingUp size={18} />}
          tint="emerald"
        />
        <KpiCard
          label="Unikal müştəri"
          value={loading ? '…' : metrics.uniquePayers}
          hint="Ödəniş etmiş istifadəçilər"
          icon={<Users size={18} />}
          tint="violet"
        />
        <KpiCard
          label="Gözləyən çıxarış"
          value={loading ? '…' : `${fmtMoney(metrics.pendingWithdrawalsAmount, 0)} ₼`}
          hint={`${metrics.pendingWithdrawalsCount} sorğu`}
          icon={<Clock size={18} />}
          tint="amber"
        />
      </div>

      {/* Revenue breakdown */}
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-extrabold text-ink">Gəlir mənbələri</h3>
            <p className="text-xs text-muted">Üç komissiya mərhələsi üzrə bölgü</p>
          </div>
          <span className="text-xs font-bold text-muted">
            Cəm: {fmtMoney(metrics.platformRevenue, 2)} ₼
          </span>
        </div>
        <RevenueBreakdownBar
          accept={metrics.acceptCommission}
          complete={metrics.completeCommission}
          withdrawal={metrics.withdrawalCommission}
        />
      </div>

      {/* Daily revenue chart */}
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-extrabold text-ink">Günlük dinamika</h3>
            <p className="text-xs text-muted">
              Gündəlik GMV (mavi) və platform geliri (yaşıl)
            </p>
          </div>
        </div>
        <DailyChart data={dailySeries} />
      </div>

      {/* Tabs */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="border-b border-border flex overflow-x-auto">
          <TabBtn active={tab === 'payments'} onClick={() => setTab('payments')} icon={<CreditCard size={14} />}>
            Ödənişlər ({payments.length})
          </TabBtn>
          <TabBtn active={tab === 'withdrawals'} onClick={() => setTab('withdrawals')} icon={<Wallet size={14} />}>
            Çıxarışlar ({withdrawals.length})
          </TabBtn>
          <TabBtn active={tab === 'top_providers'} onClick={() => setTab('top_providers')} icon={<Trophy size={14} />}>
            Ən çox qazanan provayderlər
          </TabBtn>
          <TabBtn active={tab === 'top_customers'} onClick={() => setTab('top_customers')} icon={<Activity size={14} />}>
            Ən çox xərcləyən müştərilər
          </TabBtn>
        </div>

        <div className="p-4 sm:p-5">
          {tab === 'payments' && <PaymentsTable rows={payments} profiles={profiles} loading={loading} />}
          {tab === 'withdrawals' && (
            <WithdrawalsTable rows={withdrawals} profiles={profiles} loading={loading} />
          )}
          {tab === 'top_providers' && (
            <TopList rows={topProviders} profiles={profiles} loading={loading} unit="qazanc" />
          )}
          {tab === 'top_customers' && (
            <TopList rows={topCustomers} profiles={profiles} loading={loading} unit="xərc" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  hint,
  icon,
  tint,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  tint: 'brand' | 'emerald' | 'violet' | 'amber';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white border border-border rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tints[tint]}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-extrabold text-ink mt-2">{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

function RevenueBreakdownBar({
  accept,
  complete,
  withdrawal,
}: {
  accept: number;
  complete: number;
  withdrawal: number;
}) {
  const total = Math.max(accept + complete + withdrawal, 0.0001);
  const a = (accept / total) * 100;
  const c = (complete / total) * 100;
  const w = (withdrawal / total) * 100;
  return (
    <div>
      <div className="h-3 rounded-full overflow-hidden flex bg-surface-alt">
        <div className="bg-emerald-500" style={{ width: `${a}%` }} title={`Qəbul: ${accept}`} />
        <div className="bg-brand-500" style={{ width: `${c}%` }} title={`Tamamlanma: ${complete}`} />
        <div className="bg-amber-500" style={{ width: `${w}%` }} title={`Nağdlaşdırma: ${withdrawal}`} />
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <LegendItem dot="bg-emerald-500" label="Qəbul komissiyası" value={accept} percent={a} />
        <LegendItem dot="bg-brand-500" label="Tamamlanma komissiyası" value={complete} percent={c} />
        <LegendItem dot="bg-amber-500" label="Nağdlaşdırma komissiyası" value={withdrawal} percent={w} />
      </div>
    </div>
  );
}

function LegendItem({
  dot,
  label,
  value,
  percent,
}: {
  dot: string;
  label: string;
  value: number;
  percent: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-alt">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs font-bold text-ink-soft truncate">{label}</span>
      </div>
      <div className="text-right shrink-0">
        <p className="font-extrabold text-ink text-sm">{fmtMoney(value, 2)} ₼</p>
        <p className="text-xs text-muted">{percent.toFixed(1)}%</p>
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: Array<{ date: Date; gmv: number; revenue: number }> }) {
  const maxGmv = Math.max(1, ...data.map((d) => d.gmv));
  return (
    <div>
      <div className="flex items-end gap-1 h-40 px-1">
        {data.map((d, i) => {
          const gmvH = (d.gmv / maxGmv) * 100;
          const revH = (d.revenue / maxGmv) * 100;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col-reverse items-stretch gap-0.5 group relative"
              title={`${d.date.toLocaleDateString('az')}\nGMV: ${fmtMoney(d.gmv)} ₼\nGelir: ${fmtMoney(d.revenue)} ₼`}
            >
              <div
                className="bg-brand-500 rounded-sm transition-all group-hover:bg-brand-600"
                style={{ height: `${Math.max(gmvH, d.gmv > 0 ? 4 : 0)}%` }}
              />
              <div
                className="bg-emerald-500 rounded-sm transition-all group-hover:bg-emerald-600"
                style={{ height: `${Math.max(revH, d.revenue > 0 ? 2 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-muted px-1">
        <span>{fmtDate(data[0]?.date.toISOString())}</span>
        <span>{fmtDate(data[Math.floor(data.length / 2)]?.date.toISOString())}</span>
        <span>{fmtDate(data[data.length - 1]?.date.toISOString())}</span>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-ink-soft hover:text-ink hover:bg-surface-alt'
      }`}
    >
      {icon} {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
    refunded: 'bg-violet-50 text-violet-700 border-violet-200',
    processed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const cls = map[status] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  const Icon =
    status === 'completed' || status === 'processed'
      ? CheckCircle2
      : status === 'pending'
        ? Clock
        : status === 'failed' || status === 'rejected' || status === 'cancelled'
          ? XCircle
          : Activity;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${cls}`}>
      <Icon size={12} /> {status}
    </span>
  );
}

/** epoint xəta mesajını oxunaqlı AZ səbəbə çevirir. */
function friendlyReason(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('merchant not active')) return 'Merchant aktiv deyil (epoint hesabı)';
  if (s.includes('timeout')) return 'Vaxt bitdi (timeout)';
  if (s.includes('insufficient')) return 'Kartda vəsait kifayət etmir';
  if (s.includes('expired')) return 'Kartın vaxtı bitib';
  if (s.includes('declined') || s.includes('rejected')) return 'Bank rədd etdi';
  if (s.includes('cancel')) return 'Ləğv edildi';
  if (s.includes('error processing')) return 'Ödəniş emalında xəta';
  if (s.includes('3d') && s.includes('fail')) return '3D-Secure uğursuz';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Uğursuz ödənişin səbəbini metadata-dan çıxarır (epoint_error / epoint_payload). */
function paymentFailureReason(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const m = metadata as Record<string, unknown>;
  const err = m.epoint_error as { message?: unknown } | undefined;
  if (err && typeof err.message === 'string' && err.message.trim()) {
    return friendlyReason(err.message);
  }
  const pay = m.epoint_payload as { message?: unknown; bank_response?: unknown } | undefined;
  if (pay && typeof pay === 'object') {
    const parts: string[] = [];
    if (typeof pay.message === 'string' && pay.message.trim()) parts.push(friendlyReason(pay.message));
    if (typeof pay.bank_response === 'string' && pay.bank_response.trim()) {
      const br = friendlyReason(pay.bank_response);
      if (!parts.some((p) => p.toLowerCase() === br.toLowerCase())) parts.push(br);
    }
    if (parts.length) return parts.join(' · ');
  }
  return null;
}

const isFailedStatus = (s: string) =>
  ['failed', 'error', 'declined', 'cancelled', 'canceled'].includes((s ?? '').toLowerCase());

function PaymentsTable({
  rows,
  profiles,
  loading,
}: {
  rows: Payment[];
  profiles: Record<string, Profile>;
  loading: boolean;
}) {
  if (loading) return <p className="py-8 text-center text-muted">Yüklənir...</p>;
  if (rows.length === 0)
    return <p className="py-8 text-center text-muted">Bu dövrdə ödəniş yoxdur</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-bold text-muted uppercase tracking-wide">
            <th className="py-2 px-3">Tarix</th>
            <th className="py-2 px-3">İstifadəçi</th>
            <th className="py-2 px-3">Məbləğ</th>
            <th className="py-2 px-3">Məqsəd</th>
            <th className="py-2 px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((p) => {
            const u = profiles[p.user_id];
            const purpose = (p.metadata?.purpose as string | undefined) ?? 'balance_topup';
            const reason = isFailedStatus(p.status) ? paymentFailureReason(p.metadata) : null;
            return (
              <tr key={p.id} className="border-t border-border hover:bg-surface-alt align-top">
                <td className="py-3 px-3 text-muted whitespace-nowrap">{fmtDateTime(p.created_at)}</td>
                <td className="py-3 px-3">
                  <div className="font-bold text-ink truncate max-w-[180px]">{u?.name ?? '—'}</div>
                  <div className="text-xs text-muted truncate max-w-[180px]">
                    {u?.phone_number ?? u?.email ?? p.user_id.slice(0, 8)}
                  </div>
                </td>
                <td className="py-3 px-3 font-extrabold text-ink whitespace-nowrap">
                  {fmtMoney(p.amount)} {p.currency}
                </td>
                <td className="py-3 px-3 text-ink-soft text-xs">
                  {purpose === 'service_payment'
                    ? 'Sifariş ödənişi'
                    : purpose === 'service_promotion'
                      ? 'Xidmət təşviqi'
                      : 'Balans yüklənməsi'}
                </td>
                <td className="py-3 px-3">
                  <StatusPill status={p.status} />
                  {reason && (
                    <div
                      className="mt-1 flex items-start gap-1 text-[11px] text-rose-600 max-w-[240px] leading-snug"
                      title={reason}
                    >
                      <AlertTriangle size={12} className="mt-px shrink-0" />
                      <span>{reason}</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 50 && (
        <p className="text-xs text-muted mt-3 text-center">
          İlk 50 sətr göstərilir. Hamısı üçün CSV export et.
        </p>
      )}
    </div>
  );
}

function WithdrawalsTable({
  rows,
  profiles,
  loading,
}: {
  rows: Withdrawal[];
  profiles: Record<string, Profile>;
  loading: boolean;
}) {
  if (loading) return <p className="py-8 text-center text-muted">Yüklənir...</p>;
  if (rows.length === 0)
    return <p className="py-8 text-center text-muted">Bu dövrdə çıxarış sorğusu yoxdur</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-bold text-muted uppercase tracking-wide">
            <th className="py-2 px-3">Tarix</th>
            <th className="py-2 px-3">Provayder</th>
            <th className="py-2 px-3">Tələb</th>
            <th className="py-2 px-3">Komissiya</th>
            <th className="py-2 px-3">Net</th>
            <th className="py-2 px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((w) => {
            const u = profiles[w.provider_id];
            return (
              <tr key={w.id} className="border-t border-border hover:bg-surface-alt">
                <td className="py-3 px-3 text-muted whitespace-nowrap">{fmtDateTime(w.requested_at)}</td>
                <td className="py-3 px-3">
                  <div className="font-bold text-ink truncate max-w-[180px]">{u?.name ?? '—'}</div>
                  <div className="text-xs text-muted truncate max-w-[180px]">
                    {u?.phone_number ?? u?.email ?? w.provider_id.slice(0, 8)}
                  </div>
                </td>
                <td className="py-3 px-3 font-extrabold text-ink whitespace-nowrap">
                  {fmtMoney(w.amount_requested)} ₼
                </td>
                <td className="py-3 px-3 text-ink-soft whitespace-nowrap">
                  {fmtMoney(w.commission_amount)} ₼
                  <span className="text-xs text-muted ml-1">({w.commission_percent}%)</span>
                </td>
                <td className="py-3 px-3 font-bold text-emerald-700 whitespace-nowrap">
                  {fmtMoney(w.net_amount)} ₼
                </td>
                <td className="py-3 px-3">
                  <StatusPill status={w.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TopList({
  rows,
  profiles,
  loading,
  unit,
}: {
  rows: Array<{ id: string; total: number; count: number }>;
  profiles: Record<string, Profile>;
  loading: boolean;
  unit: 'qazanc' | 'xərc';
}) {
  if (loading) return <p className="py-8 text-center text-muted">Yüklənir...</p>;
  if (rows.length === 0) return <p className="py-8 text-center text-muted">Verilən yoxdur</p>;
  const max = rows[0]?.total ?? 1;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const u = profiles[r.id];
        const pct = (r.total / max) * 100;
        return (
          <div key={r.id} className="p-3 rounded-xl bg-surface-alt">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-extrabold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-ink text-sm truncate">{u?.name ?? '—'}</p>
                  <p className="text-xs text-muted truncate">
                    {u?.phone_number ?? u?.email ?? r.id.slice(0, 8)} · {r.count} {unit === 'qazanc' ? 'iş' : 'ödəniş'}
                  </p>
                </div>
              </div>
              <p className="font-extrabold text-ink text-sm whitespace-nowrap">
                {fmtMoney(r.total)} ₼
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full ${unit === 'qazanc' ? 'bg-emerald-500' : 'bg-brand-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
