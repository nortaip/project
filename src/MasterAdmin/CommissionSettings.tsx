import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Loader2, Percent, Save, AlertCircle } from 'lucide-react';

interface ConfigRow {
  key: string;
  // jsonb sahəsi sadə rəqəm kimi saxlanır (məs. `10`), obyekt deyil
  value: number | string | { value?: number | string };
  description: string | null;
  updated_at: string | null;
}

function readConfigNumber(raw: ConfigRow['value']): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  // legacy fallback — köhnə formatda obyekt kimi saxlanmış olsa
  if (typeof raw === 'object' && raw && 'value' in raw) {
    const inner = (raw as { value?: number | string }).value;
    if (typeof inner === 'number') return inner;
    if (typeof inner === 'string') {
      const n = Number(inner);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

interface CommissionRates {
  on_accept: number;
  on_complete: number;
  on_withdrawal: number;
  min_withdrawal: number;
  brigade_member: number;
  brigade_on_accept: number;
  brigade_on_complete: number;
}

const FIELDS: Array<{
  key: keyof CommissionRates;
  configKey: string;
  label: string;
  hint: string;
  unit: '%' | 'AZN';
  group: 'individual' | 'brigade' | 'other';
}> = [
  {
    key: 'on_accept',
    configKey: 'commission_on_accept',
    label: 'Fərdi provayder — qəbul komissiyası',
    hint: 'Fərdi (tək) provayderin təklifi qəbul ediləndə tutulur. Provayderin escrow hesabına bu məbləğ çıxılaraq düşür.',
    unit: '%',
    group: 'individual',
  },
  {
    key: 'on_complete',
    configKey: 'commission_on_complete',
    label: 'Fərdi provayder — tamamlama komissiyası',
    hint: 'Fərdi provayderin işi tamamlananda escrow → əsas balansa keçir, bu faiz tutulur.',
    unit: '%',
    group: 'individual',
  },
  {
    key: 'brigade_on_accept',
    configKey: 'brigade_commission_on_accept',
    label: 'Komanda — qəbul komissiyası',
    hint: 'Komanda (briqada) təklifi qəbul ediləndə tutulan platform komissiyası. Fərdi provayderdən fərqli ola bilər.',
    unit: '%',
    group: 'brigade',
  },
  {
    key: 'brigade_on_complete',
    configKey: 'brigade_commission_on_complete',
    label: 'Komanda — tamamlama komissiyası',
    hint: 'Komanda işi tamamlananda tutulan platform komissiyası. Fərdi provayderdən fərqli ola bilər.',
    unit: '%',
    group: 'brigade',
  },
  {
    key: 'brigade_member',
    configKey: 'brigade_member_commission_pct',
    label: 'Komanda daxili pay (işçi → komanda)',
    hint: 'Hər işçinin hər sifariş üçün qoşulduğu komandaya verdiyi faiz (vahid). İş bitəndə işçinin payından tutulub komanda balansına köçür. 0 = tutulmur.',
    unit: '%',
    group: 'brigade',
  },
  {
    key: 'on_withdrawal',
    configKey: 'commission_on_withdrawal',
    label: 'Nağdlaşdırmada komissiya',
    hint: 'Provayder pulu kartına çıxaranda tutulur.',
    unit: '%',
    group: 'other',
  },
  {
    key: 'min_withdrawal',
    configKey: 'min_withdrawal_amount',
    label: 'Minimum nağdlaşdırma məbləği',
    hint: 'Provayder bu məbləğdən az olan çıxarış sorğusu verə bilməz.',
    unit: 'AZN',
    group: 'other',
  },
];

export default function CommissionSettings() {
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [originals, setOriginals] = useState<CommissionRates | null>(null);
  const [meta, setMeta] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setError(null);
    const { data, error: dbErr } = await supabase
      .from('platform_config')
      .select('key, value, description, updated_at')
      .in('key', FIELDS.map((f) => f.configKey));

    if (dbErr) {
      setError(dbErr.message);
      return;
    }

    const rows = (data ?? []) as ConfigRow[];
    const next: CommissionRates = {
      on_accept: 0,
      on_complete: 0,
      on_withdrawal: 0,
      min_withdrawal: 0,
      brigade_member: 0,
      brigade_on_accept: 0,
      brigade_on_complete: 0,
    };
    const newMeta: Record<string, string | null> = {};
    for (const f of FIELDS) {
      const row = rows.find((r) => r.key === f.configKey);
      next[f.key] = row ? readConfigNumber(row.value) : 0;
      newMeta[f.configKey] = row?.updated_at ?? null;
    }
    setRates(next);
    setOriginals({ ...next });
    setMeta(newMeta);
  };

  const handleChange = (key: keyof CommissionRates, raw: string) => {
    if (!rates) return;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    setRates({ ...rates, [key]: num });
    setSavedKey(null);
  };

  const handleSave = async (field: typeof FIELDS[number]) => {
    if (!rates) return;
    setError(null);
    setSaving(field.configKey);
    const { error: rpcErr } = await supabase.rpc('admin_update_commission', {
      p_key: field.configKey,
      p_value: rates[field.key],
    });
    setSaving(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setOriginals((o) => (o ? { ...o, [field.key]: rates[field.key] } : o));
    setSavedKey(field.configKey);
    setTimeout(() => setSavedKey((k) => (k === field.configKey ? null : k)), 2500);
    await load();
  };

  if (!rates || !originals) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 className="animate-spin mr-2" size={18} /> Yüklənir...
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 border border-brand-100 p-5">
        <h2 className="text-lg font-extrabold text-ink flex items-center gap-2">
          <Percent size={20} className="text-brand-600" />
          Komissiya parametrləri
        </h2>
        <p className="text-sm text-ink-soft mt-2 leading-relaxed">
          Təkliflərin verilməsi <b>pulsuzdur</b>. Komissiya 3 mərhələdə tutulur:
          müştəri təklifi qəbul edib kartla ödədikdə, iş bitdikdə və provayder
          pulu nağdlaşdıranda.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/20 bg-red-50 text-danger px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        {FIELDS.map((f) => {
          const dirty = rates[f.key] !== originals[f.key];
          const isSaving = saving === f.configKey;
          const justSaved = savedKey === f.configKey;
          return (
            <div
              key={f.configKey}
              className="rounded-2xl border border-border bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h3 className="font-extrabold text-ink">{f.label}</h3>
                  <p className="text-sm text-muted mt-1 leading-relaxed">{f.hint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      step={f.unit === '%' ? '0.1' : '1'}
                      min={0}
                      max={f.unit === '%' ? 100 : undefined}
                      value={rates[f.key]}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      className="w-32 px-3 py-2 pr-12 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none font-bold text-ink text-right"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted pointer-events-none">
                      {f.unit}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSave(f)}
                    disabled={!dirty || isSaving}
                    className={`px-4 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 ${
                      justSaved
                        ? 'bg-success/10 text-success'
                        : dirty
                          ? 'bg-brand-600 text-white hover:bg-brand-700'
                          : 'bg-surface-alt text-muted cursor-not-allowed'
                    }`}
                  >
                    {isSaving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : justSaved ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    {justSaved ? 'Saxlanıldı' : 'Saxla'}
                  </button>
                </div>
              </div>
              {meta[f.configKey] && (
                <p className="text-xs text-muted mt-3">
                  Son yenilənmə:{' '}
                  {new Date(meta[f.configKey] as string).toLocaleString('az-AZ')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-surface-alt border border-border p-5 text-sm text-ink-soft">
        <p className="font-bold text-ink mb-2">Necə işləyir?</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Müştəri sifariş yaradır, provayderlər <b>pulsuz</b> təklif verir.</li>
          <li>
            Müştəri bir təklifi qəbul edir → kartla ödəyir. Bizim sistem bu məbləği
            provayderin <b>kilidli (escrow)</b> balansına yazır, qəbul komissiyası tutulur.
          </li>
          <li>
            İş bitir, müştəri təsdiqləyir → məbləğ <b>aktiv balansa</b> keçir,
            tamamlanma komissiyası tutulur.
          </li>
          <li>
            Provayder nağdlaşdırma sorğusu göndərir → admin təsdiqləyir,
            nağdlaşdırma komissiyası tutulur.
          </li>
        </ol>
      </div>
    </div>
  );
}
