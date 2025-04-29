import { Facebook, Instagram, Mail, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  className?: string;
}

export const Footer = ({ className = '' }: FooterProps) => {
  const { t } = useTranslation();

  return (
    <footer className={`${className} py-8`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4">
            <a href="tel:+994559390106" className="flex items-center hover:text-white">
              <Phone className="h-5 w-5 mr-2" />
              {t('footer.contact.phone')}
            </a>
            <a href="mailto:support@ellit.az" className="flex items-center hover:text-white">
              <Mail className="h-5 w-5 mr-2" />
              {t('footer.contact.email')}
            </a>
            <a href="/privacy" className="flex items-center hover:text-white">
              {t('footer.privacy')}
            </a>
          </div>
          
          <div className="flex items-center space-x-6">
            <a href="https://www.facebook.com/profile.php?id=61575849291278" className="hover:text-white">
              <Facebook className="h-6 w-6" />
            </a>
            <a href="https://www.instagram.com/ellit.az/" className="hover:text-white">
              <Instagram className="h-6 w-6" />
            </a>
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm">
          <p>{t('footer.rights')}</p>
        </div>
      </div>
    </footer>
  );
};