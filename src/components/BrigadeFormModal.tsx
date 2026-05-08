import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Field, Input, Textarea } from './ui';

export interface BrigadeFormValues {
  name: string;
  slug: string | null;
  description: string;
  logo_url: string | null;
  contact_phone: string;
  contact_email: string;
  address: string;
  categories: string[];
  service_radius_km: number | null;
}

interface Props {
  initial?: Partial<BrigadeFormValues> & { id?: string };
  onClose: () => void;
  onSave: (values: BrigadeFormValues) => Promise<void>;
}

const CATEGORY_PRESETS = [
  'Təmizlik',
  'Santexnika',
  'Elektrik',
  'Çatdırılma',
  'Köçürmə',
  'Bağçılıq',
  'Təmir',
  'Gözəllik',
  'Tikinti',
];

export default function BrigadeFormModal({ initial, onClose, onSave }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initial?.categories ?? [],
  );
  const [serviceRadius, setServiceRadius] = useState<string>(
    initial?.service_radius_km ? String(initial.service_radius_km) : '',
  );
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Şirkət adı boş ola bilməz');
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        slug: slug.trim() || null,
        description: description.trim(),
        logo_url: logoUrl.trim() || null,
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim(),
        address: address.trim(),
        categories: selectedCategories,
        service_radius_km: serviceRadius ? Number(serviceRadius) : null,
      });
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
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">
            {initial?.id ? 'Şirkəti redaktə et' : 'Yeni şirkət'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center transition-colors"
            aria-label="Bağla"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-1">
          <Field label="Şirkət adı" required>
            <Input
              placeholder="AS Təmizlik MMC"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Slug (URL hissəsi)" hint="Boş qoy: avtomatik yaradılacaq">
            <Input
              placeholder="as-temizlik"
              value={slug}
              onChange={(e) =>
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .replace(/-+/g, '-'),
                )
              }
            />
          </Field>

          <Field label="Təsvir">
            <Textarea
              placeholder="Şirkət haqqında qısa məlumat, xidmətlər, üstünlüklər..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

          <Field label="Loqo URL" hint="https:// ilə başlayan şəkil linki">
            <Input
              type="url"
              placeholder="https://..."
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Əlaqə telefonu">
              <Input
                type="tel"
                placeholder="+994 XX XXX XX XX"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </Field>
            <Field label="Əlaqə email">
              <Input
                type="email"
                placeholder="info@as-temizlik.az"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Ofis ünvanı">
            <Input
              placeholder="Bakı, Nizami küçəsi 12"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>

          <Field label="Xidmət kateqoriyaları" hint="Birdən çox seçə bilərsən">
            <div className="flex flex-wrap gap-2 mt-1">
              {CATEGORY_PRESETS.map((cat) => {
                const selected = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-sm font-bold transition-all border ${
                      selected
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-ink-soft border-border hover:border-brand-300'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Xidmət radiusu (km)" hint="Boş qoy: limit yoxdur">
            <Input
              type="number"
              min={0}
              max={1000}
              placeholder="25"
              value={serviceRadius}
              onChange={(e) => setServiceRadius(e.target.value)}
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
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
            >
              {initial?.id ? 'Yenilə' : 'Yarat'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
