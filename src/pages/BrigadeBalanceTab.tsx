import { useEffect, useState } from 'react';
import { message } from 'antd';
import {
  ArrowDownToLine,
  Wallet,
  Receipt,
  Plus,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input } from '../components/ui';

interface Tx {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
}

interface Props {
  brigadeId: string;
  brigadeBalance: number;
  isOwner: boolean;
  onChanged: () => void;
}

export default function BrigadeBalanceTab({
  brigadeId,
  brigadeBalance,
  isOwner,
  onChanged,
}: Props) {
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpOpen, setTopUpOpen] = useState(false);
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
          {brigadeBalance.toFixed(2)}
          <span className="text-2xl sm:text-3xl ml-1 opacity-80">₼</span>
        </div>
        <p className="mt-3 text-sm opacity-90">
          Briqada təklifləri komissiyası bu balansdan tutulur. Sahibinin şəxsi balansından ayrıdır.
        </p>
        {isOwner && (
          <Button
            variant="primary"
            size="md"
            className="mt-4 !bg-white !text-brand-700 hover:!bg-white/90"
            leftIcon={<Plus size={16} />}
            onClick={() => setTopUpOpen(true)}
          >
            Balans artır
          </Button>
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
                      {t.amount.toFixed(2)} ₼
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
      setError(`Şəxsi balansınız yetərli deyil (cari: ${ownerBalance.toFixed(2)} ₼)`);
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
            <b>{ownerBalance.toFixed(2)} ₼</b>
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
