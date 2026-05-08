import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Receipt } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  EmptyState,
  PageContainer,
  SectionHeader,
} from '../components/ui';

interface PaymentRow {
  id: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
  description: string | null;
  date?: string | null;
  created_at?: string | null;
  currency?: string | null;
}

const STATUS_META: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  pending: { label: 'Gözləyir', bg: 'bg-warning/10', text: 'text-warning' },
  completed: { label: 'Uğurlu', bg: 'bg-success/10', text: 'text-success' },
  failed: { label: 'Uğursuz', bg: 'bg-danger/10', text: 'text-danger' },
  refunded: { label: 'Geri qaytarıldı', bg: 'bg-info/10', text: 'text-info' },
  cancelled: { label: 'Ləğv', bg: 'bg-muted/10', text: 'text-muted' },
};

export function PaymentHistory() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPayments((data ?? []) as PaymentRow[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const totalIn = payments
    .filter((p) => p.status === 'completed')
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <PageContainer size="md">
      <SectionHeader
        title="Ödəniş tarixçəsi"
        subtitle={`${payments.length} əməliyyat · ${totalIn.toFixed(2)} ₼ ümumi`}
        action={
          <Button
            variant="primary"
            size="md"
            leftIcon={<CreditCard size={16} />}
            onClick={() => navigate('/update-balance')}
          >
            Balans artır
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : payments.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Receipt size={32} />}
            title="Hələ ödəniş tarixçəsi yoxdur"
            description="Balans artırmaq və ya sifariş etmək üçün ödənişlər burada görünəcək"
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/update-balance')}
              >
                İlk ödənişi et
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <PaymentItem key={p.id} payment={p} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export default PaymentHistory;

function PaymentItem({ payment }: { payment: PaymentRow }) {
  const meta = STATUS_META[payment.status] ?? STATUS_META.pending;
  const isOutgoing = payment.amount < 0;
  const Icon = isOutgoing ? ArrowUpRight : ArrowDownLeft;

  const dt = payment.date ?? payment.created_at;
  const dateStr = dt
    ? new Date(dt).toLocaleString('az', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <div className="bg-white rounded-2xl border border-border p-4 flex items-center gap-3">
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
          isOutgoing ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
        }`}
      >
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-ink">
            {payment.description || 'Ödəniş'}
          </span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md ${meta.bg} ${meta.text}`}
          >
            {meta.label}
          </span>
        </div>
        <p className="text-xs text-muted mt-0.5">{dateStr}</p>
      </div>
      <div
        className={`font-extrabold text-lg shrink-0 ${
          isOutgoing ? 'text-warning' : 'text-success'
        }`}
      >
        {isOutgoing ? '-' : '+'}
        {Math.abs(Number(payment.amount)).toFixed(2)} {payment.currency ?? '₼'}
      </div>
    </div>
  );
}
