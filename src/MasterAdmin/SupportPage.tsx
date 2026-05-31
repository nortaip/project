import { useEffect, useState } from 'react';
import { Send, Loader2, MessageSquare, Clock, MessageCircle, Search } from 'lucide-react';
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
  unread_count: number;
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
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadConversations();
    loadAdminId();
  }, []);

  // Auto-scroll to bottom when messages arrive
  useEffect(() => {
    const container = document.getElementById('messages-container');
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 0);
    }
  }, [messages]);

  // Update localStorage with unread count whenever conversations change
  useEffect(() => {
    const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
    localStorage.setItem('support_unread_count', totalUnread.toString());
    // Trigger storage event for other tabs
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'support_unread_count',
      newValue: totalUnread.toString(),
      oldValue: localStorage.getItem('support_unread_count'),
    }));
  }, [conversations]);

  async function loadAdminId() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setAdminId(user.id);
  }

  async function loadConversations() {
    try {
      setLoading(true);
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('id, customer_id, provider_id, last_message_at, last_message_preview')
        .is('opportunity_id', null)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (convErr) throw convErr;

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
        unread_count: 0,
      }));

      setConversations(formattedConvs);
      if (formattedConvs.length > 0 && !selectedConvId) {
        setSelectedConvId(formattedConvs[0].id);
      }
      // Update localStorage with unread count
      const totalUnread = formattedConvs.reduce((sum, c) => sum + c.unread_count, 0);
      localStorage.setItem('support_unread_count', totalUnread.toString());
    } catch (err) {
      console.error('Error loading conversations:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const subscription = supabase
      .channel('support_conversations')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: 'opportunity_id=is.null',
      }, () => {
        loadConversations();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  async function loadMessages(convId: string) {
    try {
      const { data: msgs, error: msgErr } = await supabase
        .from('chat_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (msgErr) throw msgErr;

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

  useEffect(() => {
    if (!selectedConvId) return;

    // Mark as read when conversation is opened
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === selectedConvId ? { ...conv, unread_count: 0 } : conv
      )
    );

    loadMessages(selectedConvId);

    const subscription = supabase
      .channel(`chat_${selectedConvId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${selectedConvId}`,
      }, async (payload) => {
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

        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });

        // Show browser notification
        const senderName = sender?.name || 'Müştəri';
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Yeni Dəstək Mesajı', {
            body: `${senderName}: ${payload.new.body.substring(0, 100)}`,
            icon: '/logo.png',
            tag: `support-${selectedConvId}`,
          });
        }

        // Increment unread count if this isn't the current conversation
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === selectedConvId
              ? conv
              : conv.id === payload.new.conversation_id
              ? { ...conv, unread_count: conv.unread_count + 1 }
              : conv
          )
        );
      })
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
    return date.toLocaleDateString('az-AZ');
  }

  const filteredConversations = conversations.filter((conv) =>
    conv.customer_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  return (
    <AdminLayout title="Dəstək" subtitle="24/7 dəstək söhbətləri">
      <div className="h-[calc(100vh-160px)] flex gap-4 bg-gray-50">
        {/* Conversations Sidebar */}
        <div className="w-80 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm">
          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Müştəri axtar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={20} className="text-brand-600 animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <MessageCircle size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">{searchQuery ? 'Nəticə yoxdur' : 'Söhbət yoxdur'}</p>
                </div>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${
                    selectedConvId === conv.id ? 'bg-brand-50 border-l-4 border-l-brand-600' : ''
                  } ${conv.unread_count > 0 ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex gap-3">
                    <div
                      className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex-shrink-0 relative"
                      style={{
                        backgroundImage: conv.customer_avatar
                          ? `url('${conv.customer_avatar}')`
                          : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    >
                      {conv.unread_count > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${
                        conv.unread_count > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'
                      }`}>
                        {conv.customer_name}
                      </p>
                      <p className="text-xs text-gray-600 truncate mt-0.5">
                        {conv.last_message_preview || 'Mesaj yoxdur'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {conv.unread_count > 0 && (
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      )}
                      {conv.last_message_at && (
                        <div className="text-xs text-gray-500">
                          {formatDate(conv.last_message_at)}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer Stats */}
          <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 text-center">
            {conversations.length} açıq söhbət
            {conversations.reduce((sum, c) => sum + c.unread_count, 0) > 0 && (
              <div className="text-red-600 font-semibold mt-1">
                {conversations.reduce((sum, c) => sum + c.unread_count, 0)} oxunmamış mesaj
              </div>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm">
          {selectedConv ? (
            <>
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600"
                    style={{
                      backgroundImage: selectedConv.customer_avatar
                        ? `url('${selectedConv.customer_avatar}')`
                        : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      {selectedConv.customer_name}
                    </h2>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {selectedConv.last_message_at
                        ? `Son mesaj: ${formatDate(selectedConv.last_message_at)}`
                        : 'Heç vaxt'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div id="messages-container" className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <MessageSquare size={40} className="text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500">Mesaj yoxdur</p>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isAdmin = msg.sender_id === adminId;
                    const time = new Date(msg.created_at).toLocaleTimeString('az-AZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="max-w-md">
                          {!isAdmin && (
                            <p className="text-xs font-semibold text-gray-600 mb-1">
                              {msg.sender_name}
                            </p>
                          )}
                          <div
                            className={`px-4 py-2 rounded-lg ${
                              isAdmin
                                ? 'bg-brand-600 text-white rounded-br-none'
                                : 'bg-gray-100 text-gray-900 rounded-bl-none'
                            }`}
                          >
                            <p className="text-sm break-words">{msg.body}</p>
                          </div>
                          <p
                            className={`text-xs mt-1 ${
                              isAdmin ? 'text-right' : 'text-left'
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

              {/* Input */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Cavab yazın..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    disabled={sending}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent disabled:bg-gray-100"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !messageText.trim()}
                    className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-gray-300 transition-colors flex items-center gap-2 font-medium text-sm"
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
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <MessageCircle size={48} className="text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium">Söhbət seçin</p>
                <p className="text-sm text-gray-400 mt-1">Müştəri ilə söhbətə başlamaq üçün seçin</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
