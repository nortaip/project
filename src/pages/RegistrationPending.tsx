import { Link } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';
import { Button, Card, PageContainer } from '../components/ui';

export function RegistrationPending() {
  const email = localStorage.getItem('pendingRegistrationEmail') ?? '';

  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 text-white flex items-center justify-center mb-5 shadow-brand-soft">
          <Mail size={36} />
        </div>
        <h1 className="text-2xl font-extrabold text-ink mb-2">
          Email-i yoxla 📬
        </h1>
        <p className="text-muted mb-5">
          {email ? (
            <>
              Sizə{' '}
              <span className="font-bold text-ink">{email}</span>{' '}
              ünvanına təsdiq linki göndərdik. Hesabınızı aktivləşdirmək üçün
              link üzərinə klikləyin.
            </>
          ) : (
            'Sizə təsdiq linki göndərdik. Hesabınızı aktivləşdirmək üçün email-i yoxlayın.'
          )}
        </p>

        <div className="bg-info/10 border border-info/20 rounded-2xl p-4 mb-5 text-left">
          <p className="text-sm text-info inline-flex items-start gap-2">
            <RefreshCw size={16} className="shrink-0 mt-0.5" />
            <span>
              Inbox-da görmürsənsə spam qovluğunu yoxla. Bəzən email gələnə qədər
              1-2 dəqiqə vaxt keçə bilər.
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Link to="/login" className="block">
            <Button variant="primary" size="lg" fullWidth>
              Daxil olmağa keç
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="ghost" size="md" fullWidth>
              Ana səhifə
            </Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
}

export default RegistrationPending;
