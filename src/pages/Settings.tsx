import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronLeft,
  Globe,
  Loader2,
  LogOut,
  Save,
  Shield,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { Card, PageContainer, Button } from '../components/ui';

interface UserSettings {
  notifications_enabled: boolean;
  location_enabled: boolean;
  dark_mode_enabled: boolean;
  language: string;
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    notifications_enabled: true,
    location_enabled: true,
    dark_mode_enabled: false,
    language: i18n.language || 'az',
  });
  const [uid, setUid] = useState<string | null>(null);

  // Auth race-i həll etmək üçün session-u Supabase-dən birbaşa oxu
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (cancelled) return;
      if (!userId) {
        navigate('/login', { replace: true });
        return;
      }
      setUid(userId);
      await loadSettings(userId);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSettings(userId: string) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (dbErr && dbErr.code !== 'PGRST116') throw dbErr;

      if (data) {
        setSettings({
          notifications_enabled: data.notifications_enabled ?? true,
          location_enabled: data.location_enabled ?? true,
          dark_mode_enabled: data.dark_mode_enabled ?? false,
          language: data.language ?? 'az',
        });
        if (data.language && data.language !== i18n.language) {
          void i18n.changeLanguage(data.language);
        }
      } else {
        // İlk dəfə — default tənzimləmələrlə yarat
        await supabase
          .from('user_settings')
          .insert({ user_id: userId, ...settings });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save(next: Partial<UserSettings>) {
    if (!uid) return;
    const merged = { ...settings, ...next };
    setSettings(merged);
    setSaving(true);
    setError(null);
    try {
      const { error: upErr } = await supabase.from('user_settings').upsert({
        user_id: uid,
        ...merged,
      });
      if (upErr) throw upErr;
      if (next.language && next.language !== i18n.language) {
        void i18n.changeLanguage(next.language);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    if (!confirm(t('settings.signOutConfirm', { defaultValue: 'Hesabdan çıxmaq istəyirsən?' })))
      return;
    try {
      await supabase.auth.signOut();
      logout();
      localStorage.removeItem('user');
      localStorage.removeItem('isLoggedIn');
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteAccount() {
    if (
      !confirm(
        t('settings.deleteConfirm', {
          defaultValue:
            'Hesabını həmişəlik silmək istəyirsən? Bu əməliyyat geri qaytarıla bilməz.',
        }),
      )
    )
      return;
    setError(t('settings.deleteHint', { defaultValue: 'Hesab silmə üçün admin ilə əlaqə saxlayın.' }));
  }

  if (loading) {
    return (
      <PageContainer size="md">
        <div className="flex justify-center py-20">
          <Loader2 size={36} className="animate-spin text-brand-600" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="md">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-ink mb-4"
      >
        <ChevronLeft size={16} /> {t('common.back', { defaultValue: 'Geri' })}
      </button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight mb-2">
        {t('settings.title', { defaultValue: 'Parametrlər' })}
      </h1>
      <p className="text-muted text-sm mb-5">
        {t('settings.subtitle', {
          defaultValue: 'Bildirişlər, dil və hesab tənzimləmələri',
        })}
      </p>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      {/* General */}
      <Card variant="default" padding="md" className="mb-4">
        <h2 className="font-extrabold text-ink mb-4">
          {t('settings.section.general', { defaultValue: 'Ümumi' })}
        </h2>

        <ToggleRow
          icon={<Bell size={18} />}
          title={t('settings.notifications', { defaultValue: 'Bildirişlər' })}
          subtitle={t('settings.notifications.subtitle', {
            defaultValue: 'Yeni sifariş, təklif, ödəniş bildirişləri',
          })}
          value={settings.notifications_enabled}
          onChange={(v) => save({ notifications_enabled: v })}
        />
        <Divider />
        <ToggleRow
          icon={<Shield size={18} />}
          title={t('settings.location', { defaultValue: 'Yer (GPS)' })}
          subtitle={t('settings.location.subtitle', {
            defaultValue: 'Yaxınlıqdakı provayderləri tapmaq üçün',
          })}
          value={settings.location_enabled}
          onChange={(v) => save({ location_enabled: v })}
        />
      </Card>

      {/* Language */}
      <Card variant="default" padding="md" className="mb-4">
        <h2 className="font-extrabold text-ink mb-4 flex items-center gap-2">
          <Globe size={18} className="text-brand-600" />
          {t('settings.language', { defaultValue: 'Dil' })}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { code: 'az', label: 'Azərbaycan' },
            { code: 'ru', label: 'Русский' },
            { code: 'en', label: 'English' },
            { code: 'zh', label: '中文' },
          ].map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => save({ language: lang.code })}
              className={`px-4 py-3 rounded-xl text-sm font-bold border transition-colors ${
                settings.language === lang.code
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-ink-soft border-border hover:border-brand-300'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </Card>

      {saving && (
        <p className="text-xs text-muted mb-4 flex items-center gap-1.5">
          <Save size={12} /> {t('settings.saving', { defaultValue: 'Saxlanılır...' })}
        </p>
      )}

      {/* Danger zone */}
      <Card variant="default" padding="md" className="mb-4">
        <h2 className="font-extrabold text-ink mb-4">
          {t('settings.section.account', { defaultValue: 'Hesab' })}
        </h2>
        <Button
          variant="outline"
          size="md"
          fullWidth
          onClick={handleSignOut}
          leftIcon={<LogOut size={16} />}
        >
          {t('nav.logout', { defaultValue: 'Çıxış' })}
        </Button>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleDeleteAccount}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-100"
          >
            <Trash2 size={14} />
            {t('settings.deleteAccount', { defaultValue: 'Hesabı sil' })}
          </button>
        </div>
      </Card>
    </PageContainer>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-ink text-sm">{title}</p>
        <p className="text-xs text-muted leading-snug">{subtitle}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-colors ${
          value
            ? 'bg-brand-600 border-brand-600'
            : 'bg-surface-alt border-border'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-border" />;
}
