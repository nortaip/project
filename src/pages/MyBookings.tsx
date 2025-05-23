import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  date: string;
  time: string;
  package_duration: string;
  total_amount: number;
  status: BookingStatus;
  service: {
    title: string;
    location: string;
    images: string[];
  };
  customer: {
    id: string;
    name: string;
    email: string;
    phone_number: string;
  };
}

const StatusBadge = ({ status }: { status: BookingStatus }) => {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  const icons = {
    pending: AlertCircle,
    confirmed: CheckCircle,
    completed: CheckCircle,
    cancelled: XCircle,
  };

  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      <Icon className="w-4 h-4 mr-1" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

export function MyBookings() {
  const { user } = useAuthStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const loadBookings = async () => {
      setLoading(true);
      setError(null);

      const { data: bookingsRaw, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('provider_id', user.id)
        .order('date', { ascending: false });

      if (error || !bookingsRaw) {
        setError('Failed to load bookings');
        setLoading(false);
        return;
      }

      const customerIds = bookingsRaw.map((b) => b.customer_id);
      const serviceIds = bookingsRaw.map((b) => b.service_id);

      const { data: customers } = await supabase
        .from('profiles')
        .select('id, name, email, phone_number')
        .in('id', customerIds);

      const { data: services } = await supabase
        .from('services')
        .select('id, title, location, images')
        .in('id', serviceIds);

      const enriched = bookingsRaw.map((b) => ({
        ...b,
        service: services?.find((s) => s.id === b.service_id),
        customer: customers?.find((c) => c.id === b.customer_id),
      }));

      setBookings(enriched as Booking[]);
      setLoading(false);
    };

    loadBookings();
  }, [user]);

  const handleStatusUpdate = async (bookingId: string, newStatus: BookingStatus) => {
    const { error } = await supabase
      .from('bookings')
      .update({ status: newStatus })
      .eq('id', bookingId);

    if (!error) {
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, status: newStatus } : b));
    } else {
      setError('Failed to update status');
      console.error(error);
    }
  };

  if (loading) return <div className="text-center mt-10">Yüklənir...</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-bold mb-6">Rezervlər edilənlər</h1>
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-2">
        {bookings.map((booking) => (
          <div key={booking.id} className="bg-white shadow-md rounded-lg p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-800">{booking.service?.title}</h2>
              <StatusBadge status={booking.status} />
            </div>

            <p className="text-sm text-gray-500 mb-1">
              <Calendar className="inline w-4 h-4 mr-1 text-gray-400" />
              {new Date(booking.date).toLocaleDateString()}
            </p>

            <p className="text-sm text-gray-500 mb-1">
              <MapPin className="inline w-4 h-4 mr-1 text-gray-400" />
              {booking.service?.location}
            </p>

            <p className="text-sm text-gray-500 mb-1">
              <strong>Müştəri:</strong> {booking.customer?.name} ({booking.customer?.email}) ({booking.customer?.phone_number})
            </p>

            <p className="text-sm text-gray-500 mb-3">
              <strong>Cəmi:</strong> ${booking.total_amount.toFixed(2)}
            </p>

            {booking.status === 'pending' && (
              <div className="flex space-x-2 mt-3">
                <button
                  className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                  onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                >
                  Təsdiqlə
                </button>
                <button
                  className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                  onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                >
                  Ləğv et
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
