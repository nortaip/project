import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  HeartHandshake,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Star,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  PageContainer,
  StatTile,
} from '../components/ui';
import PendingInvites from '../components/PendingInvites';

interface ProfileRow {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  role: string | null;
  balance: number | null;
  bonus_balance: number | null;
  address: string | null;
  is_verified: boolean | null;
}

interface BookingSummary {
  id: string;
  status: string;
  date: string | null;
  total_amount: number | null;
  service: {
    title: string;
    images: string[] | null;
  } | null;
}

const STATUS_KEY: Record<string, string> = {
  pending: 'myBookings.filterPending',
  confirmed: 'myBookings.filterConfirmed',
  completed: 'myBookings.filterCompleted',
  cancelled: 'myBookings.filterCancelled',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-muted/10 text-muted',
};

export default function CustomerProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    completed: number;
    spent: number;
  }>({ total: 0, completed: 0, spent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const [pResp, bResp] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user!.id).single(),
        supabase
          .from('bookings')
          .select('id, status, date, total_amount, service:services(title, images)')
          .eq('customer_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      if (pResp.error) throw pResp.error;
      setProfile(pResp.data as ProfileRow);

      const list = (bResp.data ?? []) as unknown as BookingSummary[];
      setBookings(list);

      // Tam statistika ayrıca query
      const { data: allBookings } = await supabase
        .from('bookings')
        .select('status, total_amount')
        .eq('customer_id', user!.id);
      const all = (allBookings ?? []) as Array<{
        status: string;
        total_amount: number | null;
      }>;
      setStats({
        total: all.length,
        completed: all.filter((b) => b.status === 'completed').length,
        spent: all.reduce(
          (sum, b) =>
            b.status === 'completed' ? sum + (Number(b.total_amount) || 0) : sum,
          0,
        ),
      });
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!confirm('Hesabdan çıxmaq istəyirsən?')) return;
    try {
      await supabase.auth.signOut();
      logout();
      localStorage.removeItem('user');
      localStorage.removeItem('isLoggedIn');
      navigate('/login');
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const displayName =
    profile?.name?.trim() || profile?.email?.split('@')[0] || 'İstifadəçi';

  if (loading || !profile) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="lg">
      {/* Header card — mobile-first hero */}
      <div className="bg-gradient-to-br from-brand-600 to-accent-500 rounded-3xl p-5 sm:p-6 mb-5 text-white shadow-brand-soft relative overflow-hidden">
        <div className="absolute -top-12 -right-8 w-40 h-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={displayName}
              className="w-20 h-20 rounded-3xl object-cover border-4 border-white/30"
            />
          ) : (
            <div className="w-20 h-20 rounded-3xl bg-white/20 border-4 border-white/30 flex items-center justify-center font-extrabold text-3xl">
              {displayName[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
                {displayName}
              </h1>
              {profile.is_verified && (
                <ShieldCheck size={18} className="text-white shrink-0" />
              )}
            </div>
            <p className="text-sm text-white/80 mt-0.5 truncate">
              {profile.email ?? profile.phone_number ?? '—'}
            </p>
            {profile.role && (
              <span className="inline-block mt-2 text-[11px] uppercase font-bold tracking-wide bg-white/20 px-2 py-0.5 rounded-md">
                {profile.role}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pending invites (auto-hidden if none) */}
      <PendingInvites onChange={load} />

      {/* Stats grid — mobile responsive 1→3 columns */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile
          label={t('balance.main')}
          value={`${(profile.balance ?? 0).toFixed(2)} ₼`}
          icon={<Wallet size={18} />}
        />
        <StatTile
          label={t('balance.bonus')}
          value={`${(profile.bonus_balance ?? 0).toFixed(2)} ₼`}
          icon={<Sparkles size={18} />}
        />
        <StatTile
          label={t('myBookings.title')}
          value={stats.total}
          icon={<HeartHandshake size={18} />}
        />
        <StatTile
          label={t('won.badge')}
          value={stats.completed}
          icon={<Star size={18} />}
        />
      </div>

      {/* Action grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <ActionCard
          icon={<CreditCard size={20} />}
          title={t('balance.topUpTitle')}
          subtitle={t('home.faq.q3')}
          to="/update-balance"
          accent
        />
        <ActionCard
          icon={<Bell size={20} />}
          title={t('nav.notifications')}
          subtitle={t('notificationsPage.emptyBody')}
          to="/notifications"
        />
        <ActionCard
          icon={<Building2 size={20} />}
          title={t('customerProfile.myBrigades')}
          subtitle={t('brigades.subtitle', { count: '' })}
          to="/brigades"
        />
        <ActionCard
          icon={<SettingsIcon size={20} />}
          title={t('brigadeDetail.settings')}
          subtitle={t('home.faq.q2')}
          to="/account/settings"
        />
      </div>

      {/* Recent bookings */}
      <Card variant="default" padding="md" className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-ink">{t('myBookings.title')}</h2>
          <Link
            to="/Mybookings"
            className="text-sm font-bold text-brand-600 hover:text-brand-700"
          >
            {t('home.topProviders.viewAll')}
          </Link>
        </div>
        {bookings.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted">{t('myBookings.emptyTitle')}</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={() => navigate('/services')}
            >
              {t('home.browseServices')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <Link
                key={b.id}
                to={`/bookings/confirmation?id=${b.id}`}
                className="flex items-center gap-3 p-3 rounded-2xl hover:bg-surface-alt transition-colors border border-transparent hover:border-border"
              >
                {b.service?.images?.[0] ? (
                  <div
                    className="w-12 h-12 rounded-xl bg-cover bg-center shrink-0"
                    style={{ backgroundImage: `url(${b.service.images[0]})` }}
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <HeartHandshake size={22} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink truncate">
                    {b.service?.title ?? '—'}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                    <span
                      className={`px-1.5 py-0.5 rounded-md font-bold ${
                        STATUS_COLOR[b.status] ?? STATUS_COLOR.pending
                      }`}
                    >
                      {t(STATUS_KEY[b.status] ?? 'myBookings.filterPending')}
                    </span>
                    {b.date && <span>· {formatDate(b.date)}</span>}
                    {b.total_amount && (
                      <span>· {Number(b.total_amount).toFixed(2)} ₼</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} className="text-muted shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Personal info */}
      <Card variant="default" padding="md" className="mb-5">
        <h2 className="text-lg font-extrabold text-ink mb-4">{t('customerProfile.title')}</h2>
        <div className="space-y-3">
          <InfoRow icon={<UserIcon size={16} />} label={t('customerProfile.name')} value={profile.name} />
          <InfoRow icon={<Mail size={16} />} label={t('customerProfile.email')} value={profile.email} />
          <InfoRow
            icon={<Phone size={16} />}
            label={t('customerProfile.phone')}
            value={profile.phone_number}
          />
          <InfoRow
            icon={<MapPin size={16} />}
            label={t('customerProfile.address')}
            value={profile.address}
          />
        </div>
        <Link
          to="/complete-profile"
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
        >
          {t('customerProfile.edit')} <ChevronRight size={14} />
        </Link>
      </Card>

      {/* Sign out */}
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-white border border-danger/20 text-danger font-extrabold hover:bg-red-50 transition-colors"
      >
        <LogOut size={18} />
        {t('nav.logout')}
      </button>

      <p className="mt-4 text-center text-xs text-muted">
        Ellit.az · Versiya 2.0
      </p>
    </PageContainer>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const dt = new Date(iso);
    return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  } catch {
    return '—';
  }
}

function ActionCard({
  icon,
  title,
  subtitle,
  to,
  accent = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  to: string;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
        accent
          ? 'bg-gradient-to-br from-brand-50 to-accent-50 border-brand-200 hover:border-brand-400'
          : 'bg-white border-border hover:border-brand-300'
      }`}
    >
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
          accent ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-ink">{title}</p>
        <p className="text-xs text-muted truncate">{subtitle}</p>
      </div>
      <ChevronRight size={18} className="text-muted shrink-0" />
    </Link>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-surface-alt text-muted flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p className="font-bold text-ink truncate">{value ?? '—'}</p>
      </div>
    </div>
  );
}
