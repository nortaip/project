import { useEffect, useState } from 'react';
import { message } from 'antd';
import {
  Briefcase,
  Calendar,
  Check,
  Mail,
  Phone,
  User as UserIcon,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Textarea } from '../components/ui';

interface ProviderRequest {
  id: string;
  user_id: string;
  message: string | null;
  company_name: string | null;
  experience_years: number | null;
  specialties: string[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
  applicant?: {
    id: string;
    name: string | null;
    email: string | null;
    phone_number: string | null;
    avatar_url: string | null;
  } | null;
}

const STATUS_FILTERS = [
  { value: 'pending', label: 'Gözləyən' },
  { value: 'approved', label: 'Təsdiqlənmiş' },
  { value: 'rejected', label: 'İmtina edilmiş' },
  { value: 'all', label: 'Hamısı' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function ProviderRequestsAdmin() {
  const [reqs, setReqs] = useState<ProviderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [decisionFor, setDecisionFor] = useState<{
    req: ProviderRequest;
    action: 'approve' | 'reject';
  } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    void load();
  }, [filter]);

  const load = async () => {
    setLoading(true);
    try {
      // Gözləyən sayı filtrdən asılı olmasın — ayrıca count sorğusu
      const pendingCountPromise = supabase
        .from('provider_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      let query = supabase
        .from('provider_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (filter !== 'all') query = query.eq('status', filter);
      const { data, error } = await query.limit(200);
      if (error) throw error;

      const rows = (data ?? []) as ProviderRequest[];
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      let profMap: Record<string, ProviderRequest['applicant']> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, email, phone_number, avatar_url')
          .in('id', userIds);
        profMap = Object.fromEntries(
          (profs ?? []).map((p) => [p.id, p as ProviderRequest['applicant']]),
        );
      }
      setReqs(
        rows.map((r) => ({ ...r, applicant: profMap[r.user_id] ?? null })),
      );

      const { count } = await pendingCountPromise;
      setPendingCount(count ?? 0);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const counts = { pending: pendingCount };

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-xl text-sm font-bold transition-all border ${
              filter === f.value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-ink-soft border-border hover:border-brand-300'
            }`}
          >
            {f.label}
            {f.value === 'pending' && counts.pending > 0 && (
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-md text-xs ${
                  filter === f.value
                    ? 'bg-white/20'
                    : 'bg-warning/15 text-warning'
                }`}
              >
                {counts.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reqs.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Briefcase size={32} />}
            title="Müraciət yoxdur"
            description="Bu filtrə uyğun provayder müraciəti tapılmadı."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {reqs.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              onApprove={() => setDecisionFor({ req, action: 'approve' })}
              onReject={() => setDecisionFor({ req, action: 'reject' })}
            />
          ))}
        </div>
      )}

      {decisionFor && (
        <DecisionModal
          req={decisionFor.req}
          action={decisionFor.action}
          onClose={() => setDecisionFor(null)}
          onDone={async () => {
            setDecisionFor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function RequestRow({
  req,
  onApprove,
  onReject,
}: {
  req: ProviderRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const dt = new Date(req.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const app = req.applicant;

  return (
    <Card variant="default" padding="md">
      <div className="flex items-start gap-3">
        {app?.avatar_url ? (
          <img
            src={app.avatar_url}
            alt={app.name ?? ''}
            className="w-14 h-14 rounded-2xl object-cover shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-extrabold text-xl">
            {(app?.name ?? app?.email ?? '?')[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-extrabold text-ink">
              {app?.name ?? app?.email ?? `ID: ${req.user_id.slice(0, 8)}`}
            </h3>
            <StatusBadge status={req.status} />
          </div>
          {req.message && (
            <p className="text-sm text-ink-soft mb-2">{req.message}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-2">
            {app?.email && (
              <span className="inline-flex items-center gap-1">
                <Mail size={12} /> {app.email}
              </span>
            )}
            {app?.phone_number && (
              <span className="inline-flex items-center gap-1">
                <Phone size={12} /> {app.phone_number}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} /> {dt}
            </span>
          </div>
          {(req.company_name || req.experience_years != null) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft mb-2">
              {req.company_name && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase size={12} /> {req.company_name}
                </span>
              )}
              {req.experience_years != null && (
                <span className="inline-flex items-center gap-1">
                  <UserIcon size={12} /> {req.experience_years} il təcrübə
                </span>
              )}
            </div>
          )}
          {req.specialties.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {req.specialties.map((s) => (
                <span
                  key={s}
                  className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {req.admin_note && req.status !== 'pending' && (
            <p className="mt-2 text-xs text-ink-soft bg-surface-alt rounded-lg px-2 py-1">
              <span className="font-bold">Admin qeydi:</span> {req.admin_note}
            </p>
          )}
        </div>
        {req.status === 'pending' && (
          <div className="flex flex-col gap-2 shrink-0">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Check size={14} />}
              onClick={onApprove}
            >
              Təsdiqlə
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<X size={14} />}
              onClick={onReject}
            >
              İmtina
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: ProviderRequest['status'] }) {
  const cls =
    status === 'pending'
      ? 'bg-warning/15 text-warning'
      : status === 'approved'
      ? 'bg-success/15 text-success'
      : status === 'rejected'
      ? 'bg-danger/15 text-danger'
      : 'bg-muted/15 text-muted';
  const label =
    status === 'pending'
      ? 'Gözləyir'
      : status === 'approved'
      ? 'Təsdiqlənmiş'
      : status === 'rejected'
      ? 'İmtina'
      : 'Ləğv edildi';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${cls}`}>
      {label}
    </span>
  );
}

function DecisionModal({
  req,
  action,
  onClose,
  onDone,
}: {
  req: ProviderRequest;
  action: 'approve' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isApprove = action === 'approve';

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (isApprove) {
        const { error } = await supabase.rpc('admin_approve_provider_request', {
          p_request_id: req.id,
          p_note: note.trim() || null,
        });
        if (error) throw error;
        message.success('Provayder təsdiqləndi');
      } else {
        if (!note.trim()) {
          message.warning('İmtina səbəbini qeyd edin');
          setSubmitting(false);
          return;
        }
        const { error } = await supabase.rpc('admin_reject_provider_request', {
          p_request_id: req.id,
          p_reason: note.trim(),
        });
        if (error) throw error;
        message.success('İmtina edildi');
      }
      onDone();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-card-lg max-h-[92vh] overflow-y-auto animate-slide-up p-5">
        <h2 className="text-lg font-extrabold text-ink mb-2">
          {isApprove ? 'Provayder təsdiqi' : 'Müraciəti imtina et'}
        </h2>
        <p className="text-sm text-muted mb-4">
          {isApprove ? (
            <>
              <span className="font-bold text-ink">
                {req.applicant?.name ?? req.applicant?.email ?? '—'}
              </span>{' '}
              provayder statusuna keçəcək.
            </>
          ) : (
            <>İmtina səbəbini qeyd edin — istifadəçiyə bildiriləcək.</>
          )}
        </p>

        <Textarea
          placeholder={
            isApprove ? 'Daxili qeyd (istəyə bağlı)' : 'İmtina səbəbi (məcburi)'
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />

        <div className="flex gap-3 pt-4">
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
            type="button"
            variant={isApprove ? 'primary' : 'danger'}
            size="lg"
            fullWidth
            loading={submitting}
            onClick={handleSubmit}
          >
            {isApprove ? 'Təsdiqlə' : 'İmtina et'}
          </Button>
        </div>
      </div>
    </div>
  );
}
