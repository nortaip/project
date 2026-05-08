import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ChevronLeft,
  CreditCard,
  FolderTree,
  HelpCircle,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
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
  { to: '/Administrator/categories', label: 'Kateqoriyalar', icon: FolderTree },
  { to: '/Administrator/subcategories', label: 'Alt kateqoriyalar', icon: Tag },
  { to: '/Administrator/questions', label: 'Suallar', icon: HelpCircle },
  { to: '/Administrator/prices', label: 'Qiymətlər', icon: CreditCard },
  { to: '/Administrator/opportunities', label: 'Fürsətlər', icon: Sparkles },
  { to: '/Administrator/audit', label: 'Audit log', icon: ShieldCheck },
];

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Modern admin panel layout with collapsible sidebar.
 * Mobile: sidebar drawer (closed by default).
 * Desktop: persistent sidebar.
 */
export default function AdminLayout({ title, subtitle, actions, children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-surface-alt flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static lg:translate-x-0 z-50 inset-y-0 left-0 w-72 bg-white border-r border-border flex flex-col transition-transform ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center shadow-brand">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink leading-tight">Admin Panel</p>
            <p className="text-xs text-muted">Ellit.az</p>
          </div>
          <button
            type="button"
            className="lg:hidden text-muted hover:text-ink"
            onClick={() => setMobileOpen(false)}
            aria-label="Bağla"
          >
            <X size={20} />
          </button>
        </div>

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
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-soft hover:bg-surface-alt hover:text-ink'
                }`}
              >
                <Icon
                  size={18}
                  className={active ? 'text-brand-600' : 'text-muted'}
                />
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
              </Link>
            );
          })}
        </nav>

        {/* User + sign out */}
        <div className="p-3 border-t border-border">
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
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-border px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3 sticky top-0 z-30">
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
                <p className="text-xs sm:text-sm text-muted truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
