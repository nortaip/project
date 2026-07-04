import { useEffect, useState } from 'react';
import { Send, AlertCircle, Loader2, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageContainer } from '../components/ui';

export default function SupportChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const messagesEndRef = useEffect(() => {}, []);

  useEffect(() => {
    initializeChat();
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 0);
    }
  }, [messages]);

  async function initializeChat() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      setCurrentUserId(user.id);

      // Open support conversation
      const { data: convId, error: convErr } = await supabase.rpc(
        'open_support_conversation'
      );

      if (convErr) throw convErr;
      if (!convId) throw new Error('Failed to open support conversation');

      setConversationId(convId.toString());

      // Load messages
      const { data: msgs, error: msgErr } = await supabase
        .from('chat_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', convId.toString())
        .order('created_at', { ascending: true });

      if (msgErr) throw msgErr;
      setMessages(msgs || []);

      // Subscribe to real-time messages
      const messageSubscription = supabase
        .channel(`chat:${convId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `conversation_id=eq.${convId}`,
          },
          (payload) => {
            const newMsg = {
              id: payload.new.id,
              sender_id: payload.new.sender_id,
              body: payload.new.body,
              created_at: payload.new.created_at,
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) {
                return prev;
              }
              return [...prev, newMsg];
            });
          }
        )
        .subscribe();

      const convSubscription = supabase
        .channel(`conv:${convId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${convId}`,
        }, () => {})
        .subscribe();

      return () => {
        messageSubscription.unsubscribe();
        convSubscription.unsubscribe();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMessage() {
    if (!messageText.trim() || !conversationId) return;

    setSending(true);
    try {
      const { error: err } = await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        sender_id: currentUserId,
        body: messageText.trim(),
      });

      if (err) throw err;
      setMessageText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mesaj göndərilə bilmədi');
    } finally {
      setSending(false);
    }
  }

  return (
    <PageContainer>
      <div className="h-[calc(100vh-120px)] flex flex-col bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
              <MessageCircle size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Dəstək (24/7)</h1>
              <p className="text-sm text-gray-600">Admin tərəfindən real-time dəstək</p>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Messages Container */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Loader2 size={32} className="text-brand-600 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-600">Yüklənir...</p>
            </div>
          </div>
        ) : (
          <>
            <div
              id="messages-container"
              className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
            >
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageCircle size={48} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500 font-medium">Hələ mesaj yoxdur</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Suallarınız üçün birinci mesajı göndərin
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = msg.sender_id === currentUserId;
                  const time = new Date(msg.created_at).toLocaleTimeString('az-AZ', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="max-w-xs">
                        <div
                          className={`px-4 py-2 rounded-lg ${
                            isOwn
                              ? 'bg-brand-600 text-white rounded-br-none'
                              : 'bg-gray-200 text-gray-900 rounded-bl-none'
                          }`}
                        >
                          <p className="text-sm break-words">{msg.body}</p>
                        </div>
                        <p
                          className={`text-xs mt-1 ${
                            isOwn ? 'text-right' : 'text-left'
                          } text-gray-500`}
                        >
                          {time}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 px-6 py-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Mesajınızı yazın..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={sending}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent disabled:bg-gray-50"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={sending || !messageText.trim()}
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-gray-300 transition-colors flex items-center gap-2 font-medium"
                >
                  {sending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Göndər</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
}
