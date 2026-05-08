import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, RefreshCw, XCircle } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { Button, Card, PageContainer } from '../components/ui';

export function PaymentError() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    // 10 saniyə sonra avtomatik geri qaytarmaq
    const timer = setTimeout(() => navigate('/update-balance'), 10_000);
    return () => clearTimeout(timer);
  }, [navigate, user]);

  const search = new URLSearchParams(location.search);
  const errorMessage =
    search.get('message') ?? 'Ödəniş zamanı xəta baş verdi';

  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-danger/10 text-danger flex items-center justify-center mb-5">
          <XCircle size={40} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
          Ödəniş tamamlanmadı
        </h1>
        <p className="text-muted mb-1">{errorMessage}</p>
        <p className="text-xs text-muted mb-6">
          10 saniyədən sonra avtomatik balans səhifəsinə qayıdacaqsan
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button
            variant="outline"
            size="md"
            leftIcon={<RefreshCw size={18} />}
            onClick={() => navigate('/update-balance')}
          >
            Yenidən cəhd et
          </Button>
          <Button
            variant="primary"
            size="md"
            leftIcon={<CreditCard size={18} />}
            onClick={() => navigate('/payment-history')}
          >
            Tarixçə
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
}

export default PaymentError;
