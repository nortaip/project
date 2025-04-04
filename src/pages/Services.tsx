import React, { useState, useEffect } from 'react';
import { Search, Sliders, Plus, AlertCircle, MapPin, Filter, ChevronDown, ArrowRight, Briefcase } from 'lucide-react';
import { ServiceCard } from '../components/ServiceCard';
import { PostServiceForm, ServiceFormData } from '../components/PostServiceForm';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useTranslation } from 'react-i18next';

const CATEGORY_KEYS = [
  'all',
  'cleaning',
  'plumbing',
  'electrical',
  'gardening',
  'personalTraining',
  'techSupport',
  'petCare'
];

export function Services() {
  const { t } = useTranslation();
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const initialSearchQuery = searchParams.get('q') || '';
  const initialLocation = searchParams.get('location') || '';
  const initialCategory = searchParams.get('category') || 'All';
  const initialMinPrice = searchParams.get('minPrice') || '';
  const initialMaxPrice = searchParams.get('maxPrice') || '';
  const initialRating = searchParams.get('rating') || 'Any rating';

  const { user } = useAuthStore();
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [location, setLocation] = useState(initialLocation);
  const [showPostForm, setShowPostForm] = useState(false);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState({ 
    min: initialMinPrice, 
    max: initialMaxPrice 
  });
  const [rating, setRating] = useState(initialRating);
  const [availability, setAvailability] = useState('Any time');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    // Update filters based on URL parameters when component mounts
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get('q') || '');
    setLocation(params.get('location') || '');
    setSelectedCategory(params.get('category') || 'All');
    setPriceRange({
      min: params.get('minPrice') || '',
      max: params.get('maxPrice') || ''
    });
    setRating(params.get('rating') || 'Any rating');
  }, []);

  useEffect(() => {
    console.log('Services component mounted');
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('Fetching services...');

      // Type the response properly
      const { data, error } = await supabase
        .from('services')
        .select(`
          id,
          title,
          description,
          price,
          category,
          location,
          images,
          rating,
          reviews_count,
          created_at,
          provider_id,
          provider:profiles!services_provider_id_fkey (
            id,
            name,
            avatar_url
          )
        `);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Raw data from Supabase:', data);

      if (!data || data.length === 0) {
        console.log('No services found in database');
        setServices([]);
        return;
      }

      const formattedServices = data.map(service => {
        console.log('Processing service:', service);
        return {
          ...service,
          imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80',
          provider: {
            name: service.provider?.name || 'Unknown Provider',
            avatar_url: service.provider?.avatar_url
          }
        };
      });

      console.log('Formatted services:', formattedServices);
      setServices(formattedServices);

    } catch (error) {
      console.error('Error in fetchServices:', error);
      setError('Failed to load services. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePostService = async (serviceData: ServiceFormData) => {
    try {
      setLoading(true);
      setError(null);

      if (!user) {
        throw new Error('You must be logged in to post a service');
      }

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      if (!profile || profile.role !== 'provider') {
        throw new Error('Only service providers can post services');
      }

      // Get the base price from the first package
      const basePrice = serviceData.packages[0]?.price || 0;

      const { data, error } = await supabase
        .from('services')
        .insert({
          provider_id: user.id,
          title: serviceData.title,
          description: serviceData.description,
          category: serviceData.category,
          price: basePrice, // Use the base price from the first package
          location: serviceData.location,
          availability: serviceData.availability,
          images: serviceData.images || [],
          packages: serviceData.packages || [],
          website: serviceData.website,
          requirements: serviceData.requirements,
          cancellation_policy: serviceData.cancellation_policy,
          business_hours: serviceData.business_hours,
          faqs: serviceData.faqs,
          tags: serviceData.tags,
          social_media: serviceData.social_media,
          rating: 0,
          reviews_count: 0
        })
        .select()
        .single();

      if (error) throw error;

      await fetchServices();
      setShowPostForm(false);
    } catch (error) {
      console.error('Error posting service:', error);
      setError(error instanceof Error ? error.message : 'Failed to post service. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(service => {
    console.log('Filtering service:', service);
    const matchesCategory = selectedCategory === 'all' || service.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLocation = !location || 
      service.location?.toLowerCase().includes(location.toLowerCase());
    const matchesPrice = (!priceRange.min || service.price >= Number(priceRange.min)) &&
      (!priceRange.max || service.price <= Number(priceRange.max));
    const matchesRating = rating === 'Any rating' || 
      (rating === '4+ stars' && service.rating >= 4) ||
      (rating === '3+ stars' && service.rating >= 3);

    return matchesCategory && matchesSearch && matchesLocation && matchesPrice && matchesRating;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{t('services.title')}</h1>
          {user?.role === 'provider' && (
            <button
              onClick={() => setShowPostForm(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="h-5 w-5 mr-2" />
              Post Service
            </button>
          )}
        </div>

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

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Sidebar - Filters */}
          <div className="lg:w-72 flex-shrink-0 space-y-6">
            {/* Search */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder={t('home.search.placeholder')}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Categories */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                {t('services.categories.title')}
              </h2>
              <div className="space-y-2">
                {CATEGORY_KEYS.map((categoryKey) => (
                  <button
                    key={categoryKey}
                    onClick={() => setSelectedCategory(categoryKey)}
                    className={`w-full text-left px-4 py-2 rounded-lg ${
                      selectedCategory === categoryKey
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t(`services.categories.${categoryKey}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-gray-900">{t('services.filters.title')}</h2>
                <Filter className="h-5 w-5 text-gray-400" />
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('services.filters.price.title')}
                  </label>
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        placeholder={t('services.filters.price.min')}
                        className="w-full pl-8 pr-3 py-2 border rounded-md"
                        value={priceRange.min}
                        onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                      />
                    </div>
                    <span className="text-gray-500">-</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        placeholder={t('services.filters.price.max')}
                        className="w-full pl-8 pr-3 py-2 border rounded-md"
                        value={priceRange.max}
                        onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('services.filters.rating.title')}
                  </label>
                  <select 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  >
                    <option>{t('services.filters.rating.any')}</option>
                    <option>{t('services.filters.rating.fourPlus')}</option>
                    <option>{t('services.filters.rating.threePlus')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('services.filters.availability.title')}
                  </label>
                  <select 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={availability}
                    onChange={(e) => setAvailability(e.target.value)}
                  >
                    <option>Any time</option>
                    <option>Today</option>
                    <option>This week</option>
                    <option>This month</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Right Content - Service Cards */}
          <div className="flex-1">
            {loading ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
            ) : error ? (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
                <h3 className="mt-2 text-lg font-medium text-gray-900">Error</h3>
                <p className="mt-2 text-gray-500">{error}</p>
              </div>
            ) : filteredServices.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <h3 className="text-lg font-medium text-gray-900">{t('services.noResults.title')}</h3>
                <p className="mt-2 text-gray-500">
                  {t('services.noResults.description')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredServices.map((service) => (
                  <ServiceCard key={service.id} {...service} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPostForm && (
        <PostServiceForm
          onClose={() => setShowPostForm(false)}
          onSubmit={handlePostService}
        />
      )}
    </div>
  );
}