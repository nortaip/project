import { useEffect, useState } from 'react';
import { Send, Loader2, MessageSquare, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface Conversation {
  id: string;
  customer_id: string;
  provider_id: string;
  customer_name: string;
  customer_avatar: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count?: number;
}

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name: string;
}

export default function SupportPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [adminId, setAdminId] = useState('');

  useEffect(() => {
    loadConversations();
    loadAdminId();
  }, []);

  async function loadAdminId() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setAdminId(user.id);
  }

  async function loadConversations() {
    try {
      setLoading(true);
      // Load all support conversations (opportunity_id IS NULL = support conversations)
      // Any admin can see all support conversations
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select(
          `
          id,
          customer_id,
          provider_id,
          last_message_at,
          last_message_preview
          `
        )
        .is('opportunity_id', null)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (convErr) throw convErr;

      // Get customer profiles separately to avoid FK issues
      const customerIds = convs?.map((c: any) => c.customer_id) || [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', customerIds);

      const profileMap = new Map(profiles?.map((p: any) => [p.id, p]) || []);

      const formattedConvs = (convs || []).map((c: any) => ({
        id: c.id,
        customer_id: c.customer_id,
        provider_id: c.provider_id,
        customer_name: profileMap.get(c.customer_id)?.name || 'Naməlum',
        customer_avatar: profileMap.get(c.customer_id)?.avatar_url || null,
        last_message_at: c.last_message_at,
        last_message_preview: c.last_message_preview,
      }));

      setConversations(formattedConvs);
      if (formattedConvs.length > 0 && !selectedConvId) {
        setSelectedConvId(formattedConvs[0].id);
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    } finally {
      setLoading(false);
    }
  }

  // Subscribe to real-time conversation updates
  useEffect(() => {
    const subscription = supabase
      .channel('support_conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: 'opportunity_id=is.null',
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadMessages(convId: string) {
    try {
      const { data: msgs, error: msgErr } = await supabase
        .from('chat_messages')
        .select(
          `
          id,
          sender_id,
          body,
          created_at
          `
        )
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (msgErr) throw msgErr;

      // Get sender profiles separately
      const senderIds = msgs?.map((m: any) => m.sender_id) || [];
      const { data: senders } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', senderIds);

      const senderMap = new Map(senders?.map((s: any) => [s.id, s]) || []);

      const formattedMsgs = (msgs || []).map((m: any) => ({
        id: m.id,
        sender_id: m.sender_id,
        body: m.body,
        created_at: m.created_at,
        sender_name: senderMap.get(m.sender_id)?.name || 'Naməlum',
      }));

      setMessages(formattedMsgs);
    } catch (err) {
      console.error('Error loading messages:', err);
    }
  }

  // Subscribe to real-time message updates for selected conversation
  useEffect(() => {
    if (!selectedConvId) return;

    loadMessages(selectedConvId);

    const subscription = supabase
      .channel(`chat_${selectedConvId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${selectedConvId}`,
        },
        async (payload) => {
          // Get sender info
          const { data: sender } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', payload.new.sender_id)
            .single();

          const newMsg = {
            id: payload.new.id,
            sender_id: payload.new.sender_id,
            body: payload.new.body,
            created_at: payload.new.created_at,
            sender_name: sender?.name || 'Naməlum',
          };
          setMessages((prev) => [...prev, newMsg]);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [selectedConvId]);

  async function handleSendMessage() {
    if (!messageText.trim() || !selectedConvId) return;

    setSending(true);
    try {
      const { error: err } = await supabase.from('chat_messages').insert({
        conversation_id: selectedConvId,
        sender_id: adminId,
        body: messageText.trim(),
      });

      if (err) throw err;
      setMessageText('');
      await loadMessages(selectedConvId);
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'İndi';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('fa-IR');
  }

  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  return (
    <AdminLayout
      title="Dəstək"
      subtitle="Dəstək söhbətləri və istifadəçi məlumatları"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
        {/* Conversations List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Söhbətlər</h2>
            <p className="text-sm text-gray-600 mt-1">
              {conversations.length} açıq söhbət
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={24} className="text-brand-600 animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p className="text-center">Söhbət yoxdur</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full text-right px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    selectedConvId === conv.id ? 'bg-blue-50 border-l-4 border-l-brand-600' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0"
                      style={{
                        backgroundImage: conv.customer_avatar
                          ? `url('${conv.customer_avatar}')`
                          : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {conv.customer_name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {conv.last_message_preview || 'Mesaj yoxdur'}
                      </p>
                    </div>
                    <div className="text-xs text-gray-500 flex-shrink-0">
                      {conv.last_message_at && (
                        <Clock size={12} />
                      )}
                      {conv.last_message_at && formatDate(conv.last_message_at)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
          {selectedConv ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">
                  {selectedConv.customer_name}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Son mesaj:{' '}
                  {selectedConv.last_message_at
                    ? formatDate(selectedConv.last_message_at)
                    : 'Heç vaxt'}
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <p>Mesaj yoxdur</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isAdmin = msg.sender_id === adminId;
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-xs px-4 py-2 rounded-lg ${
                            isAdmin
                              ? 'bg-brand-600 text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          <p className="text-sm">{msg.body}</p>
                          <p
                            className={`text-xs mt-1 ${
                              isAdmin ? 'text-brand-100' : 'text-gray-500'
                            }`}
                          >
                            {new Date(msg.created_at).toLocaleTimeString('fa-IR')}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-gray-200 flex gap-2">
                <input
                  type="text"
                  placeholder="Mesaj yazın..."
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
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Söhbət seçin</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
