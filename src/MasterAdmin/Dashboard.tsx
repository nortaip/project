import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Activity as ActivityIcon,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Building2,
  Clock,
  CreditCard,
  Percent,
  RefreshCw,
  ShieldCheck,
  Sparkle,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';
import PasswordManagerCard from './PasswordManagerCard';

// ────────────────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────────────────
interface Stats {
  totalUsers: number;
  newUsers7d: number;
  totalProviders: number;
  totalBookings: number;
  pendingBookings: number;
  completedBookings: number;
  totalBrigades: number;
  activeOpportunities: number;
  totalOpportunities: number;
}

interface RevenueMetrics {
  gmv7d: number;
  gmv30d: number;
  platformRevenue30d: number;
  acceptCommission: number;
  completeCommission: number;
  withdrawalCommission: number;
  pendingWithdrawalsAmount: number;
  pendingWithdrawalsCount: number;
  completedPayments30d: number;
  daily: Array<{ date: Date; gmv: number; revenue: number }>;
}

interface RecentActivity {
  id: string;
  action: string;
  target_id: string | null;
  target_type: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor: string | null;
  actor_id: string | null;
  actor_profile?: { name: string | null; email: string | null } | null;
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────
function fmtMoney(n: number, decimals = 0): string {
  return new Intl.NumberFormat('az-AZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'indi';
  if (m < 60) return `${m} dəq əvvəl`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} saat əvvəl`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} gün əvvəl`;
  return new Date(iso).toLocaleDateString('az', {
    day: '2-digit',
    month: 'short',
  });
}

function todayGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Sakit gecə';
  if (h < 12) return 'Sabahınız xeyir';
  if (h < 18) return 'Günortanız xeyir';
  return 'Axşamınız xeyir';
}

// ────────────────────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    newUsers7d: 0,
    totalProviders: 0,
    totalBookings: 0,
    pendingBookings: 0,
    completedBookings: 0,
    totalBrigades: 0,
    activeOpportunities: 0,
    totalOpportunities: 0,
  });
  const [revenue, setRevenue] = useState<RevenueMetrics>({
    gmv7d: 0,
    gmv30d: 0,
    platformRevenue30d: 0,
    acceptCommission: 0,
    completeCommission: 0,
    withdrawalCommission: 0,
    pendingWithdrawalsAmount: 0,
    pendingWithdrawalsCount: 0,
    completedPayments30d: 0,
    daily: [],
  });
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      // Tək RPC çağırışı 13+ ayrı sorğunu əvəz edir (server-tərəfində aqreqasiya)
      const [statsRes, dailyRes, audit] = await Promise.all([
        supabase.rpc('admin_dashboard_stats'),
        supabase.rpc('admin_dashboard_daily', { p_days: 14 }),
        supabase
          .from('audit_log')
          .select('id, action, target_id, target_type, payload, created_at, actor, actor_id')
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const s = (statsRes.data ?? {}) as Record<string, number>;
      setStats({
        totalUsers: s.totalUsers ?? 0,
        newUsers7d: s.newUsers7d ?? 0,
        totalProviders: s.totalProviders ?? 0,
        totalBookings: s.totalBookings ?? 0,
        pendingBookings: s.pendingBookings ?? 0,
        completedBookings: s.completedBookings ?? 0,
        totalBrigades: s.totalBrigades ?? 0,
        activeOpportunities: s.activeOpportunities ?? 0,
        totalOpportunities: s.totalOpportunities ?? 0,
      });

      const dailyRows = (dailyRes.data ?? []) as Array<{
        d: string;
        gmv: number | string;
        revenue: number | string;
      }>;
      const buckets = dailyRows.map((r) => ({
        date: new Date(r.d),
        gmv: Number(r.gmv),
        revenue: Number(r.revenue),
      }));

      // Bucket boş çıxarsa fallback (heç bir uyğun məlumat yox)
      if (buckets.length === 0) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          buckets.push({ date: d, gmv: 0, revenue: 0 });
        }
      }

      setRevenue({
        gmv7d: Number(s.gmv7d ?? 0),
        gmv30d: Number(s.gmv30d ?? 0),
        platformRevenue30d: Number(s.platformRevenue30d ?? 0),
        acceptCommission: Number(s.acceptCommission ?? 0),
        completeCommission: Number(s.completeCommission ?? 0),
        withdrawalCommission: Number(s.withdrawalCommission ?? 0),
        pendingWithdrawalsAmount: Number(s.pendingWithdrawalsAmount ?? 0),
        pendingWithdrawalsCount: Number(s.pendingWithdrawalsCount ?? 0),
        completedPayments30d: Number(s.completedPayments30d ?? 0),
        daily: buckets,
      });

      // Audit + actor profile join
      const rawAudit = (audit.data ?? []) as RecentActivity[];
      const actorIds = Array.from(
        new Set(
          rawAudit
            .map((r) => r.actor ?? r.actor_id)
            .filter((id): id is string => !!id),
        ),
      );
      let profilesById: Record<string, { name: string | null; email: string | null }> = {};
      if (actorIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, email')
          .in('id', actorIds);
        profilesById = Object.fromEntries(
          (profs ?? []).map(
            (p: { id: string; name: string | null; email: string | null }) => [
              p.id,
              { name: p.name, email: p.email },
            ],
          ),
        );
      }
      setRecent(
        rawAudit.map((r) => ({
          ...r,
          actor_profile: profilesById[(r.actor ?? r.actor_id) ?? ''] ?? null,
        })),
      );
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  return (
    <AdminLayout
      title="Dashboard"
      subtitle="Platforma vəziyyəti və canlı göstəricilər"
      actions={
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-border text-sm font-bold text-ink-soft hover:text-brand-700 hover:border-brand-300 disabled:opacity-50 transition-colors"
          title="Yenilə"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Yenilə</span>
        </button>
      }
    >
      {/* ─── Hero / greeting ──────────────────────────────────────── */}
      <HeroBanner stats={stats} revenue={revenue} loading={loading} />

      {/* ─── KPI grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KpiTile
          label="İstifadəçilər"
          value={loading ? '—' : stats.totalUsers}
          delta={loading ? null : { value: stats.newUsers7d, label: '7 gündə' }}
          icon={<Users size={18} />}
          tint="brand"
        />
        <KpiTile
          label="Provayderlər"
          value={loading ? '—' : stats.totalProviders}
          subtitle="Aktiv hesab"
          icon={<Sparkles size={18} />}
          tint="violet"
        />
        <KpiTile
          label="Aktiv fürsətlər"
          value={loading ? '—' : stats.activeOpportunities}
          subtitle={`${stats.totalOpportunities} ümumi`}
          icon={<Sparkle size={18} />}
          tint="cyan"
        />
        <KpiTile
          label="Şirkətlər"
          value={loading ? '—' : stats.totalBrigades}
          subtitle="Briqada"
          icon={<Building2 size={18} />}
          tint="emerald"
        />
      </div>

      {/* ─── Revenue grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Revenue card */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-muted">
                <BarChart3 size={14} />
                <span className="text-xs font-bold uppercase tracking-wide">
                  Son 30 gün
                </span>
              </div>
              <h3 className="text-2xl font-extrabold text-ink mt-1 tracking-tight">
                {loading ? '—' : fmtMoney(revenue.platformRevenue30d, 2)} ₼
              </h3>
              <p className="text-xs text-muted">
                Platform geliri ·{' '}
                <span className="text-ink-soft font-bold">
                  GMV {fmtMoney(revenue.gmv30d)} ₼
                </span>
              </p>
            </div>
            <Link
              to="/Administrator/reports"
              className="inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700 shrink-0"
            >
              Tam hesabat <ArrowRight size={14} />
            </Link>
          </div>

          {/* Mini bar chart */}
          <MiniBarChart data={revenue.daily} />

          {/* Breakdown */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <RevenueLegend
              label="Qəbul"
              value={revenue.acceptCommission}
              dot="bg-emerald-500"
            />
            <RevenueLegend
              label="Tamamlanma"
              value={revenue.completeCommission}
              dot="bg-brand-500"
            />
            <RevenueLegend
              label="Nağdlaşdırma"
              value={revenue.withdrawalCommission}
              dot="bg-amber-500"
            />
          </div>
        </div>

        {/* Right column: queue + health */}
        <div className="space-y-4">
          <QueueCard
            icon={<Wallet size={16} />}
            tint="amber"
            label="Gözləyən çıxarış"
            value={`${fmtMoney(revenue.pendingWithdrawalsAmount, 0)} ₼`}
            hint={`${revenue.pendingWithdrawalsCount} sorğu emal gözləyir`}
            href="/Administrator/withdrawals"
          />
          <QueueCard
            icon={<Clock size={16} />}
            tint="rose"
            label="Pending sifariş"
            value={loading ? '—' : stats.pendingBookings}
            hint={`${stats.totalBookings} ümumi`}
            href="/Administrator/opportunities"
          />
          <QueueCard
            icon={<TrendingUp size={16} />}
            tint="emerald"
            label="Son 7 gün GMV"
            value={`${fmtMoney(revenue.gmv7d)} ₼`}
            hint={`${revenue.completedPayments30d} ödəniş / 30 gün`}
          />
        </div>
      </div>

      {/* ─── Activity + Quick links ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent activity (2/3) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-ink">
                Son fəaliyyət
              </h2>
              <p className="text-xs text-muted">Audit log canlı yayım</p>
            </div>
            <Link
              to="/Administrator/audit"
              className="inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
            >
              Hamısı <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <SkeletonRows count={5} />
          ) : recent.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">
              Hələ audit log girişi yoxdur
            </div>
          ) : (
            <div className="space-y-1">
              {recent.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Quick actions (1/3) */}
        <div className="bg-white rounded-2xl border border-border p-5">
          <h2 className="text-base sm:text-lg font-extrabold text-ink mb-4">
            Sürətli keçidlər
          </h2>
          <div className="space-y-2">
            <QuickLink
              to="/Administrator/reports"
              icon={<BarChart3 size={16} />}
              label="Gəlir hesabatı"
              hint="Komissiya və ödəniş analitikası"
              tint="brand"
            />
            <QuickLink
              to="/Administrator/commissions"
              icon={<Percent size={16} />}
              label="Komissiya"
              hint="3 mərhələnin faizlərini idarə et"
              tint="emerald"
            />
            <QuickLink
              to="/Administrator/opportunities"
              icon={<Sparkles size={16} />}
              label="Fürsətlər"
              hint="Müştəri sorğuları və təkliflər"
              tint="violet"
            />
            <QuickLink
              to="/Administrator/users"
              icon={<UserCog size={16} />}
              label="İstifadəçilər"
              hint="Rol və hesab idarəsi"
              tint="amber"
            />
            <QuickLink
              to="/Administrator/audit"
              icon={<ShieldCheck size={16} />}
              label="Audit log"
              hint="Bütün admin əməlləri"
              tint="rose"
            />
          </div>
        </div>
      </div>

      {/* ─── Parol idarəsi widget ─────────────────────────────────── */}
      <div className="mt-4">
        <PasswordManagerCard />
      </div>
    </AdminLayout>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Hero banner
// ────────────────────────────────────────────────────────────────────────────
function HeroBanner({
  stats,
  revenue,
  loading,
}: {
  stats: Stats;
  revenue: RevenueMetrics;
  loading: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 text-white p-6 sm:p-8 mb-6 shadow-brand">
      <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute -left-16 -bottom-20 w-72 h-72 rounded-full bg-accent-300/30 blur-3xl pointer-events-none" />
      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-white/80 font-bold text-sm">{todayGreeting()}, Admin</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold mt-1 tracking-tight">
            Platforma sağlam işləyir
          </h2>
          <p className="text-white/80 text-sm mt-2 max-w-lg">
            {loading
              ? 'Göstəricilər yüklənir...'
              : `Son 30 gündə ${fmtMoney(revenue.gmv30d)} ₼ dövriyyə, ${fmtMoney(revenue.platformRevenue30d, 2)} ₼ platform geliri, ${stats.activeOpportunities} aktiv fürsət.`}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
          <HeroStat label="GMV 30g" value={loading ? '—' : `${fmtMoney(revenue.gmv30d)}`} unit="₼" />
          <HeroStat
            label="Gelir 30g"
            value={loading ? '—' : `${fmtMoney(revenue.platformRevenue30d, 0)}`}
            unit="₼"
          />
          <HeroStat
            label="Yeni 7g"
            value={loading ? '—' : `+${stats.newUsers7d}`}
            unit="istifadəçi"
            full
          />
        </div>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  unit,
  full,
}: {
  label: string;
  value: string;
  unit: string;
  full?: boolean;
}) {
  return (
    <div
      className={`bg-white/12 backdrop-blur-sm border border-white/15 rounded-xl px-3 py-2 ${
        full ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">{label}</p>
      <p className="text-lg font-extrabold mt-0.5">
        {value}
        <span className="text-xs font-bold text-white/80 ml-1">{unit}</span>
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  KPI tile
// ────────────────────────────────────────────────────────────────────────────
function KpiTile({
  label,
  value,
  subtitle,
  delta,
  icon,
  tint,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: { value: number; label: string } | null;
  icon: React.ReactNode;
  tint: 'brand' | 'emerald' | 'violet' | 'amber' | 'cyan' | 'rose';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    cyan: 'bg-cyan-50 text-cyan-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-border p-4 sm:p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted uppercase tracking-wide">{label}</p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tints[tint]}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold text-ink mt-3 tracking-tight">{value}</p>
      {delta && (
        <p className="text-xs font-bold text-emerald-600 mt-1 inline-flex items-center gap-1">
          <ArrowUpRight size={12} /> +{delta.value} <span className="text-muted font-bold">{delta.label}</span>
        </p>
      )}
      {!delta && subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Mini bar chart (14 days)
// ────────────────────────────────────────────────────────────────────────────
function MiniBarChart({ data }: { data: Array<{ date: Date; gmv: number; revenue: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.gmv));
  return (
    <div>
      <div className="flex items-end gap-1 h-28 px-1">
        {data.map((d, i) => {
          const gmvH = (d.gmv / max) * 100;
          const revH = max > 0 ? (d.revenue / max) * 100 : 0;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col-reverse gap-0.5 group relative"
              title={`${d.date.toLocaleDateString('az')}\nGMV: ${fmtMoney(d.gmv)} ₼\nGəlir: ${fmtMoney(d.revenue, 2)} ₼`}
            >
              <div
                className="bg-brand-500 group-hover:bg-brand-600 rounded-sm transition-colors min-h-[2px]"
                style={{ height: `${Math.max(gmvH, d.gmv > 0 ? 4 : 0)}%` }}
              />
              <div
                className="bg-emerald-500 group-hover:bg-emerald-600 rounded-sm transition-colors"
                style={{ height: `${Math.max(revH, d.revenue > 0 ? 2 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted px-1 font-bold">
        <span>
          {data[0]?.date.toLocaleDateString('az', { day: '2-digit', month: 'short' })}
        </span>
        <span>indi</span>
      </div>
    </div>
  );
}

function RevenueLegend({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-xl bg-surface-alt">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className="text-[10px] text-muted font-bold uppercase">{label}</p>
        <p className="font-extrabold text-ink text-sm truncate">{fmtMoney(value, 2)} ₼</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Queue card (right column)
// ────────────────────────────────────────────────────────────────────────────
function QueueCard({
  icon,
  tint,
  label,
  value,
  hint,
  href,
}: {
  icon: React.ReactNode;
  tint: 'amber' | 'rose' | 'emerald';
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const tints: Record<typeof tint, string> = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const inner = (
    <div className={`bg-white rounded-2xl border border-border p-4 hover:shadow-md transition-shadow ${href ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${tints[tint]}`}>
          {icon}
        </div>
        <p className="text-xs font-bold text-muted uppercase tracking-wide flex-1">{label}</p>
        {href && <ArrowDownRight size={14} className="text-muted" />}
      </div>
      <p className="text-xl font-extrabold text-ink tracking-tight">{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
  if (href) return <Link to={href}>{inner}</Link>;
  return inner;
}

// ────────────────────────────────────────────────────────────────────────────
//  Quick link
// ────────────────────────────────────────────────────────────────────────────
function QuickLink({
  to,
  icon,
  label,
  hint,
  tint,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
  tint: 'brand' | 'emerald' | 'violet' | 'amber' | 'rose';
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-brand-300 hover:bg-surface-alt transition-all group"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tints[tint]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-ink text-sm">{label}</p>
        <p className="text-xs text-muted truncate">{hint}</p>
      </div>
      <ArrowRight
        size={14}
        className="text-muted group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all"
      />
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Activity row
// ────────────────────────────────────────────────────────────────────────────
type ActionMeta = {
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
};

const ACTION_META: Record<string, ActionMeta> = {
  commission_update: {
    label: 'Komissiya dəyişdi',
    Icon: Percent,
    color: 'bg-brand-50 text-brand-600',
  },
  role_assigned: {
    label: 'Rol təyin edildi',
    Icon: ShieldCheck,
    color: 'bg-violet-50 text-violet-600',
  },
  role_changed: {
    label: 'Rol dəyişdi',
    Icon: UserCog,
    color: 'bg-violet-50 text-violet-600',
  },
  payment_completed: {
    label: 'Ödəniş tamamlandı',
    Icon: CreditCard,
    color: 'bg-emerald-50 text-emerald-600',
  },
  service_promotion: {
    label: 'Xidmət təşviqi',
    Icon: Sparkle,
    color: 'bg-amber-50 text-amber-600',
  },
  withdrawal: {
    label: 'Nağdlaşdırma sorğusu',
    Icon: Wallet,
    color: 'bg-cyan-50 text-cyan-600',
  },
};

function getActionMeta(action: string): ActionMeta {
  return (
    ACTION_META[action] ?? {
      label: action.replace(/_/g, ' '),
      Icon: ActivityIcon,
      color: 'bg-surface-alt text-ink-soft',
    }
  );
}

function formatPayloadSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

function ActivityRow({ item }: { item: RecentActivity }) {
  const meta = getActionMeta(item.action);
  const actorName =
    item.actor_profile?.name ||
    item.actor_profile?.email ||
    (item.actor || item.actor_id ? 'Naməlum istifadəçi' : 'Sistem');
  const summary = formatPayloadSummary(item.payload);
  const Icon = meta.Icon;

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-surface-alt transition-colors">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="font-extrabold text-ink text-sm">{meta.label}</p>
          <p className="text-xs text-ink-soft font-bold truncate">{actorName}</p>
        </div>
        {summary && <p className="text-xs text-muted mt-0.5 truncate">{summary}</p>}
        {!summary && item.target_id && (
          <p className="text-xs text-muted font-mono truncate mt-0.5">
            {item.target_type ? `${item.target_type}: ` : ''}
            {item.target_id}
          </p>
        )}
      </div>
      <span
        className="text-xs text-muted shrink-0 font-bold whitespace-nowrap"
        title={new Date(item.created_at).toLocaleString('az')}
      >
        {relativeTime(item.created_at)}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Skeleton
// ────────────────────────────────────────────────────────────────────────────
function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-alt animate-pulse"
        >
          <div className="w-9 h-9 rounded-lg bg-border" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 bg-border rounded" />
            <div className="h-2 w-1/2 bg-border/70 rounded" />
          </div>
          <div className="h-3 w-12 bg-border rounded" />
        </div>
      ))}
    </div>
  );
}

