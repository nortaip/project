import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  User as UserIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

/** Admin dəstək çatı — istifadəçilərin support söhbətləri + cavab. */

interface Conversation {
  id: string;
  customer_id: string;
  provider_id: string;
  category: string | null;
  user_role: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  user_name: string;
  user_email: string | null;
  unread: number;
}

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: 'Ümumi',
  order: 'Sifariş',
  payment: 'Ödəniş',
  kyc: 'KYC',
  complaint: 'Şikayət',
  provider: 'Usta',
};

const CATEGORY_COLORS: Record<string, string> = {
  general: 'bg-gray-100 text-gray-700',
  order: 'bg-blue-50 text-blue-700',
  payment: 'bg-emerald-50 text-emerald-700',
  kyc: 'bg-violet-50 text-violet-700',
  complaint: 'bg-rose-50 text-rose-700',
  provider: 'bg-amber-50 text-amber-700',
};

export default function SupportChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [myId, setMyId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setMyId(data.user?.id ?? null);
    });
  }, []);

  // ── Söhbət siyahısı ──────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, customer_id, provider_id, category, user_role, last_message_at, last_message_preview')
      .not('category', 'is', null)
      .is('opportunity_id', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100);
    if (error || !data) {
      setLoading(false);
      return;
    }

    // İstifadəçi adları
    const userIds = Array.from(new Set(data.map((c) => c.customer_id)));
    const profMap: Record<string, { name: string | null; email: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds);
      for (const p of profs ?? []) profMap[p.id] = { name: p.name, email: p.email };
    }

    // Oxunmamış saylar (istifadəçidən gələn, oxunmamış)
    const convIds = data.map((c) => c.id);
    const unreadMap: Record<string, number> = {};
    if (convIds.length > 0) {
      const { data: unread } = await supabase
        .from('chat_messages')
        .select('conversation_id, sender_id')
        .in('conversation_id', convIds)
        .is('read_at', null);
      for (const m of unread ?? []) {
        const conv = data.find((c) => c.id === m.conversation_id);
        if (conv && m.sender_id === conv.customer_id) {
          unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] ?? 0) + 1;
        }
      }
    }

    setConversations(
      data.map((c) => ({
        ...c,
        user_name: profMap[c.customer_id]?.name || 'İstifadəçi',
        user_email: profMap[c.customer_id]?.email ?? null,
        unread: unreadMap[c.id] ?? 0,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadConversations();
    // Realtime: yeni mesaj gələndə siyahını (və açıq söhbəti) yenilə.
    // loadConversations hər insert-də deyil, 1.5s trailing debounce ilə çağırılır —
    // platform üzrə hər mesajda DB-ni yükləməmək üçün.
    const ch = supabase
      .channel('admin-support-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = setTimeout(() => {
            reloadTimerRef.current = null;
            void loadConversations();
          }, 1500);
          const row = payload.new as { conversation_id?: string };
          if (row.conversation_id && row.conversation_id === activeIdRef.current) {
            void loadMessages(row.conversation_id);
          }
        },
      )
      .subscribe();
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations]);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mesajlar ─────────────────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string) => {
    // Ən son 200 mesajı götür (desc), sonra xronoloji sıraya çevir
    const { data } = await supabase
      .from('chat_messages')
      .select('id, sender_id, body, created_at, read_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(200);
    setMessages(((data ?? []) as Message[]).slice().reverse());
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const openConversation = async (conv: Conversation) => {
    setActiveId(conv.id);
    setMsgLoading(true);
    await loadMessages(conv.id);
    setMsgLoading(false);
    // İstifadəçi mesajlarını oxunmuş işarələ
    await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conv.id)
      .eq('sender_id', conv.customer_id)
      .is('read_at', null);
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)),
    );
  };

  const sendReply = async () => {
    const body = reply.trim();
    const convId = activeId;
    if (!body || !convId || !myId || sending) return;
    setSending(true);
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: convId,
      sender_id: myId,
      body,
    });
    if (!error) {
      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: body.slice(0, 120),
        })
        .eq('id', convId);
      setReply('');
      await loadMessages(convId);
      void loadConversations();
    }
    setSending(false);
  };

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const visible =
    filter === 'all'
      ? conversations
      : conversations.filter((c) => (c.category ?? 'general') === filter);
  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0);

  return (
    <AdminLayout
      title="Dəstək çatı"
      subtitle={`İstifadəçi müraciətləri — ${totalUnread} oxunmamış mesaj`}
    >
      {/* Kateqoriya filtri */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {['all', ...Object.keys(CATEGORY_LABELS)].map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`h-8 px-3 rounded-full text-xs font-bold transition-colors ${
              filter === k
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-border text-muted hover:text-ink'
            }`}
          >
            {k === 'all' ? 'Hamısı' : CATEGORY_LABELS[k]}
          </button>
        ))}
        <button
          onClick={() => void loadConversations()}
          className="h-8 px-3 rounded-full text-xs font-bold bg-white border border-border text-muted hover:text-ink inline-flex items-center gap-1"
        >
          <RefreshCw size={12} /> Yenilə
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4">
        {/* ── Söhbət siyahısı ── */}
        <div className="bg-white rounded-2xl border border-border overflow-hidden lg:h-[calc(100vh-16rem)] lg:overflow-y-auto [scrollbar-width:thin]">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-brand-600" size={22} />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              <MessageCircle size={28} className="mx-auto mb-2 opacity-40" />
              Dəstək müraciəti yoxdur
            </div>
          ) : (
            visible.map((c) => (
              <button
                key={c.id}
                onClick={() => void openConversation(c)}
                className={`w-full text-left px-4 py-3 border-b border-border/60 transition-colors ${
                  activeId === c.id ? 'bg-brand-50' : 'hover:bg-surface-bg'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 shrink-0">
                    <UserIcon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-ink truncate">
                        {c.user_name}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          CATEGORY_COLORS[c.category ?? 'general'] ?? CATEGORY_COLORS.general
                        }`}
                      >
                        {CATEGORY_LABELS[c.category ?? 'general'] ?? c.category}
                      </span>
                    </div>
                    <div className="text-xs text-muted truncate">
                      {c.last_message_preview || '—'}
                    </div>
                  </div>
                  {c.unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {c.unread}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── Mesaj paneli ── */}
        <div className="bg-white rounded-2xl border border-border flex flex-col lg:h-[calc(100vh-16rem)]">
          {active === null ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm py-16">
              <MessageCircle size={32} className="mb-2 opacity-40" />
              Söhbət seçin
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <div className="font-bold text-ink text-sm">{active.user_name}</div>
                  <div className="text-xs text-muted">
                    {active.user_email ?? ''}{' '}
                    {active.user_role
                      ? `• ${
                          { customer: 'Müştəri', provider: 'Usta' }[
                            active.user_role
                          ] ?? active.user_role
                        }`
                      : ''}
                  </div>
                </div>
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-bold ${
                    CATEGORY_COLORS[active.category ?? 'general']
                  }`}
                >
                  {CATEGORY_LABELS[active.category ?? 'general'] ?? active.category}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 [scrollbar-width:thin] min-h-[300px]">
                {msgLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin text-brand-600" size={20} />
                  </div>
                ) : (
                  messages.map((m) => {
                    const fromUser = m.sender_id === active.customer_id;
                    return (
                      <div
                        key={m.id}
                        className={`flex ${fromUser ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                            fromUser
                              ? 'bg-surface-bg text-ink rounded-bl-sm'
                              : 'bg-brand-600 text-white rounded-br-sm'
                          }`}
                        >
                          {m.body}
                          <div
                            className={`text-[10px] mt-1 ${
                              fromUser ? 'text-muted' : 'text-white/70'
                            }`}
                          >
                            {new Date(m.created_at).toLocaleString('az-AZ', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="p-3 border-t border-border flex gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                  rows={1}
                  placeholder="Cavab yazın… (Enter göndərir)"
                  className="flex-1 resize-none rounded-xl border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                <button
                  onClick={() => void sendReply()}
                  disabled={sending || !reply.trim()}
                  className="w-11 h-11 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-colors"
                >
                  {sending ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
