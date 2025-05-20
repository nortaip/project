import { useState } from 'react';
import { Star, MapPin, Clock, DollarSign, Users, AlertCircle, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';

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
  packages: any[];
  provider_id: string;
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
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  total_amount: number;
  package_name: string;
}

export function ServiceCard({ 
  id, 
  title, 
  description, 
  price, 
  rating, 
  location, 
  category,
  imageUrl,
  images = [],
  packages = [],
  provider_id,
  provider = { name: 'Unknown Provider', avatar_url: null },
  reviews_count = 0,
}: ServiceCardProps) {
  console.log("ServiceCard props:", { id, title, description, price, rating, location, category, images, packages, provider_id, provider, reviews_count });

  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showBookings, setShowBookings] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  // Parse JSON strings
  const parsedPackages = typeof packages === 'string' ? JSON.parse(packages) : packages;

  const fetchBookings = async () => {
    try {
      setLoading(true);
      setError(null);
  
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          customer:profiles!bookings_customer_id_fkey (
            name,
            email
          ),
          date,
          time,
          status,
          total_amount,
          package_name
        `)
        .eq('service_id', id) // Fetch bookings for this specific service
        .order('created_at', { ascending: false });
  
      if (error) throw error;
  
      console.log("Bookings data from API:", data);
      
      // Check if customer is an array or object and format accordingly
      const formattedData = data?.map((booking) => ({
        ...booking,
        customer: Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
      }));
  
      setBookings(formattedData || []);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      setError('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleBookNow = () => {
    if (user?.role === 'provider' && user.id === provider_id) {
      setShowBookings(true);
      fetchBookings();
    } else {
      navigate(`/book/${id}`, { 
        state: { 
          service: {
            id,
            title,
            description,
            price,
            rating,
            location,
            category,
            images: images.length > 0 ? images : [images[0]],
            packages: parsedPackages, // Use parsed packages
            provider_id,
            provider,
            reviews_count
          }
        }
      });
    }
  };

  const handleStatusUpdate = async (bookingId: string, newStatus: 'confirmed' | 'cancelled') => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase
        .from('bookings')
        .update({ status: newStatus })
        .eq('id', bookingId);

      if (error) throw error;

      // Send notification message
      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        const message = newStatus === 'confirmed'
          ? 'Your booking has been confirmed! We look forward to providing our service.'
          : 'Unfortunately, your booking has been cancelled. Please contact us if you have any questions.';

        await supabase
          .from('messages')
          .insert({
            booking_id: bookingId,
            sender_id: user!.id,
            receiver_id: booking.customer?.email || '',
            content: message
          });
      }

      await fetchBookings();
    } catch (error) {
      console.error('Error updating booking status:', error);
      setError('Failed to update booking status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-green-100 text-green-800',
      completed: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-red-100 text-red-800'
    };

    const icons = {
      pending: AlertCircle,
      confirmed: CheckCircle,
      completed: CheckCircle,
      cancelled: XCircle
    };

    const Icon = icons[status as keyof typeof icons];

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        <Icon className="w-4 h-4 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getRecentBookings = (bookings: Booking[], limit = 3) => {
    return bookings
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  };

  const RecentBookings = () => {
    const recentBookings = getRecentBookings(bookings);
    
    return (
      <div className="mt-4 border-t pt-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">Recent Bookings</h4>
        {recentBookings.length > 0 ? (
          <div className="space-y-2">
            {recentBookings.map((booking) => (
              <div 
                key={booking.id} 
                className="flex items-center justify-between text-sm p-2 rounded-lg bg-gray-50"
              >
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{booking.date}</span>
                  <Clock className="w-4 h-4 text-gray-400 ml-2" />
                  <span className="text-gray-600">{booking.time}</span>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  booking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                  booking.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No recent bookings</p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col cursor-pointer hover:shadow-lg transition-shadow"
      onClick={handleBookNow}
    >
      {/* Image carousel */}
      {images && images.length > 0 ? (
        <div className="relative h-48">
          <img
            src={images[0]}
            alt={title}
            className="w-full h-full object-cover"
          />
          {images.length > 1 && (
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
              +{images.length - 1}
            </div>
          )}
        </div>
      ) : (
        <div className="h-48 bg-gray-200 flex items-center justify-center">
          <span className="text-gray-400">No image available</span>
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex-1">
          <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">{description?.length > 50 ? description.slice(0, 50) + '...' : description || ''}</p>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-lg font-medium text-indigo-600">{price} ₼</span>
              {parsedPackages && parsedPackages.length > 1 && (
                <span className="text-sm text-gray-500 ml-1">{t('serviceCard.from')}</span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center text-sm text-gray-500">
            <MapPin className="h-4 w-4 mr-1" />
            {location}
          </div>
          {user?.role === 'provider' && user.id === provider_id && (
            <RecentBookings />
          )}
        </div>
        <div className="mt-4 pt-4 border-t">
          <button
            onClick={e => { e.stopPropagation(); handleBookNow(); }}
            className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            {user?.role === 'provider' && user.id === provider_id ? (
              <>
                <Calendar className="w-5 h-5" />
                <span>{t('serviceCard.viewBookings')}</span>
              </>
            ) : (
              <>
                {/* <Star className="w-5 h-5" /> */}
                <span>{t('serviceCard.bookNow')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bookings Modal */}
      {showBookings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {t('serviceCard.bookingsFor', { title: title })}
              </h2>
              <button
                onClick={() => setShowBookings(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                {t('serviceCard.close')}
              </button>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <span className="ml-2">{t('serviceCard.loading')}</span>
              </div>
            ) : bookings.length === 0 ? (
              <p className="text-center text-gray-500">{t('serviceCard.noBookings')}</p>
            ) : (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  <div key={booking.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {booking.customer?.name || t('serviceCard.anonymousCustomer')}
                        </p>
                        <p className="text-sm text-gray-500">
                          {booking.customer?.email || t('serviceCard.noEmailProvided')}
                        </p>
                        <div className="mt-2">
                          <Calendar className="inline-block w-4 h-4 mr-1 text-gray-400" />
                          <span className="text-sm text-gray-600">{t('serviceCard.date')}: {booking.date}</span>
                          <Clock className="inline-block w-4 h-4 ml-4 mr-1 text-gray-400" />
                          <span className="text-sm text-gray-600">{t('serviceCard.time')}: {booking.time}</span>
                        </div>
                      </div>
                      {getStatusBadge(booking.status)}
                    </div>
                    
                    {booking.status === 'pending' && (
                      <div className="mt-4 flex space-x-4">
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                        >
                          {t('serviceCard.actions.confirm')}
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          {t('serviceCard.actions.cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
