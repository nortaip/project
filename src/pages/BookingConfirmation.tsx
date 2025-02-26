import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { 
  CheckCircle, 
  Calendar, 
  MapPin, 
  Clock, 
  CreditCard,
  Shield,
  AlertCircle,
  ArrowLeft,
  Info
} from 'lucide-react';

interface PaymentMethod {
  id: string;
  type: 'credit_card' | 'paypal';
  last4?: string;
  brand?: string;
}

interface BookingDetails {
  service: {
    id: string;
    title: string;
    provider: {
      id: string;
      name: string;
      avatar_url: string | null;
    };
  };
  selectedPackage: {
    name: string;
    price: number;
    duration: string;
  };
  date: string;
  time: string;
  location: string;
  total: number;
}

export function BookingConfirmation() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [bookingCreated, setBookingCreated] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);

  // Mock payment methods - in a real app, these would come from your payment provider
  const paymentMethods: PaymentMethod[] = [
    { id: '1', type: 'credit_card', last4: '4242', brand: 'Visa' },
    { id: '2', type: 'credit_card', last4: '1234', brand: 'Mastercard' },
    { id: '3', type: 'paypal' }
  ];

  useEffect(() => {
    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }

    if (!location.state?.booking) {
      navigate('/services');
      return;
    }

    setBooking(location.state.booking);
  }, [user, location, navigate]);

  const handlePayment = async () => {
    if (!selectedPaymentMethod) {
      setError('Please select a payment method');
      return;
    }

    if (!booking) {
      setError('Booking details not found');
      return;
    }

    if (!booking.service.provider.id) {
      setError('Provider information is missing');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create the booking
      const { data: newBooking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          service_id: booking.service.id,
          customer_id: user.id,
          provider_id: booking.service.provider.id,
          status: 'pending',
          date: booking.date,
          time: booking.time,
          total_amount: booking.total,
          package_name: booking.selectedPackage.name,
          package_price: booking.selectedPackage.price,
          package_duration: booking.selectedPackage.duration
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Send notification message to provider only
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          booking_id: newBooking.id,
          sender_id: user.id,
          receiver_id: booking.service.provider.id,
          content: `New booking request for ${booking.service.title} on ${booking.date} at ${booking.time}`,
        });

      if (messageError) throw messageError;

      setBookingId(newBooking.id);
      setBookingCreated(true);

    } catch (error) {
      console.error('Booking/Payment error:', error);
      setError('Failed to process booking. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!booking) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="mt-2 text-lg font-medium text-gray-900">Booking Not Found</h2>
            <p className="mt-1 text-sm text-gray-500">
              We couldn't find your booking details. Please try booking again.
            </p>
            <div className="mt-6">
              <Link
                to="/services"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Browse Services
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          {bookingCreated ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Booking Created!</h1>
              <p className="text-lg text-gray-600">Your booking is pending confirmation</p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Complete Your Booking</h1>
              <p className="text-lg text-gray-600">Review and confirm your service booking</p>
            </>
          )}
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 mb-2">Booking Details</h2>
              {bookingId && (
                <p className="text-sm text-gray-500">Booking ID: {bookingId}</p>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Calendar className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Date & Time</p>
                  <p className="text-sm text-gray-500">{booking.date} at {booking.time}</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <MapPin className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Location</p>
                  <p className="text-sm text-gray-500">{booking.location}</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Clock className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Duration</p>
                  <p className="text-sm text-gray-500">{booking.selectedPackage.duration}</p>
                </div>
              </div>
            </div>

            {!bookingCreated && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Method</h3>
                
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

                <div className="space-y-4">
                  {paymentMethods.map((method) => (
                    <label
                      key={method.id}
                      className={`block relative rounded-lg border p-4 cursor-pointer focus:outline-none ${
                        selectedPaymentMethod === method.id
                          ? 'border-indigo-500 ring-2 ring-indigo-500'
                          : 'border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment-method"
                        value={method.id}
                        className="sr-only"
                        checked={selectedPaymentMethod === method.id}
                        onChange={() => setSelectedPaymentMethod(method.id)}
                      />
                      <div className="flex items-center">
                        <div className="flex items-center">
                          <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                            selectedPaymentMethod === method.id
                              ? 'border-transparent bg-indigo-600'
                              : 'border-gray-300'
                          }`}>
                            {selectedPaymentMethod === method.id && (
                              <div className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </div>
                          <div className="ml-3">
                            {method.type === 'credit_card' ? (
                              <p className="text-sm font-medium text-gray-900">
                                {method.brand} ending in {method.last4}
                              </p>
                            ) : (
                              <p className="text-sm font-medium text-gray-900">PayPal</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Package ({booking.selectedPackage.name})</span>
                <span>${booking.selectedPackage.price}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Service Fee</span>
                <span>${(booking.selectedPackage.price * 0.01).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between font-medium text-lg mt-4 pt-4 border-t">
                <span>Total</span>
                <span className="text-indigo-600">${booking.total}</span>
              </div>
            </div>

            {bookingCreated ? (
              <div className="mt-6">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <div className="flex">
                    <Info className="h-5 w-5 text-blue-400" />
                    <div className="ml-3">
                      <p className="text-sm text-blue-700">
                        Your booking is pending confirmation from {booking.service.provider.name}. 
                        You'll receive a notification once it's confirmed.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <button
                  onClick={handlePayment}
                  disabled={loading || !selectedPaymentMethod}
                  className="w-full flex items-center justify-center px-4 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <CreditCard className="w-5 h-5 mr-2" />
                      Confirm Booking
                    </span>
                  )}
                </button>
                <p className="mt-2 text-sm text-gray-500 text-center flex items-center justify-center">
                  <Shield className="w-4 h-4 mr-1" />
                  Secure payment processing
                </p>
              </div>
            )}

            <div className="mt-6 space-y-3">
              <Link
                to="/bookings"
                className="block w-full text-center py-3 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                View My Bookings
              </Link>
              <Link
                to="/"
                className="block w-full text-center py-3 px-4 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Return to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}