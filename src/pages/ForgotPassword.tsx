import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { Button, Field, Input } from '../components/ui';

export function ForgotPassword() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSendEmail = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrors({ email: 'Düzgün email daxil edin' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
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

        {/* Brand mark */}
        <div className="flex flex-col items-center mb-7">
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
            <Mail size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink text-center">
            Şifrəni unutmusan?
          </h1>
          <p className="mt-1 text-sm font-medium text-muted text-center max-w-sm">
            Email ünvanını daxil et — parolu yeniləmək üçün keçid göndərəcəyik
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-7">
          {sent ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-success/10 text-success flex items-center justify-center mb-4">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-lg font-extrabold text-ink mb-1">Email göndərildi</h2>
              <p className="text-sm text-muted">
                {email} ünvanına parolu yeniləmək üçün keçid göndərdik. Poçt qutunu
                (spam qovluğu daxil olmaqla) yoxla.
              </p>
              <Link
                to="/login"
                className="inline-block mt-5 text-sm font-bold text-brand-600 hover:text-brand-700"
              >
                {t('forgot.backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSendEmail} noValidate>
              <Field
                label="Email"
                required
                icon={<Mail size={20} />}
                error={errors.email}
              >
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

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                Keçid göndər
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
