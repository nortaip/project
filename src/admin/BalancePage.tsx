import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
} from '../components/ui';

const MIN_TOPUP = 3;

/**
 * Admin manual balance adjustment — yalnız admin/master/superadmin
 * çağıra bilər. Server tərəfdə caller-in rolu yoxlanılır.
 */
export async function updateUserBalance(
  userId: string,
  amount: number,
  reason = 'Admin adjustment',
) {
  const { error } = await supabase.rpc('admin_credit_balance', {
    p_target_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) {
    console.error('Balance update failed:', error.message);
    return false;
  }
  return true;
}

interface BonusLog {
  id?: string;
  type: string;
  source?: string;
  amount: number;
  created_at: string;
}

export default function BalancePage() {
  const { t } = useTranslation();
  const [userBalance, setUserBalance] = useState(0);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [bonusLogs, setBonusLogs] = useState<BonusLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('5');
  const [converting, setConverting] = useState(false);
  const [topping, setTopping] = useState(false);

  // ── Load profile + bonus + logs ───────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError(t('balance.errors.loginRequired'));
        setLoading(false);
        return;
      }

      const [
        { data: profileData },
        { data: logData },
      ] = await Promise.all([
        supabase.from('profiles').select('balance').eq('id', user.id).single(),
        supabase
          .from('provider_bonus_logs')
          .select('*')
          .eq('provider_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      // provider_wallets — mövcud deyilsə yarat
      let walletBonus = 0;
      const { data: wallet } = await supabase
        .from('provider_wallets')
        .select('bonus_balance')
        .eq('provider_id', user.id)
        .maybeSingle();

      if (!wallet) {
        await supabase
          .from('provider_wallets')
          .insert({ provider_id: user.id, bonus_balance: 0, balance: 0 });
      } else {
        walletBonus = Number(wallet.bonus_balance) || 0;
      }

      setUserBalance(Number(profileData?.balance) || 0);
      setBonusBalance(walletBonus);
      setBonusLogs((logData as BonusLog[]) ?? []);
    } catch (err) {
      setError(t('balance.errors.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Top-up via secure Edge Function ───────────────────────────
  const handleTopUp = async () => {
    setError(null);
    setInfo(null);
    const amt = parseFloat(topUpAmount);
    if (!Number.isFinite(amt) || amt < MIN_TOPUP) {
      setError(t('balance.errors.minTopUp', { min: MIN_TOPUP }));
      return;
    }

    setTopping(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'create-payment-session',
        {
          body: {
            amount: amt,
            currency: 'AZN',
            purpose: 'balance_topup',
            return_url: `${window.location.origin}/payment/result`,
            description: 'Balans artırma',
          },
        },
      );

      if (invokeErr) {
        const msg = String(invokeErr.message ?? '');
        if (msg.includes('Failed to send') || msg.includes('Failed to fetch')) {
          setError(t('balance.errors.gatewayDown'));
        } else {
          setError(t('balance.errors.sessionFail') + ' ' + msg);
        }
        setTopping(false);
        return;
      }
      if (!data || !data.redirect_url) {
        setError(t('balance.errors.sessionFail'));
        setTopping(false);
        return;
      }
      window.location.href = data.redirect_url as string;
    } catch {
      setError(t('balance.errors.sessionFail'));
      setTopping(false);
    }
  };

  // ── Convert bonus → main balance ──────────────────────────────
  const handleConvertBonus = async () => {
    setError(null);
    setInfo(null);
    if (bonusBalance < 5) {
      setError(t('balance.errors.minBonus'));
      return;
    }

    setConverting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('convert_bonus_to_balance', {
        p_amount: bonusBalance,
      });
      if (rpcErr) {
        setError(t('balance.errors.convertFail', { error: rpcErr.message }));
      } else {
        setInfo(t('balance.convertSuccess', { amount: bonusBalance.toFixed(2) }));
        await fetchData();
      }
    } catch {
      setError(t('balance.errors.convertFail', { error: '' }));
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <Card variant="default" padding="lg" className="flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-brand-600" />
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-ink tracking-tight">
          {t('balance.title')}
        </h2>
        <p className="mt-1 text-sm sm:text-base text-muted">
          {t('balance.subtitle')}
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-5 p-4 rounded-2xl bg-danger/5 border border-danger/20 flex items-start gap-3">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <span className="text-sm text-danger">{error}</span>
        </div>
      )}
      {info && (
        <div className="mb-5 p-4 rounded-2xl bg-success/5 border border-success/20 text-sm text-success font-bold">
          {info}
        </div>
      )}

      {/* ── Balance Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Main balance — gradient hero */}
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient text-white p-6 shadow-card-lg">
          <div aria-hidden className="absolute -top-14 -right-14 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-bold text-white/80">
              <Wallet size={14} />
              {t('balance.main')}
            </div>
            <div className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight">
              {userBalance.toFixed(2)}
              <span className="text-2xl sm:text-3xl ml-1 text-white/80">₼</span>
            </div>
            <p className="mt-3 text-sm text-white/80">
              {t('balance.mainBody')}
            </p>
          </div>
        </div>

        {/* Bonus balance */}
        <Card variant="default" padding="lg" className="flex flex-col">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-bold text-muted">
            <Gift size={14} className="text-warning" />
            {t('balance.bonus')}
          </div>
          <div className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-warning">
            {bonusBalance.toFixed(2)}
            <span className="text-2xl sm:text-3xl ml-1 text-warning/70">₼</span>
          </div>
          <p className="mt-3 text-sm text-muted flex-1">
            {t('balance.bonusBody')}
          </p>
          <Button
            variant={bonusBalance >= 5 ? 'primary' : 'outline'}
            size="md"
            className="mt-4"
            onClick={handleConvertBonus}
            disabled={bonusBalance < 5 || converting}
            loading={converting}
            leftIcon={!converting ? <RefreshCw size={16} /> : undefined}
            fullWidth
          >
            {bonusBalance >= 5 ? t('balance.convertButton') : t('balance.convertMin')}
          </Button>
        </Card>
      </div>

      {/* ── Top-up Card ────────────────────────────────────────── */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <h3 className="text-lg font-extrabold text-ink mb-1">{t('balance.topUpTitle')}</h3>
        <p className="text-sm text-muted mb-4">
          {t('balance.topUpBody', { min: MIN_TOPUP })}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Field label={t('balance.amount') + ' (₼)'} required>
              <Input
                type="number"
                min={MIN_TOPUP}
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="0.00"
                disabled={topping}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={handleTopUp}
            loading={topping}
            disabled={topping || parseFloat(topUpAmount) < MIN_TOPUP}
            leftIcon={!topping ? <ArrowUpRight size={18} /> : undefined}
            className="sm:mt-7"
          >
            {t('balance.goToBank')}
          </Button>
        </div>
        <div className="mt-4 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
          <span>· {t('balance.topUpHint1')}</span>
          <span>· {t('balance.topUpHint2')}</span>
          <span>· {t('balance.topUpHint3')}</span>
        </div>
      </Card>

      {/* ── Bonus history ──────────────────────────────────────── */}
      <Card variant="default" padding="md">
        <h3 className="text-lg font-extrabold text-ink mb-3 flex items-center gap-2">
          <Gift size={18} className="text-brand-600" />
          {t('balance.history')}
        </h3>
        {bonusLogs.length === 0 ? (
          <EmptyState
            title={t('balance.historyEmptyTitle')}
            description={t('balance.historyEmptyBody')}
          />
        ) : (
          <ul className="divide-y divide-border -mx-2">
            {bonusLogs.map((log, idx) => {
              const isOut = log.type === 'conversion' || log.type === 'refund';
              return (
                <li key={log.id ?? idx} className="flex items-center gap-3 px-2 py-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isOut ? 'bg-brand-50 text-brand-600' : 'bg-success/10 text-success'
                    }`}
                  >
                    {isOut ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-ink">
                      {log.type === 'conversion' ? t('balance.log.conversion') : log.type}
                    </div>
                    {log.source && (
                      <div className="text-xs text-muted">
                        {log.source === 'bonus_to_main_balance'
                          ? t('balance.log.convertedToMain')
                          : log.source}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-base font-extrabold ${
                        isOut ? 'text-brand-700' : 'text-success'
                      }`}
                    >
                      {isOut ? '−' : '+'}
                      {Number(log.amount).toFixed(2)} ₼
                    </div>
                    <div className="text-[11px] text-muted">
                      {new Date(log.created_at).toLocaleString('az-AZ', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
