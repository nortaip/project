import { useEffect, useState } from 'react';
import { message } from 'antd';
import {
  Building2,
  Calendar,
  Check,
  Mail,
  MapPin,
  Phone,
  User as UserIcon,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Textarea } from '../components/ui';

interface Application {
  id: string;
  applicant_id: string;
  name: string;
  description: string | null;
  categories: string[];
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  logo_url: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  admin_note: string | null;
  brigade_id: string | null;
  created_at: string;
  decided_at: string | null;
  applicant?: {
    id: string;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  } | null;
}

const STATUS_FILTERS = [
  { value: 'pending', label: 'Gözləyən' },
  { value: 'approved', label: 'Təsdiqlənmiş' },
  { value: 'rejected', label: 'İmtina edilmiş' },
  { value: 'all', label: 'Hamısı' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function BrigadeApplicationsAdmin() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [decisionFor, setDecisionFor] = useState<{
    app: Application;
    action: 'approve' | 'reject';
  } | null>(null);

  useEffect(() => {
    void load();
  }, [filter]);

  const load = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('brigade_applications')
        .select('*')
        .order('created_at', { ascending: false });
      if (filter !== 'all') {
        query = query.eq('status', filter);
      }
      const { data, error } = await query.limit(200);
      if (error) throw error;

      const rows = (data ?? []) as Application[];

      // Applicant profillərini ayrıca yüklə (FK auto-discovery ilə problem olur)
      const applicantIds = Array.from(
        new Set(rows.map((r) => r.applicant_id).filter(Boolean)),
      );
      let profMap: Record<string, Application['applicant']> = {};
      if (applicantIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, email, phone_number')
          .in('id', applicantIds);
        profMap = Object.fromEntries(
          (profs ?? []).map((p) => [p.id, p as Application['applicant']]),
        );
      }

      setApps(
        rows.map((r) => ({ ...r, applicant: profMap[r.applicant_id] ?? null })),
      );
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const counts = {
    pending: apps.filter((a) => a.status === 'pending').length,
  };

  return (
    <div className="space-y-5">
      {/* Filter chips */}
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
      ) : apps.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Building2 size={32} />}
            title="Müraciət yoxdur"
            description="Bu filtrə uyğun briqada müraciəti tapılmadı."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              onApprove={() => setDecisionFor({ app, action: 'approve' })}
              onReject={() => setDecisionFor({ app, action: 'reject' })}
            />
          ))}
        </div>
      )}

      {decisionFor && (
        <DecisionModal
          app={decisionFor.app}
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

function ApplicationRow({
  app,
  onApprove,
  onReject,
}: {
  app: Application;
  onApprove: () => void;
  onReject: () => void;
}) {
  const dt = new Date(app.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card variant="default" padding="md">
      <div className="flex items-start gap-3">
        {app.logo_url ? (
          <img
            src={app.logo_url}
            alt={app.name}
            className="w-14 h-14 rounded-2xl object-cover shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Building2 size={24} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-extrabold text-ink">{app.name}</h3>
            <StatusBadge status={app.status} />
          </div>
          {app.description && (
            <p className="text-sm text-muted line-clamp-2 mb-2">{app.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {app.categories.map((c) => (
              <span
                key={c}
                className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
              >
                {c}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <UserIcon size={12} />{' '}
              {app.applicant_name ?? app.applicant?.name ?? '—'}
            </span>
            {(app.applicant_email || app.applicant?.email) && (
              <span className="inline-flex items-center gap-1">
                <Mail size={12} />{' '}
                {app.applicant_email ?? app.applicant?.email}
              </span>
            )}
            {(app.contact_phone ||
              app.applicant_phone ||
              app.applicant?.phone_number) && (
              <span className="inline-flex items-center gap-1">
                <Phone size={12} />{' '}
                {app.contact_phone ??
                  app.applicant_phone ??
                  app.applicant?.phone_number}
              </span>
            )}
            {app.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {app.address}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} /> {dt}
            </span>
          </div>
          {app.admin_note && app.status !== 'pending' && (
            <p className="mt-2 text-xs text-ink-soft bg-surface-alt rounded-lg px-2 py-1">
              <span className="font-bold">Admin qeydi:</span> {app.admin_note}
            </p>
          )}
        </div>
        {app.status === 'pending' && (
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

function StatusBadge({ status }: { status: Application['status'] }) {
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
  app,
  action,
  onClose,
  onDone,
}: {
  app: Application;
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
        const { error } = await supabase.rpc('admin_approve_brigade_application', {
          p_application_id: app.id,
          p_note: note.trim() || null,
        });
        if (error) throw error;
        message.success('Briqada təsdiqləndi');
      } else {
        if (!note.trim()) {
          message.warning('İmtina səbəbini qeyd edin');
          setSubmitting(false);
          return;
        }
        const { error } = await supabase.rpc('admin_reject_brigade_application', {
          p_application_id: app.id,
          p_reason: note.trim(),
        });
        if (error) throw error;
        message.success('Müraciət imtina edildi');
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
          {isApprove ? 'Briqada təsdiqi' : 'Müraciəti imtina et'}
        </h2>
        <p className="text-sm text-muted mb-4">
          {isApprove ? (
            <>
              <span className="font-bold text-ink">{app.name}</span> briqadası
              yaradılacaq və müraciətçi owner kimi təyin olunacaq.
            </>
          ) : (
            <>
              <span className="font-bold text-ink">{app.name}</span> müraciəti
              imtina ediləcək. Səbəbi qeyd edin — müraciətçiyə bildiriləcək.
            </>
          )}
        </p>

        <Textarea
          placeholder={
            isApprove
              ? 'Daxili qeyd (istəyə bağlı)'
              : 'İmtina səbəbi (məcburi)'
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
