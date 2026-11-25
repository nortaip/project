import { ReactNode, useEffect, useState } from 'react';
import { notification } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageCircle,
  ClipboardCheck,
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FolderTree,
  HelpCircle,
  Image as ImageIcon,
  LogOut,
  Menu,
  Percent,
  RadioTower,
  Settings,
  ShieldCheck,
  ScrollText,
  Sparkles,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  onAdminAlert,
  refreshAdminAlerts,
  startAdminAlerts,
  stopAdminAlerts,
  usePendingCounts,
  type PendingCounts,
} from './adminAlerts';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Qırmızı say — bu bölmədə baxılmamış müraciətlər (adminAlerts). */
  countKey?: keyof PendingCounts;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/Administrator', label: 'Dashboard', icon: Activity },
  { to: '/Administrator/live', label: 'Canlı monitor', icon: RadioTower },
  { to: '/Administrator/users', label: 'İstifadəçilər', icon: Users },
  { to: '/Administrator/providers', label: 'Provayder müraciətləri', icon: Briefcase, countKey: 'providers' },
  { to: '/Administrator/kyc', label: 'KYC yoxlaması', icon: BadgeCheck, countKey: 'kyc' },
  { to: '/Administrator/categories', label: 'Kateqoriyalar', icon: FolderTree },
  { to: '/Administrator/subcategories', label: 'Alt kateqoriyalar', icon: Tag },
  { to: '/Administrator/questions', label: 'Suallar', icon: HelpCircle },
  { to: '/Administrator/prices', label: 'Qiymətlər', icon: CreditCard },
  { to: '/Administrator/opportunities', label: 'Fürsətlər', icon: Sparkles },
  { to: '/Administrator/brigades', label: 'Briqada müraciətləri', icon: Building2, countKey: 'brigades' },
  { to: '/Administrator/companies', label: 'Şirkətlər', icon: Building2 },
  { to: '/Administrator/promos', label: 'Promo kodlar', icon: Tag },
  { to: '/Administrator/banners', label: 'Bannerlər', icon: ImageIcon },
  { to: '/Administrator/reports', label: 'Gəlir hesabatı', icon: BarChart3 },
  { to: '/Administrator/job-completions', label: 'Sifariş təsdiqi', icon: ClipboardCheck, countKey: 'job_completions' },
  { to: '/Administrator/support', label: 'Dəstək çatı', icon: MessageCircle, countKey: 'support' },
  { to: '/Administrator/withdrawals', label: 'Nağdlaşdırma', icon: Wallet, countKey: 'withdrawals' },
  { to: '/Administrator/commissions', label: 'Komissiyalar', icon: Percent },
  { to: '/Administrator/audit', label: 'Audit log', icon: ShieldCheck },
  { to: '/Administrator/server-logs', label: 'Server jurnalı', icon: ScrollText },
];

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const COLLAPSED_KEY = 'admin_sidebar_collapsed';

export default function AdminLayout({ title, subtitle, actions, children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // ── Müraciət xəbərdarlıqları: qırmızı saylar + bildirişlər ──
  const pending = usePendingCounts();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported',
  );
  const uid = user?.id;
  useEffect(() => {
    if (uid) startAdminAlerts(uid);
  }, [uid]);
  useEffect(() => {
    void refreshAdminAlerts();
  }, [location.pathname]);
  useEffect(
    () =>
      onAdminAlert((a) => {
        const away = !document.hasFocus();
        notification.open({
          key: a.id,
          message: a.title,
          description: a.body,
          icon: <Bell size={18} className="text-danger" />,
          placement: 'topRight',
          duration: away ? 0 : 8,
          style: a.link ? { cursor: 'pointer' } : undefined,
          onClick: () => {
            if (a.link) navigate(a.link);
            notification.destroy(a.id);
          },
        });
        // Vərəq arxa plandadırsa / brauzer fokusda deyilsə — sistem bildirişi
        if (away && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const n = new Notification(a.title, { body: a.body ?? '', tag: a.id });
            n.onclick = () => {
              window.focus();
              if (a.link) navigate(a.link);
              n.close();
            };
          } catch {
            /* bəzi mobil brauzerlər `new Notification` dəstəkləmir */
          }
        }
      }),
    [navigate],
  );
  const countOf = (item: NavItem) => (item.countKey && pending ? pending[item.countKey] : 0);
  const totalPending = NAV_ITEMS.reduce((sum, i) => sum + countOf(i), 0);
  useEffect(() => {
    const strip = (t: string) => t.replace(/^\(\d+\+?\)\s*/, '');
    const base = strip(document.title);
    document.title = totalPending > 0 ? `(${totalPending}) ${base}` : base;
    return () => {
      document.title = strip(document.title);
    };
  }, [totalPending, title]);
  const askPermission = async () => {
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm(Notification.permission);
    }
  };

  const handleSignOut = async () => {
    stopAdminAlerts();
    await supabase.auth.signOut();
    logout();
    localStorage.clear();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/Administrator') {
      return location.pathname === path || location.pathname === `${path}/`;
    }
    return location.pathname.startsWith(path);
  };

  const sidebarWidth = collapsed ? 'lg:w-20' : 'lg:w-72';

  return (
    <div className="min-h-screen bg-surface-alt flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-50 inset-y-0 left-0 w-72 ${sidebarWidth} bg-white border-r border-border flex flex-col transition-all duration-300 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div
          className={`border-b border-border flex items-center gap-3 ${
            collapsed ? 'p-3 justify-center' : 'p-5'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center shadow-brand shrink-0">
            <ShieldCheck size={20} className="text-white" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-ink leading-tight">Admin Panel</p>
              <p className="text-xs text-muted">Ellit.az</p>
            </div>
          )}
          <button
            type="button"
            className="lg:hidden text-muted hover:text-ink"
            onClick={() => setMobileOpen(false)}
            aria-label="Bağla"
          >
            <X size={20} />
          </button>
        </div>

        {/* Desktop collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-border items-center justify-center text-ink-soft hover:text-brand-600 hover:border-brand-300 shadow-sm z-10 transition-colors"
          aria-label={collapsed ? 'Genişləndir' : 'Kiçilt'}
          title={collapsed ? 'Genişləndir' : 'Kiçilt'}
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            const count = countOf(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`group flex items-center gap-3 rounded-xl font-bold text-sm transition-all relative ${
                  collapsed ? 'justify-center p-3' : 'px-3 py-2.5'
                } ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-soft hover:bg-surface-alt hover:text-ink'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-600 rounded-r-full" />
                )}
                <Icon
                  size={18}
                  className={`shrink-0 ${active ? 'text-brand-600' : 'text-muted group-hover:text-ink-soft'}`}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span
                        className="min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-extrabold flex items-center justify-center shadow-sm"
                        title={`${count} baxılmamış`}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </>
                )}
                {collapsed && count > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-white" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Brauzer bildirişləri — icazə */}
        {!collapsed && perm === 'default' && (
          <div className="mx-3 mb-2 p-3 rounded-xl bg-brand-50 border border-brand-100">
            <p className="text-xs font-bold text-ink flex items-center gap-1.5">
              <Bell size={14} className="text-brand-600" /> Yeni müraciətlər bildirişlə gəlsin
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Panel başqa vərəqdə açıq olanda da xəbər tutacaqsınız.
            </p>
            <button
              type="button"
              onClick={askPermission}
              className="mt-2 w-full px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700"
            >
              Brauzer bildirişlərini aç
            </button>
          </div>
        )}
        {!collapsed && perm === 'denied' && (
          <p className="mx-3 mb-2 px-3 py-2 rounded-xl bg-surface-alt text-[11px] text-muted">
            Brauzer bildirişləri bloklanıb — ünvan sətrindəki kilid işarəsindən icazə verin.
          </p>
        )}

        {/* User + sign out */}
        <div className="p-3 border-t border-border">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link
                to="/account"
                title={user?.user_metadata?.name ?? user?.email ?? 'Admin'}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-extrabold text-sm"
              >
                {(user?.user_metadata?.name ?? user?.email ?? '?')[0]?.toUpperCase()}
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                title="Çıxış"
                className="w-10 h-10 rounded-xl bg-white border border-danger/20 text-danger flex items-center justify-center hover:bg-red-50 transition-colors"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <>
              <Link
                to="/account"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-alt transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-extrabold text-sm shrink-0">
                  {(user?.user_metadata?.name ?? user?.email ?? '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-ink truncate">
                    {user?.user_metadata?.name ?? 'Admin'}
                  </p>
                  <p className="text-xs text-muted truncate">{user?.email}</p>
                </div>
                <Settings size={16} className="text-muted shrink-0" />
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-danger/20 text-danger font-bold text-sm hover:bg-red-50 transition-colors"
              >
                <LogOut size={16} /> Çıxış
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="bg-white/85 backdrop-blur-md border-b border-border px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden relative w-10 h-10 rounded-xl bg-surface-alt hover:bg-border flex items-center justify-center text-ink-soft shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Menyu"
            >
              <Menu size={20} />
              {totalPending > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">
                  {totalPending > 99 ? '99+' : totalPending}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="hidden sm:flex w-9 h-9 rounded-xl bg-surface-alt hover:bg-border items-center justify-center text-ink-soft shrink-0"
              aria-label="Geri"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-extrabold text-ink tracking-tight truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs sm:text-sm text-muted truncate">{subtitle}</p>
              )}
            </div>
          </div>

          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
