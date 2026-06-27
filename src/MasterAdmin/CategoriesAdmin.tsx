import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Category {
  id: string;
  label: string;
  label_ru: string | null;
  label_en: string | null;
  is_active: boolean | null;
}

export default function CategoriesAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('service_categories')
      .select('id,label,label_ru,label_en,is_active')
      .order('label');
    setCategories((data as Category[]) ?? []);
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setAdding(true);
    setError(null);
    const { error } = await supabase
      .from('service_categories')
      .insert([{ label: label.trim(), is_active: true }]);
    if (error) setError(error.message);
    else setLabel('');
    await fetchCategories();
    setAdding(false);
  };

  const toggleActive = async (c: Category) => {
    setBusyId(c.id);
    setError(null);
    const next = !(c.is_active ?? true);
    // Optimistik
    setCategories((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, is_active: next } : x)),
    );
    const { error } = await supabase
      .from('service_categories')
      .update({ is_active: next })
      .eq('id', c.id);
    if (error) {
      setError(error.message);
      await fetchCategories();
    }
    setBusyId(null);
  };

  const saveEdit = async (c: Category) => {
    if (!editLabel.trim()) return;
    setBusyId(c.id);
    setError(null);
    const { error } = await supabase
      .from('service_categories')
      .update({ label: editLabel.trim() })
      .eq('id', c.id);
    if (error) setError(error.message);
    setEditId(null);
    await fetchCategories();
    setBusyId(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? categories.filter((c) => c.label.toLowerCase().includes(q)) : categories;
  }, [categories, query]);

  const activeCount = categories.filter((c) => c.is_active ?? true).length;

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-brand-soft">
          <Layers size={22} />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-ink tracking-tight">Kateqoriyalar</h2>
          <p className="text-sm text-muted">
            {activeCount} aktiv · {categories.length} ümumi
          </p>
        </div>
      </div>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="flex flex-col sm:flex-row gap-2 mb-3"
      >
        <input
          type="text"
          className="flex-1 h-12 px-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 focus:bg-white outline-none text-[15px] text-ink transition-colors"
          placeholder="Yeni kateqoriya (məs: Avtomobil xidmətləri)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="submit"
          disabled={adding || !label.trim()}
          className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold transition-colors shadow-brand-soft"
        >
          {adding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          Əlavə et
        </button>
      </form>

      {error && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-danger/5 border border-danger/20 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Search */}
      {categories.length > 6 && (
        <div className="relative mb-4">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Axtar..."
            className="w-full h-11 pl-10 pr-3 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 focus:bg-white outline-none text-sm text-ink transition-colors"
          />
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted bg-surface-alt rounded-2xl border border-border">
            Kateqoriya tapılmadı
          </div>
        ) : (
          filtered.map((c) => {
            const active = c.is_active ?? true;
            const editing = editId === c.id;
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${
                  active ? 'bg-white border-border' : 'bg-surface-alt border-border opacity-70'
                }`}
              >
                {editing ? (
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(c);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                    className="flex-1 h-10 px-3 rounded-xl bg-surface-alt border-[1.5px] border-brand-600 outline-none text-[15px] font-medium text-ink"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] font-bold truncate ${active ? 'text-ink' : 'text-muted'}`}>
                      {c.label}
                    </div>
                    {!active && (
                      <span className="text-[11px] font-bold text-muted uppercase tracking-wide">Deaktiv</span>
                    )}
                  </div>
                )}

                {/* Actions */}
                {editing ? (
                  <>
                    <button
                      onClick={() => saveEdit(c)}
                      disabled={busyId === c.id}
                      className="w-9 h-9 rounded-xl bg-success/10 text-success flex items-center justify-center hover:bg-success/20"
                      title="Yadda saxla"
                    >
                      <Check size={17} />
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="w-9 h-9 rounded-xl bg-surface-alt text-muted flex items-center justify-center hover:bg-border/60"
                      title="Ləğv et"
                    >
                      <X size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditId(c.id);
                        setEditLabel(c.label);
                      }}
                      className="w-9 h-9 rounded-xl bg-surface-alt text-ink-soft flex items-center justify-center hover:bg-border/60 transition-colors"
                      title="Adı dəyiş"
                    >
                      <Pencil size={16} />
                    </button>

                    {/* Active toggle */}
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={busyId === c.id}
                      role="switch"
                      aria-checked={active}
                      title={active ? 'Deaktiv et' : 'Aktiv et'}
                      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
                        active ? 'bg-brand-600' : 'bg-border'
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                          active ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-xs text-muted leading-relaxed">
        Deaktiv kateqoriyalar müştərilərə (vebsayt və mobil tətbiqdə) görünmür, amma silinmir —
        mövcud sifarişlər və alt-kateqoriyalar qorunur. İstənilən vaxt yenidən aktiv edə bilərsiniz.
      </p>
    </div>
  );
}
