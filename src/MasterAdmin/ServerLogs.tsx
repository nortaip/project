import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ScrollText, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card, Column, DataTable } from '../components/ui';
import AdminLayout from './AdminLayout';

/**
 * Server jurnalı — serverdə baş verən hər şey (server_logs cədvəli):
 *  - istifadəçi əməliyyatları (sifariş, təklif, giriş, ödəniş cavabı …),
 *  - push / WhatsApp / e-poçt göndərişləri,
 *  - dövri işlər və Supabase sinxronu,
 *  - xətalar (traceback ilə).
 * Yalnız adminlər oxuyur. Qeydlər 14 gün saxlanılır.
 */

interface LogRow {
  id: number;
  created_at: string;
  level: string;
  source: string;
  logger: string | null;
  message: string;
  context: Record<string, unknown> | null;
}

type LevelFilter = 'all' | 'problems' | 'ERROR';
type CategoryFilter = 'all' | 'http' | 'push' | 'payment' | 'cron' | 'messaging' | 'other';

const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'Hamısı' },
  { value: 'problems', label: 'Xəta + xəbərdarlıq' },
  { value: 'ERROR', label: 'Yalnız xətalar' },
];

const CATEGORY_FILTERS: { value: CategoryFilter; label: string; loggers?: string[] }[] = [
  { value: 'all', label: 'Bütün mənbələr' },
  { value: 'http', label: 'İstifadəçi əməliyyatları', loggers: ['ellit.http'] },
  { value: 'push', label: 'Push bildirişlər', loggers: ['ellit.push'] },
  { value: 'payment', label: 'Ödəniş (Epoint)', loggers: ['ellit.functions'] },
  { value: 'cron', label: 'Dövri işlər / sinxron', loggers: ['cron', 'ellit.worker'] },
  { value: 'messaging', label: 'WhatsApp / e-poçt', loggers: ['ellit.whatsapp', 'ellit.mail'] },
  { value: 'other', label: 'Digər' },
];

const KNOWN_LOGGERS = CATEGORY_FILTERS.flatMap((c) => c.loggers ?? []);

const LEVEL_META: Record<string, { label: string; cls: string }> = {
  ERROR: { label: 'Xəta', cls: 'bg-danger/10 text-danger' },
  CRITICAL: { label: 'Kritik', cls: 'bg-danger/10 text-danger' },
  WARNING: { label: 'Xəbərdarlıq', cls: 'bg-warning/10 text-warning' },
  INFO: { label: 'Məlumat', cls: 'bg-info/10 text-info' },
};

const LOGGER_LABEL: Record<string, string> = {
  'ellit.http': 'Əməliyyat',
  'ellit.push': 'Push',
  'ellit.functions': 'Ödəniş',
  cron: 'Dövri iş',
  'ellit.worker': 'Worker',
  'ellit.whatsapp': 'WhatsApp',
  'ellit.mail': 'E-poçt',
  'ellit.gotrue': 'Giriş',
  'ellit.realtime': 'Realtime',
  'uvicorn.error': 'Server xətası',
};

const PAGE = 300;

interface Person {
  name: string | null;
  email: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 24.11 08:25:30 — brauzerin dil paketindən asılı deyil ("M11" kimi çıxmır). */
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}:${pad2(d.getSeconds())}`;
};

const CTX_LABEL: Record<string, string> = {
  method: 'Metod',
  path: 'Yol',
  status: 'Status',
  ms: 'Müddət (ms)',
  user: 'İstifadəçi ID',
  role: 'Rol',
  ip: 'IP',
};

export default function ServerLogs() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const buildQuery = useCallback(
    (beforeId?: number) => {
      let q = supabase
        .from('server_logs')
        .select('id, created_at, level, source, logger, message, context')
        .order('id', { ascending: false })
        .limit(PAGE);
      if (level === 'ERROR') q = q.in('level', ['ERROR', 'CRITICAL']);
      if (level === 'problems') q = q.in('level', ['ERROR', 'CRITICAL', 'WARNING']);
      const cat = CATEGORY_FILTERS.find((c) => c.value === category);
      if (cat?.loggers) q = q.in('logger', cat.loggers);
      if (category === 'other') {
        q = q.not('logger', 'in', `(${KNOWN_LOGGERS.map((l) => `"${l}"`).join(',')})`);
      }
      if (appliedQuery.trim()) q = q.ilike('message', `%${appliedQuery.trim()}%`);
      if (beforeId) q = q.lt('id', beforeId);
      return q;
    },
    [level, category, appliedQuery],
  );

  const resolvePeople = useCallback(async (list: LogRow[]) => {
    const ids = Array.from(
      new Set(
        list
          .map((r) => (r.context?.user as string | undefined) ?? null)
          .filter((v): v is string => !!v),
      ),
    ).filter((id) => !(id in people));
    if (ids.length === 0) return;
    const { data } = await supabase.from('profiles').select('id, name, email').in('id', ids);
    if (!data) return;
    setPeople((prev) => ({
      ...prev,
      ...Object.fromEntries(data.map((p) => [p.id, { name: p.name, email: p.email }])),
    }));
  }, [people]);

  const load = useCallback(
    async (silent = false) => {
      if (busy.current) return;
      busy.current = true;
      if (!silent) setLoading(true);
      try {
        const { data, error: err } = await buildQuery();
        if (err) throw err;
        const list = (data ?? []) as LogRow[];
        setRows(list);
        setMore(list.length === PAGE);
        setError(null);
        void resolvePeople(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [buildQuery, resolvePeople],
  );

  const loadOlder = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const { data } = await buildQuery(last.id);
    const list = (data ?? []) as LogRow[];
    setRows((prev) => [...prev, ...list]);
    setMore(list.length === PAGE);
    void resolvePeople(list);
  };

  useEffect(() => {
    void load();
  }, [load]);

  // Canlı rejim: 5 saniyədən bir yeni qeydlər
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(t);
  }, [live, load]);

  const counts = useMemo(() => {
    let err = 0;
    let warn = 0;
    for (const r of rows) {
      if (r.level === 'ERROR' || r.level === 'CRITICAL') err++;
      else if (r.level === 'WARNING') warn++;
    }
    return { err, warn };
  }, [rows]);

  const who = (r: LogRow) => {
    const uid = r.context?.user as string | undefined;
    if (!uid) return null;
    const p = people[uid];
    return { uid, label: p?.name || p?.email || `ID: ${uid.slice(0, 8)}`, sub: p?.email ?? uid };
  };

  const columns: Column<LogRow>[] = [
    {
      key: 'time',
      header: 'Vaxt',
      cell: (r) => (
        <span className="text-xs text-muted whitespace-nowrap font-mono">
          {fmtTime(r.created_at)}
        </span>
      ),
      width: '150px',
    },
    {
      key: 'level',
      header: 'Səviyyə',
      cell: (r) => {
        const m = LEVEL_META[r.level] ?? { label: r.level, cls: 'bg-surface-alt text-muted' };
        return (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${m.cls}`}>{m.label}</span>
        );
      },
      width: '120px',
    },
    {
      key: 'source',
      header: 'Mənbə',
      cell: (r) => (
        <div className="text-xs">
          <p className="font-bold text-ink-soft">
            {LOGGER_LABEL[r.logger ?? ''] ?? r.logger ?? '—'}
          </p>
          <p className="text-muted">{r.source}</p>
        </div>
      ),
      hideOnMobile: true,
      width: '130px',
    },
    {
      key: 'message',
      header: 'Nə baş verdi',
      cell: (r) => (
        <p className="text-sm text-ink break-words whitespace-pre-wrap">{r.message}</p>
      ),
    },
    {
      key: 'who',
      header: 'Kim',
      cell: (r) => {
        const w = who(r);
        if (!w) return <span className="text-muted text-xs">—</span>;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-surface-alt text-muted flex items-center justify-center shrink-0">
              <User size={14} />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-ink text-sm truncate">{w.label}</p>
              <p className="text-xs text-muted truncate">{w.sub}</p>
            </div>
          </div>
        );
      },
      hideOnMobile: true,
      width: '200px',
    },
    {
      key: 'context',
      header: 'Detal',
      cell: (r) => {
        const ctx = r.context ?? {};
        if (Object.keys(ctx).length === 0) return <span className="text-muted text-xs">—</span>;
        return (
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-600 hover:text-brand-700 font-bold">
              {ctx.traceback ? 'Xəta izi' : 'Bax'}
            </summary>
            <div className="mt-2 p-2 rounded-lg bg-surface-alt max-w-md space-y-0.5">
              {Object.entries(ctx)
                .filter(([k]) => k !== 'traceback')
                .map(([k, v]) => (
                  <p key={k} className="break-all">
                    <span className="text-muted">{CTX_LABEL[k] ?? k}:</span>{' '}
                    <span className="font-mono text-ink-soft">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                    </span>
                  </p>
                ))}
              {typeof ctx.traceback === 'string' && (
                <pre className="mt-1 text-[11px] leading-snug overflow-x-auto whitespace-pre-wrap font-mono text-red-700">
                  {ctx.traceback}
                </pre>
              )}
            </div>
          </details>
        );
      },
      hideOnMobile: true,
      width: '110px',
    },
  ];

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-xl text-sm font-bold transition-all border ${
      active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-ink-soft border-border hover:border-brand-300'
    }`;

  return (
    <AdminLayout
      title="Server jurnalı"
      subtitle={`${rows.length} qeyd · ${counts.err} xəta · ${counts.warn} xəbərdarlıq · son 14 gün`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {LEVEL_FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setLevel(f.value)}
            className={chip(level === f.value)}>
            {f.label}
          </button>
        ))}
        <span className="w-px h-6 bg-border mx-1" />
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft select-none">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Canlı (5 san.)
        </label>
        <button type="button" onClick={() => void load()} className={chip(false)}
          title="Yenilə">
          <RefreshCw size={14} className={`inline ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {CATEGORY_FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setCategory(f.value)}
            className={chip(category === f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQuery(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Mətndə axtar (məs. sifariş adı, 'push', 'Epoint', '500')…"
          className="flex-1 px-3 py-2 rounded-xl border border-border bg-white text-sm"
        />
        <button type="submit" className={chip(true)}>Axtar</button>
      </form>

      {error ? (
        <Card variant="default" padding="lg" className="text-center">
          <p className="text-danger font-bold mb-1">Jurnal yüklənmədi</p>
          <p className="text-sm text-muted">{error}</p>
        </Card>
      ) : rows.length === 0 && !loading ? (
        <Card variant="default" padding="lg" className="text-center">
          <ScrollText size={32} className="mx-auto text-muted mb-3" />
          <h2 className="font-extrabold text-ink mb-1">Bu filtrə uyğun qeyd yoxdur</h2>
          <p className="text-sm text-muted">
            Serverdə baş verən əməliyyatlar, bildirişlər, ödəniş cavabları və
            xətalar burada görünəcək.
          </p>
        </Card>
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(r) => String(r.id)}
            loading={loading && rows.length === 0}
            searchKeys={[
              'message',
              (r) => LOGGER_LABEL[r.logger ?? ''] ?? r.logger ?? '',
              (r) => who(r)?.label ?? '',
            ]}
            searchPlaceholder="Yüklənmiş qeydlərdə tez axtarış…"
            pageSize={50}
            emptyTitle="Qeyd yoxdur"
          />
          {more && (
            <div className="text-center mt-4">
              <button type="button" onClick={() => void loadOlder()} className={chip(false)}>
                Daha köhnə qeydlər
              </button>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
