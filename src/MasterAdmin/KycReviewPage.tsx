// Admin KYC Review — pending verification-ları yoxlayır, approve/reject
// edir, və artıq approved olanlardan birini revoke edə bilir.

import { useEffect, useState } from 'react';
import { Card, Tabs, Tag, Button, Modal, Input, message, Image, Tooltip } from 'antd';
import { CheckCircle, XCircle, ShieldX, FileText, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface VerificationRow {
  id: string;
  provider_id: string;
  id_front_path: string;
  id_back_path: string;
  selfie_path: string;
  full_name_on_id: string | null;
  id_number: string | null;
  birth_date: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejection_reason: string | null;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  provider?: { name: string | null; phone_number: string | null; email: string | null } | null;
}

const BUCKET = 'kyc-documents';

const KycReviewPage = () => {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [verifiedProviders, setVerifiedProviders] = useState<
    Array<{ id: string; name: string | null; phone_number: string | null; verification_status: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    if (tab === 'approved') {
      // is_verified=true olan profillər
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, phone_number, verification_status')
        .eq('is_verified', true)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) console.error('KYC approved load error:', error);
      setVerifiedProviders(data ?? []);
      setRows([]);
    } else {
      // FK profiles-ə deyil auth.users-ə göstərir, ona görə JOIN ayrıca:
      const { data: verifs, error } = await supabase
        .from('provider_verifications')
        .select(
          'id, provider_id, id_front_path, id_back_path, selfie_path, full_name_on_id, id_number, birth_date, status, rejection_reason, admin_notes, reviewed_at, created_at',
        )
        .eq('status', tab)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('KYC verifications load error:', error);
        message.error(`Yüklənmə xətası: ${error.message}`);
      }

      const list = (verifs ?? []) as VerificationRow[];

      // Provider profillərini ayrı sorğu ilə tap
      if (list.length > 0) {
        const ids = Array.from(new Set(list.map((v) => v.provider_id)));
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, phone_number, email')
          .in('id', ids);

        const profileMap = new Map(
          (profiles ?? []).map((p) => [p.id as string, p as VerificationRow['provider']]),
        );

        for (const v of list) {
          v.provider = profileMap.get(v.provider_id) ?? null;
        }
      }

      setRows(list);
      setVerifiedProviders([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [tab]);

  const approve = async (id: string) => {
    let notes = '';
    Modal.confirm({
      title: 'KYC təsdiq et?',
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Admin qeydləri (ixtiyari)"
          onChange={(e) => (notes = e.target.value)}
        />
      ),
      okText: 'Təsdiq et',
      okType: 'primary',
      cancelText: 'Ləğv et',
      onOk: async () => {
        setBusyId(id);
        const { data, error } = await supabase.rpc('approve_kyc', {
          p_verification_id: id,
          p_notes: notes || null,
        });
        setBusyId(null);
        if (error) {
          message.error(error.message);
          return;
        }
        if ((data as { ok?: boolean })?.ok === false) {
          message.error((data as { error?: string }).error ?? 'Xəta');
          return;
        }
        message.success('Təsdiq edildi');
        await load();
      },
    });
  };

  const reject = (id: string) => {
    let reason = '';
    Modal.confirm({
      title: 'KYC rədd et?',
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Səbəb (ən az 5 simvol) — provider-ə göstəriləcək"
          onChange={(e) => (reason = e.target.value)}
        />
      ),
      okText: 'Rədd et',
      okType: 'danger',
      cancelText: 'Geri',
      onOk: async () => {
        if (reason.trim().length < 5) {
          message.error('Səbəb ən az 5 simvol');
          throw new Error('reason too short');
        }
        setBusyId(id);
        const { data, error } = await supabase.rpc('reject_kyc', {
          p_verification_id: id,
          p_reason: reason.trim(),
        });
        setBusyId(null);
        if (error) {
          message.error(error.message);
          return;
        }
        if ((data as { ok?: boolean })?.ok === false) {
          message.error((data as { error?: string }).error ?? 'Xəta');
          return;
        }
        message.success('Rədd edildi');
        await load();
      },
    });
  };

  const revoke = (providerId: string, name: string | null) => {
    let reason = '';
    Modal.confirm({
      title: `${name ?? 'Provider'} — KYC-dən çıxar?`,
      content: (
        <div>
          <p className="mb-2 text-sm text-rose-600 font-bold">
            ⚠️ Provider artıq təklif verə bilməyəcək. Yenidən sənəd yükləməlidir.
          </p>
          <Input.TextArea
            rows={3}
            placeholder="Səbəb (ən az 5 simvol) — provider-ə göstəriləcək"
            onChange={(e) => (reason = e.target.value)}
          />
        </div>
      ),
      okText: 'Təsdiqdən çıxar',
      okType: 'danger',
      cancelText: 'Geri',
      onOk: async () => {
        if (reason.trim().length < 5) {
          message.error('Səbəb ən az 5 simvol');
          throw new Error('reason too short');
        }
        setBusyId(providerId);
        const { data, error } = await supabase.rpc('revoke_kyc', {
          p_provider_id: providerId,
          p_reason: reason.trim(),
        });
        setBusyId(null);
        if (error) {
          message.error(error.message);
          return;
        }
        if ((data as { ok?: boolean })?.ok === false) {
          message.error((data as { error?: string }).error ?? 'Xəta');
          return;
        }
        message.success('Təsdiqdən çıxarıldı');
        await load();
      },
    });
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold">KYC İdarəetmə</h1>
        <Button icon={<RefreshCw size={14} />} onClick={() => void load()} loading={loading}>
          Yenilə
        </Button>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          { key: 'pending', label: 'Gözləyir' },
          { key: 'approved', label: 'Təsdiqlənmiş' },
          { key: 'rejected', label: 'Rədd edilmiş' },
        ]}
      />

      {tab !== 'approved' &&
        rows.map((r) => (
          <KycCard
            key={r.id}
            row={r}
            busy={busyId === r.id}
            onApprove={() => approve(r.id)}
            onReject={() => reject(r.id)}
          />
        ))}

      {tab !== 'approved' && !loading && rows.length === 0 && (
        <Card className="mt-4 text-center text-muted">Heç bir müraciət yoxdur</Card>
      )}

      {tab === 'approved' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {verifiedProviders.map((p) => (
            <Card key={p.id} bordered>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-extrabold">{p.name ?? '—'}</p>
                  <p className="text-sm text-muted">{p.phone_number ?? '—'}</p>
                  <Tag color="success" className="mt-1">
                    {p.verification_status}
                  </Tag>
                </div>
                <Button
                  danger
                  icon={<ShieldX size={14} />}
                  loading={busyId === p.id}
                  onClick={() => revoke(p.id, p.name)}
                >
                  Təsdiqdən çıxar
                </Button>
              </div>
            </Card>
          ))}
          {!loading && verifiedProviders.length === 0 && (
            <Card className="text-center text-muted col-span-2">Təsdiqlənmiş provider yoxdur</Card>
          )}
        </div>
      )}
    </div>
  );
};

// ──────── Tək verification card ──────────────────────────────

interface KycCardProps {
  row: VerificationRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}

const KycCard = ({ row, busy, onApprove, onReject }: KycCardProps) => {
  const [urls, setUrls] = useState<{ front?: string; back?: string; selfie?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [a, b, c] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(row.id_front_path, 3600),
        supabase.storage.from(BUCKET).createSignedUrl(row.id_back_path, 3600),
        supabase.storage.from(BUCKET).createSignedUrl(row.selfie_path, 3600),
      ]);
      if (cancelled) return;
      setUrls({
        front: a.data?.signedUrl,
        back: b.data?.signedUrl,
        selfie: c.data?.signedUrl,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const status = row.status;
  const statusColor =
    status === 'approved' ? 'success' : status === 'rejected' ? 'error' : status === 'cancelled' ? 'default' : 'processing';

  return (
    <Card className="mt-3" bordered>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-extrabold text-lg">{row.provider?.name ?? row.full_name_on_id ?? '—'}</p>
          <p className="text-sm text-muted">
            {row.provider?.phone_number ?? '—'} · {row.provider?.email ?? '—'}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted">
            <FileText size={12} />
            {row.id_number ?? 'Vəsiqə nömrəsi: —'} ·{' '}
            {row.birth_date ?? 'D.tarixi: —'}
          </div>
          <p className="text-xs text-muted mt-1">
            Göndərilib: {new Date(row.created_at).toLocaleString('az-AZ')}
          </p>
        </div>
        <Tag color={statusColor}>{status}</Tag>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <DocThumb label="Vəsiqə (ön)" url={urls.front} />
        <DocThumb label="Vəsiqə (arxa)" url={urls.back} />
        <DocThumb label="Selfie" url={urls.selfie} />
      </div>

      {row.rejection_reason && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-2 text-sm text-rose-900 mb-3">
          <b>Səbəb:</b> {row.rejection_reason}
        </div>
      )}

      {status === 'pending' && (
        <div className="flex gap-2 justify-end">
          <Button
            danger
            icon={<XCircle size={14} />}
            onClick={onReject}
            loading={busy}
          >
            Rədd et
          </Button>
          <Button
            type="primary"
            icon={<CheckCircle size={14} />}
            onClick={onApprove}
            loading={busy}
          >
            Təsdiq et
          </Button>
        </div>
      )}
    </Card>
  );
};

const DocThumb = ({ label, url }: { label: string; url?: string }) => (
  <div>
    <p className="text-xs font-bold text-muted mb-1">{label}</p>
    {url ? (
      <Tooltip title="Böyüt">
        <Image src={url} alt={label} className="rounded-md object-cover" style={{ aspectRatio: '4/3' }} />
      </Tooltip>
    ) : (
      <div className="bg-gray-100 rounded-md flex items-center justify-center" style={{ aspectRatio: '4/3' }}>
        <span className="text-xs text-muted">Yüklənir…</span>
      </div>
    )}
  </div>
);

export default KycReviewPage;
