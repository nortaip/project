import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  ClipboardList,
  CreditCard,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card, StatTile } from '../components/ui';
import AdminLayout from './AdminLayout';

interface Stats {
  totalUsers: number;
  newUsers7d: number;
  totalProviders: number;
  totalBookings: number;
  pendingBookings: number;
  completedBookings: number;
  totalRevenue: number;
  totalBrigades: number;
}

interface RecentActivity {
  id: string;
  action: string;
  target_id: string | null;
  created_at: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    newUsers7d: 0,
    totalProviders: 0,
    totalBookings: 0,
    pendingBookings: 0,
    completedBookings: 0,
    totalRevenue: 0,
    totalBrigades: 0,
  });
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        usersAll,
        usersNew,
        providers,
        bookings,
        pending,
        completed,
        payments,
        brigades,
        audit,
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'provider'),
        supabase.from('bookings').select('id', { count: 'exact', head: true }),
        supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('bookings')
          .select('total_amount', { count: 'exact' })
          .eq('status', 'completed'),
        supabase
          .from('payments')
          .select('amount')
          .eq('status', 'completed'),
        supabase.from('brigades').select('id', { count: 'exact', head: true }),
        supabase
          .from('audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      const completedSum = (completed.data ?? []).reduce(
        (sum, b: { total_amount?: number | string }) =>
          sum + Number(b.total_amount ?? 0),
        0,
      );
      const paymentSum = (payments.data ?? []).reduce(
        (sum, p: { amount?: number | string }) => sum + Number(p.amount ?? 0),
        0,
      );

      setStats({
        totalUsers: usersAll.count ?? 0,
        newUsers7d: usersNew.count ?? 0,
        totalProviders: providers.count ?? 0,
        totalBookings: bookings.count ?? 0,
        pendingBookings: pending.count ?? 0,
        completedBookings: completed.count ?? 0,
        totalRevenue: completedSum + paymentSum,
        totalBrigades: brigades.count ?? 0,
      });

      setRecent((audit.data ?? []) as RecentActivity[]);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout title="Dashboard" subtitle="Ümumi göstəricilər və son fəaliyyət">
      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatTile
          label="İstifadəçilər"
          value={loading ? '…' : stats.totalUsers}
          icon={<Users size={18} />}
          trend={
            stats.newUsers7d > 0
              ? { value: stats.newUsers7d, positive: true }
              : undefined
          }
        />
        <StatTile
          label="Provayderlər"
          value={loading ? '…' : stats.totalProviders}
          icon={<Sparkles size={18} />}
        />
        <StatTile
          label="Şirkətlər"
          value={loading ? '…' : stats.totalBrigades}
          icon={<Building2 size={18} />}
        />
        <StatTile
          label="Sifarişlər"
          value={loading ? '…' : stats.totalBookings}
          icon={<ClipboardList size={18} />}
        />

        <StatTile
          label="Pending sifariş"
          value={loading ? '…' : stats.pendingBookings}
          icon={<ClipboardList size={18} />}
        />
        <StatTile
          label="Tamamlanmış"
          value={loading ? '…' : stats.completedBookings}
          icon={<TrendingUp size={18} />}
        />
        <StatTile
          label="Toplam dövriyyə"
          value={loading ? '…' : `${stats.totalRevenue.toFixed(0)} ₼`}
          icon={<CreditCard size={18} />}
        />
        <StatTile
          label="7 günlük yeni"
          value={loading ? '…' : `+${stats.newUsers7d}`}
          icon={<TrendingUp size={18} />}
        />
      </div>

      {/* Recent activity */}
      <Card variant="default" padding="md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-ink">Son fəaliyyət</h2>
            <p className="text-xs text-muted">Audit log-dakı son hadisələr</p>
          </div>
          <Link
            to="/Administrator/audit"
            className="inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
          >
            Hamısı <ArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted">Yüklənir...</div>
        ) : recent.length === 0 ? (
          <div className="py-8 text-center text-muted">Hələ audit log girişi yoxdur</div>
        ) : (
          <div className="space-y-2">
            {recent.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </AdminLayout>
  );
}

function ActivityRow({ item }: { item: RecentActivity }) {
  const dt = new Date(item.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-alt">
      <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-extrabold uppercase">
        {item.action.substring(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-ink text-sm truncate">{item.action}</p>
        {item.target_id && (
          <p className="text-xs text-muted font-mono truncate">{item.target_id}</p>
        )}
      </div>
      <span className="text-xs text-muted shrink-0">{dt}</span>
    </div>
  );
}
