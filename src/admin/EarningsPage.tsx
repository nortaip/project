import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp,
  Wallet,
  Briefcase,
  Building2,
  Receipt,
  CreditCard,
  Banknote,
  Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { azn } from '../lib/format';

interface EarnOrder {
  id: string;
  title: string | null;
  completed_at: string;
  amount: number | string;
  is_brigade: boolean;
  payment_method: string | null;
  worker_pct: number | string;
  worker_net: number | string;
  brigade_cut: number | string;
  platform_amt: number | string;
}
interface EarnData {
  from: string;
  to: string;
  count: number;
  gross: number | string;
  platform_total: number | string;
  brigade_total: number | string;
  net_total: number | string;
  orders: EarnOrder[];
}

type Preset = 'week' | 'month' | 'custom';

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
const iso = (d: Date) => d.toISOString();

export default function EarningsPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<EarnData | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    const now = new Date();
    if (preset === 'week') return { from: iso(startOfWeek(now)), to: iso(now) };
    if (preset === 'month') return { from: iso(startOfMonth(now)), to: iso(now) };
    return {
      from: customFrom ? iso(new Date(customFrom)) : iso(startOfMonth(now)),
      to: customTo ? iso(new Date(`${customTo}T23:59:59`)) : iso(now),
    };
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d, error } = await supabase.rpc('worker_earnings', {
      p_from: range.from,
      p_to: range.to,
    });
    if (!error && d) setData(d as EarnData);
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const presets: { key: Preset; label: string }[] = [
    { key: 'week', label: t('earnings.thisWeek', { defaultValue: 'Bu həftə' }) },
    { key: 'month', label: t('earnings.thisMonth', { defaultValue: 'Bu ay' }) },
    { key: 'custom', label: t('earnings.custom', { defaultValue: 'Tarix aralığı' }) },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-brand-soft">
          <TrendingUp size={22} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-ink tracking-tight">
            {t('earnings.title', { defaultValue: 'Qazancım' })}
          </h1>
          <p className="text-sm text-muted">
            {t('earnings.subtitle', { defaultValue: 'Tamamlanmış sifarişlər və komissiyalar' })}
          </p>
        </div>
      </div>

      {/* Period presets */}
      <div className="flex flex-wrap gap-2 mb-4">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
              preset === p.key
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-ink-soft border-border hover:border-brand-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-2xl bg-surface-alt border border-border">
          <label className="text-sm font-bold text-ink-soft">
            {t('earnings.from', { defaultValue: 'Başlanğıc' })}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 block h-11 px-3 rounded-xl bg-white border border-border focus:border-brand-600 outline-none text-sm"
            />
          </label>
          <label className="text-sm font-bold text-ink-soft">
            {t('earnings.to', { defaultValue: 'Son' })}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 block h-11 px-3 rounded-xl bg-white border border-border focus:border-brand-600 outline-none text-sm"
            />
          </label>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={32} className="animate-spin text-brand-600" />
        </div>
      ) : !data ? (
        <p className="py-12 text-center text-muted">{t('common.error')}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <SummaryCard icon={<Wallet size={18} />} label={t('earnings.net', { defaultValue: 'Xalis qazanc' })} value={azn(data.net_total)} accent />
            <SummaryCard icon={<Briefcase size={18} />} label={t('earnings.gross', { defaultValue: 'Ümumi dövriyyə' })} value={azn(data.gross)} />
            <SummaryCard icon={<Building2 size={18} />} label={t('earnings.brigade', { defaultValue: 'Komandaya' })} value={azn(data.brigade_total)} />
            <SummaryCard icon={<Receipt size={18} />} label={t('earnings.platform', { defaultValue: 'Platforma' })} value={azn(data.platform_total)} />
          </div>

          <div className="flex items-center justify-between mb-2">
            <h2 className="font-extrabold text-ink">
              {t('earnings.orders', { defaultValue: 'Sifarişlər' })} ({data.count})
            </h2>
          </div>

          {data.orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted bg-surface-alt rounded-2xl border border-border">
              {t('earnings.empty', { defaultValue: 'Bu dövrdə tamamlanmış sifariş yoxdur' })}
            </div>
          ) : (
            <div className="space-y-2">
              {data.orders.map((o) => (
                <div key={o.id} className="bg-white rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-ink truncate">{o.title ?? '—'}</div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted">
                        <span>{new Date(o.completed_at).toLocaleDateString('az', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        <span className="inline-flex items-center gap-1">
                          {o.payment_method === 'cash' ? <Banknote size={12} /> : <CreditCard size={12} />}
                          {o.payment_method === 'cash' ? t('confirm.cash', { defaultValue: 'Nağd' }) : t('confirm.card', { defaultValue: 'Kart' })}
                        </span>
                        {o.is_brigade && (
                          <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 font-bold">
                            {t('earnings.brigadeTag', { defaultValue: 'Komanda' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-success font-extrabold">{azn(o.worker_net)}</div>
                      <div className="text-[11px] text-muted">{t('earnings.fromAmount', { defaultValue: 'Sifariş' })}: {azn(o.amount)}</div>
                    </div>
                  </div>
                  {o.is_brigade && (
                    <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span>{t('earnings.brigade', { defaultValue: 'Komandaya' })}: <b className="text-ink-soft">{azn(o.brigade_cut)}</b></span>
                      <span>{t('earnings.share', { defaultValue: 'Sənin payın' })}: <b className="text-ink-soft">{Number(o.worker_pct)}%</b></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-4 border ${accent ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-border'}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${accent ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-600'}`}>
        {icon}
      </div>
      <div className={`text-lg font-extrabold tracking-tight ${accent ? 'text-white' : 'text-ink'}`}>{value}</div>
      <div className={`text-xs font-semibold ${accent ? 'text-white/80' : 'text-muted'}`}>{label}</div>
    </div>
  );
}
