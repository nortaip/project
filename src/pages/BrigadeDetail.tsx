import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  Mail,
  MapPin,
  Phone,
  Shield,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageContainer,
} from '../components/ui';

interface Brigade {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  categories: string[];
  is_verified: boolean;
  rating: number;
  total_orders: number;
}

interface Member {
  id: string;
  brigade_id: string;
  profile_id: string;
  role: 'owner' | 'dispatcher' | 'member';
  is_active: boolean;
  commission_pct: number | null;
  joined_at: string;
  profile?: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

interface Assignment {
  id: string;
  brigade_id: string;
  member_id: string;
  source_type: string;
  source_id: string;
  status: string;
  notes: string | null;
  priority: number;
  assigned_at: string;
  responded_at: string | null;
  completed_at: string | null;
  member?: Member;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Sahib',
  dispatcher: 'Dispatcher',
  member: 'İşçi',
};

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Təyin edildi',
  accepted: 'Qəbul edildi',
  declined: 'Rədd edildi',
  in_progress: 'Davam edir',
  completed: 'Tamamlandı',
  cancelled: 'Ləğv edildi',
};

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-warning/10 text-warning',
  accepted: 'bg-info/10 text-info',
  in_progress: 'bg-brand-50 text-brand-700',
  completed: 'bg-success/10 text-success',
  declined: 'bg-danger/10 text-danger',
  cancelled: 'bg-muted/10 text-muted',
};

export default function BrigadeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [brigade, setBrigade] = useState<Brigade | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'members' | 'orders' | 'about'>('members');
  const [inviteOpen, setInviteOpen] = useState(false);

  // Cari user-in bu brigadadakı rolu
  const myRole: 'owner' | 'dispatcher' | 'member' | null =
    members.find((m) => m.profile_id === user?.id)?.role ?? null;
  const canManage = myRole === 'owner' || myRole === 'dispatcher';

  useEffect(() => {
    if (!id || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  const load = async () => {
    setLoading(true);
    try {
      const [bResp, mResp, aResp] = await Promise.all([
        supabase.from('brigades').select('*').eq('id', id).single(),
        supabase
          .from('brigade_members')
          .select('*, profile:profiles(id, name, avatar_url)')
          .eq('brigade_id', id)
          .order('joined_at'),
        supabase
          .from('brigade_assignments')
          .select('*, member:brigade_members(*, profile:profiles(id, name, avatar_url))')
          .eq('brigade_id', id)
          .order('assigned_at', { ascending: false })
          .limit(50),
      ]);
      if (bResp.error) throw bResp.error;
      setBrigade(bResp.data as Brigade);
      setMembers((mResp.data ?? []) as Member[]);
      setAssignments((aResp.data ?? []) as Assignment[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !brigade) {
    return (
      <PageContainer size="lg">
        <div className="flex justify-center py-20">
          <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="lg">
      <button
        onClick={() => navigate('/brigades')}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={16} /> Bütün şirkətlər
      </button>

      {/* Hero */}
      <Card variant="elevated" padding="lg" className="mb-6">
        <div className="flex flex-col sm:flex-row gap-5">
          {brigade.logo_url ? (
            <div
              className="w-24 h-24 rounded-2xl bg-cover bg-center shrink-0"
              style={{ backgroundImage: `url(${brigade.logo_url})` }}
            />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 flex items-center justify-center shrink-0">
              <Building2 size={40} className="text-brand-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                {brigade.name}
              </h1>
              {brigade.is_verified && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-success bg-success/10 px-2 py-1 rounded-lg">
                  <CheckCircle2 size={14} /> Təsdiqli
                </span>
              )}
              {myRole && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 bg-brand-50 px-2 py-1 rounded-lg">
                  <Shield size={14} /> {ROLE_LABELS[myRole]}
                </span>
              )}
            </div>
            {brigade.description && (
              <p className="mt-2 text-muted">{brigade.description}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted">
              {brigade.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {brigade.address}
                </span>
              )}
              {brigade.contact_phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone size={14} /> {brigade.contact_phone}
                </span>
              )}
              {brigade.contact_email && (
                <span className="inline-flex items-center gap-1">
                  <Mail size={14} /> {brigade.contact_email}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brigade.categories.map((c) => (
                <span
                  key={c}
                  className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-semibold"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b border-border">
        <Tab
          label="İşçilər"
          count={members.length}
          active={tab === 'members'}
          onClick={() => setTab('members')}
        />
        <Tab
          label="Sifarişlər"
          count={assignments.length}
          active={tab === 'orders'}
          onClick={() => setTab('orders')}
        />
        <Tab
          label="Haqqında"
          active={tab === 'about'}
          onClick={() => setTab('about')}
        />
      </div>

      {/* Tab content */}
      {tab === 'members' && (
        <MembersTab
          members={members}
          canManage={canManage}
          onInvite={() => setInviteOpen(true)}
          brigadeId={brigade.id}
          onChanged={load}
        />
      )}
      {tab === 'orders' && (
        <OrdersTab
          assignments={assignments}
          canManage={canManage}
          onChanged={load}
        />
      )}
      {tab === 'about' && <AboutTab brigade={brigade} />}

      {inviteOpen && canManage && (
        <InviteMemberModal
          brigadeId={brigade.id}
          onClose={() => setInviteOpen(false)}
          onSent={() => {
            setInviteOpen(false);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-3 font-bold text-sm transition-colors ${
        active ? 'text-brand-600' : 'text-muted hover:text-ink'
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {label}
        {count !== undefined && (
          <span
            className={`px-1.5 py-0.5 rounded-md text-xs ${
              active ? 'bg-brand-100 text-brand-700' : 'bg-surface-alt text-muted'
            }`}
          >
            {count}
          </span>
        )}
      </span>
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-t" />
      )}
    </button>
  );
}

// ── Members Tab ────────────────────────────────────────────────────────

function MembersTab({
  members,
  canManage,
  onInvite,
  brigadeId,
  onChanged,
}: {
  members: Member[];
  canManage: boolean;
  onInvite: () => void;
  brigadeId: string;
  onChanged: () => void;
}) {
  if (members.length === 0) {
    return (
      <Card variant="default" padding="lg">
        <EmptyState
          icon={<UsersIcon size={32} />}
          title="Hələ işçi yoxdur"
          description="Komandanıza üzvləri dəvət edin və sifarişləri paylayın"
          action={
            canManage ? (
              <Button
                variant="primary"
                size="md"
                leftIcon={<UserPlus size={18} />}
                onClick={onInvite}
              >
                İşçi dəvət et
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<UserPlus size={16} />}
            onClick={onInvite}
          >
            Yeni işçi dəvət et
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {members.map((m) => (
          <Card key={m.id} variant="default" padding="md">
            <div className="flex items-center gap-3">
              {m.profile?.avatar_url ? (
                <img
                  src={m.profile.avatar_url}
                  alt={m.profile.name ?? ''}
                  className="w-12 h-12 rounded-2xl object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center font-extrabold text-lg">
                  {(m.profile?.name ?? '?')[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-ink truncate">
                    {m.profile?.name ?? '—'}
                  </span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                      m.role === 'owner'
                        ? 'bg-warning/10 text-warning'
                        : m.role === 'dispatcher'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-surface-alt text-ink-soft'
                    }`}
                  >
                    {ROLE_LABELS[m.role]}
                  </span>
                </div>
                {m.commission_pct != null && (
                  <p className="text-xs text-muted">
                    Komissiya: {m.commission_pct}%
                  </p>
                )}
              </div>
              {canManage && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`${m.profile?.name} işçini silmək istəyirsən?`)) return;
                    const { error } = await supabase
                      .from('brigade_members')
                      .delete()
                      .eq('id', m.id)
                      .eq('brigade_id', brigadeId);
                    if (error) message.error(error.message);
                    else {
                      message.success('Silindi');
                      onChanged();
                    }
                  }}
                  className="text-xs font-bold text-danger hover:underline"
                >
                  Sil
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Orders Tab ──────────────────────────────────────────────────────────

function OrdersTab({
  assignments,
  canManage,
  onChanged,
}: {
  assignments: Assignment[];
  canManage: boolean;
  onChanged: () => void;
}) {
  if (assignments.length === 0) {
    return (
      <Card variant="default" padding="lg">
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="Hələ sifariş yoxdur"
          description="Yeni sifarişlər müştərilərdən gələn kimi burada görünəcək"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {assignments.map((a) => {
        const statusClass = STATUS_COLORS[a.status] ?? 'bg-muted/10 text-muted';
        const dt = new Date(a.assigned_at).toLocaleString('az', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        return (
          <Card key={a.id} variant="default" padding="md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-ink">
                    #{a.source_id.substring(0, 8)}
                  </span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-md ${statusClass}`}
                  >
                    {STATUS_LABELS[a.status] ?? a.status}
                  </span>
                  {a.priority >= 8 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-danger/10 text-danger">
                      Təcili
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {a.member?.profile?.name ?? '—'} · {dt}
                </p>
                {a.notes && (
                  <p className="mt-1 text-sm text-ink-soft">{a.notes}</p>
                )}
              </div>
              {canManage && a.status === 'assigned' && (
                <button
                  type="button"
                  onClick={async () => {
                    const { error } = await supabase
                      .from('brigade_assignments')
                      .update({ status: 'cancelled' })
                      .eq('id', a.id);
                    if (error) message.error(error.message);
                    else {
                      message.success('Ləğv edildi');
                      onChanged();
                    }
                  }}
                  className="text-xs font-bold text-danger hover:underline"
                >
                  Ləğv et
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── About Tab ───────────────────────────────────────────────────────────

function AboutTab({ brigade }: { brigade: Brigade }) {
  return (
    <Card variant="default" padding="lg">
      <div className="space-y-4 text-sm">
        <Row label="Reytinq" value={brigade.rating > 0 ? brigade.rating.toFixed(2) : '—'} />
        <Row label="Tamamlanan sifariş" value={String(brigade.total_orders)} />
        <Row label="Əlaqə telefonu" value={brigade.contact_phone ?? '—'} />
        <Row label="Email" value={brigade.contact_email ?? '—'} />
        <Row label="Ünvan" value={brigade.address ?? '—'} />
        <Row
          label="Kateqoriyalar"
          value={brigade.categories.length ? brigade.categories.join(', ') : '—'}
        />
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border pb-3">
      <span className="text-muted font-medium">{label}</span>
      <span className="font-bold text-ink text-right">{value}</span>
    </div>
  );
}

// ── Invite Modal ────────────────────────────────────────────────────────

function InviteMemberModal({
  brigadeId,
  onClose,
  onSent,
}: {
  brigadeId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [role, setRole] = useState<'member' | 'dispatcher'>('member');
  const [commission, setCommission] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!emailOrPhone.trim()) {
      setError('Email və ya telefon daxil edin');
      return;
    }
    setSubmitting(true);
    try {
      // invited_by — cari giriş etmiş istifadəçi (NOT NULL constraint)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Giriş tələb olunur');
      }

      const isEmail = emailOrPhone.includes('@');
      const { error: e } = await supabase.from('brigade_invites').insert({
        brigade_id: brigadeId,
        invited_by: user.id,
        email: isEmail ? emailOrPhone.trim() : null,
        phone: isEmail ? null : emailOrPhone.trim(),
        intended_role: role,
        commission_pct: commission ? Number(commission) : null,
      });
      if (e) throw e;
      message.success('Dəvət göndərildi');
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        <h2 className="text-lg font-extrabold text-ink mb-4">
          Yeni işçi dəvət et
        </h2>

        <Field label="Email və ya telefon" required>
          <Input
            placeholder="email@example.com və ya +994XX..."
            value={emailOrPhone}
            onChange={(e) => setEmailOrPhone(e.target.value)}
          />
        </Field>

        <Field label="Rol">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'dispatcher')}
            className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
          >
            <option value="member">İşçi (yalnız öz işlərini görür)</option>
            <option value="dispatcher">Dispatcher (sifariş paylayır)</option>
          </select>
        </Field>

        <Field label="Komissiya faizi (istəyə bağlı)" hint="Məs: 70 → işçi gəlirin 70%-ni alır">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            placeholder="70"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
        </Field>

        {error && (
          <div className="p-3 bg-red-50 border border-danger/20 rounded-xl text-sm text-danger font-semibold mb-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-3">
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
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            onClick={handleSubmit}
          >
            Dəvət göndər
          </Button>
        </div>
      </div>
    </div>
  );
}
