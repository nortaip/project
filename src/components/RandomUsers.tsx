import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Award, Shield, ArrowRight, Home, Wrench, Zap, Flower2, Dumbbell, MonitorSmartphone, Cat, LayoutGrid, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Kateqoriyalar və onların ikonları
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

const CATEGORY_ICONS: { [key: string]: React.ComponentType } = {
  'All': LayoutGrid,
  'Cleaning': Home,
  'Plumbing': Wrench,
  'Electrical': Zap,
  'Gardening': Flower2,
  'Personal Training': Dumbbell,
  'Tech Support': MonitorSmartphone,
  'Pet Care': Cat,
};

// Hər kateqoriya üçün illüstrasiya şəkilləri (Unsplash-dan nümunələr)
const CATEGORY_IMAGES: { [key: string]: string } = {
  'All': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3xqh9rfsdstnfqdn8nqtw6%2F1749257329_img_2.webp?st=2025-06-06T23%3A37%3A07Z&se=2025-06-13T00%3A37%3A07Z&sks=b&skt=2025-06-06T23%3A37%3A07Z&ske=2025-06-13T00%3A37%3A07Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=%2BqzMD5m5CbvXxcPCU5OU0qNJsqg%2FZfunzDyoHeFgaR4%3D&az=oaivgprodscus', // Ümumi Xidmətlər
  'Cleaning': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3x0wkafc7b1xd4zamcr86h%2F1749256589_img_2.webp?st=2025-06-06T22%3A42%3A12Z&se=2025-06-12T23%3A42%3A12Z&sks=b&skt=2025-06-06T22%3A42%3A12Z&ske=2025-06-12T23%3A42%3A12Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=vwTRlWU2wtqPb2hakOBkNNv3aPsJEkGLoVPEXzYLr6U%3D&az=oaivgprodscus', // Təmizlik
  'Plumbing': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx5q60jwez3r2hg5m09qxpwr%2F1749317586_img_2.webp?st=2025-06-07T16%3A07%3A15Z&se=2025-06-13T17%3A07%3A15Z&sks=b&skt=2025-06-07T16%3A07%3A15Z&ske=2025-06-13T17%3A07%3A15Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=u%2BegtEvWHz40ubjp%2BsEFWi%2FGzEJaqhda5uDwx%2FPK8kQ%3D&az=oaivgprodscus', // Santexnika
  'Electrical': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3wx759fhsshs1e3mq895nd%2F1749256464_img_3.webp?st=2025-06-06T22%3A43%3A44Z&se=2025-06-12T23%3A43%3A44Z&sks=b&skt=2025-06-06T22%3A43%3A44Z&ske=2025-06-12T23%3A43%3A44Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=i9igCI%2Bg9LbDoxzL1UCoEa%2FD9XTvAZnnjIHeNII2zWc%3D&az=oaivgprodscus', // Elektrik
  'Gardening': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3x7vc3edc9c2s6f0yxtazk%2F1749256822_img_1.webp?st=2025-06-06T23%3A38%3A35Z&se=2025-06-13T00%3A38%3A35Z&sks=b&skt=2025-06-06T23%3A38%3A35Z&ske=2025-06-13T00%3A38%3A35Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=QPKrMI4tgQ4%2Bf4n%2Fm9LeTrCTpuPqOnrQX7Z7%2F4XOGIU%3D&az=oaivgprodscus', // Bağçılıq
  'Personal Training': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3xba1jfvzsmee3g103zs39%2F1749256929_img_1.webp?st=2025-06-06T23%3A35%3A54Z&se=2025-06-13T00%3A35%3A54Z&sks=b&skt=2025-06-06T23%3A35%3A54Z&ske=2025-06-13T00%3A35%3A54Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=IhIeWBw2XM8g%2BBlbjIQX1zOZj6n2r%2FhQCN05VQRtHzk%3D&az=oaivgprodscus', // Fərdi Təlim
  'Tech Support': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3xhhgmfkjva6cwsd0d9wya%2F1749257130_img_0.webp?st=2025-06-06T23%3A37%3A12Z&se=2025-06-13T00%3A37%3A12Z&sks=b&skt=2025-06-06T23%3A37%3A12Z&ske=2025-06-13T00%3A37%3A12Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=gRmKlW40PSRnu0e253HhHhRRzPObVt2zjrXQPoujqRc%3D&az=oaivgprodscus', // Texniki Dəstək
  'Pet Care': 'https://videos.openai.com/vg-assets/assets%2Ftask_01jx3xm6rwfs68x97w3xtvpgzp%2F1749257219_img_2.webp?st=2025-06-06T23%3A38%3A35Z&se=2025-06-13T00%3A38%3A35Z&sks=b&skt=2025-06-06T23%3A38%3A35Z&ske=2025-06-13T00%3A38%3A35Z&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skoid=8ebb0df1-a278-4e2e-9c20-f2d373479b3a&skv=2019-02-02&sv=2018-11-09&sr=b&sp=r&spr=https%2Chttp&sig=S9d%2BENC8%2FU%2FPK7E6AKMvtTaLqzkwNLD2SLF80nhwoRw%3D&az=oaivgprodscus', // Ev Heyvanı Baxımı
};

export function RandomUsers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    setLoading(false);
  }, []);

  const handleCategoryChange = (category: string) => {
    navigate(`/services?category=${category}`);
  };


  const getCategoryKey = (category: string) => {
    switch (category) {
      case 'Personal Training': return 'personalTraining';
      case 'Tech Support': return 'techSupport';
      case 'Pet Care': return 'petCare';
      case 'Cleaning': return 'cleaning';
      case 'Plumbing': return 'plumbing';
      case 'Electrical': return 'electrical';
      case 'Gardening': return 'gardening';
      case 'All': return 'all';
      default: return category.toLowerCase();
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
      {/* Hero Section */}
      <div
        className="relative bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${CATEGORY_IMAGES['All']})`,
          minHeight: '500px',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 to-black/50"></div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-white flex flex-col items-center justify-center h-full">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-extrabold mb-6 animate-fade-in-down">
              {t('home.title')}
            </h1>
            <p className="text-xl mb-8 text-gray-200 animate-fade-in-up">
              {t('home.subtitle')}
            </p>
            <button
              type="submit"
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors duration-300 flex items-center justify-center gap-2 font-semibold"
            >
              <Search size={20} /> {t('home.searchButton')}
            </button>

          </div>
        </div>
      </div>

      {/* Category Visualizations (Modified to resemble service cards) */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
          {t('home.exploreCategories')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category];
            const imageUrl = CATEGORY_IMAGES[category];
            const categoryKey = getCategoryKey(category);

            return (
              <button
                key={category}
                onClick={() => handleCategoryChange(category)}
                className="block w-full bg-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 group overflow-hidden"
              >
                <div className="relative w-full h-40 md:h-48 overflow-hidden">
                  <img
                    src={imageUrl}
                    alt={category}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {/* Optional: Add a subtle overlay on hover for visual effect, similar to service cards */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
                <div className="p-4 flex items-center justify-between text-gray-900">
                  <div className="flex items-center gap-2">
                    {Icon && <Icon />}
                    <span className="text-lg font-semibold">
                      {t(`services.categories.${categoryKey}`)}
                    </span>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-500 group-hover:text-indigo-600 transition-colors duration-300" />
                </div>
              </button>
            );
          })}
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
            <div className="bg-white rounded-xl p-6 text-center shadow-md">
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

            <div className="bg-white rounded-xl p-6 text-center shadow-md">
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

            <div className="bg-white rounded-xl p-6 text-center shadow-md">
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
  );
}