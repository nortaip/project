import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslations from './locales/en.json';
import ruTranslations from './locales/ru.json';
import azTranslations from './locales/az.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      az: { translation: azTranslations },
      en: { translation: enTranslations },
      ru: { translation: ruTranslations }
    },
    lng: 'az',
    fallbackLng: 'az',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n; 