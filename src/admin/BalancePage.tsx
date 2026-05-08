import { useEffect, useState } from 'react';
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
  PageContainer,
  SectionHeader,
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
        setError('Hesabına daxil ol.');
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
      setError('Məlumatlar yüklənərkən xəta baş verdi.');
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
      setError(`Minimum yükləmə məbləği ${MIN_TOPUP} ₼-dir.`);
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
        // "Failed to send a request..." → funksiya hələ deploy olunmayıb
        const msg = String(invokeErr.message ?? '');
        if (msg.includes('Failed to send') || msg.includes('Failed to fetch')) {
          setError(
            'Ödəniş servisi əlçatan deyil. Admin tərəfdə Edge Function deploy olunmalıdır (create-payment-session).',
          );
        } else {
          setError('Ödəniş sessiyası yaradıla bilmədi: ' + msg);
        }
        setTopping(false);
        return;
      }
      if (!data) {
        setError('Boş cavab — yenidən cəhd et.');
        setTopping(false);
        return;
      }
      if (!data.redirect_url) {
        // mode === 'test' → secret-lər qoyulmayıb
        setError(
          data.mode === 'test'
            ? 'Ödəniş gateway-i hələ konfiqurasiya olunmayıb (Epoint key-ləri qoyulmalıdır).'
            : 'Ödəniş gateway-i cavab vermədi.',
        );
        setTopping(false);
        return;
      }
      window.location.href = data.redirect_url as string;
    } catch {
      setError('Ödəniş zamanı xəta baş verdi.');
      setTopping(false);
    }
  };

  // ── Convert bonus → main balance ──────────────────────────────
  const handleConvertBonus = async () => {
    setError(null);
    setInfo(null);
    if (bonusBalance < 5) {
      setError('Çevirmək üçün minimum 5 ₼ bonus lazımdır.');
      return;
    }

    setConverting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('convert_bonus_to_balance', {
        p_amount: bonusBalance,
      });
      if (rpcErr) {
        setError('Bonus çevrilmədi: ' + rpcErr.message);
      } else {
        setInfo(`${bonusBalance.toFixed(2)} ₼ bonus əsas balansa çevrildi!`);
        await fetchData();
      }
    } catch (err) {
      setError('Bonus çevrilərkən xəta baş verdi.');
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer size="lg" className="py-6">
        <Card variant="default" padding="lg" className="flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-brand-600" />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="lg" className="py-6">
      <SectionHeader title="Balansım" subtitle="Əsas balans, bonus və ödəniş tarixçəsi" />

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
              Əsas balans
            </div>
            <div className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight">
              {userBalance.toFixed(2)}
              <span className="text-2xl sm:text-3xl ml-1 text-white/80">₼</span>
            </div>
            <p className="mt-3 text-sm text-white/80">
              Balansından komissiya, sifariş və geri qaytarma əməliyyatları icra olunur.
            </p>
          </div>
        </div>

        {/* Bonus balance */}
        <Card variant="default" padding="lg" className="flex flex-col">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-bold text-muted">
            <Gift size={14} className="text-warning" />
            Bonus balans
          </div>
          <div className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-warning">
            {bonusBalance.toFixed(2)}
            <span className="text-2xl sm:text-3xl ml-1 text-warning/70">₼</span>
          </div>
          <p className="mt-3 text-sm text-muted flex-1">
            Tamamlanmış sifarişlərdən qazanılır. 5 ₼-dan başlayaraq əsas balansa çevirə bilərsən.
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
            {bonusBalance >= 5 ? 'Bonusu balansa çevir' : 'Min. 5 ₼ tələb olunur'}
          </Button>
        </Card>
      </div>

      {/* ── Top-up Card ────────────────────────────────────────── */}
      <Card variant="elevated" padding="lg" className="mb-5">
        <h3 className="text-lg font-extrabold text-ink mb-1">Balansı artır</h3>
        <p className="text-sm text-muted mb-4">
          Minimum yükləmə məbləği {MIN_TOPUP} ₼-dir. Ödəniş bank səviyyəsində qorunur.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Field label="Məbləğ (₼)" required>
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
            Banka keç
          </Button>
        </div>
        <div className="mt-4 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
          <span>· Visa, Mastercard və azəri bank kartları qəbul olunur</span>
          <span>· Anlıq aktivləşmə</span>
          <span>· Ödəniş keyfi Epoint vasitəsi ilə</span>
        </div>
      </Card>

      {/* ── Bonus history ──────────────────────────────────────── */}
      <Card variant="default" padding="md">
        <h3 className="text-lg font-extrabold text-ink mb-3 flex items-center gap-2">
          <Gift size={18} className="text-brand-600" />
          Bonus tarixçəsi
        </h3>
        {bonusLogs.length === 0 ? (
          <EmptyState
            title="Hələ bonus əməliyyatı yoxdur"
            description="Tamamlanmış sifarişlərdən bonus qazandıqda burada görünəcək."
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
                      {log.type === 'conversion' ? 'Bonus → balansa çevrilmə' : log.type}
                    </div>
                    {log.source && (
                      <div className="text-xs text-muted">
                        {log.source === 'bonus_to_main_balance'
                          ? 'Əsas balansa çevrildi'
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
    </PageContainer>
  );
}
