import { Star, MapPin, Briefcase, Award, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ProviderCardProps {
  id: string;
  name: string;
  title: string;
  rating: number;
  reviewCount: number;
  location: string;
  experience: string;
  specialties: string[];
  imageUrl: string;
  verified: boolean;
  email: string;
}

export function ProviderCard({
  id,
  name,
  title,
  rating,
  reviewCount,
  location,
  experience,
  specialties,
  imageUrl,
  verified,
}: ProviderCardProps) {
  const navigate = useNavigate();

  const handleViewProfile = () => {
    navigate(`/provider/${id}`);
  };

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <div className="p-6">
        <div className="flex items-start space-x-4">
          <img
            src={imageUrl}
            alt={name}
            className="h-20 w-20 rounded-full object-cover"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{name}</h3>
                <p className="text-gray-600">{title}</p>
              </div>
              {verified && (
                <Award className="h-6 w-6 text-blue-500" aria-label="Verified Provider" />
              )}
            </div>
            <div className="flex items-center mt-2">
              <Star className="h-5 w-5 text-yellow-400 fill-current" />
              <span className="ml-1 text-gray-900 font-medium">{Number(rating ?? 0).toFixed(1)}</span>
              <span className="mx-1 text-gray-500">·</span>
              <span className="text-gray-500">{reviewCount} rəy</span>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center text-gray-600">
            <MapPin className="h-4 w-4 mr-2" />
            <span>{location}</span>
          </div>
          <div className="flex items-center text-gray-600">
            <Briefcase className="h-4 w-4 mr-2" />
            <span>{experience}</span>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {specialties.map((specialty, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
              >
                {specialty}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex space-x-3">
          <button
            onClick={handleViewProfile}
            className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Profilə bax
          </button>
          <button
            onClick={() => navigate('/order')}
            className="flex items-center justify-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            <ShoppingBag className="h-4 w-4" />
            Sifariş ver
          </button>
        </div>
      </div>
    </div>
  );
}
