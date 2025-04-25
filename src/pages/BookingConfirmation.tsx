import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { 
  CheckCircle, 
  Calendar, 
  MapPin, 
  Clock, 
  AlertCircle,
  ArrowLeft,
  Info,
  Shield
} from 'lucide-react';

interface BookingDetails {
  id: string;
  service_id: string;
  customer_id: string;
  provider_id: string;
  date: string;
  time: string;
  status: string;
  service: {
    id: string;
    title: string;
    provider: {
      id: string;
      name: string;
      avatar_url: string | null;
    };
    location: string;
  };
  package: {
    name: string;
    price: number;
    duration: string;
    features: string[];
  };
}

export function BookingConfirmation() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [bookingCreated, setBookingCreated] = useState(true);

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

  if (!booking) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="mt-2 text-lg font-medium text-gray-900">
              {t('bookingConfirmation.notFound.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('bookingConfirmation.notFound.description')}
            </p>
            <div className="mt-6">
              <Link
                to="/services"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition duration-200"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('bookingConfirmation.notFound.browseServices')}
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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {t('bookingConfirmation.title')}
          </h1>
          <p className="text-lg text-gray-600">
            {t('bookingConfirmation.subtitle')}
          </p>
        </div>

        <div className="bg-white shadow-md rounded-lg overflow-hidden hover:shadow-lg transition duration-200">
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 mb-2">
                {t('bookingConfirmation.details')}
              </h2>
              <p className="text-sm text-gray-500">
                {t('bookingConfirmation.bookingId')}: {booking.id}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Calendar className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">
                    {t('bookingConfirmation.dateTime')}
                  </p>
                  <p className="text-sm text-gray-500">{booking.date} at {booking.time}</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <MapPin className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">
                    {t('bookingConfirmation.location')}
                  </p>
                  <p className="text-sm text-gray-500">{booking.service.location}</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Clock className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">
                    {t('bookingConfirmation.duration')}
                  </p>
                  <p className="text-sm text-gray-500">{booking.package.duration}</p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>{t('bookingConfirmation.package')} ({booking.package.name})</span>
                <span>{booking.package.price} ₼</span>
              </div>
              <div className="flex items-center justify-between font-medium text-lg mt-4 pt-4 border-t">
                <span>{t('bookingConfirmation.total')}</span>
                <span className="text-indigo-600">{booking.package.price} ₼</span>
              </div>
            </div>

            <div className="mt-6">
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <div className="flex">
                  <Info className="h-5 w-5 text-blue-400" />
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      {t('bookingConfirmation.info.pending', { provider: booking.service.provider.name })}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <Link
                to="/bookings"
                className="block w-full text-center py-3 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-200"
              >
                {t('bookingConfirmation.actions.viewBookings')}
              </Link>
              <Link
                to="/"
                className="block w-full text-center py-3 px-4 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500 transition duration-200"
              >
                {t('bookingConfirmation.actions.returnHome')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}