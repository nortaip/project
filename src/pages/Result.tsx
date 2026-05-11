import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Home,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, PageContainer } from '../components/ui';

interface PaymentResult {
  id: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded' | string;
  amount: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  completed_at: string | null;
}

type ViewState = 'loading' | 'pending' | 'success' | 'failed' | 'unknown';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15; // ~30 saniyə

const Result = () => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const paymentId = params.get('id') ?? params.get('order_id');
  const urlForcedFail = params.get('status') === 'failed';

  const [result, setResult] = useState<PaymentResult | null>(null);
  const [view, setView] = useState<ViewState>('loading');
  const [attempts, setAttempts] = useState(0);
  const pollRef = useRef<number | null>(null);

  // ─── Polling logic ────────────────────────────────────────────────
  useEffect(() => {
    if (!paymentId) {
      setView('unknown');
      return;
    }

    let cancelled = false;

    async function fetchOnce() {
      const { data } = await supabase
        .from('payments')
        .select('id, status, amount, description, metadata, completed_at')
        .eq('id', paymentId)
        .single();

      if (cancelled) return;

      const row = data as PaymentResult | null;
      setResult(row);

      if (!row) {
        setView('unknown');
        return;
      }

      if (row.status === 'completed') {
        setView('success');
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }
      if (row.status === 'failed' || row.status === 'cancelled') {
        setView('failed');
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }
      // pending — polling davam edir
      setView('pending');
    }

    void fetchOnce();
    pollRef.current = window.setInterval(() => {
      setAttempts((a) => {
        const next = a + 1;
        if (next >= POLL_MAX_ATTEMPTS) {
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
        return next;
      });
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [paymentId]);

  // URL-də explicit `status=failed` → failed UI (Epoint error_redirect_url)
  useEffect(() => {
    if (urlForcedFail && view === 'pending') {
      setView('failed');
    }
  }, [urlForcedFail, view]);

  const amount =
    result?.amount != null ? `${Number(result.amount).toFixed(2)} ₼` : null;
  const purpose = (result?.metadata?.purpose as string | undefined) ?? '';
  const purposeLabel = (() => {
    switch (purpose) {
      case 'balance_topup':
        return 'Balans yüklənməsi';
      case 'service_payment':
        return 'Sifariş ödənişi';
      case 'service_promotion':
        return 'Xidmət təşviqi';
      default:
        return null;
    }
  })();

  return (
    <PageContainer size="sm" className="min-h-[80vh] flex items-center">
      <Card variant="elevated" padding="lg" className="w-full">
        {view === 'loading' && <LoadingView />}
        {view === 'pending' && (
          <PendingView
            attempts={attempts}
            amount={amount}
            purposeLabel={purposeLabel}
            onRefresh={() => window.location.reload()}
          />
        )}
        {view === 'success' && (
          <SuccessView
            t={t}
            amount={amount}
            purposeLabel={purposeLabel}
            description={result?.description ?? null}
          />
        )}
        {view === 'failed' && (
          <FailedView t={t} amount={amount} purposeLabel={purposeLabel} />
        )}
        {view === 'unknown' && <UnknownView t={t} />}
      </Card>
    </PageContainer>
  );
};

// ─── Views ─────────────────────────────────────────────────────────
function LoadingView() {
  return (
    <div className="py-14 text-center">
      <Loader2 size={40} className="mx-auto text-brand-600 animate-spin" />
      <p className="mt-4 text-muted font-bold">Ödəniş yoxlanılır...</p>
    </div>
  );
}

function PendingView({
  attempts,
  amount,
  purposeLabel,
  onRefresh,
}: {
  attempts: number;
  amount: string | null;
  purposeLabel: string | null;
  onRefresh: () => void;
}) {
  const tooLong = attempts >= POLL_MAX_ATTEMPTS;
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
        <Clock size={40} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2 tracking-tight">
        Ödəniş təsdiqlənir
      </h1>
      <p className="text-muted mb-1 leading-relaxed">
        Bank ödənişi emal edir. Bu adətən bir neçə saniyə çəkir.
      </p>
      {amount && (
        <p className="text-3xl font-extrabold text-ink mt-4">{amount}</p>
      )}
      {purposeLabel && (
        <p className="text-xs text-muted font-bold uppercase tracking-wide mt-1">
          {purposeLabel}
        </p>
      )}
      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        <span>Avtomatik yenilənir... ({attempts + 1})</span>
      </div>
      {tooLong && (
        <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <p className="font-bold mb-1">Hələ də gözlənilir</p>
          <p>
            Bank cavabı gecikir. Pulu bankdan tutmamış olsanız, narahat olmayın
            — uğursuz halda heç bir məbləğ tutulmur. Daha sonra balansınızı
            yoxlayın.
          </p>
        </div>
      )}
      <div className="mt-6 flex gap-3 justify-center flex-wrap">
        <Button
          variant="outline"
          size="md"
          onClick={onRefresh}
          leftIcon={<RefreshCw size={18} />}
        >
          Yenilə
        </Button>
        <Link to="/account">
          <Button variant="ghost" size="md" leftIcon={<Home size={18} />}>
            Hesabım
          </Button>
        </Link>
      </div>
    </div>
  );
}

function SuccessView({
  t,
  amount,
  purposeLabel,
  description,
}: {
  t: ReturnType<typeof useTranslation>['t'];
  amount: string | null;
  purposeLabel: string | null;
  description: string | null;
}) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5 shadow-sm">
        <CheckCircle2 size={42} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2 tracking-tight">
        Ödəniş uğurlu!
      </h1>
      {amount && (
        <p className="text-4xl font-extrabold text-ink mt-3 mb-1 tracking-tight">
          {amount}
        </p>
      )}
      {purposeLabel && (
        <p className="text-xs text-emerald-700 font-bold uppercase tracking-wide bg-emerald-50 inline-block px-2 py-0.5 rounded-md">
          {purposeLabel}
        </p>
      )}
      <p className="text-muted mt-4 mb-6 leading-relaxed">
        {description ?? t('result.successBody')}
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/payment-history">
          <Button
            variant="outline"
            size="md"
            leftIcon={<ClipboardList size={18} />}
          >
            {t('result.history')}
          </Button>
        </Link>
        <Link to="/account">
          <Button
            variant="primary"
            size="md"
            leftIcon={<Home size={18} />}
            rightIcon={<ChevronRight size={18} />}
          >
            {t('result.myAccount')}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function FailedView({
  t,
  amount,
  purposeLabel,
}: {
  t: ReturnType<typeof useTranslation>['t'];
  amount: string | null;
  purposeLabel: string | null;
}) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-rose-50 text-rose-600 flex items-center justify-center mb-5">
        <XCircle size={42} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2 tracking-tight">
        Ödəniş alınmadı
      </h1>
      {amount && (
        <p className="text-3xl font-extrabold text-ink-soft mt-2 line-through opacity-60">
          {amount}
        </p>
      )}
      {purposeLabel && (
        <p className="text-xs text-muted font-bold uppercase tracking-wide mt-1">
          {purposeLabel}
        </p>
      )}
      <p className="text-muted mt-4 mb-6 leading-relaxed">
        Bank ödənişi tamamlaya bilmədi. Heç bir məbləğ kartınızdan tutulmayıb.
        Yenidən cəhd etməyə dəyər.
      </p>
      <div className="mt-2 p-3 rounded-xl bg-surface-alt text-left text-xs text-muted leading-relaxed mb-6">
        <p className="font-bold text-ink-soft mb-1">Niyə baş verə bilər?</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Kartda kifayət qədər vəsait yoxdur</li>
          <li>3D Secure kodu yanlış / vaxtı keçib</li>
          <li>Kart onlayn ödənişlər üçün açılmayıb</li>
          <li>Bank tərəfindən imtina (limit, security)</li>
        </ul>
      </div>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/payment-history">
          <Button
            variant="outline"
            size="md"
            leftIcon={<ClipboardList size={18} />}
          >
            {t('result.history')}
          </Button>
        </Link>
        <Link to="/account">
          <Button
            variant="primary"
            size="md"
            leftIcon={<Home size={18} />}
            rightIcon={<ChevronRight size={18} />}
          >
            {t('result.myAccount')}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function UnknownView({
  t,
}: {
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-surface-alt text-muted flex items-center justify-center mb-5">
        <Clock size={40} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mb-2">
        Ödəniş tapılmadı
      </h1>
      <p className="text-muted mb-6 leading-relaxed">
        Sorğunuza uyğun ödəniş tapılmadı. Tarixçədə statusunu yoxlaya
        bilərsiniz.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/payment-history">
          <Button
            variant="outline"
            size="md"
            leftIcon={<ClipboardList size={18} />}
          >
            {t('result.history')}
          </Button>
        </Link>
        <Link to="/account">
          <Button
            variant="primary"
            size="md"
            leftIcon={<Home size={18} />}
            rightIcon={<ChevronRight size={18} />}
          >
            {t('result.myAccount')}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default Result;
