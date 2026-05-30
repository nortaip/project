import { useEffect, useState } from 'react';
import { Send, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import UserLayout from '../layouts/UserLayout';

export default function SupportChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    initializeChat();
  }, []);

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

      // Subscribe to new messages
      const subscription = supabase
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
            setMessages((prev) => [...prev, payload.new]);
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطایی رخ داد');
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
      setError(err instanceof Error ? err.message : 'خطا در ارسال پیام');
    } finally {
      setSending(false);
    }
  }

  return (
    <UserLayout>
      <div className="max-w-2xl mx-auto h-[calc(100vh-200px)] flex flex-col">
        {/* Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <h1 className="text-xl font-bold text-gray-900">پشتیبانی 24/7</h1>
          <p className="text-sm text-gray-600 mt-1">
            هر وقت سوالی داشتید ما اینجا هستیم تا کمکتان کنیم
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Messages Container */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={32} className="text-brand-600 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 bg-white rounded-lg border border-gray-200 p-4 overflow-y-auto space-y-3">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <p>هیچ پیامی هنوز نیست. اولین پیام را ارسال کنید</p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isOwn = msg.sender_id === currentUserId;
                  const time = new Date(msg.created_at).toLocaleTimeString('fa-IR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={idx}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs px-4 py-2 rounded-lg ${
                        isOwn
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        <p className="text-sm">{msg.body}</p>
                        <p className={`text-xs mt-1 ${
                          isOwn ? 'text-brand-100' : 'text-gray-500'
                        }`}>
                          {time}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mt-4 flex gap-2">
              <input
                type="text"
                placeholder="پیام خود را بنویسید..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={sending}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-100"
              />
              <button
                onClick={handleSendMessage}
                disabled={sending || !messageText.trim()}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </UserLayout>
  );
}
