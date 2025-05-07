import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, MapPin, CheckCircle, XCircle, AlertCircle, Filter, Loader, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

type BookingStatus = 'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  service: {
    title: string;
    images: string[];
    location: string;
    provider: {
      name: string;
    };
  };
  customer: {
    [x: string]: ReactI18NextChildren | Iterable<ReactI18NextChildren>;
    id: string;
    name: string;
    email: string;
  };
  date: string;
  time: string;
  package_duration: string;
  total_amount: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

interface MessageFormData {
  content: string;
  receiverId: string;
  bookingId: string;
}

const StatusBadge = ({ status }: { status: Booking['status'] }) => {
  const statusStyles = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  const StatusIcon = {
    pending: AlertCircle,
    confirmed: CheckCircle,
    completed: CheckCircle,
    cancelled: XCircle,
  }[status];

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status]}`}>
      <StatusIcon className="w-4 h-4 mr-1" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

export function Bookings() {
  const { user } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState<BookingStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [messageContent, setMessageContent] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    if (!user) {
      console.error('User is not authenticated');
      return;
    }

    const loadBookings = async () => {
      setLoading(true);
      setError(null);

      try {
        // Use provider_id if user is provider, otherwise customer_id
        const role = user.user_metadata?.role || user.role;
        const idField = role === 'provider' ? 'provider_id' : 'customer_id';

        const { data, error } = await supabase
          .from('bookings')
          .select(`
          *,
          service:services (
            title,
            images,
            location,
            provider:profiles (
              name
            )
          ),
          customer:profiles (
            id,
            name,
            email,
            phone_number
          )
        `)
          .eq(idField, user.id)
          .order('date', { ascending: false });


        if (error) {
          console.error('Error fetching bookings:', error);
          throw error;
        }

        console.log('Bookings data:', data); // Log the data to verify its structure
        setBookings(data);
      } catch (error) {
        console.error('Error loading bookings:', error);
        setError('Failed to load bookings');
      } finally {
        setLoading(false);
      }
    };

    loadBookings();
  }, [user]);

  const handleStatusUpdate = async (bookingId: string, newStatus: 'confirmed' | 'cancelled') => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase
        .from('bookings')
        .update({ status: newStatus })
        .eq('id', bookingId);

      if (error) {
        console.error('Error updating booking status:', error);
        throw error;
      }

      console.log('Booking status updated successfully');
      // Reload the bookings by fetching fresh data
      const { data: updatedBookings, error: reloadError } = await supabase
        .from('bookings')
        .select('*')
        .eq('customer_id', user!.id)
        .order('date', { ascending: false });

      if (reloadError) throw reloadError;
      setBookings(updatedBookings);
    } catch (error) {
      console.error('Error updating booking status:', error);
      setError('Failed to update booking status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (messageData: MessageFormData) => {
    try {
      setSendingMessage(true);
      const { error } = await supabase
        .from('messages')
        .insert({
          booking_id: messageData.bookingId,
          sender_id: user!.id,
          receiver_id: messageData.receiverId,
          content: messageData.content
        });

      if (error) throw error;

      setMessageContent('');
      setShowMessageModal(false);
      setSelectedBooking(null);
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || !messageContent.trim()) return;

    await sendMessage({
      content: messageContent,
      receiverId: selectedBooking.customer.id,
      bookingId: selectedBooking.id
    });
  };

  const filteredBookings = bookings.filter(booking => {
    const matchesStatus = statusFilter === 'all' || booking.status === statusFilter;
    const matchesSearch = (booking.service?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      booking.service?.provider?.name?.toLowerCase().includes(searchQuery.toLowerCase())) ?? false;
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
        <div className="min-h-screen bg-gray-50 py-12">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">Rezerv edilən Servislər</h1>

            {filteredBookings.length === 0 ? (
              <p className="text-center text-gray-500">No bookings found.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-2">
                {filteredBookings.map((booking) => (
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
                      <span className="font-medium text-gray-700">Provider:</span> {booking.service.provider.name}
                    </p>

                    <p className="text-sm text-gray-500 mb-1">
                      <span className="font-medium text-gray-700">Customer:</span> {booking.customer?.name} ({booking.customer?.email}) ({booking.customer?.phone_number})
                    </p>

                    <p className="text-sm text-gray-500 mb-3">
                      <span className="font-medium text-gray-700">Total:</span> ${booking.total_amount.toFixed(2)}
                    </p>

                    {(user?.user_metadata.role === 'provider' && booking.status === 'pending') && (
                      <div className="flex justify-end space-x-2 mt-4">
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md text-sm"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      {/* Message Modal */}
      {showMessageModal && selectedBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Send Message
            </h2>
            <form onSubmit={handleMessageSubmit}>
              <textarea
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Type your message here..."
                className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowMessageModal(false);
                    setSelectedBooking(null);
                    setMessageContent('');
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingMessage || !messageContent.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {sendingMessage ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}