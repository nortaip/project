import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import InputMask from 'react-input-mask';
import {
  ArrowRight,
  Briefcase,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Wrench,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Field, Input } from '../components/ui';
import { SEO } from '../components/SEO';

interface Specialty {
  id: string;
  label: string;
}

type Role = 'customer' | 'provider';

export function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>('customer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+994');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [address, setAddress] = useState('');

  // Provider-only
  const [company, setCompany] = useState('');
  const [experience, setExperience] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void supabase
      .from('service_categories')
      .select('id, label')
      .order('label', { ascending: true })
      .then(({ data }) => setSpecialties((data ?? []) as Specialty[]));
  }, []);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Ad Soyad daxil edin';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = 'Düzgün email daxil edin';
    const raw = phone.replace(/\D/g, '');
    if (raw.length !== 12 || !raw.startsWith('994'))
      e.phone = 'Telefon: +994XXXXXXXXX';
    if (password.length < 6) e.password = 'Parol minimum 6 simvol';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate() || loading) return;
    setLoading(true);
    try {
      const formattedPhone = `+${phone.replace(/\D/g, '')}`;
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        phone: formattedPhone,
        password,
        options: {
          data: {
            name,
            role,
            address,
            email: email.trim() || null,
            birth_date: birthDate || null,
            company_name: role === 'provider' ? company : null,
            experience_years:
              role === 'provider' && experience ? parseInt(experience, 10) : 0,
            specialties: role === 'provider' ? selectedSpecialties : [],
          },
        },
      });

      if (signUpError) {
        message.error(`Qeydiyyat xətası: ${signUpError.message}`);
        return;
      }

      if (signUpData.user) {
        // Profile-i upsert et — handle_new_user trigger əsas məlumatları əlavə edir,
        // amma bu sahələr trigger-də yox idi, ona görə manual upsert
        await supabase.from('profiles').upsert(
          {
            id: signUpData.user.id,
            role,
            status: 'active',
            balance: 0,
            is_verified: false,
            email: email.trim() || null,
            name,
            phone_number: phone.replace(/\D/g, ''),
            address: address || null,
            birth_date: birthDate || null,
            company_name: role === 'provider' ? company : null,
            experience_years:
              role === 'provider' && experience ? parseInt(experience, 10) : 0,
            specialties: role === 'provider' ? selectedSpecialties : [],
          },
          { onConflict: 'id' },
        );

        message.success('Hesab yaradıldı!');
        navigate('/login', {
          state: { message: 'Zəhmət olmasa daxil olun.' },
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setSocialLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    } catch (e) {
      message.error(`${provider} ilə giriş alınmadı: ${
        e instanceof Error ? e.message : String(e)
      }`);
      setSocialLoading(false);
    }
  };

  const toggleSpecialty = (label: string) => {
    setSelectedSpecialties((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label],
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans relative overflow-hidden bg-auth-bg p-4">
      <SEO
        title={t('auth.signupTitle')}
        description={t('auth.signupSubtitle')}
        canonical="https://ellit.az/signup"
      />
      {/* Decorative orbs */}
      <div className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-brand-600 opacity-[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 w-[22rem] h-[22rem] rounded-full bg-accent-500 opacity-[0.06] blur-3xl" />

      <div className="relative z-10 w-full max-w-xl py-8">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-7">
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
            <Zap size={34} strokeWidth={2.5} fill="white" />
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink">
            {t('auth.signupTitle')}
          </h1>
          <p className="mt-1 text-sm font-medium text-muted">
            {t('auth.signupSubtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-6 sm:p-7">
          <form onSubmit={handleSubmit} noValidate>
            {/* Role selector */}
            <Field label="Hesab tipi" required>
              <div className="grid grid-cols-2 gap-2">
                {(['customer', 'provider'] as Role[]).map((r) => {
                  const selected = role === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`p-3 rounded-2xl border-[1.5px] flex items-center gap-2 transition-all ${
                        selected
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-border bg-white text-ink-soft hover:border-brand-300'
                      }`}
                    >
                      {r === 'customer' ? (
                        <User size={20} className={selected ? 'text-brand-600' : 'text-muted'} />
                      ) : (
                        <Wrench size={20} className={selected ? 'text-brand-600' : 'text-muted'} />
                      )}
                      <span className="font-bold">
                        {r === 'customer' ? 'Müştəri' : 'Provayder'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Name */}
            <Field
              label="Ad Soyad"
              required
              icon={<User size={20} />}
              error={errors.name}
            >
              <Input
                hasIcon
                placeholder="Adınız və soyadınız"
                value={name}
                onChange={(e) => setName(e.target.value)}
                invalid={Boolean(errors.name)}
              />
            </Field>

            {/* Email */}
            <Field label={t('auth.email')} icon={<Mail size={20} />} error={errors.email}>
              <Input
                hasIcon
                type="email"
                placeholder="example@mail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={Boolean(errors.email)}
              />
            </Field>

            {/* Phone */}
            <Field
              label={t('auth.phone')}
              required
              icon={<Phone size={20} />}
              error={errors.phone}
            >
              <InputMask
                mask="+994(99)9999999"
                maskChar={null}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              >
                {(inputProps: object) => (
                  <Input
                    {...inputProps}
                    type="tel"
                    hasIcon
                    placeholder="+994(50)1234567"
                    invalid={Boolean(errors.phone)}
                  />
                )}
              </InputMask>
            </Field>

            {/* Password */}
            <Field
              label="Parol"
              required
              icon={<Lock size={20} />}
              error={errors.password}
              rightAdornment={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-muted hover:text-brand-600 transition-colors"
                  aria-label={t('auth.password')}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              }
            >
              <Input
                hasIcon
                hasRightAdornment
                type={showPassword ? 'text' : 'password'}
                placeholder="Minimum 6 simvol"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={Boolean(errors.password)}
              />
            </Field>

            {/* Birth date + address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Doğum tarixi">
                <Input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </Field>
              <Field label="Ünvan" icon={<MapPin size={20} />}>
                <Input
                  hasIcon
                  placeholder="Bakı, ..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>
            </div>

            {/* Provider-only fields */}
            {role === 'provider' && (
              <div className="bg-brand-50/50 border border-brand-100 rounded-2xl p-4 -mx-1 mb-4 mt-1">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-700 mb-3">
                  Provayder məlumatları
                </p>
                <Field label="Şirkət adı" icon={<Briefcase size={20} />}>
                  <Input
                    hasIcon
                    placeholder="Şirkət (əgər varsa)"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </Field>
                <Field label="Təcrübə (il)" icon={<Wrench size={20} />}>
                  <Input
                    hasIcon
                    type="number"
                    min={0}
                    placeholder="5"
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                  />
                </Field>
                <Field
                  label="İxtisaslar"
                  hint="Birdən çox seçə bilərsən"
                >
                  <div className="flex flex-wrap gap-2">
                    {specialties.map((s) => {
                      const selected = selectedSpecialties.includes(s.label);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleSpecialty(s.label)}
                          className={`px-3 py-1.5 rounded-xl text-sm font-bold transition-all border ${
                            selected
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-ink-soft border-border hover:border-brand-300'
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={socialLoading}
              rightIcon={<ArrowRight size={18} />}
            >
              {t('auth.signupSubmit')}
            </Button>
          </form>

          {/* OR divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-semibold text-muted uppercase">{t('auth.or')}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Google */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            fullWidth
            onClick={() => handleOAuth('google')}
            loading={socialLoading}
            disabled={loading}
            leftIcon={<ShieldCheck size={18} />}
          >
            {t('auth.googleContinue')}
          </Button>

          {/* Login link */}
          <div className="mt-5 text-center">
            <span className="text-sm text-muted">{t('auth.haveAccount')}{'  '}</span>
            <Link
              to="/login"
              className="text-sm font-bold text-brand-600 hover:text-brand-700 underline decoration-brand-600 underline-offset-2"
            >
              {t('auth.loginLink')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Signup;
