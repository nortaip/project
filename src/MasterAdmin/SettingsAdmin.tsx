import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AlertCircle, CheckCircle2, Loader2, Mail, MapPin, Phone, Save } from 'lucide-react';

interface PlatformSettings {
  support_phone: string;
  support_email: string;
  platform_address: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  support_phone: '+994 55 939 01 06',
  support_email: 'support@ellit.az',
  platform_address: 'Bakı, Azərbaycan',
};

export default function SettingsAdmin() {
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [originals, setOriginals] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('config')
        .select('key, value')
        .in('key', ['support_phone', 'support_email', 'platform_address']);

      if (error) throw error;

      const loaded: PlatformSettings = { ...DEFAULT_SETTINGS };
      for (const row of data ?? []) {
        const key = row.key as keyof PlatformSettings;
        if (key in loaded) {
          loaded[key] = String(row.value || DEFAULT_SETTINGS[key]);
        }
      }

      setSettings(loaded);
      setOriginals(loaded);
    } catch (e) {
      console.error('Settings load failed:', e);
      setMessage({ type: 'error', text: 'Ayarlar yüklənə bilmədi' });
    } finally {
      setLoading(false);
    }
  }

  async function saveField(key: keyof PlatformSettings) {
    const value = settings[key];
    if (value === originals[key]) return;

    setSaving(key);
    try {
      const { error } = await supabase
        .from('config')
        .upsert(
          { key, value, description: null },
          { onConflict: 'key' }
        );

      if (error) throw error;

      setOriginals(prev => ({ ...prev, [key]: value }));
      setMessage({ type: 'success', text: 'Yadda saxlanıldı' });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      console.error('Save failed:', e);
      setMessage({ type: 'error', text: 'Saxlanmadı, yenidən cəhd edin' });
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const fields: Array<{
    key: keyof PlatformSettings;
    label: string;
    icon: React.ReactNode;
    hint: string;
    type?: string;
  }> = [
    {
      key: 'support_phone',
      label: 'Dəstək telefon nömrəsi',
      icon: <Phone size={16} />,
      hint: 'Müştərilərə göstərilən əsas telefon nömrəsi',
    },
    {
      key: 'support_email',
      label: 'Dəstək email',
      icon: <Mail size={16} />,
      hint: 'Müştərilərə göstərilən email ünvanı',
      type: 'email',
    },
    {
      key: 'platform_address',
      label: 'Platform ünvanı',
      icon: <MapPin size={16} />,
      hint: 'Şirkətin hukuki ünvanı və ya əsas ofis məkanı',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-ink">Platform Ayarları</h2>
        <p className="text-sm text-muted mt-1">Dəstək məlumatları və platforma ayarlarını buradan idarə edin</p>
      </div>

      {message && (
        <div
          className={`rounded-lg p-4 flex items-start gap-3 ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border border-rose-200 text-rose-700'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <div className="space-y-4">
        {fields.map(field => {
          const isChanged = settings[field.key] !== originals[field.key];
          const isSaving = saving === field.key;

          return (
            <div
              key={field.key}
              className="rounded-xl border border-border bg-white p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="text-brand-600 mt-0.5">{field.icon}</div>
                  <div className="flex-1">
                    <label className="block font-bold text-ink text-sm mb-1">
                      {field.label}
                    </label>
                    <p className="text-xs text-muted">{field.hint}</p>
                  </div>
                </div>
                {isChanged && (
                  <button
                    onClick={() => saveField(field.key)}
                    disabled={isSaving}
                    className="ml-4 px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 transition-colors"
                  >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {isSaving ? 'Saxlanır...' : 'Saxla'}
                  </button>
                )}
              </div>

              <input
                type={field.type || 'text'}
                value={settings[field.key]}
                onChange={e => setSettings(prev => ({ ...prev, [field.key]: e.target.value }))}
                disabled={isSaving}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 disabled:opacity-50 transition-colors"
              />
            </div>
          );
        })}
      </div>

      <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
        <p className="font-bold mb-2">ℹ️ Dəyişikliklər əlaqədar:</p>
        <ul className="space-y-1 text-xs">
          <li>• Dəstək telefonu və email Footer-da, müştəri modallarda göstərilər</li>
          <li>• Platform ünvanı hukuki sənədlərdə və şirkət məlumatında istifadə olunur</li>
          <li>• Dəyişikliklər dərhal aktiv olur</li>
        </ul>
      </div>
    </div>
  );
}
