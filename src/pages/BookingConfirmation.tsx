import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  HeartHandshake,
  Home,
  MapPin,
  Phone,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Button, Card, PageContainer } from '../components/ui';

interface Booking {
  id: string;
  date: string | null;
  time: string | null;
  status: string;
  total_amount: number | null;
  package_duration: string | null;
  service: {
    title: string;
    location: string | null;
    images: string[] | null;
  } | null;
  provider: {
    name: string | null;
    phone_number: string | null;
    avatar_url: string | null;
  } | null;
}

export function BookingConfirmation() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuthStore();

  const stateBooking = (location.state as { booking?: Booking } | null)?.booking;
  const bookingId = params.get('id') ?? stateBooking?.id;

  const [booking, setBooking] = useState<Booking | null>(stateBooking ?? null);
  const [loading, setLoading] = useState(!stateBooking && Boolean(bookingId));

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (booking || !bookingId) return;
    void supabase
      .from('bookings')
      .select(
        'id, date, time, status, total_amount, package_duration, service:services(title, location, images), provider:profiles!provider_id(name, phone_number, avatar_url)',
      )
      .eq('id', bookingId)
      .single()
      .then(({ data }) => {
        setBooking(data as unknown as Booking);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, user]);

  if (loading) {
    return (
      <PageContainer size="md">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!booking) {
    return (
      <PageContainer size="md">
        <Card variant="elevated" padding="lg" className="text-center">
          <h1 className="text-xl font-extrabold text-ink mb-2">{t('bookingConfirm.loadFail')}</h1>
          <Link to="/Mybookings">
            <Button variant="primary" size="md">
              {t('bookingConfirm.viewBookings')}
            </Button>
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const dateStr = booking.date
    ? new Date(booking.date).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  return (
    <PageContainer size="md">
      {/* Success hero */}
      <div className="text-center mb-6">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-success to-emerald-500 text-white flex items-center justify-center mb-4 shadow-[0_8px_24px_rgba(22,163,74,0.30)]">
          <CheckCircle2 size={40} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
          {t('bookingConfirm.successTitle')}
        </h1>
        <p className="mt-2 text-muted">
          {t('bookingConfirm.successBody')}
        </p>
      </div>

      {/* Service summary */}
      <Card variant="elevated" padding="lg" className="mb-4">
        <div className="flex items-start gap-4">
          {booking.service?.images?.[0] ? (
            <div
              className="w-16 h-16 rounded-2xl bg-cover bg-center shrink-0"
              style={{ backgroundImage: `url(${booking.service.images[0]})` }}
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <HeartHandshake size={28} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold text-ink leading-tight">
              {booking.service?.title ?? '—'}
            </h2>
            {booking.provider?.name && (
              <p className="text-sm text-muted mt-1">{booking.provider.name}</p>
            )}
            <span className="inline-block mt-2 text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md uppercase tracking-wide">
              #{booking.id.substring(0, 8)}
            </span>
          </div>
        </div>
      </Card>

      {/* Details */}
      <Card variant="default" padding="lg" className="mb-4">
        <h2 className="text-base font-extrabold text-ink mb-4">{t('bookingConfirm.details')}</h2>
        <div className="space-y-3">
          <DetailRow icon={<Calendar size={16} />} label={t('bookingConfirm.date')} value={dateStr} />
          {booking.time && (
            <DetailRow icon={<Clock size={16} />} label={t('bookingConfirm.time')} value={booking.time} />
          )}
          {booking.service?.location && (
            <DetailRow
              icon={<MapPin size={16} />}
              label={t('customerProfile.address')}
              value={booking.service.location}
            />
          )}
          {booking.provider?.phone_number && (
            <DetailRow
              icon={<Phone size={16} />}
              label={t('bookingConfirm.providerContact')}
              value={booking.provider.phone_number}
            />
          )}
          {booking.total_amount && (
            <div className="flex justify-between items-center pt-3 border-t border-border">
              <span className="text-muted font-medium">{t('bookingConfirm.amount')}</span>
              <span className="text-xl font-extrabold text-ink">
                {Number(booking.total_amount).toFixed(2)} ₼
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* CTA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link to="/Mybookings">
          <Button variant="outline" size="lg" fullWidth>
            {t('bookingConfirm.viewBookings')}
          </Button>
        </Link>
        <Link to="/account">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            leftIcon={<Home size={18} />}
            rightIcon={<ChevronRight size={18} />}
          >
            {t('bookingConfirm.home')}
          </Button>
        </Link>
      </div>
    </PageContainer>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-surface-alt text-muted flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex justify-between items-baseline gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-bold text-ink text-right truncate">{value}</span>
      </div>
    </div>
  );
}

export default BookingConfirmation;
