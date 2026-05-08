import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, PageContainer } from '../components/ui';
import { SEO } from '../components/SEO';

export const Privacy = () => {
  const { t } = useTranslation();

  return (
    <PageContainer size="md" className="py-10">
      <SEO
        title="Məxfilik Siyasəti"
        description="Ellit.az şəxsi məlumatlarınızı necə toplayır, saxlayır və qoruyur."
        canonical="https://ellit.az/privacy"
      />
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto rounded-[20px] flex items-center justify-center text-white shadow-brand-soft bg-gradient-to-br from-brand-600 to-accent-500">
          <Shield size={32} strokeWidth={2.5} />
        </div>
        <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold text-ink tracking-tight">
          {t('privacy.title') || 'Məxfilik Siyasəti'}
        </h1>
        <p className="mt-2 text-muted">
          Sonuncu yenilənmə: {new Date().toLocaleDateString('az')}
        </p>
      </div>

      <Card variant="default" padding="lg" className="prose prose-sm max-w-none">
        <Section
          title={t('privacy.sections.intro.title') || 'Giriş'}
          body={
            t('privacy.sections.intro.body') ||
            'Ellit.az olaraq biz istifadəçilərimizin şəxsi məlumatlarının qorunmasına xüsusi diqqət yetiririk. Bu siyasət hansı məlumatları topladığımızı, necə istifadə etdiyimizi və qoruduğumuzu izah edir.'
          }
        />

        <Section
          title={t('privacy.sections.collect.title') || 'Topladığımız məlumatlar'}
          body={
            t('privacy.sections.collect.body') ||
            'Qeydiyyat zamanı: ad, telefon, email. Sifariş zamanı: ünvan, ödəniş məlumatları (Epoint vasitəsilə birbaşa banka ötürülür, bizdə saxlanmır). İstifadə zamanı: cihaz tipi, brauzer, IP ünvan (təhlükəsizlik üçün).'
          }
        />

        <Section
          title={t('privacy.sections.use.title') || 'Məlumatların istifadəsi'}
          body={
            t('privacy.sections.use.body') ||
            'Sifarişləri emal etmək, müştəri dəstəyi göstərmək, xidməti yaxşılaşdırmaq və qanuni öhdəliklərə cavab vermək üçün istifadə edirik. Üçüncü tərəflərə kommersiya məqsədilə satmırıq.'
          }
        />

        <Section
          title={t('privacy.sections.security.title') || 'Təhlükəsizlik'}
          body={
            t('privacy.sections.security.body') ||
            'Bütün məlumatlar şifrələnmiş kanallar (HTTPS/TLS) ilə ötürülür. Verilənlər bazası RLS (Row Level Security) ilə qorunur — yalnız sənin məlumatına yalnız sən və icazə verdiyin sistem hissələri çata bilər. Parollar one-way hash ilə saxlanılır.'
          }
        />

        <Section
          title={t('privacy.sections.rights.title') || 'Sənin hüquqların'}
          body={
            t('privacy.sections.rights.body') ||
            'İstənilən vaxt: hesabın bütün məlumatlarını ixrac edə, redaktə edə və ya tamamilə silə bilərsən. Hesabın silinməsi bütün şəxsi məlumatlarını DB-dən silir (yalnız anonymized log-lar qalır). Müraciət üçün: privacy@ellit.az'
          }
        />

        <Section
          title={t('privacy.sections.contact.title') || 'Əlaqə'}
          body={
            t('privacy.sections.contact.body') ||
            'Suallarınız varsa: privacy@ellit.az və ya +994 XX XXX XX XX'
          }
        />
      </Card>
    </PageContainer>
  );
};

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6 last:mb-0">
      <h2 className="text-lg font-extrabold text-ink mb-2">{title}</h2>
      <p className="text-sm text-ink-soft leading-relaxed">{body}</p>
    </div>
  );
}

export default Privacy;
