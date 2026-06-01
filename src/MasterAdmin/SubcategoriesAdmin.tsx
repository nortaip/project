import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Tag, Plus, Pencil, Trash2, Search, Save, X, Check, AlertCircle, Loader2,
  FolderTree, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface Category {
  id: string;
  label: string;
}

interface Subcategory {
  id: string;
  category_id: string;
  label: string;
}

export default function SubcategoriesAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter + form
  const [selectedCategory, setSelectedCategory] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingCats(true);
      const { data } = await supabase
        .from('service_categories')
        .select('id, label')
        .order('label');
      setCategories((data ?? []) as Category[]);
      setLoadingCats(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedCategory) {
      setSubs([]);
      return;
    }
    void loadSubs();
  }, [selectedCategory]);

  async function loadSubs() {
    setLoadingSubs(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('service_subcategories')
      .select('id, category_id, label')
      .eq('category_id', selectedCategory)
      .order('label');
    if (err) setError(err.message);
    else setSubs((data ?? []) as Subcategory[]);
    setLoadingSubs(false);
  }

  function resetForm() {
    setEditId(null);
    setLabel('');
  }

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg((m) => (m === msg ? null : m)), 2200);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || !selectedCategory) return;
    setSaving(true);
    setError(null);
    try {
      if (editId) {
        const { error: err } = await supabase
          .from('service_subcategories')
          .update({ label: trimmed })
          .eq('id', editId);
        if (err) throw err;
        flash('Alt kateqoriya yeniləndi');
      } else {
        const { error: err } = await supabase
          .from('service_subcategories')
          .insert({ category_id: selectedCategory, label: trimmed });
        if (err) throw err;
        flash('Alt kateqoriya əlavə olundu');
      }
      resetForm();
      await loadSubs();
    } catch (err: any) {
      setError(err.message ?? 'Xəta baş verdi');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(s: Subcategory) {
    setEditId(s.id);
    setLabel(s.label);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id: string) {
    setError(null);
    const { error: err } = await supabase
      .from('service_subcategories')
      .delete()
      .eq('id', id);
    if (err) {
      setError(`Silinmədi: ${err.message}`);
    } else {
      flash('Silindi');
      if (editId === id) resetForm();
      await loadSubs();
    }
    setDeletingId(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return subs;
    return subs.filter((s) => s.label.toLowerCase().includes(q));
  }, [subs, search]);

  const selectedCatLabel =
    categories.find((c) => c.id === selectedCategory)?.label ?? '';

  return (
    <AdminLayout
      title="Alt kateqoriyalar"
      subtitle={selectedCatLabel ? `Kateqoriya: ${selectedCatLabel}` : 'Kateqoriya seçin'}
    >
      <div className="max-w-5xl space-y-6">
        {/* Hero */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 border border-brand-100 p-5 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
            <Tag size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-extrabold text-ink">Alt kateqoriyalar</h3>
            <p className="text-sm text-ink-soft mt-1 leading-relaxed">
              Hər ana kateqoriyanın altında konkret xidmət növləri.
              Məsələn <i>Avtomobil xidmətləri → Evakuator xidməti</i>.
            </p>
          </div>
        </div>

        {/* Kateqoriya seçici */}
        <div className="rounded-2xl border border-border bg-white p-5">
          <label className="block text-xs font-bold text-ink-soft mb-2 uppercase tracking-wide">
            Ana kateqoriya seçin
          </label>
          <div className="relative">
            <FolderTree
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none"
            />
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                resetForm();
              }}
              disabled={loadingCats}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-bold appearance-none cursor-pointer disabled:bg-surface-alt"
            >
              <option value="">— Kateqoriya seçin —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
          </div>
        </div>

        {/* Bildirim */}
        {error && (
          <div className="rounded-xl border border-danger/20 bg-red-50 text-danger px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-auto text-danger/70 hover:text-danger"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm flex items-center gap-2">
            <Check size={16} />
            <span className="font-bold">{successMsg}</span>
          </div>
        )}

        {selectedCategory && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Form */}
            <form
              onSubmit={handleSubmit}
              className="lg:col-span-1 lg:sticky lg:top-6 self-start rounded-2xl border border-border bg-white p-5 space-y-4 h-fit"
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  editId ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'
                }`}>
                  {editId ? <Pencil size={15} /> : <Plus size={15} />}
                </div>
                <h3 className="font-extrabold text-ink">
                  {editId ? 'Redaktə et' : 'Yeni alt kateqoriya'}
                </h3>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5 uppercase tracking-wide">
                  Alt kateqoriya adı
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="məs: Evakuator xidməti"
                  className="w-full px-3 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-bold"
                />
                <p className="text-xs text-muted mt-1.5">
                  Bu adı istifadəçi sifariş yaradanda seçəcək.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!label.trim() || saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : editId ? (
                    <Save size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                  {editId ? 'Saxla' : 'Əlavə et'}
                </button>
                {editId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-4 py-2.5 rounded-xl bg-surface-alt text-ink-soft font-bold text-sm hover:bg-border transition-colors"
                  >
                    Ləğv et
                  </button>
                )}
              </div>
            </form>

            {/* List */}
            <div className="lg:col-span-2 rounded-2xl border border-border bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-3">
                <h3 className="font-extrabold text-ink flex-1">
                  Alt kateqoriyalar
                </h3>
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-2.5 text-muted"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Axtar..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-border text-sm w-44 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none"
                  />
                </div>
                <span className="text-xs font-bold text-muted bg-surface-alt px-2 py-1 rounded-md">
                  {filtered.length}
                </span>
              </div>

              {loadingSubs ? (
                <div className="py-16 flex items-center justify-center text-muted">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  Yüklənir...
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <Tag size={32} className="text-muted mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted font-medium">
                    {search ? 'Nəticə tapılmadı' : 'Bu kateqoriya boşdur'}
                  </p>
                  {!search && (
                    <p className="text-xs text-muted mt-1">
                      Sol formadan yeni alt kateqoriya əlavə edin
                    </p>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((s) => (
                    <li
                      key={s.id}
                      className={`px-5 py-3 flex items-center gap-3 hover:bg-surface-alt transition-colors ${
                        editId === s.id ? 'bg-brand-50' : ''
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                        <Tag size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-ink text-sm">
                          {s.label}
                        </p>
                        <p className="text-[10px] text-muted font-mono truncate">
                          {s.id}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEdit(s)}
                          title="Redaktə et"
                          className="w-8 h-8 rounded-lg bg-surface-alt text-ink-soft hover:bg-brand-100 hover:text-brand-700 flex items-center justify-center transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        {deletingId === s.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDelete(s.id)}
                              className="px-2 h-8 rounded-lg bg-danger text-white text-xs font-bold hover:bg-red-700 transition-colors"
                            >
                              Sil
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingId(null)}
                              className="w-8 h-8 rounded-lg bg-surface-alt text-ink-soft hover:bg-border flex items-center justify-center"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingId(s.id)}
                            title="Sil"
                            className="w-8 h-8 rounded-lg bg-surface-alt text-ink-soft hover:bg-red-100 hover:text-danger flex items-center justify-center transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
