import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface PendingCompletion {
  id: string;
  offer_amount: number;
  completion_photos: string[];
  customer_signature_url: string | null;
  created_at: string;
  work_ended_at: string | null;
  opportunity_id: string;
  provider?: { name: string; avatar_url: string | null } | null;
  opportunity?: { title: string } | null;
}

interface DetailModalState {
  item: PendingCompletion | null;
  photoIndex: number;
  isApproving: boolean;
}

export default function JobCompletionsPage() {
  const [pending, setPending] = useState<PendingCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<DetailModalState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadPending();
  }, []);

  async function loadPending() {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('opportunities_offers')
        .select(
          `
          id,
          offer_amount,
          completion_photos,
          customer_signature_url,
          created_at,
          payout_status,
          opportunity_id,
          opportunities!opportunities_offers_opportunity_id_fkey(id, title),
          provider:profiles!opportunities_offers_provider_id_fkey(id, name, avatar_url)
          `
        )
        .eq('payout_status', 'pending_review')
        .order('created_at', { ascending: false });

      if (err) throw err;

      const items = (data || []).map((row: any) => ({
        id: row.id,
        offer_amount: row.offer_amount,
        completion_photos: row.completion_photos || [],
        customer_signature_url: row.customer_signature_url,
        created_at: row.created_at,
        work_ended_at: row.work_ended_at,
        opportunity_id: row.opportunity_id,
        opportunity: row.opportunities,
        provider: row.provider,
      }));

      setPending(items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xəta baş verdi');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(item: PendingCompletion) {
    if (!detail) return;

    try {
      setDetail({ ...detail, isApproving: true });

      const { data: { user } } = await supabase.auth.getUser();

      // Update offer: mark as approved
      const { error: updateErr } = await supabase
        .from('opportunities_offers')
        .update({
          payout_status: 'approved',
          admin_approved_at: new Date().toISOString(),
          admin_approved_by: user?.id,
        })
        .eq('id', item.id);

      if (updateErr) throw updateErr;

      // Call RPC to release payment
      const { error: rpcErr } = await supabase.rpc('release_offer_to_provider', {
        p_offer_id: item.id,
      });

      if (rpcErr) throw rpcErr;

      // Refresh list and close modal
      setPending(prev => prev.filter(p => p.id !== item.id));
      setDetail(null);

      // Show success message
      const msg = document.createElement('div');
      msg.className =
        'fixed top-4 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg';
      msg.textContent = 'Ödəniş köçürüldü';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Xəta baş verdi');
    } finally {
      setDetail(detail ? { ...detail, isApproving: false } : null);
    }
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('az', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function fmtMoney(n: number): string {
    return new Intl.NumberFormat('az-AZ', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }

  return (
    <AdminLayout
      title="İş tamamlanması"
      subtitle="Admin tərəfindən gözləyən iş tamamlanması fotosu və imzasını nəzərdən keçirin"
    >
      <div className="space-y-6">
        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted mb-1">Gözləyən İşlər</p>
                <p className="text-3xl font-bold text-gray-900">{pending.length}</p>
              </div>
              <Clock className="w-10 h-10 text-orange-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted mb-1">Cəmi Məbləğ</p>
                <p className="text-3xl font-bold text-gray-900">
                  {fmtMoney(pending.reduce((sum, p) => sum + (p.offer_amount || 0), 0))} ₼
                </p>
              </div>
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
              <p className="text-sm text-muted">Yüklənir...</p>
            </div>
          </div>
        ) : pending.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-semibold text-gray-900">Gözləyən iş yoxdur</p>
            <p className="text-sm text-muted mt-2">Bütün işlər təsdiqləndi</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map(item => (
              <div
                key={item.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div
                          className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0"
                          style={{
                            backgroundImage: item.provider?.avatar_url
                              ? `url('${item.provider.avatar_url}')`
                              : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                        />
                        <div>
                          <p className="font-semibold text-gray-900">
                            {item.provider?.name || 'Naməlum provayder'}
                          </p>
                          <p className="text-xs text-muted">
                            {item.opportunity?.title || 'Naməlum iş'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mt-4">
                        <div>
                          <p className="text-xs text-muted mb-1">Məbləğ</p>
                          <p className="font-bold text-gray-900">
                            {fmtMoney(item.offer_amount)} ₼
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted mb-1">Tamamlama tarixi</p>
                          <p className="font-bold text-gray-900 text-sm">
                            {fmtDate(item.work_ended_at || item.created_at)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted mb-1">Fotoları</p>
                          <p className="font-bold text-gray-900">
                            {item.completion_photos.length} foto
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        setDetail({
                          item,
                          photoIndex: 0,
                          isApproving: false,
                        })
                      }
                      className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors flex items-center gap-2 flex-shrink-0"
                    >
                      Bax
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {detail.item.provider?.name || 'Naməlum'}
                </h2>
                <p className="text-sm text-muted">
                  {detail.item.opportunity?.title || 'Naməlum iş'}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-gray-600 p-2"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Photos */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>İş Fotoları</span>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                    {detail.item.completion_photos.length}
                  </span>
                </h3>

                {detail.item.completion_photos.length > 0 ? (
                  <div className="space-y-3">
                    {/* Main photo */}
                    <div className="bg-gray-100 rounded-lg overflow-hidden">
                      <img
                        src={detail.item.completion_photos[detail.photoIndex]}
                        alt={`Foto ${detail.photoIndex + 1}`}
                        className="w-full h-64 object-cover"
                      />
                    </div>

                    {/* Thumbnails */}
                    <div className="flex gap-2 overflow-x-auto">
                      {detail.item.completion_photos.map((url, idx) => (
                        <button
                          key={idx}
                          onClick={() =>
                            setDetail({
                              ...detail,
                              photoIndex: idx,
                            })
                          }
                          className={`w-16 h-16 rounded flex-shrink-0 border-2 transition-colors ${
                            idx === detail.photoIndex
                              ? 'border-brand-600'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <img
                            src={url}
                            alt={`Kiçik ${idx + 1}`}
                            className="w-full h-full object-cover rounded"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Foto yoxdur</p>
                )}
              </div>

              {/* Signature */}
              {detail.item.customer_signature_url && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Müştəri İmzası</h3>
                  <div className="bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={detail.item.customer_signature_url}
                      alt="Müştəri imzası"
                      className="w-full h-40 object-contain"
                    />
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
                <div>
                  <p className="text-xs text-muted mb-1">Məbləğ</p>
                  <p className="font-bold text-gray-900">
                    {fmtMoney(detail.item.offer_amount)} ₼
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Tamamlama tarixi</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {fmtDate(detail.item.work_ended_at || detail.item.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Provayder</p>
                  <p className="font-bold text-gray-900">{detail.item.provider?.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">İş Kimliği</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {detail.item.id.substring(0, 8)}...
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-6 flex gap-3">
              <button
                onClick={() => setDetail(null)}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium text-gray-900"
              >
                İmtina
              </button>
              <button
                onClick={() => handleApprove(detail.item)}
                disabled={detail.isApproving}
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
              >
                {detail.isApproving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Təsdiqlənir...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Təsdiqlə
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
