import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, KeyRound, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Field, Input } from '../components/ui';

export function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Magic link recovery session yoxla
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        // Recovery session olmasa login-ə yönləndir
        navigate('/login');
      }
    });
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (password.length < 6) next.password = 'Minimum 6 simvol';
    if (password !== confirmPassword) next.confirm = 'Parollar uyğun gəlmir';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (e) {
      setErrors({
        password: e instanceof Error ? e.message : 'Yenilənmədi',
      });
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
          <ArrowLeft size={16} /> Daxil olmağa qayıt
        </Link>

        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
            <KeyRound size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink">
            Yeni parol təyin et
          </h1>
          <p className="mt-1 text-sm font-medium text-muted text-center">
            Hesabınız üçün yeni parol seçin
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-7">
          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-success/10 text-success flex items-center justify-center mb-4">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-lg font-extrabold text-ink mb-1">
                Parol uğurla yeniləndi! 🎉
              </h2>
              <p className="text-sm text-muted">
                Yeni parolla daxil olmağa yönləndirilirsən...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <Field
                label="Yeni parol"
                required
                icon={<Lock size={20} />}
                error={errors.password}
              >
                <Input
                  hasIcon
                  type="password"
                  placeholder="Minimum 6 simvol"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={Boolean(errors.password)}
                />
              </Field>

              <Field
                label="Parolu təkrar daxil et"
                required
                icon={<Lock size={20} />}
                error={errors.confirm}
              >
                <Input
                  hasIcon
                  type="password"
                  placeholder="Eyni parol"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  invalid={Boolean(errors.confirm)}
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                Parolu yenilə
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
