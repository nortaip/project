import React, { useState, useEffect } from 'react';
import { Search, MapPin, Star, Filter, ChevronDown, Briefcase, Award,  Shield, ArrowRight } from 'lucide-react';
import { ServiceCard } from './ServiceCard';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Service } from '../types';

const CATEGORIES = [
  'All',
  'Cleaning',
  'Plumbing',
  'Electrical',
  'Gardening',
  'Personal Training',
  'Tech Support',
  'Pet Care',
];

export function RandomUsers() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [rating, setRating] = useState('Any rating');
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          provider:profiles(name, avatar_url)
        `)
        .order('rating', { ascending: false })
        .limit(6);

      if (error) throw error;

      setServices(data.map(service => ({
        ...service,
        imageUrl: service.images?.[0] || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80'
      })));
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    const params = new URLSearchParams();

    if (searchQuery) params.append('q', searchQuery);
    if (location) params.append('location', location);
    if (selectedCategory !== 'All') params.append('category', selectedCategory);
    if (priceRange.min) params.append('minPrice', priceRange.min);
    if (priceRange.max) params.append('maxPrice', priceRange.max);
    if (rating !== 'Any rating') params.append('rating', rating);

    navigate({
      pathname: '/services',
      search: params.toString()
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const filteredServices = services.filter(service => {
    const matchesCategory = selectedCategory === 'All' || service.category === selectedCategory;
    const matchesSearch = service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLocation = !location || service.location?.toLowerCase().includes(location.toLowerCase());
    const matchesPrice = (!priceRange.min || service.price >= Number(priceRange.min)) &&
      (!priceRange.max || service.price <= Number(priceRange.max));
    const matchesRating = rating === 'Any rating' ||
      (rating === '4+ stars' && service.rating >= 4) ||
      (rating === '3+ stars' && service.rating >= 3);
    return matchesCategory && matchesSearch && matchesLocation && matchesPrice && matchesRating;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gray-50">
    
      {/* Main content with adjusted margins */}
      <div className="relative z-10"
      >
        {/* Hero Section */}
        <div className="relative bg-gradient-to-r from-indigo-600 to-blue-500 text-white">
          <div className="absolute inset-0 bg-black opacity-50"></div>
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
            <div className="text-center max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                Find Expert Service Providers Near You
              </h1>
              <p className="text-xl mb-8 text-gray-200">
                Connect with trusted professionals for all your service needs
              </p>

              {/* Search Bar */}
              <div className="bg-white rounded-lg shadow-lg p-4">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                      type="text"
                      placeholder="What service are you looking for?"
                      className="w-full pl-10 pr-4 py-3 rounded-lg border-2 border-transparent focus:border-indigo-500 focus:ring-0 transition-colors text-black"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyPress={handleKeyPress}
                    />
                  </div>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                      type="text"
                      placeholder="Location"
                      className="w-full pl-10 pr-4 py-3 rounded-lg border-2 border-transparent focus:border-indigo-500 focus:ring-0 transition-colors text-black"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      onKeyPress={handleKeyPress}
                    />
                  </div>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="bg-gray-100 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-200 flex items-center transition-colors"
                  >
                    <Filter className="h-5 w-5 mr-2" />
                    Filters
                    <ChevronDown className={`h-4 w-4 ml-1 transform transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    onClick={handleSearch}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 flex items-center justify-center transition-colors"
                  >
                    Search
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </button>
                </div>

                {/* Advanced Filters */}
                {showFilters && (
                  <div className="mt-4 p-4 border-t border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Price Range
                        </label>
                        <div className="flex items-center space-x-2">
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                            <input
                              type="number"
                              placeholder="Min"
                              className="w-full pl-8 pr-3 py-2 border-2 border-gray-200 rounded-md focus:border-indigo-500 focus:ring-0 transition-colors text-black"
                              value={priceRange.min}
                              onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                            />
                          </div>
                          <span className="text-gray-500">-</span>
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                            <input
                              type="number"
                              placeholder="Max"
                              className="w-full pl-8 pr-3 py-2 border-2 border-gray-200 rounded-md focus:border-indigo-500 focus:ring-0 transition-colors text-black"
                              value={priceRange.max}
                              onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Rating
                        </label>
                        <select
                          className="w-full px-3 py-2 border-2 border-gray-200 rounded-md focus:border-indigo-500 focus:ring-0 transition-colors text-black"
                          value={rating}
                          onChange={(e) => setRating(e.target.value)}
                        >
                          <option>Any rating</option>
                          <option>4+ stars</option>
                          <option>3+ stars</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Sort By
                        </label>
                        <select className="w-full px-3 py-2 border-2 border-gray-200 rounded-md focus:border-indigo-500 focus:ring-0 transition-colors text-black">
                          <option>Recommended</option>
                          <option>Price: Low to High</option>
                          <option>Price: High to Low</option>
                          <option>Rating</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Categories */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Popular Categories</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`p-4 rounded-xl border-2 transition-all ${selectedCategory === category
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : 'border-gray-200 hover:border-indigo-200 text-gray-600 hover:text-indigo-600'
                    }`}
                >
                  <div className="text-center">
                    <div className="font-medium">{category}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {/* Services Grid */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Featured Services</h2>
              <div className="flex items-center space-x-2 text-gray-500">
                <span>Sort by:</span>
                <select className="border-0 bg-transparent font-medium text-indigo-600 focus:ring-0">
                  <option>Recommended</option>
                  <option>Newest</option>
                  <option>Price: Low to High</option>
                  <option>Price: High to Low</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredServices.map((service) => (
                <ServiceCard key={service.id} {...service} />
              ))}
            </div>

            {filteredServices.length === 0 && (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-lg font-medium text-gray-900">No services found</h3>
                <p className="mt-1 text-gray-500">Try adjusting your search or filters</p>
              </div>
            )}
          </div>

        </div>

        {/* Trust Section */}
        <div className="bg-gray-50 py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose Us</h2>
              <p className="text-lg text-gray-600">We connect you with the best service providers in your area</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
                  <Award className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verified Professionals</h3>
                <p className="text-gray-600">All service providers are thoroughly vetted and verified</p>
              </div>

              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-4">
                  <Shield className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Secure Bookings</h3>
                <p className="text-gray-600">Your payments and personal information are always protected</p>
              </div>

              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 mb-4">
                  <Star className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Quality Service</h3>
                <p className="text-gray-600">Rated and reviewed by our community for quality assurance</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}