import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input } from '../components/ui';
import { isVerified } from '../lib/kycService';

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

/**
 * Bid model:
 *   - Balansda məbləğ yoxdursa təklif bloklanır
 *   - Komissiya qəbul/tamamlama/withdrawal anında platform_revenue kimi tutulur
 */
export default function OpportunityBidModal({ opportunity, onClose }: Props) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const bidNum = parseFloat(amount) || 0;
  const insufficient = balance !== null && balance <= 0;

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) {
        setLoadingBalance(false);
        return;
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', uid)
        .maybeSingle();
      setBalance(Number(prof?.balance ?? 0));
      setLoadingBalance(false);

      // KYC statusu yoxla — gating üçün
      setVerified(await isVerified());
    })();
  }, []);

  const handleBid = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // KYC gating — verified deyilsə təklif verə bilmir
    if (verified === false) {
      setError(t('kyc.gating.body'));
      return;
    }

    if (!Number.isFinite(bidNum) || bidNum <= 0) {
      setError(t('bid.errors.invalidAmount'));
      return;
    }

    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('place_bid', {
      p_opportunity_id: opportunity.id,
      p_amount: bidNum,
    });

    if (rpcErr) {
      if (rpcErr.message.includes('NO_BALANCE')) {
        setError(
          'Təklif vermək üçün balansınızda məbləğ olmalıdır. Əvvəlcə balansı artırın.',
        );
      } else if (rpcErr.message.includes('row-level security')) {
        // RLS blok — yəqin KYC olmayıb
        setError(t('kyc.gating.body'));
      } else {
        setError(rpcErr.message);
      }
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setInfo(t('bid.success'));
    setTimeout(() => onClose(), 800);
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
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-surface-bg hover:bg-brand-50 flex items-center justify-center text-muted hover:text-brand-600 transition-colors"
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        <div className="mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-gradient text-white shadow-brand-soft mb-3">
            <DollarSign size={22} />
          </div>
          <h2 className="text-xl font-extrabold text-ink">{t('bid.title')}</h2>
          <p className="mt-1 text-sm text-muted line-clamp-2">{opportunity.title}</p>
        </div>

        {/* Balance status */}
        <div
          className={`mb-4 rounded-xl border p-3 ${
            insufficient
              ? 'bg-rose-50 border-rose-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet
                size={16}
                className={insufficient ? 'text-rose-600' : 'text-emerald-600'}
              />
              <span className="text-sm font-bold text-ink">
                Cari balansınız
              </span>
            </div>
            <span
              className={`font-extrabold ${
                insufficient ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {loadingBalance ? '…' : `${Number(balance ?? 0).toFixed(2)} ₼`}
            </span>
          </div>
          {insufficient && (
            <div className="mt-3 pt-3 border-t border-rose-200">
              <p className="text-xs text-rose-700 mb-2">
                <b>Təklif vermək üçün balansınızda məbləğ olmalıdır.</b>{' '}
                Əvvəlcə balansı artırın.
              </p>
              <Link
                to="/account/balance"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700"
              >
                Balansı artır
                <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>

        {verified === false && (
          <div className="mb-4 p-3 rounded-2xl bg-warning/10 border border-warning/30 flex items-start gap-2 text-sm">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" />
            <div className="flex-1">
              <div className="font-bold text-ink mb-1">{t('kyc.gating.title')}</div>
              <div className="text-ink/70 mb-2">{t('kyc.gating.body')}</div>
              <Link to="/kyc" className="text-primary font-bold underline">
                {t('kyc.gating.action')} →
              </Link>
            </div>
          </div>
        )}
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

        <form onSubmit={handleBid}>
          <Field label={t('bid.amountLabel')} required>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={submitting || insufficient}
              autoFocus
            />
          </Field>

          <p className="text-xs text-muted leading-relaxed -mt-2 mb-4">
            * {t('bid.freeBidNote')}
          </p>

          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <Button variant="outline" size="lg" onClick={onClose} disabled={submitting} fullWidth>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting || bidNum <= 0 || insufficient || loadingBalance}
              fullWidth
              rightIcon={<ArrowRight size={18} />}
            >
              {t('bid.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
