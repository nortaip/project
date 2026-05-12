import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Search,
  Shuffle,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface UserHit {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  role: string | null;
}

interface ResetEntry {
  userId: string;
  displayName: string;
  email: string | null;
  password: string;
  setAt: number; // ms epoch
}

const LS_KEY = 'admin:password_reset_history';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

function loadHistory(): ResetEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ResetEntry[];
    const fresh = arr.filter((e) => Date.now() - e.setAt < TTL_MS);
    if (fresh.length !== arr.length) {
      localStorage.setItem(LS_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return [];
  }
}

function saveHistory(entries: ResetEntry[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#%&*';
  const all = upper + lower + digits + symbols;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += symbols[Math.floor(Math.random() * symbols.length)];
  for (let i = 0; i < 8; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

function fmtTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'indi';
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return new Date(ms).toLocaleString('az');
}

export default function PasswordManagerCard() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<ResetEntry[]>([]);
  const [showPasswordIndex, setShowPasswordIndex] = useState<number | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, name, email, phone_number, role')
        .or(
          `name.ilike.%${query}%,email.ilike.%${query}%,phone_number.ilike.%${query}%`,
        )
        .limit(8);
      setResults((data ?? []) as UserHit[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function submit() {
    if (!selected || !newPassword) return;
    if (newPassword.length < 6) {
      setError('Minimum 6 simvol');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessiya tapılmadı');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-change-password`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_id: selected.id,
          new_password: newPassword,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'Parol dəyişdirilə bilmədi');

      // localStorage tarixçəsinə yaz
      const entry: ResetEntry = {
        userId: selected.id,
        displayName: selected.name ?? selected.email ?? selected.id.slice(0, 8),
        email: selected.email,
        password: newPassword,
        setAt: Date.now(),
      };
      const next = [entry, ...history.filter((h) => h.userId !== selected.id)].slice(0, 10);
      saveHistory(next);
      setHistory(next);

      setSuccess(`${entry.displayName} üçün parol uğurla yeniləndi`);
      setNewPassword('');
      setSelected(null);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function removeFromHistory(userId: string) {
    const next = history.filter((h) => h.userId !== userId);
    saveHistory(next);
    setHistory(next);
  }

  function clearHistory() {
    if (!confirm('Bütün parol tarixçəsini silməyə əminsən?')) return;
    saveHistory([]);
    setHistory([]);
  }

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={20} className="text-violet-600" />
        <h2 className="font-extrabold text-ink text-lg">Parol idarəsi</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        İstifadəçi parollarını dəyiş və son təyin etdiklərini 24 saata qədər gör.
      </p>

      {/* Search */}
      <div className="relative mb-3">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ad, email və ya telefon ilə tap..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
        />
        {searching && (
          <Loader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted"
          />
        )}
      </div>

      {/* Search results */}
      {results.length > 0 && !selected && (
        <div className="mb-3 border border-border rounded-xl divide-y divide-border max-h-56 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                setSelected(u);
                setResults([]);
                setQuery('');
              }}
              className="w-full text-left p-3 hover:bg-surface-alt flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-brand-gradient text-white flex items-center justify-center font-extrabold text-sm">
                {(u.name ?? u.email ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-ink truncate">
                  {u.name ?? '—'}
                </p>
                <p className="text-xs text-muted truncate">
                  {u.email ?? u.phone_number ?? u.id.slice(0, 8)}
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-surface-alt text-muted">
                {u.role ?? '—'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Selected user + password input */}
      {selected && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-full bg-brand-gradient text-white flex items-center justify-center font-extrabold text-sm shrink-0">
                {(selected.name ?? selected.email ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-ink truncate">
                  {selected.name ?? '—'}
                </p>
                <p className="text-xs text-muted truncate">
                  {selected.email ?? selected.phone_number}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setNewPassword('');
              }}
              className="text-xs text-brand-600 font-bold hover:text-brand-700"
            >
              Dəyiş
            </button>
          </div>

          <label className="block text-xs font-bold text-ink-soft mb-1">
            Yeni parol
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 6 simvol"
              className="flex-1 px-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => setNewPassword(generatePassword())}
              className="px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 inline-flex items-center gap-1"
            >
              <Shuffle size={12} /> Generate
            </button>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !newPassword}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            Parolu yenilə
          </button>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 text-sm flex items-start gap-2">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-4 mb-2">
            <h3 className="text-sm font-extrabold text-ink-soft">
              Son təyin etdiyim parollar
            </h3>
            <button
              type="button"
              onClick={clearHistory}
              className="text-xs text-muted hover:text-rose-600 inline-flex items-center gap-1 font-bold"
            >
              <Trash2 size={12} /> Hamısını sil
            </button>
          </div>
          <p className="text-[11px] text-muted mb-2 italic">
            Yalnız bu brauzerdə görünür · 24 saat sonra avtomatik silinir
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {history.map((entry, i) => {
              const shown = showPasswordIndex === i;
              return (
                <div
                  key={entry.userId + entry.setAt}
                  className="p-3 rounded-xl bg-surface-alt border border-border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UsersIcon size={14} className="text-muted shrink-0" />
                      <p className="font-bold text-sm text-ink truncate">
                        {entry.displayName}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted shrink-0 font-bold">
                      {fmtTimeAgo(entry.setAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code
                      className={`flex-1 font-mono text-sm rounded-lg px-2.5 py-1.5 border ${
                        shown
                          ? 'bg-white border-amber-300 text-ink'
                          : 'bg-white border-border text-muted'
                      } select-all`}
                    >
                      {shown ? entry.password : '••••••••••••'}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswordIndex(shown ? null : i)
                      }
                      className="p-2 rounded-lg hover:bg-white text-muted"
                      title={shown ? 'Gizlət' : 'Göstər'}
                    >
                      {shown ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(entry.password)}
                      className="p-2 rounded-lg hover:bg-white text-muted"
                      title="Kopyala"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromHistory(entry.userId)}
                      className="p-2 rounded-lg hover:bg-rose-50 text-rose-600"
                      title="Sil"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {entry.email && (
                    <p className="text-[11px] text-muted mt-1.5 truncate">
                      {entry.email}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
