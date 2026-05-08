import { useEffect, useState, FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Loader2,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input } from '../components/ui';

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

const COMMISSION_RATE = 0.03; // 3% bid commission

export default function OpportunityBidModal({ opportunity, onClose }: Props) {
  const [stage, setStage] = useState<'bid' | 'topup'>('bid');
  const [amount, setAmount] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('5');
  const [userBalance, setUserBalance] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ── Fetch user + balance ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) {
        setError('İstifadəçi tapılmadı. Yenidən daxil olun.');
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data, error: balErr } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', user.id)
        .single();
      if (balErr) {
        setError('Balans məlumatı alınmadı.');
      } else if (data) {
        setUserBalance(Number(data.balance) || 0);
      }
      setLoading(false);
    })();
  }, []);

  const bidNum = parseFloat(amount) || 0;
  const requiredCommission = bidNum * COMMISSION_RATE;
  const sufficientBalance = userBalance >= requiredCommission;

  // ── Submit bid ────────────────────────────────────────────────
  const handleBid = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!userId) {
      setError('İstifadəçi tapılmadı.');
      return;
    }
    if (!Number.isFinite(bidNum) || bidNum <= 0) {
      setError('Düzgün məbləğ daxil edin.');
      return;
    }
    if (!sufficientBalance) {
      setStage('topup');
      // Top-up amount-u ən az lazım olan komissiya qədər təklif et
      setTopUpAmount(Math.max(5, Math.ceil(requiredCommission * 2)).toString());
      return;
    }

    setSubmitting(true);
    // 1. Insert offer
    const { error: insertErr } = await supabase.from('opportunities_offers').insert({
      opportunity_id: opportunity.id,
      offer_amount: bidNum,
      provider_id: userId,
    });
    if (insertErr) {
      setError('Təklif göndərilmədi: ' + insertErr.message);
      setSubmitting(false);
      return;
    }

    // 2. Atomic debit_balance RPC ilə komissiya tut
    const { data: newBalance, error: debitErr } = await supabase.rpc('debit_balance', {
      p_amount: requiredCommission,
      p_reason: `Bid komissiyası (opportunity ${opportunity.id})`,
      p_related_id: opportunity.id,
    });

    if (debitErr) {
      setError(
        'Təklif göndərildi, lakin balans tutulmadı. Dəstəklə əlaqə saxla.',
      );
    } else if (typeof newBalance === 'number') {
      setUserBalance(newBalance);
    }

    setSubmitting(false);
    setInfo('Təklif uğurla göndərildi!');
    setTimeout(() => onClose(), 800);
  };

  // ── Top-up via secure Edge Function ───────────────────────────
  const handleTopUp = async () => {
    setError(null);
    const amt = parseFloat(topUpAmount);
    if (!Number.isFinite(amt) || amt < 3) {
      setError('Minimum yükləmə məbləği 3 ₼-dir.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'create-payment-session',
        {
          body: {
            amount: amt,
            currency: 'AZN',
            purpose: 'balance_topup',
            return_url: `${window.location.origin}/payment/result`,
            description: 'Balans artırma (təklif komissiyası üçün)',
          },
        },
      );

      if (invokeErr) {
        const msg = String(invokeErr.message ?? '');
        if (msg.includes('Failed to send') || msg.includes('Failed to fetch')) {
          setError(
            'Ödəniş servisi əlçatan deyil. Edge Function deploy olunmalıdır.',
          );
        } else {
          setError('Ödəniş sessiyası yaradıla bilmədi: ' + msg);
        }
        setSubmitting(false);
        return;
      }
      if (!data) {
        setError('Boş cavab — yenidən cəhd et.');
        setSubmitting(false);
        return;
      }
      if (!data.redirect_url) {
        setError(
          data.mode === 'test'
            ? 'Ödəniş gateway-i hələ konfiqurasiya olunmayıb.'
            : 'Ödəniş gateway-i cavab vermədi.',
        );
        setSubmitting(false);
        return;
      }

      window.location.href = data.redirect_url as string;
    } catch (e) {
      setError('Ödəniş zamanı xəta baş verdi.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <Card
        variant="elevated"
        padding="lg"
        className="w-full max-w-md relative"
        // @ts-expect-error: pass through onClick
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-surface-bg hover:bg-brand-50 flex items-center justify-center text-muted hover:text-brand-600 transition-colors"
          aria-label="Bağla"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-gradient text-white shadow-brand-soft mb-3">
            {stage === 'bid' ? <DollarSign size={22} /> : <Wallet size={22} />}
          </div>
          <h2 className="text-xl font-extrabold text-ink">
            {stage === 'bid' ? 'Təklif ver' : 'Balansı artır'}
          </h2>
          {stage === 'bid' && (
            <p className="mt-1 text-sm text-muted line-clamp-2">{opportunity.title}</p>
          )}
        </div>

        {/* Error / info */}
        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-danger/5 border border-danger/20 flex items-start gap-2 text-sm text-danger">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 rounded-2xl bg-success/5 border border-success/20 text-sm text-success font-bold">
            {info}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={22} className="animate-spin text-brand-600" />
          </div>
        ) : stage === 'bid' ? (
          <form onSubmit={handleBid}>
            <Field label="Təklif məbləği" required hint={`Komissiya: ${requiredCommission.toFixed(2)} ₼ (${COMMISSION_RATE * 100}%)`}>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={submitting}
                autoFocus
              />
            </Field>

            <BalanceCard userBalance={userBalance} required={requiredCommission} sufficient={sufficientBalance || bidNum === 0} />

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3">
              <Button variant="outline" size="lg" onClick={onClose} disabled={submitting} fullWidth>
                Ləğv et
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                disabled={submitting || bidNum <= 0}
                fullWidth
                rightIcon={<ArrowRight size={18} />}
              >
                Təklifi göndər
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="mb-4 p-4 rounded-2xl bg-warning/5 border border-warning/20">
              <p className="text-sm text-ink-soft">
                Təklif vermək üçün ən az{' '}
                <span className="font-extrabold text-warning">{requiredCommission.toFixed(2)} ₼</span>{' '}
                balans lazımdır. Hazırda balansın{' '}
                <span className="font-extrabold">{userBalance.toFixed(2)} ₼</span>.
              </p>
            </div>

            <Field label="Yükləmə məbləği" required hint="Minimum 3 ₼">
              <Input
                type="number"
                min="3"
                step="1"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </Field>

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setStage('bid');
                  setError(null);
                }}
                disabled={submitting}
                fullWidth
              >
                Geri
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={handleTopUp}
                loading={submitting}
                disabled={submitting}
                fullWidth
                rightIcon={<ArrowRight size={18} />}
              >
                Banka keç
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function BalanceCard({
  userBalance,
  required,
  sufficient,
}: {
  userBalance: number;
  required: number;
  sufficient: boolean;
}) {
  return (
    <div
      className={`mt-2 p-4 rounded-2xl border ${
        sufficient
          ? 'bg-brand-50 border-brand-100 text-brand-700'
          : 'bg-warning/5 border-warning/20 text-warning'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5">
          <Wallet size={14} />
          Cari balans
        </span>
        <span className="text-base font-extrabold">{userBalance.toFixed(2)} ₼</span>
      </div>
      {required > 0 && (
        <div className="mt-1 flex items-center justify-between gap-3 text-xs">
          <span>Tələb olunan komissiya</span>
          <span className="font-bold">{required.toFixed(2)} ₼</span>
        </div>
      )}
    </div>
  );
}
