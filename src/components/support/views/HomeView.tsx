import { Sparkles, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORT_CATEGORIES, type Lang } from '../data/faqData';
import { useSupportPanel } from '../SupportPanelProvider';
import { useAuthStore } from '../../../store/auth';

export default function HomeView() {
  const { i18n } = useTranslation();
  const { openCategory, openChat, userRole } = useSupportPanel();
  const user = useAuthStore((s) => s.user);
  const lang = (i18n.language?.slice(0, 2) as Lang) || 'az';

  const firstName = (user?.email ?? '').split('@')[0];
  const greeting = lang === 'ru' ? 'Привет' : lang === 'en' ? 'Hello' : 'Salam';
  const askLabel = lang === 'ru' ? 'Чем мы можем помочь?' : lang === 'en' ? 'How can we help?' : 'Necə kömək edə bilərik?';
  const directLabel = lang === 'ru' ? 'Просто написать админу' : lang === 'en' ? 'Write directly to admin' : 'Birbaşa admin ilə yazış';
  const onlineLabel = lang === 'ru' ? 'Админ онлайн • Отвечает за 5 мин' : lang === 'en' ? 'Admin online • Replies in 5 min' : 'Admin online • 5 dəq cavab';

  const visible = SUPPORT_CATEGORIES.filter((c) => !c.providerOnly || userRole === 'provider');

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Greeting hero */}
      <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-accent-600 text-white px-6 pt-8 pb-12 rounded-b-3xl">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-bold opacity-90">{onlineLabel}</span>
        </div>
        <h2 className="text-2xl font-extrabold leading-tight">
          {greeting}{firstName ? `, ${firstName}` : ''}! 👋
        </h2>
        <p className="text-sm opacity-90 mt-1">{askLabel}</p>
      </div>

      {/* Category cards */}
      <div className="px-4 -mt-6 grid grid-cols-2 gap-3 pb-4">
        {visible.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => openCategory(cat.key)}
              className={`group relative rounded-2xl border ${cat.border} ${cat.bg} p-4 text-left hover:shadow-md transition-all active:scale-[0.98]`}
            >
              <div className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm mb-3 ${cat.color}`}>
                <Icon size={20} strokeWidth={2.25} />
              </div>
              <p className={`font-extrabold text-sm leading-tight ${cat.color}`}>
                {cat.title[lang]}
              </p>
              <p className="text-[11px] text-ink-soft mt-1 line-clamp-2 leading-snug">
                {cat.subtitle[lang]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Direct chat shortcut */}
      <div className="px-4 pb-6">
        <button
          type="button"
          onClick={() => openChat('general')}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-border hover:border-brand-300 hover:bg-brand-50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Sparkles size={18} strokeWidth={2.25} />
            </div>
            <span className="text-sm font-bold text-ink">{directLabel}</span>
          </div>
          <ChevronRight size={18} className="text-muted group-hover:text-brand-600" />
        </button>
      </div>
    </div>
  );
}