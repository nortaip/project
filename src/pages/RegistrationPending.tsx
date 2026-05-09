import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { Mail, RefreshCw } from 'lucide-react';
import { Button, Card, PageContainer } from '../components/ui';

export function RegistrationPending() {
  const { t } = useTranslation();
  const email = localStorage.getItem('pendingRegistrationEmail') ?? '';

  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 text-white flex items-center justify-center mb-5 shadow-brand-soft">
          <Mail size={36} />
        </div>
        <h1 className="text-2xl font-extrabold text-ink mb-2">
          {t('regPending.title')}
        </h1>
        <p className="text-muted mb-5">
          {email ? (
            <Trans
              i18nKey="regPending.bodyWithEmail"
              values={{ email }}
              components={{ 1: <span className="font-bold text-ink" /> }}
            />
          ) : (
            t('regPending.bodyNoEmail')
          )}
        </p>

        <div className="bg-info/10 border border-info/20 rounded-2xl p-4 mb-5 text-left">
          <p className="text-sm text-info inline-flex items-start gap-2">
            <RefreshCw size={16} className="shrink-0 mt-0.5" />
            <span>{t('regPending.spamHint')}</span>
          </p>
        </div>

        <div className="space-y-2">
          <Link to="/login" className="block">
            <Button variant="primary" size="lg" fullWidth>
              {t('regPending.goToLogin')}
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="ghost" size="md" fullWidth>
              {t('regPending.home')}
            </Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
}

export default RegistrationPending;
