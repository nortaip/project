import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  HeartHandshake,
  MapPin,
  XCircle,
} from 'lucide-react';
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

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  date: string | null;
  time: string | null;
  package_duration: string | null;
  total_amount: number | null;
  status: BookingStatus;
  service: {
    title: string;
    location: string | null;
    images: string[] | null;
  } | null;
  provider: {
    name: string | null;
    avatar_url: string | null;
  } | null;
}

const STATUS_META: Record<
  BookingStatus,
  { label: string; bg: string; text: string; icon: React.ComponentType<{ size?: number }> }
> = {
  pending: { label: 'Gözləyir', bg: 'bg-warning/10', text: 'text-warning', icon: AlertCircle },
  confirmed: { label: 'Təsdiqləndi', bg: 'bg-info/10', text: 'text-info', icon: CheckCircle2 },
  completed: { label: 'Tamamlandı', bg: 'bg-success/10', text: 'text-success', icon: CheckCircle2 },
  cancelled: { label: 'Ləğv edildi', bg: 'bg-danger/10', text: 'text-danger', icon: XCircle },
};

type FilterTab = 'all' | 'active' | 'completed' | 'cancelled';

export function MyBookings() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>('all');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, date, time, package_duration, total_amount, status, service:services(title, location, images), provider:profiles!provider_id(name, avatar_url)',
        )
        .eq('customer_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBookings((data ?? []) as unknown as Booking[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const counts = {
    all: bookings.length,
    active: bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed').length,
    completed: bookings.filter((b) => b.status === 'completed').length,
    cancelled: bookings.filter((b) => b.status === 'cancelled').length,
  };

  const visible = bookings.filter((b) => {
    if (tab === 'all') return true;
    if (tab === 'active') return b.status === 'pending' || b.status === 'confirmed';
    if (tab === 'completed') return b.status === 'completed';
    return b.status === 'cancelled';
  });

  return (
    <PageContainer size="lg">
      <SectionHeader
        title="Sifarişlərim"
        subtitle={`${bookings.length} ümumi sifariş`}
        action={
          <Button
            variant="primary"
            size="md"
            onClick={() => navigate('/services')}
          >
            Yeni sifariş
          </Button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        <FilterChip
          label="Hamısı"
          count={counts.all}
          active={tab === 'all'}
          onClick={() => setTab('all')}
        />
        <FilterChip
          label="Aktiv"
          count={counts.active}
          active={tab === 'active'}
          onClick={() => setTab('active')}
        />
        <FilterChip
          label="Tamamlandı"
          count={counts.completed}
          active={tab === 'completed'}
          onClick={() => setTab('completed')}
        />
        <FilterChip
          label="Ləğv"
          count={counts.cancelled}
          active={tab === 'cancelled'}
          onClick={() => setTab('cancelled')}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<HeartHandshake size={32} />}
            title={
              tab === 'all'
                ? 'Hələ sifariş etməmisən'
                : 'Bu kategoriyada sifariş yoxdur'
            }
            description="Yeni xidmət axtar və ilk sifarişini yarat"
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/services')}
              >
                Xidmət axtar
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((b) => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
        active
          ? 'bg-brand-600 text-white'
          : 'bg-white border border-border text-ink-soft hover:border-brand-300'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 px-1.5 py-0.5 rounded-md text-xs ${
          active ? 'bg-white/20' : 'bg-surface-alt'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function BookingCard({ booking }: { booking: Booking }) {
  const meta = STATUS_META[booking.status] ?? STATUS_META.pending;
  const Icon = meta.icon;

  const dateStr = booking.date
    ? new Date(booking.date).toLocaleDateString('az', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <Link
      to={`/bookings/confirmation?id=${booking.id}`}
      className="block bg-white rounded-2xl border border-border p-4 hover:border-brand-300 transition-colors"
    >
      <div className="flex items-start gap-3">
        {booking.service?.images?.[0] ? (
          <div
            className="w-16 h-16 rounded-xl bg-cover bg-center shrink-0"
            style={{ backgroundImage: `url(${booking.service.images[0]})` }}
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <HeartHandshake size={24} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-extrabold text-ink line-clamp-1">
              {booking.service?.title ?? 'Xidmət'}
            </h3>
            <ChevronRight size={18} className="text-muted shrink-0 mt-0.5" />
          </div>

          {booking.provider?.name && (
            <p className="text-sm text-muted truncate">{booking.provider.name}</p>
          )}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${meta.bg} ${meta.text}`}
            >
              <Icon size={12} />
              {meta.label}
            </span>

            {dateStr && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Calendar size={12} /> {dateStr}
              </span>
            )}
            {booking.time && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Clock size={12} /> {booking.time}
              </span>
            )}
          </div>

          {booking.service?.location && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted">
              <MapPin size={12} className="shrink-0" />
              <span className="line-clamp-1">{booking.service.location}</span>
            </div>
          )}

          {booking.total_amount && (
            <div className="mt-2 font-extrabold text-ink">
              {Number(booking.total_amount).toFixed(2)} ₼
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default MyBookings;
