import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  service: {
    title: string;
    images: string[];
    location: string;
  };
  customer: {
    id: string;
    name: string;
    email: string;
    phone_number: string;
  };
  date: string;
  time: string;
  package_duration: string;
  total_amount: number;
  status: BookingStatus;
}

const StatusBadge = ({ status }: { status: Booking['status'] }) => {
  const statusStyles: Record<BookingStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  const StatusIcons: Record<BookingStatus, React.ElementType> = {
    pending: AlertCircle,
    confirmed: CheckCircle,
    completed: CheckCircle,
    cancelled: XCircle,
  };

  const Icon = StatusIcons[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status]}`}>
      <Icon className="w-4 h-4 mr-1" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

export function Bookings() {
  const { user } = useAuthStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const loadBookings = async () => {
      setLoading(true);
      setError(null);
    
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          date,
          time,
          package_duration,
          total_amount,
          status,
          services (
            title,
            images,
            location
          ),
          profiles:customer_id (
            id,
            name,
            email,
            phone_number
          )
        `)
        .eq('provider_id', user.id)
        .order('date', { ascending: false });
    
      if (error) {
        setError('Failed to load bookings');
        console.error(error);
      } else {
        const bookingsWithRenamedFields = data.map((b) => ({
          ...b,
          service: b.services,
          customer: b.profiles,
        }));
        setBookings(bookingsWithRenamedFields);
      }
    
      setLoading(false);
    };
    

    loadBookings();
  }, [user]);

  if (loading) return <div className="text-center mt-10">Yüklənir...</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-bold mb-6">Rezervlərim</h1>
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-2">
        {bookings.map((booking) => (
          <div key={booking.id} className="bg-white shadow-md rounded-lg p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-800">{booking.service.title}</h2>
              <StatusBadge status={booking.status} />
            </div>

            <p className="text-sm text-gray-500 mb-1">
              <Calendar className="inline w-4 h-4 mr-1 text-gray-400" />
              {new Date(booking.date).toLocaleDateString()}
            </p>

            <p className="text-sm text-gray-500 mb-1">
              <MapPin className="inline w-4 h-4 mr-1 text-gray-400" />
              {booking.service.location}
            </p>

            <p className="text-sm text-gray-500 mb-1">
              <span className="font-medium text-gray-700">Customer:</span> {booking.customer?.name} ({booking.customer?.email}) ({booking.customer?.phone_number})
            </p>

            <p className="text-sm text-gray-500 mb-3">
              <span className="font-medium text-gray-700">Total:</span> ${booking.total_amount.toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
