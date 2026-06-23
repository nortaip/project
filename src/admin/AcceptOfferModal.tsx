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
  const [error, setError] = useState<string | null>(null);
  const [serviceFeePct, setServiceFeePct] = useState(0);

  // Promo kod
  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo] = useState<{ discount: number; final: number; code: string } | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);

  const amt = Number(amount ?? 0);
  const discount = method === 'card' && promo ? promo.discount : 0;
  const payable = Math.max(0, amt - discount);
  // Kartla faktiki tutulan: sifariş - endirim + müştəri servis haqqı
  const serviceFee = Math.round(amt * serviceFeePct) / 100;
  const chargeable = payable + serviceFee;

  async function applyPromo() {
    setPromoErr(null);
    setPromo(null);
    const code = promoCode.trim();
    if (!code) return;
    setPromoChecking(true);
    const { data, error: e } = await supabase.rpc('validate_promo_code', {
      p_code: code,
      p_amount: amount,
    });
    setPromoChecking(false);
    if (e) {
      setPromoErr(e.message);
      return;
    }
    const res = data as { valid: boolean; discount?: number; final?: number; code?: string; message?: string };
    if (!res.valid) {
      setPromoErr(res.message ?? 'Promo kod etibarsızdır');
      return;
    }
    setPromo({ discount: Number(res.discount ?? 0), final: Number(res.final ?? amount), code: res.code ?? code });
  }

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
      const { data: cfg } = await supabase
        .from('platform_config')
        .select('value')
        .eq('key', 'commission_customer_service_fee')
        .maybeSingle();
      setServiceFeePct(Number(cfg?.value ?? 0));
      setLoading(false);
    })();
  }, []);

  const insufficient =
    method === 'card' && balance != null && balance < chargeable;
  const shortfall = insufficient ? chargeable - (balance ?? 0) : 0;

  async function submit() {
    setError(null);
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('accept_offer_with_payment', {
      p_offer_id: offerId,
      p_method: method,
      p_promo_code: method === 'card' && promo ? promoCode.trim() : null,
    });
    setSubmitting(false);
    if (rpcErr) {
      if (rpcErr.message.includes('PROMO_INVALID')) {
        setError(rpcErr.message.replace('PROMO_INVALID:', 'Promo:').trim());
      } else if (rpcErr.message.includes('INSUFFICIENT_BALANCE')) {
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
              {discount > 0 ? (
                <>
                  <span className="text-xl text-muted line-through mr-2">{Number(amount ?? 0).toFixed(2)}</span>
                  {payable.toFixed(2)} ₼
                </>
              ) : (
                <>{Number(amount ?? 0).toFixed(2)} ₼</>
              )}
            </p>
            {discount > 0 && (
              <p className="text-xs font-bold text-emerald-700 mt-1">
                Promo endirim: −{discount.toFixed(2)} ₼ ({promo?.code})
              </p>
            )}
            {method === 'card' && serviceFee > 0 && (
              <p className="text-xs text-muted mt-1">+ Servis haqqı: {serviceFee.toFixed(2)} ₼</p>
            )}
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

          {/* Promo kod (yalnız kart) */}
          {method === 'card' && (
            <div>
              <p className="text-sm font-bold text-ink-soft mb-2">Promo kod</p>
              <div className="flex gap-2">
                <input
                  value={promoCode}
                  onChange={(e) => {
                    setPromoCode(e.target.value.toUpperCase());
                    setPromo(null);
                    setPromoErr(null);
                  }}
                  placeholder="PROMO2026"
                  className="flex-1 h-10 px-3 rounded-xl border border-border bg-white text-sm font-bold uppercase outline-none focus:border-brand-500"
                />
                <button
                  type="button"
                  onClick={() => void applyPromo()}
                  disabled={promoChecking || !promoCode.trim()}
                  className="px-4 h-10 rounded-xl bg-ink text-white text-sm font-bold disabled:opacity-50"
                >
                  {promoChecking ? <Loader2 size={14} className="animate-spin" /> : 'Tətbiq et'}
                </button>
              </div>
              {promoErr && <p className="text-xs text-rose-600 font-semibold mt-1.5">{promoErr}</p>}
              {promo && (
                <p className="text-xs text-emerald-700 font-bold mt-1.5 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {promo.code} tətbiq olundu — {promo.discount.toFixed(2)} ₼ endirim
                </p>
              )}
            </div>
          )}

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
                  : <b>{(balance - chargeable).toFixed(2)} ₼</b>
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
            disabled={submitting || insufficient || loading}
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
