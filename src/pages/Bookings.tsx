import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, MapPin, CheckCircle, XCircle, AlertCircle, Loader, MessageSquare } from 'lucide-react';
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
    id: string;
    name: string;
    email: string;
  };
  date: string;
  time: string;
  package_duration: string;
  total_amount: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  package_name: string;
  package_price: number;
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
        const role = user.role || user.role;
        const idField = role === 'provider' ? 'provider_id' : 'customer_id';

        const { data, error } = await supabase
          .from('bookings')
          .select(`
            id,
            service_id,
            status,
            date,
            time,
            total_amount,
            package_name,
            package_price,
            package_duration,
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

        // Directly use the service and customer objects
        const formattedData = data.map((booking) => ({
          ...booking,
          service: booking.service,  // Use the service object directly
          customer: booking.customer,  // Use the customer object directly
        }));

        setBookings(formattedData);
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
      setLoading(true); // Start loading

      // Update the status in the database
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ status: newStatus })
        .eq('id', bookingId);

      if (updateError) {
        console.error('Error updating booking status:', updateError);
        throw updateError;
      }

      // After updating, re-fetch the bookings to reflect the changes
      const { data: updatedBookings, error: reloadError } = await supabase
        .from('bookings')
        .select('*')
        .eq('customer_id', user!.id) // Make sure you're fetching bookings for the logged-in user
        .order('date', { ascending: false });

      if (reloadError) {
        console.error('Error reloading bookings:', reloadError);
        throw reloadError;
      }

      // Set the updated bookings in the state
      setBookings(updatedBookings);

    } catch (error) {
      console.error('Error updating booking status:', error);
      setError('Failed to update booking status. Please try again.');
    } finally {
      setLoading(false); // Stop loading
    }
  };

  const sendMessage = async (messageData: { content: string, receiverId: string, bookingId: string }) => {
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
    return <div className="min-h-screen flex items-center justify-center"><Loader className="animate-spin text-indigo-600" /></div>;
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-6">Rezerv edilən Servislər</h1>
        <div className="bg-white shadow-lg rounded-lg p-6 mb-8">
          <input
            type="text"
            className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="Search for service or provider"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-indigo-100">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Servıs
              </th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Tarıx
              </th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Qiymət
              </th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Sifarişçi
              </th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                Hirəkət
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredBookings.map((booking) => (
              <tr key={booking.id}>
                <td className="px-6 py-4 text-sm text-gray-500">
                  <div className="flex items-center space-x-4">
                    {booking.service.images.length > 0 && (
                      <img
                        src={booking.service.images[0]}
                        alt={booking.service.title}
                        className="w-12 h-12 rounded-md object-cover"
                      />
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{booking.service.title}</p>
                      <p className="text-xs text-gray-500">{booking.service.provider.name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(booking.date).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  <StatusBadge status={booking.status} />
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  ${booking.total_amount.toFixed(2)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {/* Display customer details */}
                  <p className="text-sm font-medium text-gray-900">{booking.customer.name}</p>
                  <p className="text-xs text-gray-500">{booking.customer.email}</p>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {((user?.user_metadata.role) === 'provider' && booking.status === 'pending') && (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition-all"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>

        </table>
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
