import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, Shield, ArrowRight, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SEO, organizationJsonLd } from './SEO';
import AllC from '../assets/all-BlFMVmX-.png.png';
import Clearnin from '../assets/cleaning.png';
import Plumb from '../assets/plumbing.png';
import Elektr from '../assets/electrical.png';
import Personal from '../assets/personal.png';
import Auto from '../assets/20250623_0727_Avtomobil.png';
import Tech from '../assets/tech.png';
import Pet from '../assets/pet.png';
import Spa from '../assets/20250623_0730_Rahatlatıcı.png';
// Kateqoriyalar və onların ikonları
const CATEGORIES = [
  'All',
  'Avtomobil təmiri',
  'Gözəllik və Sağlamlıq',
  'İT, Biznes xidmətləri',
  'Təmir və Tikinti',
  'Ev işləri',
  'Şəxsi Məşqçi',
  'Məişət texnikası',
];

// Hər kateqoriya üçün illüstrasiya şəkilləri (Unsplash-dan nümunələr)
const CATEGORY_IMAGES: { [key: string]: string } = {
  'All': AllC,   // Öz şəkil dəyərlərini qoy
  'Avtomobil təmiri': Auto,
  'Gözəllik və Sağlamlıq': Spa,
  'İT, Biznes xidmətləri': Tech,
  'Təmir və Tikinti': Elektr,
  'Baytar': Pet,
  'Ev işləri': Clearnin,
  'Məişət texnikası': Plumb,
  'Şəxsi Məşqçi': Personal,
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
      case 'Avtomobil xidmətləri': return 'Avtomobil xidmətləri';
      case 'Avtomobil təmiri': return 'Avtomobil təmiri';
      case 'Gözəllik və Sağlamlıq': return 'Gözəllik və Sağlamlıq';
      case 'İT, Biznes xidmətləri': return 'İT, Biznes xidmətləri';
      case 'Təmir və Tikinti': return 'Təmir və Tikinti';
      case 'Reklam və Dizayn': return 'Reklam və Dizayn';
      case 'Şəxsi Məşqçi': return 'Şəxsi Məşqçi';
      case 'Məişət texnikası': return 'Məişət texnikası';
      case 'Dezinfeksiya xidməti': return 'Dezinfeksiya xidməti';
      default: return category; // Digərləri olduğu kimi qaytar

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
      <SEO
        canonical="https://ellit.az/"
        jsonLd={organizationJsonLd()}
        alternates={[
          { lang: 'az', href: 'https://ellit.az/' },
          { lang: 'ru', href: 'https://ellit.az/ru/' },
          { lang: 'en', href: 'https://ellit.az/en/' },
          { lang: 'x-default', href: 'https://ellit.az/' },
        ]}
      />
      {/* Hero Section */}
      <div
        className="relative bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${CATEGORY_IMAGES['All']})`,
          minHeight: '500px',
        }}
      >
        {/* Arxa plan şəklinin üzərində qaranlıq örtük (overlay) əlavə edirik */}
        <div className="absolute inset-0 bg-black opacity-50"></div>

        {/* Kontent konteyneri */}
        <div className="relative z-10 text-center max-w-3xl mx-auto flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
          {/* Başlıq */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-4 sm:mb-6 text-white animate-fade-in-down">
            {t('home.title')} {/* Tərcümə edilmiş başlıq */}
          </h1>
          {/* Alt-başlıq (paragraf) */}
          <p className="text-base sm:text-lg md:text-xl mb-6 sm:mb-8 text-gray-200 animate-fade-in-up leading-relaxed">
            {t('home.subtitle')} {/* Tərcümə edilmiş alt-başlıq */}
          </p>
          {/* Düymə */}
          <button
            onClick={() => navigate('/services')}
            className="bg-indigo-600 text-white px-8 py-4 rounded-full hover:bg-indigo-700 transition-colors duration-300 flex items-center justify-center gap-2 font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-transform w-full sm:w-auto"
            aria-label="Servis axtar"
          >
            Servis axtar
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
            </svg>
          </button>
        </div>
      </div>

      {/* Category Visualizations (Modified to resemble service cards) */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
          {t('services.categories.title')} – {t('home.title')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {CATEGORIES.map((category) => {
            const imageUrl = CATEGORY_IMAGES[category];
            const categoryKey = getCategoryKey(category);

            return (
              <article key={category} className="block w-full bg-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 group overflow-hidden">
                <button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className="block w-full bg-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 group overflow-hidden"
                >
                  <div className="relative w-full h-40 md:h-48 overflow-hidden">
                    <img
                      loading="lazy"
                      src={imageUrl}
                      alt={category}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {/* Optional: Add a subtle overlay on hover for visual effect, similar to service cards */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </div>
                  <div className="p-4 flex items-center justify-between text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">
                        {t(`${categoryKey}`)}
                      </span>
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-500 group-hover:text-indigo-600 transition-colors duration-300" />
                  </div>
                </button>
              </article>
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