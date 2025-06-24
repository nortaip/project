import React, { useState, useEffect } from 'react';
import { Search, Sliders, MapPin, Loader, AlertCircle, Filter, Star, ChevronDown, Briefcase, Clock } from 'lucide-react';
import { ProviderCard } from '../components/ProviderCard';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const SPECIALTIES = [
  'All',
  'Home Cleaning',
  'Plumbing',
  'Electrical',
  'Gardening',
  'Personal Training',
  'Tech Support',
  'Pet Care',
];

interface Provider {
  [x: string]: any;
  id: string;
  name: string;
  title?: string;
  rating: number;
  reviewCount: number;
  location: string;
  experience: string;
  specialties: string[];
  imageUrl: string;
  verified: boolean;
  email: string;
  completed_jobs: number;
}

export function Providers() {
  const { t } = useTranslation();
  const [selectedSpecialty, setSelectedSpecialty] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [rating, setRating] = useState(t('providers.filters.rating.any'));
  const [availability, setAvailability] = useState(t('providers.filters.availability.any'));

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, company_name, address, experience_years, specialties, avatar_url,is_verified, email, role, rating')
        .eq('role', 'provider')
        .order('rating', { ascending: false });

      if (error) throw error;

      // Transform the data to match the ProviderCard component props
      const formattedProviders = data.map(provider => ({
        id: provider.id,
        name: provider.name || 'Unknown Provider',
        title: provider.company_name || 'Service Provider',
        rating: provider.rating, // Default rating since we don't have real ratings yet
        location: provider.address || 'Location not specified',
        experience: provider.experience_years ? `${provider.experience_years}` : '??',
        specialties: provider.specialties || ['General Services'],
        imageUrl: provider.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(provider.name || 'Provider')}&background=random`,
        verified: provider.is_verified, // All providers are verified for demo
        email: provider.email || '',
      }));

      setProviders(formattedProviders.map(provider => ({
        ...provider,
        reviewCount: 0, // Default value since we don't have real review counts yet
        completed_jobs: 0 // Default value since we don't have real completed jobs data yet
      })));
    } catch (error) {
      console.error('Error fetching providers:', error);
      setError('Failed to load providers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredProviders = providers.filter(provider => {
    const matchesSpecialty = selectedSpecialty === 'All' ||
      (provider.specialties && provider.specialties.some(s =>
        s.toLowerCase().includes(selectedSpecialty.toLowerCase())));
    const matchesSearch = provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (provider.title && provider.title.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesLocation = !location ||
      (provider.location && provider.location.toLowerCase().includes(location.toLowerCase()));
    return matchesSpecialty && matchesSearch && matchesLocation;
  });

  // Sort providers: verified first, then by rating descending (handling null ratings)
  const sortedProviders = filteredProviders.sort((a, b) => {
    // Verified providers come first (true > false)
    const verifiedComparison = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
    if (verifiedComparison !== 0) {
      return verifiedComparison;
    }

    // If verified status is the same, sort by rating descending
    // Treat null ratings as lower than any number
    const ratingA = a.rating === null ? -Infinity : a.rating;
    const ratingB = b.rating === null ? -Infinity : b.rating;
    return ratingB - ratingA;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          {t('providers.title')}
        </h1>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder={t('providers.search.placeholder')}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder={t('providers.search.location')}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
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
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        ) : providers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedProviders.map((provider) => (
              <div
                key={provider.id}
                className={`bg-white rounded-lg shadow-sm p-6 border-2 ${provider.verified ? 'border-blue-500' : 'border-gray-300'}`}
              >
                <div className="flex justify-end mb-2">
                  {provider.verified ? (
                    <span className="text-xs text-white bg-green-500 px-2 py-1 rounded font-semibold">Təsdiq edildi</span>
                  ) : (
                    <span className="text-xs text-white bg-gray-400 px-2 py-1 rounded">Təsdiqlənməyib</span>
                  )}
                </div>
                <div className="flex items-start">
                  <img
                    src={provider.imageUrl}
                    alt={provider.name}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">{provider.name}</h3>
                    <p className="text-sm text-gray-500">{provider.title}</p>
                    {/* Rating göstərimi */}
                    <div className="flex items-center mt-1">
                      <Star className="h-4 w-4 text-yellow-400 mr-1" fill="#FACC15" stroke="#FACC15" />
                      <span className="text-sm font-semibold text-gray-700">{provider.rating ?? 0}</span>
                      <span className="ml-1 text-xs text-gray-400">/ 5</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-lg font-medium text-gray-900">
              {t('providers.noResults.title')}
            </h3>
            <p className="mt-1 text-gray-500">
              {t('providers.noResults.description')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}