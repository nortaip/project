import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Tag,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Button, Card } from '../components/ui';
import { parseExtras, type QLabels } from './opportunityUtils';

interface Opportunity {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  date: string;
  status?: string | null;
  category_id: string;
  subcategory_id: string;
  extra_answers: string;
  budget?: number | null;
  created_at: string;
}

interface Props {
  opportunity: Opportunity;
  categoryLabel: string;
  subcategoryLabel: string;
  questionLabels?: QLabels;
  onClose: () => void;
  onBid: () => void;
}

/**
 * Provider-in opportunity-yə detalli baxması üçün modal.
 * Məkan / xəritə + bütün cavablar + "Təklif ver" CTA.
 */
export default function OpportunityDetailModal({
  opportunity,
  categoryLabel,
  subcategoryLabel,
  questionLabels = {},
  onClose,
  onBid,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [providerCity, setProviderCity] = useState<string | null>(null);

  // ── Provider-in profil ünvanını çək (məsafə hint üçün) ──────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('address')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const addr = (data?.address as string | undefined) ?? '';
        // İlk vergüldən əvvəlki hissə şəhər kimi qəbul olunur
        const city = addr.split(',')[0]?.trim();
        setProviderCity(city || null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const opCity = useMemo(() => {
    if (!opportunity.location) return null;
    return opportunity.location.split(',')[0]?.trim() || null;
  }, [opportunity.location]);

  const sameCity = useMemo(() => {
    if (!opCity || !providerCity) return null;
    return opCity.toLowerCase() === providerCity.toLowerCase();
  }, [opCity, providerCity]);

  const extras = useMemo(
    () => parseExtras(opportunity.extra_answers, questionLabels),
    [opportunity.extra_answers, questionLabels],
  );

  const mapsUrl = opportunity.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opportunity.location)}`
    : null;

  const completed = opportunity.status === 'completed';

  // ESC → close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <Card
        variant="elevated"
        padding="none"
        className="w-full max-w-2xl relative my-auto max-h-[calc(100vh-2rem)] overflow-y-auto"
        // @ts-expect-error pass-through
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky close */}
        <button
          type="button"
          onClick={onClose}
          className="sticky top-3 right-3 ml-auto z-10 w-9 h-9 rounded-xl bg-white shadow-card hover:bg-brand-50 flex items-center justify-center text-muted hover:text-brand-600 transition-colors mr-3 mt-3"
          aria-label={t('common.close')}
          style={{ float: 'right' }}
        >
          <X size={18} />
        </button>

        <div className="p-6 sm:p-7">
          {/* Header */}
          <div className="mb-5">
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold uppercase tracking-wide">
                {categoryLabel}
              </span>
              {subcategoryLabel && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-bg text-ink-soft text-[11px] font-bold">
                  {subcategoryLabel}
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-ink leading-tight pr-12">
              {opportunity.title}
            </h2>
          </div>

          {/* Budget + Date row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {opportunity.budget != null && (
              <div className="p-4 rounded-2xl bg-success/5 border border-success/20">
                <div className="text-[11px] uppercase font-bold tracking-wide text-success/80 inline-flex items-center gap-1.5">
                  <Tag size={12} />
                  {t('opportunities.budget')}
                </div>
                <div className="mt-1 text-2xl font-extrabold text-success">
                  {opportunity.budget} ₼
                </div>
              </div>
            )}
            <div className="p-4 rounded-2xl bg-surface-bg border border-border">
              <div className="text-[11px] uppercase font-bold tracking-wide text-muted inline-flex items-center gap-1.5">
                <Calendar size={12} />
                {t('opportunityDetail.deadline')}
              </div>
              <div className="mt-1 text-base font-extrabold text-ink">
                {new Date(opportunity.date).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
            </div>
          </div>

          {/* ── Location block (highlighted) ────────────────────── */}
          <div className="mb-5 p-4 rounded-2xl bg-brand-50 border border-brand-100">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
                  <MapPin size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase font-bold tracking-wide text-brand-700">
                    {t('opportunityDetail.location')}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-ink leading-snug mt-0.5">
                    {opportunity.location || t('opportunityDetail.noLocation')}
                  </div>
                  {providerCity && opCity && (
                    <div
                      className={`mt-1.5 inline-flex items-center gap-1 text-xs font-bold ${
                        sameCity ? 'text-success' : 'text-warning'
                      }`}
                    >
                      <Briefcase size={11} />
                      {sameCity
                        ? t('opportunityDetail.sameCity')
                        : t('opportunityDetail.differentCity')}{' '}
                      <span className="text-muted font-medium">
                        ({t('opportunityDetail.yourLocation')}: {providerCity})
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white border border-brand-300 text-brand-700 hover:bg-brand-600 hover:text-white text-xs font-bold transition-colors"
                >
                  <ExternalLink size={12} />
                  <span className="hidden sm:inline">
                    {t('opportunityDetail.openInMaps')}
                  </span>
                </a>
              )}
            </div>
          </div>

          {/* Description */}
          {opportunity.description && (
            <div className="mb-5">
              <h3 className="text-xs uppercase font-bold tracking-wide text-muted mb-2">
                {t('opportunityDetail.description')}
              </h3>
              <p className="text-sm sm:text-base text-ink-soft leading-relaxed whitespace-pre-line">
                {opportunity.description}
              </p>
            </div>
          )}

          {/* Extras (full list, no clamp) */}
          {extras.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs uppercase font-bold tracking-wide text-muted mb-2">
                {t('opportunityDetail.extras')}
              </h3>
              <div className="bg-surface-bg rounded-2xl p-4 space-y-2">
                {extras.map((e) => (
                  <div key={e.key} className="flex items-start gap-3 text-sm">
                    {e.label && (
                      <span className="font-bold text-muted shrink-0 min-w-[32%]">
                        {e.label}:
                      </span>
                    )}
                    <span className="text-ink-soft flex-1">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer info */}
          <div className="flex items-center justify-between text-xs text-muted pb-4 border-b border-border mb-5">
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} />
              {t('opportunityDetail.createdAt')}:{' '}
              {new Date(opportunity.created_at).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          {/* CTA */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <Button variant="outline" size="lg" onClick={onClose} fullWidth>
              {t('common.close')}
            </Button>
            {!completed && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  onClose();
                  onBid();
                }}
                fullWidth
              >
                {t('opportunities.bid')}
              </Button>
            )}
            {completed && (
              <div className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-surface-bg text-muted text-sm font-bold">
                <CheckCircle2 size={14} /> {t('opportunities.completed')}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
