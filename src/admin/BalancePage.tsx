import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Gift,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  Wallet,
  XCircle,
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

interface Withdrawal {
  id: string;
  amount_requested: number;
  commission_percent: number;
  commission_amount: number;
  net_amount: number;
  bank_card: string | null;
  status: 'pending' | 'processed' | 'rejected';
  requested_at: string;
  processed_at: string | null;
}

interface CommissionRates {
  commission_on_accept: number;
  commission_on_complete: number;
  commission_on_withdrawal: number;
  commission_on_bonus_convert?: number;
  min_withdrawal_amount: number;
}

export default function BalancePage() {
  const { t } = useTranslation();
  const [userBalance, setUserBalance] = useState(0);
  const [lockedBalance, setLockedBalance] = useState(0);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [bonusLogs, setBonusLogs] = useState<BonusLog[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('5');
  const [converting, setConverting] = useState(false);
  const [topping, setTopping] = useState(false);

  // Withdrawal form
  const [wdAmount, setWdAmount] = useState('');
  const [wdCard, setWdCard] = useState('');
  const [wdSubmitting, setWdSubmitting] = useState(false);

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
        { data: wdData },
        { data: ratesData },
      ] = await Promise.all([
        supabase.from('profiles').select('balance').eq('id', user.id).single(),
        supabase
          .from('provider_bonus_logs')
          .select('*')
          .eq('provider_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('withdrawals')
          .select('*')
          .eq('provider_id', user.id)
          .order('requested_at', { ascending: false })
          .limit(20),
        supabase.rpc('get_commission_rates'),
      ]);

      // provider_wallets — yalnız locked + bonus + totals üçündür
      // (Balans yalnız profiles.balance-də saxlanılır — vahid mənbə)
      let walletBonus = 0;
      let walletLocked = 0;
      const { data: wallet } = await supabase
        .from('provider_wallets')
        .select('bonus_balance, locked_balance')
        .eq('provider_id', user.id)
        .maybeSingle();

      if (!wallet) {
        await supabase
          .from('provider_wallets')
          .insert({ provider_id: user.id, bonus_balance: 0, locked_balance: 0 });
      } else {
        walletBonus  = Number(wallet.bonus_balance) || 0;
        walletLocked = Number(wallet.locked_balance) || 0;
      }

      // Vahid balans mənbəyi: profiles.balance
      setUserBalance(Number(profileData?.balance) || 0);
      setLockedBalance(walletLocked);
      setBonusBalance(walletBonus);
      setBonusLogs((logData as BonusLog[]) ?? []);
      setWithdrawals((wdData as Withdrawal[]) ?? []);
      setRates(ratesData as CommissionRates | null);
    } catch {
      setError(t('balance.errors.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  // ── Withdrawal request ────────────────────────────────────────
  const handleWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const amt = parseFloat(wdAmount);
    const minWd = rates?.min_withdrawal_amount ?? 10;

    if (!Number.isFinite(amt) || amt < minWd) {
      setError(t('balance.withdraw.minError', { min: minWd }));
      return;
    }
    if (amt > userBalance) {
      setError(t('balance.withdraw.insufficientBalance'));
      return;
    }
    if (!wdCard.trim() || wdCard.trim().length < 8) {
      setError(t('balance.withdraw.bankCard'));
      return;
    }

    setWdSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('request_withdrawal', {
      p_amount: amt,
      p_bank_card: wdCard.trim(),
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setWdSubmitting(false);
      return;
    }

    setInfo(t('balance.withdraw.successBody'));
    setWdAmount('');
    setWdCard('');
    setWdSubmitting(false);
    await fetchData();
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
      const { data, error: rpcErr } = await supabase.rpc(
        'convert_bonus_to_balance',
        { p_amount: bonusBalance },
      );
      if (rpcErr) {
        setError(t('balance.errors.convertFail', { error: rpcErr.message }));
      } else {
        // RPC indi jsonb qaytarır: { ok, credited, commission_amt, ... }
        const result = (data ?? {}) as {
          credited?: number;
          commission_amt?: number;
          commission_pct?: number;
        };
        const credited = Number(result.credited ?? bonusBalance);
        const commission = Number(result.commission_amt ?? 0);
        if (commission > 0) {
          setInfo(
            `Balansa əlavə edildi: ${credited.toFixed(2)} ₼ (komissiya: ${commission.toFixed(2)} ₼)`,
          );
        } else {
          setInfo(t('balance.convertSuccess', { amount: credited.toFixed(2) }));
        }
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
          {rates?.commission_on_bonus_convert != null &&
            rates.commission_on_bonus_convert > 0 &&
            bonusBalance > 0 && (
              <div className="mt-2 text-xs text-muted bg-surface-alt rounded-lg px-2 py-1.5">
                Konvertasiya komissiyası:{' '}
                <b>{rates.commission_on_bonus_convert}%</b> · Alacaqsınız:{' '}
                <b className="text-emerald-700">
                  {(
                    bonusBalance *
                    (1 - rates.commission_on_bonus_convert / 100)
                  ).toFixed(2)}{' '}
                  ₼
                </b>
              </div>
            )}
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

      {/* ── Locked (escrow) info ───────────────────────────────── */}
      {lockedBalance > 0 && (
        <Card variant="default" padding="lg" className="mb-5 bg-warning/5 border-warning/20">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning text-white flex items-center justify-center shrink-0">
              <Lock size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-base font-extrabold text-ink">{t('balance.locked')}</h3>
                <span className="text-2xl font-extrabold text-warning">
                  {lockedBalance.toFixed(2)} ₼
                </span>
              </div>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                {t('balance.lockedBody')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Withdrawal Card ────────────────────────────────────── */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <h3 className="text-lg font-extrabold text-ink mb-1 flex items-center gap-2">
          <Send size={18} className="text-brand-600" />
          {t('balance.withdraw.title')}
        </h3>
        <p className="text-sm text-muted mb-4">
          {t('balance.withdraw.body', {
            percent: rates?.commission_on_withdrawal ?? 3,
            min: rates?.min_withdrawal_amount ?? 10,
          })}
        </p>

        <form onSubmit={handleWithdraw} className="space-y-3">
          <Field label={t('balance.withdraw.amount')} required>
            <Input
              type="number"
              min={rates?.min_withdrawal_amount ?? 10}
              max={userBalance}
              step="0.01"
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value)}
              placeholder="0.00"
              disabled={wdSubmitting || userBalance <= 0}
            />
          </Field>

          <Field label={t('balance.withdraw.bankCard')} required>
            <Input
              type="text"
              value={wdCard}
              onChange={(e) => setWdCard(e.target.value)}
              placeholder={t('balance.withdraw.bankCardPlaceholder')}
              disabled={wdSubmitting}
            />
          </Field>

          {parseFloat(wdAmount) > 0 && rates && (
            <div className="p-3 rounded-2xl bg-brand-50 border border-brand-100 text-sm">
              <div className="text-brand-700 font-bold">
                {t('balance.withdraw.summary', {
                  commission: (
                    parseFloat(wdAmount) *
                    (rates.commission_on_withdrawal / 100)
                  ).toFixed(2),
                  net: (
                    parseFloat(wdAmount) *
                    (1 - rates.commission_on_withdrawal / 100)
                  ).toFixed(2),
                })}
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={wdSubmitting}
            disabled={
              wdSubmitting ||
              userBalance <= 0 ||
              parseFloat(wdAmount) < (rates?.min_withdrawal_amount ?? 10)
            }
            leftIcon={!wdSubmitting ? <CreditCard size={18} /> : undefined}
            fullWidth
          >
            {t('balance.withdraw.submit')}
          </Button>
        </form>
      </Card>

      {/* ── Withdrawal history ─────────────────────────────────── */}
      {withdrawals.length > 0 && (
        <Card variant="default" padding="md" className="mb-5">
          <h3 className="text-lg font-extrabold text-ink mb-3 flex items-center gap-2">
            <Send size={18} className="text-brand-600" />
            {t('balance.withdraw.history')}
          </h3>
          <ul className="divide-y divide-border -mx-2">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-2 py-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    w.status === 'processed'
                      ? 'bg-success/10 text-success'
                      : w.status === 'rejected'
                      ? 'bg-danger/5 text-danger'
                      : 'bg-warning/10 text-warning'
                  }`}
                >
                  {w.status === 'processed' ? (
                    <CheckCircle2 size={16} />
                  ) : w.status === 'rejected' ? (
                    <XCircle size={16} />
                  ) : (
                    <Clock size={16} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-ink">
                    {w.amount_requested.toFixed(2)} ₼ →{' '}
                    <span className="text-success">{w.net_amount.toFixed(2)} ₼</span>
                  </div>
                  <div className="text-xs text-muted">
                    {t('balance.withdraw.commissionInfo', {
                      percent: w.commission_percent,
                    })}{' '}
                    · {w.bank_card ?? '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-[11px] uppercase font-extrabold tracking-wide ${
                      w.status === 'processed'
                        ? 'text-success'
                        : w.status === 'rejected'
                        ? 'text-danger'
                        : 'text-warning'
                    }`}
                  >
                    {t(`balance.withdraw.status${
                      w.status.charAt(0).toUpperCase() + w.status.slice(1)
                    }`)}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {new Date(w.requested_at).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
