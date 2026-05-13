import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Phone, User as UserIcon, UserCheck, Wrench } from 'lucide-react';
import { message } from 'antd';
import InputMask from 'react-input-mask';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Button, Field, Input, PageContainer } from '../components/ui';

type Role = 'customer' | 'provider';

export function CompleteProfile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [role, setRole] = useState<Role>('customer');

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate('/signup');
        return;
      }
      setUser(session.user);

      // 1. auth.users.user_metadata-dan (Google/Apple OAuth) auto-fill
      const meta = session.user.user_metadata ?? {};
      const pick = (...candidates: unknown[]): string => {
        for (const c of candidates) {
          if (c == null) continue;
          const s = String(c).trim();
          if (s) return s;
        }
        return '';
      };

      const metaName = pick(
        meta.name,
        meta.full_name,
        meta.given_name,
      );
      const metaPhone = pick(meta.phone, meta.phone_number, session.user.phone);

      // 2. Mövcud profile cədvəlindən də oxu (köhnə dəyərlər varsa)
      const { data: existing } = await supabase
        .from('profiles')
        .select('name, phone_number, address, birth_date, role')
        .eq('id', session.user.id)
        .maybeSingle();

      const finalName = pick(existing?.name, metaName);
      const finalPhone = pick(existing?.phone_number, metaPhone);

      if (finalName) setName(finalName);
      if (finalPhone) {
        // +994... formatına gətir
        const digits = finalPhone.replace(/\D/g, '');
        setPhone(digits.startsWith('994') ? `+${digits}` : `+994${digits}`);
      } else {
        setPhone('+994');
      }
      if (existing?.address) setAddress(existing.address);
      if (existing?.birth_date) setBirthDate(existing.birth_date);
      if (existing?.role) setRole(existing.role as typeof role);
    })();
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Ad Soyad daxil edin';
    if (phone) {
      const raw = phone.replace(/\D/g, '');
      if (raw.length !== 12 || !raw.startsWith('994'))
        next.phone = 'Telefon: +994XXXXXXXXX';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const wantsProvider = role === 'provider';

      // Auth metadata yenilə (provider seçilibsə də ad qalır, role pending)
      await supabase.auth.updateUser({
        data: { name, role: wantsProvider ? 'customer' : role },
      });

      // Profile cədvəlinə upsert — provayder isə role 'customer' qalır
      const { error } = await supabase.from('profiles').upsert(
        {
          id: user.id,
          email: user.email ?? null,
          name,
          role: wantsProvider ? 'customer' : role,
          phone_number: phone ? phone.replace(/\D/g, '') : null,
          address: address || null,
          birth_date: birthDate || null,
          status: 'active',
          balance: 0,
          is_verified: false,
        },
        { onConflict: 'id' },
      );
      if (error) throw error;

      if (wantsProvider) {
        const { error: rpcErr } = await supabase.rpc('request_provider_role', {
          p_message: null,
          p_company_name: null,
          p_experience_years: null,
          p_specialties: [],
        });
        if (rpcErr && !rpcErr.message?.includes('artıq aktiv müraciətiniz')) {
          throw rpcErr;
        }
        message.success(
          'Profil tamamlandı. Provayder statusu admin təsdiqindən sonra aktivləşəcək.',
        );
      } else {
        message.success('Profil tamamlandı!');
      }
      navigate('/account');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-auth-bg">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-auth-bg relative overflow-hidden">
      <div className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-brand-600 opacity-[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 w-[22rem] h-[22rem] rounded-full bg-accent-500 opacity-[0.06] blur-3xl" />

      <PageContainer size="md" className="relative z-10">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
            <UserCheck size={32} strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-ink">
            Profili tamamla
          </h1>
          <p className="mt-1 text-sm font-medium text-muted text-center">
            Bu məlumatlar sifariş verərkən tələb olunur
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-border shadow-card-lg p-6 sm:p-7">
          <form onSubmit={handleSubmit} noValidate>
            {/* Role */}
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
                        <UserIcon size={18} className={selected ? 'text-brand-600' : 'text-muted'} />
                      ) : (
                        <Wrench size={18} className={selected ? 'text-brand-600' : 'text-muted'} />
                      )}
                      <span className="font-bold text-sm">
                        {r === 'customer' ? 'Müştəri' : 'Provayder'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Ad Soyad"
              required
              icon={<UserIcon size={20} />}
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

            <Field label="Telefon" icon={<Phone size={20} />} error={errors.phone}>
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

            <Field label="Doğum tarixi" icon={<Calendar size={20} />}>
              <Input
                hasIcon
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Field>

            <Field label="Ünvan" icon={<MapPin size={20} />}>
              <Input
                hasIcon
                placeholder="Bakı, küçə, ev nömrəsi"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
            >
              Profili tamamla
            </Button>
          </form>
        </div>
      </PageContainer>
    </div>
  );
}

export default CompleteProfile;
