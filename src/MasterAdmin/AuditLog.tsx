import { useEffect, useState } from 'react';
import { ShieldCheck, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card, Column, DataTable } from '../components/ui';
import AdminLayout from './AdminLayout';

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: {
    name: string | null;
    email: string | null;
  } | null;
}

const ACTION_COLOR: Record<string, { bg: string; text: string }> = {
  role_change: { bg: 'bg-warning/10', text: 'text-warning' },
  password_change: { bg: 'bg-danger/10', text: 'text-danger' },
  balance_adjust: { bg: 'bg-info/10', text: 'text-info' },
  user_delete: { bg: 'bg-danger/10', text: 'text-danger' },
};

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*, actor:profiles!actor_id(name, email)')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      setRows((data ?? []) as unknown as AuditRow[]);
    } catch (e) {
      console.error('AuditLog load error:', e);
    } finally {
      setLoading(false);
    }
  };

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
      width: '180px',
    },
    {
      key: 'actor',
      header: 'Kim',
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-surface-alt text-muted flex items-center justify-center shrink-0">
            <User size={14} />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-ink text-sm truncate">
              {r.actor?.name ?? '—'}
            </p>
            <p className="text-xs text-muted truncate">
              {r.actor?.email ?? r.actor_id ?? '—'}
            </p>
          </div>
        </div>
      ),
      sortable: true,
      sortAccessor: (r) => r.actor?.name ?? r.actor_id ?? '',
    },
    {
      key: 'action',
      header: 'Əməliyyat',
      cell: (r) => {
        const meta = ACTION_COLOR[r.action] ?? {
          bg: 'bg-surface-alt',
          text: 'text-ink-soft',
        };
        return (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md ${meta.bg} ${meta.text}`}
          >
            {r.action}
          </span>
        );
      },
      sortable: true,
      sortAccessor: (r) => r.action,
      width: '160px',
    },
    {
      key: 'target',
      header: 'Hədəf',
      cell: (r) =>
        r.target_id ? (
          <code className="text-xs text-muted font-mono truncate block">
            {r.target_id}
          </code>
        ) : (
          <span className="text-muted text-xs">—</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'payload',
      header: 'Detal',
      cell: (r) => (
        <details className="text-xs">
          <summary className="cursor-pointer text-brand-600 hover:text-brand-700 font-bold">
            JSON
          </summary>
          <pre className="mt-2 p-2 rounded-lg bg-surface-alt text-xs overflow-x-auto max-w-xs">
            {JSON.stringify(r.payload ?? {}, null, 2)}
          </pre>
        </details>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <AdminLayout
      title="Audit Log"
      subtitle={`${rows.length} qeyd · Sensitiv əməliyyatların tarixçəsi`}
    >
      {rows.length === 0 && !loading ? (
        <Card variant="default" padding="lg" className="text-center">
          <ShieldCheck size={32} className="mx-auto text-muted mb-3" />
          <h2 className="font-extrabold text-ink mb-1">Hələ audit log boşdur</h2>
          <p className="text-sm text-muted">
            Sensitiv admin əməliyyatları (rol dəyişməsi, balans tənzimləmə)
            burada görünəcək.
          </p>
        </Card>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={loading}
          searchKeys={['action', (r) => r.actor?.name ?? '', (r) => r.actor?.email ?? '']}
          searchPlaceholder="Əməliyyat və ya istifadəçi axtar..."
          pageSize={50}
          emptyTitle="Audit log boşdur"
        />
      )}
    </AdminLayout>
  );
}
