import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Filter,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  Settings2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Withdrawal {
  id: string;
  provider_id: string;
  amount_requested: number;
  commission_percent: number;
  commission_amount: number;
  net_amount: number;
  bank_card: string | null;
  status: 'pending' | 'processed' | 'rejected' | string;
  admin_notes: string | null;
  external_id: string | null;
  requested_at: string;
  processed_at: string | null;
}

interface Profile {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
}

type StatusFilter = 'pending' | 'processed' | 'rejected' | 'all';

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'pending', label: 'Gözləyən' },
  { key: 'processed', label: 'Emal olunmuş' },
  { key: 'rejected', label: 'Rədd edilmiş' },
  { key: 'all', label: 'Hamısı' },
];

function fmtMoney(n: number, decimals = 2): string {
  return new Intl.NumberFormat('az-AZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WithdrawalsPage() {
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    wd: Withdrawal;
    action: 'payout' | 'manual' | 'reject';
  } | null>(null);
  const [modalNotes, setModalNotes] = useState('');
  const [modalError, setModalError] = useState<{
    message: string;
    suggestSwitchToManual?: boolean;
  } | null>(null);
  const [adjustModal, setAdjustModal] = useState<{ providerId: string; providerName: string } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('withdrawals')
        .select(
          'id, provider_id, amount_requested, commission_percent, commission_amount, net_amount, bank_card, status, admin_notes, external_id, requested_at, processed_at',
        )
        .order('requested_at', { ascending: false });
      if (dbErr) throw dbErr;
      const list = (data ?? []) as Withdrawal[];
      setRows(list);

      const ids = Array.from(new Set(list.map((r) => r.provider_id)));
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, phone_number, email')
          .in('id', ids);
        const map: Record<string, Profile> = {};
        for (const p of (profs ?? []) as Profile[]) map[p.id] = p;
        setProfiles(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!q) return true;
      const p = profiles[r.provider_id];
      return (
        r.id.toLowerCase().includes(q) ||
        r.bank_card?.toLowerCase().includes(q) ||
        p?.name?.toLowerCase().includes(q) ||
        p?.phone_number?.toLowerCase().includes(q) ||
        p?.email?.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search, profiles]);

  const counts = useMemo(() => {
    return {
      pending: rows.filter((r) => r.status === 'pending').length,
      processed: rows.filter((r) => r.status === 'processed').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      total: rows.length,
      pendingAmount: rows
        .filter((r) => r.status === 'pending')
        .reduce((s, r) => s + Number(r.amount_requested), 0),
      processedAmount: rows
        .filter((r) => r.status === 'processed')
        .reduce((s, r) => s + Number(r.net_amount), 0),
    };
  }, [rows]);

  async function executeAction(
    wd: Withdrawal,
    action: 'payout' | 'manual' | 'reject',
    notes: string,
  ) {
    setBusyId(wd.id);
    setError(null);
    setModalError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke(
        'process-withdrawal',
        {
          body: {
            withdrawal_id: wd.id,
            action,
            notes: notes.trim() || undefined,
          },
        },
      );

      // Edge function 4xx/5xx qaytarsa, supabase-js invErr-i FunctionsHttpError
      // edir. JSON body-ni `invErr.context.response`-dan oxumaq lazımdır.
      let payload: Record<string, unknown> | null =
        (data as Record<string, unknown> | null) ?? null;

      if (invErr) {
        const ctx = (invErr as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          try {
            payload = await ctx.response.clone().json();
          } catch {
            // not JSON
          }
        }
      }

      if (payload?.error) {
        const msg = String(payload.error);
        const suggestManual = Boolean(payload.requires_card_registration);
        setModalError({
          message: msg,
          suggestSwitchToManual: suggestManual && action === 'payout',
        });
        return;
      }
      if (invErr) {
        setModalError({ message: invErr.message || 'Naməlum xəta' });
        return;
      }

      // Uğurlu
      await load(true);
      setConfirmModal(null);
      setModalNotes('');
    } catch (e) {
      setModalError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  function maskCard(card: string | null): string {
    if (!card) return '—';
    const cleaned = card.replace(/\s/g, '');
    if (cleaned.length <= 8) return cleaned;
    return `${cleaned.slice(0, 4)} •••• ${cleaned.slice(-4)}`;
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Gözləyən"
          value={loading ? '—' : counts.pending}
          hint={`${fmtMoney(counts.pendingAmount, 0)} ₼`}
          tint="amber"
          icon={<Clock size={16} />}
        />
        <StatCard
          label="Emal olunmuş"
          value={loading ? '—' : counts.processed}
          hint={`Net ${fmtMoney(counts.processedAmount, 0)} ₼ köçürülüb`}
          tint="emerald"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="Rədd edilmiş"
          value={loading ? '—' : counts.rejected}
          hint="Geri qaytarılıb"
          tint="rose"
          icon={<XCircle size={16} />}
        />
        <StatCard
          label="Cəmi"
          value={loading ? '—' : counts.total}
          hint="Bütün vaxtlar"
          tint="brand"
          icon={<Banknote size={16} />}
        />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-ink-soft text-sm font-bold">
            <Filter size={16} /> Status filtri
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAdjustModal({ providerId: '', providerName: '' })}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-border text-sm font-bold text-ink-soft hover:text-brand-700 hover:border-brand-300 transition-colors"
              title="İstənilən istifadəçinin balansını manual artır/azalt"
            >
              <Settings2 size={14} /> Balans tənzimlə
            </button>
            <div className="relative w-full sm:w-72">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Provayder, kart, ID..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-border text-sm font-bold text-ink-soft hover:text-brand-700 hover:border-brand-300 disabled:opacity-50 transition-colors"
              title="Yenilə"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-colors ${
                  active
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-ink-soft border-border hover:border-brand-300'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center text-muted">
          Yüklənir...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center text-muted">
          Bu filtrə uyğun nağdlaşdırma sorğusu yoxdur
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((wd) => {
            const p = profiles[wd.provider_id];
            const card = maskCard(wd.bank_card);
            return (
              <div
                key={wd.id}
                className="bg-white border border-border rounded-2xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  {/* Left */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-extrabold text-ink text-lg">
                        {p?.name ?? wd.provider_id.slice(0, 8)}
                      </h3>
                      <StatusBadge status={wd.status} />
                    </div>
                    <p className="text-sm text-ink-soft mt-1">
                      {p?.phone_number ?? p?.email ?? '—'}
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <CardChip card={card} fullCard={wd.bank_card} />
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted font-mono">
                        ID: {wd.id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">
                        Tələb: {fmtDateTime(wd.requested_at)}
                      </span>
                    </div>
                    {wd.processed_at && (
                      <p className="text-xs text-muted mt-1">
                        Emal: {fmtDateTime(wd.processed_at)}
                        {wd.external_id && (
                          <>
                            {' · '}
                            <span className="font-mono text-emerald-700">
                              Epoint: {wd.external_id}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                    {wd.admin_notes && (
                      <p className="text-xs text-ink-soft mt-2 p-2 rounded-lg bg-surface-alt">
                        <b>Qeyd:</b> {wd.admin_notes}
                      </p>
                    )}
                  </div>

                  {/* Right — amounts */}
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted font-bold uppercase">
                      Tələb edilən
                    </p>
                    <p className="text-2xl font-extrabold text-ink">
                      {fmtMoney(wd.amount_requested)} ₼
                    </p>
                    <div className="flex flex-col items-end gap-0.5 mt-2">
                      <p className="text-xs text-muted">
                        Komissiya {wd.commission_percent}%: −
                        {fmtMoney(wd.commission_amount)} ₼
                      </p>
                      <p className="text-sm font-extrabold text-emerald-700">
                        Net: {fmtMoney(wd.net_amount)} ₼
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {wd.status === 'pending' && (
                  <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={busyId === wd.id}
                      onClick={() => {
                        setModalNotes('');
                        setConfirmModal({ wd, action: 'manual' });
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busyId === wd.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Manual emal (banka köçürdüm)
                    </button>
                    <button
                      type="button"
                      disabled={busyId === wd.id}
                      onClick={() => {
                        setModalNotes('');
                        setConfirmModal({ wd, action: 'payout' });
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-brand-300 text-brand-700 font-bold text-sm hover:bg-brand-50 disabled:opacity-50"
                      title="Epoint card_uid qeydiyyatı tələb olunur (sənədlərə baxın)"
                    >
                      <Send size={14} /> Epoint API
                    </button>
                    <button
                      type="button"
                      disabled={busyId === wd.id}
                      onClick={() => {
                        setModalNotes('');
                        setConfirmModal({ wd, action: 'reject' });
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-rose-300 text-rose-700 font-bold text-sm hover:bg-rose-50 disabled:opacity-50"
                    >
                      <XCircle size={14} /> Rədd et
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          wd={confirmModal.wd}
          action={confirmModal.action}
          notes={modalNotes}
          onNotesChange={setModalNotes}
          busy={busyId === confirmModal.wd.id}
          error={modalError}
          onCancel={() => {
            setConfirmModal(null);
            setModalNotes('');
            setModalError(null);
          }}
          onConfirm={() => executeAction(confirmModal.wd, confirmModal.action, modalNotes)}
          onSwitchToManual={() => {
            setModalError(null);
            setConfirmModal({ wd: confirmModal.wd, action: 'manual' });
          }}
          maskedCard={maskCard(confirmModal.wd.bank_card)}
          providerName={profiles[confirmModal.wd.provider_id]?.name ?? confirmModal.wd.provider_id.slice(0, 8)}
        />
      )}

      {adjustModal && (
        <BalanceAdjustModal
          initialUserId={adjustModal.providerId}
          onClose={() => setAdjustModal(null)}
          onDone={() => {
            setAdjustModal(null);
            void load(true);
          }}
        />
      )}
    </div>
  );
}

// ─── Balance adjust modal ──────────────────────────────────────────────
function BalanceAdjustModal({
  initialUserId,
  onClose,
  onDone,
}: {
  initialUserId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState(initialUserId);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<'balance' | 'bonus' | 'locked'>('balance');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // User search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, phone_number, email')
        .or(`name.ilike.%${searchQuery}%,phone_number.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
        .limit(8);
      setSearchResults((data ?? []) as Profile[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function submit() {
    setError(null);
    setSuccess(null);
    const num = Number(amount.replace(',', '.'));
    if (!userId || !Number.isFinite(num) || num === 0 || !reason.trim()) {
      setError('İstifadəçi, məbləğ və səbəb tələb olunur (məbləğ sıfır ola bilməz)');
      return;
    }
    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc('admin_adjust_balance', {
      p_user_id: userId,
      p_amount: num,
      p_reason: reason.trim(),
      p_target: target,
    });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setSuccess(Number(data));
    setTimeout(onDone, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-5 border-b border-border">
          <h3 className="font-extrabold text-ink text-lg flex items-center gap-2">
            <PlusCircle size={20} className="text-brand-600" />
            Balans tənzimlə
          </h3>
          <p className="text-xs text-muted mt-1">
            Provayder və ya müştərinin balansını manual artır/azalt
          </p>
        </div>

        <div className="p-5 space-y-3">
          {!selectedUser ? (
            <div>
              <label className="block text-xs font-bold text-ink-soft mb-1">
                İstifadəçi tap (ad, telefon, email)
              </label>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Adı / telefonu / emaili daxil et..."
                autoFocus
                className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
              />
              {searchResults.length > 0 && (
                <div className="mt-2 border border-border rounded-xl divide-y divide-border max-h-60 overflow-y-auto">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setSelectedUser(u);
                        setUserId(u.id);
                        setSearchResults([]);
                      }}
                      className="w-full text-left p-3 hover:bg-surface-alt"
                    >
                      <p className="font-bold text-ink text-sm">{u.name ?? '—'}</p>
                      <p className="text-xs text-muted">
                        {u.phone_number ?? u.email ?? u.id.slice(0, 8)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-surface-alt flex items-center justify-between">
              <div>
                <p className="font-bold text-ink">{selectedUser.name ?? '—'}</p>
                <p className="text-xs text-muted">
                  {selectedUser.phone_number ?? selectedUser.email ?? selectedUser.id.slice(0, 8)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUser(null);
                  setUserId('');
                }}
                className="text-xs text-brand-600 font-bold hover:text-brand-700"
              >
                Dəyiş
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink-soft mb-1">Tip</label>
            <div className="flex gap-2">
              {(['balance', 'bonus', 'locked'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
                    target === t
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-ink-soft border-border'
                  }`}
                >
                  {t === 'balance' ? 'Balans' : t === 'bonus' ? 'Bonus' : 'Locked'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-soft mb-1">
              Məbləğ (mənfi: azalt, müsbət: artır)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="məs: 50 və ya -30"
              className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-soft mb-1">
              Səbəb (audit log-a düşür)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="məs: Test crediti, kompensasiya, hata düzəlişi..."
              className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success !== null && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 text-sm flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>Uğurla yeniləndi. Yeni balans: <b>{success.toFixed(2)} ₼</b></span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-surface-alt"
          >
            Ləğv
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !userId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
            Tətbiq et
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── sub-components ─────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  hint,
  tint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tint: 'brand' | 'amber' | 'emerald' | 'rose';
  icon: React.ReactNode;
}) {
  const tints: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tints[tint]}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-extrabold text-ink mt-2">{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
    pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Gözləyir', Icon: Clock },
    processed: {
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Emal olundu',
      Icon: CheckCircle2,
    },
    rejected: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rədd edildi', Icon: XCircle },
  };
  const m = map[status] ?? { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: status, Icon: Clock };
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${m.cls}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

function CardChip({ card, fullCard }: { card: string; fullCard: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (!fullCard) return;
        navigator.clipboard.writeText(fullCard.replace(/\s/g, ''));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-surface-alt hover:bg-border text-xs font-mono text-ink transition-colors"
      title="Tam kart nömrəsini kopyala"
    >
      <CreditCard size={12} className="text-muted" />
      {card}
      {copied ? (
        <CheckCircle2 size={12} className="text-emerald-600" />
      ) : (
        <Copy size={12} className="text-muted" />
      )}
    </button>
  );
}

function ConfirmModal({
  wd,
  action,
  notes,
  onNotesChange,
  busy,
  error,
  onCancel,
  onConfirm,
  onSwitchToManual,
  maskedCard,
  providerName,
}: {
  wd: Withdrawal;
  action: 'payout' | 'manual' | 'reject';
  notes: string;
  onNotesChange: (v: string) => void;
  busy: boolean;
  error: { message: string; suggestSwitchToManual?: boolean } | null;
  onCancel: () => void;
  onConfirm: () => void;
  onSwitchToManual: () => void;
  maskedCard: string;
  providerName: string;
}) {
  const titles = {
    payout: 'Epoint payout',
    manual: 'Manual emal',
    reject: 'Sorğunu rədd et',
  };
  const descs = {
    payout: `${wd.net_amount} ₼ məbləği Epoint card-payout API-si ilə ${maskedCard} kartına/IBAN-a göndəriləcək. Provayder dərhal məlumatlandırılır.`,
    manual: `${wd.net_amount} ₼ məbləğin əl ilə (məs. bank köçürməsi) göndərildiyini təsdiqləyirsən. Sistem statusu "emal olundu" olaraq yeniləyəcək.`,
    reject: `${wd.amount_requested} ₼ məbləği provayderin balansına geri qaytarılacaq və sorğu rədd kimi qeyd ediləcək.`,
  };
  const ctaCls = {
    payout: 'bg-brand-600 hover:bg-brand-700 text-white',
    manual: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    reject: 'bg-rose-600 hover:bg-rose-700 text-white',
  };
  // Xəta varsa, tam ekran error view göstər (Payment Result səhifəsi kimi)
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 sm:p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center mb-5">
            <AlertCircle size={42} />
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink mb-2 tracking-tight">
            {error.suggestSwitchToManual
              ? 'Epoint payout mümkün deyil'
              : 'Əməliyyat alınmadı'}
          </h2>
          <p className="text-sm text-muted leading-relaxed mb-6">
            {error.message}
          </p>
          {error.suggestSwitchToManual && (
            <div className="rounded-xl bg-surface-alt p-4 text-left text-xs text-ink-soft mb-6 leading-relaxed">
              <p className="font-bold text-ink mb-1">Niyə baş verir?</p>
              <p className="mb-2">
                Epoint API yalnız qeydiyyatdan keçmiş kartlara payout göndərə bilir.
                Provayder gələcəkdə öz kartını sistemə qeydiyyat etsə, bu düymə işləyəcək.
              </p>
              <p className="font-bold text-ink mb-1">Nə etmək olar?</p>
              <p>
                İndilik pulu banka manual göndər (məs. internet banking) və
                "Manual emala keç" düyməsi ilə sistemi məlumatlandır.
              </p>
            </div>
          )}
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white border border-border text-ink-soft hover:bg-surface-alt"
            >
              Bağla
            </button>
            {error.suggestSwitchToManual && (
              <button
                type="button"
                onClick={onSwitchToManual}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 size={14} /> Manual emala keç
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-5 border-b border-border">
          <h3 className="font-extrabold text-ink text-lg">{titles[action]}</h3>
          <p className="text-sm text-muted mt-1">Provayder: <b>{providerName}</b></p>
        </div>
        <div className="p-5">
          <p className="text-sm text-ink-soft mb-4 leading-relaxed">{descs[action]}</p>

          <div className="bg-surface-alt rounded-xl p-3 text-sm space-y-1 mb-4">
            <div className="flex justify-between">
              <span className="text-muted">Tələb edilən:</span>
              <span className="font-bold text-ink">{fmtMoney(wd.amount_requested)} ₼</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Komissiya:</span>
              <span className="font-bold text-ink">
                −{fmtMoney(wd.commission_amount)} ₼
              </span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border">
              <span className="text-muted">Köçürüləcək net:</span>
              <span className="font-extrabold text-emerald-700">
                {fmtMoney(wd.net_amount)} ₼
              </span>
            </div>
          </div>

          <label className="block text-xs font-bold text-ink-soft mb-1">
            Qeyd (opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={3}
            placeholder={action === 'reject' ? 'Niyə rədd edildiyini izah et...' : 'Daxili qeyd...'}
            className="w-full px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
          />
        </div>
        <div className="p-5 border-t border-border flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-surface-alt disabled:opacity-50"
          >
            Ləğv et
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${ctaCls[action]}`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Təsdiqlə
          </button>
        </div>
      </div>
    </div>
  );
}
