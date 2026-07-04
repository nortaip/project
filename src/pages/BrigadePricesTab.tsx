import { useEffect, useState } from 'react';
import { message } from 'antd';
import { CreditCard, Edit2, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { money } from '../lib/format';
import { Button, Card, EmptyState, Field, Input } from '../components/ui';

interface ServiceCategory {
  id: string;
  label: string;
}
interface ServiceSubcategory {
  id: string;
  category_id: string;
  label: string;
}

export interface BrigadePrice {
  id: string;
  brigade_id: string;
  category_id: string;
  subcategory_id: string | null;
  unit: 'job' | 'hour' | 'm2' | 'piece' | 'day';
  price: number;
  currency: string;
  notes: string | null;
  is_active: boolean;
  category?: ServiceCategory | null;
  subcategory?: ServiceSubcategory | null;
}

const UNIT_LABELS: Record<BrigadePrice['unit'], string> = {
  job: 'sifariş başına',
  hour: 'saatlıq',
  m2: 'm² başına',
  piece: 'ədəd',
  day: 'günlük',
};

interface Props {
  brigadeId: string;
  brigadeCategories: string[];
  canManage: boolean;
}

export default function BrigadePricesTab({
  brigadeId,
  brigadeCategories,
  canManage,
}: Props) {
  const [prices, setPrices] = useState<BrigadePrice[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BrigadePrice | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadeId]);

  const load = async () => {
    setLoading(true);
    try {
      const [pricesResp, catResp, subResp] = await Promise.all([
        supabase
          .from('brigade_prices')
          .select(
            '*, category:service_categories(id,label), subcategory:service_subcategories(id,category_id,label)',
          )
          .eq('brigade_id', brigadeId)
          .order('created_at', { ascending: false }),
        supabase.from('service_categories').select('id, label').order('label'),
        supabase
          .from('service_subcategories')
          .select('id, category_id, label')
          .order('label'),
      ]);
      if (pricesResp.error) throw pricesResp.error;
      if (catResp.error) throw catResp.error;
      if (subResp.error) throw subResp.error;
      setPrices((pricesResp.data ?? []) as BrigadePrice[]);
      setCategories((catResp.data ?? []) as ServiceCategory[]);
      setSubcategories((subResp.data ?? []) as ServiceSubcategory[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (p: BrigadePrice) => {
    if (!confirm(`${p.category?.label ?? '—'} qiyməti silinsin?`)) return;
    const { error } = await supabase
      .from('brigade_prices')
      .delete()
      .eq('id', p.id);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('Silindi');
    await load();
  };

  const handleToggle = async (p: BrigadePrice) => {
    const { error } = await supabase
      .from('brigade_prices')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (error) {
      message.error(error.message);
      return;
    }
    await load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={16} />}
            onClick={() => setAdding(true)}
          >
            Qiymət əlavə et
          </Button>
        </div>
      )}

      {prices.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<CreditCard size={32} />}
            title="Hələ qiymət yoxdur"
            description={
              canManage
                ? 'Briqadanızın xidmət qiymətlərini əlavə edin. Müştərilər sifariş açanda bu qiymətləri görəcək.'
                : 'Bu briqada hələ qiymət təyin etməyib.'
            }
            action={
              canManage ? (
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={<Plus size={18} />}
                  onClick={() => setAdding(true)}
                >
                  İlk qiyməti əlavə et
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {prices.map((p) => (
            <Card
              key={p.id}
              variant="default"
              padding="md"
              className={!p.is_active ? 'opacity-60' : ''}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-extrabold text-ink">
                      {p.category?.label ?? '—'}
                    </span>
                    {p.subcategory && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold">
                        {p.subcategory.label}
                      </span>
                    )}
                    {!p.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-muted/15 text-muted font-semibold">
                        Passiv
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold text-brand-700">
                      {money(p.price)}
                    </span>
                    <span className="text-sm font-bold text-muted">
                      {p.currency} / {UNIT_LABELS[p.unit]}
                    </span>
                  </div>
                  {p.notes && (
                    <p className="mt-1 text-sm text-ink-soft">{p.notes}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-surface-alt text-muted hover:text-ink"
                      aria-label="Redaktə et"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggle(p)}
                      className="text-xs font-bold px-2 py-1 rounded-md hover:bg-surface-alt text-muted"
                    >
                      {p.is_active ? 'Söndür' : 'Aktivləşdir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-rose-50 text-danger"
                      aria-label="Sil"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <PriceFormModal
          brigadeId={brigadeId}
          brigadeCategories={brigadeCategories}
          categories={categories}
          subcategories={subcategories}
          editing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function PriceFormModal({
  brigadeId,
  brigadeCategories,
  categories,
  subcategories,
  editing,
  onClose,
  onSaved,
}: {
  brigadeId: string;
  brigadeCategories: string[];
  categories: ServiceCategory[];
  subcategories: ServiceSubcategory[];
  editing: BrigadePrice | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? '');
  const [subcategoryId, setSubcategoryId] = useState(editing?.subcategory_id ?? '');
  const [unit, setUnit] = useState<BrigadePrice['unit']>(editing?.unit ?? 'job');
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Briqadanın seçdiyi kateqoriya adlarını id-ə map et — əgər varsa filtr et.
  // Uyğunluq tapılmazsa (label fərqli yazılışda və ya boşdursa) bütün
  // kateqoriyalara geri qayıdırıq ki, select heç vaxt boş qalmasın.
  const matchedCategories =
    brigadeCategories && brigadeCategories.length > 0
      ? categories.filter((c) =>
          brigadeCategories.some(
            (bc) => bc.toLowerCase() === c.label.toLowerCase(),
          ),
        )
      : categories;
  const allowedCategories =
    matchedCategories.length > 0 ? matchedCategories : categories;

  const subForCategory = subcategories.filter((s) => s.category_id === categoryId);

  const handleSubmit = async () => {
    setError(null);
    if (!categoryId) {
      setError('Kateqoriya seç');
      return;
    }
    const priceNum = Number(price);
    if (!isFinite(priceNum) || priceNum < 0) {
      setError('Düzgün qiymət daxil et');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        brigade_id: brigadeId,
        category_id: categoryId,
        subcategory_id: subcategoryId || null,
        unit,
        price: priceNum,
        notes: notes.trim() || null,
      };

      if (editing) {
        const { error: e } = await supabase
          .from('brigade_prices')
          .update(payload)
          .eq('id', editing.id);
        if (e) throw e;
        message.success('Yeniləndi');
      } else {
        const { error: e } = await supabase.from('brigade_prices').insert(payload);
        if (e) {
          if (e.code === '23505') {
            throw new Error(
              'Bu kateqoriya/alt-kateqoriya/vahid üçün artıq qiymət var',
            );
          }
          throw e;
        }
        message.success('Əlavə edildi');
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">
            {editing ? 'Qiyməti yenilə' : 'Yeni qiymət'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
            aria-label="Bağla"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-1">
          <Field label="Kateqoriya" required>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setSubcategoryId('');
              }}
              className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
            >
              <option value="">Seç</option>
              {allowedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Alt kateqoriya (istəyə bağlı)" hint="Boş qoy: bütün alt kateqoriyalar üçün etibarlıdır">
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              disabled={!categoryId}
              className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink disabled:opacity-50"
            >
              <option value="">Hamısı</option>
              {subForCategory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Hesablama vahidi" required>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as BrigadePrice['unit'])}
              className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
            >
              <option value="job">Sifariş başına</option>
              <option value="hour">Saatlıq</option>
              <option value="day">Günlük</option>
              <option value="m2">m² başına</option>
              <option value="piece">Ədəd başına</option>
            </select>
          </Field>

          <Field label="Qiymət (AZN)" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="50.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>

          <Field label="Qeyd" hint="Müştəri görə bilər — şərt, izah və s.">
            <Input
              placeholder="Min 2 saat / Material ayrıca / ..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          {error && (
            <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              fullWidth
              onClick={onClose}
              disabled={submitting}
            >
              Ləğv et
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleSubmit}
            >
              {editing ? 'Yenilə' : 'Əlavə et'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
