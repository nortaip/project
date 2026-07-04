import { useEffect, useState, useCallback } from 'react';
import { message } from 'antd';
import {
  BadgeCheck,
  Calendar,
  Check,
  CreditCard,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Textarea } from '../components/ui';

interface Kyc {
  id: string;
  provider_id: string;
  full_name_on_id: string | null;
  id_number: string | null;
  birth_date: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  rejection_reason: string | null;
  admin_notes: string | null;
  is_renewal: boolean | null;
  created_at: string;
  reviewed_at: string | null;
  id_front_path: string | null;
  id_back_path: string | null;
  selfie_path: string | null;
  provider_name: string | null;
  provider_email: string | null;
  provider_phone: string | null;
  provider_avatar: string | null;
}

const STATUS_FILTERS = [
  { value: 'pending', label: 'Gözləyən' },
  { value: 'approved', label: 'Təsdiqlənmiş' },
  { value: 'rejected', label: 'İmtina edilmiş' },
  { value: 'all', label: 'Hamısı' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function KycAdmin() {
  const [rows, setRows] = useState<Kyc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [decisionFor, setDecisionFor] = useState<{ row: Kyc; action: 'approve' | 'reject' } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_kyc_list', { p_status: filter });
      if (error) throw error;
      setRows(((data as Kyc[]) ?? []));
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-brand-soft">
          <BadgeCheck size={22} />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-extrabold text-ink tracking-tight">KYC yoxlaması</h2>
          <p className="text-sm text-muted">Provayder kimlik sənədlərini yoxlayın və təsdiqləyin</p>
        </div>
        <button
          onClick={() => load()}
          className="w-10 h-10 rounded-xl border border-border text-ink-soft hover:border-brand-300 flex items-center justify-center"
          title="Yenilə"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      {/* Filters */}
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
            {f.value === 'pending' && pendingCount > 0 && (
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-md text-xs ${
                  filter === f.value ? 'bg-white/20' : 'bg-warning/15 text-warning'
                }`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="KYC sorğusu yoxdur"
            description="Bu filtrə uyğun kimlik yoxlaması tapılmadı."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <KycRow
              key={row.id}
              row={row}
              onPreview={setPreview}
              onApprove={() => setDecisionFor({ row, action: 'approve' })}
              onReject={() => setDecisionFor({ row, action: 'reject' })}
            />
          ))}
        </div>
      )}

      {decisionFor && (
        <DecisionModal
          row={decisionFor.row}
          action={decisionFor.action}
          onClose={() => setDecisionFor(null)}
          onDone={async () => {
            setDecisionFor(null);
            await load();
          }}
        />
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center"
            onClick={() => setPreview(null)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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
      : status;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>;
}

function KycRow({
  row,
  onApprove,
  onReject,
  onPreview,
}: {
  row: Kyc;
  onApprove: () => void;
  onReject: () => void;
  onPreview: (url: string) => void;
}) {
  const dt = new Date(row.created_at).toLocaleString('az', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card variant="default" padding="md">
      <div className="flex items-start gap-3">
        {row.provider_avatar ? (
          <img src={row.provider_avatar} alt="" className="w-14 h-14 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-extrabold text-xl">
            {(row.provider_name ?? '?')[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-extrabold text-ink">
              {row.provider_name ?? `ID: ${row.provider_id.slice(0, 8)}`}
            </h3>
            <StatusBadge status={row.status} />
            {row.is_renewal && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-brand-50 text-brand-700">Yeniləmə</span>
            )}
          </div>

          {/* Identity details */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft mb-2">
            {row.full_name_on_id && (
              <span className="inline-flex items-center gap-1">
                <UserIcon size={12} /> {row.full_name_on_id}
              </span>
            )}
            {row.id_number && (
              <span className="inline-flex items-center gap-1">
                <CreditCard size={12} /> {row.id_number}
              </span>
            )}
            {row.birth_date && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} /> {row.birth_date}
              </span>
            )}
          </div>

          {/* Contact */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-3">
            {row.provider_email && (
              <span className="inline-flex items-center gap-1">
                <Mail size={12} /> {row.provider_email}
              </span>
            )}
            {row.provider_phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={12} /> {row.provider_phone}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} /> {dt}
            </span>
          </div>

          {/* Documents */}
          <div className="flex flex-wrap gap-2">
            <KycThumb label="Şəxsiyyət (ön)" path={row.id_front_path} onPreview={onPreview} />
            <KycThumb label="Şəxsiyyət (arxa)" path={row.id_back_path} onPreview={onPreview} />
            <KycThumb label="Selfi" path={row.selfie_path} onPreview={onPreview} />
          </div>

          {row.status === 'rejected' && row.rejection_reason && (
            <p className="mt-2 text-xs text-danger bg-danger/5 rounded-lg px-2 py-1">
              <span className="font-bold">İmtina səbəbi:</span> {row.rejection_reason}
            </p>
          )}
          {row.admin_notes && (
            <p className="mt-1.5 text-xs text-ink-soft bg-surface-alt rounded-lg px-2 py-1">
              <span className="font-bold">Qeyd:</span> {row.admin_notes}
            </p>
          )}
        </div>

        {row.status === 'pending' && (
          <div className="flex flex-col gap-2 shrink-0">
            <Button variant="primary" size="sm" leftIcon={<Check size={14} />} onClick={onApprove}>
              Təsdiqlə
            </Button>
            <Button variant="outline" size="sm" leftIcon={<X size={14} />} onClick={onReject}>
              İmtina
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Private kyc-documents bucket-dan signed URL çəkib şəkli göstərir. */
function KycThumb({
  label,
  path,
  onPreview,
}: {
  label: string;
  path: string | null;
  onPreview: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!path) return;
    void supabase.storage
      .from('kyc-documents')
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) return null;

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={() => url && onPreview(url)}
        className="block w-24 h-20 rounded-xl overflow-hidden border border-border bg-surface-alt hover:border-brand-300 transition-colors"
      >
        {url ? (
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-xs">
            {failed ? '—' : '…'}
          </div>
        )}
      </button>
      <span className="block mt-1 text-[10px] font-semibold text-muted">{label}</span>
    </div>
  );
}

function DecisionModal({
  row,
  action,
  onClose,
  onDone,
}: {
  row: Kyc;
  action: 'approve' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isApprove = action === 'approve';

  const handleSubmit = async () => {
    if (!isApprove && !note.trim()) {
      message.warning('İmtina səbəbini qeyd edin');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('admin_kyc_review', {
        p_id: row.id,
        p_approve: isApprove,
        p_reason: isApprove ? null : note.trim(),
        p_notes: isApprove ? note.trim() || null : null,
      });
      if (error) throw error;
      message.success(isApprove ? 'Kimlik təsdiqləndi' : 'İmtina edildi');
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
          {isApprove ? 'Kimliyi təsdiqlə' : 'Yoxlamanı imtina et'}
        </h2>
        <p className="text-sm text-muted mb-4">
          {isApprove ? (
            <>
              <span className="font-bold text-ink">{row.provider_name ?? '—'}</span> təsdiqli nişanı alacaq.
            </>
          ) : (
            <>İmtina səbəbini qeyd edin — provayderə bildiriləcək.</>
          )}
        </p>

        <Textarea
          placeholder={isApprove ? 'Daxili qeyd (istəyə bağlı)' : 'İmtina səbəbi (məcburi)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" size="lg" fullWidth onClick={onClose} disabled={submitting}>
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
