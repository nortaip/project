import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, MapPin, Sparkles, Wallet, Zap } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  EmptyState,
  PageContainer,
  SectionHeader,
} from '../components/ui';

interface Offer {
  id: string;
  brigade_id: string;
  member_id: string;
  source_id: string;
  status: 'offered' | 'assigned' | 'accepted' | 'declined' | 'expired';
  priority: number;
  assigned_at: string;
  brigade?: { id: string; name: string; logo_url: string | null } | null;
  opportunity?: {
    id: string;
    title: string | null;
    description: string | null;
    location: string | null;
    budget: number | null;
    category_id: string | null;
    subcategory_id: string | null;
  } | null;
  brigade_member?: { id: string; profile_id: string } | null;
}

export default function MasterIncoming() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Auto-refresh hər 15 saniyə (realtime fallback)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    intervalRef.current = setInterval(() => void load(true), 15_000);

    // Realtime subscription
    const channel = supabase
      .channel('master-incoming')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brigade_assignments' },
        () => void load(true),
      )
      .subscribe();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Köhnə offerlər expire et (fallback — pg_cron yoxdursa)
      void supabase.rpc('expire_stale_offers', { p_threshold_seconds: 60 });

      // 1. Cari user-in brigade_member id-lərini tap
      const { data: myMembers, error: memErr } = await supabase
        .from('brigade_members')
        .select('id, is_online')
        .eq('profile_id', user!.id)
        .eq('is_active', true);
      if (memErr) throw memErr;

      const memberIds = (myMembers ?? []).map((m) => m.id);
      setOnline((myMembers ?? []).some((m) => m.is_online));

      if (memberIds.length === 0) {
        setOffers([]);
        return;
      }

      // 2. Bu üzv id-lər üçün offer/assigned assignment-lar
      const { data, error } = await supabase
        .from('brigade_assignments')
        .select(
          `id, brigade_id, member_id, source_id, status, priority, assigned_at,
           brigade:brigades(id, name, logo_url)`,
        )
        .in('member_id', memberIds)
        .in('status', ['offered', 'assigned'])
        .order('assigned_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      // 3. Hər offer üçün opportunity məlumatını yüklə
      const oppIds = Array.from(
        new Set((data ?? []).map((r) => r.source_id).filter(Boolean)),
      );
      let oppMap: Record<string, Offer['opportunity']> = {};
      if (oppIds.length > 0) {
        const { data: opps } = await supabase
          .from('opportunities')
          .select(
            'id, title, description, location, budget, category_id, subcategory_id',
          )
          .in('id', oppIds);
        oppMap = Object.fromEntries(
          (opps ?? []).map((o) => [o.id, o as Offer['opportunity']]),
        );
      }

      const combined: Offer[] = (data ?? []).map((r) => ({
        ...(r as Offer),
        opportunity: oppMap[r.source_id] ?? null,
      }));

      setOffers(combined);
    } catch (e) {
      if (!silent) {
        message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const toggleOnline = async () => {
    const next = !online;
    const { error } = await supabase.rpc('set_member_online', {
      p_is_online: next,
    });
    if (error) {
      message.error(error.message);
      return;
    }
    setOnline(next);
    message.success(next ? 'Online — sifarişlər gələcək' : 'Offline');
    await load(true);
  };

  const handleClaim = async (offer: Offer) => {
    setClaimingId(offer.id);
    const { error } = await supabase.rpc('claim_opportunity', {
      p_assignment_id: offer.id,
    });
    setClaimingId(null);
    if (error) {
      message.error(error.message);
      await load(true);
      return;
    }
    message.success('Sifariş sənin oldu!');
    navigate(`/brigades/${offer.brigade_id}`);
  };

  const handleDecline = async (offer: Offer) => {
    if (!confirm('Bu sifarişdən imtina edirsən?')) return;
    const { error } = await supabase.rpc('decline_offer', {
      p_assignment_id: offer.id,
    });
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('İmtina edildi');
    await load(true);
  };

  return (
    <PageContainer size="lg">
      <SectionHeader
        title="Gələn sifarişlər"
        subtitle={
          online
            ? 'Yeni sifarişlər anında burada görsənəcək. İlk qəbul edən qazanır.'
            : 'Sifariş almaq üçün online olun.'
        }
        action={
          <button
            type="button"
            onClick={toggleOnline}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
              online
                ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-200'
                : 'bg-surface-alt text-muted border-2 border-border hover:border-brand-300'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                online ? 'bg-emerald-500 animate-pulse' : 'bg-muted/40'
              }`}
            />
            {online ? 'Online' : 'Offline'}
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : offers.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Inbox size={32} />}
            title={online ? 'Yeni sifariş yoxdur' : 'Online olun'}
            description={
              online
                ? 'Sifariş gələn kimi burada görsənəcək və bildiriş alacaqsınız.'
                : 'Online olduqda kateqoriyanıza uyğun yeni sifarişlər avtomatik göndəriləcək.'
            }
            action={
              !online ? (
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={<Zap size={18} />}
                  onClick={toggleOnline}
                >
                  Online ol
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {offers.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              claiming={claimingId === o.id}
              onClaim={() => handleClaim(o)}
              onDecline={() => handleDecline(o)}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function OfferCard({
  offer,
  claiming,
  onClaim,
  onDecline,
}: {
  offer: Offer;
  claiming: boolean;
  onClaim: () => void;
  onDecline: () => void;
}) {
  const opp = offer.opportunity;
  const dt = new Date(offer.assigned_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Yeni offer-i highlight et (son 60 saniyədə)
  const isFresh = Date.now() - new Date(offer.assigned_at).getTime() < 60_000;

  return (
    <Card
      variant="default"
      padding="md"
      className={isFresh ? 'border-2 border-emerald-300 bg-emerald-50/30' : ''}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-lg font-extrabold text-ink">
              {opp?.title ?? 'Yeni sifariş'}
            </h3>
            {isFresh && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                <Sparkles size={12} /> Yeni
              </span>
            )}
            {offer.priority >= 8 && (
              <span className="text-xs font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-md">
                Təcili
              </span>
            )}
          </div>
          {opp?.description && (
            <p className="text-sm text-muted line-clamp-2 mb-2">
              {opp.description}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            {opp?.budget != null && (
              <span className="inline-flex items-center gap-1 font-bold text-brand-700">
                <Wallet size={14} /> {opp.budget} AZN
              </span>
            )}
            {opp?.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {opp.location}
              </span>
            )}
            <span className="text-muted">
              {offer.brigade?.name ?? '—'} · {dt}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button
            variant="primary"
            size="md"
            loading={claiming}
            onClick={onClaim}
          >
            Qəbul et
          </Button>
          <button
            type="button"
            onClick={onDecline}
            disabled={claiming}
            className="text-sm font-bold text-muted hover:text-danger disabled:opacity-50"
          >
            İmtina
          </button>
        </div>
      </div>
    </Card>
  );
}
