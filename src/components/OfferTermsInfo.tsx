import { useTranslation } from 'react-i18next';
import {
  ArrowDownWideNarrow,
  CalendarClock,
  Calculator,
  MessageCircle,
  StickyNote,
} from 'lucide-react';
import {
  formatVisitDay,
  priceBreakdown,
  priceUnitLabel,
  relativeDayLabel,
  type OfferSort,
  type OfferTerms,
} from '../lib/offerTerms';

/**
 * Təklifin şərtləri: ustanın gəliş günü, qiymət hesablaması
 * ("15 ₼/m² × 40 m²") və ustanın qeydi. Müştəri və usta ekranlarında eyni.
 */
export function OfferTermsInfo({
  offer,
  agreed = false,
  showNote = true,
  className = '',
}: {
  offer: OfferTerms;
  /** Qəbul olunmuş təklif — "Razılaşdırılmış gəliş günü" kimi göstərilir. */
  agreed?: boolean;
  showNote?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const visit = formatVisitDay(offer.proposed_at);
  const rel = relativeDayLabel(offer.proposed_at);
  const breakdown = priceBreakdown(offer);
  const note = showNote ? offer.notes?.trim() : '';

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div
        className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
          agreed
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'bg-white border border-border text-ink-soft'
        }`}
      >
        <CalendarClock size={14} className={`shrink-0 mt-px ${agreed ? 'text-emerald-600' : 'text-brand-600'}`} />
        <span className="min-w-0">
          <span className="font-bold">
            {agreed ? t('offerTerms.agreedVisitDay') : t('offerTerms.visitDay')}:
          </span>{' '}
          {visit ? (
            <>
              <span className="font-extrabold text-ink">{visit}</span>
              {rel && (
                <span
                  className={`ml-1.5 inline-flex px-1.5 py-px rounded text-[10px] font-extrabold uppercase tracking-wide ${
                    rel === t('offerTerms.past')
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {rel}
                </span>
              )}
            </>
          ) : (
            <span className="italic text-muted">{t('offerTerms.noVisitDay')}</span>
          )}
        </span>
      </div>

      {breakdown && (
        <div
          className="flex items-center gap-2 px-2.5 text-xs text-ink-soft"
          title={priceUnitLabel(offer.price_unit)}
        >
          <Calculator size={13} className="text-muted shrink-0" />
          <span className="font-bold">{breakdown}</span>
        </div>
      )}

      {note && (
        <div className="flex items-start gap-2 px-2.5 text-xs text-ink-soft">
          <StickyNote size={13} className="text-muted shrink-0 mt-px" />
          <span className="whitespace-pre-wrap break-words">
            <span className="font-bold">{t('offerTerms.note')}:</span> {note}
          </span>
        </div>
      )}
    </div>
  );
}

/** Müştərinin təklif siyahısı üçün sıralama seçimi. */
export function OfferSortToggle({
  value,
  onChange,
  className = '',
}: {
  value: OfferSort;
  onChange: (v: OfferSort) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const opts: { key: OfferSort; label: string }[] = [
    { key: 'earliest', label: t('offerTerms.sort.earliest') },
    { key: 'cheapest', label: t('offerTerms.sort.cheapest') },
  ];
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted uppercase tracking-wide">
        <ArrowDownWideNarrow size={12} />
        {t('offerTerms.sort.label')}:
      </span>
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
            value === o.key
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-ink-soft border-border hover:border-brand-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Mesaj yaz" düyməsi — oxunmamış mesaj sayı ilə. */
export function MessageButton({
  onClick,
  unread = 0,
  label,
  className = '',
}: {
  onClick: () => void;
  unread?: number;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`relative inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl border-[1.5px] border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm font-bold transition-colors ${className}`}
    >
      <MessageCircle size={14} />
      {label ?? t('offerTerms.actions.message')}
      {unread > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center"
          title={t('offerTerms.chat.unread', { count: unread })}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
