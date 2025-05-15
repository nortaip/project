import React, { useState, useEffect, SetStateAction } from 'react';
import { Search, Plus, AlertCircle, Filter } from 'lucide-react';
import { ServiceCard } from '../components/ServiceCard';
import { PostServiceForm, ServiceFormData } from '../components/PostServiceForm';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';

const CATEGORY_KEYS = [
  'all',
  'cleaning',
  'plumbing',
  'electrical',
  'gardening',
  'personaltraining',
  'techsupport',
  'petcare',
  'building',
  'other'
];

// Add at the top, after imports
interface PriceRange {
  min: string;
  max: string;
}

interface FiltersFormProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  priceRange: PriceRange;
  setPriceRange: (value: PriceRange) => void;
  rating: string;
  setRating: (value: string) => void;
  availability: string;
  setAvailability: (value: string) => void;
  t: (key: string) => string;
}

interface ServiceProvider {
  id: string;
  name: string;
  avatar_url: string;
}

interface Service {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  location: string;
  images: string[];
  rating: number;
  reviews_count: number;
  created_at: string;
  provider: ServiceProvider;
}

function FiltersForm({
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  priceRange,
  setPriceRange,
  rating,
  setRating,
  availability,
  setAvailability,
  t
}: FiltersFormProps) {
  return (
    <>
      {/* Search */}
      <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
          <input
            type="text"
            placeholder={t('home.search.placeholder')}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      {/* Categories */}
      <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-4">
        <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-4">
          {t('services.categories.title')}
        </h2>
        <div className="space-y-2">
          {CATEGORY_KEYS.map((categoryKey) => (
            <button
              key={categoryKey}
              onClick={() => setSelectedCategory(categoryKey)}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm ${selectedCategory === categoryKey
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
      <div className="bg-white rounded-lg shadow p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base sm:text-lg font-medium text-gray-900">{t('services.filters.title')}</h2>
          <Filter className="h-5 w-5 text-gray-400" />
        </div>
        <div className="space-y-4">
          {/* Price Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('services.filters.price.title')}
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₼</span>
                <input
                  type="number"
                  placeholder={t('services.filters.price.min')}
                  className="w-full pl-8 pr-3 py-2 border rounded-md text-sm"
                  value={priceRange.min}
                  onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                />
              </div>
              <span className="hidden sm:inline text-gray-500">-</span>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₼</span>
                <input
                  type="number"
                  placeholder={t('services.filters.price.max')}
                  className="w-full pl-8 pr-3 py-2 border rounded-md text-sm"
                  value={priceRange.max}
                  onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                />
              </div>
            </div>
          </div>
          {/* Rating Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('services.filters.rating.title')}
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            >
              <option>{t('services.filters.rating.any')}</option>
              <option>{t('services.filters.rating.fourPlus')}</option>
              <option>{t('services.filters.rating.threePlus')}</option>
            </select>
          </div>
          {/* Availability Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('services.filters.availability.title')}
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
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
    </>
  );
}

export function Services() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const initialSearchQuery = searchParams.get('q') || '';
  const initialLocation = searchParams.get('location') || '';
  const initialCategory = searchParams.get('category') || 'all';
  const initialMinPrice = searchParams.get('minPrice') || '';
  const initialMaxPrice = searchParams.get('maxPrice') || '';
  const initialRating = searchParams.get('rating') || 'Any rating';
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [location, setLocation] = useState(initialLocation);
  const [showPostForm, setShowPostForm] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [priceRange, setPriceRange] = useState({ min: initialMinPrice, max: initialMaxPrice });
  const [rating, setRating] = useState(initialRating);
  const [availability, setAvailability] = useState('Any time');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get('q') || '');
    setLocation(params.get('location') || '');
    setSelectedCategory(params.get('category') || 'all');
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
          provider:profiles!services_provider_id_fkey (
            id,
            name,
            avatar_url
          )
        `)
        ;
      if (error) throw error;
      const formattedServices: Service[] = data.map((service: any) => ({
        id: service.id,
        title: service.title,
        description: service.description,
        price: service.price,
        category: service.category,
        location: service.location,
        images: service.images,
        rating: service.rating,
        reviews_count: service.reviews_count,
        created_at: service.created_at,
        provider: {
          id: service.provider.id,
          name: service.provider.name,
          avatar_url: service.provider.avatar_url,
        },
      }));
      setServices(formattedServices);
    } catch (error) {
      setError(error as SetStateAction<null>);
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(service => {
    const matchesCategory = selectedCategory === 'all' || service.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch = !searchQuery ||
      service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLocation = !location ||
      service.location.toLowerCase().includes(location.toLowerCase());
    const matchesPrice = (!priceRange.min || service.price >= Number(priceRange.min)) &&
      (!priceRange.max || service.price <= Number(priceRange.max));
    const matchesRating = rating === 'Any rating' ||
      (rating === '4+ stars' && service.rating >= 4) ||
      (rating === '3+ stars' && service.rating >= 3);
    return matchesCategory && matchesSearch && matchesLocation && matchesPrice && matchesRating;
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  function handlePostService(serviceData: ServiceFormData): Promise<void> {
    throw new Error('Function not implemented.');
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8">
      <div className="max-w-6xl mx-auto px-2 sm:px-4 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-4">
          {/* Desktop Sidebar */}
          <div className="hidden lg:block w-full lg:w-72 flex-shrink-0 space-y-6 sticky top-6 self-start z-10">
            <FiltersForm
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              rating={rating}
              setRating={setRating}
              availability={availability}
              setAvailability={setAvailability}
              t={t}
            />
          </div>
          {/* Mobile/Tablet Filters Button */}
          <div className="lg:hidden mb-4">
            <button
              className="w-full px-4 py-2 bg-indigo-200 text-black rounded-md shadow"
              onClick={() => setShowMobileFilters(true)}
            >
              Ətraflı axtar
            </button>
          </div>
          {/* Mobile/Tablet Filters Modal/Drawer */}
          {showMobileFilters && (
            <div className="h-['200px'] inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
              <div className="bg-white rounded-lg shadow-lg w-full  max-w-md mx-auto p-6 relative">
                <button
                  type="button"
                  aria-label="Close filters"
                  className="absolute top-2 right-2 text-gray-500 text-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onClick={() => setShowMobileFilters(false)}
                >
                  &times;
                </button>
                <FiltersForm
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  selectedCategory={selectedCategory}
                  setSelectedCategory={setSelectedCategory}
                  priceRange={priceRange}
                  setPriceRange={setPriceRange}
                  rating={rating}
                  setRating={setRating}
                  availability={availability}
                  setAvailability={setAvailability}
                  t={t}
                />
              </div>
            </div>
          )}
          {/* Right Content - Service Cards */}
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t('services.title')}</h1>
              {user?.user_metadata.role === 'provider' && (
                <button
                  onClick={() => window.location.href = '/post-service'}
                  className="mt-2 sm:mt-0 inline-flex items-center w-full sm:w-auto justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-700"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Servis paylaş
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
            {loading ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
            ) : filteredServices.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <h3 className="text-lg font-medium text-gray-900">{t('services.noResults.title')}</h3>
                <p className="mt-2 text-gray-500">
                  {t('services.noResults.description')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
                {filteredServices.map(service => (
                  <ServiceCard packages={[]} provider_id={''} key={service.id} {...service} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {showPostForm &&
        <PostServiceForm
          onClose={() => setShowPostForm(false)}
          onSubmit={handlePostService}
        />
      }
    </div>
  );
}