import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  DollarSign,
  Info,
  Loader2,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input, Textarea } from '../components/ui';
import { isVerified } from '../lib/kycService';
import {
  addDaysYmd,
  bakuTodayYmd,
  buildProposedAt,
  computeTotal,
  fmtAzn,
  fmtNum,
  formatVisitDay,
  formatYmd,
  isYmd,
  isYmdInSchedule,
  MAX_SCHEDULE_DAYS,
  normalizePriceUnit,
  quantityUnit,
  scheduleBounds,
  stripErrorCode,
  unitPriceSuffix,
  type PriceUnit,
} from '../lib/offerTerms';

type Props = {
  opportunity: {
    id: string;
    title: string;
    category_id?: string | null;
    /** Müştərinin istədiyi gün (opportunities.date, "YYYY-MM-DD"). */
    date?: string | null;
  };
  onClose: () => void;
};

const NOTE_MAX = 1000;

/**
 * Bid model:
 *   - Qiymət kateqoriyanın vahidinə görə: sabit (bütün iş), m² və ya saat
 *     başı (vahid qiymət × təxmini miqdar = cəm)
 *   - Usta gələcəyi günü seçir (bu gün … +90 gün), saat istəyə bağlıdır
 *   - Balansda komissiya üçün məbləğ yoxdursa təklif bloklanır (server yoxlayır)
 */
export default function OpportunityBidModal({ opportunity, onClose }: Props) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIsBalance, setErrorIsBalance] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  // Sifarişin kateqoriya vahidi + müştərinin istədiyi gün
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('fixed');
  const [customerDate, setCustomerDate] = useState<string | null>(
    isYmd(opportunity.date?.slice(0, 10)) ? opportunity.date!.slice(0, 10) : null,
  );
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Form
  const [amount, setAmount] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [visitDate, setVisitDate] = useState<string>(() =>
    defaultVisitDate(opportunity.date?.slice(0, 10) ?? null),
  );
  const [visitTime, setVisitTime] = useState('');
  const [notes, setNotes] = useState('');

  const bounds = useMemo(() => scheduleBounds(), []);
  const perUnit = priceUnit !== 'fixed';
  const total = perUnit ? computeTotal(unitPrice, quantity) : Math.round((parseFloat(amount) || 0) * 100) / 100;
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

  // Kateqoriyanın qiymət vahidi və müştərinin istədiyi gün
  useEffect(() => {
    let cancelled = false;
    const initialYmd = opportunity.date ? opportunity.date.slice(0, 10) : null;
    void (async () => {
      try {
        let categoryId = opportunity.category_id ?? null;
        let date = opportunity.date ?? null;
        if (!categoryId || !date) {
          const { data: opp } = await supabase
            .from('opportunities')
            .select('category_id, date')
            .eq('id', opportunity.id)
            .maybeSingle();
          categoryId = categoryId ?? (opp?.category_id as string | null) ?? null;
          date = date ?? (opp?.date as string | null) ?? null;
        }
        if (categoryId) {
          const { data: cat } = await supabase
            .from('service_categories')
            .select('price_unit')
            .eq('id', categoryId)
            .maybeSingle();
          if (!cancelled) setPriceUnit(normalizePriceUnit(cat?.price_unit));
        }
        const ymd = date ? String(date).slice(0, 10) : null;
        if (!cancelled && isYmd(ymd)) {
          // Props-da tarix yox idisə, defolt günü müştərinin gününə görə düzəlt
          if (ymd !== initialYmd) setVisitDate(defaultVisitDate(ymd));
          setCustomerDate(ymd);
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunity.id, opportunity.category_id, opportunity.date]);

  const handleBid = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorIsBalance(false);
    setInfo(null);

    // KYC gating — verified deyilsə təklif verə bilmir
    if (verified === false) {
      setError(t('kyc.gating.body'));
      return;
    }

    if (perUnit) {
      if (!(parseFloat(unitPrice) > 0)) {
        setError(t('offerTerms.bid.errors.unitPrice'));
        return;
      }
      if (!(parseFloat(quantity) > 0)) {
        setError(t('offerTerms.bid.errors.quantity'));
        return;
      }
    }
    if (!Number.isFinite(total) || total <= 0) {
      setError(t('bid.errors.invalidAmount'));
      return;
    }
    if (!isYmdInSchedule(visitDate)) {
      setError(t('offerTerms.errors.dateRange', { max: MAX_SCHEDULE_DAYS }));
      return;
    }
    if (notes.length > NOTE_MAX) {
      setError(t('offerTerms.bid.errors.noteTooLong', { max: NOTE_MAX }));
      return;
    }

    setSubmitting(true);
    const params: Record<string, unknown> = {
      p_opportunity_id: opportunity.id,
      p_amount: total,
      p_proposed_at: buildProposedAt(visitDate, visitTime || null),
    };
    if (perUnit) {
      params.p_unit_price = Math.round(parseFloat(unitPrice) * 100) / 100;
      params.p_quantity = Math.round(parseFloat(quantity) * 100) / 100;
    }
    if (notes.trim()) params.p_notes = notes.trim();

    const { error: rpcErr } = await supabase.rpc('place_bid', params);

    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (msg.includes('NO_BALANCE')) {
        setErrorIsBalance(true);
        setError(`${t('offerTerms.bid.errors.noBalance')} ${stripErrorCode(msg)}`);
      } else if (msg.includes('KYC_REQUIRED') || msg.includes('row-level security')) {
        // RLS blok — yəqin KYC olmayıb
        setError(t('kyc.gating.body'));
      } else {
        setError(stripErrorCode(msg) || t('offerTerms.errors.generic'));
      }
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setInfo(t('bid.success'));
    setTimeout(() => onClose(), 800);
  };

  const today = bakuTodayYmd();
  const quickDays: { key: string; label: string; ymd: string }[] = [
    { key: 'today', label: t('offerTerms.today'), ymd: today },
    { key: 'tomorrow', label: t('offerTerms.tomorrow'), ymd: addDaysYmd(today, 1) },
  ];
  if (customerDate && isYmdInSchedule(customerDate) && customerDate !== today && customerDate !== addDaysYmd(today, 1)) {
    quickDays.push({ key: 'customer', label: t('offerTerms.bid.customerDayChip'), ymd: customerDate });
  }

  const preview = isYmd(visitDate) ? formatVisitDay(buildProposedAt(visitDate, visitTime || null)) : null;
  const disabled = submitting || insufficient;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <Card
        variant="elevated"
        padding="lg"
        className="w-full max-w-md relative max-h-[92vh] overflow-y-auto"
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
          {(insufficient || errorIsBalance) && (
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
          {/* ── Qiymət ─────────────────────────────────────────── */}
          <div className="mb-2 flex items-start gap-2 rounded-xl bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800">
            <Info size={14} className="shrink-0 mt-px" />
            {loadingMeta ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
              </span>
            ) : (
              <span>{t(`offerTerms.bid.pricingHint.${priceUnit}`)}</span>
            )}
          </div>

          {perUnit ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t(`offerTerms.bid.unitPriceLabel.${priceUnit}`)} required className="mb-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    placeholder={`0 ${unitPriceSuffix(priceUnit)}`}
                    disabled={disabled || loadingMeta}
                    autoFocus
                  />
                </Field>
                <Field label={t(`offerTerms.bid.quantityLabel.${priceUnit}`)} required className="mb-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step={priceUnit === 'hour' ? '0.5' : '0.01'}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder={`0 ${quantityUnit(priceUnit)}`}
                    disabled={disabled || loadingMeta}
                  />
                </Field>
              </div>
              <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-bg border border-border px-3 py-2.5">
                <span className="text-xs text-muted font-bold">
                  {parseFloat(unitPrice) > 0 && parseFloat(quantity) > 0
                    ? `${fmtNum(unitPrice)} ${unitPriceSuffix(priceUnit)} × ${fmtNum(quantity)} ${quantityUnit(priceUnit)}`
                    : t('offerTerms.bid.totalAuto')}
                </span>
                <span className="text-base font-extrabold text-ink">
                  {t('offerTerms.total')}: {fmtAzn(total)}
                </span>
              </div>
            </>
          ) : (
            <Field label={t('offerTerms.bid.totalLabel')} required>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={disabled || loadingMeta}
                autoFocus
              />
            </Field>
          )}

          {/* ── Gəliş günü ─────────────────────────────────────── */}
          <div className="mb-4">
            <label className="block mb-1.5 text-sm font-bold text-ink-soft">
              {t('offerTerms.bid.visitDayLabel')}
              <span className="text-danger ml-1">*</span>
            </label>
            {customerDate && (
              <p className="mb-2 text-xs text-muted">
                {t('offerTerms.customerPreferredDay')}:{' '}
                <b className="text-ink-soft">{formatYmd(customerDate)}</b>
                {customerDate < today && ` (${t('offerTerms.past').toLowerCase()})`}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quickDays.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => setVisitDate(q.ymd)}
                  disabled={disabled}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                    visitDate === q.ymd
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-ink-soft border-border hover:border-brand-300'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
              <Input
                type="date"
                required
                min={bounds.min}
                max={bounds.max}
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                disabled={disabled}
                aria-label={t('offerTerms.bid.visitDayLabel')}
              />
              <Input
                type="time"
                value={visitTime}
                onChange={(e) => setVisitTime(e.target.value)}
                disabled={disabled}
                aria-label={t('offerTerms.bid.timeLabel')}
                title={t('offerTerms.bid.timeLabel')}
              />
            </div>
            <p className="mt-1.5 ml-1 text-[11px] text-muted">{t('offerTerms.bid.timeHint')}</p>
            {preview && (
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                <CalendarClock size={14} className="shrink-0" />
                <span>
                  {t('offerTerms.bid.customerWillSee')}: <b>{preview}</b>
                </span>
              </div>
            )}
            <p className="mt-1.5 ml-1 text-[11px] text-muted leading-relaxed">
              {t('offerTerms.bid.visitDayHint', { max: MAX_SCHEDULE_DAYS })}
            </p>
          </div>

          {/* ── Qeyd ───────────────────────────────────────────── */}
          <Field
            label={t('offerTerms.bid.noteLabel')}
            hint={`${notes.length}/${NOTE_MAX}`}
          >
            <Textarea
              rows={3}
              maxLength={NOTE_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('offerTerms.bid.notePlaceholder')}
              disabled={disabled}
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
              disabled={disabled || total <= 0 || loadingBalance || loadingMeta || !visitDate}
              fullWidth
              rightIcon={<ArrowRight size={18} />}
            >
              {total > 0 ? `${t('bid.submit')} · ${fmtAzn(total)}` : t('bid.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Müştərinin günü keçməyibsə — o gün, əks halda sabah. */
function defaultVisitDate(customerYmd: string | null): string {
  const { min, max } = scheduleBounds();
  if (customerYmd && isYmd(customerYmd) && customerYmd >= min) {
    return customerYmd <= max ? customerYmd : max;
  }
  return addDaysYmd(min, 1);
}
