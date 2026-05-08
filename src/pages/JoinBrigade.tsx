import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Shield,
  X,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Button, Card, PageContainer } from '../components/ui';

interface InviteData {
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  intended_role: 'member' | 'dispatcher';
  commission_pct: number | null;
  expires_at: string;
  is_expired: boolean;
  invited_email: string | null;
  invited_phone: string | null;
  brigade: {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    is_verified: boolean;
  };
}

const ROLE_LABEL: Record<string, string> = {
  member: 'İşçi',
  dispatcher: 'Dispatcher',
};

export default function JoinBrigade() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Token tapılmadı');
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = async () => {
    try {
      const { data, error } = await supabase.rpc('lookup_brigade_invite', {
        p_token: token,
      });
      if (error) throw error;
      if (!data) {
        setError('Bu dəvət tapılmadı');
        return;
      }
      setInvite(data as InviteData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!user) {
      // Login-ə yönləndir, sonra yenidən bura qayıdılsın
      navigate('/login', {
        state: { message: 'Dəvəti qəbul etmək üçün daxil olun', returnTo: `/join/${token}` },
      });
      return;
    }
    setSubmitting('accept');
    try {
      const { data, error } = await supabase.rpc('accept_brigade_invite', {
        p_token: token,
      });
      if (error) throw error;
      message.success('Dəvət qəbul edildi! Şirkətə qatıldınız.');
      const brigadeId = (data as { brigade_id?: string })?.brigade_id;
      if (brigadeId) {
        navigate(`/brigades/${brigadeId}`);
      } else {
        navigate('/brigades');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`Xəta: ${msg}`);
      setSubmitting(null);
    }
  };

  const handleDecline = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!confirm('Bu dəvəti rədd etmək istəyirsən?')) return;
    setSubmitting('decline');
    try {
      const { error } = await supabase.rpc('decline_brigade_invite', {
        p_token: token,
      });
      if (error) throw error;
      message.success('Dəvət rədd edildi');
      navigate('/brigades');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`Xəta: ${msg}`);
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <PageContainer size="md">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (error || !invite) {
    return (
      <PageContainer size="md">
        <Card variant="elevated" padding="lg">
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-danger/10 text-danger flex items-center justify-center mb-4">
              <AlertTriangle size={32} />
            </div>
            <h1 className="text-xl font-extrabold text-ink">
              Dəvət tapılmadı
            </h1>
            <p className="mt-2 text-muted">
              {error ?? 'Bu link etibarsızdır və ya artıq cavablandırılıb.'}
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-5"
              onClick={() => navigate('/')}
            >
              Ana səhifəyə qayıt
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  // Status-a görə UI
  const isExpired = invite.is_expired || invite.status === 'expired';
  const isResponded = invite.status !== 'pending';

  return (
    <PageContainer size="md">
      <Card variant="elevated" padding="lg">
        <div className="text-center mb-6">
          {invite.brigade.logo_url ? (
            <div
              className="w-20 h-20 mx-auto rounded-3xl bg-cover bg-center mb-4"
              style={{ backgroundImage: `url(${invite.brigade.logo_url})` }}
            />
          ) : (
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center mb-4 shadow-brand">
              <Building2 size={40} className="text-white" />
            </div>
          )}
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">
            {invite.brigade.name}
          </h1>
          {invite.brigade.is_verified && (
            <span className="inline-flex items-center gap-1 mt-2 text-sm font-bold text-success bg-success/10 px-2 py-1 rounded-lg">
              <CheckCircle2 size={14} /> Təsdiqli şirkət
            </span>
          )}
          {invite.brigade.description && (
            <p className="mt-3 text-muted text-sm max-w-md mx-auto">
              {invite.brigade.description}
            </p>
          )}
        </div>

        {/* Invite detallar */}
        <div className="bg-surface-alt rounded-2xl p-5 mb-5 space-y-3">
          <Row
            icon={<Shield size={16} />}
            label="Sənə təklif olunan rol"
            value={ROLE_LABEL[invite.intended_role]}
          />
          {invite.commission_pct != null && (
            <Row
              icon={<span className="text-base">%</span>}
              label="Komissiya"
              value={`${invite.commission_pct}%`}
            />
          )}
          <Row
            icon={<Clock size={16} />}
            label="Müddət"
            value={
              isExpired
                ? 'Müddəti bitib'
                : new Date(invite.expires_at).toLocaleDateString('az', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }) + '-ə qədər'
            }
          />
        </div>

        {/* Status-a görə CTA */}
        {isExpired ? (
          <div className="text-center p-4 bg-warning/10 rounded-2xl border border-warning/30">
            <p className="text-sm font-semibold text-warning">
              ⏱ Bu dəvətin müddəti bitib. Şirkət sahibinə müraciət et — yenisini göndərə bilər.
            </p>
          </div>
        ) : isResponded ? (
          <div className="text-center p-4 bg-info/10 rounded-2xl border border-info/30">
            <p className="text-sm font-semibold text-info">
              Bu dəvət artıq{' '}
              {invite.status === 'accepted'
                ? 'qəbul edilib ✅'
                : invite.status === 'declined'
                ? 'rədd edilib ❌'
                : 'ləğv edilib'}
              .
            </p>
            {invite.status === 'accepted' && (
              <Button
                variant="primary"
                size="md"
                className="mt-3"
                onClick={() => navigate(`/brigades/${invite.brigade.id}`)}
              >
                Şirkətə keç
              </Button>
            )}
          </div>
        ) : (
          <>
            {!user && (
              <div className="mb-4 p-3 bg-brand-50 border border-brand-200 rounded-2xl text-sm">
                <p className="font-semibold text-brand-700">
                  📌 Dəvəti qəbul etmək üçün
                  {invite.invited_email
                    ? ` ${invite.invited_email} email ilə `
                    : invite.invited_phone
                    ? ` ${invite.invited_phone} telefon ilə `
                    : ' '}
                  hesabınıza daxil olun.
                </p>
                {(invite.invited_email || invite.invited_phone) && (
                  <p className="mt-1 text-xs text-muted">
                    Hesabınız yoxdur?{' '}
                    <Link
                      to="/signup"
                      className="text-brand-600 font-bold underline"
                    >
                      Qeydiyyatdan keç
                    </Link>
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="lg"
                fullWidth
                leftIcon={<X size={18} />}
                disabled={submitting !== null}
                loading={submitting === 'decline'}
                onClick={handleDecline}
              >
                Rədd et
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                leftIcon={<CheckCircle2 size={18} />}
                disabled={submitting !== null}
                loading={submitting === 'accept'}
                onClick={handleAccept}
              >
                {user ? 'Qəbul et' : 'Daxil ol və qəbul et'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </PageContainer>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 h-8 rounded-lg bg-white border border-border flex items-center justify-center text-muted">
        {icon}
      </span>
      <div className="flex-1 flex justify-between items-baseline">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-bold text-ink">{value}</span>
      </div>
    </div>
  );
}
