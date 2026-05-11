import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    ChevronRight,
    Edit2,
    Loader2,
    ShieldCheck,
    Sparkles,
    Tag,
    Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import InputMask from 'react-input-mask';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { SEO } from '../components/SEO';
import { useAuthStore } from '../store/auth';
import {
    Button,
    Card,
    Field,
    Input,
    PageContainer,
    Textarea,
} from '../components/ui';
import { supabase } from '../lib/supabase';

interface Category {
  id: string;
  label: string;
  label_ru?: string | null;
  label_en?: string | null;
}
interface Subcategory {
  id: string;
  label: string;
  label_ru?: string | null;
  label_en?: string | null;
  category_id: string;
}
interface Question {
  name: string;
  label?: string;
  label_ru?: string | null;
  label_en?: string | null;
  question?: string;
  question_ru?: string | null;
  question_en?: string | null;
  type: 'text' | 'textarea' | 'select' | 'tel' | 'date' | 'number';
  required?: boolean;
  options?: string[] | string;
  options_ru?: string[] | string | null;
  options_en?: string[] | string | null;
  placeholder?: string;
  placeholder_ru?: string | null;
  placeholder_en?: string | null;
  order_num?: number;
}

/** Locale-ə uyğun field seçir; tərcümə boşdursa default-a fallback edir */
function pickLocale<T extends Record<string, unknown>>(
  row: T,
  baseKey: string,
  lng: string,
): string {
  const langKey = lng.startsWith('ru') ? '_ru' : lng.startsWith('en') ? '_en' : '';
  if (langKey) {
    const v = row[baseKey + langKey];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return (row[baseKey] as string) ?? '';
}
interface ServicePrice {
  subcategory_id: string;
  min_price: number;
  max_price: number;
}

const STEP_KEYS = ['wizard.stepCategory', 'wizard.stepQuestions', 'wizard.stepConfirm'];

export default function DynamicServiceForm() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlCategoryLabel = urlParams.get('category');

  // ── Wizard state ───────────────────────────────────────────────
  // 0 = welcome, 1 = category, 2 = questions, 3 = confirm, 4 = success
  const [step, setStep] = useState(0);

  // ── Data state ─────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);

  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [questionIdx, setQuestionIdx] = useState(0);
  const [errorByField, setErrorByField] = useState<Record<string, string>>({});

  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingSubcats, setLoadingSubcats] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  // ── Login gate: əgər user step > 0-a düşsə amma authed deyilsə qaytar
  useEffect(() => {
    if (step > 0 && !user) {
      setStep(0);
    }
  }, [step, user]);

  // ── 1. Fetch categories ────────────────────────────────────────
  useEffect(() => {
    setLoadingCategories(true);
    supabase
      .from('service_categories')
      .select('id,label,label_ru,label_en')
      .order('label', { ascending: true })
      .then(({ data, error }) => {
        if (error) setTopError(t('wizard.errors.categoriesFail') + ': ' + error.message);
        else setCategories((data as Category[]) ?? []);
        setLoadingCategories(false);
      });
  }, []);

  // ── 2. Auto-select from URL ───────────────────────────────────
  useEffect(() => {
    if (urlCategoryLabel && categories.length > 0 && !categoryId) {
      const target = decodeURIComponent(urlCategoryLabel).trim().toLowerCase();
      // İstənilən locale-də label uyğunluğu axtar (label/label_ru/label_en)
      const found = categories.find((c) =>
        [c.label, c.label_ru, c.label_en]
          .filter((s): s is string => Boolean(s))
          .some((s) => s.trim().toLowerCase() === target),
      );
      if (found) {
        setCategoryId(found.id);
        setStep(1);
      }
    }
  }, [urlCategoryLabel, categories, categoryId]);

  // ── 3. Subcategory fetch on category change ───────────────────
  useEffect(() => {
    if (!categoryId) {
      setSubcategories([]);
      setSubcategoryId('');
      return;
    }
    setLoadingSubcats(true);
    setSubcategoryId('');
    supabase
      .from('service_subcategories')
      .select('id,label,label_ru,label_en,category_id')
      .eq('category_id', categoryId)
      .order('label', { ascending: true })
      .then(({ data, error }) => {
        if (error) setTopError(t('wizard.errors.subcatsFail') + ': ' + error.message);
        else setSubcategories((data as Subcategory[]) ?? []);
        setLoadingSubcats(false);
      });
  }, [categoryId]);

  // ── 4. Questions + prices fetch on subcategory change ─────────
  useEffect(() => {
    if (!subcategoryId) {
      setQuestions([]);
      setPrices([]);
      setAnswers({});
      setQuestionIdx(0);
      return;
    }
    setLoadingQuestions(true);
    Promise.all([
      supabase
        .from('service_questions')
        .select('*')
        .eq('category_id', categoryId)
        .eq('subcategory_id', subcategoryId)
        .order('order_num', { ascending: true }),
      supabase
        .from('service_prices')
        .select('subcategory_id,min_price,max_price')
        .eq('category_id', categoryId)
        .eq('subcategory_id', subcategoryId),
    ])
      .then(([{ data: qs, error: qErr }, { data: ps, error: pErr }]) => {
        if (qErr) setTopError(t('wizard.errors.questionsFail') + ': ' + qErr.message);
        else setQuestions((qs as Question[]) ?? []);
        if (pErr) setTopError(t('wizard.errors.questionsFail') + ': ' + pErr.message);
        else setPrices((ps as ServicePrice[]) ?? []);
        setQuestionIdx(0);
        setAnswers({});
        setLoadingQuestions(false);
      })
      .catch((err) => {
        setTopError('Yükləmə xətası: ' + (err as Error).message);
        setLoadingQuestions(false);
      });
  }, [subcategoryId, categoryId]);

  // ── Derived ────────────────────────────────────────────────────
  const priceRange = useMemo(() => {
    if (!prices.length) return null;
    return {
      min: Math.min(...prices.map((p) => Number(p.min_price))),
      max: Math.max(...prices.map((p) => Number(p.max_price))),
    };
  }, [prices]);

  const currentQuestion = questions[questionIdx];
  const totalQuestions = questions.length;
  const wizardStepIndex = step === 0 ? -1 : step - 1; // -1 hides indicator on welcome

  // ── Validation helper ─────────────────────────────────────────
  const validateAnswer = (q: Question, val: string | undefined): string | null => {
    if (q.required && (val == null || String(val).trim() === '')) {
      return t('wizard.errors.fieldRequired', {
        field:
          pickLocale(q, 'label', i18n.language) ||
          pickLocale(q, 'question', i18n.language) ||
          '',
      });
    }
    if (q.type === 'tel' && val && !/^\+994\d{9}$/.test(val.replace(/[^\d+]/g, ''))) {
      return t('wizard.errors.phoneInvalid');
    }
    if (q.type === 'number' && val && Number.isNaN(Number(val))) {
      return t('wizard.errors.numberOnly');
    }
    return null;
  };

  // ── Step navigation ───────────────────────────────────────────
  const goNextFromCategory = () => {
    if (!categoryId || !subcategoryId) return;
    if (questions.length === 0) {
      // Heç bir sual yoxdursa, birbaşa təsdiqə keç
      setStep(3);
    } else {
      setStep(2);
      setQuestionIdx(0);
    }
  };

  const goNextQuestion = () => {
    if (!currentQuestion) return;
    const err = validateAnswer(currentQuestion, answers[currentQuestion.name]);
    if (err) {
      setErrorByField({ [currentQuestion.name]: err });
      return;
    }
    setErrorByField({});
    if (questionIdx < totalQuestions - 1) {
      setQuestionIdx((i) => i + 1);
    } else {
      setStep(3);
    }
  };

  const goPrevQuestion = () => {
    setErrorByField({});
    if (questionIdx > 0) {
      setQuestionIdx((i) => i - 1);
    } else {
      setStep(1);
    }
  };

  // ── Submit ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setTopError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        setTopError(t('wizard.errors.loginRequired'));
        setSubmitting(false);
        return;
      }

      // Opportunity customer tərəfindən yaradılır; provider təyin EDİLMİR.
      // Provider yalnız offer qəbul olunduqda accepted_offer_id ilə təyin olunur.
      const { error } = await supabase.from('opportunities').insert({
        title: answers.title || 'Xidmət sorğusu',
        description: answers.description || '',
        created_by: userId,
        date: answers.date || new Date().toISOString().substring(0, 10),
        location: answers.location || '',
        category_id: categoryId,
        subcategory_id: subcategoryId,
        // 'pending' status — mobil və admin axınları bunu gözləyir
        status: 'pending',
        budget: priceRange ? priceRange.max : answers.budget ? Number(answers.budget) : null,
        extra_answers: JSON.stringify(answers),
      });

      if (error) {
        setTopError(t('wizard.errors.submitFail') + ': ' + error.message);
      } else {
        setStep(4);
      }
    } catch (err) {
      setTopError('Gözlənilməz xəta: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetWizard = () => {
    setStep(0);
    setCategoryId('');
    setSubcategoryId('');
    setAnswers({});
    setQuestionIdx(0);
    setErrorByField({});
    setTopError(null);
  };

  return (
    <PageContainer size="md" className="py-8 sm:py-12">
      <SEO
        title={t('wizard.title')}
        description={t('wizard.subtitle')}
        canonical="https://ellit.az/services"
        noindex
      />

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-gradient text-white shadow-brand-soft mb-3">
          <Wrench size={26} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
          {t('wizard.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-muted">
          {t('wizard.subtitle')}
        </p>
      </div>

      {/* ── Step indicator ────────────────────────────────────── */}
      {wizardStepIndex >= 0 && wizardStepIndex < 3 && (
        <StepIndicator current={wizardStepIndex} />
      )}

      {/* ── Top error ─────────────────────────────────────────── */}
      {topError && (
        <div className="mb-5 p-4 rounded-2xl bg-danger/5 border border-danger/20 flex items-start gap-3">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <div className="text-sm text-danger">{topError}</div>
        </div>
      )}

      {/* ── Step content ──────────────────────────────────────── */}
      <Card variant="elevated" padding="lg">
        {step === 0 && (
          <WelcomeStep
            isAuthed={!!user}
            onStart={() => {
              // Login gate — autenfikasiyasız sorğu yarada bilməzsən
              if (!user) {
                navigate('/login', {
                  state: { from: location.pathname + location.search },
                  replace: false,
                });
                return;
              }
              setStep(1);
            }}
          />
        )}

        {step === 1 && (
          <CategoryStep
            categories={categories}
            subcategories={subcategories}
            categoryId={categoryId}
            subcategoryId={subcategoryId}
            loadingCategories={loadingCategories}
            loadingSubcats={loadingSubcats}
            onPickCategory={(id) => {
              setCategoryId(id);
              setSubcategoryId('');
            }}
            onPickSubcategory={(id) => setSubcategoryId(id)}
            onNext={goNextFromCategory}
            onBack={() => setStep(0)}
            priceRange={priceRange}
          />
        )}

        {step === 2 && (
          <QuestionsStep
            question={currentQuestion}
            questionIdx={questionIdx}
            totalQuestions={totalQuestions}
            answers={answers}
            errorByField={errorByField}
            loading={loadingQuestions}
            priceRange={priceRange}
            onChange={(name, val) => {
              setAnswers((a) => ({ ...a, [name]: val }));
              if (errorByField[name]) setErrorByField((e) => ({ ...e, [name]: '' }));
            }}
            onNext={goNextQuestion}
            onBack={goPrevQuestion}
          />
        )}

        {step === 3 && (
          <ConfirmStep
            categoryLabel={(() => {
              const c = categories.find((c) => c.id === categoryId);
              return c ? pickLocale(c, 'label', i18n.language) : '';
            })()}
            subcategoryLabel={(() => {
              const s = subcategories.find((s) => s.id === subcategoryId);
              return s ? pickLocale(s, 'label', i18n.language) : '';
            })()}
            answers={answers}
            questions={questions}
            priceRange={priceRange}
            submitting={submitting}
            onEditCategory={() => setStep(1)}
            onEditAnswers={() => {
              if (questions.length > 0) {
                setStep(2);
                setQuestionIdx(0);
              }
            }}
            onBack={() => {
              if (questions.length > 0) setStep(2);
              else setStep(1);
            }}
            onSubmit={handleSubmit}
          />
        )}

        {step === 4 && (
          <SuccessStep
            onCreateNew={resetWizard}
            onViewMine={() => navigate('/account/services')}
          />
        )}
      </Card>
    </PageContainer>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step Indicator
// ════════════════════════════════════════════════════════════════════
function StepIndicator({ current }: { current: number }) {
  const { t } = useTranslation();
  return (
    <div className="mb-8 max-w-md mx-auto">
      <div className="flex items-center">
        {STEP_KEYS.map((key, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={key} className="flex-1 flex items-center">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold transition-all ${
                    active
                      ? 'bg-brand-gradient text-white shadow-brand-soft'
                      : done
                      ? 'bg-success text-white'
                      : 'bg-surface-bg text-muted border border-border'
                  }`}
                >
                  {done ? <CheckCircle2 size={18} /> : i + 1}
                </div>
                <span
                  className={`mt-2 text-[11px] sm:text-xs font-bold tracking-wide uppercase ${
                    active ? 'text-brand-700' : done ? 'text-success' : 'text-muted'
                  }`}
                >
                  {t(key)}
                </span>
              </div>
              {i < STEP_KEYS.length - 1 && (
                <div
                  className={`flex-1 h-[2px] -mt-7 mx-1 transition-colors ${
                    done ? 'bg-success' : 'bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 0: Welcome
// ════════════════════════════════════════════════════════════════════
function WelcomeStep({
  onStart,
  isAuthed,
}: {
  onStart: () => void;
  isAuthed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-6 sm:py-10">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-brand-50 text-brand-600 mb-5">
        <Sparkles size={36} strokeWidth={2.2} />
      </div>
      <h2 className="text-xl sm:text-2xl font-extrabold text-ink mb-2">
        {t('wizard.welcomeTitle')}
      </h2>
      <p className="text-sm sm:text-base text-muted max-w-md mx-auto leading-relaxed mb-6">
        {t('wizard.welcomeBody')}
      </p>
      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        rightIcon={<ArrowRight size={18} />}
        className="px-8"
      >
        {isAuthed ? t('wizard.start') : t('auth.loginSubmit')}
      </Button>
      {!isAuthed && (
        <p className="mt-3 text-xs text-muted">
          {t('wizard.errors.loginRequired')}
        </p>
      )}

      <ul className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left">
        <Feature icon={ShieldCheck} text={t('wizard.featureVerified')} />
        <Feature icon={Tag} text={t('wizard.featureTransparent')} />
        <Feature icon={CheckCircle2} text={t('wizard.featureFree')} />
      </ul>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <li className="flex items-center gap-2 p-3 rounded-2xl bg-surface-bg">
      <Icon size={18} className="text-brand-600 shrink-0" />
      <span className="text-xs sm:text-sm font-bold text-ink-soft">{text}</span>
    </li>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 1: Category + Subcategory
// ════════════════════════════════════════════════════════════════════
function CategoryStep({
  categories,
  subcategories,
  categoryId,
  subcategoryId,
  loadingCategories,
  loadingSubcats,
  onPickCategory,
  onPickSubcategory,
  onNext,
  onBack,
  priceRange,
}: {
  categories: Category[];
  subcategories: Subcategory[];
  categoryId: string;
  subcategoryId: string;
  loadingCategories: boolean;
  loadingSubcats: boolean;
  onPickCategory: (id: string) => void;
  onPickSubcategory: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
  priceRange: { min: number; max: number } | null;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <h2 className="text-lg sm:text-xl font-extrabold text-ink mb-1">{t('wizard.categoryTitle')}</h2>
      <p className="text-sm text-muted mb-5">{t('wizard.categorySubtitle')}</p>

      <Field label={t('wizard.categoryMain')} required>
        {loadingCategories ? (
          <div className="h-13 flex items-center justify-center bg-surface-alt rounded-2xl">
            <Loader2 size={18} className="animate-spin text-brand-600" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {categories.map((c) => {
              const active = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPickCategory(c.id)}
                  className={`flex items-center justify-between p-4 rounded-2xl text-left text-sm font-bold transition-all ${
                    active
                      ? 'bg-brand-50 border-2 border-brand-600 text-brand-700 shadow-brand-soft'
                      : 'bg-surface-alt border-2 border-border text-ink-soft hover:border-brand-300'
                  }`}
                >
                  <span>{pickLocale(c, 'label', i18n.language)}</span>
                  {active ? (
                    <CheckCircle2 size={18} className="text-brand-600" />
                  ) : (
                    <ChevronRight size={16} className="text-muted" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      {categoryId && (
        <Field label={t('wizard.categorySub')} required className="mt-6">
          {loadingSubcats ? (
            <div className="h-13 flex items-center justify-center bg-surface-alt rounded-2xl">
              <Loader2 size={18} className="animate-spin text-brand-600" />
            </div>
          ) : subcategories.length === 0 ? (
            <div className="p-4 bg-surface-alt rounded-2xl text-sm text-muted text-center">
              {t('wizard.noSubs')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {subcategories.map((s) => {
                const active = s.id === subcategoryId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPickSubcategory(s.id)}
                    className={`flex items-center justify-between p-4 rounded-2xl text-left text-sm font-bold transition-all ${
                      active
                        ? 'bg-brand-50 border-2 border-brand-600 text-brand-700 shadow-brand-soft'
                        : 'bg-surface-alt border-2 border-border text-ink-soft hover:border-brand-300'
                    }`}
                  >
                    <span>{pickLocale(s, 'label', i18n.language)}</span>
                    {active ? (
                      <CheckCircle2 size={18} className="text-brand-600" />
                    ) : (
                      <ChevronRight size={16} className="text-muted" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      )}

      {priceRange && (
        <PriceRangeCard min={priceRange.min} max={priceRange.max} />
      )}

      <NavButtons
        onBack={onBack}
        backLabel={t('common.back')}
        onNext={onNext}
        nextLabel={t('common.next')}
        nextDisabled={!categoryId || !subcategoryId}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 2: Questions (one at a time)
// ════════════════════════════════════════════════════════════════════
function QuestionsStep({
  question,
  questionIdx,
  totalQuestions,
  answers,
  errorByField,
  loading,
  priceRange,
  onChange,
  onNext,
  onBack,
}: {
  question?: Question;
  questionIdx: number;
  totalQuestions: number;
  answers: Record<string, string>;
  errorByField: Record<string, string>;
  loading: boolean;
  priceRange: { min: number; max: number } | null;
  onChange: (name: string, val: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-brand-600" />
      </div>
    );
  }
  if (!question) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted">{t('wizard.noQuestions')}</p>
        <Button variant="primary" size="lg" className="mt-5" onClick={onNext} rightIcon={<ArrowRight size={18} />}>
          {t('common.confirm')}
        </Button>
      </div>
    );
  }

  const progress = ((questionIdx + 1) / totalQuestions) * 100;
  const error = errorByField[question.name];
  const value = answers[question.name] ?? '';

  return (
    <div>
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted font-bold mb-2">
          <span>
            {t('wizard.questionProgress', { current: questionIdx + 1, total: totalQuestions })}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-surface-bg overflow-hidden">
          <div
            className="h-full bg-brand-gradient transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <Field
        label={
          pickLocale(question, 'label', i18n.language) ||
          pickLocale(question, 'question', i18n.language)
        }
        required={question.required}
        error={error}
      >
        <QuestionInput
          q={question}
          value={value}
          onChange={(v) => onChange(question.name, v)}
          invalid={!!error}
        />
      </Field>

      {priceRange && <PriceRangeCard min={priceRange.min} max={priceRange.max} />}

      <NavButtons
        onBack={onBack}
        backLabel={t('common.back')}
        onNext={onNext}
        nextLabel={questionIdx < totalQuestions - 1 ? t('common.next') : t('common.confirm')}
        nextDisabled={false}
      />
    </div>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
  invalid,
}: {
  q: Question;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const langSuffix = lng.startsWith('ru') ? '_ru' : lng.startsWith('en') ? '_en' : '';

  const optionsArr: string[] = useMemo(() => {
    // Locale-əsaslı options-u seç (boşdursa default)
    const localized = langSuffix ? (q as Record<string, unknown>)['options' + langSuffix] : null;
    const raw = localized || q.options;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    try {
      const parsed = JSON.parse(raw as string);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [q, langSuffix]);

  const placeholder = pickLocale(q, 'placeholder', lng);

  switch (q.type) {
    case 'select':
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-13 px-4 rounded-2xl bg-surface-alt outline-none transition-colors text-[15px] font-medium text-ink border-[1.5px] ${
            invalid
              ? 'border-danger focus:border-danger'
              : 'border-border focus:border-brand-600 focus:bg-white'
          }`}
        >
          <option value="" disabled>
            {placeholder || t('common.search')}
          </option>
          {optionsArr.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'textarea':
      return (
        <Textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          invalid={invalid}
        />
      );
    case 'tel':
      return (
        <InputMask
          mask="+994999999999"
          maskChar="_"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {(props: React.InputHTMLAttributes<HTMLInputElement>) => (
            <Input {...props} type="tel" placeholder="+994 _ _ _ _ _ _ _ _ _" invalid={invalid} />
          )}
        </InputMask>
      );
    case 'date':
      return (
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          invalid={invalid}
        />
      );
    default:
      return (
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          invalid={invalid}
        />
      );
  }
}

// ════════════════════════════════════════════════════════════════════
// Step 3: Confirm
// ════════════════════════════════════════════════════════════════════
function ConfirmStep({
  categoryLabel,
  subcategoryLabel,
  answers,
  questions,
  priceRange,
  submitting,
  onEditCategory,
  onEditAnswers,
  onBack,
  onSubmit,
}: {
  categoryLabel: string;
  subcategoryLabel: string;
  answers: Record<string, string>;
  questions: Question[];
  priceRange: { min: number; max: number } | null;
  submitting: boolean;
  onEditCategory: () => void;
  onEditAnswers: () => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <h2 className="text-lg sm:text-xl font-extrabold text-ink mb-1">{t('wizard.confirmTitle')}</h2>
      <p className="text-sm text-muted mb-5">{t('wizard.confirmSubtitle')}</p>

      <div className="space-y-3">
        <SummaryRow label={t('wizard.categoryMain')} value={categoryLabel} onEdit={onEditCategory} />
        <SummaryRow label={t('wizard.categorySub')} value={subcategoryLabel} onEdit={onEditCategory} />
        {questions.map((q) => {
          const v = answers[q.name];
          if (!v) return null;
          return (
            <SummaryRow
              key={q.name}
              label={
                pickLocale(q, 'label', i18n.language) ||
                pickLocale(q, 'question', i18n.language) ||
                q.name
              }
              value={String(v)}
              onEdit={onEditAnswers}
            />
          );
        })}
      </div>

      {priceRange && (
        <PriceRangeCard
          min={priceRange.min}
          max={priceRange.max}
          variant="success"
          label={t('wizard.estimatedBudget')}
        />
      )}

      <NavButtons
        onBack={onBack}
        backLabel={t('common.back')}
        onNext={onSubmit}
        nextLabel={submitting ? t('wizard.sending') : t('wizard.send')}
        nextDisabled={submitting}
        nextLoading={submitting}
        nextVariant="primary"
      />
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl bg-surface-bg hover:bg-brand-50 hover:border-brand-300 border border-transparent transition-all text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase font-bold tracking-wide text-muted">{label}</div>
        <div className="mt-0.5 text-sm sm:text-base font-bold text-ink truncate">{value}</div>
      </div>
      <Edit2 size={14} className="text-muted shrink-0" />
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 4: Success + Safety Tips
// ════════════════════════════════════════════════════════════════════
function SuccessStep({
  onCreateNew,
  onViewMine,
}: {
  onCreateNew: () => void;
  onViewMine: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-center py-4 sm:py-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-success/10 text-success mb-4">
          <CheckCircle2 size={40} strokeWidth={2.5} />
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-ink mb-2">
          {t('wizard.successTitle')}
        </h2>
        <p className="text-sm sm:text-base text-muted max-w-md mx-auto leading-relaxed">
          {t('wizard.successBody')}
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="primary" size="lg" onClick={onViewMine} rightIcon={<ArrowRight size={18} />}>
            {t('wizard.viewMine')}
          </Button>
          <Button variant="outline" size="lg" onClick={onCreateNew}>
            {t('wizard.createNew')}
          </Button>
        </div>
      </div>

      {/* Safety tips */}
      <div className="mt-6 p-5 rounded-3xl bg-warning/5 border border-warning/20">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={20} className="text-warning shrink-0" />
          <h3 className="text-base font-extrabold text-ink">{t('wizard.safetyTitle')}</h3>
        </div>
        <ul className="space-y-2 text-sm text-ink-soft leading-relaxed">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex gap-2">
              <span className="text-warning font-extrabold">•</span>
              <span>{t(`wizard.safetyTip${i}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Shared sub-components
// ════════════════════════════════════════════════════════════════════
function NavButtons({
  onBack,
  backLabel,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
  nextVariant = 'primary',
}: {
  onBack?: () => void;
  backLabel?: string;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  nextVariant?: 'primary' | 'secondary';
}) {
  return (
    <div className="mt-7 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
      {onBack && (
        <Button variant="outline" size="lg" onClick={onBack} leftIcon={<ArrowLeft size={18} />}>
          {backLabel ?? 'Geri'}
        </Button>
      )}
      <div className="sm:ml-auto">
        {onNext && (
          <Button
            variant={nextVariant}
            size="lg"
            onClick={onNext}
            disabled={nextDisabled}
            loading={nextLoading}
            rightIcon={!nextLoading ? <ArrowRight size={18} /> : undefined}
            fullWidth
          >
            {nextLabel ?? 'Növbəti'}
          </Button>
        )}
      </div>
    </div>
  );
}

function PriceRangeCard({
  min,
  max,
  label,
  variant = 'brand',
}: {
  min: number;
  max: number;
  label?: string;
  variant?: 'brand' | 'success';
}) {
  const { t } = useTranslation();
  const finalLabel = label ?? t('wizard.priceRange');
  const colorClass =
    variant === 'success'
      ? 'bg-success/5 border-success/20 text-success'
      : 'bg-brand-50 border-brand-100 text-brand-700';

  return (
    <div className={`mt-6 p-5 rounded-3xl border ${colorClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs sm:text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          <Tag size={16} />
          {finalLabel}
        </span>
        <span className="text-lg sm:text-2xl font-extrabold tracking-tight">
          {min} – {max} ₼
        </span>
      </div>
      <p className="text-[11px] sm:text-xs text-muted">
        {t('wizard.priceNote')}
      </p>
    </div>
  );
}
