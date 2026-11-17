/**
 * Müştəri ↔ usta söhbəti (conversations + chat_messages).
 *
 * Söhbət hər sifariş + qarşı tərəf cütü üçün birdir: `open_conversation`
 * RPC-si mövcud olanı qaytarır və ya yenisini yaradır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface ChatMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
}

/** Sifariş üzrə qarşı tərəflə söhbəti açır, conversation id qaytarır. */
export async function openConversation(opportunityId: string, peerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_conversation', {
    p_opportunity_id: opportunityId,
    p_peer_id: peerId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('open_conversation: empty response');
  return String(data);
}

const key = (opportunityId: string, peerId: string) => `${opportunityId}:${peerId}`;

/**
 * İstifadəçinin sifariş söhbətlərindəki oxunmamış mesaj sayı
 * (sifariş + qarşı tərəf üzrə) — "Mesaj yaz" düyməsində nişan üçün.
 */
export function useChatUnread(userId: string | null | undefined) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setCounts({});
      return;
    }
    const { data: convs, error } = await supabase
      .from('conversations')
      .select('id, opportunity_id, customer_id, provider_id')
      .or(`customer_id.eq.${userId},provider_id.eq.${userId}`)
      .not('opportunity_id', 'is', null)
      .limit(500);
    if (error || !convs || convs.length === 0) {
      setCounts({});
      return;
    }
    const rows = convs as Array<{
      id: string;
      opportunity_id: string;
      customer_id: string;
      provider_id: string;
    }>;
    const { data: unread } = await supabase
      .from('chat_messages')
      .select('conversation_id')
      .in(
        'conversation_id',
        rows.map((c) => c.id),
      )
      .is('read_at', null)
      .neq('sender_id', userId)
      .limit(1000);
    const perConv: Record<string, number> = {};
    for (const m of (unread ?? []) as Array<{ conversation_id: string }>) {
      perConv[m.conversation_id] = (perConv[m.conversation_id] ?? 0) + 1;
    }
    const next: Record<string, number> = {};
    for (const c of rows) {
      const peer = c.customer_id === userId ? c.provider_id : c.customer_id;
      const cnt = perConv[c.id] ?? 0;
      if (cnt > 0) next[key(c.opportunity_id, peer)] = cnt;
    }
    setCounts(next);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void reload();
    const channel = supabase
      .channel(`chat-unread-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void reload(), 800);
        },
      )
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const unreadFor = useCallback(
    (opportunityId: string | null | undefined, peerId: string | null | undefined) =>
      opportunityId && peerId ? counts[key(opportunityId, peerId)] ?? 0 : 0,
    [counts],
  );

  return { unreadFor, reload };
}
