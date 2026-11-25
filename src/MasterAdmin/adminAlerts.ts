import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Admin müraciət xəbərdarlıqları — bütün admin səhifələri üçün VAHİD mənbə
 * (AdminLayout hər səhifədə yenidən qurulur, bu modul isə işləməyə davam edir):
 *  - menyudakı qırmızı saylar: `admin_pending_counts` RPC — açılanda, səhifə
 *    dəyişəndə, pəncərəyə qayıdanda və hər 10 san.-dən bir (vərəq görünəndə);
 *  - yeni müraciət anında: adminin `notifications` sətirlərinə realtime abunə
 *    (type = admin_request | admin_review) → sayları yenilə + bildiriş göstər.
 */

export interface PendingCounts {
  providers: number;
  kyc: number;
  brigades: number;
  withdrawals: number;
  job_completions: number;
  support: number;
  disputes: number;
  unread_alerts: number;
}

export interface AdminAlert {
  id: string;
  type: string;
  kind: string | null;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

const POLL_MS = 10_000;

let counts: PendingCounts | null = null;
let userId: string | null = null;
let timer: number | undefined;
let channel: RealtimeChannel | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const alertHandlers = new Set<(a: AdminAlert) => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function load() {
  const { data, error } = await supabase.rpc('admin_pending_counts');
  if (!error && data) {
    counts = data as PendingCounts;
    emit();
  }
}

/** Sayları indi yenilə (məs. admin müraciəti təsdiqləyəndən sonra). */
export function refreshAdminAlerts(): Promise<void> {
  if (!userId) return Promise.resolve();
  if (!inflight) {
    inflight = load().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

const onVisible = () => {
  if (document.visibilityState === 'visible') void refreshAdminAlerts();
};

export function startAdminAlerts(uid: string) {
  if (userId === uid) return;
  stopAdminAlerts();
  userId = uid;
  void refreshAdminAlerts();
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAdminAlerts();
  }, POLL_MS);
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  channel = supabase
    .channel(`admin-alerts-${uid}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
      (payload) => {
        const n = payload.new as AdminAlert;
        if (n.type !== 'admin_request' && n.type !== 'admin_review') return;
        void refreshAdminAlerts();
        alertHandlers.forEach((h) => h(n));
      },
    )
    .subscribe();
}

export function stopAdminAlerts() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  window.removeEventListener('focus', onVisible);
  document.removeEventListener('visibilitychange', onVisible);
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  userId = null;
  counts = null;
  emit();
}

/** Yeni müraciət gələndə çağırılır (AdminLayout bildiriş göstərir). */
export function onAdminAlert(handler: (a: AdminAlert) => void): () => void {
  alertHandlers.add(handler);
  return () => {
    alertHandlers.delete(handler);
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePendingCounts(): PendingCounts | null {
  return useSyncExternalStore(subscribe, () => counts, () => null);
}
