import React, { useState, useEffect } from 'react';
import { Search, Sliders, MapPin, Loader, AlertCircle } from 'lucide-react';
import { ProviderCard } from '../components/ProviderCard';
import { supabase } from '../lib/supabase';

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
}

export function Providers() {
  const [selectedSpecialty, setSelectedSpecialty] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'provider')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform the data to match the ProviderCard component props
      const formattedProviders = data.map(provider => ({
        id: provider.id,
        name: provider.name || 'Unknown Provider',
        title: provider.company || 'Service Provider',
        rating: 4.8, // Default rating since we don't have real ratings yet
        reviewCount: Math.floor(Math.random() * 100) + 10, // Random review count for demo
        location: provider.address || 'Location not specified',
        experience: provider.experience ? `${provider.experience} years experience` : '1+ years experience',
        specialties: provider.specialties || ['General Services'],
        imageUrl: provider.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(provider.name || 'Provider')}&background=random`,
        verified: true, // All providers are verified for demo
        email: provider.email || ''
      }));

      setProviders(formattedProviders);
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

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Expert Service Providers</h1>
            <p className="text-lg text-gray-600">Connect with trusted professionals in your area</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search providers..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Location..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
              <Sliders className="h-5 w-5 mr-2" />
              More Filters
            </button>
          </div>
        </div>

        <div className="mb-8 overflow-x-auto">
          <div className="flex space-x-4 pb-4">
            {SPECIALTIES.map((specialty) => (
              <button
                key={specialty}
                className={`px-4 py-2 rounded-full whitespace-nowrap ${
                  selectedSpecialty === specialty
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedSpecialty(specialty)}
              >
                {specialty}
              </button>
            ))}
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
          <div className="flex justify-center items-center py-12">
            <Loader className="h-8 w-8 text-indigo-600 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredProviders.map((provider) => (
              <ProviderCard key={provider.id} {...provider} />
            ))}
          </div>
        )}

        {!loading && filteredProviders.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900">No providers found</h3>
            <p className="mt-2 text-gray-500">Try adjusting your search criteria</p>
          </div>
        )}
      </div>
    </div>
  );
}