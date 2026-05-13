import { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Field, Input, Textarea } from '../components/ui';

interface OpportunityRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  date: string | null;
  status: string | null;
  budget: number | null;
  category_id: string | null;
  created_at: string;
}

interface CategoryRow {
  id: string;
  label: string;
}

interface OfferRow {
  id: string;
  opportunity_id: string;
  offer_amount: number | null;
  status: string;
  created_at: string;
}

interface Props {
  brigadeId: string;
  brigadeOwnerId: string;
  brigadeCategories: string[];
  brigadeBalance: number;
}

export default function BrigadeDispatchPanel({
  brigadeId,
  brigadeCategories,
  brigadeBalance,
}: Props) {
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [myOffers, setMyOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionPct, setCommissionPct] = useState(0);
  const [offerOpp, setOfferOpp] = useState<OpportunityRow | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadeId]);

  const load = async () => {
    setLoading(true);
    try {
      // 1. Komissiya faizi
      const { data: rates } = await supabase.rpc('get_commission_rates');
      if (rates && typeof rates === 'object') {
        setCommissionPct(
          Number((rates as Record<string, number>).commission_on_accept ?? 0),
        );
      }

      // 2. Kateqoriya ID-lərini briqada label-larına görə tap
      const { data: cats } = await supabase
        .from('service_categories')
        .select('id, label');
      const allCategories = (cats ?? []) as CategoryRow[];
      setCategories(allCategories);

      const matchingCatIds = allCategories
        .filter((c) =>
          brigadeCategories.some(
            (bc) => bc.toLowerCase() === c.label.toLowerCase(),
          ),
        )
        .map((c) => c.id);

      // 3. Bu kateqoriyalara uyğun açıq sifarişlər
      let opps: OpportunityRow[] = [];
      if (matchingCatIds.length > 0) {
        const { data } = await supabase
          .from('opportunities')
          .select(
            'id, title, description, location, date, status, budget, category_id, created_at',
          )
          .in('category_id', matchingCatIds)
          .in('status', ['pending', 'open', 'new', 'active'])
          .order('created_at', { ascending: false })
          .limit(100);
        opps = (data ?? []) as OpportunityRow[];
      }
      setOpportunities(opps);

      // 4. Briqadanın artıq verdiyi təkliflər
      const { data: offers } = await supabase
        .from('opportunities_offers')
        .select('id, opportunity_id, offer_amount, status, created_at')
        .eq('brigade_id', brigadeId)
        .order('created_at', { ascending: false })
        .limit(100);
      setMyOffers((offers ?? []) as OfferRow[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const offeredOppIds = useMemo(() => {
    const m: Record<string, OfferRow> = {};
    for (const o of myOffers) {
      if (o.status === 'pending' || o.status === 'accepted') {
        m[o.opportunity_id] = o;
      }
    }
    return m;
  }, [myOffers]);

  const categoryById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.label;
    return m;
  }, [categories]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Balance + commission summary */}
      <Card variant="default" padding="md" className="mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div>
              <p className="text-xs text-muted font-bold uppercase tracking-wide">
                Briqada balansı
              </p>
              <p className="text-xl font-extrabold text-ink">
                {brigadeBalance.toFixed(2)} ₼
              </p>
            </div>
          </div>
          <div className="text-xs text-muted">
            Qəbul komissiyası: <b className="text-ink">{commissionPct}%</b>
            <br />
            Hər təklif üçün balansda komissiya məbləği qədər olmalıdır
          </div>
        </div>
      </Card>

      {opportunities.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Briefcase size={32} />}
            title="Uyğun açıq sifariş yoxdur"
            description="Briqadanızın kateqoriyalarına uyğun yeni sifariş gəldikcə burada görünəcək."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {opportunities.map((opp) => {
            const existing = offeredOppIds[opp.id];
            return (
              <OpportunityCard
                key={opp.id}
                opp={opp}
                categoryLabel={
                  opp.category_id ? categoryById[opp.category_id] : null
                }
                existingOffer={existing}
                onOffer={() => setOfferOpp(opp)}
              />
            );
          })}
        </div>
      )}

      {offerOpp && (
        <PlaceOfferModal
          brigadeId={brigadeId}
          opp={offerOpp}
          brigadeBalance={brigadeBalance}
          commissionPct={commissionPct}
          onClose={() => setOfferOpp(null)}
          onDone={async () => {
            setOfferOpp(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function OpportunityCard({
  opp,
  categoryLabel,
  existingOffer,
  onOffer,
}: {
  opp: OpportunityRow;
  categoryLabel: string | null;
  existingOffer?: OfferRow;
  onOffer: () => void;
}) {
  const dt = new Date(opp.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card variant="default" padding="md">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-extrabold text-ink">
              {opp.title ?? 'Yeni sifariş'}
            </h3>
            {categoryLabel && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-brand-50 text-brand-700">
                {categoryLabel}
              </span>
            )}
            {existingOffer && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                  existingOffer.status === 'accepted'
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                {existingOffer.status === 'accepted'
                  ? 'Qəbul edildi'
                  : `Sizin təklif: ${existingOffer.offer_amount} ₼`}
              </span>
            )}
          </div>
          {opp.description && (
            <p className="text-sm text-muted line-clamp-2 mb-2">
              {opp.description}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            {opp.budget != null && (
              <span className="inline-flex items-center gap-1 font-bold text-brand-700">
                <Wallet size={14} /> Büdcə: {opp.budget} AZN
              </span>
            )}
            {opp.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {opp.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-muted">
              <Calendar size={14} /> {dt}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          {existingOffer ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-alt text-muted text-sm font-bold cursor-default"
            >
              <CheckCircle2 size={14} /> Təklif verilib
            </button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Send size={14} />}
              onClick={onOffer}
            >
              Təklif ver
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function PlaceOfferModal({
  brigadeId,
  opp,
  brigadeBalance,
  commissionPct,
  onClose,
  onDone,
}: {
  brigadeId: string;
  opp: OpportunityRow;
  brigadeBalance: number;
  commissionPct: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(opp.budget ? String(opp.budget) : '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = parseFloat(amount) || 0;
  const requiredBalance = (num * commissionPct) / 100;
  const insufficient = requiredBalance > brigadeBalance;

  const handleSubmit = async () => {
    setError(null);
    if (num <= 0) {
      setError('Düzgün məbləğ daxil edin');
      return;
    }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc('brigade_place_offer', {
      p_brigade_id: brigadeId,
      p_opportunity_id: opp.id,
      p_amount: num,
      p_notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (rpcErr) {
      if (rpcErr.message.includes('NO_BALANCE')) {
        setError('Briqada balansı yetərli deyil. Əvvəlcə balansı artırın.');
      } else {
        setError(rpcErr.message);
      }
      return;
    }
    message.success('Təklif göndərildi');
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-extrabold text-ink">Briqadadan təklif ver</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-surface-alt rounded-xl p-3">
            <p className="font-extrabold text-ink mb-1">{opp.title}</p>
            {opp.budget != null && (
              <p className="text-sm text-muted">Müştəri büdcəsi: {opp.budget} AZN</p>
            )}
          </div>

          <Field label="Təklif məbləği (₼)" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="Qeyd (istəyə bağlı)">
            <Textarea
              placeholder="İşin müddəti, daxil olan xidmətlər və s."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </Field>

          {num > 0 && (
            <div
              className={`rounded-xl border p-3 text-sm ${
                insufficient
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <div className="flex items-center gap-2">
                {insufficient ? (
                  <Clock size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                <span>
                  Komissiya: <b>{commissionPct}%</b> = <b>{requiredBalance.toFixed(2)} ₼</b>
                </span>
              </div>
              <p className="text-xs mt-1 opacity-80">
                Briqada balansı: <b>{brigadeBalance.toFixed(2)} ₼</b>
                {insufficient && ' — yetərli deyil!'}
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" size="lg" fullWidth onClick={onClose} disabled={submitting}>
              Ləğv et
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleSubmit}
              disabled={num <= 0 || insufficient}
            >
              Təklif ver
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
