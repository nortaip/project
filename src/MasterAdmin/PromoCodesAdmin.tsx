import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Tag, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Promo {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  per_user_limit: number | null;
  min_order_amount: number | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('az', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function PromoCodesAdmin() {
  const [rows, setRows] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as Promo[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (p: Promo) => {
    const { error: e } = await supabase
      .from('promo_codes')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (e) setError(e.message);
    else void load();
  };

  const remove = async (p: Promo) => {
    if (!confirm(`"${p.code}" promo kodu silinsin?`)) return;
    const { error: e } = await supabase.from('promo_codes').delete().eq('id', p.id);
    if (e) setError(e.message);
    else void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Promo kodlar müştərinin kart ödənişində endirim verir. İstifadə sayı avtomatik artır.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-white border border-border text-sm font-bold text-ink-soft hover:text-brand-600"
          >
            <RefreshCw size={15} /> Yenilə
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700"
          >
            <Plus size={16} /> Yeni promo kod
          </button>
        </div>
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
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-muted">Hələ promo kod yoxdur</div>
      ) : (
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-muted">
                <tr className="text-left">
                  <th className="px-4 py-3 font-bold">Kod</th>
                  <th className="px-4 py-3 font-bold">Endirim</th>
                  <th className="px-4 py-3 font-bold">İstifadə sayı</th>
                  <th className="px-4 py-3 font-bold">Min. sifariş</th>
                  <th className="px-4 py-3 font-bold">Bitmə</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold text-right">Əməliyyat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-alt/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-extrabold text-ink">
                        <Tag size={14} className="text-brand-600" />
                        {p.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-ink">
                      {p.discount_type === 'percent'
                        ? `${p.discount_value}%`
                        : `${p.discount_value} ₼`}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-extrabold text-ink">{p.used_count}</span>
                      <span className="text-muted">{p.max_uses != null ? ` / ${p.max_uses}` : ' / ∞'}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {p.min_order_amount != null ? `${p.min_order_amount} ₼` : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">{fmtDate(p.expires_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleActive(p)}
                        className={`text-xs font-bold px-2 py-1 rounded-lg ${
                          p.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-surface-alt text-muted'
                        }`}
                      >
                        {p.is_active ? 'Aktiv' : 'Deaktiv'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(p)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50"
                        aria-label="Sil"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [perUser, setPerUser] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [expires, setExpires] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const c = code.trim().toUpperCase();
    const v = parseFloat(value) || 0;
    if (!c) return setErr('Kod daxil edin');
    if (v <= 0) return setErr('Endirim dəyəri müsbət olmalıdır');
    if (type === 'percent' && v > 100) return setErr('Faiz 100-dən çox ola bilməz');
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error: e } = await supabase.from('promo_codes').insert({
      code: c,
      discount_type: type,
      discount_value: v,
      max_uses: maxUses ? parseInt(maxUses, 10) : null,
      per_user_limit: perUser ? parseInt(perUser, 10) : null,
      min_order_amount: minOrder ? parseFloat(minOrder) : null,
      expires_at: expires ? new Date(expires).toISOString() : null,
      created_by: u.user?.id ?? null,
    });
    setSaving(false);
    if (e) {
      setErr(e.message.includes('duplicate') ? 'Bu kod artıq mövcuddur' : e.message);
      return;
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-white">
          <h3 className="font-extrabold text-ink text-lg">Yeni promo kod</h3>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl bg-surface-alt text-muted flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Kod">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PROMO2026"
              className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm font-bold uppercase outline-none focus:border-brand-500" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Endirim növü">
              <select value={type} onChange={(e) => setType(e.target.value as 'percent' | 'fixed')}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm font-medium outline-none focus:border-brand-500">
                <option value="percent">Faiz (%)</option>
                <option value="fixed">Sabit (₼)</option>
              </select>
            </Field>
            <Field label={type === 'percent' ? 'Faiz' : 'Məbləğ (₼)'}>
              <input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm outline-none focus:border-brand-500" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ümumi limit (boş = ∞)">
              <input type="number" min={0} value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm outline-none focus:border-brand-500" />
            </Field>
            <Field label="Hər istifadəçi (boş = ∞)">
              <input type="number" min={0} value={perUser} onChange={(e) => setPerUser(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm outline-none focus:border-brand-500" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min. sifariş (₼)">
              <input type="number" min={0} step="0.01" value={minOrder} onChange={(e) => setMinOrder(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm outline-none focus:border-brand-500" />
            </Field>
            <Field label="Bitmə tarixi">
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-white text-sm outline-none focus:border-brand-500" />
            </Field>
          </div>
          {err && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 font-semibold">{err}</div>}
        </div>
        <div className="px-5 py-4 border-t border-border flex gap-2 justify-end sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-surface-alt disabled:opacity-50">Ləğv et</button>
          <button type="button" onClick={() => void save()} disabled={saving}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
            {saving ? 'Yadda saxlanılır…' : 'Yarat'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-ink-soft mb-1">{label}</span>
      {children}
    </label>
  );
}
