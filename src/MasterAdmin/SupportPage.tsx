import { useEffect, useMemo, useState } from 'react';
import {
  Send, Loader2, MessageSquare, MessageCircle, Search,
  ShoppingBag, CreditCard, Fingerprint, Briefcase, HelpCircle,
  User, Users as UsersIcon,
  Info, X, Copy, Check, Mail, Phone, MapPin, Calendar, Wallet, ShieldCheck, Tag, Globe2, ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface CustomerProfile {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  role: string | null;
  balance: number | null;
  kyc_status: string | null;
  city: string | null;
  address: string | null;
  language: string | null;
  created_at: string | null;
  is_online: boolean | null;
  last_seen_at: string | null;
}

type CategoryKey = 'order' | 'payment' | 'kyc' | 'provider' | 'general';
type RoleFilter = 'all' | 'customer' | 'provider';

const CATEGORY_META: Record<CategoryKey, { label: string; color: string; bg: string; icon: any }> = {
  order:    { label: 'Sifariş',  color: 'text-blue-700',    bg: 'bg-blue-50',    icon: ShoppingBag },
  payment:  { label: 'Ödəniş',   color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CreditCard },
  kyc:      { label: 'KYC',      color: 'text-violet-700',  bg: 'bg-violet-50',  icon: Fingerprint },
  provider: { label: 'Provayder',color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Briefcase },
  general:  { label: 'Digər',    color: 'text-slate-700',   bg: 'bg-slate-100',  icon: HelpCircle },
};

interface Conversation {
  id: string;
  customer_id: string;
  provider_id: string;
  category: CategoryKey;
  user_role: 'customer' | 'provider';
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
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copyToClipboard(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  useEffect(() => {
    loadConversations();
    loadAdminId();
  }, []);

  useEffect(() => {
    const container = document.getElementById('messages-container');
    if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 0);
  }, [messages]);

  // Load full customer profile when a conversation is selected
  useEffect(() => {
    if (!selectedConvId) {
      setCustomerProfile(null);
      return;
    }
    const conv = conversations.find((c) => c.id === selectedConvId);
    if (!conv?.customer_id) {
      setCustomerProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, name, email, phone_number, avatar_url, role, balance, kyc_status, city, address, language, created_at, is_online, last_seen_at')
        .eq('id', conv.customer_id)
        .maybeSingle();
      if (cancelled) return;
      setCustomerProfile((data as CustomerProfile | null) ?? null);
      setProfileLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedConvId, conversations]);

  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + c.unread_count, 0);
    localStorage.setItem('support_unread_count', total.toString());
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'support_unread_count',
      newValue: total.toString(),
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
        .select('id, customer_id, provider_id, category, user_role, last_message_at, last_message_preview')
        .is('opportunity_id', null)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (convErr) throw convErr;

      const customerIds = (convs as any[] | null)?.map((c) => c.customer_id) ?? [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', customerIds);

      const profileMap = new Map(profiles?.map((p: any) => [p.id, p]) || []);

      // Unread count per conversation
      const { data: unreadRows } = await supabase
        .from('chat_messages')
        .select('conversation_id')
        .in('conversation_id', (convs as any[])?.map((c) => c.id) ?? [])
        .neq('sender_id', adminId || '00000000-0000-0000-0000-000000000000')
        .is('read_at', null);
      const unreadMap = new Map<string, number>();
      (unreadRows as any[] | null)?.forEach((r) => {
        unreadMap.set(r.conversation_id, (unreadMap.get(r.conversation_id) ?? 0) + 1);
      });

      const formatted: Conversation[] = (convs as any[] || []).map((c) => ({
        id: c.id,
        customer_id: c.customer_id,
        provider_id: c.provider_id,
        category: (c.category as CategoryKey) || 'general',
        user_role: (c.user_role as 'customer' | 'provider') || 'customer',
        customer_name: profileMap.get(c.customer_id)?.name || 'Naməlum',
        customer_avatar: profileMap.get(c.customer_id)?.avatar_url || null,
        last_message_at: c.last_message_at,
        last_message_preview: c.last_message_preview,
        unread_count: unreadMap.get(c.id) ?? 0,
      }));

      setConversations(formatted);
      if (formatted.length > 0 && !selectedConvId) setSelectedConvId(formatted[0].id);
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
      }, () => loadConversations())
      .subscribe();
    return () => { subscription.unsubscribe(); };
  }, [adminId]);

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

      const senderIds = (msgs as any[] | null)?.map((m) => m.sender_id) ?? [];
      const { data: senders } = await supabase.from('profiles').select('id, name').in('id', senderIds);
      const senderMap = new Map(senders?.map((s: any) => [s.id, s]) || []);

      setMessages(((msgs as any[]) || []).map((m) => ({
        id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at,
        sender_name: senderMap.get(m.sender_id)?.name || 'Naməlum',
      })));

      // Mark inbound as read
      if (adminId) {
        await supabase.from('chat_messages')
          .update({ read_at: new Date().toISOString() })
          .eq('conversation_id', convId)
          .neq('sender_id', adminId)
          .is('read_at', null);
      }
    } catch (err) {
      console.error('Error loading messages:', err);
    }
  }

  useEffect(() => {
    if (!selectedConvId) return;
    setConversations((prev) => prev.map((conv) => conv.id === selectedConvId ? { ...conv, unread_count: 0 } : conv));
    loadMessages(selectedConvId);

    const subscription = supabase
      .channel(`chat_${selectedConvId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${selectedConvId}`,
      }, async (payload) => {
        const { data: sender } = await supabase.from('profiles').select('name').eq('id', payload.new.sender_id).single();
        const newMsg: Message = {
          id: payload.new.id,
          sender_id: payload.new.sender_id,
          body: payload.new.body,
          created_at: payload.new.created_at,
          sender_name: sender?.name || 'Naməlum',
        };
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          // Dedup optimistic temp-i: əgər eyni body/sender ilə temp varsa onu sil
          const filtered = prev.filter(
            (m) => !(m.id.startsWith('temp_') && m.sender_id === newMsg.sender_id && m.body === newMsg.body),
          );
          return [...filtered, newMsg];
        });

        const senderName = sender?.name || 'Müştəri';
        if ('Notification' in window && Notification.permission === 'granted' && payload.new.sender_id !== adminId) {
          new Notification('Yeni Dəstək Mesajı', {
            body: `${senderName}: ${payload.new.body.substring(0, 100)}`,
            icon: '/logo.png',
            tag: `support-${selectedConvId}`,
          });
        }
      })
      .subscribe();
    return () => { subscription.unsubscribe(); };
  }, [selectedConvId, adminId]);

  async function handleSendMessage() {
    const body = messageText.trim();
    if (!body || !selectedConvId) return;
    const convId = selectedConvId;
    setMessageText('');
    setSending(true);

    // Optimistic: admin öz cavabını dərhal görsün
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: tempId,
      sender_id: adminId,
      body,
      created_at: new Date().toISOString(),
      sender_name: 'Admin',
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const { data, error: err } = await supabase
        .from('chat_messages')
        .insert({ conversation_id: convId, sender_id: adminId, body })
        .select('id, sender_id, body, created_at')
        .single();
      if (err) throw err;
      // Temp-i real ilə əvəz et
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        if (data && !withoutTemp.some((m) => m.id === data.id)) {
          return [...withoutTemp, { ...(data as any), sender_name: 'Admin' }];
        }
        return withoutTemp;
      });
    } catch (err) {
      console.error('Error sending message:', err);
      // Rollback
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setMessageText(body);
    } finally {
      setSending(false);
    }
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
    if (m < 1) return 'İndi';
    if (m < 60) return `${m}m`;
    if (h < 24) return `${h}h`;
    if (d < 7) return `${d}d`;
    return date.toLocaleDateString('az-AZ');
  }

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (roleFilter !== 'all' && c.user_role !== roleFilter) return false;
      if (searchQuery && !c.customer_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [conversations, categoryFilter, roleFilter, searchQuery]);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const selectedMeta = selectedConv ? CATEGORY_META[selectedConv.category] : null;
  const SelectedIcon = selectedMeta?.icon;

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: conversations.length };
    (Object.keys(CATEGORY_META) as CategoryKey[]).forEach((k) => {
      counts[k] = conversations.filter((c) => c.category === k).length;
    });
    return counts;
  }, [conversations]);

  return (
    <AdminLayout title="Dəstək" subtitle="24/7 dəstək söhbətləri">
      <div className="h-[calc(100vh-160px)] flex gap-4 bg-gray-50">
        {/* Conversations Sidebar */}
        <div className="w-96 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm">
          {/* Search */}
          <div className="p-3 border-b border-gray-200 space-y-2">
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

            {/* Role filter chips */}
            <div className="flex gap-1">
              {([
                { k: 'all', label: 'Hamısı', icon: UsersIcon },
                { k: 'customer', label: 'Müştəri', icon: User },
                { k: 'provider', label: 'Provayder', icon: Briefcase },
              ] as { k: RoleFilter; label: string; icon: any }[]).map((r) => {
                const Icon = r.icon;
                const active = roleFilter === r.k;
                return (
                  <button
                    key={r.k}
                    type="button"
                    onClick={() => setRoleFilter(r.k)}
                    className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                      active ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon size={12} />
                    {r.label}
                  </button>
                );
              })}
            </div>

            {/* Category filter chips */}
            <div className="flex gap-1 overflow-x-auto pb-1 -mb-1">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold ${
                  categoryFilter === 'all' ? 'bg-ink text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Hamısı ({categoryCounts.all})
              </button>
              {(Object.keys(CATEGORY_META) as CategoryKey[]).map((k) => {
                const meta = CATEGORY_META[k];
                const active = categoryFilter === k;
                const count = categoryCounts[k] ?? 0;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCategoryFilter(k)}
                    className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                      active ? `${meta.color.replace('text-','bg-').replace('-700','-600')} text-white` : `${meta.bg} ${meta.color} hover:opacity-80`
                    }`}
                  >
                    {meta.label} ({count})
                  </button>
                );
              })}
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
                  <p className="text-sm text-gray-500">{searchQuery || categoryFilter !== 'all' || roleFilter !== 'all' ? 'Nəticə yoxdur' : 'Söhbət yoxdur'}</p>
                </div>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const meta = CATEGORY_META[conv.category];
                const Icon = meta.icon;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`w-full px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${
                      selectedConvId === conv.id ? 'bg-brand-50 border-l-4 border-l-brand-600' : ''
                    } ${conv.unread_count > 0 ? 'bg-blue-50/40' : ''}`}
                  >
                    <div className="flex gap-3">
                      <div
                        className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex-shrink-0 relative"
                        style={{
                          backgroundImage: conv.customer_avatar ? `url('${conv.customer_avatar}')` : undefined,
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
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className={`text-sm truncate flex-1 ${conv.unread_count > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>
                            {conv.customer_name}
                          </p>
                          {conv.last_message_at && (
                            <span className="text-[10px] text-gray-500 shrink-0">{formatDate(conv.last_message_at)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-extrabold ${meta.bg} ${meta.color}`}>
                            <Icon size={10} />
                            {meta.label}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                            conv.user_role === 'provider' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {conv.user_role === 'provider' ? 'Provayder' : 'Müştəri'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 truncate">{conv.last_message_preview || 'Mesaj yoxdur'}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer Stats */}
          <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 text-center">
            {filteredConversations.length}/{conversations.length} söhbət
            {conversations.reduce((sum, c) => sum + c.unread_count, 0) > 0 && (
              <div className="text-red-600 font-semibold mt-1">
                {conversations.reduce((sum, c) => sum + c.unread_count, 0)} oxunmamış
              </div>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm">
          {selectedConv && selectedMeta ? (
            <>
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600"
                    style={{
                      backgroundImage: selectedConv.customer_avatar ? `url('${selectedConv.customer_avatar}')` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{selectedConv.customer_name}</h2>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        selectedConv.user_role === 'provider' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {selectedConv.user_role === 'provider' ? 'Provayder' : 'Müştəri'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold ${selectedMeta.bg} ${selectedMeta.color}`}>
                        {SelectedIcon && <SelectedIcon size={10} />}
                        {selectedMeta.label}
                      </span>
                      {selectedConv.last_message_at && (
                        <p className="text-xs text-gray-600">Son: {formatDate(selectedConv.last_message_at)}</p>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  title={detailsOpen ? 'Detalları bağla' : 'İstifadəçi detalları'}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    detailsOpen
                      ? 'bg-brand-600 text-white hover:bg-brand-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Info size={14} />
                  Detallar
                </button>
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
                    const time = new Date(msg.created_at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-md">
                          {!isAdmin && <p className="text-xs font-semibold text-gray-600 mb-1">{msg.sender_name}</p>}
                          <div className={`px-4 py-2 rounded-lg ${isAdmin ? 'bg-brand-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-900 rounded-bl-none'}`}>
                            <p className="text-sm break-words">{msg.body}</p>
                          </div>
                          <p className={`text-xs mt-1 ${isAdmin ? 'text-right' : 'text-left'} text-gray-500`}>{time}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input — həmişə aktiv */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Cavab yazın..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                    }}
                    autoFocus
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!messageText.trim()}
                    className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-gray-300 transition-colors flex items-center gap-2 font-medium text-sm"
                  >
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <><Send size={16} /><span>Göndər</span></>}
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

        {/* User Details Panel */}
        {detailsOpen && selectedConv && (
          <div className="w-80 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <p className="font-bold text-sm text-gray-900">İstifadəçi detalları</p>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Bağla"
                className="w-7 h-7 rounded-md hover:bg-gray-200 text-gray-600 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {profileLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="text-brand-600 animate-spin" />
                </div>
              ) : !customerProfile ? (
                <p className="text-xs text-gray-500 text-center py-8">Profil tapılmadı</p>
              ) : (
                <>
                  {/* Avatar + name */}
                  <div className="flex flex-col items-center text-center pb-3 border-b border-gray-100">
                    <div
                      className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 ring-4 ring-brand-50"
                      style={{
                        backgroundImage: customerProfile.avatar_url ? `url('${customerProfile.avatar_url}')` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                    <p className="mt-3 font-extrabold text-base text-gray-900">{customerProfile.name || 'Adsız'}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                        selectedConv.user_role === 'provider' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {selectedConv.user_role === 'provider' ? 'Provayder' : 'Müştəri'}
                      </span>
                      {customerProfile.is_online && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-100 text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Online
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detail rows */}
                  <DetailRow
                    icon={<Tag size={14} />}
                    label="UUID"
                    value={customerProfile.id}
                    copyKey="uuid"
                    copiedField={copiedField}
                    onCopy={() => copyToClipboard(customerProfile.id, 'uuid')}
                    mono
                  />
                  {customerProfile.email && (
                    <DetailRow
                      icon={<Mail size={14} />}
                      label="Email"
                      value={customerProfile.email}
                      copyKey="email"
                      copiedField={copiedField}
                      onCopy={() => copyToClipboard(customerProfile.email!, 'email')}
                      href={`mailto:${customerProfile.email}`}
                    />
                  )}
                  {customerProfile.phone_number && (
                    <DetailRow
                      icon={<Phone size={14} />}
                      label="Telefon"
                      value={customerProfile.phone_number}
                      copyKey="phone"
                      copiedField={copiedField}
                      onCopy={() => copyToClipboard(customerProfile.phone_number!, 'phone')}
                      href={`tel:${customerProfile.phone_number}`}
                    />
                  )}
                  {customerProfile.role && (
                    <DetailRow icon={<ShieldCheck size={14} />} label="Rol" value={customerProfile.role} />
                  )}
                  {customerProfile.balance !== null && customerProfile.balance !== undefined && (
                    <DetailRow icon={<Wallet size={14} />} label="Balans" value={`${customerProfile.balance.toFixed(2)} ₼`} />
                  )}
                  {customerProfile.kyc_status && (
                    <DetailRow
                      icon={<Fingerprint size={14} />}
                      label="KYC"
                      value={customerProfile.kyc_status}
                      valueClass={
                        customerProfile.kyc_status === 'approved' ? 'text-emerald-700 font-bold'
                        : customerProfile.kyc_status === 'rejected' ? 'text-red-700 font-bold'
                        : 'text-amber-700 font-bold'
                      }
                    />
                  )}
                  {customerProfile.city && (
                    <DetailRow icon={<MapPin size={14} />} label="Şəhər" value={customerProfile.city} />
                  )}
                  {customerProfile.address && (
                    <DetailRow icon={<MapPin size={14} />} label="Ünvan" value={customerProfile.address} />
                  )}
                  {customerProfile.language && (
                    <DetailRow icon={<Globe2 size={14} />} label="Dil" value={customerProfile.language} />
                  )}
                  {customerProfile.created_at && (
                    <DetailRow
                      icon={<Calendar size={14} />}
                      label="Qeydiyyat"
                      value={new Date(customerProfile.created_at).toLocaleString('az-AZ')}
                    />
                  )}
                  {customerProfile.last_seen_at && (
                    <DetailRow
                      icon={<Calendar size={14} />}
                      label="Son aktiv"
                      value={new Date(customerProfile.last_seen_at).toLocaleString('az-AZ')}
                    />
                  )}

                  {/* Conversation meta */}
                  <div className="pt-3 mt-3 border-t border-gray-100 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Söhbət</p>
                    <DetailRow
                      icon={<Tag size={14} />}
                      label="Conv. ID"
                      value={selectedConv.id}
                      copyKey="convid"
                      copiedField={copiedField}
                      onCopy={() => copyToClipboard(selectedConv.id, 'convid')}
                      mono
                    />
                    <DetailRow
                      icon={<HelpCircle size={14} />}
                      label="Kateqoriya"
                      value={selectedMeta.label}
                    />
                  </div>

                  {/* Quick links */}
                  <div className="pt-3 mt-3 border-t border-gray-100 space-y-1.5">
                    <a
                      href={`/Administrator/users?user=${customerProfile.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-brand-50 text-xs font-bold text-gray-700 hover:text-brand-700 transition-colors"
                    >
                      <span>İstifadəçi səhifəsi</span>
                      <ExternalLink size={12} />
                    </a>
                    {selectedConv.user_role === 'provider' && (
                      <a
                        href={`/Administrator/kyc?user=${customerProfile.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-brand-50 text-xs font-bold text-gray-700 hover:text-brand-700 transition-colors"
                      >
                        <span>KYC sənədləri</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function DetailRow({
  icon, label, value, copyKey, copiedField, onCopy, href, mono, valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  copyKey?: string;
  copiedField?: string | null;
  onCopy?: () => void;
  href?: string;
  mono?: boolean;
  valueClass?: string;
}) {
  const copied = copyKey && copiedField === copyKey;
  return (
    <div className="group">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">
        <span className="text-gray-400">{icon}</span>
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {href ? (
          <a
            href={href}
            className={`flex-1 text-sm text-brand-700 hover:underline truncate ${mono ? 'font-mono text-xs' : ''} ${valueClass || ''}`}
            title={value}
          >
            {value}
          </a>
        ) : (
          <p
            className={`flex-1 text-sm text-gray-900 truncate ${mono ? 'font-mono text-xs' : ''} ${valueClass || ''}`}
            title={value}
          >
            {value}
          </p>
        )}
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${label} kopyala`}
            className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              copied
                ? 'bg-emerald-100 text-emerald-700'
                : 'hover:bg-gray-100 text-gray-500 hover:text-brand-700'
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}
