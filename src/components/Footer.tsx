import { Facebook, Instagram, Mail, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  className?: string;
}

const AZ_CITIES = [
  'Bakı', 'Sumqayıt', 'Gəncə', 'Xırdalan', 'Quba', 'Qəbələ', 'Xaçmaz', 'Şəki',
  'Qusar', 'Mingəçevir', 'Lənkəran', 'İsmayıllı', 'Şirvan', 'Zaqatala',
  'Ağcabədi', 'Ağdam', 'Ağdaş', 'Ağdərə', 'Ağstafa', 'Ağsu', 'Astara',
  'Balakən', 'Beyləqan', 'Bərdə', 'Biləsuvar', 'Cəbrayıl', 'Cəlilabad', 'Culfa',
  'Daşkəsən', 'Füzuli', 'Gədəbəy', 'Goranboy', 'Göyçay', 'Göygöl', 'Göytəpə',
  'Hacıqabul', 'Horadiz', 'İmişli', 'Kəlbəcər', 'Kürdəmir', 'Laçın', 'Lerik',
  'Masallı', 'Nabran', 'Naftalan', 'Naxçıvan', 'Neftçala', 'Oğuz', 'Ordubad',
  'Qax', 'Qazax', 'Qobustan', 'Qubadlı', 'Saatlı', 'Sabirabad', 'Şabran',
  'Şahbuz', 'Salyan', 'Şamaxı', 'Samux', 'Şəmkir', 'Şərur', 'Siyəzən', 'Şuşa',
  'Tərtər', 'Tovuz', 'Ucar', 'Xankəndi', 'Xızı', 'Xocalı', 'Xocavənd', 'Xudat',
  'Yardımlı', 'Yevlax', 'Zəngilan', 'Zərdab'
];

export const Footer = ({ className = '' }: FooterProps) => {
  const { t } = useTranslation();

  return (
    <footer className={`relative bg-gradient-to-br from-indigo-900 to-indigo-800 text-gray-200 shadow-inner pt-10 pb-0 ${className}`}>
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute top-0 left-0 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl -z-10" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-52 h-52 bg-yellow-400/20 rounded-full blur-3xl -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"> {/* Adjusted padding for better responsiveness */}
        {/* Şəhərlər bölümü */}
        <div className="mb-8 md:mb-12 border-b border-indigo-700/30 pb-6"> {/* Added bottom border and more padding */}
          <h2 className="text-xl sm:text-2xl font-bold text-center mb-4 text-indigo-100 tracking-tight drop-shadow-sm">
            {t('footer.cities_title', 'Xidmət göstərdiyimiz şəhərlər')}
          </h2>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 lg:gap-4"> {/* Increased gap on larger screens */}
            {AZ_CITIES.map(city => (
              <span
                key={city}
                className="px-3 py-1 bg-white/10 hover:bg-indigo-600 transition-colors text-sm sm:text-base rounded-full shadow-sm border border-indigo-700/30 m-0.5 cursor-default" // Increased font size for sm screens
              >
                {city}
              </span>
            ))}
          </div>
          <div className="mt-4 text-center text-xs sm:text-sm text-indigo-200 opacity-80"> {/* Increased font size for sm screens */}
            {t('footer.cities_description', 'Bakı, Gəncə, Sumqayıt və Azərbaycanın digər şəhərlərində peşəkar xidmətlər!')}
          </div>
        </div>

        {/* Əsas futer hissəsi (Əlaqə & Sosial) */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-start border-t border-indigo-600/30 pt-8 pb-4 gap-8 md:gap-0">
          {/* Əlaqə məlumatları */}
          <div className="flex flex-col items-center md:items-start gap-3 text-center md:text-left flex-1"> {/* Centered on mobile, left-aligned on md+ */}
            <h3 className="text-lg font-semibold text-indigo-100 mb-2">
              {t('footer.contact_title', 'Bizimlə Əlaqə')}
            </h3>
            <a href="tel:+994559390106" className="flex items-center gap-2 text-indigo-100 hover:text-white transition text-sm sm:text-base">
              <Phone className="h-5 w-5" />
              {t('footer.contact.phone', '+994 55 939 01 06')}
            </a>
            <a href="mailto:support@ellit.az" className="flex items-center gap-2 text-indigo-100 hover:text-white transition text-sm sm:text-base">
              <Mail className="h-5 w-5" />
              {t('footer.contact.email', 'support@ellit.az')}
            </a>
            <a href="/privacy" className="flex items-center gap-2 text-indigo-100 hover:text-white transition text-sm sm:text-base">
              {t('footer.privacy', 'Məxfilik Siyasəti')}
            </a>
          </div>

          {/* Sosial şəbəkələr */}
          <div className="flex flex-col items-center md:items-end gap-4 flex-1 mt-8 md:mt-0"> {/* Adjusted spacing and alignment */}
            <h3 className="text-lg font-semibold text-indigo-100 mb-2">
              {t('footer.social_title', 'Sosial Media')}
            </h3>
            <div className="flex items-center gap-6"> {/* Increased gap for icons */}
              <a href="https://www.facebook.com/profile.php?id=61575849291278" target="_blank" rel="noopener noreferrer" className="hover:scale-110 transition-transform duration-200">
                <span className="bg-white/10 hover:bg-blue-600 transition-colors p-2 rounded-full shadow-lg">
                  <Facebook className="h-6 w-6 text-blue-400" />
                </span>
              </a>
              <a href="https://www.instagram.com/ellit.az/" target="_blank" rel="noopener noreferrer" className="hover:scale-110 transition-transform duration-200">
                <span className="bg-white/10 hover:bg-pink-500 transition-colors p-2 rounded-full shadow-lg">
                  <Instagram className="h-6 w-6 text-pink-400" />
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-6 border-t border-indigo-600/30 text-center text-xs sm:text-sm text-indigo-300 tracking-wide"> {/* Increased font size for sm screens and top border */}
          <p>{t('footer.rights', '© 2023 Bütün hüquqlar qorunur.')}</p>
          <p className="mt-1">
            {t('footer.made_by', 'Sevgi ilə Azərbaycanda hazırlanmışdır.')}
          </p>
        </div>
      </div>
    </footer>
  );
};