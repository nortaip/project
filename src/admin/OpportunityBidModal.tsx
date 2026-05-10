import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input } from '../components/ui';

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

/**
 * Yeni model: təklif vermək PULSUZDUR.
 * Komissiya:
 *   - Customer ödədikdə (commission_on_accept)
 *   - İş tamamlandıqda (commission_on_complete)
 *   - Nağdlaşdırmada (commission_on_withdrawal)
 * Bid zamanı heç bir balans yoxlanışı və ya tutulması olmur.
 */
export default function OpportunityBidModal({ opportunity, onClose }: Props) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const bidNum = parseFloat(amount) || 0;

  const handleBid = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!Number.isFinite(bidNum) || bidNum <= 0) {
      setError(t('bid.errors.invalidAmount'));
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError(t('bid.errors.userNotFound'));
      setSubmitting(false);
      return;
    }

    const { error: insertErr } = await supabase
      .from('opportunities_offers')
      .insert({
        opportunity_id: opportunity.id,
        offer_amount: bidNum,
        provider_id: user.id,
        status: 'pending',
      });

    if (insertErr) {
      setError(t('balance.errors.sessionFail') + ': ' + insertErr.message);
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
              disabled={submitting}
              autoFocus
            />
          </Field>

          {/* Yeni model: bid pulsuzdur, müştəri ödədiyi anda komissiya tutulur */}
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
              disabled={submitting || bidNum <= 0}
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
