import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
  User,
} from 'lucide-react';
import { Modal, message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  Field,
  Input,
  PageContainer,
  Textarea,
} from '../components/ui';
import { SEO, serviceJsonLd, breadcrumbJsonLd } from '../components/SEO';

interface Service {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  location: string | null;
  rating: number | null;
  reviews_count: number | null;
  images: string[] | null;
  packages: Package[] | null;
  business_hours: Record<string, string> | null;
  provider_id: string;
}

interface Package {
  id?: string;
  name: string;
  price: number;
  duration?: string;
  description?: string;
}

/** DB-də packages TEXT (JSON sətri) kimi saxlanılır — massivə salır, xarab
 * dəyərdə boş massiv qaytarır ki, səhifə çökməsin. */
function parsePackages(raw: unknown): Package[] {
  if (Array.isArray(raw)) return raw as Package[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Package[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface Provider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  is_verified: boolean | null;
  phone_number: string | null;
  experience_years: number | null;
}

export function BookService() {
  const { t } = useTranslation();
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [service, setService] = useState<Service | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);

  // Booking form
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!serviceId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: svc, error: svcErr } = await supabase
        .from('services')
        .select('*')
        .eq('id', serviceId)
        .single();
      if (svcErr) throw svcErr;
      setService(svc as Service);

      if (svc?.provider_id) {
        const { data: pr } = await supabase
          .from('profiles')
          .select(
            'id, name, avatar_url, rating, is_verified, phone_number, experience_years',
          )
          .eq('id', svc.provider_id)
          .single();
        setProvider(pr as Provider | null);
      }

      // Default package
      const pkgs = parsePackages(svc?.packages);
      if (pkgs.length > 0) setSelectedPackage(pkgs[0]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const totalPrice = selectedPackage?.price ?? service?.price ?? 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login', {
        state: { message: 'Sifariş etmək üçün daxil olun' },
      });
      return;
    }
    if (!service) return;

    const next: Record<string, string> = {};
    if (!date) next.date = 'Tarix seçin';
    if (!time) next.time = 'Vaxt seçin';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      // Server tərəfdə atomik: 1 ₼ komissiya balansdan tutulur + sifariş yaranır
      const { data, error } = await supabase.rpc('create_booking_with_fee', {
        p_service_id: service.id,
        p_date: date,
        p_time: time,
        p_package_name: selectedPackage?.name ?? null,
        p_package_price: selectedPackage?.price ?? null,
        p_package_duration: selectedPackage?.duration ?? null,
        p_notes: notes || null,
      });
      if (error) throw error;
      const res = (data ?? {}) as { ok?: boolean; error?: string; booking_id?: string };
      if (res.ok !== true) {
        if (res.error === 'INSUFFICIENT_BALANCE') {
          Modal.confirm({
            title: t('bookService.feeInsufficientTitle'),
            content: t('bookService.feeInsufficientBody'),
            okText: t('balance.topUpTitle', { defaultValue: 'Balansı artır' }),
            cancelText: t('common.close'),
            onOk: () => navigate('/balance'),
          });
        } else {
          message.error(`Xəta: ${res.error ?? 'UNKNOWN'}`);
        }
        return;
      }
      message.success('Sifariş yaradıldı!');
      navigate(`/bookings/confirmation?id=${res.booking_id}`);
    } catch (e) {
      // PostgrestError adi obyektdir — message sahəsini çıxar
      const msg =
        e instanceof Error
          ? e.message
          : ((e as { message?: string })?.message ?? JSON.stringify(e));
      message.error(`Xəta: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-20">
          <Loader2 size={36} className="animate-spin text-brand-600" />
        </div>
      </PageContainer>
    );
  }

  if (!service) {
    return (
      <PageContainer size="md">
        <Card variant="elevated" padding="lg" className="text-center">
          <h1 className="text-xl font-extrabold text-ink mb-2">Xidmət tapılmadı</h1>
          <Link to="/services">
            <Button variant="primary" size="md">
              Xidmətlərə qayıt
            </Button>
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const packages = parsePackages(service.packages);

  return (
    <PageContainer size="lg">
      <SEO
        title={service.title}
        description={
          service.description?.slice(0, 160) ??
          `${service.title} — Ellit.az üzərindən onlayn sifariş et. Kateqoriya: ${service.category}.`
        }
        canonical={`https://ellit.az/book/${service.id}`}
        type="product"
        image={service.images?.[0] ?? undefined}
        jsonLd={[
          serviceJsonLd({
            name: service.title,
            description: service.description,
            price: service.price,
            currency: 'AZN',
            category: service.category,
            image: service.images?.[0],
            providerName: provider?.name ?? undefined,
            rating: service.rating,
            reviewCount: service.reviews_count,
          }),
          breadcrumbJsonLd([
            { name: 'Ana səhifə', url: 'https://ellit.az/' },
            { name: 'Xidmətlər', url: 'https://ellit.az/services' },
            { name: service.title, url: `https://ellit.az/book/${service.id}` },
          ]),
        ]}
      />
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={16} /> Geri
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5">
        {/* Service info */}
        <div>
          {/* Image */}
          {service.images?.[0] && (
            <div
              className="w-full h-64 sm:h-80 rounded-3xl bg-cover bg-center mb-5"
              style={{ backgroundImage: `url(${service.images[0]})` }}
            />
          )}

          <div className="mb-4">
            <span className="text-xs uppercase font-bold tracking-wide text-brand-600">
              {service.category}
            </span>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
              {service.title}
            </h1>
            <div className="mt-2 flex items-center gap-3 text-sm text-muted flex-wrap">
              {(service.rating ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 font-bold text-warning">
                  <Star size={14} className="fill-warning" />
                  {Number(service.rating ?? 0).toFixed(1)}
                  {service.reviews_count
                    ? ` · ${service.reviews_count} rəy`
                    : ''}
                </span>
              )}
              {service.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {service.location}
                </span>
              )}
            </div>
          </div>

          {service.description && (
            <Card variant="default" padding="md" className="mb-4">
              <h2 className="font-extrabold text-ink mb-2">Təsvir</h2>
              <p className="text-ink-soft leading-relaxed whitespace-pre-line">
                {service.description}
              </p>
            </Card>
          )}

          {/* Packages */}
          {packages.length > 0 && (
            <Card variant="default" padding="md" className="mb-4">
              <h2 className="font-extrabold text-ink mb-3">{t('bookService.selectPackage')}</h2>
              <div className="space-y-2">
                {packages.map((pkg, i) => {
                  const selected = selectedPackage?.name === pkg.name;
                  return (
                    <button
                      key={pkg.id ?? i}
                      type="button"
                      onClick={() => setSelectedPackage(pkg)}
                      className={`w-full p-4 rounded-2xl text-left transition-all border-[1.5px] ${
                        selected
                          ? 'bg-brand-50 border-brand-600'
                          : 'bg-white border-border hover:border-brand-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p
                            className={`font-extrabold ${
                              selected ? 'text-brand-700' : 'text-ink'
                            }`}
                          >
                            {pkg.name}
                          </p>
                          {pkg.duration && (
                            <p className="text-xs text-muted mt-0.5 inline-flex items-center gap-1">
                              <Clock size={11} /> {pkg.duration}
                            </p>
                          )}
                          {pkg.description && (
                            <p className="text-sm text-muted mt-1">
                              {pkg.description}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-extrabold text-ink">
                            {Number(pkg.price).toFixed(0)} ₼
                          </p>
                          {selected && (
                            <span className="inline-block mt-1 text-xs text-brand-600">
                              <CheckCircle2 size={12} className="inline" /> Seçildi
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Provider card */}
          {provider && (
            <Card variant="default" padding="md">
              <h2 className="font-extrabold text-ink mb-3">{t('bookService.providerLabel')}</h2>
              <Link
                to={`/provider/${provider.id}`}
                className="flex items-center gap-3 p-3 rounded-2xl hover:bg-surface-alt transition-colors"
              >
                {provider.avatar_url ? (
                  <img
                    src={provider.avatar_url}
                    alt={provider.name ?? ''}
                    className="w-14 h-14 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center font-extrabold text-lg">
                    {(provider.name ?? '?')[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-ink truncate">
                      {provider.name ?? '—'}
                    </span>
                    {provider.is_verified && (
                      <ShieldCheck size={14} className="text-success" />
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {(provider.rating ?? 0) > 0 && (
                      <span>★ {Number(provider.rating ?? 0).toFixed(1)}</span>
                    )}
                    {provider.experience_years && (
                      <span className="ml-2">
                        · {t('providerProfile.experience', { count: provider.experience_years })}
                      </span>
                    )}
                  </div>
                </div>
                {provider.phone_number && (
                  <a
                    href={`tel:${provider.phone_number}`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center hover:bg-brand-100"
                    aria-label={t('providerProfile.callPhone')}
                  >
                    <Phone size={18} />
                  </a>
                )}
              </Link>
            </Card>
          )}
        </div>

        {/* Booking form */}
        <div>
          <Card
            variant="elevated"
            padding="lg"
            className="lg:sticky lg:top-4"
          >
            <h2 className="font-extrabold text-ink text-lg mb-4">{t('bookService.title')}</h2>

            <form onSubmit={handleSubmit} noValidate>
              <Field
                label={t('bookService.selectDate')}
                required
                icon={<Calendar size={20} />}
                error={errors.date}
              >
                <Input
                  hasIcon
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  invalid={Boolean(errors.date)}
                />
              </Field>

              <Field
                label={t('bookService.selectTime')}
                required
                icon={<Clock size={20} />}
                error={errors.time}
              >
                <Input
                  hasIcon
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  invalid={Boolean(errors.time)}
                />
              </Field>

              <Field label={t('bookService.notes')}>
                <Textarea
                  rows={3}
                  placeholder={t('bookService.notesPlaceholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>

              {/* Total */}
              <div className="my-5 p-4 bg-brand-50/50 border border-brand-100 rounded-2xl">
                <div className="flex justify-between items-baseline">
                  <span className="text-muted font-medium">{t('bookService.totalAmount')}</span>
                  <span className="text-2xl font-extrabold text-ink">
                    {Number(totalPrice).toFixed(2)} ₼
                  </span>
                </div>
                {selectedPackage && (
                  <p className="text-xs text-muted mt-1">
                    {t('bookService.selectPackage')}: {selectedPackage.name}
                  </p>
                )}
                <p className="text-xs text-brand-700 font-semibold mt-2">
                  {t('bookService.feeNote')}
                </p>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
                leftIcon={<CreditCard size={18} />}
              >
                {user ? t('bookService.submit') : t('auth.loginSubmit')}
              </Button>

              {!user && (
                <p className="mt-3 text-xs text-center text-muted">
                  {t('bookService.loginRequired')}
                </p>
              )}
            </form>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

export default BookService;
