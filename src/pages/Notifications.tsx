import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  Trash2,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  EmptyState,
  PageContainer,
  SectionHeader,
} from '../components/ui';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  related_id: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON_MAP: Record<string, string> = {
  new_booking: '📋',
  new_offer: '💰',
  new_order: '📦',
  booking_confirmed: '✅',
  booking_completed: '🎉',
  booking_cancelled: '❌',
  offer_accepted: '🎯',
  offer_rejected: '😞',
  status_arrived: '📍',
  status_ongoing: '🔧',
  status_completed: '🎉',
  payment: '💳',
  test: '🧪',
};

export default function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setItems((data ?? []) as NotificationRow[]);
    } catch (e) {
      message.error(`${t('notificationsPage.loadFail')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  const markAllRead = async () => {
    try {
      const { error } = await supabase.rpc('mark_all_notifications_read');
      if (error) throw error;
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      message.success(t('notificationsPage.markAllRead'));
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  };

  const visible = filter === 'unread' ? items.filter((i) => !i.is_read) : items;
  const unreadCount = items.filter((i) => !i.is_read).length;

  return (
    <PageContainer size="md">
      <SectionHeader
        title={t('notificationsPage.title')}
        subtitle={t('notificationsPage.subtitle', { count: items.length })}
        action={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<CheckCheck size={16} />}
              onClick={markAllRead}
            >
              {t('notificationsPage.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2 mb-5">
        <FilterTab
          label={t('notificationsPage.filterAll')}
          count={items.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={t('notificationsPage.filterUnread', { count: unreadCount })}
          count={unreadCount}
          active={filter === 'unread'}
          onClick={() => setFilter('unread')}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Inbox size={32} />}
            title={t('notificationsPage.emptyTitle')}
            description={t('notificationsPage.emptyBody')}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((n) => (
            <NotificationCard
              key={n.id}
              row={n}
              onMarkRead={() => markRead(n.id)}
              onRemove={() => remove(n.id)}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
        active
          ? 'bg-brand-600 text-white'
          : 'bg-white border border-border text-ink-soft hover:border-brand-300'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 px-1.5 py-0.5 rounded-md text-xs ${
          active ? 'bg-white/20' : 'bg-surface-alt'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function NotificationCard({
  row,
  onMarkRead,
  onRemove,
}: {
  row: NotificationRow;
  onMarkRead: () => void;
  onRemove: () => void;
}) {
  const icon = TYPE_ICON_MAP[row.type] ?? '🔔';
  const dt = new Date(row.created_at);
  const dateStr = dt.toLocaleDateString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-2xl border transition-colors ${
        row.is_read
          ? 'bg-white border-border'
          : 'bg-brand-50/50 border-brand-200'
      }`}
    >
      <div className="w-11 h-11 rounded-xl bg-white border border-border flex items-center justify-center text-2xl shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3
            className={`font-extrabold text-ink ${row.is_read ? '' : 'pr-2'}`}
          >
            {row.title}
          </h3>
          {!row.is_read && (
            <span className="w-2 h-2 rounded-full bg-brand-600 shrink-0" />
          )}
        </div>
        {row.body && (
          <p className="mt-0.5 text-sm text-muted leading-snug">{row.body}</p>
        )}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            {dateStr}
          </span>
          {!row.is_read && (
            <button
              type="button"
              onClick={onMarkRead}
              className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              <Check size={12} /> Oxudum
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 font-semibold text-muted hover:text-danger transition-colors ml-auto"
          >
            <Trash2 size={12} /> Sil
          </button>
        </div>
      </div>
    </div>
  );
}
