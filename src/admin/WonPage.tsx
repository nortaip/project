import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Loader2,
  MapPin,
  Star,
  Trophy,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card,
  EmptyState,
  PageContainer,
  SectionHeader,
} from '../components/ui';

interface WonOffer {
  id: string;
  offer_amount: number;
  created_at: string;
  opportunity: { title: string; location: string | null } | null;
  provider_reviews: { rating: number; comment: string }[] | null;
}

export default function WonPage() {
  const [offers, setOffers] = useState<WonOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWon = async (uid: string) => {
    const { data, error: fetchErr } = await supabase
      .from('opportunities_offers')
      .select(
        `
          id,
          offer_amount,
          created_at,
          opportunity:opportunities!fk_opportunity(title, location),
          provider_reviews(rating, comment)
        `,
      )
      .eq('provider_id', uid)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (fetchErr) {
      setError(`Yükləmə xətası: ${fetchErr.message}`);
      return [];
    }
    return ((data ?? []) as unknown as WonOffer[]).map((d) => ({
      ...d,
      provider_reviews: d.provider_reviews ?? [],
    }));
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) {
        setError('Hesabına daxil ol.');
        setLoading(false);
        return;
      }
      setUserId(user.id);
      setOffers(await fetchWon(user.id));
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`won_offers_for_user_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities_offers',
          filter: `provider_id=eq.${userId}`,
        },
        async () => setOffers(await fetchWon(userId)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <PageContainer size="xl" className="py-6">
      <SectionHeader
        title="Qazanılmış sifarişlər"
        subtitle={`${offers.length} tamamlanmış iş`}
      />

      {loading ? (
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      ) : error ? (
        <Card variant="default" padding="lg" className="text-center">
          <AlertTriangle size={28} className="text-danger mx-auto mb-3" />
          <p className="text-sm text-danger">{error}</p>
        </Card>
      ) : offers.length === 0 ? (
        <EmptyState
          title="Hələ qazanılmış sifariş yoxdur"
          description="Qəbul edilmiş təkliflərin tamamlandıqdan sonra burada görünəcək."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {offers.map((offer) => (
            <WonCard key={offer.id} offer={offer} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function WonCard({ offer }: { offer: WonOffer }) {
  const review = offer.provider_reviews?.[0];

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-success/10 text-success text-[11px] font-extrabold uppercase tracking-wider mb-2">
            <Trophy size={12} />
            Qazanıldı
          </div>
          <h3 className="font-extrabold text-base sm:text-lg text-ink line-clamp-2">
            {offer.opportunity?.title ?? 'Naməlum sorğu'}
          </h3>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {offer.opportunity?.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} />
            {offer.opportunity.location}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Calendar size={12} />
          {new Date(offer.created_at).toLocaleDateString('az-AZ', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      {/* Review */}
      {review && (
        <div className="p-4 rounded-2xl bg-warning/5 border border-warning/20">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs uppercase font-bold tracking-wide text-muted">
              Müştəri reytinqi
            </span>
            <div className="inline-flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={14}
                  className={
                    i < review.rating ? 'fill-warning text-warning' : 'text-border'
                  }
                />
              ))}
              <span className="ml-1 text-xs font-bold text-ink-soft">
                {review.rating}/5
              </span>
            </div>
          </div>
          {review.comment && (
            <p className="text-sm italic text-ink-soft leading-relaxed">
              "{review.comment}"
            </p>
          )}
        </div>
      )}

      <div className="flex items-end justify-between pt-3 border-t border-border">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-wide text-muted">
            Qazanılan məbləğ
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-success">
            {offer.offer_amount} ₼
          </div>
        </div>
      </div>
    </Card>
  );
}
