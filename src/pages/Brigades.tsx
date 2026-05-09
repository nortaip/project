import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  MapPin,
  Phone,
  Plus,
  Star,
  Users as UsersIcon,
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

export default function Brigades() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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
      // Mənim sahibi olduğum brigadalar + üzv olduğum brigadalar
      const [ownedResp, memberResp] = await Promise.all([
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
      ]);
      if (ownedResp.error) throw ownedResp.error;
      if (memberResp.error) throw memberResp.error;

      const owned = (ownedResp.data ?? []) as Brigade[];
      const memberOf = ((memberResp.data ?? []) as Array<{ brigades: Brigade }>)
        .map((r) => r.brigades)
        .filter(Boolean);

      // Unikal birləşmə
      const seen = new Set<string>();
      const merged: Brigade[] = [];
      for (const b of [...owned, ...memberOf]) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          merged.push(b);
        }
      }
      setBrigades(merged);
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (values: BrigadeFormValues) => {
    try {
      const { error } = await supabase
        .from('brigades')
        .insert({ ...values, owner_id: user!.id });
      if (error) throw error;

      message.success(t('common.save'));
      setCreating(false);
      await load();
    } catch (e) {
      message.error(`${t('errors.generic')}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <PageContainer size="lg">
      <SectionHeader
        title={t('brigades.title')}
        subtitle={t('brigades.subtitle', { count: brigades.length })}
        action={
          <Button
            variant="primary"
            size="md"
            leftIcon={<Plus size={18} />}
            onClick={() => setCreating(true)}
          >
            {t('brigades.createNew')}
          </Button>
        }
      />

      <PendingInvites onChange={load} />

      {loading ? (
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : brigades.length === 0 ? (
        <Card variant="default" padding="lg">
          <EmptyState
            icon={<Building2 size={32} />}
            title={t('brigades.emptyTitle')}
            description={t('brigades.emptyBody')}
            action={
              <Button
                variant="primary"
                size="md"
                leftIcon={<Plus size={18} />}
                onClick={() => setCreating(true)}
              >
                {t('brigades.createNew')}
              </Button>
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

      {creating && (
        <BrigadeFormModal
          onClose={() => setCreating(false)}
          onSave={handleCreate}
        />
      )}
    </PageContainer>
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
