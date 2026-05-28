import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  Gift,
  History,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Button, Card, PageContainer } from '../components/ui';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number | null;
  description: string | null;
  related_id: string | null;
  payment_id: string | null;
  created_at: string;
}

const QUICK_AMOUNTS = [10, 25, 50, 100];

export default function CustomerBalance() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Session-i birbaşa Supabase-dən oxu — auth store hydration race-i həll edir
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user ?? user;
      if (cancelled) return;
      if (!sessionUser) {
        navigate('/login', { replace: true });
        return;
      }
      void load();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    setLoading(true);
    try {
      // user id-ni session-dan al — store hələ hydrate olmaya bilər
      const { data: authData } = await supabase.auth.getSession();
      const uid = authData.session?.user?.id ?? user?.id;
      if (!uid) {
        setError('Not authenticated');
        return;
      }

      const [pRes, tRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('balance')
          .eq('id', uid)
          .single(),
        supabase
          .from('transactions')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      setBalance(Number(pRes.data?.balance ?? 0));
      setTransactions((tRes.data ?? []) as Transaction[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleTopUp(amt: number) {
    if (submitting) return;
    setError(null);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('balance.topUp.invalidAmount', { defaultValue: 'Düzgün məbləğ daxil edin' }));
      return;
    }
    if (amt > 10_000) {
      setError(t('balance.topUp.limitExceeded', { defaultValue: 'Maksimum: 10 000 ₼' }));
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: invErr } = await supabase.functions.invoke(
        'create-payment-session',
        {
          body: {
            purpose: 'balance_topup',
            amount: amt,
            description: 'Balance top-up',
            return_url: `${window.location.origin}/payment/result`,
          },
        },
      );
      if (invErr) throw invErr;
      if (data?.error) throw new Error(data.error);
      const url = data?.redirect_url as string | null;
      if (!url) {
        setError(
          data?.message ??
            t('balance.topUp.gatewayMissing', {
              defaultValue: 'Ödəniş sistemi konfiqurasiya olunmayıb.',
            }),
        );
        return;
      }
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer size="lg">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-ink mb-4"
      >
        <ChevronLeft size={16} /> {t('common.back', { defaultValue: 'Geri' })}
      </button>

      {/* Hero balance card */}
      <div className="bg-gradient-to-br from-brand-600 to-accent-500 rounded-3xl p-6 sm:p-8 text-white shadow-brand-soft relative overflow-hidden mb-5">
        <div className="absolute -top-12 -right-8 w-40 h-40 rounded-full bg-white/15 blur-3xl pointer-events-none" />
        <div className="absolute -left-10 -bottom-12 w-48 h-48 rounded-full bg-accent-300/30 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-white/85">
            <Wallet size={18} />
            <span className="text-sm font-bold">
              {t('balance.current', { defaultValue: 'Cari balans' })}
            </span>
          </div>
          <p className="text-4xl sm:text-5xl font-extrabold mt-2 tracking-tight">
            {loading ? '…' : balance.toFixed(2)}{' '}
            <span className="text-2xl">₼</span>
          </p>
        </div>
      </div>

      {/* Top-up card */}
      <Card variant="default" padding="md" className="mb-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={20} className="text-brand-600" />
          <h2 className="font-extrabold text-ink text-lg">
            {t('balance.topUp.title', { defaultValue: 'Balansı artır' })}
          </h2>
        </div>
        <p className="text-sm text-muted mb-4">
          {t('balance.topUp.body', {
            defaultValue:
              'Kartla təhlükəsiz ödəniş. Hesabınıza dərhal əlavə olunur.',
          })}
        </p>

        {/* Quick amounts */}
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className={`px-4 py-2 rounded-xl font-bold border text-sm transition-colors ${
                Number(amount) === v
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-brand-50 text-brand-700 border-brand-200 hover:border-brand-400'
              }`}
            >
              {v} ₼
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              step="0.01"
              min={1}
              max={10000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('balance.topUp.customAmountHint', {
                defaultValue: 'Məbləğ daxil et',
              })}
              className="w-full px-4 py-3 pr-12 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none font-bold"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-bold pointer-events-none">
              ₼
            </span>
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={submitting || !amount || Number(amount) <= 0}
            onClick={() => handleTopUp(Number(amount.replace(',', '.')))}
            leftIcon={
              submitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CreditCard size={18} />
              )
            }
          >
            {t('balance.topUp.cta', { defaultValue: 'Kartla ödə' })}
          </Button>
        </div>

        <div className="flex items-center gap-2 mt-4 text-xs text-muted">
          <ShieldCheck size={14} />
          <span>
            {t('balance.topUp.secureHint', {
              defaultValue:
                'Kart məlumatları yalnız bankın səhifəsində daxil olunur. Biz saxlamırıq.',
            })}
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </Card>

      {/* History */}
      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-4">
          <History size={20} className="text-muted" />
          <h2 className="font-extrabold text-ink text-lg">
            {t('balance.history', { defaultValue: 'Son əməliyyatlar' })}
          </h2>
        </div>
        {loading ? (
          <div className="py-8 text-center text-muted">
            <Loader2 size={20} className="animate-spin inline-block mr-2" />
            {t('common.loading', { defaultValue: 'Yüklənir...' })}
          </div>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-muted">
            {t('balance.noHistory', { defaultValue: 'Hələ əməliyyat yoxdur' })}
          </p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const isCredit = tx.amount >= 0;
  const meta = typeMeta(tx.type);
  const Icon = meta.Icon;

  const dt = new Date(tx.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-alt hover:bg-border/40 transition-colors">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}
      >
        <Icon size={18} className={meta.fg} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-ink text-sm">{meta.label}</p>
        {tx.description && (
          <p className="text-xs text-muted truncate">{tx.description}</p>
        )}
        <p className="text-xs text-muted/80 font-bold mt-0.5">{dt}</p>
      </div>
      <span
        className={`font-extrabold whitespace-nowrap ${
          isCredit ? 'text-emerald-700' : 'text-rose-700'
        }`}
      >
        {isCredit ? '+' : ''}
        {tx.amount.toFixed(2)} ₼
      </span>
    </div>
  );
}

type Meta = {
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  bg: string;
  fg: string;
};

function typeMeta(type: string): Meta {
  switch (type) {
    case 'top_up':
      return {
        label: 'Balans yüklənməsi',
        Icon: ArrowDownLeft,
        bg: 'bg-emerald-50',
        fg: 'text-emerald-600',
      };
    case 'booking_charge':
      return {
        label: 'Sifariş ödənişi',
        Icon: ArrowUpRight,
        bg: 'bg-rose-50',
        fg: 'text-rose-600',
      };
    case 'refund':
      return {
        label: 'Geri qaytarma',
        Icon: ArrowDownLeft,
        bg: 'bg-cyan-50',
        fg: 'text-cyan-600',
      };
    case 'bonus_earn':
      return {
        label: 'Bonus qazanıldı',
        Icon: Sparkles,
        bg: 'bg-amber-50',
        fg: 'text-amber-600',
      };
    case 'bonus_convert':
      return {
        label: 'Bonus → Balans',
        Icon: Gift,
        bg: 'bg-violet-50',
        fg: 'text-violet-600',
      };
    case 'withdrawal':
      return {
        label: 'Nağdlaşdırma',
        Icon: Banknote,
        bg: 'bg-cyan-50',
        fg: 'text-cyan-600',
      };
    case 'escrow_lock':
      return {
        label: 'Escrow-da bloklandı',
        Icon: ShieldCheck,
        bg: 'bg-amber-50',
        fg: 'text-amber-600',
      };
    case 'escrow_release':
      return {
        label: 'Escrow açıldı',
        Icon: CheckCircle2,
        bg: 'bg-emerald-50',
        fg: 'text-emerald-600',
      };
    case 'admin_adjust':
      return {
        label: 'Admin düzəlişi',
        Icon: AlertCircle,
        bg: 'bg-gray-100',
        fg: 'text-gray-600',
      };
    default:
      return {
        label: type,
        Icon: AlertCircle,
        bg: 'bg-gray-100',
        fg: 'text-gray-600',
      };
  }
}
