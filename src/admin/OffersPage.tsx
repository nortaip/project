import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Clock,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card,
  EmptyState,
  SectionHeader,
} from '../components/ui';

type OfferStatus = 'pending' | 'accepted' | 'won' | 'lost' | string;

interface Offer {
  id: string;
  offer_amount: number;
  status: OfferStatus;
  created_at: string;
  opportunity: {
    title: string;
    location: string | null;
    description?: string | null;
    budget?: number | null;
    date?: string | null;
    user?: {
      name?: string | null;
      email?: string | null;
      phone_number?: string | null;
    } | null;
  } | null;
}

const STATUS_CONFIG: Record<
  OfferStatus,
  { label: string; cls: string }
> = {
  won:       { label: 'QAZANILDI',  cls: 'bg-success/10 text-success' },
  accepted:  { label: 'QƏBUL EDİLDİ', cls: 'bg-brand-50 text-brand-700' },
  pending:   { label: 'GÖZLƏMƏDƏ', cls: 'bg-warning/10 text-warning' },
  lost:      { label: 'İTİRİLDİ',  cls: 'bg-danger/5 text-danger' },
  completed: { label: 'TAMAMLANDI', cls: 'bg-success/10 text-success' },
  rejected:  { label: 'RƏDD EDİLDİ', cls: 'bg-danger/5 text-danger' },
  expired:   { label: 'VAXTI BİTİB', cls: 'bg-gray-100 text-gray-600' },
};

export default function OffersPage() {
  const { t } = useTranslation();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchOffers = async (uid: string) => {
    const { data, error } = await supabase
      .from('opportunities_offers')
      .select(
        `
          id,
          offer_amount,
          status,
          created_at,
          opportunity:opportunities!fk_opportunity (
            title,
            location,
            description,
            budget,
            date,
            user:profiles!fk_opportunity_created_by (
              name,
              email,
              phone_number
            )
          )
        `,
      )
      .eq('provider_id', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Offers fetch error:', error);
      return [];
    }
    return data as unknown as Offer[];
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      setOffers(await fetchOffers(user.id));
      setLoading(false);
    })();
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`offers_for_user_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities_offers',
          filter: `provider_id=eq.${userId}`,
        },
        async () => setOffers(await fetchOffers(userId)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <div>
      <SectionHeader
        title={t('offers.title')}
        subtitle={t('offers.subtitleCount', { count: offers.length })}
      />

      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : offers.length === 0 ? (
        <EmptyState
          title={t('offers.emptyTitle')}
          description={t('offers.emptyBody')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const statusCfg = STATUS_CONFIG[offer.status] ?? {
    label: offer.status.toUpperCase(),
    cls: 'bg-surface-bg text-ink-soft',
  };
  const op = offer.opportunity;

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-extrabold text-base sm:text-lg text-ink line-clamp-2 flex-1">
          {op?.title ?? 'Naməlum sorğu'}
        </h3>
        <span
          className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wider ${statusCfg.cls}`}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {op?.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} />
            {op.location}
          </span>
        )}
        {op?.date && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} />
            {new Date(op.date).toLocaleDateString('az-AZ', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
        {op?.budget != null && (
          <span className="inline-flex items-center gap-1 text-success font-bold">
            <Tag size={12} />
            Büdcə: {op.budget} ₼
          </span>
        )}
      </div>

      {op?.description && (
        <p className="text-sm text-ink-soft leading-relaxed line-clamp-2">
          {op.description}
        </p>
      )}

      {/* Offer amount */}
      <div className="flex items-end justify-between pt-3 border-t border-border">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-wide text-muted">
            Sənin təklifin
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-brand-700">
            {offer.offer_amount} ₼
          </div>
        </div>
        <div className="text-right text-[11px] text-muted inline-flex items-center gap-1">
          <Clock size={11} />
          {new Date(offer.created_at).toLocaleString('az-AZ', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>

      {/* Customer contact (only when accepted) */}
      {offer.status === 'accepted' && op?.user && (
        <div className="mt-2 p-4 rounded-2xl bg-brand-50 border border-brand-100">
          <div className="flex items-center gap-2 mb-3">
            <UserIcon size={16} className="text-brand-600" />
            <h4 className="text-sm font-extrabold text-brand-700">
              Müştəri əlaqə məlumatları
            </h4>
          </div>
          <div className="space-y-1.5 text-sm">
            {op.user.name && (
              <div className="flex items-center gap-2 text-ink-soft">
                <FileText size={14} className="text-muted shrink-0" />
                <span className="font-bold">{op.user.name}</span>
              </div>
            )}
            {op.user.email && (
              <a
                href={`mailto:${op.user.email}`}
                className="flex items-center gap-2 text-brand-600 hover:underline"
              >
                <Mail size={14} className="shrink-0" />
                <span className="truncate">{op.user.email}</span>
              </a>
            )}
            {op.user.phone_number && (
              <a
                href={`tel:${op.user.phone_number}`}
                className="flex items-center gap-2 text-brand-600 hover:underline"
              >
                <Phone size={14} className="shrink-0" />
                <span>{op.user.phone_number}</span>
              </a>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
