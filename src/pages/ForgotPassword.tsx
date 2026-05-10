import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, Phone, Zap } from 'lucide-react';
import { message } from 'antd';
import InputMask from 'react-input-mask';
import { supabase } from '../lib/supabase';
import { Button, Field, Input } from '../components/ui';

type Step = 'phone' | 'otp';

export function ForgotPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+994');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSendOtp = async (e: FormEvent) => {
    e.preventDefault();
    const raw = phone.replace(/\D/g, '');
    if (!(raw.length === 12 && phone.startsWith('+994'))) {
      setErrors({ phone: t('forgot.phoneInvalid') });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'reset-password-by-phone',
        {
          body: { action: 'request_otp', phone_number: phone },
        },
      );
      if (error) throw error;
      if (data?.success) {
        message.success(data.message || t('forgot.otpSent'));
        setStep('otp');
      } else {
        message.error(data?.message || t('forgot.otpFailed'));
      }
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!otp.trim()) next.otp = t('forgot.otpRequired');
    if (newPassword.length < 6) next.password = t('forgot.passwordTooShort');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'reset-password-by-phone',
        {
          body: {
            action: 'reset_password',
            phone_number: phone,
            otp_code: otp,
            new_password: newPassword,
          },
        },
      );
      if (error) throw error;
      if (data?.success) {
        message.success(t('forgot.passwordReset'));
        navigate('/login');
      } else {
        message.error(data?.message || t('forgot.otpInvalid'));
      }
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
            {step === 'phone' ? (
              <Phone size={32} strokeWidth={2.5} />
            ) : (
              <KeyRound size={32} strokeWidth={2.5} />
            )}
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink text-center">
            {step === 'phone' ? t('forgot.phoneTitle') : t('forgot.otpTitle')}
          </h1>
          <p className="mt-1 text-sm font-medium text-muted text-center max-w-sm">
            {step === 'phone'
              ? t('forgot.phoneSubtitle')
              : t('forgot.otpSubtitle', { phone })}
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-7">
          {step === 'phone' ? (
            <form onSubmit={handleSendOtp} noValidate>
              <Field
                label={t('forgot.phoneLabel')}
                required
                icon={<Phone size={20} />}
                error={errors.phone}
                hint={t('forgot.phoneHint')}
              >
                <InputMask
                  mask="+994999999999"
                  maskChar={null}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                >
                  {(inputProps: object) => (
                    <Input
                      {...inputProps}
                      type="tel"
                      hasIcon
                      placeholder="+994 XX XXX XX XX"
                      invalid={Boolean(errors.phone)}
                    />
                  )}
                </InputMask>
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                {t('forgot.sendOtp')}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} noValidate>
              <Field
                label={t('forgot.otpLabel')}
                required
                icon={<KeyRound size={20} />}
                error={errors.otp}
              >
                <Input
                  hasIcon
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('forgot.otpPlaceholder')}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  invalid={Boolean(errors.otp)}
                  className="font-mono text-lg tracking-widest"
                />
              </Field>

              <Field
                label={t('forgot.newPasswordLabel')}
                required
                icon={<Lock size={20} />}
                error={errors.password}
              >
                <Input
                  hasIcon
                  type="password"
                  placeholder={t('forgot.passwordPlaceholder')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  invalid={Boolean(errors.password)}
                />
              </Field>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => setStep('phone')}
                  disabled={loading}
                >
                  {t('common.back')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={loading}
                >
                  {t('forgot.resetSubmit')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
