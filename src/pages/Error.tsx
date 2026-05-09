import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button, Card, PageContainer } from '../components/ui';

const Error = () => {
  const { t } = useTranslation();
  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-danger/10 text-danger flex items-center justify-center mb-5">
          <AlertTriangle size={40} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
          {t('errorPage.title')}
        </h1>
        <p className="text-muted mb-6">
          {t('errorPage.body')}
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button
            variant="outline"
            size="md"
            leftIcon={<RefreshCw size={18} />}
            onClick={() => window.location.reload()}
          >
            {t('errorPage.refresh')}
          </Button>
          <Link to="/">
            <Button variant="primary" size="md" leftIcon={<Home size={18} />}>
              {t('errorPage.home')}
            </Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
};

export default Error;
