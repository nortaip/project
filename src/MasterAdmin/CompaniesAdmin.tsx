import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  Coins,
  RefreshCw,
  ScrollText,
  Search,
  Users as UsersIcon,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CompanyRow {
  id: string;
  name: string;
  is_verified: boolean;
  is_active: boolean;
  balance: number;
  rating: number;
  total_orders: number;
  created_at: string;
  owner_name: string | null;
  member_count: number;
  online_count: number;
  offer_count: number;
}

interface Member {
  member_id: string;
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
  commission_pct: number | null;
  is_active: boolean;
  is_online: boolean;
  joined_at: string;
  done_count: number;
}

interface Order {
  offer_id: string;
  opportunity_id: string;
  title: string | null;
  amount: number | null;
  status: string;
  payment_method: string | null;
  created_at: string;
  worker_name: string | null;
  worker_status: string | null;
}

interface FinanceRow {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
  user_name: string | null;
}

interface LogRow {
  id: string;
  action: string;
  target_type: string | null;
  created_at: string;
  actor_name: string | null;
  payload: Record<string, unknown> | null;
}

interface Detail {
  brigade: Record<string, unknown>;
  members: Member[];
  orders: Order[];
  finance: FinanceRow[];
  logs: LogRow[];
}

function fmtMoney(n: number | null | undefined): string {
  return new Intl.NumberFormat('az-AZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTION_LABELS: Record<string, string> = {
  brigade_dispatch_assign: 'Sifariş işçiyə yönləndirildi',
  brigade_dispatch: 'Sifariş yönləndirildi',
  brigade_payout: 'Pul bölgüsü',
  offer_accepted: 'Təklif qəbul edildi',
  user_block: 'İstifadəçi bloklandı',
  assignment_offered: 'Sifariş təklif olundu (işçiyə)',
  assignment_assigned: 'İşçiyə təyin edildi',
  assignment_accepted: 'İşçi qəbul etdi',
  assignment_declined: 'İşçi imtina etdi',
  assignment_in_progress: 'İş başladı',
  assignment_completed: 'İş tamamlandı',
  assignment_cancelled: 'Ləğv edildi',
  assignment_expired: 'Vaxtı keçdi',
  opportunity_claim: 'İşçi sifarişi götürdü',
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Sahib',
  dispatcher: 'Dispatçer',
  member: 'İşçi',
};

export default function CompaniesAdmin() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadList = async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('admin_companies_list');
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setCompanies((data ?? []) as CompanyRow[]);
  };

  useEffect(() => {
    void loadList();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.owner_name ?? '').toLowerCase().includes(q),
    );
  }, [companies, search]);

  if (selectedId) {
    return (
      <CompanyDetail
        brigadeId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void loadList();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Şirkət və ya sahib adı…"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-border text-sm outline-none focus:border-brand-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-white border border-border text-sm font-bold text-ink-soft hover:text-brand-600"
        >
          <RefreshCw size={15} /> Yenilə
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="inline-block w-8 h-8 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted">Şirkət tapılmadı</div>
      ) : (
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-muted">
                <tr className="text-left">
                  <th className="px-4 py-3 font-bold">Şirkət</th>
                  <th className="px-4 py-3 font-bold">Sahib</th>
                  <th className="px-4 py-3 font-bold">İşçilər</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">Balans</th>
                  <th className="px-4 py-3 font-bold">Təkliflər</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer hover:bg-surface-alt/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                          <Building2 size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-ink line-clamp-1">{c.name}</div>
                          <div className="text-xs text-muted">
                            {c.total_orders} tamamlanmış · ⭐ {c.rating?.toFixed?.(1) ?? '0.0'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{c.owner_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-ink">{c.member_count}</span>
                      <span className="text-emerald-600 text-xs font-bold ml-1.5">
                        {c.online_count} online
                      </span>
                    </td>
                    <td className="px-4 py-3 font-extrabold text-ink whitespace-nowrap">
                      {fmtMoney(c.balance)} ₼
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{c.offer_count}</td>
                    <td className="px-4 py-3">
                      {c.is_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                          <CheckCircle2 size={12} /> Təsdiqli
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
                          Gözləyir
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Company Detail ──────────────────────────────────────────────────────────

type Tab = 'members' | 'orders' | 'finance' | 'logs';

function CompanyDetail({ brigadeId, onBack }: { brigadeId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('admin_company_detail', {
      p_brigade_id: brigadeId,
    });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setDetail(data as Detail);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadeId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block w-8 h-8 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600">
          <ArrowLeft size={16} /> Geri
        </button>
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-semibold">
          {error ?? 'Yüklənmədi'}
        </div>
      </div>
    );
  }

  const b = detail.brigade as {
    name: string;
    owner_name: string | null;
    balance: number;
    is_verified: boolean;
    categories?: string[];
    contact_phone?: string | null;
    contact_email?: string | null;
    address?: string | null;
    total_orders?: number;
    rating?: number;
  };

  const TABS: Array<{ key: Tab; label: string; icon: typeof UsersIcon; count: number }> = [
    { key: 'members', label: 'İşçilər', icon: UsersIcon, count: detail.members.length },
    { key: 'orders', label: 'Sifarişlər', icon: ClipboardList, count: detail.orders.length },
    { key: 'finance', label: 'Maliyyə', icon: Coins, count: detail.finance.length },
    { key: 'logs', label: 'Loglar', icon: ScrollText, count: detail.logs.length },
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600">
        <ArrowLeft size={16} /> Bütün şirkətlər
      </button>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-border p-5 flex flex-wrap items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <Building2 size={26} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-extrabold text-ink">{b.name}</h2>
            {b.is_verified && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg">
                <CheckCircle2 size={12} /> Təsdiqli
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Sahib: <b className="text-ink-soft">{b.owner_name ?? '—'}</b>
            {b.contact_phone ? ` · ${b.contact_phone}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 bg-gradient-to-br from-brand-600 to-accent-500 text-white rounded-2xl px-4 py-3">
          <Wallet size={18} />
          <div>
            <div className="text-[11px] uppercase font-bold opacity-90">Balans</div>
            <div className="text-lg font-extrabold leading-tight">{fmtMoney(b.balance)} ₼</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Icon size={15} /> {t.label}
              <span className="text-xs opacity-70">({t.count})</span>
            </button>
          );
        })}
      </div>

      {tab === 'members' && <MembersTab members={detail.members} />}
      {tab === 'orders' && <OrdersTab orders={detail.orders} />}
      {tab === 'finance' && <FinanceTab finance={detail.finance} />}
      {tab === 'logs' && <LogsTab logs={detail.logs} />}
    </div>
  );
}

function MembersTab({ members }: { members: Member[] }) {
  if (members.length === 0) return <Empty text="Hələ işçi yoxdur" />;
  return (
    <Table headers={['İşçi', 'Rol', 'Komissiya %', 'Tamamlanmış', 'Status']}>
      {members.map((m) => (
        <tr key={m.member_id} className="hover:bg-surface-alt/60">
          <td className="px-4 py-3 font-bold text-ink">{m.name ?? '—'}</td>
          <td className="px-4 py-3 text-ink-soft">{ROLE_LABELS[m.role] ?? m.role}</td>
          <td className="px-4 py-3 font-extrabold text-ink">
            {m.commission_pct != null ? `${m.commission_pct}%` : '—'}
          </td>
          <td className="px-4 py-3 text-ink-soft">{m.done_count}</td>
          <td className="px-4 py-3">
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${
                m.is_online ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-alt text-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${m.is_online ? 'bg-emerald-500' : 'bg-muted/50'}`} />
              {m.is_online ? 'Online' : 'Offline'}
            </span>
          </td>
        </tr>
      ))}
    </Table>
  );
}

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Gözləyir', cls: 'bg-amber-50 text-amber-700' },
  accepted: { label: 'Qəbul edildi', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rədd edildi', cls: 'bg-rose-50 text-rose-700' },
  completed: { label: 'Tamamlandı', cls: 'bg-violet-50 text-violet-700' },
};

function OrdersTab({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <Empty text="Hələ sifariş yoxdur" />;
  return (
    <Table headers={['Sifariş', 'Məbləğ', 'Ödəniş', 'İşçi', 'Status', 'Tarix']}>
      {orders.map((o) => {
        const st = ORDER_STATUS[o.status] ?? { label: o.status, cls: 'bg-surface-alt text-muted' };
        return (
          <tr key={o.offer_id} className="hover:bg-surface-alt/60">
            <td className="px-4 py-3 font-bold text-ink line-clamp-1">{o.title || 'Sifariş'}</td>
            <td className="px-4 py-3 font-extrabold text-ink whitespace-nowrap">
              {o.amount != null ? `${fmtMoney(o.amount)} ₼` : '—'}
            </td>
            <td className="px-4 py-3 text-ink-soft">
              {o.payment_method === 'card' ? 'Kart' : o.payment_method === 'cash' ? 'Nağd' : '—'}
            </td>
            <td className="px-4 py-3 text-ink-soft">{o.worker_name ?? '—'}</td>
            <td className="px-4 py-3">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${st.cls}`}>{st.label}</span>
            </td>
            <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{fmtDate(o.created_at)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function FinanceTab({ finance }: { finance: FinanceRow[] }) {
  if (finance.length === 0) return <Empty text="Hələ maliyyə hərəkəti yoxdur" />;
  return (
    <Table headers={['Əməliyyat', 'İstifadəçi', 'Məbləğ', 'Tarix']}>
      {finance.map((f) => {
        const positive = f.amount > 0;
        return (
          <tr key={f.id} className="hover:bg-surface-alt/60">
            <td className="px-4 py-3">
              <div className="font-bold text-ink">{f.description ?? f.type}</div>
              <div className="text-xs text-muted">{f.type}</div>
            </td>
            <td className="px-4 py-3 text-ink-soft">{f.user_name ?? '—'}</td>
            <td className={`px-4 py-3 font-extrabold whitespace-nowrap ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
              {positive ? '+' : ''}
              {fmtMoney(f.amount)} ₼
            </td>
            <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{fmtDate(f.created_at)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function LogsTab({ logs }: { logs: LogRow[] }) {
  if (logs.length === 0) return <Empty text="Hələ log yoxdur" />;
  return (
    <div className="bg-white rounded-2xl border border-border divide-y divide-border">
      {logs.map((l) => (
        <div key={l.id} className="px-4 py-3 flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink text-sm">
              {ACTION_LABELS[l.action] ?? l.action}
            </div>
            <div className="text-xs text-muted">
              {l.actor_name ? `${l.actor_name} · ` : ''}
              {fmtDate(l.created_at)}
            </div>
            {(l.payload?.dispatcher_name != null || l.payload?.worker_name != null) && (
              <div className="text-xs text-ink-soft mt-0.5">
                {l.payload?.dispatcher_name != null && (
                  <>Dispatçer: <b>{String(l.payload.dispatcher_name)}</b></>
                )}
                {l.payload?.worker_name != null && (
                  <> · İşçi: <b>{String(l.payload.worker_name)}</b></>
                )}
                {l.payload?.amount != null && <> · {fmtMoney(Number(l.payload.amount))} ₼</>}
              </div>
            )}
            {l.payload?.status != null && l.payload?.worker_name == null && (
              <div className="text-xs text-ink-soft mt-0.5">
                Status: {String(l.payload.status)}
                {l.payload.old_status ? ` (əvvəl: ${String(l.payload.old_status)})` : ''}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-muted">
            <tr className="text-left">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 font-bold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center py-12 text-muted text-sm bg-white rounded-2xl border border-border">{text}</div>;
}
