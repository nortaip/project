import { ChevronLeft, MessageCircle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCategory, type Lang, type SupportCategoryKey } from '../data/faqData';
import { useSupportPanel } from '../SupportPanelProvider';

interface Props { categoryKey: SupportCategoryKey }

export default function FAQView({ categoryKey }: Props) {
  const { i18n } = useTranslation();
  const { goHome, openChat } = useSupportPanel();
  const lang = (i18n.language?.slice(0, 2) as Lang) || 'az';
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const cat = getCategory(categoryKey);
  if (!cat) return null;
  const Icon = cat.icon;

  const askLabel = lang === 'ru' ? 'Не нашли ответ? Написать админу'
    : lang === 'en' ? "Didn't find an answer? Message admin"
    : 'Cavabınızı tapmadınız? Admin ilə yazışın';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-header */}
      <div className={`px-4 py-4 border-b border-border ${cat.bg} flex items-center gap-3 shrink-0`}>
        <button
          type="button"
          onClick={goHome}
          aria-label="Geri"
          className="w-8 h-8 rounded-lg bg-white/70 hover:bg-white flex items-center justify-center text-ink-soft"
        >
          <ChevronLeft size={18} />
        </button>
        <div className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm ${cat.color}`}>
          <Icon size={20} strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-extrabold text-sm ${cat.color}`}>{cat.title[lang]}</p>
          <p className="text-[11px] text-ink-soft truncate">{cat.subtitle[lang]}</p>
        </div>
      </div>

      {/* FAQ list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {cat.faqs.map((faq, idx) => {
          const open = openIdx === idx;
          return (
            <div
              key={idx}
              className="rounded-xl border border-border bg-white overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : idx)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-bg transition-colors"
              >
                <span className="text-sm font-bold text-ink leading-snug">{faq.q[lang]}</span>
                <ChevronDown
                  size={16}
                  className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <div className="px-4 pb-4 pt-1">
                  <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{faq.a[lang]}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Ask admin CTA */}
      <div className="p-4 border-t border-border bg-surface-bg shrink-0">
        <button
          type="button"
          onClick={() => openChat(categoryKey)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-gradient text-white font-bold text-sm shadow-brand-soft hover:shadow-brand transition-all"
        >
          <MessageCircle size={16} />
          {askLabel}
        </button>
      </div>
    </div>
  );
}