import { MessageCircle, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useSupportPanel } from './SupportPanelProvider';

// Hide on auth/admin routes
const HIDDEN_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/Resetpassword',
  '/Administrator',
  '/registration-pending',
  '/complete-profile',
];

export default function SupportButton() {
  const { isOpen, toggle, unreadCount } = useSupportPanel();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) return null;
  if (HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? 'Dəstəyi bağla' : 'Dəstək'}
      className="fixed bottom-5 right-5 z-[60] flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-lg hover:shadow-xl active:scale-95 transition-all"
    >
      {isOpen ? (
        <X size={24} strokeWidth={2.5} />
      ) : (
        <>
          <MessageCircle size={24} strokeWidth={2.25} fill="white" className="text-brand-700" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </>
      )}
    </button>
  );
}