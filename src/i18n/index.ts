import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import azTranslations from './locales/az.json';
import ruTranslations from './locales/ru.json';
import enTranslations from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      az: { translation: azTranslations },
      en: { translation: enTranslations },
      ru: { translation: ruTranslations },
    },
    fallbackLng: 'az',
    supportedLngs: ['az', 'ru', 'en'],
    nonExplicitSupportedLngs: true, // 'az-AZ' → 'az'
    detection: {
      // 1) localStorage  2) navigator (browser language)  3) html lang attr
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

// Sync HTML lang attribute on language change (SEO + accessibility)
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
});

export default i18n;
