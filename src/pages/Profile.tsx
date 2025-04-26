import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { ServiceCard } from '../components/ServiceCard';
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  Clock,
  Plus,
  ChevronRight,
  UserCircle,
  LogOut,
  Settings,
  Bell,
  AlertCircle,
  Briefcase,
  User,
  Loader,
  MessageSquare,
  Award,
  Share2,
  CalendarClock,
  Building,
  CheckCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Message {
  id: string;
  booking_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
  booking: {
    service: {
      title: string;
      images: string[];
    };
  };
  sender: {
    name: string;
    avatar_url: string | null;
  };
}

interface Booking {
  id: string;
  service: {
    title: string;
    images: string[];
    location: string;
    provider: {
      name: string;
      id: string;
    };
  };
  customer_id: string;
  provider_id: string;
  date: string;
  time: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  total_amount: number;
  package_duration: string;
}

interface Service {
  id: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  location: string;
  category: string;
  imageUrl?: string;
  images?: string[];
  packages?: any[];
  provider_id: string;
  provider: {
    name: string;
    avatar_url: string | null;
  };
  reviews_count: number;
}

export function Profile() {
  const { t } = useTranslation();
  const { user, signOut } = useAuthStore();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'bookings' | 'messages'>('overview');
  const [profile, setProfile] = useState({
    id: '',
    name: '',
    email: '',
    role: '',
    phone: '',
    address: '',
    birthDate: '',
    company: '',
    experience: '',
    specialties: [],
    balance: 0,
    avatarUrl: '',
    isVerified: false,
    created_at: ''
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);

        // Debug: log user from store and Supabase
        console.log('user from useAuthStore:', user);

        const { data: authData } = await supabase.auth.getUser();
        console.log('user from supabase.auth.getUser:', authData.user);

        if (!authData.user) {
          setError('User not authenticated');
          return;
        }

        // Fetch complete profile data
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (error || !data) {
          // If no profile in table, use user_metadata
          const meta = authData.user.user_metadata;
          setProfile({
            id: authData.user.id,
            name: meta.name || '',
            email: meta.email || authData.user.email,
            role: meta.role || '',
            phone: meta.phone_number || '',
            address: meta.address || '',
            birthDate: meta.birth_date || '',
            company: meta.company_name || '',
            experience: meta.experience_years?.toString() || '',
            specialties: meta.specialties || [],
            balance: meta.balance || 0,
            avatarUrl: meta.avatar_url || '',
            isVerified: meta.is_verified || false,
            created_at: authData.user.created_at || ''
          });
          return;
        }

        // Set all profile fields in state from table
        setProfile({
          id: data.id,
          name: data.name,
          email: data.email,
          role: data.role,
          phone: data.phone_number,
          address: data.address,
          birthDate: data.birth_date,
          company: data.company_name,
          experience: data.experience_years?.toString() || '',
          specialties: data.specialties || [],
          balance: data.balance || 0,
          avatarUrl: data.avatar_url,
          isVerified: data.is_verified,
          created_at: data.created_at || ''
        });

        console.log('Loaded profile data:', data);
      } catch (err) {
        console.error('Profile loading error:', err);
        setError('An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // FIX: Use user.user_metadata.role instead of user.user_metadata.role
    if (user.user_metadata.role === 'provider') {
      fetchMyServices();
    }
    fetchMyBookings();
    fetchMessages();
  }, [user]);

  const fetchMyServices = async () => {
    try {
      setLoadingServices(true);
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          provider:profiles(name, avatar_url)
        `)
        .eq('provider_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedServices: Service[] = (data || []).map(service => ({
        ...service,
        imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'
      }));

      setServices(formattedServices);
    } catch (error) {
      console.error('Error fetching services:', error);
      setError('Failed to load your services. Please try again.');
    } finally {
      setLoadingServices(false);
    }
  };


  const fetchMyBookings = async () => {
    try {
      setLoadingBookings(true);
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
          )
        `)
        .eq(user?.user_metadata.role === 'provider' ? 'provider_id' : 'customer_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Add null checks and default values
      const formattedBookings = (data || []).map(booking => ({
        ...booking,
        service: booking.service ? {
          ...booking.service,
          provider: booking.service.provider || {
            id: '',
            name: 'Unknown Provider',
            avatar_url: null
          },
          images: booking.service.images || []
        } : null
      }));

      setBookings(formattedBookings);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      setError('Failed to load your bookings. Please try again.');
    } finally {
      setLoadingBookings(false);
    }
  };

  const fetchMessages = async () => {
    try {
      setLoadingMessages(true);

      // Fetch messages where the user is either the sender or receiver
      const [sentMessages, receivedMessages] = await Promise.all([
        supabase
          .from('messages')
          .select(`
            *,
            booking:bookings (
              service:services (
                title,
                images
              )
            ),
            sender:profiles!messages_sender_id_fkey (
              name,
              avatar_url
            )
          `)
          .eq('sender_id', user!.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('messages')
          .select(`
            *,
            booking:bookings (
              service:services (
                title,
                images
              )
            ),
            sender:profiles!messages_sender_id_fkey (
              name,
              avatar_url
            )
          `)
          .eq('receiver_id', user!.id)
          .order('created_at', { ascending: false })
      ]);

      if (sentMessages.error) throw sentMessages.error;
      if (receivedMessages.error) throw receivedMessages.error;

      // Combine and sort messages by date
      const allMessages = [...(sentMessages.data || []), ...(receivedMessages.data || [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setMessages(allMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      setError('Failed to load messages. Please try again.');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      setError('Failed to sign out. Please try again.');
    }
  };

  const handleRoleChange = async (newRole: 'customer' | 'provider') => {
    try {
      setLoading(true);
      setError(null);
      await updateUserRole(newRole);
      setShowRoleModal(false);
    } catch (error) {
      console.error('Error changing role:', error);
      setError('Failed to update account type. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (newRole: 'customer' | 'provider') => {
    try {
      // const { data: error } = await supabase.auth.updateUser({
      //   data: { role: newRole }
      // });

      // if (error) throw error;

      // Update profile in database
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', user!.id);

      if (profileError) throw profileError;

      // Reload the page to reflect the changes
      window.location.reload();
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  };
  if (!user) {
    navigate('/login');
    return null;
  }

  const unreadMessages = messages.filter(m => !m.read).length;

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
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

      if (error) {
        console.error('Error updating booking status:', error);
        throw error;
      }

      console.log('Booking status updated successfully');
      // Reload the bookings by fetching fresh data for the correct role
      const role = user.user_metadata.role;
      const idField = role === 'provider' ? 'provider_id' : 'customer_id';

      const { data: updatedBookings, error: reloadError } = await supabase
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
          )
        `)
        .eq(idField, user.id)
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center mb-6 md:mb-0">
              <div className="relative">
                <img
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user.user_metadata.name)}&background=random&size=128`}
                  alt={user.user_metadata.name}
                  className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
                />
                {user.user_metadata.role === 'provider' && (
                  <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-2 rounded-full">
                    <Award className="w-4 h-4" />
                  </div>
                )}
              </div>
              <div className="ml-6">
                <h1 className="text-3xl font-bold">{user.user_metadata.name}</h1>
                <div className="flex items-center mt-2">
                  <span className="bg-white bg-opacity-20 px-3 py-1 rounded-full text-sm font-medium">
                    {user.user_metadata.role.charAt(0).toUpperCase() + user.user_metadata.role.slice(1)}
                  </span>
                  {/* <div className="flex items-center ml-4">
                    <Star className="w-4 h-4 text-yellow-400 fill-current" />
                    <span className="ml-1">{clientDetails.stats.averageRating}</span>
                    <span className="mx-1">·</span>
                    <span>{clientDetails.stats.reviewCount} reviews</span>
                  </div> */}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                className="bg-white bg-opacity-20 p-2 rounded-full hover:bg-opacity-30 transition-colors relative"
                onClick={() => setActiveTab('messages')}
              >
                <MessageSquare className="w-5 h-5" />
                {unreadMessages > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                    {unreadMessages}
                  </span>
                )}
              </button>
              <button className="bg-white bg-opacity-20 p-2 rounded-full hover:bg-opacity-30 transition-colors">
                <Share2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleSignOut}
                className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors flex items-center"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </button>
            </div>
          </div>

          {/* Stats Bar */}
          {/* <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.completedServices}</div>
              <div className="text-sm opacity-80">{t('profile.completedServices')}</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.totalBookings}</div>
              <div className="text-sm opacity-80">{t('profile.totalBookings')}</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.followers}</div>
              <div className="text-sm opacity-80">{t('profile.followers')}</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.following}</div>
              <div className="text-sm opacity-80">{t('profile.following')}</div>
            </div>
          </div> */}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {['overview', 'services', 'bookings', 'messages'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as typeof activeTab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === tab
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'messages' && unreadMessages > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                    {unreadMessages}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">{t('profile.messages')}</h2>
            </div>
            {loadingMessages ? (
              <div className="flex justify-center py-12">
                <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
              </div>
            ) : messages.length > 0 ? (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`bg-white rounded-xl shadow-sm p-6 ${!message.read ? 'border-l-4 border-indigo-500' : ''
                      }`}
                  >
                    <div className="flex items-start">
                      <img
                        src={message.sender.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.sender.name)}&background=random`}
                        alt={message.sender.name}
                        className="w-10 h-10 rounded-full"
                      />
                      <div className="ml-4 flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-sm font-medium text-gray-900">
                              {message.sender.name}
                            </h3>
                            <p className="text-xs text-gray-500">
                              {new Date(message.created_at).toLocaleDateString()} at{' '}
                              {new Date(message.created_at).toLocaleTimeString()}
                            </p>
                          </div>
                          {!message.read && (
                            <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
                              New
                            </span>
                          )}
                        </div>
                        <div className="mt-2">
                          <p className="text-sm text-gray-600">{message.content}</p>
                        </div>
                        <div className="mt-3 flex items-center text-xs text-gray-500">
                          {message.booking && message.booking.service && (
                            <span>Re: {message.booking.service.title}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">{t('profile.noMessages')}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {t('profile.noMessagesDescription')}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Info Card */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('profile.contactInformation')}</h2>
                  <div className="space-y-4">
                    <div className="flex items-center text-gray-600">
                      <Mail className="w-5 h-5 mr-3 text-gray-400" />
                      <span>{profile.email}</span>
                    </div>
                    {profile.phone && (
                      <div className="flex items-center text-gray-600">
                        <Phone className="w-5 h-5 mr-3 text-gray-400" />
                        <span>{profile.phone}</span>
                      </div>
                    )}
                    {profile.address && (
                      <div className="flex items-center text-gray-600">
                        <MapPin className="w-5 h-5 mr-3 text-gray-400" />
                        <span>{profile.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('profile.additionalInformation')}</h2>
                  <div className="space-y-4">
                    <div className="flex items-center text-gray-600">
                      <Calendar className="w-5 h-5 mr-3 text-gray-400" />
                      <span>{t('profile.joined', { date: new Date(profile.created_at || user.created_at).toLocaleDateString() })}</span>
                    </div>

                    {profile.birthDate && (
                      <div className="flex items-center text-gray-600">
                        <CalendarClock className="w-5 h-5 mr-3 text-gray-400" />
                        <span>{t('profile.birthDate')}: {new Date(profile.birthDate).toLocaleDateString()}</span>
                      </div>
                    )}

                    {profile.role === 'provider' && (
                      <>
                        {profile.company && (
                          <div className="flex items-center text-gray-600">
                            <Building className="w-5 h-5 mr-3 text-gray-400" />
                            <span>{profile.company}</span>
                          </div>
                        )}

                        {profile.experience && (
                          <div className="flex items-center text-gray-600">
                            <Briefcase className="w-5 h-5 mr-3 text-gray-400" />
                            <span>{t('profile.yearsExperience', { years: profile.experience })}</span>
                          </div>
                        )}
                      </>
                    )}

                    {profile.isVerified && (
                      <div className="flex items-center text-green-600">
                        <CheckCircle className="w-5 h-5 mr-3 text-green-500" />
                        <span>{t('profile.verified')}</span>
                      </div>
                    )}
                  </div>
                </div>

                {profile.role === 'provider' && profile.specialties && profile.specialties.length > 0 && (
                  <div className="border-t pt-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900">{t('profile.specialties')}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {profile.specialties.map((specialty, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium"
                        >
                          {specialty}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('profile.quickActions')}</h2>
                <div className="space-y-3">
                  {/* <button className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      <Settings className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">{t('profile.accountSettings')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      <Bell className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">{t('profile.notifications')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button> */}
                  <button
                    onClick={() => setShowRoleModal(true)}
                    className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center">
                      <UserCircle className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">{t('profile.switchAccountType')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                  {/* <button
                    onClick={() => navigate('/payment-history')}
                    className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center">
                      <Settings className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">{t('profile.balanceHistory')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button> */}
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="lg:col-span-2 space-y-6">
              {user.user_metadata.role === 'provider' && (
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">{t('profile.myServices')}</h2>
                    <Link
                      to="/services"
                      className="flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      {t('profile.postNewService')}
                    </Link>
                  </div>
                  {loadingServices ? (
                    <div className="flex justify-center py-8">
                      <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
                    </div>
                  ) : services.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {services.map((service: Service) => (
                        <ServiceCard
                          key={service.id}
                          id={service.id}
                          title={service.title}
                          description={service.description}
                          price={service.price}
                          rating={service.rating}
                          location={service.location}
                          category={service.category}
                          imageUrl={service.imageUrl || ''}
                          images={service.images || []}
                          packages={service.packages || []}
                          provider_id={service.provider_id}
                          provider={service.provider}
                          reviews_count={service.reviews_count}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">{t('profile.noServices.title')}</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {t('profile.noServices.description')}
                      </p>
                      <div className="mt-6">
                        <Link
                          to="/services"
                          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          {t('profile.postNewService')}
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">{t('profile.recentBookings')}</h2>
                  <Link
                    to="/bookings"
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    {t('profile.viewAll')}
                  </Link>
                </div>
                {loadingBookings ? (
                  <div className="flex justify-center py-8">
                    <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
                  </div>
                ) : bookings.length > 0 ? (
                  <div className="space-y-4">
                    {bookings.map((booking) => (
                      booking.service && (
                        <div
                          key={booking.id}
                          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start">
                            <img
                              src={booking.service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'}
                              alt={booking.service.title}
                              className="w-24 h-24 rounded-lg object-cover"
                            />
                            <div className="ml-6 flex-1">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h3 className="text-lg font-medium text-gray-900">{booking.service.title}</h3>
                                  <p className="text-gray-500">{t('profile.provider', { name: booking.service.provider.name })}</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusStyles(booking.status)}`}>
                                  {t(`profile.status.${booking.status}`)}
                                </span>
                              </div>
                              <div className="mt-4 grid grid-cols-3 gap-4">
                                <div className="flex items-center text-gray-500">
                                  <Calendar className="w-5 h-5 mr-2 text-gray-400" />
                                  {booking.date}
                                </div>
                                <div className="flex items-center text-gray-500">
                                  <Clock className="w-5 h-5 mr-2 text-gray-400" />
                                  {booking.time}
                                </div>
                                <div className="flex items-center text-gray-500">
                                  <MapPin className="w-5 h-5 mr-2 text-gray-400" />
                                  {booking.service.location}
                                </div>
                              </div>
                              <div className="mt-4 flex items-center justify-between">
                                <div className="flex space-x-4">
                                  <button className="flex items-center text-gray-500 hover:text-gray-700">
                                    <MessageSquare className="w-5 h-5 mr-1" />
                                    <span>{t('profile.messages.message')}</span>
                                  </button>
                                  <button className="flex items-center text-gray-500 hover:text-gray-700">
                                    <Share2 className="w-5 h-5 mr-1" />
                                    <span>{t('profile.messages.share')}</span>
                                  </button>
                                </div>
                                <span className="text-xl font-semibold text-gray-900">{booking.total_amount} ₼</span>
                              </div>

                              {/* Add accept/reject buttons for providers */}
                              {user.user_metadata.role === 'provider' &&
                                booking.status === 'pending' && (
                                  <div className="mt-4 flex items-center space-x-4">
                                    <button
                                      onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                                      className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                                    >
                                      {t('profile.accept')}
                                    </button>
                                    <button
                                      onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
                                      className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                                    >
                                      {t('profile.reject')}
                                    </button>
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">{t('profile.noBookings.title')}</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {t('profile.noBookings.description')}
                    </p>
                    <div className="mt-6">
                      <Link
                        to="/services"
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                      >
                        {t('profile.browseServices')}
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'services' && user?.user_metadata.role === 'provider' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">{t('profile.myServices')}</h2>
              <Link
                to="/services"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('profile.postNewService')}
              </Link>
            </div>
            {loadingServices ? (
              <div className="flex justify-center py-12">
                <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
              </div>
            ) : services.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {services.map((service: Service) => (
                  <ServiceCard
                    key={service.id}
                    id={service.id}
                    title={service.title}
                    description={service.description}
                    price={service.price}
                    rating={service.rating}
                    location={service.location}
                    category={service.category}
                    imageUrl={service.imageUrl || ''}
                    images={service.images || []}
                    packages={service.packages || []}
                    provider_id={service.provider_id}
                    provider={service.provider}
                    reviews_count={service.reviews_count}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">{t('profile.noServices.title')}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {t('profile.noServices.description')}
                </p>
                <div className="mt-6">
                  <Link
                    to="/services"
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t('profile.postNewService')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bookings' && (
          <div className="space-y-6">
            <div className="flex justify-between items- center">
              <h2 className="text-2xl font-bold text-gray-900">{t('profile.bookings.title')}</h2>
              <Link
                to="/services"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                {t('profile.bookings.browseServices')}
              </Link>
            </div>
            {loadingBookings ? (
              <div className="flex justify-center py-12">
                <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
              </div>
            ) : bookings.length > 0 ? (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  booking.service && (
                    <div
                      key={booking.id}
                      className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start">
                        <img
                          src={booking.service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'}
                          alt={booking.service.title}
                          className="w-24 h-24 rounded-lg object-cover"
                        />
                        <div className="ml-6 flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="text-lg font-medium text-gray-900">{booking.service.title}</h3>
                              <p className="text-gray-500">{t('profile.provider', { name: booking.service.provider.name })}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusStyles(booking.status)}`}>
                              {t(`profile.status.${booking.status}`)}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-4">
                            <div className="flex items-center text-gray-500">
                              <Calendar className="w-5 h-5 mr-2 text-gray-400" />
                              {booking.date}
                            </div>
                            <div className="flex items-center text-gray-500">
                              <Clock className="w-5 h-5 mr-2 text-gray-400" />
                              {booking.time}
                            </div>
                            <div className="flex items-center text-gray-500">
                              <MapPin className="w-5 h-5 mr-2 text-gray-400" />
                              {booking.service.location}
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between">
                            <div className="flex space-x-4">
                              <button className="flex items-center text-gray-500 hover:text-gray-700">
                                <MessageSquare className="w-5 h-5 mr-1" />
                                <span>{t('profile.messages.message')}</span>
                              </button>
                              <button className="flex items-center text-gray-500 hover:text-gray-700">
                                <Share2 className="w-5 h-5 mr-1" />
                                <span>{t('profile.messages.sharee')}</span>
                              </button>
                            </div>
                            <span className="text-xl font-semibold text-gray-900">{booking.total_amount} ₼</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">{t('profile.noBookings.title')}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {t('profile.noBookings.description')}
                </p>
                <div className="mt-6">
                  <Link
                    to="/services"
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    {t('profile.browseServices')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Role Change Modal */}
        {showRoleModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-gray-900 mb-4">{t('profile.roleModal.title')}</h2>
              <p className="text-gray-600 mb-6">
                {t('profile.roleModal.description')}
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => handleRoleChange('customer')}
                  disabled={loading || user.user_metadata.role === 'customer'}
                  className={`w-full p-4 rounded-xl border-2 flex items-center ${user.user_metadata.role === 'customer'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-200'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <User className="h-6 w-6 text-gray-600 mr-3" />
                  <div className="text-left">
                    <div className="font-medium text-gray-900">{t('profile.roleModal.customerTitle')}</div>
                    <div className="text-sm text-gray-500">{t('profile.roleModal.customerDesc')}</div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleChange('provider')}
                  disabled={loading || user.user_metadata.role === 'provider'}
                  className={`w-full p-4 rounded-xl border-2 flex items-center ${user.user_metadata.role === 'provider'
                    ? 'border-green-600 bg-green-50'
                    : 'border-gray-200 hover:border-green-200'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Briefcase className="h-6 w-6 text-gray-600 mr-3" />
                  <div className="text-left">
                    <div className="font-medium text-gray-900">{t('profile.roleModal.providerTitle')}</div>
                    <div className="text-sm text-gray-500">{t('profile.roleModal.providerDesc')}</div>
                  </div>
                </button>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowRoleModal(false)}
                  disabled={loading}
                  className="px-4 py-2 text-gray-600 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}