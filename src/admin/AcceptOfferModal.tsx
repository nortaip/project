import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  CreditCard,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Props {
  offerId: string;
  amount: number;
  providerName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Method = 'cash' | 'card';

/**
 * Müştərinin təklifi qəbul etməsi üçün modal.
 *   - Nağd: birbaşa təsdiqlə, balans yoxlamaq lazım deyil
 *   - Kart: balans yoxlanılır, yetərsizdirsə "Balansı artır" linki
 */
export default function AcceptOfferModal({
  offerId,
  amount,
  providerName,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('card');
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [safetyAgreed, setSafetyAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', uid)
        .maybeSingle();
      setBalance(Number(prof?.balance ?? 0));
      setLoading(false);
    })();
  }, []);

  const insufficient =
    method === 'card' && balance != null && balance < amount;
  const shortfall = insufficient ? amount - (balance ?? 0) : 0;

  async function submit() {
    setError(null);
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('accept_offer_with_payment', {
      p_offer_id: offerId,
      p_method: method,
    });
    setSubmitting(false);
    if (rpcErr) {
      if (rpcErr.message.includes('INSUFFICIENT_BALANCE')) {
        setError(
          t('acceptOffer.insufficient', {
            defaultValue:
              'Balansınız yetərli deyil. Əvvəlcə balansı artırın və ya nağd seçin.',
          }),
        );
      } else {
        setError(rpcErr.message);
      }
      return;
    }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-extrabold text-ink text-lg">
            {t('acceptOffer.title', { defaultValue: 'Ödəniş üsulu' })}
          </h3>
          {providerName && (
            <p className="text-sm text-muted mt-1">
              <b>{providerName}</b>{' '}
              {t('acceptOffer.providerHint', {
                defaultValue: 'üçün təklif qəbul olunur',
              })}
            </p>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Amount summary */}
          <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 p-4 border border-brand-100 text-center">
            <p className="text-xs font-bold text-muted uppercase tracking-wide">
              {t('acceptOffer.totalAmount', { defaultValue: 'Sifariş məbləği' })}
            </p>
            <p className="text-3xl font-extrabold text-ink mt-1 tracking-tight">
              {amount.toFixed(2)} ₼
            </p>
          </div>

          {/* Method selection */}
          <div>
            <p className="text-sm font-bold text-ink-soft mb-2">
              {t('acceptOffer.pickMethod', {
                defaultValue: 'Ödəniş üsulunu seçin',
              })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <MethodCard
                active={method === 'card'}
                onClick={() => setMethod('card')}
                icon={<CreditCard size={20} />}
                label={t('acceptOffer.methodCard', { defaultValue: 'Kartla' })}
                hint={t('acceptOffer.methodCardHint', {
                  defaultValue: 'Balansdan tutulur',
                })}
              />
              <MethodCard
                active={method === 'cash'}
                onClick={() => setMethod('cash')}
                icon={<Banknote size={20} />}
                label={t('acceptOffer.methodCash', { defaultValue: 'Nağd' })}
                hint={t('acceptOffer.methodCashHint', {
                  defaultValue: 'İşin sonunda ödəyirsiniz',
                })}
              />
            </div>
          </div>

          {/* Balance display (card only) */}
          {method === 'card' && (
            <div
              className={`rounded-xl border p-3 ${
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
                    {t('acceptOffer.currentBalance', {
                      defaultValue: 'Cari balansınız',
                    })}
                  </span>
                </div>
                <span
                  className={`font-extrabold ${
                    insufficient ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {loading ? '…' : `${balance?.toFixed(2) ?? '0.00'} ₼`}
                </span>
              </div>
              {insufficient && (
                <div className="mt-3 pt-3 border-t border-rose-200">
                  <p className="text-xs text-rose-700 mb-2">
                    <b>
                      {shortfall.toFixed(2)} ₼{' '}
                      {t('acceptOffer.short', { defaultValue: 'çatışmır' })}.
                    </b>{' '}
                    {t('acceptOffer.shortBody', {
                      defaultValue:
                        'Davam etmək üçün balansı artırın və ya "Nağd" seçin.',
                    })}
                  </p>
                  <Link
                    to="/balance"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700"
                  >
                    {t('acceptOffer.topUp', { defaultValue: 'Balansı artır' })}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              )}
              {!insufficient && balance != null && (
                <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  {t('acceptOffer.balanceAfter', {
                    defaultValue: 'Ödənişdən sonra qalacaq',
                  })}
                  : <b>{(balance - amount).toFixed(2)} ₼</b>
                </p>
              )}
            </div>
          )}

          {/* Cash info */}
          {method === 'cash' && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <p className="font-bold mb-1">
                {t('acceptOffer.cashInfoTitle', {
                  defaultValue: 'Diqqət — nağd ödəniş',
                })}
              </p>
              <p className="text-xs leading-relaxed">
                {t('acceptOffer.cashInfoBody', {
                  defaultValue:
                    'Provayder pulu işdə özünüz birbaşa təhvil verir. Sistem məbləği saxlamır və komissiya tutmur. Provayderin reytinqini sonradan qiymətləndirin.',
                })}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Safety Notice */}
          <div className="mx-5 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
            <div className="flex gap-2">
              <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 font-medium">
                Provayderı eve dəvət etməzdən əvvəl şəxsiyyətini yoxlayın. Şübhəli görünsə imtina edib support@ellit.az-a bildirin.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer ml-6">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={safetyAgreed}
                onChange={(e) => setSafetyAgreed(e.target.checked)}
              />
              <span className="text-xs font-bold text-amber-900">Anladım, davam edirəm</span>
            </label>
          </div>
        </div>

        <div className="p-5 border-t border-border flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-surface-alt disabled:opacity-50"
          >
            {t('common.cancel', { defaultValue: 'Ləğv et' })}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || insufficient || loading || !safetyAgreed}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {t('acceptOffer.confirm', { defaultValue: 'Təklifi qəbul et' })}
          </button>
        </div>
      </div>
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3 rounded-xl border-2 text-left transition-all ${
        active
          ? 'border-brand-600 bg-brand-50'
          : 'border-border bg-white hover:border-brand-300'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${
          active ? 'bg-brand-600 text-white' : 'bg-surface-alt text-ink-soft'
        }`}
      >
        {icon}
      </div>
      <p className="font-extrabold text-ink text-sm">{label}</p>
      <p className="text-xs text-muted">{hint}</p>
    </button>
  );
}
