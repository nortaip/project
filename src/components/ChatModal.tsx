import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, MessageCircle, Phone, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openConversation, type ChatMessage } from '../lib/chat';

interface Props {
  opportunityId: string;
  /** Qarşı tərəfin profil id-si (müştəri üçün usta, usta üçün müştəri). */
  peerId: string;
  peerName?: string | null;
  peerAvatar?: string | null;
  peerPhone?: string | null;
  /** Başlıq altında göstərilən kontekst (məs. sifarişin adı). */
  subtitle?: string | null;
  onClose: () => void;
}

/**
 * Sifariş üzrə müştəri ↔ usta söhbəti (modal). `open_conversation` ilə
 * söhbəti açır, mesajları canlı (realtime) göstərir və göndərir.
 */
export default function ChatModal({
  opportunityId,
  peerId,
  peerName,
  peerAvatar,
  peerPhone,
  subtitle,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const [convId, setConvId] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Escape ilə bağla
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Söhbəti aç + mesajları yüklə + canlı izlə
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const markRead = async (cid: string, uid: string) => {
      await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', cid)
        .neq('sender_id', uid)
        .is('read_at', null);
    };

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: auth } = await supabase.auth.getSession();
        const uid = auth.session?.user?.id ?? null;
        if (!uid) throw new Error(t('balance.errors.loginRequired'));
        if (cancelled) return;
        setMe(uid);

        const cid = await openConversation(opportunityId, peerId);
        if (cancelled) return;
        setConvId(cid);

        const { data, error: msgErr } = await supabase
          .from('chat_messages')
          .select('id, sender_id, body, created_at, read_at')
          .eq('conversation_id', cid)
          .order('created_at', { ascending: true })
          .limit(500);
        if (msgErr) throw new Error(msgErr.message);
        if (cancelled) return;
        setMessages((data ?? []) as ChatMessage[]);
        void markRead(cid, uid);

        channel = supabase
          .channel(`offer-chat-${cid}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'chat_messages',
              filter: `conversation_id=eq.${cid}`,
            },
            (payload) => {
              const m = payload.new as ChatMessage;
              if (!m?.id) return;
              setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
              if (m.sender_id !== uid) void markRead(cid, uid);
            },
          )
          .subscribe();
      } catch (e) {
        if (!cancelled) {
          setError(
            `${t('offerTerms.chat.openError')}${
              e instanceof Error && e.message ? `: ${e.message}` : ''
            }`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId, peerId]);

  // Yeni mesajda aşağı sürüşdür
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (!loading && convId) inputRef.current?.focus();
  }, [loading, convId]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !convId || !me || sending) return;
    setSending(true);
    setError(null);
    const { data, error: sendErr } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: convId, sender_id: me, body })
      .select('id, sender_id, body, created_at, read_at')
      .single();
    setSending(false);
    if (sendErr) {
      setError(`${t('offerTerms.chat.sendError')}: ${sendErr.message}`);
      return;
    }
    setText('');
    const m = data as ChatMessage | null;
    if (m?.id) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }

  const locale = i18n.language?.slice(0, 2) === 'az' ? 'az-Latn-AZ' : i18n.language;
  const timeOf = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const name = peerName || t('offerTerms.chat.peerFallback');

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('offerTerms.chat.title')}
    >
      <div
        className="w-full sm:max-w-lg h-[85vh] sm:h-[min(640px,88vh)] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 font-extrabold flex items-center justify-center overflow-hidden shrink-0">
            {peerAvatar ? (
              <img src={peerAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink text-sm truncate">{name}</p>
            {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
          </div>
          {peerPhone && (
            <a
              href={`tel:${peerPhone}`}
              className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center shrink-0"
              title={t('offerTerms.actions.call')}
              aria-label={t('offerTerms.actions.call')}
            >
              <Phone size={16} />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-bg hover:bg-brand-50 text-muted hover:text-brand-600 flex items-center justify-center shrink-0"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-surface-bg/50">
          {loading ? (
            <div className="h-full flex items-center justify-center text-muted">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : messages.length === 0 && !error ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <MessageCircle size={40} className="text-border mb-2" />
              <p className="text-sm font-bold text-ink-soft">{t('offerTerms.chat.emptyTitle')}</p>
              <p className="text-xs text-muted mt-1">{t('offerTerms.chat.emptyBody')}</p>
            </div>
          ) : (
            messages.map((m) => {
              const own = m.sender_id === me;
              return (
                <div key={m.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%]">
                    <div
                      className={`px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                        own
                          ? 'bg-brand-600 text-white rounded-br-md'
                          : 'bg-white border border-border text-ink rounded-bl-md'
                      }`}
                    >
                      {m.body}
                    </div>
                    <p className={`text-[10px] text-muted mt-0.5 ${own ? 'text-right' : 'text-left'}`}>
                      {timeOf(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <div className="mx-4 mt-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-xs flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Composer */}
        <form onSubmit={send} className="flex items-end gap-2 p-3 border-t border-border">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            disabled={!convId}
            placeholder={t('offerTerms.chat.placeholder')}
            className="flex-1 max-h-32 min-h-[44px] px-4 py-2.5 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 focus:bg-white outline-none text-sm text-ink resize-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!convId || sending || !text.trim()}
            className="h-11 w-11 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center shrink-0 disabled:opacity-50"
            aria-label={t('offerTerms.chat.send')}
            title={t('offerTerms.chat.send')}
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}
