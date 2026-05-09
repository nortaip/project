import {
  Bell,
  Briefcase,
  ChevronDown,
  Globe,
  LogIn,
  LogOut,
  Menu,
  User as UserIcon,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

interface NavbarProps {
  className?: string;
}

interface ProfileSummary {
  role: string | null;
  balance: number | null;
  name: string | null;
  avatar_url: string | null;
}

const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: 'az', label: 'AZ', flag: '🇦🇿' },
  { code: 'ru', label: 'RU', flag: '🇷🇺' },
  { code: 'en', label: 'EN', flag: '🇬🇧' },
];

export const Navbar = ({ className = '' }: NavbarProps) => {
  const user = useAuthStore((state) => state.user);
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileSummary>({
    role: null,
    balance: null,
    name: null,
    avatar_url: null,
  });
  const [unreadCount, setUnreadCount] = useState(0);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // ── Fetch profile + unread count ──────────────────────────────
  useEffect(() => {
    if (!user?.id) {
      setProfile({ role: null, balance: null, name: null, avatar_url: null });
      setUnreadCount(0);
      return;
    }

    let cancelled = false;
    (async () => {
      const [{ data: prof }, { count: unread }] = await Promise.all([
        supabase
          .from('profiles')
          .select('role, balance, name, avatar_url')
          .eq('id', user.id)
          .single(),
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false),
      ]);
      if (cancelled) return;
      setProfile({
        role: (prof?.role as string) ?? null,
        balance: prof?.balance ?? null,
        name: (prof?.name as string) ?? null,
        avatar_url: (prof?.avatar_url as string) ?? null,
      });
      setUnreadCount(unread ?? 0);
    })();

    // Realtime: yeni notification gəldikdə badge yenilənsin
    const channel = supabase
      .channel(`notifications_user_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          const { count } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_read', false);
          setUnreadCount(count ?? 0);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ── Close menus on outside click ──────────────────────────────
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // ── Close mobile menu on route change ─────────────────────────
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    try {
      // 1. Supabase session-u bağla (sb-<project>-auth-token-i təmizləyir)
      await supabase.auth.signOut();
    } catch {
      // Sign-out fail olsa belə davam et — local state təmizlənməlidir
    }
    // 2. Zustand store-u sıfırla
    useAuthStore.getState().setUser(null);
    // 3. Köhnə açarları da təmizlə (legacy)
    ['auth-storage', 'user', 'isLoggedIn'].forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    });
    // 4. Hard reload — bütün in-memory state, cache və realtime channel-lər təmizlənir
    window.location.href = '/login';
  };

  const navLinks = [
    { to: '/services', label: t('nav.services') },
    { to: '/providers', label: t('nav.providers') },
    { to: '/about', label: t('nav.about') },
  ];

  const currentLang =
    LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  return (
    <nav
      className={`${className} bg-white border-b border-border ${
        className.includes('sticky') ? '' : 'relative'
      } z-50`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ── Logo ─────────────────────────────────── */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-soft">
              <Zap size={18} fill="white" className="text-white" />
            </div>
            <span className="text-xl font-extrabold text-ink tracking-tight hidden sm:inline">
              Ellit<span className="text-brand-600">.az</span>
            </span>
          </Link>

          {/* ── Desktop nav ──────────────────────────── */}
          <div className="hidden md:flex items-center gap-1 ml-8">
            {navLinks.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`relative px-3 py-2 text-sm font-bold transition-colors rounded-lg ${
                    active
                      ? 'text-brand-700 bg-brand-50'
                      : 'text-ink-soft hover:text-brand-600 hover:bg-surface-bg'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* ── Right side actions ───────────────────── */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Language switcher */}
            <div className="relative hidden sm:block" ref={langMenuRef}>
              <button
                type="button"
                onClick={() => setLangOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2 h-9 rounded-lg text-ink-soft hover:bg-surface-bg transition-colors"
                aria-label="Language"
              >
                <Globe size={16} />
                <span className="text-xs font-bold">{currentLang.label}</span>
                <ChevronDown size={12} className={`transition-transform ${langOpen ? 'rotate-180' : ''}`} />
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl border border-border shadow-card-lg overflow-hidden">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => {
                        i18n.changeLanguage(l.code);
                        setLangOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left transition-colors ${
                        l.code === i18n.language
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-ink-soft hover:bg-surface-bg'
                      }`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {user ? (
              <>
                {/* Provider "Fürsətlər" CTA — desktop only */}
                {profile.role === 'provider' && (
                  <Link
                    to="/account/opportunities"
                    className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm font-bold transition-colors"
                  >
                    <Briefcase size={14} />
                    Fürsətlər
                  </Link>
                )}

                {/* Balance chip — desktop */}
                {profile.balance !== null && (
                  <Link
                    to="/account/balance"
                    className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand-gradient text-white text-sm font-bold shadow-brand-soft hover:shadow-brand transition-all"
                  >
                    <Wallet size={14} />
                    {profile.balance.toFixed(2)} ₼
                  </Link>
                )}

                {/* Notifications */}
                <Link
                  to="/notifications"
                  className="relative w-9 h-9 rounded-lg flex items-center justify-center text-ink-soft hover:text-brand-600 hover:bg-surface-bg transition-colors"
                  aria-label={t('nav.notifications')}
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>

                {/* User menu */}
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((v) => !v)}
                    className="flex items-center gap-1 rounded-lg hover:bg-surface-bg transition-colors p-1"
                    aria-label={t('nav.profile')}
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.name ?? t('nav.profile')}
                        className="w-8 h-8 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-brand-gradient flex items-center justify-center text-white text-sm font-extrabold">
                        {(profile.name ?? user.email ?? '?')[0]?.toUpperCase()}
                      </div>
                    )}
                    <ChevronDown
                      size={14}
                      className={`text-muted transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-2xl border border-border shadow-card-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <div className="text-sm font-bold text-ink truncate">
                          {profile.name ?? t('nav.profile')}
                        </div>
                        <div className="text-xs text-muted truncate">{user.email}</div>
                      </div>
                      <MenuItem to="/account" icon={UserIcon} onClick={() => setUserMenuOpen(false)}>
                        {t('nav.profile')}
                      </MenuItem>
                      <MenuItem to="/Mybookings" icon={Briefcase} onClick={() => setUserMenuOpen(false)}>
                        {t('nav.myBookings')}
                      </MenuItem>
                      <MenuItem to="/account/balance" icon={Wallet} onClick={() => setUserMenuOpen(false)}>
                        {t('nav.balance')}
                      </MenuItem>
                      {profile.role === 'provider' && (
                        <MenuItem
                          to="/account/opportunities"
                          icon={Briefcase}
                          onClick={() => setUserMenuOpen(false)}
                        >
                          {t('nav.providerPanel')}
                        </MenuItem>
                      )}
                      <div className="border-t border-border">
                        <button
                          type="button"
                          onClick={() => {
                            setUserMenuOpen(false);
                            handleSignOut();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-danger hover:bg-danger/5 transition-colors"
                        >
                          <LogOut size={16} />
                          {t('nav.logout')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  to="/login"
                  className="h-9 px-4 inline-flex items-center text-sm font-bold text-ink-soft hover:text-brand-600 transition-colors"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/signup"
                  className="h-9 px-4 inline-flex items-center rounded-xl bg-brand-gradient text-white text-sm font-bold shadow-brand-soft hover:shadow-brand transition-all"
                >
                  {t('nav.signup')}
                </Link>
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-soft hover:bg-surface-bg transition-colors ml-1"
              aria-label="Menu"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile drawer ───────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <div
            className="absolute inset-0 bg-ink/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative ml-auto w-72 max-w-[85vw] h-full bg-white shadow-card-lg flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <Link
                to="/"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2"
              >
                <div className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center">
                  <Zap size={18} fill="white" className="text-white" />
                </div>
                <span className="text-lg font-extrabold text-ink">
                  Ellit<span className="text-brand-600">.az</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:bg-surface-bg"
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>

            {/* User card if signed in */}
            {user && (
              <div className="p-4 border-b border-border">
                <Link
                  to="/account"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3"
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.name ?? ''}
                      className="w-12 h-12 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-brand-gradient flex items-center justify-center text-white text-lg font-extrabold">
                      {(profile.name ?? user.email ?? '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-ink truncate">
                      {profile.name ?? t('nav.profile')}
                    </div>
                    <div className="text-xs text-muted truncate">{user.email}</div>
                  </div>
                </Link>
                {profile.balance !== null && (
                  <Link
                    to="/account/balance"
                    onClick={() => setMobileOpen(false)}
                    className="mt-3 flex items-center gap-2 px-4 h-11 rounded-xl bg-brand-gradient text-white font-bold shadow-brand-soft"
                  >
                    <Wallet size={16} />
                    {t('nav.balance')}: {profile.balance.toFixed(2)} ₼
                  </Link>
                )}
              </div>
            )}

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {navLinks.map((link) => (
                <MobileLink key={link.to} to={link.to}>
                  {link.label}
                </MobileLink>
              ))}
              {user && (
                <>
                  <div className="my-2 mx-3 border-t border-border" />
                  <MobileLink to="/Mybookings">{t('nav.myBookings')}</MobileLink>
                  <MobileLink to="/notifications">
                    {t('nav.notifications')}
                    {unreadCount > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-extrabold">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </MobileLink>
                  {profile.role === 'provider' && (
                    <MobileLink to="/account/opportunities">{t('nav.providerPanel')}</MobileLink>
                  )}
                </>
              )}
            </nav>

            {/* Footer: language + auth actions */}
            <div className="p-4 border-t border-border space-y-3">
              {/* Language pills */}
              <div className="flex gap-1">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => i18n.changeLanguage(l.code)}
                    className={`flex-1 h-9 rounded-lg text-xs font-extrabold transition-colors ${
                      l.code === i18n.language
                        ? 'bg-brand-gradient text-white'
                        : 'bg-surface-bg text-ink-soft hover:bg-brand-50 hover:text-brand-700'
                    }`}
                  >
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    handleSignOut();
                  }}
                  className="w-full h-11 rounded-xl bg-danger/10 text-danger font-bold text-sm flex items-center justify-center gap-2 hover:bg-danger/15 transition-colors"
                >
                  <LogOut size={16} />
                  {t('nav.logout')}
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="h-11 rounded-xl border-2 border-border text-ink-soft font-bold text-sm flex items-center justify-center gap-2 hover:border-brand-300 transition-colors"
                  >
                    <LogIn size={16} />
                    {t('nav.login')}
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileOpen(false)}
                    className="h-11 rounded-xl bg-brand-gradient text-white font-bold text-sm flex items-center justify-center shadow-brand-soft"
                  >
                    {t('nav.signup')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

// ────────────────────────────────────────────────────────────────────
function MenuItem({
  to,
  icon: Icon,
  children,
  onClick,
}: {
  to: string;
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-ink-soft hover:bg-brand-50 hover:text-brand-700 transition-colors"
    >
      <Icon size={16} />
      {children}
    </Link>
  );
}

function MobileLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-ink-soft hover:bg-surface-bg'
      }`}
    >
      {children}
    </Link>
  );
}
