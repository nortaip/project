import { FormEvent, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  Shuffle,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import {
  addEntry,
  fmtTimeAgo,
  generatePassword,
  getEntryForUser,
  type ResetEntry,
} from './passwordHistory';
import {
  Button,
  Card,
  Column,
  DataTable,
  Field,
  Input,
} from '../components/ui';
import AdminLayout from './AdminLayout';

interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  phone_number: string | null;
  address: string | null;
  status: string | null;
  is_verified: boolean | null;
  balance: number | null;
  avatar_url: string | null;
  created_at: string | null;
  rating: number | null;
}

const ROLE_OPTIONS = ['customer', 'provider', 'admin'];

export default function Users() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState<UserProfile | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      setUsers((data ?? []) as UserProfile[]);
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updates: Partial<UserProfile>) => {
    if (!editing) return;
    try {
      // Role dəyişikliyi → SECURITY DEFINER funksiya çağır (audit log ilə)
      if (updates.role && updates.role !== editing.role) {
        const { error: rerror } = await supabase.rpc('admin_set_user_role', {
          p_target_user_id: editing.id,
          p_new_role: updates.role,
        });
        if (rerror) throw rerror;
      }

      // Digər sahələr — direct UPDATE
      const { role: _omit, ...rest } = updates;
      void _omit;
      if (Object.keys(rest).length > 0) {
        const { error } = await supabase
          .from('profiles')
          .update(rest)
          .eq('id', editing.id);
        if (error) throw error;
      }

      message.success('Yeniləndi');
      setEditing(null);
      await load();
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = async (user: UserProfile) => {
    if (!confirm(`${user.name ?? user.email} istifadəçisini silmək istəyirsən?`))
      return;
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', user.id);
      if (error) throw error;
      message.success('Silindi');
      await load();
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const columns: Column<UserProfile>[] = [
    {
      key: 'user',
      header: 'İstifadəçi',
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          {u.avatar_url ? (
            <img
              src={u.avatar_url}
              alt={u.name ?? ''}
              className="w-9 h-9 rounded-xl object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-extrabold text-sm">
              {(u.name ?? u.email ?? '?')[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-bold text-ink truncate">
                {u.name ?? '—'}
              </span>
              {u.is_verified && (
                <CheckCircle2 size={12} className="text-success shrink-0" />
              )}
            </div>
            <span className="text-xs text-muted truncate block">
              {u.email ?? u.phone_number ?? '—'}
            </span>
          </div>
        </div>
      ),
      sortable: true,
      sortAccessor: (u) => (u.name ?? u.email ?? '').toLowerCase(),
    },
    {
      key: 'role',
      header: 'Rol',
      cell: (u) => <RoleBadge role={u.role} />,
      sortable: true,
      sortAccessor: (u) => u.role,
      width: '110px',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) => (
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-md ${
            u.status === 'active'
              ? 'bg-success/10 text-success'
              : u.status === 'banned'
              ? 'bg-danger/10 text-danger'
              : 'bg-muted/10 text-muted'
          }`}
        >
          {u.status ?? '—'}
        </span>
      ),
      sortable: true,
      sortAccessor: (u) => u.status ?? '',
      width: '100px',
      hideOnMobile: true,
    },
    {
      key: 'balance',
      header: 'Balans',
      cell: (u) => (
        <span className="font-bold text-ink tabular-nums">
          {Number(u.balance ?? 0).toFixed(2)} ₼
        </span>
      ),
      sortable: true,
      sortAccessor: (u) => Number(u.balance ?? 0),
      align: 'right',
      width: '120px',
      hideOnMobile: true,
    },
    {
      key: 'created',
      header: 'Qeydiyyat',
      cell: (u) =>
        u.created_at ? (
          <span className="text-xs text-muted">
            {new Date(u.created_at).toLocaleDateString('az', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      sortable: true,
      sortAccessor: (u) => u.created_at ?? '',
      width: '120px',
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: '',
      cell: (u) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setNewPassword(u);
            }}
            className="w-8 h-8 rounded-lg hover:bg-surface-alt text-muted hover:text-brand-600 flex items-center justify-center transition-colors"
            aria-label="Parolu dəyişdir"
            title="Parolu dəyişdir"
          >
            <KeyRound size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(u);
            }}
            className="w-8 h-8 rounded-lg hover:bg-surface-alt text-muted hover:text-brand-600 flex items-center justify-center transition-colors"
            aria-label="Redaktə"
          >
            <Edit2 size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(u);
            }}
            className="w-8 h-8 rounded-lg hover:bg-red-50 text-muted hover:text-danger flex items-center justify-center transition-colors"
            aria-label="Sil"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
      align: 'right',
      width: '120px',
    },
  ];

  return (
    <AdminLayout
      title="İstifadəçilər"
      subtitle={`${users.length} ümumi istifadəçi`}
    >
      <DataTable
        data={users}
        columns={columns}
        rowKey={(u) => u.id}
        loading={loading}
        searchKeys={['name', 'email', 'phone_number']}
        searchPlaceholder="Ad, email və ya telefon..."
        pageSize={25}
        emptyTitle="İstifadəçi tapılmadı"
      />

      {editing && (
        <EditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {newPassword && (
        <ChangePasswordModal
          user={newPassword}
          onClose={() => setNewPassword(null)}
        />
      )}
    </AdminLayout>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    admin: { bg: 'bg-danger/10', text: 'text-danger' },
    provider: { bg: 'bg-brand-50', text: 'text-brand-700' },
    customer: { bg: 'bg-surface-alt', text: 'text-ink-soft' },
  };
  const meta = map[role] ?? map.customer;
  return (
    <span
      className={`text-xs font-bold px-2 py-0.5 rounded-md ${meta.bg} ${meta.text}`}
    >
      {role}
    </span>
  );
}

function EditModal({
  user,
  onClose,
  onSave,
}: {
  user: UserProfile;
  onClose: () => void;
  onSave: (data: Partial<UserProfile>) => Promise<void>;
}) {
  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone_number ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status ?? 'active');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        email: email.trim() || null,
        phone_number: phone.trim() || null,
        role,
        status,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="İstifadəçini redaktə et" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Ad Soyad" icon={<UserCog size={20} />}>
          <Input
            hasIcon
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email" icon={<Mail size={20} />}>
          <Input
            hasIcon
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Telefon" icon={<Phone size={20} />}>
          <Input
            hasIcon
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field
          label="Rol"
          hint="Dəyişiklik audit log-a yazılır"
          icon={<ShieldCheck size={20} />}
        >
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full pl-12 pr-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-4 rounded-2xl bg-surface-alt border-[1.5px] border-border focus:border-brand-600 outline-none text-[15px] font-medium text-ink"
          >
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            fullWidth
            onClick={onClose}
            disabled={submitting}
          >
            Ləğv
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
          >
            Yadda saxla
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function ChangePasswordModal({
  user,
  onClose,
}: {
  user: UserProfile;
  onClose: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [lastEntry, setLastEntry] = useState<ResetEntry | null>(null);
  const [revealLast, setRevealLast] = useState(false);

  // Açılanda bu istifadəçi üçün son set edilmiş parolu yoxla (24 saatlıq pəncərə)
  useEffect(() => {
    setLastEntry(getEntryForUser(user.id));
  }, [user.id]);

  function fillGenerated() {
    const next = generatePassword();
    setPwd(next);
    setConfirm(next);
    setShowPwd(true);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    message.success('Kopyalandı');
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 6) {
      message.error('Minimum 6 simvol');
      return;
    }
    if (pwd !== confirm) {
      message.error('Parollar uyğun gəlmir');
      return;
    }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessiya tapılmadı');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-change-password`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: user.id, new_password: pwd }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'Parol dəyişmədi');

      // localStorage tarixçəsinə əlavə et
      addEntry({
        userId: user.id,
        displayName: user.name ?? user.email ?? user.id.slice(0, 8),
        email: user.email,
        password: pwd,
        setAt: Date.now(),
      });
      setLastEntry({
        userId: user.id,
        displayName: user.name ?? user.email ?? user.id.slice(0, 8),
        email: user.email,
        password: pwd,
        setAt: Date.now(),
      });

      message.success('Parol yeniləndi və 24 saat tarixçədə saxlandı');
      // Modal-ı bağlamırıq ki, admin yeni parolu kopyalaya bilsin
      setPwd('');
      setConfirm('');
      setRevealLast(true);
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Parolu dəyişdir" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        <span className="font-bold text-ink">{user.name ?? user.email}</span>{' '}
        üçün yeni parol təyin edin.
      </p>

      {/* Köhnə (admin tərəfindən təyin edilmiş) parol — 24 saatlıq pəncərə */}
      {lastEntry && (
        <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-amber-800">
              📌 Mənim əvvəlcə təyin etdiyim parol
            </p>
            <span className="text-[11px] font-bold text-amber-700">
              {fmtTimeAgo(lastEntry.setAt)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code
              className={`flex-1 font-mono text-sm rounded-lg px-3 py-2 border ${
                revealLast
                  ? 'bg-white border-amber-300 text-ink'
                  : 'bg-white border-amber-200 text-muted'
              } select-all`}
            >
              {revealLast ? lastEntry.password : '••••••••••••'}
            </code>
            <button
              type="button"
              onClick={() => setRevealLast((v) => !v)}
              className="p-2 rounded-lg bg-white border border-amber-200 text-amber-700 hover:bg-amber-100"
              title={revealLast ? 'Gizlət' : 'Göstər'}
            >
              {revealLast ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="button"
              onClick={() => copyText(lastEntry.password)}
              className="p-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white"
              title="Kopyala"
            >
              <Copy size={14} />
            </button>
          </div>
          <p className="text-[11px] text-amber-700 mt-2 italic">
            Yalnız bu brauzerdə görünür · 24 saat sonra avtomatik silinir
          </p>
        </div>
      )}

      {/* Generate düyməsi */}
      <button
        type="button"
        onClick={fillGenerated}
        className="mb-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 font-bold text-sm hover:bg-violet-100"
      >
        <Shuffle size={14} /> Təhlükəsiz parol generate et
      </button>

      <form onSubmit={handleSubmit}>
        <Field label="Yeni parol" icon={<KeyRound size={20} />}>
          <Input
            hasIcon
            type={showPwd ? 'text' : 'password'}
            placeholder="Min. 6 simvol"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </Field>
        <Field label="Təkrar daxil et" icon={<KeyRound size={20} />}>
          <Input
            hasIcon
            type={showPwd ? 'text' : 'password'}
            placeholder="Eyni parol"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            fullWidth
            onClick={onClose}
            disabled={submitting}
          >
            Ləğv
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
          >
            Yenilə
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card
        variant="elevated"
        padding="lg"
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl animate-slide-up"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt hover:bg-border text-muted flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
