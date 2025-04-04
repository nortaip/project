import { useTranslation } from 'react-i18next';

export const Privacy = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        {t('privacy.title')}
      </h1>
      
      <div className="prose prose-lg">
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            {t('privacy.collect.title')}
          </h2>
          <p className="text-gray-600 mb-4">
            {t('privacy.collect.content')}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            {t('privacy.use.title')}
          </h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            {t('privacy.use.list', { returnObjects: true }).map((item: string, index: number) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            {t('privacy.security.title')}
          </h2>
          <p className="text-gray-600 mb-4">
            {t('privacy.security.content')}
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            {t('privacy.contact.title')}
          </h2>
          <p className="text-gray-600">
            {t('privacy.contact.content')}{' '}
            <a href={`mailto:${t('privacy.contact.email')}`} className="text-indigo-600 hover:text-indigo-800">
              {t('privacy.contact.email')}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}; 