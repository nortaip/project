import React from 'react';
import { Users, Shield, Award, Clock, Globe, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const stats = [
  { icon: Users, value: '10K+', key: 'users' },
  { icon: Shield, value: '500+', key: 'providers' },
  { icon: Award, value: '50+', key: 'categories' },
  { icon: Clock, value: '5+', key: 'years' },
];

const values = [
  {
    icon: Shield,
    key: 'trust'
  },
  {
    icon: Globe,
    key: 'reach'
  },
  {
    icon: Phone,
    key: 'support'
  }
];

export const About = () => {
  const { t } = useTranslation();

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-r from-indigo-600 to-blue-500">
        <div className="absolute inset-0 bg-black opacity-50"></div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <h1 className="text-4xl font-bold text-white mb-6">
            {t('about.title')}
          </h1>
          <p className="text-xl text-gray-200 max-w-3xl mx-auto">
            {t('about.subtitle')}
          </p>
        </div>
      </div>

      {/* Stats Section */}
      <div className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.key} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 mb-4">
                  <stat.icon className="h-6 w-6 text-indigo-600" />
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-1">{stat.value}</div>
                <div className="text-sm text-gray-500">{t(`about.stats.${stat.key}`)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Story Section */}
      <div className="py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('about.story.title')}</h2>
            <p className="text-lg text-gray-600">{t('about.story.content')}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {values.map((value) => (
              <div key={value.key} className="bg-white rounded-xl p-6 shadow-sm">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 mb-4">
                  <value.icon className="h-6 w-6 text-indigo-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {t(`about.values.${value.key}.title`)}
                </h3>
                <p className="text-gray-600">{t(`about.values.${value.key}.description`)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('about.contact.title')}</h2>
            <p className="text-lg text-gray-600 mb-8">{t('about.contact.subtitle')}</p>
            <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-6">
              <a 
                href="mailto:contact@servicehub.com"
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
              >
                {t('about.contact.contactUs')}
              </a>
              <a 
                href="/providers"
                className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                {t('about.contact.becomeProvider')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 