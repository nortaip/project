import React, { useState, useEffect } from 'react';
import { Star, MapPin, Clock, DollarSign, Users, AlertCircle, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';

interface ServiceCardProps {
  id: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  location: string;
  category: string;
  imageUrl: string;
  packages?: any[];
  provider_id: string;
  provider: {
    name: string;
    avatar_url: string | null;
  };
  reviews_count: number;
  images?: string[];
}

interface Booking {
  id: string;
  customer: {
    name: string;
    email: string;
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
  packages,
  provider_id,
  provider,
  reviews_count,
  images = []
}: ServiceCardProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showBookings, setShowBookings] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  
      // Ensure the customer is an object, not an array
      const formattedData = data?.map((booking) => ({
        ...booking,
        customer: booking.customer[0] // Assuming customer is returned as an array
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
      fetchBookings(); // Fetch bookings for this service
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
            images: images.length > 0 ? images : [imageUrl],
            packages: packages || [
              {
                id: 'basic',
                name: 'Basic',
                price: price,
                duration: '2 hours',
                features: [
                  'Standard service',
                  'Basic support',
                  'Regular hours'
                ]
              }
            ],
            provider_id,
            provider: {
              id: provider_id,
              name: provider.name,
              avatar_url: provider.avatar_url
            },
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
            receiver_id: booking.customer.email,
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

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <div className="relative h-48">
        <img 
          src={imageUrl} 
          alt={title}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-4 right-4 bg-white px-3 py-1 rounded-full text-sm font-semibold text-indigo-600 flex items-center">
          <DollarSign className="h-4 w-4 mr-1" />
          {price}/hr
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
            {category}
          </span>
          <div className="flex items-center">
            <Star className="h-4 w-4 text-yellow-400 fill-current" />
            <span className="ml-1 text-sm text-gray-600">{rating.toFixed(1)}</span>
          </div>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{description}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center text-gray-500 text-sm">
            <MapPin className="h-4 w-4 mr-1" />
            <span>{location}</span>
          </div>
          <div className="flex items-center text-gray-500 text-sm">
            <Clock className="h-4 w-4 mr-1" />
            <span>Available Now</span>
          </div>
        </div>
        <button
          onClick={handleBookNow}
          className="mt-4 block w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {user?.role === 'provider' && user.id === provider_id ? 'View Bookings' : 'Book Now'}
        </button>
      </div>

      {/* Bookings Modal */}
      {showBookings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                Bookings for {title}
              </h2>
              <button
                onClick={() => setShowBookings(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                ×
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
              </div>
            ) : bookings.length > 0 ? (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {booking.customer.name}
                        </h3>
                        <p className="text-sm text-gray-500">{booking.customer.email}</p>
                      </div>
                      {getStatusBadge(booking.status)}
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="flex items-center text-sm text-gray-500">
                        <Calendar className="w-4 h-4 mr-1 text-gray-400" />
                        {booking.date}
                      </div>
                      <div className="flex items-center text-sm text-gray-500">
                        <Clock className="w-4 h-4 mr-1 text-gray-400" />
                        {booking.time}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-500">
                        Package: {booking.package_name}
                      </div>
                      <div className="text-lg font-semibold text-indigo-600">
                        ${booking.total_amount}
                      </div>
                    </div>
                    {booking.status === 'pending' && (
                      <div className="mt-4 flex justify-end space-x-2">
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No bookings yet</h3>
                <p className="mt-1 text-sm text-gray-500">
                  You don't have any bookings for this service yet.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}