import { useEffect, useState } from 'react';
import { message } from 'antd';
import {
  ArrowDownToLine,
  Wallet,
  Receipt,
  Plus,
  X,
  Split,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { azn, money } from '../lib/format';
import { Button, Card, Field, Input } from '../components/ui';

interface Tx {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
}

export interface BrigadeMemberLite {
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'dispatcher' | 'member';
  commission_pct: number | null;
  is_active: boolean;
}

interface Props {
  brigadeId: string;
  brigadeBalance: number;
  isOwner: boolean;
  members: BrigadeMemberLite[];
  onChanged: () => void;
}

export default function BrigadeBalanceTab({
  brigadeId,
  brigadeBalance,
  isOwner,
  members,
  onChanged,
}: Props) {
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [ownerBalance, setOwnerBalance] = useState(0);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadeId]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: txs }, { data: { user } }] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, type, amount, description, created_at')
          .eq('related_id', brigadeId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.auth.getUser(),
      ]);
      setTransactions((txs ?? []) as Tx[]);

      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', user.id)
          .maybeSingle();
        setOwnerBalance(Number(prof?.balance ?? 0));
      }
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Balance card */}
      <Card variant="elevated" padding="lg" className="bg-gradient-to-br from-brand-600 to-accent-500 text-white">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-bold opacity-90">
          <Wallet size={14} />
          Briqada balansı
        </div>
        <div className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight">
          {money(brigadeBalance)}
          <span className="text-2xl sm:text-3xl ml-1 opacity-80">₼</span>
        </div>
        <p className="mt-3 text-sm opacity-90">
          Briqada təklifləri komissiyası bu balansdan tutulur. Sahibinin şəxsi balansından ayrıdır.
        </p>
        {isOwner && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              className="!bg-white !text-brand-700 hover:!bg-white/90"
              leftIcon={<Plus size={16} />}
              onClick={() => setTopUpOpen(true)}
            >
              Balans artır
            </Button>
            <Button
              variant="outline"
              size="md"
              className="!bg-white/10 !text-white !border-white/40 hover:!bg-white/20"
              leftIcon={<Split size={16} />}
              onClick={() => setDistributeOpen(true)}
              disabled={brigadeBalance <= 0}
            >
              Pul bölgüsü
            </Button>
          </div>
        )}
      </Card>

      {/* Transactions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={16} className="text-muted" />
          <h3 className="font-extrabold text-ink">Hesab hərəkətləri</h3>
        </div>
        {loading ? (
          <div className="flex justify-center py-10">
            <span className="inline-block w-8 h-8 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <Card variant="default" padding="md" className="text-center text-muted text-sm">
            Hələ hərəkət yoxdur
          </Card>
        ) : (
          <div className="space-y-2">
            {transactions.map((t) => {
              const isPositive = t.amount > 0;
              return (
                <Card key={t.id} variant="default" padding="md">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isPositive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      <ArrowDownToLine
                        size={16}
                        className={isPositive ? 'rotate-180' : ''}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-ink text-sm truncate">
                        {t.description ?? t.type}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(t.created_at).toLocaleString('az', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div
                      className={`font-extrabold ${
                        isPositive ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {azn(t.amount)}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {topUpOpen && (
        <TopUpModal
          brigadeId={brigadeId}
          ownerBalance={ownerBalance}
          onClose={() => setTopUpOpen(false)}
          onDone={async () => {
            setTopUpOpen(false);
            await load();
            onChanged();
          }}
        />
      )}

      {distributeOpen && (
        <DistributeModal
          brigadeId={brigadeId}
          brigadeBalance={brigadeBalance}
          members={members.filter((m) => m.is_active)}
          onClose={() => setDistributeOpen(false)}
          onDone={async () => {
            setDistributeOpen(false);
            await load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function TopUpModal({
  brigadeId,
  ownerBalance,
  onClose,
  onDone,
}: {
  brigadeId: string;
  ownerBalance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = parseFloat(amount) || 0;

  const handleSubmit = async () => {
    setError(null);
    if (num <= 0) {
      setError('Düzgün məbləğ daxil edin');
      return;
    }
    if (num > ownerBalance) {
      setError(`Şəxsi balansınız yetərli deyil (cari: ${azn(ownerBalance)})`);
      return;
    }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('brigade_top_up_from_owner', {
      p_brigade_id: brigadeId,
      p_amount: num,
    });
    setSubmitting(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    message.success('Briqada balansı artırıldı');
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">Briqada balansı artır</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted">
            Şəxsi balansınızdan briqadanın balansına köçürmə edirsiniz. Cari şəxsi balans:{' '}
            <b>{azn(ownerBalance)}</b>
          </p>
          <Field label="Məbləğ (₼)" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="100.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          {error && (
            <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold">
              {error}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" size="lg" fullWidth onClick={onClose} disabled={submitting}>
              Ləğv et
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleSubmit}
              disabled={num <= 0 || num > ownerBalance}
            >
              Köçür
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pul bölgüsü Modal ─────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  owner: 'Sahib',
  dispatcher: 'Dispatcher',
  member: 'İşçi',
};

function DistributeModal({
  brigadeId,
  brigadeBalance,
  members,
  onClose,
  onDone,
}: {
  brigadeId: string;
  brigadeBalance: number;
  members: BrigadeMemberLite[];
  onClose: () => void;
  onDone: () => void;
}) {
  // profile_id → məbləğ (string input)
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pool, setPool] = useState(money(brigadeBalance));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAmount = (pid: string, v: string) =>
    setAmounts((prev) => ({ ...prev, [pid]: v }));

  const total = members.reduce(
    (sum, m) => sum + (parseFloat(amounts[m.profile_id] ?? '') || 0),
    0,
  );
  const remaining = brigadeBalance - total;

  // Hər kəsə bərabər böl
  const splitEqual = () => {
    const poolNum = parseFloat(pool) || 0;
    if (poolNum <= 0 || members.length === 0) return;
    const each = Math.floor((poolNum / members.length) * 100) / 100;
    const next: Record<string, string> = {};
    let allocated = 0;
    members.forEach((m, i) => {
      // Yuvarlaqlaşma qalığını sonuncuya ver
      const val = i === members.length - 1
        ? Math.round((poolNum - allocated) * 100) / 100
        : each;
      next[m.profile_id] = money(val);
      allocated += val;
    });
    setAmounts(next);
  };

  // Komissiya faizinə görə böl
  const splitByCommission = () => {
    const poolNum = parseFloat(pool) || 0;
    if (poolNum <= 0 || members.length === 0) return;
    const weights = members.map((m) => Number(m.commission_pct) || 0);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) {
      // Faiz təyin olunmayıbsa bərabər böl
      splitEqual();
      return;
    }
    const next: Record<string, string> = {};
    let allocated = 0;
    members.forEach((m, i) => {
      const val = i === members.length - 1
        ? Math.round((poolNum - allocated) * 100) / 100
        : Math.floor((poolNum * weights[i] / weightSum) * 100) / 100;
      next[m.profile_id] = money(val);
      allocated += val;
    });
    setAmounts(next);
  };

  const handleSubmit = async () => {
    setError(null);
    const allocations = members
      .map((m) => ({
        profile_id: m.profile_id,
        amount: Math.round((parseFloat(amounts[m.profile_id] ?? '') || 0) * 100) / 100,
      }))
      .filter((a) => a.amount > 0);

    if (allocations.length === 0) {
      setError('Ən azı bir üzv üçün məbləğ daxil edin');
      return;
    }
    if (total > brigadeBalance + 0.001) {
      setError(
        `Cəmi məbləğ briqada balansından çoxdur (balans: ${azn(brigadeBalance)})`,
      );
      return;
    }

    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('brigade_distribute_balance', {
      p_brigade_id: brigadeId,
      p_allocations: allocations,
    });
    setSubmitting(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    message.success('Pul bölgüsü tamamlandı');
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">Pul bölgüsü</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-muted">
            Briqada balansından üzvlərin şəxsi balansına pay köçürün. Cari briqada
            balansı: <b>{azn(brigadeBalance)}</b>
          </p>

          {members.length === 0 ? (
            <Card variant="default" padding="md" className="text-center text-muted text-sm">
              Aktiv üzv yoxdur
            </Card>
          ) : (
            <>
              {/* Avtomatik bölgü köməkçiləri */}
              <div className="flex flex-wrap items-end gap-2 p-3 rounded-2xl bg-surface-alt">
                <div className="flex-1 min-w-[120px]">
                  <Field label="Bölünəcək məbləğ (₼)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={pool}
                      onChange={(e) => setPool(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={splitEqual}>
                    Bərabər
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={splitByCommission}>
                    Faizə görə
                  </Button>
                </div>
              </div>

              {/* Üzv siyahısı */}
              <div className="space-y-2">
                {members.map((m) => (
                  <div
                    key={m.profile_id}
                    className="flex items-center gap-3 p-2.5 rounded-2xl border border-border"
                  >
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt={m.name ?? ''}
                        className="w-9 h-9 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-extrabold shrink-0">
                        {(m.name || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-ink text-sm truncate">{m.name ?? '—'}</p>
                      <p className="text-xs text-muted">
                        {ROLE_LABEL[m.role] ?? m.role}
                        {m.commission_pct != null ? ` · ${m.commission_pct}%` : ''}
                      </p>
                    </div>
                    <div className="w-28 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={amounts[m.profile_id] ?? ''}
                        onChange={(e) => setAmount(m.profile_id, e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Cəmi / qalıq */}
              <div className="flex items-center justify-between text-sm font-bold px-1">
                <span className="text-muted">Cəmi: <span className="text-ink">{azn(total)}</span></span>
                <span className={remaining < -0.001 ? 'text-danger' : 'text-muted'}>
                  Qalıq: {azn(remaining)}
                </span>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" size="lg" fullWidth onClick={onClose} disabled={submitting}>
              Ləğv et
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleSubmit}
              disabled={total <= 0 || remaining < -0.001 || members.length === 0}
            >
              Bölgünü təsdiqlə
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
