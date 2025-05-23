import { useState } from 'react';
import { Star, MapPin, Clock, AlertCircle, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import premiumIconSrc from '../assets/crown.png';
import vipIconSrc from '../assets/guarantee.png';

interface ServiceCardProps {
  id: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  location: string;
  category: string;
  imageUrl?: string;
  images: string[];
  packages: any[] | string;
  provider_id: string;
  promotion_type: string;
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  provider?: {
    name?: string;
    avatar_url?: string | null;
  };
  reviews_count: number;
}

interface Booking {
  id: string;
  customer?: {
    name?: string;
    email?: string;
  };
  date: string;
  time: string;
  status: 'pending' | 'accepted' | 'rejected';
  total_amount: number;
  package_name: string;
}

export function ServiceCard(props: ServiceCardProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  const [showBookings, setShowBookings] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPackages = typeof props.packages === 'string' ? JSON.parse(props.packages) : props.packages;

  const fetchBookings = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('bookings')
        .select(`id, customer:profiles!bookings_customer_id_fkey(name, email), date, time, status, total_amount, package_name`)
        .eq('service_id', props.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((b: any) => ({
        ...b,
        customer: Array.isArray(b.customer) ? b.customer[0] : b.customer
      }));

      setBookings(formatted);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleBookNow = () => {
    if (user?.role === 'provider' && user.id === props.provider_id) {
      setShowBookings(true);
      fetchBookings();
    } else {
      navigate(`/book/${props.id}`, {
        state: {
          service: {
            ...props,
            packages: parsedPackages,
          }
        }
      });
    }
  };

  const handleStatusUpdate = async (bookingId: string, newStatus: 'accepted' | 'rejected') => {
    try {
      setLoading(true);
      await supabase
        .from('bookings')
        .update({ status: newStatus })
        .eq('id', bookingId);

      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        const content = newStatus === 'accepted'
          ? 'Rezervasyonunuz təsdiqləndi! Xidmətimizi təqdim etməyi səbirsizliklə gözləyirik.'
          : 'Təəssüf ki, rezervasiyanız rədd edildi. Hər hansı bir sualınız varsa, bizimlə əlaqə saxlayın.';

        await supabase.from('messages').insert({
          booking_id: bookingId,
          sender_id: user!.id,
          receiver_id: booking.customer?.email || '',
          content
        });
      }
      fetchBookings();
    } catch (err) {
      console.error('Status update failed', err);
      setError('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      accepted: 'bg-green-100 text-green-800',
      completed: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800'
    };
    const icons = { pending: AlertCircle, accepted: CheckCircle, completed: CheckCircle, rejected: XCircle };
    const Icon = icons[status] || AlertCircle;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        <Icon className="w-4 h-4 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const renderPromotionIcon = () => {
    const src = props.promotion_type === 'vip' ? vipIconSrc : props.promotion_type === 'premium' ? premiumIconSrc : null;
    if (!src) return null;
    return (
      <span className="absolute top-2 left-2 z-10 p-1 rounded-full shadow">
        <img src={src} alt={props.promotion_type} className="w-5 h-5" />
      </span>
    );
  };

  return (
    <div className={`relative bg-white rounded-lg shadow-md overflow-hidden flex flex-col cursor-pointer hover:shadow-lg transition-shadow ${props.promotion_type === 'vip' ? 'border-blue-500 border-2' : props.promotion_type === 'premium' ? 'border-orange-500 border-2' : ''}`} onClick={() => navigate(`/book/${props.id}`)}>
      {props.images?.length ? (
        <div className="relative h-48">
          {renderPromotionIcon()}
          <img src={props.images[0]} alt={props.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="relative h-48 bg-gray-200 flex items-center justify-center">
          <span className="text-gray-500">No image available</span>
        </div>
      )}

      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-lg font-medium text-gray-900">{props.title}</h3>
        <p className="text-sm text-gray-500 mt-1">{props.description.length > 50 ? props.description.slice(0, 50) + '...' : props.description}</p>
        <div className="mt-2 text-lg font-semibold text-indigo-600">{props.price} ₼</div>
        <div className="flex items-center mt-2 text-sm text-gray-500">
          <MapPin className="h-4 w-4 mr-1" /> {props.location}
        </div>

        {user?.role === 'provider' && user.id === props.provider_id && bookings.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Recent Bookings</h4>
            {bookings.slice(0, 3).map((b) => (
              <div key={b.id} className="flex justify-between text-sm p-2 rounded-lg bg-gray-50">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-gray-400" /> <span>{b.date}</span>
                  <Clock className="w-4 h-4 text-gray-400 ml-2" /> <span>{b.time}</span>
                </div>
                {getStatusBadge(b.status)}
              </div>
            ))}
          </div>
        )}
      </div>

      {user?.id === props.provider_id ? (
        props.status === 'pending' ? (
          <div className="text-center py-3 px-4 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md">
            24 saat icində xidmətiniz təstiqlənəcək
          </div>
        ) : props.status === 'accepted' ? (
          <div className="text-center py-3 px-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md">
            Xidmət təsdiqləndi
          </div>
        ) : props.status === 'rejected' ? (
          <div className="text-center py-3 px-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
            Xidmətdən imtina edildi
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleBookNow();
            }}
            className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            <Calendar className="w-5 h-5" />
            <span>{t('serviceCard.viewBookings')}</span>
          </button>
        )
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleBookNow();
          }}
          className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
        >
          <Calendar className="w-5 h-5" />
          <span>{t('serviceCard.bookNow')}</span>
        </button>
      )}

    </div>
  );
}
