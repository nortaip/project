import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Star, 
  MapPin, 
  Briefcase, 
  Award, 
  MessageSquare, 
  Calendar, 
  Clock, 
  Phone, 
  Mail, 
  Globe, 
  Facebook, 
  Instagram, 
  Linkedin,
  Loader,
  AlertCircle,
  Send,
  X
} from 'lucide-react';
import { ServiceCard } from '../components/ServiceCard';
import { useAuthStore } from '../store/auth';
import { useTranslation } from 'react-i18next';

interface Provider {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  address: string | null;
  company: string | null;
  experience: string | null;
  specialties: string[] | null;
  created_at: string;
}

// Add type definition for Service
interface Service {
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
  provider: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  reviews_count: number;
}

export function ProviderProfile() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProviderDetails();
      fetchProviderServices();
    }
  }, [id]);

  const fetchProviderDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: providerData, error: providerError } = await supabase
        .from('profiles')
        .select('*, services(*)')
        .eq('id', id)
        .eq('role', 'provider')
        .single();

      if (providerError) throw providerError;
      
      setProvider(providerData);
    } catch (error) {
      console.error('Error fetching provider details:', error);
      setError('Failed to load provider details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchProviderServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          provider:profiles(name, avatar_url)
        `)
        .eq('provider_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setServices(data.map(service => ({
        ...service,
        imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'
      })));
    } catch (error) {
      console.error('Error fetching provider services:', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      navigate('/login', { state: { from: `/provider/${id}` } });
      return;
    }

    if (!message.trim() || !provider) {
      return;
    }

    try {
      setSending(true);
      setError(null);

      // Create a dummy booking for the message
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          service_id: null, // This is a direct message without a service
          customer_id: user.id,
          provider_id: id,
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          time: '12:00',
          total_amount: 0
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Send the message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          booking_id: bookingData.id,
          sender_id: user.id,
          receiver_id: id,
          content: message
        });

      if (messageError) throw messageError;

      setMessageSent(true);
      setMessage('');
      
      // Close the modal after a short delay
      setTimeout(() => {
        setShowContactModal(false);
        setMessageSent(false);
      }, 2000);
      
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader className="h-12 w-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-2 text-lg font-medium text-gray-900">{t('providerProfile.notFound.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('providerProfile.notFound.description')}
          </p>
          <div className="mt-6">
            <button
              onClick={() => navigate('/providers')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {t('providerProfile.notFound.backToProviders')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Provider Header */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden mb-8">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-500 h-48 relative">
            {provider.avatar_url ? (
              <img
                src={provider.avatar_url}
                alt={provider.name}
                className="absolute bottom-0 left-8 transform translate-y-1/2 w-32 h-32 rounded-full border-4 border-white object-cover"
              />
            ) : (
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(provider.name || 'Provider')}&background=random&size=128`}
                alt={provider.name}
                className="absolute bottom-0 left-8 transform translate-y-1/2 w-32 h-32 rounded-full border-4 border-white object-cover"
              />
            )}
          </div>
          <div className="pt-20 pb-8 px-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center">
                  <h1 className="text-3xl font-bold text-gray-900">{provider.name}</h1>
                  <Award className="ml-2 h-6 w-6 text-blue-500" />
                </div>
                <p className="text-gray-600 mt-1">{provider.company || t('providerProfile.serviceProvider')}</p>
                <div className="flex items-center mt-2">
                  <Star className="h-5 w-5 text-yellow-400 fill-current" />
                  <span className="ml-1 text-gray-900 font-medium">0.0</span>
                  <span className="mx-1 text-gray-500">·</span>
                  <span className="text-gray-500">{t('providerProfile.reviews', { count: 0 })}</span>
                </div>
              </div>
              <div className="mt-4 md:mt-0 flex space-x-4">
                <button
                  onClick={() => setShowContactModal(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  <MessageSquare className="h-5 w-5 mr-2" />
                  {t('providerProfile.contact')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
              <div className="flex items-center">
                <MapPin className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-600">{provider.address || t('providerProfile.locationNotSpecified')}</span>
              </div>
              <div className="flex items-center">
                <Briefcase className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-600">{provider.experience ? 
                  t('providerProfile.yearsExperience', { years: provider.experience }) : 
                  t('providerProfile.onePlusYearsExperience')}</span>
              </div>
              <div className="flex items-center">
                <Calendar className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-600">{t('providerProfile.memberSince', { date: new Date(provider.created_at).toLocaleDateString() })}</span>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="text-lg font-medium text-gray-900 mb-2">{t('providerProfile.specialties')}</h2>
              <div className="flex flex-wrap gap-2">
                {provider.specialties && provider.specialties.length > 0 ? (
                  provider.specialties.map((specialty, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm"
                    >
                      {specialty}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-500">{t('providerProfile.noSpecialties')}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Provider Services */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('providerProfile.servicesOffered')}</h2>
          {services.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service) => (
                <ServiceCard 
                  key={service.id}
                  id={service.id}
                  title={service.title}
                  description={service.description}
                  price={service.price}
                  rating={service.rating}
                  location={service.location}
                  category={service.category}
                  images={service.images || []}
                  packages={service.packages || []}
                  provider_id={service.provider_id}
                  provider={service.provider}
                  reviews_count={service.reviews_count}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">{t('providerProfile.noServices.title')}</h3>
              <p className="mt-1 text-gray-500">
                {t('providerProfile.noServices.description')}
              </p>
            </div>
          )}
        </div>

        {/* Contact Modal */}
        {showContactModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {t('providerProfile.contactModal.title', { name: provider.name })}
                </h2>
                <button
                  onClick={() => setShowContactModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-6 w-6" />
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

              {messageSent && (
                <div className="mb-4 bg-green-50 border border-green-200 rounded-md p-4">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-green-400" />
                    <div className="ml-3">
                      <p className="text-sm text-green-700">{t('providerProfile.contactModal.messageSent')}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6 space-y-4">
                {provider.phone && (
                  <div className="flex items-center">
                    <Phone className="h-5 w-5 text-gray-400 mr-3" />
                    <span className="text-gray-700">{provider.phone}</span>
                  </div>
                )}
                {provider.email && (
                  <div className="flex items-center">
                    <Mail className="h-5 w-5 text-gray-400 mr-3" />
                    <span className="text-gray-700">{provider.email}</span>
                  </div>
                )}
              </div>

              <form onSubmit={handleSendMessage}>
                <div className="mb-4">
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('providerProfile.contactModal.yourMessage')}
                  </label>
                  <textarea
                    id="message"
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder={t('providerProfile.contactModal.messagePlaceholder', { name: provider.name })}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                  ></textarea>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={sending || !message.trim()}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    {sending ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t('providerProfile.contactModal.sending')}
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <Send className="h-4 w-4 mr-2" />
                        {t('providerProfile.contactModal.sendMessage')}
                      </span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}