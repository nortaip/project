import { Link } from 'react-router-dom';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button, Card, PageContainer } from '../components/ui';

const Error = () => {
  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-danger/10 text-danger flex items-center justify-center mb-5">
          <AlertTriangle size={40} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
          Xəta baş verdi
        </h1>
        <p className="text-muted mb-6">
          Üzr istəyirik, gözlənilməz bir problem yarandı. Yenidən cəhd edin və ya
          ana səhifəyə qayıdın.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button
            variant="outline"
            size="md"
            leftIcon={<RefreshCw size={18} />}
            onClick={() => window.location.reload()}
          >
            Yenilə
          </Button>
          <Link to="/">
            <Button variant="primary" size="md" leftIcon={<Home size={18} />}>
              Ana səhifə
            </Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
};

export default Error;
