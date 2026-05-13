import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card, Column, DataTable } from '../components/ui';
import AdminLayout from './AdminLayout';

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actorProfile?: {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}

interface ActionMeta {
  label: string;
  bg: string;
  text: string;
}

const ACTION_META: Record<string, ActionMeta> = {
  // İstifadəçi
  role_change:           { label: 'Rol dəyişimi',          bg: 'bg-warning/10',  text: 'text-warning' },
  password_change:       { label: 'Parol dəyişimi',        bg: 'bg-danger/10',   text: 'text-danger' },
  admin_password_reset:  { label: 'Parol sıfırlaması',     bg: 'bg-danger/10',   text: 'text-danger' },
  user_delete:           { label: 'İstifadəçi silindi',    bg: 'bg-danger/10',   text: 'text-danger' },
  user_block:            { label: 'İstifadəçi bloku',      bg: 'bg-danger/10',   text: 'text-danger' },

  // Maliyyə
  balance_adjust:        { label: 'Balans tənzimi',        bg: 'bg-info/10',     text: 'text-info' },
  admin_balance_adjust:  { label: 'Admin balans tənzimi',  bg: 'bg-info/10',     text: 'text-info' },
  admin_bonus_adjust:    { label: 'Bonus tənzimi',         bg: 'bg-info/10',     text: 'text-info' },
  admin_credit:          { label: 'Hesaba yatırım',        bg: 'bg-info/10',     text: 'text-info' },
  admin_debit:           { label: 'Hesabdan çıxarım',      bg: 'bg-warning/10',  text: 'text-warning' },
  admin_adjust:          { label: 'Admin tənzimi',         bg: 'bg-info/10',     text: 'text-info' },
  top_up:                { label: 'Balans artırma',        bg: 'bg-success/10',  text: 'text-success' },
  withdrawal_requested:  { label: 'Çıxarış sorğusu',       bg: 'bg-warning/10',  text: 'text-warning' },
  withdrawal_processed:  { label: 'Çıxarış icra edildi',   bg: 'bg-success/10',  text: 'text-success' },
  withdrawal_approve:    { label: 'Çıxarış təsdiqi',       bg: 'bg-success/10',  text: 'text-success' },
  withdrawal_rejected:   { label: 'Çıxarış imtinası',      bg: 'bg-danger/10',   text: 'text-danger' },
  withdrawal_reject:     { label: 'Çıxarış imtinası',      bg: 'bg-danger/10',   text: 'text-danger' },
  withdrawal_failed:     { label: 'Çıxarış uğursuz',       bg: 'bg-danger/10',   text: 'text-danger' },
  withdrawal_cancelled:  { label: 'Çıxarış ləğv',          bg: 'bg-muted/15',    text: 'text-muted' },
  commission_update:     { label: 'Komissiya yeniləməsi',  bg: 'bg-warning/10',  text: 'text-warning' },
  promotion_apply:       { label: 'Promosiya tətbiqi',     bg: 'bg-brand-50',    text: 'text-brand-700' },

  // Briqada
  brigade_apply:         { label: 'Briqada müraciəti',     bg: 'bg-brand-50',    text: 'text-brand-700' },
  brigade_approve:       { label: 'Briqada təsdiqi',       bg: 'bg-success/10',  text: 'text-success' },
  brigade_reject:        { label: 'Briqada imtinası',      bg: 'bg-danger/10',   text: 'text-danger' },
  brigade_dispatch:      { label: 'Sifariş paylama',       bg: 'bg-brand-50',    text: 'text-brand-700' },
  brigade_invite:        { label: 'Briqada dəvəti',        bg: 'bg-brand-50',    text: 'text-brand-700' },
  brigade_invite_accepted: { label: 'Dəvət qəbulu',        bg: 'bg-success/10',  text: 'text-success' },

  // Provayder
  provider_request:      { label: 'Provayder müraciəti',   bg: 'bg-brand-50',    text: 'text-brand-700' },
  provider_approve:      { label: 'Provayder təsdiqi',     bg: 'bg-success/10',  text: 'text-success' },
  provider_reject:       { label: 'Provayder imtinası',    bg: 'bg-danger/10',   text: 'text-danger' },

  // Sifariş
  opportunity_claim:     { label: 'Sifariş qəbulu',        bg: 'bg-emerald-50',  text: 'text-emerald-700' },
};

function actionMeta(action: string): ActionMeta {
  return (
    ACTION_META[action] ?? {
      label: action,
      bg: 'bg-surface-alt',
      text: 'text-ink-soft',
    }
  );
}

const ACTION_FILTERS = [
  { value: 'all',      label: 'Hamısı' },
  { value: 'provider', label: 'Provayder' },
  { value: 'brigade',  label: 'Briqada' },
  { value: 'user',     label: 'İstifadəçi' },
  { value: 'finance',  label: 'Maliyyə' },
] as const;
type ActionFilter = (typeof ACTION_FILTERS)[number]['value'];

function matchesFilter(action: string, filter: ActionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'provider') return action.startsWith('provider_');
  if (filter === 'brigade')
    return action.startsWith('brigade_') || action === 'opportunity_claim';
  if (filter === 'user')
    return [
      'role_change',
      'password_change',
      'admin_password_reset',
      'user_delete',
      'user_block',
    ].includes(action);
  if (filter === 'finance')
    return (
      action.startsWith('withdrawal_') ||
      action.startsWith('admin_') &&
        (action.includes('balance') ||
          action.includes('bonus') ||
          action.includes('credit') ||
          action.includes('debit') ||
          action === 'admin_adjust') ||
      action === 'balance_adjust' ||
      action === 'top_up' ||
      action === 'commission_update' ||
      action === 'promotion_apply'
    );
  return true;
}

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionFilter>('all');

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, actor, actor_id, action, target_type, target_id, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;

      const raw = (data ?? []) as AuditRow[];

      // Actor profillərini ayrıca yüklə — FK auto-discovery-yə güvənmə
      const actorIds = Array.from(
        new Set(
          raw
            .map((r) => r.actor ?? r.actor_id)
            .filter((id): id is string => !!id),
        ),
      );
      let profMap: Record<string, AuditRow['actorProfile']> = {};
      if (actorIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url')
          .in('id', actorIds);
        profMap = Object.fromEntries(
          (profs ?? []).map((p) => [p.id, p as AuditRow['actorProfile']]),
        );
      }

      setRows(
        raw.map((r) => ({
          ...r,
          actorProfile: profMap[r.actor ?? r.actor_id ?? ''] ?? null,
        })),
      );
    } catch (e) {
      console.error('AuditLog load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(
    () => rows.filter((r) => matchesFilter(r.action, filter)),
    [rows, filter],
  );

  const counts = useMemo(() => {
    const c: Record<ActionFilter, number> = {
      all: rows.length,
      provider: 0,
      brigade: 0,
      user: 0,
      finance: 0,
    };
    for (const r of rows) {
      for (const f of ACTION_FILTERS) {
        if (f.value !== 'all' && matchesFilter(r.action, f.value)) {
          c[f.value]++;
        }
      }
    }
    return c;
  }, [rows]);

  const columns: Column<AuditRow>[] = [
    {
      key: 'created',
      header: 'Vaxt',
      cell: (r) => (
        <span className="text-xs text-muted whitespace-nowrap">
          {new Date(r.created_at).toLocaleString('az', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
      sortable: true,
      sortAccessor: (r) => r.created_at,
      width: '170px',
    },
    {
      key: 'actor',
      header: 'Kim',
      cell: (r) => {
        const p = r.actorProfile;
        const actorId = r.actor ?? r.actor_id;
        return (
          <div className="flex items-center gap-2 min-w-0">
            {p?.avatar_url ? (
              <img
                src={p.avatar_url}
                alt={p.name ?? ''}
                className="w-7 h-7 rounded-lg object-cover shrink-0"
              />
            ) : (
              <span className="w-7 h-7 rounded-lg bg-surface-alt text-muted flex items-center justify-center shrink-0">
                <User size={14} />
              </span>
            )}
            <div className="min-w-0">
              <p className="font-bold text-ink text-sm truncate">
                {p?.name ??
                  p?.email ??
                  (actorId ? `ID: ${actorId.slice(0, 8)}` : '—')}
              </p>
              <p className="text-xs text-muted truncate">
                {p?.email ?? actorId ?? '—'}
              </p>
            </div>
          </div>
        );
      },
      sortable: true,
      sortAccessor: (r) =>
        r.actorProfile?.name ?? r.actorProfile?.email ?? r.actor ?? r.actor_id ?? '',
    },
    {
      key: 'action',
      header: 'Əməliyyat',
      cell: (r) => {
        const meta = actionMeta(r.action);
        return (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md ${meta.bg} ${meta.text}`}
            title={r.action}
          >
            {meta.label}
          </span>
        );
      },
      sortable: true,
      sortAccessor: (r) => r.action,
      width: '180px',
    },
    {
      key: 'target',
      header: 'Hədəf',
      cell: (r) =>
        r.target_id ? (
          <div className="text-xs min-w-0">
            {r.target_type && (
              <p className="font-bold text-ink-soft">{r.target_type}</p>
            )}
            <code className="text-muted font-mono truncate block">
              {r.target_id}
            </code>
          </div>
        ) : (
          <span className="text-muted text-xs">—</span>
        ),
      hideOnMobile: true,
      width: '200px',
    },
    {
      key: 'payload',
      header: 'Detal',
      cell: (r) => {
        const payload = r.payload ?? {};
        const keys = Object.keys(payload);
        if (keys.length === 0) {
          return <span className="text-muted text-xs">—</span>;
        }
        return (
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-600 hover:text-brand-700 font-bold">
              {keys.length} sahə
            </summary>
            <pre className="mt-2 p-2 rounded-lg bg-surface-alt text-xs overflow-x-auto max-w-xs">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        );
      },
      hideOnMobile: true,
    },
  ];

  return (
    <AdminLayout
      title="Audit Log"
      subtitle={`${rows.length} qeyd · Sensitiv əməliyyatların tarixçəsi`}
    >
      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap mb-4">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-xl text-sm font-bold transition-all border ${
              filter === f.value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-ink-soft border-border hover:border-brand-300'
            }`}
          >
            {f.label}
            <span
              className={`ml-1.5 px-1.5 py-0.5 rounded-md text-xs ${
                filter === f.value
                  ? 'bg-white/20'
                  : 'bg-surface-alt text-muted'
              }`}
            >
              {counts[f.value]}
            </span>
          </button>
        ))}
      </div>

      {rows.length === 0 && !loading ? (
        <Card variant="default" padding="lg" className="text-center">
          <ShieldCheck size={32} className="mx-auto text-muted mb-3" />
          <h2 className="font-extrabold text-ink mb-1">Hələ audit log boşdur</h2>
          <p className="text-sm text-muted">
            Sensitiv admin əməliyyatları (rol dəyişməsi, balans tənzimləmə,
            briqada/provayder təsdiqi) burada görünəcək.
          </p>
        </Card>
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          loading={loading}
          searchKeys={[
            'action',
            (r) => actionMeta(r.action).label,
            (r) => r.actorProfile?.name ?? '',
            (r) => r.actorProfile?.email ?? '',
            (r) => r.target_id ?? '',
          ]}
          searchPlaceholder="Əməliyyat, istifadəçi və ya hədəf axtar..."
          pageSize={50}
          emptyTitle="Bu filtrə uyğun qeyd yoxdur"
        />
      )}
    </AdminLayout>
  );
}
