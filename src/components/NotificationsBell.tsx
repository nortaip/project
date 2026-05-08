import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Bell icon for the navbar — shows unread notification count
 * with realtime updates. Click → /notifications.
 *
 * Mobil + Web eyni schema istifadə edir, ona görə bu komponent
 * `notifications` cədvəlinin Supabase-də olduğunu fərz edir
 * (`20260508_notifications.sql` migration).
 */
export function NotificationsBell({ userId }: { userId: string | null }) {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }

    let cancelled = false;

    const refreshCount = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (!cancelled) setCount(c ?? 0);
    };

    void refreshCount();

    // Realtime subscription
    const channel = supabase
      .channel(`notifications-bell-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshCount();
        },
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId]);

  if (!userId) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      className="relative w-10 h-10 rounded-xl bg-surface-alt hover:bg-border flex items-center justify-center text-ink-soft hover:text-brand-600 transition-colors"
      aria-label={`Bildirişlər${count > 0 ? ` (${count} oxunmamış)` : ''}`}
    >
      <Bell size={20} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
