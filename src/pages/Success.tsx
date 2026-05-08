import { Link } from 'react-router-dom';
import { CheckCircle2, Home, ShoppingBag } from 'lucide-react';
import { Button, Card, PageContainer } from '../components/ui';

const Success = () => {
  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-success/10 text-success flex items-center justify-center mb-5">
          <CheckCircle2 size={40} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
          Uğurlu! 🎉
        </h1>
        <p className="text-muted mb-6">
          Əməliyyatınız uğurla tamamlandı. Davam etmək üçün aşağıdakı düymələrdən
          birini seçin.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link to="/services">
            <Button variant="primary" size="md" leftIcon={<ShoppingBag size={18} />}>
              Xidmətlər
            </Button>
          </Link>
          <Link to="/">
            <Button variant="outline" size="md" leftIcon={<Home size={18} />}>
              Ana səhifə
            </Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
};

export default Success;
