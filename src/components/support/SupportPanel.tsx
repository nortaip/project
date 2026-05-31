import { useEffect } from 'react';
import { X, Shield } from 'lucide-react';
import { useSupportPanel } from './SupportPanelProvider';
import HomeView from './views/HomeView';
import FAQView from './views/FAQView';
import ChatView from './views/ChatView';

export default function SupportPanel() {
  const { isOpen, close, view, category } = useSupportPanel();

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  // Lock body scroll when open on small screens
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    if (window.innerWidth < 640) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[55] bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={`fixed z-[56] right-0 top-0 h-[100dvh] w-full sm:w-[420px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Dəstək"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-soft">
              <Shield size={16} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="font-extrabold text-sm text-ink leading-tight">Ellit Dəstək</p>
              <p className="text-[10px] text-muted leading-tight">24/7 • az/ru/en</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Bağla"
            className="w-9 h-9 rounded-lg hover:bg-surface-bg text-ink-soft hover:text-ink flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content (keep mounted for state, switch via display) */}
        {view === 'home' && <HomeView />}
        {view === 'faq' && category && <FAQView categoryKey={category} />}
        {view === 'chat' && category && <ChatView categoryKey={category} />}
      </aside>
    </>
  );
}