import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, ClipboardList, Home, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, PageContainer } from '../components/ui';

interface PaymentResult {
  status: string;
  amount: number | null;
  description: string | null;
}

/**
 * Bank gateway-dən geri yönləndirildikdən sonra istifadəçinin gördüyü səhifə.
 * `?id=<payment_id>` query string-i payment-i tapmaq üçün istifadə olunur.
 */
const Result = () => {
  const [params] = useSearchParams();
  const paymentId = params.get('id') ?? params.get('order_id');
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!paymentId) {
      setLoading(false);
      return;
    }
    void supabase
      .from('payments')
      .select('status, amount, description')
      .eq('id', paymentId)
      .single()
      .then(({ data }) => {
        setResult(data as PaymentResult | null);
        setLoading(false);
      });
  }, [paymentId]);

  const ok = result?.status === 'completed';

  return (
    <PageContainer size="sm" className="min-h-[70vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full text-center">
        {loading ? (
          <div className="py-10">
            <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-muted">Nəticə yoxlanılır...</p>
          </div>
        ) : (
          <>
            <div
              className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-5 ${
                ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
              }`}
            >
              {ok ? <CheckCircle2 size={40} /> : <XCircle size={40} />}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
              {ok ? 'Ödəniş uğurludur 🎉' : 'Ödəniş tamamlanmadı'}
            </h1>
            {result?.amount && (
              <p className="text-3xl font-extrabold text-ink mb-1">
                {Number(result.amount).toFixed(2)} ₼
              </p>
            )}
            <p className="text-muted mb-6">
              {ok
                ? `Balansınız uğurla artırıldı. ${
                    result?.description ?? ''
                  }`.trim()
                : 'Bank gateway-i ödənişi tamamlamadı. Yenidən cəhd edin.'}
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Link to="/payment-history">
                <Button
                  variant="outline"
                  size="md"
                  leftIcon={<ClipboardList size={18} />}
                >
                  Tarixçə
                </Button>
              </Link>
              <Link to="/account">
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={<Home size={18} />}
                  rightIcon={<ChevronRight size={18} />}
                >
                  Hesabım
                </Button>
              </Link>
            </div>
          </>
        )}
      </Card>
    </PageContainer>
  );
};

export default Result;
