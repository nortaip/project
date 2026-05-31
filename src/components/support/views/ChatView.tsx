import { ChevronLeft, Send, Loader2, AlertCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { getCategory, type Lang, type SupportCategoryKey } from '../data/faqData';
import { useSupportPanel } from '../SupportPanelProvider';

interface Props { categoryKey: SupportCategoryKey }

interface Msg {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export default function ChatView({ categoryKey }: Props) {
  const { i18n } = useTranslation();
  const { goHome, userRole } = useSupportPanel();
  const lang = (i18n.language?.slice(0, 2) as Lang) || 'az';

  const cat = getCategory(categoryKey);
  const Icon = cat?.icon;

  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling(cid: string, ownId: string) {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', cid)
        .order('created_at', { ascending: true });
      if (!data) return;
      setMessages((prev) => {
        const realIds = new Set((data as Msg[]).map((m) => m.id));
        // Keep temp optimistic messages whose body doesn't yet appear in DB
        const remainingTemps = prev.filter(
          (p) =>
            p.id.startsWith('temp_') &&
            !(data as Msg[]).some((m) => m.sender_id === p.sender_id && m.body === p.body),
        );
        const merged = [...(data as Msg[]), ...remainingTemps];
        // Quick equality check to skip render if nothing changed
        if (
          prev.length === merged.length &&
          prev.every((p, i) => merged[i]?.id === p.id) &&
          merged.every((m) => realIds.has(m.id) || m.id.startsWith('temp_'))
        ) return prev;
        return merged;
      });
      // Mark inbound as read
      const inbound = (data as Msg[]).filter((m) => m.sender_id !== ownId);
      if (inbound.length) {
        await supabase
          .from('chat_messages')
          .update({ read_at: new Date().toISOString() })
          .eq('conversation_id', cid)
          .neq('sender_id', ownId)
          .is('read_at', null);
      }
    }, 3000);
  }

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Auth required');
        if (cancelled) return;
        setUserId(user.id);

        const { data: id, error: rpcErr } = await supabase.rpc('open_support_conversation', {
          p_category: categoryKey,
          p_user_role: userRole,
        });
        if (rpcErr) throw rpcErr;
        if (!id) throw new Error('Could not open conversation');
        if (cancelled) return;
        const cid = id.toString();
        setConvId(cid);

        const { data: msgs, error: msgErr } = await supabase
          .from('chat_messages')
          .select('id, sender_id, body, created_at')
          .eq('conversation_id', cid)
          .order('created_at', { ascending: true });
        if (msgErr) throw msgErr;
        if (cancelled) return;
        setMessages((msgs as Msg[]) || []);

        // Mark admin messages as read
        await supabase
          .from('chat_messages')
          .update({ read_at: new Date().toISOString() })
          .eq('conversation_id', cid)
          .neq('sender_id', user.id)
          .is('read_at', null);

        channel = supabase
          .channel(`support_chat_${cid}`, { config: { broadcast: { self: true } } })
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `conversation_id=eq.${cid}`,
          }, (payload) => {
            const m = payload.new as Msg;
            setMessages((prev) => {
              if (prev.some((p) => p.id === m.id)) return prev;
              // Replace any optimistic temp message with same body/sender (defensive)
              const filtered = prev.filter(
                (p) => !(p.id.startsWith('temp_') && p.sender_id === m.sender_id && p.body === m.body),
              );
              return [...filtered, m];
            });
            // Mark inbound as read immediately (panel is open)
            if (m.sender_id !== user.id) {
              supabase.from('chat_messages')
                .update({ read_at: new Date().toISOString() })
                .eq('id', m.id)
                .then(() => undefined);
            }
          })
          .subscribe((status) => {
            // If realtime fails to connect, fall back to lightweight polling
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              startPolling(cid, user.id);
            }
          });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Xəta');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [categoryKey, userRole]);

  async function send() {
    const body = text.trim();
    if (!body || !convId || sending) return;
    setSending(true);
    setText('');
    // Optimistic insert with a temporary id so the sender sees the bubble immediately
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic: Msg = {
      id: tempId,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const { data, error: err } = await supabase
        .from('chat_messages')
        .insert({ conversation_id: convId, sender_id: userId, body })
        .select('id, sender_id, body, created_at')
        .single();
      if (err) throw err;
      // Replace temp with real row (so dedup vs realtime works)
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        if (data && !withoutTemp.some((m) => m.id === data.id)) {
          return [...withoutTemp, data as Msg];
        }
        return withoutTemp;
      });
    } catch (e) {
      // Rollback optimistic
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
      setError(e instanceof Error ? e.message : 'Mesaj göndərilə bilmədi');
    } finally {
      setSending(false);
    }
  }

  const headerTitle = lang === 'ru' ? 'Поддержка' : lang === 'en' ? 'Support' : 'Dəstək';
  const placeholder = lang === 'ru' ? 'Введите сообщение...' : lang === 'en' ? 'Type a message...' : 'Mesajınızı yazın...';
  const emptyText = lang === 'ru' ? 'Опишите ситуацию — мы скоро ответим' : lang === 'en' ? 'Describe your issue — we will reply shortly' : 'Mövzunu yazın — tezliklə cavab veririk';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-bg">
      {/* Sub-header */}
      <div className="px-4 py-3 border-b border-border bg-white flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={goHome}
          aria-label="Geri"
          className="w-8 h-8 rounded-lg bg-surface-bg hover:bg-border flex items-center justify-center text-ink-soft"
        >
          <ChevronLeft size={18} />
        </button>
        <div className={`w-9 h-9 rounded-xl ${cat?.bg || 'bg-brand-50'} ${cat?.color || 'text-brand-600'} flex items-center justify-center`}>
          {Icon ? <Icon size={18} strokeWidth={2.25} /> : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-sm text-ink">
            {headerTitle} • {cat?.title[lang] ?? ''}
          </p>
          <p className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 flex gap-2">
          <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="text-brand-600 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted text-center px-6">{emptyText}</p>
          </div>
        ) : (
          messages.map((m) => {
            const own = m.sender_id === userId;
            const time = new Date(m.created_at).toLocaleTimeString('az-AZ', {
              hour: '2-digit', minute: '2-digit',
            });
            return (
              <div key={m.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div
                    className={`px-3.5 py-2 rounded-2xl text-sm break-words ${
                      own
                        ? 'bg-brand-600 text-white rounded-br-md'
                        : 'bg-white text-ink rounded-bl-md border border-border'
                    }`}
                  >
                    {m.body}
                  </div>
                  <p className={`text-[10px] mt-1 text-muted ${own ? 'text-right' : 'text-left'}`}>
                    {time}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-border bg-white shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={sending || loading}
            className="flex-1 max-h-32 resize-none px-3.5 py-2.5 rounded-2xl border border-border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm disabled:bg-surface-bg"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending || loading}
            aria-label="Göndər"
            className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center disabled:bg-gray-300 hover:bg-brand-700 transition-colors shrink-0"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}