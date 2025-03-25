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
  Shield, 
  Tag, 
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
  Star,
  MessageSquare,
  Users,
  Award,
  Share2
} from 'lucide-react';

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
    };
  };
  date: string;
  time: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  total_amount: number;
  package_duration: string;
}

export function Profile() {
  const { user, signOut, updateUserBalance } = useAuthStore();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'bookings' | 'messages'>('overview');
  const [newBalance, setNewBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    setNewBalance(user.balance);

    if (user.role === 'provider') {
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

      setServices(data.map(service => ({
        ...service,
        imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'
      })));
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
        .eq(user?.role === 'provider' ? 'provider_id' : 'customer_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setBookings(data || []);
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
      setError('Failed to update role. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (newRole: 'customer' | 'provider') => {
    try {
      const { data: { user: updatedUser }, error } = await supabase.auth.updateUser({
        data: { role: newRole }
      });

      if (error) throw error;

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

  const clientDetails = {
    name: user?.name || 'User',
    email: user?.email || '',
    phone: '(229) 555-0109',
    birthDate: '12/03/1987',
    address: '6301 Elgin St. Celina, Delaware, 10299',
    insurance: 'Yes',
    tags: ['Personal', 'Company Client'],
    stats: {
      completedServices: bookings.filter(b => b.status === 'completed').length,
      totalBookings: bookings.length,
      averageRating: 4.9,
      reviewCount: 127,
      followers: 234,
      following: 156
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center mb-6 md:mb-0">
              <div className="relative">
                <img
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(clientDetails.name)}&background=random&size=128`}
                  alt={clientDetails.name}
                  className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
                />
                {user.role === 'provider' && (
                  <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-2 rounded-full">
                    <Award className="w-4 h-4" />
                  </div>
                )}
              </div>
              <div className="ml-6">
                <h1 className="text-3xl font-bold">{clientDetails.name}</h1>
                <div className="flex items-center mt-2">
                  <span className="bg-white bg-opacity-20 px-3 py-1 rounded-full text-sm font-medium">
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </span>
                  <div className="flex items-center ml-4">
                    <Star className="w-4 h-4 text-yellow-400 fill-current" />
                    <span className="ml-1">{clientDetails.stats.averageRating}</span>
                    <span className="mx-1">·</span>
                    <span>{clientDetails.stats.reviewCount} reviews</span>
                  </div>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.completedServices}</div>
              <div className="text-sm opacity-80">Completed Services</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.totalBookings}</div>
              <div className="text-sm opacity-80">Total Bookings</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.followers}</div>
              <div className="text-sm opacity-80">Followers</div>
            </div>
            <div className="bg-white bg-opacity-10 rounded-lg p-4">
              <div className="text-2xl font-bold">{clientDetails.stats.following}</div>
              <div className="text-sm opacity-80">Following</div>
            </div>
          </div>
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
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab
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
              <h2 className="text-2xl font-bold text-gray-900">Messages</h2>
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
                    className={`bg-white rounded-xl shadow-sm p-6 ${
                      !message.read ? 'border-l-4 border-indigo-500' : ''
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
                <h3 className="mt-2 text-sm font-medium text-gray-900">No messages</h3>
                <p className="mt-1 text-sm text-gray-500">
                  You don't have any messages yet
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
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
                  <div className="space-y-4">
                    <div className="flex items-center text-gray-600">
                      <Mail className="w-5 h-5 mr-3 text-gray-400" />
                      <span>{clientDetails.email}</span>
                    </div>
                    <div className="flex items-center text-gray-600">
                      <Phone className="w-5 h-5 mr-3 text-gray-400" />
                      <span>{clientDetails.phone}</span>
                    </div>
                    <div className="flex items-center text-gray-600">
                      <MapPin className="w-5 h-5 mr-3 text-gray-400" />
                      <span>{clientDetails.address}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h2>
                  <div className="space-y-4">
                    <div className="flex items-center text-gray-600">
                      <Calendar className="w-5 h-5 mr-3 text-gray-400" />
                      <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center text-gray-600">
                      <Shield className="w-5 h-5 mr-3 text-gray-400" />
                      <span>Insurance: {clientDetails.insurance}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Tags</h2>
                    <button className="text-indigo-600 hover:text-indigo-700">
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {clientDetails.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
                <div className="space-y-3">
                  <button className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      <Settings className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">Account Settings</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      <Bell className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">Notifications</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                  <button 
                    onClick={() => setShowRoleModal(true)}
                    className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center">
                      <UserCircle className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">Switch Account Type</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                  <button
                    onClick={() => navigate('/payment-history')}
                    className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center">
                      <Settings className="w-5 h-5 text-gray-400 mr-3" />
                      <span className="text-gray-700">Balance history</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="lg:col-span-2 space-y-6">
              {user.role === 'provider' && (
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">My Services</h2>
                    <Link
                      to="/services"
                      className="flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Post New Service
                    </Link>
                  </div>
                  {loadingServices ? (
                    <div className="flex justify-center py-8">
                      <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
                    </div>
                  ) : services.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {services.map((service) => (
                        <ServiceCard key={service.id} {...service} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No services yet</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Start by creating your first service listing.
                      </p>
                      <div className="mt-6">
                        <Link
                          to="/services"
                          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Post a Service
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">Recent Bookings</h2>
                  <Link
                    to="/bookings"
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    View All
                  </Link>
                </div>
                {loadingBookings ? (
                  <div className="flex justify-center py-8">
                    <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
                  </div>
                ) : bookings.length > 0 ? (
                  <div className="space-y-4">
                    {bookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="flex items-start p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                      >
                        {booking.service && (
                          <>
                            <img
                              src={booking.service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'}
                              alt={booking.service.title}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                            <div className="ml-4 flex-1">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h3 className="text-sm font-medium text-gray-900">{booking.service.title}</h3>
                                  <p className="text-sm text-gray-500">Provider: {booking.service.provider.name}</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusStyles(booking.status)}`}>
                                  {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-4">
                                <div className="flex items-center text-sm text-gray-500">
                                  <Calendar className="w-4 h-4 mr-1 text-gray-400" />
                                  {booking.date}
                                </div>
                                <div className="flex items-center text-sm text-gray-500">
                                  <Clock className="w-4 h-4 mr-1 text-gray-400" />
                                  {booking.time}
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center text-sm text-gray-500">
                                  <MapPin className="w-4 h-4 mr-1 text-gray-400" />
                                  {booking.service.location}
                                </div>
                                <span className="text-sm font-medium text-gray-900">${booking.total_amount}</span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No bookings yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Start by booking a service
                    </p>
                    <div className="mt-6">
                      <Link
                        to="/services"
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                      >
                        Browse Services
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'services' && user.role === 'provider' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">My Services</h2>
              <Link
                to="/services"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Post New Service
              </Link>
            </div>
            {loadingServices ? (
              <div className="flex justify-center py-12">
                <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
              </div>
            ) : services.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {services.map((service) => (
                  <ServiceCard key={service.id} {...service} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No services yet</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Start by creating your first service listing.
                </p>
                <div className="mt-6">
                  <Link
                    to="/services"
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Post a Service
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bookings' && (
          <div className="space-y-6">
            <div className="flex justify-between items- center">
              <h2 className="text-2xl font-bold text-gray-900">My Bookings</h2>
              <Link
                to="/services"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Browse Services
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
                              <p className="text-gray-500">Provider: {booking.service.provider.name}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusStyles(booking.status)}`}>
                              {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
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
                                <span>Message</span>
                              </button>
                              <button className="flex items-center text-gray-500 hover:text-gray-700">
                                <Share2 className="w-5 h-5 mr-1" />
                                <span>Share</span>
                              </button>
                            </div>
                            <span className="text-xl font-semibold text-gray-900">${booking.total_amount}</span>
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
                <h3 className="mt-2 text-sm font-medium text-gray-900">No bookings yet</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Start by booking a service
                </p>
                <div className="mt-6">
                  <Link
                    to="/services"
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    Browse Services
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
              <h2 className="text-xl font-bold text-gray-900 mb-4">Change Account Type</h2>
              <p className="text-gray-600 mb-6">
                Select your account type. This will determine how you use the platform.
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => handleRoleChange('customer')}
                  disabled={loading || user.role === 'customer'}
                  className={`w-full p-4 rounded-xl border-2 flex items-center ${
                    user.role === 'customer'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-200'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <User className="h-6 w-6 text-gray-600 mr-3" />
                  <div className="text-left">
                    <div className="font-medium text-gray-900">Customer</div>
                    <div className="text-sm text-gray-500">Looking for services</div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleChange('provider')}
                  disabled={loading || user.role === 'provider'}
                  className={`w-full p-4 rounded-xl border-2 flex items-center ${
                    user.role === 'provider'
                      ? 'border-green-600 bg-green-50'
                      : 'border-gray-200 hover:border-green-200'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Briefcase className="h-6 w-6 text-gray-600 mr-3" />
                  <div className="text-left">
                    <div className="font-medium text-gray-900">Service Provider</div>
                    <div className="text-sm text-gray-500">Offering services</div>
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