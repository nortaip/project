import React, { useState, useEffect } from 'react';
import { Search, Sliders, Plus, AlertCircle } from 'lucide-react';
import { ServiceCard } from '../components/ServiceCard';
import { PostServiceForm, ServiceFormData } from '../components/PostServiceForm';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';

const CATEGORIES = [
  'All Services',
  'Home Cleaning',
  'Plumbing',
  'Electrical',
  'Gardening',
  'Personal Training',
  'Tech Support',
  'Pet Care',
];

export function Services() {
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const initialSearchQuery = searchParams.get('q') || '';
  const initialLocation = searchParams.get('location') || '';
  const initialCategory = searchParams.get('category') || 'All Services';
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

  useEffect(() => {
    // Update filters based on URL parameters when component mounts
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get('q') || '');
    setLocation(params.get('location') || '');
    setSelectedCategory(params.get('category') || 'All Services');
    setPriceRange({
      min: params.get('minPrice') || '',
      max: params.get('maxPrice') || ''
    });
    setRating(params.get('rating') || 'Any rating');
  }, []);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('services')
        .select(`
          *,
          provider:profiles(name, avatar_url)
        `)
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      setServices(data.map(service => ({
        ...service,
        imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'
      })));
    } catch (error) {
      console.error('Error fetching services:', error);
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
    const matchesCategory = selectedCategory === 'All Services' || service.category === selectedCategory;
    const matchesSearch = service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         service.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPrice = (!priceRange.min || service.price >= Number(priceRange.min)) &&
                        (!priceRange.max || service.price <= Number(priceRange.max));
    const matchesRating = rating === 'Any rating' || 
                         (rating === '4+ stars' && service.rating >= 4) ||
                         (rating === '3+ stars' && service.rating >= 3) ||
                         (rating === '2+ stars' && service.rating >= 2);
    return matchesCategory && matchesSearch && matchesPrice && matchesRating;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Service Directory</h1>
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
                  placeholder="Search services..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Categories */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Categories</h2>
              <div className="space-y-2">
                {CATEGORIES.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`w-full text-left px-4 py-2 rounded-lg ${
                      selectedCategory === category
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-gray-900">Filters</h2>
                <Sliders className="h-5 w-5 text-gray-400" />
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Price Range
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      value={priceRange.min}
                      onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                    />
                    <span className="text-gray-500">-</span>
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      value={priceRange.max}
                      onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rating
                  </label>
                  <select 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  >
                    <option>Any rating</option>
                    <option>4+ stars</option>
                    <option>3+ stars</option>
                    <option>2+ stars</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Availability
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
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredServices.map((service) => (
                  <ServiceCard key={service.id} {...service} />
                ))}
              </div>
            )}

            {!loading && filteredServices.length === 0 && (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <h3 className="text-lg font-medium text-gray-900">No services found</h3>
                <p className="mt-2 text-gray-500">Try adjusting your search or filters</p>
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