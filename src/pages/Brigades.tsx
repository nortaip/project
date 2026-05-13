import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  Phone,
  Plus,
  Star,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  EmptyState,
  PageContainer,
  SectionHeader,
} from '../components/ui';
import BrigadeFormModal, { BrigadeFormValues } from '../components/BrigadeFormModal';
import PendingInvites from '../components/PendingInvites';

interface Brigade {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  contact_phone: string | null;
  address: string | null;
  categories: string[];
  is_active: boolean;
  is_verified: boolean;
  rating: number;
  total_orders: number;
  member_count?: number;
}

interface Application {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  admin_note: string | null;
  brigade_id: string | null;
  created_at: string;
  decided_at: string | null;
}

export default function Brigades() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const [ownedResp, memberResp, appsResp] = await Promise.all([
        supabase
          .from('brigades')
          .select('*')
          .eq('owner_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('brigade_members')
          .select('brigade_id, brigades:brigades(*)')
          .eq('profile_id', user!.id)
          .eq('is_active', true),
        supabase
          .from('brigade_applications')
          .select(
            'id, name, description, categories, contact_phone, contact_email, address, status, admin_note, brigade_id, created_at, decided_at',
          )
          .eq('applicant_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (ownedResp.error) throw ownedResp.error;
      if (memberResp.error) throw memberResp.error;
      if (appsResp.error) throw appsResp.error;

      const owned = (ownedResp.data ?? []) as Brigade[];
      const memberOf = ((memberResp.data ?? []) as Array<{ brigades: Brigade }>)
        .map((r) => r.brigades)
        .filter(Boolean);

      const seen = new Set<string>();
      const merged: Brigade[] = [];
      for (const b of [...owned, ...memberOf]) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          merged.push(b);
        }
      }
      setBrigades(merged);
      setApplications((appsResp.data ?? []) as Application[]);
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const hasPending = applications.some((a) => a.status === 'pending');

  const handleApply = async (values: BrigadeFormValues) => {
    try {
      const { error } = await supabase.rpc('apply_for_brigade', {
        p_name: values.name,
        p_description: values.description || null,
        p_categories: values.categories,
        p_contact_phone: values.contact_phone || null,
        p_contact_email: values.contact_email || null,
        p_address: values.address || null,
        p_logo_url: values.logo_url,
      });
      if (error) throw error;
      message.success('Müraciətiniz göndərildi — admin nəzərdən keçirəcək');
      setApplying(false);
      await load();
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };

  const handleCancelApplication = async (appId: string) => {
    if (!confirm('Müraciətinizi ləğv etmək istəyirsiniz?')) return;
    const { error } = await supabase.rpc('cancel_brigade_application', {
      p_application_id: appId,
    });
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('Ləğv edildi');
    await load();
  };

  return (
    <PageContainer size="lg">
      <SectionHeader
        title={t('brigades.title')}
        subtitle={t('brigades.subtitle', { count: brigades.length })}
        action={
          !hasPending && (
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus size={18} />}
              onClick={() => setApplying(true)}
            >
              Şirkət üçün müraciət et
            </Button>
          )
        }
      />

      <PendingInvites onChange={load} />

      {/* Müraciət statusu */}
      {applications.length > 0 && (
        <div className="mb-5 space-y-2">
          {applications.map((app) => (
            <ApplicationStatusCard
              key={app.id}
              app={app}
              onCancel={() => handleCancelApplication(app.id)}
            />
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : brigades.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Building2 size={32} />}
            title={t('brigades.emptyTitle')}
            description={
              hasPending
                ? 'Müraciətiniz admin tərəfindən nəzərdən keçirilir.'
                : 'Şirkət açmaq üçün admin-ə müraciət göndərin. Təsdiqdən sonra panelinizi idarə edə biləcəksiniz.'
            }
            action={
              !hasPending ? (
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={<Plus size={18} />}
                  onClick={() => setApplying(true)}
                >
                  Müraciət et
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brigades.map((b) => (
            <BrigadeCard key={b.id} brigade={b} />
          ))}
        </div>
      )}

      {applying && (
        <BrigadeFormModal
          onClose={() => setApplying(false)}
          onSave={handleApply}
        />
      )}
    </PageContainer>
  );
}

function ApplicationStatusCard({
  app,
  onCancel,
}: {
  app: Application;
  onCancel: () => void;
}) {
  if (app.status === 'approved' || app.status === 'cancelled') return null;

  const isPending = app.status === 'pending';
  const isRejected = app.status === 'rejected';

  return (
    <Card
      variant="default"
      padding="md"
      className={
        isPending
          ? 'border-warning/30 bg-warning/5'
          : 'border-danger/30 bg-danger/5'
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            isPending ? 'bg-warning/15 text-warning' : 'bg-danger/15 text-danger'
          }`}
        >
          {isPending ? <Clock size={18} /> : <XCircle size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-ink">{app.name}</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                isPending
                  ? 'bg-warning/15 text-warning'
                  : 'bg-danger/15 text-danger'
              }`}
            >
              {isPending ? 'Gözləyir' : 'İmtina edildi'}
            </span>
          </div>
          <p className="text-sm text-muted mt-0.5">
            {isPending
              ? 'Admin müraciətinizi nəzərdən keçirir. Təsdiq olunan kimi xəbər veriləcək.'
              : app.admin_note ?? 'Müraciət qəbul olunmadı.'}
          </p>
          {app.description && (
            <p className="text-sm text-ink-soft mt-2 line-clamp-2">
              {app.description}
            </p>
          )}
          {app.categories && app.categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {app.categories.map((c) => (
                <span
                  key={c}
                  className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {(app.contact_phone || app.contact_email || app.address) && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {app.contact_phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone size={12} /> {app.contact_phone}
                </span>
              )}
              {app.contact_email && (
                <span className="inline-flex items-center gap-1">
                  <Mail size={12} /> {app.contact_email}
                </span>
              )}
              {app.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} /> {app.address}
                </span>
              )}
            </div>
          )}
        </div>
        {isPending && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-muted hover:text-danger shrink-0"
          >
            Ləğv et
          </button>
        )}
      </div>
    </Card>
  );
}

function BrigadeCard({ brigade }: { brigade: Brigade }) {
  const { t } = useTranslation();
  return (
    <Link to={`/brigades/${brigade.id}`}>
      <Card variant="default" padding="md" className="hover:border-brand-300 transition-colors h-full">
        {brigade.logo_url ? (
          <div
            className="w-full h-32 rounded-2xl bg-cover bg-center mb-3"
            style={{ backgroundImage: `url(${brigade.logo_url})` }}
          />
        ) : (
          <div className="w-full h-32 rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 flex items-center justify-center mb-3">
            <Building2 size={48} className="text-brand-600" />
          </div>
        )}

        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-extrabold text-ink leading-tight line-clamp-1">
            {brigade.name}
          </h3>
          {brigade.is_verified && (
            <CheckCircle2 size={18} className="text-success shrink-0 ml-2 mt-0.5" />
          )}
        </div>

        {brigade.description && (
          <p className="text-sm text-muted line-clamp-2 mb-3">
            {brigade.description}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 mb-3">
          {brigade.categories.slice(0, 3).map((c) => (
            <span
              key={c}
              className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
            >
              {c}
            </span>
          ))}
          {brigade.categories.length > 3 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-surface-alt text-muted font-semibold">
              +{brigade.categories.length - 3}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted pt-3 border-t border-border">
          {brigade.rating > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={12} className="text-warning" />
              {brigade.rating.toFixed(1)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <UsersIcon size={12} />
            {t('brigades.membersCount', { count: brigade.member_count ?? 0 })}
          </span>
          <span>{brigade.total_orders}</span>
        </div>

        {brigade.address && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted">
            <MapPin size={12} className="shrink-0" />
            <span className="line-clamp-1">{brigade.address}</span>
          </div>
        )}
        {brigade.contact_phone && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <Phone size={12} className="shrink-0" />
            <span>{brigade.contact_phone}</span>
          </div>
        )}
      </Card>
    </Link>
  );
}
