import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  HelpCircle, Plus, Pencil, Trash2, Search, Save, X, Check, AlertCircle, Loader2,
  FolderTree, Tag, ChevronDown, Sparkles, Type, List, FileText, Phone, Calendar,
  GripVertical, Wand2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface Category { id: string; label: string; }
interface Subcategory { id: string; category_id: string; label: string; }
interface Question {
  id: number;
  category_id: string;
  subcategory_id: string;
  label: string;
  name: string;
  type: string;
  options: string[] | null;
}

const QUESTION_TYPES: { value: string; label: string; icon: any; description: string }[] = [
  { value: 'text', label: 'Mətn', icon: Type, description: 'Tək sətrlik mətn sahəsi' },
  { value: 'textarea', label: 'Uzun mətn', icon: FileText, description: 'Çoxsətrli mətn sahəsi' },
  { value: 'select', label: 'Seçim', icon: List, description: 'Hazır seçimlərdən biri' },
  { value: 'tel', label: 'Telefon', icon: Phone, description: 'Telefon nömrəsi' },
  { value: 'date', label: 'Tarix', icon: Calendar, description: 'Tarix seçici' },
];

const EXAMPLE_NAMES = [
  'car_model_year', 'phone', 'service_type', 'repair_type',
  'description', 'budget', 'address', 'urgency',
];

// Azərbaycan → latin transliterasiya + snake_case
const AZ_MAP: Record<string, string> = {
  'ə': 'e', 'ı': 'i', 'ö': 'o', 'ü': 'u', 'ğ': 'g', 'ş': 's', 'ç': 'c',
  'Ə': 'E', 'I': 'I', 'Ö': 'O', 'Ü': 'U', 'Ğ': 'G', 'Ş': 'S', 'Ç': 'C',
};

function toSnakeCase(input: string): string {
  if (!input) return '';
  const transliterated = input
    .split('')
    .map((ch) => AZ_MAP[ch] ?? ch)
    .join('');
  return transliterated
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // yalnız hərf/rəqəm/boşluq/alt-xətt
    .trim()
    .replace(/\s+/g, '_')          // boşluq → alt-xətt
    .replace(/_+/g, '_')           // çoxlu alt-xətt → tək
    .replace(/^_|_$/g, '')         // baş/son alt-xətti təmizlə
    .slice(0, 40);
}

export default function QuestionsAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAIGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selection
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');

  // Form
  const [editId, setEditId] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [optionList, setOptionList] = useState<string[]>(['']);
  // Auto-name: əgər istifadəçi manuel dəyişməyibsə, label-dan generate et
  const [nameAuto, setNameAuto] = useState(true);

  // Search + delete confirm
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Load categories
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

  // Load subcategories when category changes
  useEffect(() => {
    if (!selectedCategory) {
      setSubcategories([]);
      setSelectedSubcategory('');
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('service_subcategories')
        .select('id, category_id, label')
        .eq('category_id', selectedCategory)
        .order('label');
      setSubcategories((data ?? []) as Subcategory[]);
      setSelectedSubcategory('');
    })();
  }, [selectedCategory]);

  // Load questions when both selected
  useEffect(() => {
    if (!selectedCategory || !selectedSubcategory) {
      setQuestions([]);
      return;
    }
    void loadQuestions();
  }, [selectedCategory, selectedSubcategory]);

  async function loadQuestions() {
    setLoadingQuestions(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('service_questions')
      .select('id, category_id, subcategory_id, label, name, type, options')
      .eq('category_id', selectedCategory)
      .eq('subcategory_id', selectedSubcategory)
      .order('id');
    if (err) setError(err.message);
    else setQuestions((data ?? []) as Question[]);
    setLoadingQuestions(false);
  }

  function resetForm() {
    setEditId(null);
    setLabel('');
    setName('');
    setType('text');
    setOptionList(['']);
    setNameAuto(true);
  }

  function handleLabelChange(v: string) {
    setLabel(v);
    if (nameAuto) {
      setName(toSnakeCase(v));
    }
  }

  function handleNameChange(v: string) {
    setNameAuto(false);
    setName(v.replace(/\s/g, '_').toLowerCase());
  }

  function regenerateName() {
    setNameAuto(true);
    setName(toSnakeCase(label));
  }

  function updateOption(index: number, value: string) {
    setOptionList((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptionList((prev) => [...prev, '']);
  }

  function removeOption(index: number) {
    setOptionList((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [''] : next;
    });
  }

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg((m) => (m === msg ? null : m)), 2200);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCategory || !selectedSubcategory || !label.trim() || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const cleanedOptions =
        type === 'select'
          ? optionList.map((o) => o.trim()).filter(Boolean)
          : [];
      const payload = {
        category_id: selectedCategory,
        subcategory_id: selectedSubcategory,
        label: label.trim(),
        name: name.trim(),
        type,
        options: cleanedOptions.length > 0 ? cleanedOptions : null,
      };
      if (editId) {
        const { error: err } = await supabase
          .from('service_questions')
          .update(payload)
          .eq('id', editId);
        if (err) throw err;
        flash('Sual yeniləndi');
      } else {
        const { error: err } = await supabase
          .from('service_questions')
          .insert(payload);
        if (err) throw err;
        flash('Sual əlavə olundu');
      }
      resetForm();
      await loadQuestions();
    } catch (err: any) {
      setError(err.message ?? 'Xəta baş verdi');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(q: Question) {
    setEditId(q.id);
    setLabel(q.label);
    setName(q.name);
    setType(q.type);
    setOptionList(q.options && q.options.length > 0 ? [...q.options] : ['']);
    setNameAuto(false); // edit-də manual qəbul edirik
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id: number) {
    setError(null);
    const { error: err } = await supabase
      .from('service_questions')
      .delete()
      .eq('id', id);
    if (err) {
      setError(`Silinmədi: ${err.message}`);
    } else {
      flash('Sual silindi');
      if (editId === id) resetForm();
      await loadQuestions();
    }
    setDeletingId(null);
  }

  async function generateAIQuestions() {
    if (!selectedCategory || !selectedSubcategory) return;
    const cat = categories.find((c) => c.id === selectedCategory);
    const sub = subcategories.find((s) => s.id === selectedSubcategory);
    if (!cat || !sub) return;

    setAIGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/ai-question-generator',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category_id: cat.id,
            category_label: cat.label,
            subcategory_id: sub.id,
            subcategory_label: sub.label,
          }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        flash(`${data.count} sual AI ilə yaradıldı`);
        await loadQuestions();
      } else {
        throw new Error(data.message ?? 'AI cavab vermədi');
      }
    } catch (err: any) {
      setError(err.message ?? 'AI xidmətinə qoşulmaq mümkün olmadı');
    } finally {
      setAIGenerating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter(
      (qu) =>
        qu.label.toLowerCase().includes(q) ||
        qu.name.toLowerCase().includes(q),
    );
  }, [questions, search]);

  const selectedCatLabel = categories.find((c) => c.id === selectedCategory)?.label ?? '';
  const selectedSubLabel = subcategories.find((s) => s.id === selectedSubcategory)?.label ?? '';
  const breadcrumb = selectedCatLabel
    ? selectedSubLabel
      ? `${selectedCatLabel} → ${selectedSubLabel}`
      : selectedCatLabel
    : 'Kateqoriya seçin';

  const showForm = !!selectedSubcategory;
  const isSelectType = type === 'select';

  return (
    <AdminLayout title="Suallar" subtitle={breadcrumb}>
      <div className="max-w-6xl space-y-6">
        {/* Hero */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 border border-brand-100 p-5 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
            <HelpCircle size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-extrabold text-ink">Dinamik suallar</h3>
            <p className="text-sm text-ink-soft mt-1 leading-relaxed">
              Hər alt kateqoriya üçün xüsusi suallar — sifariş yaradılarkən
              müştəriyə göstərilir. Mətn, seçim, telefon, tarix tipləri
              dəstəklənir. AI ilə avtomatik sual yaratmaq olar.
            </p>
          </div>
        </div>

        {/* Kateqoriya + alt kateqoriya seçici */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-white p-5">
            <label className="block text-xs font-bold text-ink-soft mb-2 uppercase tracking-wide">
              Ana kateqoriya
            </label>
            <div className="relative">
              <FolderTree
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none"
              />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                disabled={loadingCats}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-bold appearance-none cursor-pointer disabled:bg-surface-alt"
              >
                <option value="">— Seçin —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5">
            <label className="block text-xs font-bold text-ink-soft mb-2 uppercase tracking-wide">
              Alt kateqoriya
            </label>
            <div className="relative">
              <Tag
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none"
              />
              <select
                value={selectedSubcategory}
                onChange={(e) => setSelectedSubcategory(e.target.value)}
                disabled={!selectedCategory}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-bold appearance-none cursor-pointer disabled:bg-surface-alt disabled:text-muted"
              >
                <option value="">
                  {selectedCategory ? '— Seçin —' : 'Əvvəlcə kateqoriya seçin'}
                </option>
                {subcategories.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
            </div>
          </div>
        </div>

        {/* Bildirimlər */}
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

        {showForm && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Form (sticky) */}
            <form
              onSubmit={handleSubmit}
              className="lg:col-span-2 lg:sticky lg:top-6 self-start rounded-2xl border border-border bg-white p-5 space-y-4 h-fit"
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  editId ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'
                }`}>
                  {editId ? <Pencil size={15} /> : <Plus size={15} />}
                </div>
                <h3 className="font-extrabold text-ink">
                  {editId ? 'Sualı redaktə et' : 'Yeni sual'}
                </h3>
              </div>

              {/* Sual başlığı */}
              <div>
                <label className="block text-xs font-bold text-ink-soft mb-1.5 uppercase tracking-wide">
                  Sual başlığı
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  placeholder="məs: Avtomobil modeli və il"
                  className="w-full px-3 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-bold"
                />
                <p className="text-xs text-muted mt-1">
                  İstifadəçinin görəcəyi sual mətni
                </p>
              </div>

              {/* Texniki ad (name) — auto-generated */}
              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-ink-soft uppercase tracking-wide">
                    Texniki açar (name)
                  </span>
                  {nameAuto ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                      <Wand2 size={10} />
                      Avtomatik
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={regenerateName}
                      title="Avtomatik yenidən yarat"
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 hover:bg-brand-50 px-1.5 py-0.5 rounded transition-colors"
                    >
                      <Wand2 size={10} />
                      Yenidən yarat
                    </button>
                  )}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="avtomatik yaradılır..."
                  list="example-names"
                  className="w-full px-3 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-mono"
                />
                <datalist id="example-names">
                  {EXAMPLE_NAMES.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <p className="text-xs text-muted mt-1">
                  Başlıqdan avtomatik yaradılır. Lazım olsa əl ilə dəyişin.
                </p>
              </div>

              {/* Tip seçimi (visual chip-lər) */}
              <div>
                <label className="block text-xs font-bold text-ink-soft mb-2 uppercase tracking-wide">
                  Sual tipi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {QUESTION_TYPES.map((t) => {
                    const Icon = t.icon;
                    const selected = type === t.value;
                    return (
                      <button
                        type="button"
                        key={t.value}
                        onClick={() => setType(t.value)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-bold transition-all ${
                          selected
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-border bg-white text-ink-soft hover:border-brand-300'
                        }`}
                        title={t.description}
                      >
                        <Icon size={14} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Seçim variantları (yalnız select tipi üçün) — hər biri ayrı input */}
              {isSelectType && (
                <div>
                  <label className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-ink-soft uppercase tracking-wide">
                      Seçim variantları
                    </span>
                    <span className="text-[10px] font-bold text-muted">
                      {optionList.filter((o) => o.trim()).length} dolu
                    </span>
                  </label>
                  <div className="space-y-2">
                    {optionList.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2 group">
                        <GripVertical size={14} className="text-muted shrink-0" />
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-extrabold text-muted bg-surface-alt rounded-md px-1.5 py-0.5">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => updateOption(idx, e.target.value)}
                            onKeyDown={(e) => {
                              // Enter → yeni boş variant
                              if (
                                e.key === 'Enter' &&
                                opt.trim() &&
                                idx === optionList.length - 1
                              ) {
                                e.preventDefault();
                                addOption();
                              }
                              // Backspace boş input → sil
                              if (
                                e.key === 'Backspace' &&
                                !opt &&
                                optionList.length > 1
                              ) {
                                e.preventDefault();
                                removeOption(idx);
                              }
                            }}
                            placeholder={`Variant ${idx + 1}`}
                            className="w-full pl-10 pr-9 py-2 rounded-lg border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(idx)}
                            disabled={optionList.length === 1 && !opt}
                            title="Variantı sil"
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-muted hover:bg-red-100 hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed border-border text-ink-soft hover:border-brand-500 hover:text-brand-700 hover:bg-brand-50 font-bold text-xs transition-all"
                  >
                    <Plus size={13} />
                    Yeni variant əlavə et
                  </button>
                  <p className="text-xs text-muted mt-2">
                    Enter ilə növbəti variantı əlavə edin, boş Backspace ilə silin
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  type="submit"
                  disabled={!label.trim() || !name.trim() || saving}
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

              {/* AI Generate */}
              <button
                type="button"
                onClick={generateAIQuestions}
                disabled={aiGenerating}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {aiGenerating ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {aiGenerating ? 'AI yaradır...' : 'AI ilə sual yarat'}
              </button>
            </form>

            {/* List */}
            <div className="lg:col-span-3 rounded-2xl border border-border bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-3">
                <h3 className="font-extrabold text-ink flex-1">Suallar</h3>
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

              {loadingQuestions ? (
                <div className="py-16 flex items-center justify-center text-muted">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  Yüklənir...
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <HelpCircle size={32} className="text-muted mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted font-medium">
                    {search ? 'Nəticə tapılmadı' : 'Hələ sual yoxdur'}
                  </p>
                  {!search && (
                    <p className="text-xs text-muted mt-1">
                      Sol formadan yeni sual əlavə edin və ya AI ilə yaradın
                    </p>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((q) => {
                    const typeMeta = QUESTION_TYPES.find((t) => t.value === q.type);
                    const TypeIcon = typeMeta?.icon ?? Type;
                    return (
                      <li
                        key={q.id}
                        className={`px-5 py-3.5 hover:bg-surface-alt transition-colors ${
                          editId === q.id ? 'bg-brand-50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                            <TypeIcon size={15} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-extrabold text-ink text-sm leading-tight">
                              {q.label}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <code className="text-[10px] bg-surface-alt text-ink-soft px-1.5 py-0.5 rounded font-mono font-bold">
                                {q.name}
                              </code>
                              <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                                {typeMeta?.label ?? q.type}
                              </span>
                              {q.options && q.options.length > 0 && (
                                <span className="text-[10px] text-muted">
                                  {q.options.length} seçim
                                </span>
                              )}
                            </div>
                            {q.options && q.options.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {q.options.slice(0, 4).map((opt, i) => (
                                  <span
                                    key={i}
                                    className="text-[10px] bg-white border border-border text-ink-soft px-1.5 py-0.5 rounded"
                                  >
                                    {opt}
                                  </span>
                                ))}
                                {q.options.length > 4 && (
                                  <span className="text-[10px] text-muted">
                                    +{q.options.length - 4}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEdit(q)}
                              title="Redaktə et"
                              className="w-8 h-8 rounded-lg bg-surface-alt text-ink-soft hover:bg-brand-100 hover:text-brand-700 flex items-center justify-center transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            {deletingId === q.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(q.id)}
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
                                onClick={() => setDeletingId(q.id)}
                                title="Sil"
                                className="w-8 h-8 rounded-lg bg-surface-alt text-ink-soft hover:bg-red-100 hover:text-danger flex items-center justify-center transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {!showForm && selectedCategory && !selectedSubcategory && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <Tag size={28} className="text-amber-600 mx-auto mb-2" />
            <p className="font-bold text-ink">Alt kateqoriya seçin</p>
            <p className="text-sm text-muted mt-1">
              Sual əlavə etmək üçün həm ana, həm də alt kateqoriya seçilməlidir.
            </p>
          </div>
        )}

        {!selectedCategory && (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-center">
            <FolderTree size={28} className="text-brand-600 mx-auto mb-2" />
            <p className="font-bold text-ink">Kateqoriya seçməklə başlayın</p>
            <p className="text-sm text-muted mt-1">
              Yuxarıdan kateqoriya seçin ki, alt kateqoriyalar və suallar görünsün.
            </p>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
