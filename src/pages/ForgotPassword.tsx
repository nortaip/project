import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  Smartphone,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { Button, Field, Input } from '../components/ui';

/**
 * Parolu unutdum — OTP əsaslı axın (mobil ilə eyni mexanizm):
 *   1) Email daxil edilir → server istifadəçinin telefonu varsa 6 rəqəmli
 *      kodu MOBİL TƏTBİQƏ bildiriş kimi göndərir (channel='push');
 *      telefon yoxdursa avtomatik EMAIL keçidi fallback-ı işləyir.
 *   2) Kod + yeni parol → server parolu yeniləyir (bütün sessiyalar bağlanır).
 */
type Step = 'email' | 'otp' | 'done' | 'emailSent';

export function ForgotPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const sendEmailFallback = async (addr: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: window.location.origin + '/reset-password',
    });
    if (error) throw error;
    setStep('emailSent');
  };

  const handleRequest = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrors({ email: 'Düzgün email daxil edin' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('request_password_reset_otp', {
        p_email: trimmed,
      });
      if (error) throw error;
      const res = (data ?? {}) as { ok?: boolean; channel?: string; error?: string };
      if (res.ok === false) {
        if (res.error === 'RATE_LIMITED') {
          setErrors({ email: 'Çox cəhd — 1 saat sonra yenidən yoxlayın' });
        } else {
          setErrors({ email: 'Kod göndərilə bilmədi' });
        }
        return;
      }
      if (res.channel === 'push') {
        setStep('otp');
        setResendIn(60);
      } else {
        // Telefon qeydiyyatda deyil → email keçidi fallback-ı
        await sendEmailFallback(trimmed);
      }
    } catch (err) {
      message.error(
        `${t('errors.generic')}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (otp.replace(/\D/g, '').length !== 6) next.otp = '6 rəqəmli kodu daxil edin';
    if (password.length < 8) next.password = 'Minimum 8 simvol';
    if (password !== confirm) next.confirm = 'Parollar uyğun gəlmir';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('reset_password_with_otp', {
        p_email: email.trim(),
        p_otp: otp,
        p_new_password: password,
      });
      if (error) throw error;
      const res = (data ?? {}) as { ok?: boolean; error?: string; attempts_left?: number };
      if (res.ok !== true) {
        const map: Record<string, string> = {
          WRONG_CODE: `Kod yanlışdır${res.attempts_left != null ? ` (${res.attempts_left} cəhd qaldı)` : ''}`,
          EXPIRED: 'Kodun vaxtı bitib — yenidən göndərin',
          TOO_MANY_ATTEMPTS: 'Çox yanlış cəhd — yeni kod istəyin',
          NO_OTP: 'Aktiv kod yoxdur — yenidən göndərin',
          PASSWORD_TOO_SHORT: 'Parol minimum 8 simvol olmalıdır',
        };
        setErrors({ otp: map[res.error ?? ''] ?? 'Yenilənmədi — yenidən cəhd edin' });
        return;
      }
      setStep('done');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      message.error(
        `${t('errors.generic')}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans relative overflow-hidden bg-auth-bg p-4">
      <div className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-brand-600 opacity-[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 w-[22rem] h-[22rem] rounded-full bg-accent-500 opacity-[0.06] blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-brand-600 mb-3"
        >
          <ArrowLeft size={16} /> {t('forgot.backToLogin')}
        </Link>

        <div className="flex flex-col items-center mb-7">
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
            {step === 'otp' ? <Smartphone size={32} strokeWidth={2.5} /> : <KeyRound size={32} strokeWidth={2.5} />}
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink text-center">
            Şifrəni unutmusan?
          </h1>
          <p className="mt-1 text-sm font-medium text-muted text-center max-w-sm">
            {step === 'otp'
              ? 'Kod mobil tətbiqinizə bildiriş kimi göndərildi'
              : 'Email ünvanını daxil et — təsdiq kodu telefonuna göndəriləcək'}
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-7">
          {step === 'done' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-success/10 text-success flex items-center justify-center mb-4">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-lg font-extrabold text-ink mb-1">
                Parol yeniləndi ✓
              </h2>
              <p className="text-sm text-muted">
                Yeni parolunuzla daxil ola bilərsiniz. Yönləndirilirsiniz...
              </p>
            </div>
          )}

          {step === 'emailSent' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-success/10 text-success flex items-center justify-center mb-4">
                <Mail size={32} />
              </div>
              <h2 className="text-lg font-extrabold text-ink mb-1">Email göndərildi</h2>
              <p className="text-sm text-muted">
                {email} ünvanına parolu yeniləmək üçün keçid göndərdik. Poçt
                qutunu (spam daxil) yoxla.
              </p>
              <Link
                to="/login"
                className="inline-block mt-5 text-sm font-bold text-brand-600 hover:text-brand-700"
              >
                {t('forgot.backToLogin')}
              </Link>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={handleRequest} noValidate>
              <Field label="Email" required icon={<Mail size={20} />} error={errors.email}>
                <Input
                  hasIcon
                  type="email"
                  autoComplete="email"
                  placeholder="email@nümunə.az"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  invalid={Boolean(errors.email)}
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
                Kod göndər
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleReset} noValidate className="space-y-4">
              <div className="bg-brand-50 border border-brand-100 rounded-2xl p-3 text-sm text-brand-800 flex items-center gap-2">
                <Smartphone size={18} className="shrink-0" />
                <span>
                  6 rəqəmli kod <b>telefonunuza bildiriş kimi</b> göndərildi (5
                  dəqiqə etibarlıdır)
                </span>
              </div>

              <Field label="Təsdiq kodu" required error={errors.otp}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  className="text-center text-2xl font-extrabold tracking-[0.5em]"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  invalid={Boolean(errors.otp)}
                />
              </Field>

              <Field label="Yeni parol" required icon={<Lock size={20} />} error={errors.password}>
                <Input
                  hasIcon
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimum 8 simvol"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={Boolean(errors.password)}
                />
              </Field>

              <Field label="Parolu təkrarla" required icon={<Lock size={20} />} error={errors.confirm}>
                <Input
                  hasIcon
                  type="password"
                  autoComplete="new-password"
                  placeholder="Yeni parolu təkrarla"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  invalid={Boolean(errors.confirm)}
                />
              </Field>

              <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
                Parolu yenilə
              </Button>

              <div className="flex items-center justify-between text-sm pt-1">
                <button
                  type="button"
                  disabled={resendIn > 0 || loading}
                  onClick={() => void handleRequest()}
                  className="font-bold text-brand-600 hover:text-brand-700 disabled:text-muted disabled:cursor-not-allowed"
                >
                  {resendIn > 0 ? `Yenidən göndər (${resendIn}s)` : 'Kodu yenidən göndər'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setLoading(true);
                    void sendEmailFallback(email.trim())
                      .catch((err) =>
                        message.error(err instanceof Error ? err.message : String(err)),
                      )
                      .finally(() => setLoading(false));
                  }}
                  className="font-bold text-muted hover:text-ink"
                >
                  Kod gəlmir? Email ilə bərpa
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
