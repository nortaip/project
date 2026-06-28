import React, { useEffect, useRef, useState } from 'react';
import {
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
}

type Draft = {
  id?: string;
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
  sort_order: number;
};

const EMPTY: Draft = {
  title: '',
  subtitle: '',
  image_url: '',
  link_url: '',
  is_active: true,
  sort_order: 0,
};

export default function BannersAdmin() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: dbErr } = await supabase
      .from('banners')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (dbErr) setError(dbErr.message);
    setBanners((data as Banner[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (b: Banner) => {
    setBanners((prev) =>
      prev.map((x) => (x.id === b.id ? { ...x, is_active: !x.is_active } : x)),
    );
    const { error: dbErr } = await supabase
      .from('banners')
      .update({ is_active: !b.is_active, updated_at: new Date().toISOString() })
      .eq('id', b.id);
    if (dbErr) {
      setError(dbErr.message);
      await load();
    }
  };

  const remove = async (b: Banner) => {
    if (!confirm(`"${b.title}" bannerini silmək istəyirsiniz?`)) return;
    const { error: dbErr } = await supabase.from('banners').delete().eq('id', b.id);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    await load();
  };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-brand-soft">
            <ImageIcon size={22} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-ink tracking-tight">Reklam bannerləri</h2>
            <p className="text-sm text-muted">
              {banners.filter((b) => b.is_active).length} aktiv · {banners.length} ümumi
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY, sort_order: banners.length })}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors shadow-brand-soft"
        >
          <Plus size={18} /> Yeni banner
        </button>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-danger/5 border border-danger/20 text-sm text-danger flex items-start gap-2">
          <X size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted">
          <Loader2 className="animate-spin mr-2" size={18} /> Yüklənir...
        </div>
      ) : banners.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted bg-surface-alt rounded-2xl border border-border">
          Hələ banner yoxdur. "Yeni banner" düyməsi ilə əlavə edin.
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => (
            <div
              key={b.id}
              className={`flex items-center gap-4 p-3 rounded-2xl border transition-colors ${
                b.is_active ? 'bg-white border-border' : 'bg-surface-alt border-border opacity-70'
              }`}
            >
              <GripVertical size={16} className="text-muted shrink-0 hidden sm:block" />
              <div
                className="w-28 h-16 rounded-xl bg-cover bg-center bg-surface-alt shrink-0 border border-border"
                style={{ backgroundImage: b.image_url ? `url(${b.image_url})` : undefined }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink truncate">{b.title}</div>
                {b.subtitle && (
                  <div className="text-sm text-muted truncate">{b.subtitle}</div>
                )}
                {b.link_url && (
                  <div className="text-xs text-brand-600 truncate mt-0.5">{b.link_url}</div>
                )}
              </div>
              <span className="text-xs font-bold text-muted shrink-0 hidden sm:block">
                #{b.sort_order}
              </span>
              <button
                onClick={() => toggleActive(b)}
                role="switch"
                aria-checked={b.is_active}
                title={b.is_active ? 'Deaktiv et' : 'Aktiv et'}
                className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
                  b.is_active ? 'bg-brand-600' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                    b.is_active ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
              <button
                onClick={() =>
                  setEditing({
                    id: b.id,
                    title: b.title,
                    subtitle: b.subtitle ?? '',
                    image_url: b.image_url,
                    link_url: b.link_url ?? '',
                    is_active: b.is_active,
                    sort_order: b.sort_order,
                  })
                }
                className="w-9 h-9 rounded-xl bg-surface-alt text-ink-soft flex items-center justify-center hover:bg-border/60 transition-colors shrink-0"
                title="Redaktə et"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => remove(b)}
                className="w-9 h-9 rounded-xl bg-danger/5 text-danger flex items-center justify-center hover:bg-danger/10 transition-colors shrink-0"
                title="Sil"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted leading-relaxed">
        Aktiv bannerlər ana səhifədə (vebsayt və mobil tətbiqdə) axtarışdan dərhal sonra karusel
        formasında göstərilir. Sıra "Sıra nömrəsi" ilə müəyyən olunur (kiçik nömrə əvvəl gəlir).
      </p>

      {editing && (
        <BannerEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function BannerEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `banner-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('banners')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('banners').getPublicUrl(path);
      setD((p) => ({ ...p, image_url: data.publicUrl }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setErr(null);
    if (!d.title.trim()) {
      setErr('Başlıq boş ola bilməz');
      return;
    }
    if (!d.image_url.trim()) {
      setErr('Şəkil tələb olunur (yükləyin və ya URL daxil edin)');
      return;
    }
    setSaving(true);
    const payload = {
      title: d.title.trim(),
      subtitle: d.subtitle.trim() || null,
      image_url: d.image_url.trim(),
      link_url: d.link_url.trim() || null,
      is_active: d.is_active,
      sort_order: Number.isFinite(d.sort_order) ? d.sort_order : 0,
      updated_at: new Date().toISOString(),
    };
    const resp = d.id
      ? await supabase.from('banners').update(payload).eq('id', d.id)
      : await supabase.from('banners').insert([payload]);
    setSaving(false);
    if (resp.error) {
      setErr(resp.error.message);
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-extrabold text-ink">
            {d.id ? 'Banneri redaktə et' : 'Yeni banner'}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Image */}
          <div>
            <label className="text-sm font-bold text-ink">Şəkil</label>
            <div
              className="mt-1.5 w-full h-40 rounded-2xl bg-cover bg-center bg-surface-alt border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-brand-400 transition-colors"
              style={{ backgroundImage: d.image_url ? `url(${d.image_url})` : undefined }}
              onClick={() => fileRef.current?.click()}
            >
              {!d.image_url && (
                <div className="text-center text-muted">
                  {uploading ? (
                    <Loader2 size={24} className="animate-spin mx-auto" />
                  ) : (
                    <>
                      <Upload size={24} className="mx-auto mb-1" />
                      <span className="text-sm font-semibold">Şəkil yüklə</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <input
              type="url"
              placeholder="və ya şəkil URL-i: https://..."
              value={d.image_url}
              onChange={(e) => setD({ ...d, image_url: e.target.value })}
              className="mt-2 w-full h-11 px-3 rounded-xl border border-border focus:border-brand-500 outline-none text-sm"
            />
          </div>

          <Field label="Başlıq">
            <input
              value={d.title}
              onChange={(e) => setD({ ...d, title: e.target.value })}
              placeholder="məs. Yay endirimləri"
              className="w-full h-11 px-3 rounded-xl border border-border focus:border-brand-500 outline-none text-sm"
            />
          </Field>

          <Field label="Alt başlıq (istəyə bağlı)">
            <input
              value={d.subtitle}
              onChange={(e) => setD({ ...d, subtitle: e.target.value })}
              placeholder="məs. Bütün təmizlik xidmətlərinə 20% endirim"
              className="w-full h-11 px-3 rounded-xl border border-border focus:border-brand-500 outline-none text-sm"
            />
          </Field>

          <Field label="Link (istəyə bağlı)" hint="Daxili (/xidmet/...) və ya tam URL">
            <input
              value={d.link_url}
              onChange={(e) => setD({ ...d, link_url: e.target.value })}
              placeholder="/usta-xidmeti və ya https://..."
              className="w-full h-11 px-3 rounded-xl border border-border focus:border-brand-500 outline-none text-sm"
            />
          </Field>

          <div className="flex items-center gap-4">
            <Field label="Sıra nömrəsi">
              <input
                type="number"
                value={d.sort_order}
                onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })}
                className="w-24 h-11 px-3 rounded-xl border border-border focus:border-brand-500 outline-none text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 mt-6 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={d.is_active}
                onChange={(e) => setD({ ...d, is_active: e.target.checked })}
                className="w-5 h-5 rounded accent-brand-600"
              />
              <span className="text-sm font-bold text-ink">Aktiv</span>
            </label>
          </div>

          {err && (
            <div className="px-4 py-2.5 rounded-xl bg-danger/5 border border-danger/20 text-sm text-danger">
              {err}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-2xl border border-border font-bold text-ink-soft hover:bg-surface-alt transition-colors"
            >
              Ləğv et
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || uploading}
              className="flex-1 h-12 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold transition-colors inline-flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {d.id ? 'Yadda saxla' : 'Əlavə et'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-bold text-ink">{label}</label>
      {hint && <span className="text-xs text-muted ml-2">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
