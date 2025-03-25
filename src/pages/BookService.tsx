import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { format } from 'date-fns';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Filter, 
  ChevronDown, 
  Briefcase, 
  Clock as ClockIcon, 
  Award, 
  Users, 
  Shield, 
  Star,
  MessageSquare,
  Loader,
  CreditCard
} from 'lucide-react';

interface TimeSlot {
  id: string;
  time: string;
  available: boolean;
}

const TIME_SLOTS: TimeSlot[] = [
  { id: 'slot-1', time: '09:00', available: true },
  { id: 'slot-2', time: '10:00', available: true },
  { id: 'slot-3', time: '11:00', available: true },
  { id: 'slot-4', time: '12:00', available: false },
  { id: 'slot-5', time: '13:00', available: true },
  { id: 'slot-6', time: '14:00', available: true },
  { id: 'slot-7', time: '15:00', available: true },
  { id: 'slot-8', time: '16:00', available: true },
  { id: 'slot-9', time: '17:00', available: true },
];

const DEFAULT_PACKAGES = [
  {
    id: 'basic',
    name: 'Basic',
    price: 40,
    duration: '2 hours',
    features: [
      'Basic cleaning of all rooms',
      'Vacuuming and mopping',
      'Dusting surfaces',
      'Bathroom cleaning'
    ]
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 75,
    duration: '3 hours',
    features: [
      'Everything in Basic package',
      'Deep cleaning of kitchen',
      'Inside window cleaning',
      'Laundry service'
    ],
    popular: true
  },
  {
    id: 'deluxe',
    name: 'Deluxe',
    price: 100,
    duration: '4 hours',
    features: [
      'Everything in Premium package',
      'Deep carpet cleaning',
      'Furniture cleaning',
      'Organizing and decluttering'
    ]
  }
];

interface ServiceProvider {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  experience: string | null;
  specialties: string[] | null;
}

interface ServiceData {
  id: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  reviews_count: number;
  location: string;
  category: string;
  images: string[];
  packages: any[];
  requirements?: string[];
  provider_id: string;
  provider: ServiceProvider;
}

export function BookService() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceData | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }

    if (location.state?.service) {
      const serviceData = location.state.service;
      setService(serviceData);
      setSelectedPackage(serviceData.packages?.[0] || DEFAULT_PACKAGES[0]);
      setLoading(false);
    } else if (serviceId) {
      fetchServiceDetails();
    } else {
      setError('No service specified');
      setLoading(false);
    }
  }, [serviceId, location.state, user, navigate, location]);

  const fetchServiceDetails = async () => {
    try {
      const { data: serviceData, error: serviceError } = await supabase
        .from('services')
        .select(`
          *,
          provider:profiles (
            id,
            name,
            avatar_url,
            role,
            experience,
            specialties
          )
        `)
        .eq('id', serviceId)
        .single();

      if (serviceError) throw serviceError;

      if (!serviceData) {
        throw new Error('Service not found');
      }

      // Ensure provider data is properly structured
      const providerData = serviceData.provider || {
        id: serviceData.provider_id,
        name: 'Unknown Provider',
        avatar_url: null,
        role: 'provider',
        experience: null,
        specialties: []
      };

      const formattedService: ServiceData = {
        ...serviceData,
        images: serviceData.images || [],
        packages: serviceData.packages || DEFAULT_PACKAGES,
        provider: providerData,
        provider_id: serviceData.provider_id // Ensure provider_id is set
      };

      setService(formattedService);
      setSelectedPackage(formattedService.packages[0] || DEFAULT_PACKAGES[0]);
    } catch (error) {
      console.error('Error fetching service:', error);
      setError('Failed to load service details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async () => {
    if (!selectedDate || !selectedTime) {
      setError('Please select both date and time');
      return;
    }

    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }

    if (!service || !service.provider_id) {
      setError('Service provider information is missing');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const serviceFee = selectedPackage.price * 0.1;
      const total = selectedPackage.price + serviceFee;

      navigate('/bookings/confirmation', {
        state: {
          booking: {
            service: {
              id: service.id,
              title: service.title,
              provider: {
                id: service.provider_id,
                name: service.provider.name,
                avatar_url: service.provider.avatar_url
              }
            },
            selectedPackage,
            date: format(selectedDate, 'MMMM d, yyyy'),
            time: selectedTime,
            location: service.location,
            total
          }
        }
      });
    } catch (error) {
      setError('Failed to create booking. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader className="h-12 w-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!service || !selectedPackage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Service Not Found</h2>
        <p className="text-gray-600 mb-8">The service you're looking for doesn't exist or has been removed.</p>
        <button
          onClick={() => navigate('/services')}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Browse Services
        </button>
      </div>
    );
  }

  const dates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Service Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Service Overview */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <img
                src={service.images[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'}
                alt={service.title}
                className="w-full h-64 object-cover"
              />
              <div className="p-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{service.title}</h1>
                <p className="text-gray-600 mb-4">{service.description}</p>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {service.requirements?.map((requirement, index) => (
                    <div key={`requirement-${index}`} className="flex items-center">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                      <span className="text-sm text-gray-600">{requirement}</span>
                    </div>
                  ))}
                </div>

                {/* Provider Info */}
                <div className="border-t pt-6">
                  <div className="flex items-start space-x-4">
                    <img
                      src={service.provider.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(service.provider.name)}&background=random`}
                      alt={service.provider.name}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {service.provider.name}
                            <Award className="inline-block h-5 w-5 text-blue-500 ml-2" />
                          </h3>
                          {service.provider.experience && (
                            <div className="mt-2 flex items-center text-gray-600">
                              <Shield className="h-5 w-5 mr-2 text-gray-400" />
                              <span>{service.provider.experience} years experience</span>
                            </div>
                          )}
                        </div>
                        <button className="flex items-center justify-center p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                          <MessageSquare className="h-5 w-5 text-gray-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Service Packages */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-6">Select Package</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {service.packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`relative rounded-lg border-2 p-6 cursor-pointer transition-all ${
                      selectedPackage.id === pkg.id
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-indigo-200'
                    }`}
                    onClick={() => setSelectedPackage(pkg)}
                  >
                    {pkg.popular && (
                      <span className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-3 py-1 rounded-full text-xs font-medium">
                        Popular
                      </span>
                    )}
                    <h3 className="text-lg font-medium text-gray-900 mb-2">{pkg.name}</h3>
                    <div className="mb-4">
                      <span className="text-2xl font-bold text-gray-900">${pkg.price}</span>
                      <span className="text-gray-500">/hour</span>
                    </div>
                    <ul className="space-y-2">
                      {pkg.features.map((feature, index) => (
                        <li key={`${pkg.id}-feature-${index}`} className="flex items-start">
                          <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0" />
                          <span className="text-sm text-gray-600">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Date Selection */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                <Calendar className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                Select Date
              </h2>
              <div className="grid grid-cols-7 gap-2">
                {dates.map((date, index) => (
                  <button
                    key={`date-${index}`}
                    onClick={() => setSelectedDate(date)}
                    className={`p-2 text-center rounded-lg hover:bg-indigo-50 ${
                      selectedDate.toDateString() === date.toDateString()
                        ? 'bg-indigo-100 text-indigo-700 font-medium'
                        : 'text-gray-700'
                    }`}
                  >
                    <div className="text-xs text-gray-500">{format(date, 'EEE')}</div>
                    <div className="font-medium">{format(date, 'd')}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Time Selection */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                <Clock className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                Select Time
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {TIME_SLOTS.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedTime(slot.time)}
                    disabled={!slot.available}
                    className={`p-3 text-center rounded-lg ${
                      !slot.available
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : selectedTime === slot.time
                        ? 'bg-indigo-100 text-indigo-700 font-medium'
                        : 'hover:bg-indigo-50 text-gray-700'
                    }`}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Booking Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6 sticky top-8">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                <CreditCard className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                Booking Summary
              </h2>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Package</span>
                  <span className="font-medium">{selectedPackage.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Duration</span>
                  <span className="font-medium">{selectedPackage.duration}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Date</span>
                  <span className="font-medium">
                    {selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'Not selected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Time</span>
                  <span className="font-medium">
                    {selectedTime || 'Not selected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Location</span>
                  <span className="font-medium">{service.location}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">Service Fee</span>
                  <span className="font-medium">${selectedPackage.price}</span>
                </div>
                <div className="flex items-center justify-between font-medium text-lg">
                  <span>Total</span>
                  <span className="text-indigo-600">${selectedPackage.price}</span>
                </div>
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

              <button
                onClick={handleBooking}
                disabled={loading || !selectedDate || !selectedTime}
                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : 'Confirm Booking'}
              </button>

              <p className="mt-4 text-sm text-gray-500 text-center">
                You won't be charged yet
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}