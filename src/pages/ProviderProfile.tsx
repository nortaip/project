import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  MapPin,
  MessageSquare,
  Send,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, PageContainer } from '../components/ui';
import { SEO, personJsonLd, breadcrumbJsonLd } from '../components/SEO';
import { useAuthStore } from '../store/auth';

/** UUID formatlı string-i tanıyır (specialties-də xam ID-ləri gizlətmək üçün). */
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

interface Provider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  is_verified: boolean | null;
  specialties: string[] | null;
  experience_years: number | null;
  address: string | null;
  email: string | null;
  phone_number: string | null;
  company_name: string | null;
}

interface ServiceItem {
  id: string;
  title: string;
  description: string | null;
  price: number;
  category: string;
  images: string[] | null;
  rating: number | null;
}

export function ProviderProfile() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Söhbət (chat) modalı ──────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSuccess, setChatSuccess] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login', { state: { from: `/provider/${id}` } });
      return;
    }
    if (!message.trim() || !id) return;
    try {
      setSending(true);
      setChatError(null);
      // Birbaşa mesaj üçün servis-siz booking yaradılır (mövcud chat axını ilə eyni)
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          service_id: null,
          customer_id: user.id,
          provider_id: id,
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          time: '12:00',
          total_amount: 0,
        })
        .select()
        .single();
      if (bookingError) throw bookingError;

      const { error: messageError } = await supabase.from('messages').insert({
        booking_id: bookingData.id,
        sender_id: user.id,
        receiver_id: id,
        content: message.trim(),
      });
      if (messageError) throw messageError;

      setChatSuccess(true);
      setMessage('');
      setTimeout(() => {
        setShowChat(false);
        setChatSuccess(false);
      }, 1800);
    } catch (err) {
      console.error('Error sending message:', err);
      setChatError(t('providerProfile.contactError', { defaultValue: 'Mesaj göndərilmədi. Yenidən cəhd edin.' }));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    void Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      supabase
        .from('services')
        .select('id, title, description, price, category, images, rating')
        .eq('provider_id', id),
    ]).then(([pResp, sResp]) => {
      setProvider(pResp.data as Provider);
      setServices((sResp.data ?? []) as ServiceItem[]);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!provider) {
    return (
      <PageContainer size="md">
        <Card variant="elevated" padding="lg" className="text-center">
          <h1 className="text-xl font-extrabold text-ink mb-2">Provayder tapılmadı</h1>
          <Link to="/providers">
            <Button variant="primary" size="md">
              Provayder siyahısı
            </Button>
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const initials = (provider.name ?? '?')[0]?.toUpperCase() ?? '?';

  return (
    <PageContainer size="lg">
      <SEO
        title={provider.name ?? 'Provayder'}
        description={`${provider.name ?? 'Provayder'} — Ellit.az üzərindən onlayn xidmət sifariş edin. Etibarlı və zəmanətli.`}
        canonical={`https://ellit.az/provider/${provider.id}`}
        type="profile"
        image={provider.avatar_url ?? undefined}
        jsonLd={[
          personJsonLd({
            name: provider.name ?? 'Provayder',
            image: provider.avatar_url,
            url: `https://ellit.az/provider/${provider.id}`,
          }),
          breadcrumbJsonLd([
            { name: 'Ana səhifə', url: 'https://ellit.az/' },
            { name: 'Provayderlər', url: 'https://ellit.az/providers' },
            { name: provider.name ?? 'Provayder', url: `https://ellit.az/provider/${provider.id}` },
          ]),
        ]}
      />
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={16} /> {t('providerProfile.back')}
      </button>

      {/* Hero */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {provider.avatar_url ? (
            <img
              src={provider.avatar_url}
              alt={provider.name ?? ''}
              className="w-24 h-24 rounded-3xl object-cover shrink-0"
            />
          ) : (
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center text-4xl font-extrabold shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                {provider.name ?? '—'}
              </h1>
              {provider.is_verified && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-success bg-success/10 px-2 py-1 rounded-lg">
                  <ShieldCheck size={14} /> {t('providerProfile.verified')}
                </span>
              )}
            </div>

            {provider.company_name && (
              <p className="mt-1 text-muted">{provider.company_name}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted">
              {(provider.rating ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 font-bold text-warning">
                  <Star size={14} className="fill-warning" />
                  {Number(provider.rating ?? 0).toFixed(1)}
                </span>
              )}
              {provider.experience_years && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase size={14} /> {t('providerProfile.experience', { count: provider.experience_years })}
                </span>
              )}
              {provider.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {provider.address}
                </span>
              )}
            </div>

            {(() => {
              const tags = (provider.specialties ?? []).filter((s) => s && !isUuid(s));
              if (tags.length === 0) return null;
              return (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((s) => (
                    <span
                      key={s}
                      className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Contact CTA — yalnız söhbət (chat) */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowChat(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-brand-gradient text-white font-bold shadow-brand hover:opacity-95 transition-opacity"
          >
            <MessageSquare size={18} /> {t('providerProfile.contact')}
          </button>
        </div>
      </Card>

      {/* Services */}
      <h2 className="text-xl font-extrabold text-ink mb-3">
        {t('providerProfile.services')} ({services.length})
      </h2>
      {services.length === 0 ? (
        <Card variant="default" padding="lg" className="text-center text-muted">
          {t('providerProfile.noServices')}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s) => (
            <Link
              key={s.id}
              to={`/book/${s.id}`}
              className="block bg-white rounded-2xl border border-border overflow-hidden hover:border-brand-300 transition-colors"
            >
              <div
                className="w-full h-36 bg-cover bg-center bg-surface-alt"
                style={{
                  backgroundImage: s.images?.[0]
                    ? `url(${s.images[0]})`
                    : 'linear-gradient(135deg, #EFF4FF, #ECFEFF)',
                }}
              />
              <div className="p-4">
                <span className="text-xs uppercase font-bold tracking-wide text-brand-600">
                  {s.category}
                </span>
                <h3 className="mt-1 font-extrabold text-ink line-clamp-2 leading-tight">
                  {s.title}
                </h3>
                <div className="mt-3 flex items-center justify-between">
                  {(s.rating ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Star size={12} className="text-warning fill-warning" />
                      {Number(s.rating ?? 0).toFixed(1)}
                    </span>
                  )}
                  <span className="font-extrabold text-ink">
                    {Number(s.price).toFixed(0)} ₼
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Söhbət (chat) modalı ── */}
      {showChat && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => !sending && setShowChat(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-card-lg p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-brand-gradient text-white flex items-center justify-center shrink-0">
                <MessageSquare size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-extrabold text-ink leading-tight">{t('providerProfile.contact')}</h3>
                <p className="text-xs text-muted truncate">{provider.name ?? ''}</p>
              </div>
              <button
                type="button"
                onClick={() => !sending && setShowChat(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-alt flex items-center justify-center text-muted"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {chatSuccess ? (
              <div className="py-8 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10 text-success mb-3">
                  <CheckCircle2 size={30} />
                </div>
                <p className="font-bold text-ink">
                  {t('providerProfile.contactSent', { defaultValue: 'Mesaj göndərildi!' })}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSendMessage}>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={t('providerProfile.contactPlaceholder', {
                    defaultValue: 'Mesajınızı yazın...',
                  })}
                  className="w-full p-3.5 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 focus:bg-white outline-none text-[15px] text-ink resize-none transition-colors"
                />
                {chatError && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-danger">
                    <AlertCircle size={15} /> {chatError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  className="mt-4 w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold transition-colors"
                >
                  {sending ? (
                    <span className="inline-block w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send size={16} /> {t('providerProfile.contactSend', { defaultValue: 'Göndər' })}
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default ProviderProfile;
