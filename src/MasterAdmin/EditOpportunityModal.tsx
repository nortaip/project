import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Opportunity {
  id: string;
  title: string;
  description: string;
  location: string | null;
  date: string;
  budget?: number | null;
  status?: string;
  category_id: string;
}

interface EditOpportunityModalProps {
  opportunity: Opportunity;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditOpportunityModal({
  opportunity,
  onClose,
  onSuccess,
}: EditOpportunityModalProps) {
  const [title, setTitle] = useState(opportunity.title);
  const [description, setDescription] = useState(opportunity.description);
  const [location, setLocation] = useState(opportunity.location ?? '');
  const [budget, setBudget] = useState(opportunity.budget?.toString() || '');
  const [date, setDate] = useState(opportunity.date);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function handleSave() {
    if (!title.trim()) {
      setMessage({ type: 'error', text: 'Başlıq daxil edin' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from('opportunities')
        .update({
          title: title.trim(),
          description: description.trim(),
          location: location.trim(),
          budget: budget ? parseFloat(budget) : null,
          date: date || null,
        })
        .eq('id', opportunity.id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Yadda saxlanıldı' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (e) {
      console.error('Update failed:', e);
      setMessage({ type: 'error', text: 'Saxlanmadı, yenidən cəhd edin' });
    } finally {
      setSaving(false);
    }
  }

  function handleCancelClick() {
    if (!showCancelReason) {
      setShowCancelReason(true);
      setMessage(null);
      return;
    }

    if (!cancelReason.trim()) {
      setMessage({ type: 'error', text: 'Ləğv səbəbini daxil edin' });
      return;
    }

    performCancel();
  }

  async function performCancel() {
    if (!confirm('Bu sifarişi ləğv etmək istədiyinizə əminsiniz?')) {
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from('opportunities')
        .update({
          status: 'cancelled',
          cancellation_reason: cancelReason.trim()
        })
        .eq('id', opportunity.id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Sifariş ləğv edildi' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (e) {
      console.error('Cancel failed:', e);
      setMessage({ type: 'error', text: 'Ləğv edilmədi, yenidən cəhd edin' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-ink">Sifarişin Detalllarını Düzəlt</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
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

          {/* Title */}
          <div>
            <label className="block text-sm font-bold text-ink mb-2">Başlıq *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={saving}
              placeholder="Sifariş başlığı"
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 text-sm disabled:opacity-50 transition-colors"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-bold text-ink mb-2">Ünvan / Məkan</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              disabled={saving}
              placeholder="Bakı, Həkim Rıza küçəsi"
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 text-sm disabled:opacity-50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-bold text-ink mb-2">Açıqlama</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={saving}
              placeholder="Sifariş haqqında ətraflı məlumat..."
              rows={4}
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 text-sm disabled:opacity-50 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Budget */}
            <div>
              <label className="block text-sm font-bold text-ink mb-2">Büdcə (AZN)</label>
              <input
                type="number"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                disabled={saving}
                placeholder="Məbləğ"
                min="0"
                step="0.01"
                className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 text-sm disabled:opacity-50 transition-colors"
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-bold text-ink mb-2">Tarix</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand-600 focus:ring-1 focus:ring-brand-600/20 text-sm disabled:opacity-50 transition-colors"
              />
            </div>
          </div>

          {/* Info */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            <p className="font-bold mb-1">ℹ️ Qeyd:</p>
            <ul className="text-xs space-y-1 list-disc list-inside">
              <li>Dəyişikliklər dərhal saxlanılır</li>
              <li>Müştəriyə bildirmə göndərilmir</li>
              <li>Tarif və kateqoriyalar dəyişdirilə bilməz</li>
            </ul>
          </div>

          {/* Cancellation Reason */}
          {showCancelReason && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 space-y-2">
              <label className="block text-sm font-bold text-rose-900">Ləğv Səbəbi *</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                disabled={saving}
                placeholder="Sifarişin ləğv edilməsinin səbəbini daxil edin..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-rose-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 text-sm disabled:opacity-50 transition-colors resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex items-center justify-between gap-3">
          {showCancelReason && (
            <button
              onClick={() => {
                setShowCancelReason(false);
                setCancelReason('');
                setMessage(null);
              }}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-muted hover:bg-surface-alt disabled:opacity-50 transition-colors"
            >
              Geri
            </button>
          )}
          {!showCancelReason && (
            <button
              onClick={handleCancelClick}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition-colors border border-rose-200"
            >
              Ləğv et
            </button>
          )}
          <div className="flex items-center gap-3">
            {showCancelReason && (
              <button
                onClick={performCancel}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-sm transition-colors"
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Ləğv edilir...
                  </>
                ) : (
                  'Ləğv et'
                )}
              </button>
            )}
            {!showCancelReason && (
              <>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-ink-soft hover:bg-surface-alt disabled:opacity-50 transition-colors"
                >
                  Bağla
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !title.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-sm transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Saxlanır...
                    </>
                  ) : (
                    'Yadda Saxla'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
