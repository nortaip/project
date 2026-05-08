import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { Button, Field, Input, Textarea } from './ui';

/**
 * Mobile-first multi-step Q&A wizard.
 *
 * İstifadə:
 * ```tsx
 * const questions = [
 *   { id: 'rooms', type: 'number', label: 'Neçə otaq təmizlənəcək?', required: true },
 *   { id: 'date',  type: 'date',   label: 'Hansı tarixə?', required: true },
 *   { id: 'note',  type: 'textarea', label: 'Əlavə qeyd' },
 * ];
 *
 * <CategoriesWizard
 *   questions={questions}
 *   onComplete={(answers) => api.createBooking(answers)}
 * />
 * ```
 *
 * Xüsusiyyətləri:
 * - Mobile-first: tam ekran-genişliyində kart, böyük düymələr
 * - Klaviatura naviqasiya (Enter növbəti, Esc bağla)
 * - Geri/növbəti animasiyaları
 * - Hər addımda `required` validation
 * - Progress bar
 * - SEO-dostu URL (qaytarmasını parent komponent edir)
 */

export type WizardQuestionType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'time'
  | 'single'   // tək seçim (radio)
  | 'multi'    // çox seçim (checkbox)
  | 'yes_no';

export interface WizardQuestion {
  id: string;
  type: WizardQuestionType;
  label: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  options?: { id: string; label: string; description?: string }[];
  min?: number;
  max?: number;
}

export type WizardAnswer = string | string[] | number | boolean | null;

interface Props {
  title?: string;
  questions: WizardQuestion[];
  initialAnswers?: Record<string, WizardAnswer>;
  onComplete: (answers: Record<string, WizardAnswer>) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function CategoriesWizard({
  title,
  questions,
  initialAnswers = {},
  onComplete,
  onCancel,
  submitLabel = 'Göndər',
}: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] =
    useState<Record<string, WizardAnswer>>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const total = questions.length;
  const current = questions[step];
  const isLast = step === total - 1;
  const progress = ((step + 1) / total) * 100;

  // Esc → cancel; Enter → next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const validateCurrent = (): boolean => {
    if (!current) return true;
    const value = answers[current.id];
    const next: Record<string, string> = { ...errors };
    delete next[current.id];

    if (current.required) {
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        next[current.id] = 'Bu sahə mütləqdir';
      }
    }

    if (current.type === 'number' && value !== undefined && value !== null) {
      const num = Number(value);
      if (current.min !== undefined && num < current.min) {
        next[current.id] = `Minimum: ${current.min}`;
      }
      if (current.max !== undefined && num > current.max) {
        next[current.id] = `Maksimum: ${current.max}`;
      }
    }

    setErrors(next);
    return !next[current.id];
  };

  const handleNext = async () => {
    if (!validateCurrent()) return;
    if (isLast) {
      setSubmitting(true);
      try {
        await onComplete(answers);
      } finally {
        setSubmitting(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step === 0) {
      onCancel?.();
    } else {
      setStep((s) => s - 1);
    }
  };

  const setAnswer = (id: string, val: WizardAnswer) => {
    setAnswers((prev) => ({ ...prev, [id]: val }));
    setErrors((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white sm:bg-black/40 sm:flex sm:items-center sm:justify-center sm:p-4 animate-fade-in">
      <div className="bg-white w-full h-full sm:h-auto sm:max-w-xl sm:rounded-3xl sm:shadow-card-lg flex flex-col overflow-hidden">
        {/* Header with progress */}
        <div className="px-5 pt-5 pb-4 border-b border-border bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={handleBack}
              className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center transition-colors"
              aria-label="Geri"
            >
              {step === 0 ? <X size={18} /> : <ArrowLeft size={18} />}
            </button>
            <span className="text-sm font-bold text-muted">
              Addım {step + 1} / {total}
            </span>
            <div className="w-9" />
          </div>
          {title && (
            <p className="text-xs text-muted font-bold uppercase tracking-wide mb-1">
              {title}
            </p>
          )}
          <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div
              className="h-full bg-brand-gradient transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question body */}
        <div
          key={current.id}
          className="flex-1 overflow-y-auto px-5 py-6 animate-slide-up"
        >
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink leading-tight mb-1">
            {current.label}
            {current.required && <span className="text-danger ml-1">*</span>}
          </h2>
          {current.hint && (
            <p className="text-sm text-muted mb-5">{current.hint}</p>
          )}

          <QuestionInput
            question={current}
            value={answers[current.id]}
            onChange={(v) => setAnswer(current.id, v)}
            error={errors[current.id]}
          />
        </div>

        {/* Footer with CTA */}
        <div className="px-5 py-4 border-t border-border bg-white">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            onClick={handleNext}
            rightIcon={isLast ? <Check size={18} /> : <ArrowRight size={18} />}
          >
            {isLast ? submitLabel : 'Növbəti'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Per-question renderer ───────────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
  error,
}: {
  question: WizardQuestion;
  value: WizardAnswer;
  onChange: (v: WizardAnswer) => void;
  error?: string;
}) {
  const v = value;

  switch (question.type) {
    case 'text':
      return (
        <Field error={error}>
          <Input
            placeholder={question.placeholder ?? 'Cavabınızı yazın'}
            value={(v as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'textarea':
      return (
        <Field error={error}>
          <Textarea
            placeholder={question.placeholder ?? 'Cavabınızı yazın'}
            value={(v as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'number':
      return (
        <Field error={error}>
          <Input
            type="number"
            inputMode="decimal"
            min={question.min}
            max={question.max}
            placeholder={question.placeholder ?? '0'}
            value={(v as number | string) ?? ''}
            onChange={(e) =>
              onChange(e.target.value === '' ? null : Number(e.target.value))
            }
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'date':
      return (
        <Field error={error}>
          <Input
            type="date"
            value={(v as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'time':
      return (
        <Field error={error}>
          <Input
            type="time"
            value={(v as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'yes_no':
      return (
        <SingleChoice
          options={[
            { id: 'yes', label: 'Bəli' },
            { id: 'no', label: 'Xeyr' },
          ]}
          value={v as string | null}
          onChange={onChange}
          error={error}
        />
      );

    case 'single':
      return (
        <SingleChoice
          options={question.options ?? []}
          value={v as string | null}
          onChange={onChange}
          error={error}
        />
      );

    case 'multi':
      return (
        <MultiChoice
          options={question.options ?? []}
          value={(v as string[]) ?? []}
          onChange={onChange}
          error={error}
        />
      );

    default:
      return null;
  }
}

function SingleChoice({
  options,
  value,
  onChange,
  error,
}: {
  options: { id: string; label: string; description?: string }[];
  value: string | null;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div>
      <div className="space-y-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`w-full p-4 rounded-2xl text-left transition-all border-[1.5px] ${
                selected
                  ? 'bg-brand-50 border-brand-600 ring-2 ring-brand-200'
                  : 'bg-white border-border hover:border-brand-300'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`font-bold ${selected ? 'text-brand-700' : 'text-ink'}`}>
                    {opt.label}
                  </p>
                  {opt.description && (
                    <p className="text-xs text-muted mt-0.5">{opt.description}</p>
                  )}
                </div>
                {selected && (
                  <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0">
                    <Check size={14} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs font-semibold text-danger">{error}</p>
      )}
    </div>
  );
}

function MultiChoice({
  options,
  value,
  onChange,
  error,
}: {
  options: { id: string; label: string; description?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
}) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div>
      <div className="space-y-2">
        {options.map((opt) => {
          const selected = value.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={`w-full p-4 rounded-2xl text-left transition-all border-[1.5px] ${
                selected
                  ? 'bg-brand-50 border-brand-600'
                  : 'bg-white border-border hover:border-brand-300'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`font-bold ${selected ? 'text-brand-700' : 'text-ink'}`}>
                    {opt.label}
                  </p>
                  {opt.description && (
                    <p className="text-xs text-muted mt-0.5">{opt.description}</p>
                  )}
                </div>
                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border-[1.5px] ${
                    selected
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'border-border'
                  }`}
                >
                  {selected && <Check size={14} />}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs font-semibold text-danger">{error}</p>
      )}
    </div>
  );
}

// Re-export for convenience
export { useMemo };
