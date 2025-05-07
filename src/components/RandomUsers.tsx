import React, { useState, useEffect } from 'react';
import { Search, MapPin, Star, Filter, ChevronDown, Briefcase, Award, Shield, ArrowRight, Home, Wrench, Zap, Flower2, Dumbbell, MonitorSmartphone, Cat, LayoutGrid } from 'lucide-react';
import { ServiceCard } from './ServiceCard';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Service } from '../types';
import { useTranslation } from 'react-i18next';

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

// Add default background image URL at the top
const DEFAULT_BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1684&q=80';

// Add category icons mapping
const CATEGORY_ICONS: { [key: string]: React.ComponentType } = {
  'All': LayoutGrid,
  'Cleaning': Home,
  'Plumbing': Wrench,
  'Electrical': Zap,
  'Gardening': Flower2,
  'Personal Training': Dumbbell,
  'Tech Support': MonitorSmartphone,
  'Pet Care': Cat,
  'Building': Wrench,
  'Other': Wrench,
};

export function RandomUsers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [rating, setRating] = useState('Any rating');
  const [backgroundImage, setBackgroundImage] = useState(DEFAULT_BACKGROUND_IMAGE);
  const [services, setServices] = useState<Service[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('recommended');

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

      console.log('Fetched services:', data); // Debugging: Log fetched data

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

  const fetchImages = async (category: string) => {
    const accessKey = 'xk-vy_pmd25Tw2SVV6wJZbEpqjEor7rM9-qoAWwj2Kw'; // Replace with your Unsplash access key
    const query = category === 'All' ? 'service' : category; // Use a general query for "All"

    try {
      const response = await fetch(`https://api.unsplash.com/search/photos?query=${query}&client_id=${accessKey}&per_page=1`);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const imageUrl = data.results[0].urls.regular; // Get the regular size image URL
        setBackgroundImage(imageUrl); // Set the background image
      }
    } catch (error) {
      console.error('Error fetching image from Unsplash:', error);
    }
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);

    // Fetch a single image based on the selected category
    fetchImages(category);
  };

  const getSortedServices = (services: Service[]) => {
    switch (sortBy) {
      case 'newest':
        return [...services].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      case 'price_low':
        return [...services].sort((a, b) => 
          (a.packages?.[0]?.price || a.price) - (b.packages?.[0]?.price || b.price)
        );
      case 'price_high':
        return [...services].sort((a, b) => 
          (b.packages?.[0]?.price || b.price) - (a.packages?.[0]?.price || a.price)
        );
      case 'rating':
        return [...services].sort((a, b) => b.rating - a.rating);
      default:
        return services; // 'recommended' - keep original order
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

  console.log('Filtered services:', filteredServices); // Debugging: Log filtered services

  // Update the category key generation
  const getCategoryKey = (category: string) => {
    switch (category) {
      case 'Personal Training':
        return 'personalTraining';
      case 'Tech Support':
        return 'techSupport';
      case 'Pet Care':
        return 'petCare';
      default:
        return category.toLowerCase();
    }
  };

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
        <div 
          className="relative" 
          style={{ 
            backgroundImage: `url(${backgroundImage || DEFAULT_BACKGROUND_IMAGE})`, 
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 to-black/50"></div>
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-white">
            <div className="text-center max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                {t('home.title')}
              </h1>
              <p className="text-xl mb-8 text-gray-200">
                {t('home.subtitle')}
              </p>

              {/* Categories */}
              <div className="mb-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {CATEGORIES.map((category) => {
                    const Icon = CATEGORY_ICONS[category];
                    const categoryKey = getCategoryKey(category);
                    return (
                      <button
                        key={category}
                        onClick={() => handleCategoryChange(category)}
                        className={`p-4 rounded-xl border-2 transition-all backdrop-blur-sm ${
                          selectedCategory === category
                            ? 'border-indigo-600 bg-indigo-600/20 text-white'
                            : 'border-white/30 hover:border-white text-white/90 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <div className="text-center flex flex-col items-center gap-2">
                          <Icon className="w-6 h-6" />
                          <div className="font-medium">
                            {t(`services.categories.${categoryKey}`)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

          {/* Display Images */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {images.map((imageUrl, index) => (
              <img key={index} src={imageUrl} alt={`Image for ${selectedCategory}`} className="w-full h-auto rounded-lg" />
            ))}
          </div>
          {/* Services Grid */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                {t('home.featured.title')}
              </h2>
              <div className="flex items-center space-x-2 text-gray-500">
                <span>{t('home.featured.sortBy')}:</span>
                <select 
                  className="border-0 bg-transparent font-medium text-indigo-600 focus:ring-0"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="recommended">{t('home.featured.recommended')}</option>
                  <option value="newest">{t('home.featured.newest')}</option>
                  <option value="price_low">{t('home.featured.priceLowHigh')}</option>
                  <option value="price_high">{t('home.featured.priceHighLow')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {getSortedServices(filteredServices).map((service) => (
                <ServiceCard 
                  key={service.id}
                  id={service.id}
                  title={service.title}
                  price={service.price}
                  rating={service.rating}
                  location={service.location}
                  category={service.category}
                  imageUrl={service.imageUrl || service.images?.[0] || ''}
                  images={service.images || []}
                  packages={service.packages || []}
                  provider_id={service.provider_id}
                  provider={service.provider}
                  reviews_count={service.reviews_count}
                />
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
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                {t('home.trust.title')}
              </h2>
              <p className="text-lg text-gray-600">
                {t('home.trust.subtitle')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
                  <Award className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t('home.trust.verified.title')}
                </h3>
                <p className="text-gray-600">
                  {t('home.trust.verified.description')}
                </p>
              </div>

              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-4">
                  <Shield className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t('home.trust.secure.title')}
                </h3>
                <p className="text-gray-600">
                  {t('home.trust.secure.description')}
                </p>
              </div>

              <div className="bg-white rounded-xl p-6 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 mb-4">
                  <Star className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t('home.trust.quality.title')}
                </h3>
                <p className="text-gray-600">
                  {t('home.trust.quality.description')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}