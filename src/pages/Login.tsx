import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import InputMask from 'react-input-mask';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SEO } from '../components/SEO';

interface LocationState {
  message?: string;
}

type LoginMethod = 'phone' | 'email';

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;

  const [loginMethod, setLoginMethod] = useState<LoginMethod>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Toast from prior page (e.g., signup success)
  useEffect(() => {
    if (state?.message) {
      message.success(state.message);
    }
  }, [state]);

  // Auto-redirect if already signed in (also handles OAuth callback)
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        await persistSessionAndRedirect(session.user);
      }
    };
    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          await persistSessionAndRedirect(session.user);
        }
      },
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistSessionAndRedirect = async (user: { id: string; phone?: string }) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, phone_number, avatar_url')
        .eq('id', user.id)
        .single();

      const userSessionData = {
        ...user,
        user_metadata: {
          name: profile?.name ?? null,
          phone_number: profile?.phone_number ?? user.phone ?? null,
          avatar_url: profile?.avatar_url ?? null,
        },
      };

      localStorage.setItem('user', JSON.stringify(userSessionData));
      localStorage.setItem('isLoggedIn', 'true');
    } catch {
      // ignore profile load failure — still log in
    }
    navigate('/');
    window.location.reload();
  };

  // ── Validation ──────────────────────────────────────────────────────
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (loginMethod === 'phone') {
      const raw = phone.replace(/\D/g, '');
      if (!raw) next.phone = 'Telefon nömrəsini daxil edin';
      else if (!(raw.length === 12 && phone.startsWith('+994')))
        next.phone = 'Telefon nömrəsi düzgün formatda deyil: +994XXXXXXXXX';
    } else {
      if (!email.trim()) next.email = 'Email daxil edin';
      else if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim()))
        next.email = 'Düzgün email daxil edin';
    }
    if (!password.trim()) next.password = 'Parolu daxil edin';
    else if (password.length < 6)
      next.password = 'Parol ən azı 6 simvol olmalıdır';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // ── Submit (email/phone + password) ─────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate() || loading) return;
    setLoading(true);
    try {
      const authParams: { password: string; email?: string; phone?: string } = {
        password,
      };
      if (loginMethod === 'phone') {
        const raw = phone.replace(/\D/g, '');
        authParams.phone = raw.startsWith('+') ? raw : `+${raw}`;
      } else {
        authParams.email = email.trim();
      }

      const { data, error } = await supabase.auth.signInWithPassword(authParams);
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid login credentials')) {
          message.error('Telefon/email və ya parol yanlışdır.');
        } else {
          message.error(`Giriş xətası: ${error.message}`);
        }
        return;
      }
      if (data.user && data.session) {
        message.success('Giriş uğurludur!');
        // Redirect happens via onAuthStateChange listener
      }
    } catch (err) {
      console.error('Login error:', err);
      message.error('Gözlənilməz xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  // ── OAuth (Google / Apple) ──────────────────────────────────────────
  const handleOAuth = async (provider: 'google' | 'apple') => {
    if (socialLoading || loading) return;
    setSocialLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(
        `${provider === 'google' ? 'Gmail' : 'Apple'} ilə giriş alınmadı: ${msg}`,
      );
      setSocialLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans relative overflow-hidden bg-gradient-to-br from-[#F0F5FF] via-[#FAFCFF] to-[#F7F9FF] p-4">
      <SEO
        title={t('auth.loginTitle')}
        description={t('auth.loginSubtitle')}
        canonical="https://ellit.az/login"
      />
      {/* Decorative blurred orbs (Flutter parity) */}
      <div className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-[#2563EB] opacity-[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 w-[22rem] h-[22rem] rounded-full bg-[#06B6D4] opacity-[0.06] blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-12 w-44 h-44 rounded-full bg-[#2563EB] opacity-[0.05] blur-3xl" />

      <div className="relative z-10 w-full max-w-lg">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-7">
          <div
            className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-[0_8px_24px_rgba(37,99,235,0.35)]"
            style={{
              background:
                'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)',
            }}
          >
            <Zap size={34} strokeWidth={2.5} fill="white" />
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-[#0A0F1E]">
            {t('auth.loginTitle')}
          </h1>
          <p className="mt-1 text-sm font-medium text-[#9CA3AF]">
            {t('auth.loginSubtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl border border-[#E5E9F2] shadow-[0_16px_40px_rgba(37,99,235,0.06),0_4px_10px_rgba(0,0,0,0.04)] p-7">
          {/* Method toggle */}
          <div className="bg-[#F8FAFF] rounded-2xl border border-[#E5E9F2] flex h-12 mb-5">
            <ToggleTab
              label={t('auth.phone')}
              icon={<Phone size={16} />}
              selected={loginMethod === 'phone'}
              onClick={() => {
                setLoginMethod('phone');
                setErrors({});
              }}
            />
            <ToggleTab
              label={t('auth.email')}
              icon={<Mail size={16} />}
              selected={loginMethod === 'email'}
              onClick={() => {
                setLoginMethod('email');
                setErrors({});
              }}
            />
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {/* Phone / Email field */}
            {loginMethod === 'phone' ? (
              <Field error={errors.phone} icon={<Phone size={20} />}>
                <InputMask
                  mask="+994999999999"
                  maskChar="_"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                >
                  {(inputProps: object) => (
                    <input
                      {...inputProps}
                      type="tel"
                      placeholder="+994 XX XXX XX XX"
                      className="w-full pl-12 pr-4 py-4 rounded-2xl bg-[#F8FAFF] border-[1.5px] border-[#E5E9F2] focus:border-[#2563EB] focus:bg-white outline-none text-[15px] font-medium text-[#0A0F1E] placeholder-[#9CA3AF] transition-colors"
                    />
                  )}
                </InputMask>
              </Field>
            ) : (
              <Field error={errors.email} icon={<Mail size={20} />}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.email')}
                  className="w-full pl-12 pr-4 py-4 rounded-2xl bg-[#F8FAFF] border-[1.5px] border-[#E5E9F2] focus:border-[#2563EB] focus:bg-white outline-none text-[15px] font-medium text-[#0A0F1E] placeholder-[#9CA3AF] transition-colors"
                />
              </Field>
            )}

            {/* Password field */}
            <Field error={errors.password} icon={<Lock size={20} />}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.password')}
                className="w-full pl-12 pr-12 py-4 rounded-2xl bg-[#F8FAFF] border-[1.5px] border-[#E5E9F2] focus:border-[#2563EB] focus:bg-white outline-none text-[15px] font-medium text-[#0A0F1E] placeholder-[#9CA3AF] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#2563EB] transition-colors"
                aria-label={t('auth.password')}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </Field>

            {/* Forgot password */}
            <div className="flex justify-end -mt-1 mb-5">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
              >
                {t('auth.forgot')}
              </Link>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || socialLoading}
              className="w-full h-13 py-3.5 rounded-2xl text-white font-extrabold text-[15px] tracking-wide flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_6px_16px_rgba(37,99,235,0.38)]"
              style={{
                background: loading
                  ? '#E5E9F2'
                  : 'linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #06B6D4 100%)',
              }}
            >
              {loading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-[#9CA3AF] border-t-transparent rounded-full animate-spin" />
                  <span>{t('common.loading')}</span>
                </>
              ) : (
                <>
                  <span>{t('auth.loginSubmit')}</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-[#E5E9F2]" />
            <span className="text-xs font-semibold text-[#9CA3AF] uppercase">
              {t('auth.or')}
            </span>
            <div className="flex-1 h-px bg-[#E5E9F2]" />
          </div>

          {/* Social buttons */}
          <div className="space-y-2.5">
            <SocialButton
              label={t('auth.googleContinue')}
              loading={socialLoading}
              onClick={() => handleOAuth('google')}
              icon={<GoogleIcon />}
              variant="light"
            />
            <SocialButton
              label={t('auth.appleContinue')}
              loading={socialLoading}
              onClick={() => handleOAuth('apple')}
              icon={<AppleIcon />}
              variant="dark"
            />
          </div>

          {/* Register link */}
          <div className="mt-6 text-center">
            <span className="text-sm text-[#9CA3AF]">
              {t('auth.noAccount')}{'  '}
            </span>
            <Link
              to="/signup"
              className="text-sm font-bold text-[#2563EB] hover:text-[#1D4ED8] underline decoration-[#2563EB] underline-offset-2 transition-colors"
            >
              {t('auth.signupLink')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reusable bits ─────────────────────────────────────────────────────

function ToggleTab({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 m-1 rounded-xl flex items-center justify-center gap-1.5 text-[13px] transition-all duration-200 ${
        selected
          ? 'bg-white text-[#0A0F1E] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.07)]'
          : 'text-[#9CA3AF] font-medium hover:text-[#0A0F1E]'
      }`}
    >
      <span className={selected ? 'text-[#2563EB]' : 'text-[#9CA3AF]'}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Field({
  children,
  icon,
  error,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="mb-4">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none">
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p className="mt-1.5 ml-1 text-xs font-semibold text-[#EF4444]">
          {error}
        </p>
      )}
    </div>
  );
}

function SocialButton({
  label,
  icon,
  onClick,
  loading,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  loading: boolean;
  variant: 'light' | 'dark';
}) {
  const isDark = variant === 'dark';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`w-full h-[50px] rounded-2xl flex items-center justify-center gap-2.5 font-bold text-[14.5px] transition-all active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed border-[1.5px] ${
        isDark
          ? 'bg-black text-white border-black hover:bg-[#0A0A0A]'
          : 'bg-white text-[#0A0F1E] border-[#E5E9F2] hover:bg-[#F8FAFF]'
      }`}
    >
      {loading ? (
        <span className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          {icon}
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

export default Login;
