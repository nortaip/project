import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/auth';
import type { SupportCategoryKey } from './data/faqData';

export type SupportView = 'home' | 'faq' | 'chat';

interface SupportPanelContextValue {
  isOpen: boolean;
  view: SupportView;
  category: SupportCategoryKey | null;
  userRole: 'customer' | 'provider';
  unreadCount: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  goHome: () => void;
  openCategory: (key: SupportCategoryKey) => void;
  openChat: (key: SupportCategoryKey) => void;
}

const SupportPanelContext = createContext<SupportPanelContextValue | null>(null);

export function useSupportPanel(): SupportPanelContextValue {
  const ctx = useContext(SupportPanelContext);
  if (!ctx) throw new Error('useSupportPanel must be used within SupportPanelProvider');
  return ctx;
}

const UNREAD_KEY = 'user_support_unread_count';

export function SupportPanelProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<SupportView>('home');
  const [category, setCategory] = useState<SupportCategoryKey | null>(null);
  const [userRole, setUserRole] = useState<'customer' | 'provider'>('customer');
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10) || 0;
  });

  // Resolve role from profile
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (!cancelled && data?.role === 'provider') setUserRole('provider');
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Live unread tracker — counts admin messages in any support conversation
  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0);
      localStorage.setItem(UNREAD_KEY, '0');
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      // Get user's support conversations (no opportunity)
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .is('opportunity_id', null)
        .eq('customer_id', user.id);
      if (cancelled || !convs?.length) {
        setUnreadCount(0);
        localStorage.setItem(UNREAD_KEY, '0');
        return;
      }
      const ids = convs.map((c: { id: string }) => c.id);
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', ids)
        .neq('sender_id', user.id)
        .is('read_at', null);
      if (cancelled) return;
      const n = count ?? 0;
      setUnreadCount(n);
      localStorage.setItem(UNREAD_KEY, String(n));
    };
    refresh();

    const channel = supabase
      .channel(`user_support_unread_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => refresh())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const goHome = useCallback(() => { setView('home'); setCategory(null); }, []);
  const openCategory = useCallback((key: SupportCategoryKey) => {
    setCategory(key);
    setView('faq');
    setIsOpen(true);
  }, []);
  const openChat = useCallback((key: SupportCategoryKey) => {
    setCategory(key);
    setView('chat');
    setIsOpen(true);
  }, []);

  const value = useMemo<SupportPanelContextValue>(() => ({
    isOpen, view, category, userRole, unreadCount,
    open, close, toggle, goHome, openCategory, openChat,
  }), [isOpen, view, category, userRole, unreadCount, open, close, toggle, goHome, openCategory, openChat]);

  return <SupportPanelContext.Provider value={value}>{children}</SupportPanelContext.Provider>;
}