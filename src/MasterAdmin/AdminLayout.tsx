import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BadgeCheck,
  BarChart3,
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
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/Administrator', label: 'Dashboard', icon: Activity },
  { to: '/Administrator/users', label: 'İstifadəçilər', icon: Users },
  { to: '/Administrator/providers', label: 'Provayder müraciətləri', icon: Briefcase },
  { to: '/Administrator/kyc', label: 'KYC yoxlaması', icon: BadgeCheck },
  { to: '/Administrator/categories', label: 'Kateqoriyalar', icon: FolderTree },
  { to: '/Administrator/subcategories', label: 'Alt kateqoriyalar', icon: Tag },
  { to: '/Administrator/questions', label: 'Suallar', icon: HelpCircle },
  { to: '/Administrator/prices', label: 'Qiymətlər', icon: CreditCard },
  { to: '/Administrator/opportunities', label: 'Fürsətlər', icon: Sparkles },
  { to: '/Administrator/brigades', label: 'Briqada müraciətləri', icon: Building2 },
  { to: '/Administrator/companies', label: 'Şirkətlər', icon: Building2 },
  { to: '/Administrator/promos', label: 'Promo kodlar', icon: Tag },
  { to: '/Administrator/banners', label: 'Bannerlər', icon: ImageIcon },
  { to: '/Administrator/reports', label: 'Gəlir hesabatı', icon: BarChart3 },
  { to: '/Administrator/withdrawals', label: 'Nağdlaşdırma', icon: Wallet },
  { to: '/Administrator/commissions', label: 'Komissiyalar', icon: Percent },
  { to: '/Administrator/audit', label: 'Audit log', icon: ShieldCheck },
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

  const handleSignOut = async () => {
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
                    {item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-xs font-extrabold ${
                          active ? 'bg-brand-200 text-brand-700' : 'bg-surface-alt text-muted'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
                {collapsed && item.badge !== undefined && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-brand-500" />
                )}
              </Link>
            );
          })}
        </nav>

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
              className="lg:hidden w-10 h-10 rounded-xl bg-surface-alt hover:bg-border flex items-center justify-center text-ink-soft shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Menyu"
            >
              <Menu size={20} />
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
