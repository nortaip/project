import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, ShieldCheck, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { money } from '../lib/format';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageContainer,
} from '../components/ui';

/**
 * BALANS ARTIRMA — TƏHLÜKƏSIZ AXIN
 *
 * Köhnə versiyada client `profiles.balance`-i birbaşa update edirdi (kritik
 * təhlükəsizlik problemi C3 — pentest tapıntısı). Migration
 * `20260508_security_hardening.sql` bu sütunda UPDATE icazəsini ləğv edir.
 *
 * Yeni axın:
 *   1. İstifadəçi məbləğ daxil edir
 *   2. Frontend Edge Function `create-payment-session`-ı çağırır
 *   3. Function KapitalBank/Epoint-də payment session yaradır
 *   4. İstifadəçi bank səhifəsinə yönləndirilir
 *   5. Bank uğurlu ödəniş üçün webhook çağırır
 *   6. Webhook SECURITY DEFINER funksiya ilə balansa əlavə edir
 *
 * Hələ Edge Function deploy olunmadığı üçün bu səhifə "soon" mesajı göstərir.
 * Phase 3 tamamlananda real inteqrasiya əlavə olunacaq.
 */
export default function UpdateBalance() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number>(0);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', user.id)
        .single();
      setBalance(Number(data?.balance ?? 0));
    };
    load();
  }, [user, navigate]);

  const handleTopUp = async () => {
    setError(null);
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError('Düzgün məbləğ daxil edin (0-dan böyük olmalıdır)');
      return;
    }
    if (parsed > 10_000) {
      setError('Maksimum bir əməliyyatda 10,000 AZN');
      return;
    }
    setLoading(true);
    try {
      // Edge Function payment session yaradacaq.
      // Backend bank gateway-ə qoşuluqdan sonra implementasiya olunur.
      const { data, error: fnError } = await supabase.functions.invoke(
        'create-payment-session',
        { body: { amount: parsed, currency: 'AZN' } },
      );
      if (fnError) throw fnError;
      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setError(
          'Ödəniş inteqrasiyası hələ aktiv deyil. Tezliklə açılacaq.',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Xəta: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer size="md">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
          Balans artırma
        </h1>
        <p className="mt-1 text-sm text-muted">
          Bank kartınızla təhlükəsiz şəkildə balansınızı artırın
        </p>
      </div>

      {/* Cari balans */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <Wallet size={26} />
          </div>
          <div>
            <span className="text-xs uppercase font-bold tracking-wide text-muted">
              Cari balans
            </span>
            <div className="text-3xl font-extrabold text-ink mt-0.5">
              {money(balance)} <span className="text-base text-muted">AZN</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Top-up form */}
      <Card variant="default" padding="lg">
        <CardHeader
          title="Məbləğ artır"
          subtitle="Minimum 1 AZN, maksimum 10,000 AZN"
        />

        <Field
          label="Məbləğ (AZN)"
          icon={<CreditCard size={20} />}
          error={error ?? undefined}
        >
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            max={10000}
            step="0.01"
            placeholder="50.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hasIcon
            invalid={Boolean(error)}
          />
        </Field>

        <div className="flex gap-2 mb-5 flex-wrap">
          {[10, 25, 50, 100, 250].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className="px-3 py-1.5 rounded-xl bg-surface-alt border border-border text-sm font-bold text-ink-soft hover:border-brand-600 hover:text-brand-600 transition-colors"
            >
              {v} AZN
            </button>
          ))}
        </div>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          onClick={handleTopUp}
          leftIcon={<ShieldCheck size={18} />}
        >
          Banka köçürül
        </Button>

        <p className="mt-4 text-xs text-muted text-center">
          🔒 Ödəniş bank gateway-i (KapitalBank / Epoint) tərəfindən idarə
          olunur. Kart məlumatlarınız bizim serverimizə çatmır.
        </p>
      </Card>
    </PageContainer>
  );
}
