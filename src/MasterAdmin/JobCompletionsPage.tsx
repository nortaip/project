import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2, ChevronRight, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

interface PendingCompletion {
  id: string;
  offer_amount: number;
  payment_method: string | null;
  completion_photos: string[];
  customer_signature_url: string | null;
  created_at: string;
  work_ended_at: string | null;
  opportunity_id: string;
  provider_id: string | null;
  provider?: { name: string; avatar_url: string | null } | null;
  opportunity?: { title: string } | null;
}

interface FinanceInfo {
  method: 'card' | 'cash';
  offerAmount: number;
  acceptCommission: number | null;   // qəbulda tutulub (tarixi fakt)
  lockedEscrow: number | null;       // kartda kilidli məbləğ
  completePct: number;               // tamamlama komissiyası %
  completeCommission: number;        // indi tutulacaq
  releaseAmount: number;             // usta balansına köçəcək
  bonusPct: number;
  bonusAmount: number;               // usta bonus balansına
  providerBalance: number;           // cari balans
  providerBonus: number;             // cari bonus balансı
  platformTotal: number;             // platforma gəliri (qəbul + tamamlama)
}

interface DetailModalState {
  item: PendingCompletion | null;
  finance?: FinanceInfo | null;      // null = yüklənir
  photoIndex: number;
  isApproving: boolean;
  isRejecting: boolean;
  showRejectForm: boolean;
  rejectReason: string;
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
      // Embed (FK-hint) sorğuları kövrəkdir — 3 sadə sorğu ilə yığırıq:
      // 1) gözləyən təkliflər, 2) sifariş başlıqları, 3) usta profilləri
      const { data, error: err } = await supabase
        .from('opportunities_offers')
        .select(
          'id, offer_amount, completion_photos, customer_signature_url,' +
          ' created_at, payout_status, opportunity_id, provider_id, payment_method'
        )
        .eq('payout_status', 'pending_review')
        .order('created_at', { ascending: false });

      if (err) throw err;
      const rows = data || [];

      const oppIds = Array.from(
        new Set(rows.map((r: any) => r.opportunity_id).filter(Boolean)),
      );
      const provIds = Array.from(
        new Set(rows.map((r: any) => r.provider_id).filter(Boolean)),
      );

      const oppMap: Record<string, any> = {};
      if (oppIds.length > 0) {
        const { data: opps, error: oppErr } = await supabase
          .from('opportunities')
          .select('id, title, work_ended_at')
          .in('id', oppIds);
        if (oppErr) throw oppErr;
        for (const o of opps || []) oppMap[o.id] = o;
      }

      const provMap: Record<string, any> = {};
      if (provIds.length > 0) {
        const { data: provs, error: provErr } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', provIds);
        if (provErr) throw provErr;
        for (const p of provs || []) provMap[p.id] = p;
      }

      const items = rows.map((row: any) => ({
        id: row.id,
        offer_amount: row.offer_amount,
        completion_photos: row.completion_photos || [],
        customer_signature_url: row.customer_signature_url,
        created_at: row.created_at,
        payment_method: row.payment_method ?? null,
        work_ended_at: oppMap[row.opportunity_id]?.work_ended_at ?? null,
        opportunity_id: row.opportunity_id,
        provider_id: row.provider_id ?? null,
        opportunity: oppMap[row.opportunity_id] ?? null,
        provider: provMap[row.provider_id] ?? null,
      }));

      setPending(items);
      setError('');
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ??
        (e instanceof Error ? e.message : String(e));
      setError(`Yüklənmə xətası: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  /// Təsdiqdən ƏVVƏL maliyyə önizləməsi: komissiyalar, ustaya köçəcək
  /// məbləğ, bonus və platforma gəliri (release_offer_to_provider
  /// RPC-sinin edəcəyi hesablamanın eynisi).
  async function loadFinance(item: PendingCompletion): Promise<FinanceInfo> {
    const method = item.payment_method === 'card' ? 'card' : 'cash';

    const [txRes, cfgRes, provRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('type, amount, description')
        .eq('related_id', item.id),
      supabase
        .from('platform_config')
        .select('key, value')
        .in('key', ['commission_on_complete', 'bonus_on_complete']),
      item.provider_id
        ? supabase
            .from('profiles')
            .select('balance, bonus_balance')
            .eq('id', item.provider_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const txs = txRes.data ?? [];
    const escrowTx = txs.find(t => t.type === 'escrow_lock');
    const acceptTx = txs.find(
      t => t.type === 'platform_revenue' && Number(t.amount) > 0,
    );
    const cfg: Record<string, number> = {};
    for (const r of cfgRes.data ?? []) {
      cfg[r.key] = Number(String(r.value).replace(/"/g, '')) || 0;
    }
    const completePct = cfg['commission_on_complete'] ?? 0;
    const bonusPct = cfg['bonus_on_complete'] ?? 0;

    const offerAmount = Number(item.offer_amount) || 0;
    const acceptCommission = acceptTx ? round2(Number(acceptTx.amount)) : null;
    const lockedEscrow = escrowTx ? round2(Number(escrowTx.amount)) : null;

    let completeCommission = 0;
    let releaseAmount = 0;
    let bonusAmount = 0;
    if (method === 'card') {
      const locked =
        lockedEscrow ?? round2(offerAmount - (acceptCommission ?? 0));
      completeCommission = round2((locked * completePct) / 100);
      releaseAmount = round2(locked - completeCommission);
      bonusAmount = round2((releaseAmount * bonusPct) / 100);
    } else {
      // Nağd: pul əldən-ələ; qəbul komissiyası artıq tutulub, bonus təklifdən
      bonusAmount = round2((offerAmount * bonusPct) / 100);
    }

    const providerBalance = round2(Number(provRes.data?.balance ?? 0));
    const providerBonus = round2(Number(provRes.data?.bonus_balance ?? 0));

    return {
      method,
      offerAmount,
      acceptCommission,
      lockedEscrow,
      completePct,
      completeCommission,
      releaseAmount,
      bonusPct,
      bonusAmount,
      providerBalance,
      providerBonus,
      platformTotal: round2((acceptCommission ?? 0) + completeCommission),
    };
  }

  async function handleApprove(item: PendingCompletion) {
    if (!detail) return;

    try {
      setDetail({ ...detail, isApproving: true });

      const { data: { user } } = await supabase.auth.getUser();

      // Əvvəlcə RPC ilə ödənişi köçür — uğursuz olsa payout_status dəyişməz
      const { error: rpcErr } = await supabase.rpc('release_offer_to_provider', {
        p_offer_id: item.id,
      });

      if (rpcErr) throw rpcErr;

      // RPC uğurlu oldu — indi offer-i approved kimi işarələ
      const { error: updateErr } = await supabase
        .from('opportunities_offers')
        .update({
          payout_status: 'approved',
          admin_approved_at: new Date().toISOString(),
          admin_approved_by: user?.id,
        })
        .eq('id', item.id);

      if (updateErr) throw updateErr;

      // Refresh list and close modal
      setPending(prev => prev.filter(p => p.id !== item.id));
      setDetail(null);

      // Show success message
      const msg = document.createElement('div');
      msg.className =
        'fixed top-4 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg';
      const fin = detail.finance;
      msg.textContent =
        fin && fin.method === 'card'
          ? `Təsdiqləndi ✓ Ustaya ${fmtMoney(fin.releaseAmount)} ₼ köçürüldü` +
            (fin.bonusAmount > 0 ? ` (+${fmtMoney(fin.bonusAmount)} ₼ bonus)` : '') +
            ` · Platforma gəliri ${fmtMoney(fin.platformTotal)} ₼`
          : 'Təsdiqləndi ✓ (nağd sifariş — balans köçürməsi yoxdur)';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Xəta baş verdi');
    } finally {
      setDetail(prev => (prev ? { ...prev, isApproving: false } : null));
    }
  }

  async function handleReject(item: PendingCompletion) {
    if (!detail) return;
    const reason = detail.rejectReason.trim();
    if (!reason) return;

    try {
      setDetail({ ...detail, isRejecting: true });

      // Offer-in payout statusunu rejected et
      const { error: updateErr } = await supabase
        .from('opportunities_offers')
        .update({ payout_status: 'rejected' })
        .eq('id', item.id);
      if (updateErr) throw updateErr;

      // Provayderə bildiriş göndər
      if (item.provider_id) {
        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: item.provider_id,
          type: 'completion_rejected',
          title: 'Tamamlama qəbul edilmədi',
          body: reason,
          related_id: item.id,
        });
        if (notifErr) throw notifErr;
      }

      setDetail(null);
      await loadPending();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Xəta baş verdi');
      setDetail(prev => (prev ? { ...prev, isRejecting: false } : null));
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
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={() => void loadPending()}
              className="shrink-0 h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold"
            >
              Yenidən yüklə
            </button>
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
                      onClick={() => {
                        setDetail({
                          item,
                          finance: null,
                          photoIndex: 0,
                          isApproving: false,
                          isRejecting: false,
                          showRejectForm: false,
                          rejectReason: '',
                        });
                        void loadFinance(item)
                          .then(fin =>
                            setDetail(prev =>
                              prev && prev.item?.id === item.id
                                ? { ...prev, finance: fin }
                                : prev,
                            ),
                          )
                          .catch(() => undefined);
                      }}
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

              {/* ── Maliyyə detalları ── */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">
                  Maliyyə detalları
                </h3>
                {detail.finance == null ? (
                  <div className="flex items-center gap-2 text-sm text-muted bg-gray-50 rounded-lg p-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Hesablanır...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Qiymət bölgüsü */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted">Təklif məbləği</span>
                        <span className="font-bold text-gray-900">
                          {fmtMoney(detail.finance.offerAmount)} ₼
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Ödəniş üsulu</span>
                        <span className="font-bold text-gray-900">
                          {detail.finance.method === 'card'
                            ? '💳 Kart (escrow)'
                            : '💵 Nağd'}
                        </span>
                      </div>
                      {detail.finance.acceptCommission != null && (
                        <div className="flex justify-between">
                          <span className="text-muted">
                            Qəbul komissiyası (tutulub)
                          </span>
                          <span className="font-bold text-red-600">
                            −{fmtMoney(detail.finance.acceptCommission)} ₼
                          </span>
                        </div>
                      )}
                      {detail.finance.method === 'card' && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted">Escrow-da kilidli</span>
                            <span className="font-bold text-gray-900">
                              {fmtMoney(
                                detail.finance.lockedEscrow ??
                                  detail.finance.releaseAmount +
                                    detail.finance.completeCommission,
                              )}{' '}
                              ₼
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">
                              Tamamlama komissiyası ({detail.finance.completePct}%)
                              — təsdiqdə tutulacaq
                            </span>
                            <span className="font-bold text-red-600">
                              −{fmtMoney(detail.finance.completeCommission)} ₼
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Təsdiqdən sonra nə olacaq */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2 text-sm">
                      <p className="font-bold text-emerald-800 mb-1">
                        ✅ Təsdiq etsəniz:
                      </p>
                      {detail.finance.method === 'card' ? (
                        <div className="flex justify-between">
                          <span className="text-emerald-800">
                            Ustanın balansına köçəcək
                          </span>
                          <span className="font-extrabold text-emerald-700">
                            +{fmtMoney(detail.finance.releaseAmount)} ₼
                          </span>
                        </div>
                      ) : (
                        <p className="text-emerald-800">
                          Nağd sifariş — pul müştəridən birbaşa alınıb, balans
                          köçürməsi olmayacaq.
                        </p>
                      )}
                      {detail.finance.method === 'card' && (
                        <div className="flex justify-between text-xs">
                          <span className="text-emerald-700">
                            Usta balansı: {fmtMoney(detail.finance.providerBalance)} ₼
                          </span>
                          <span className="font-bold text-emerald-700">
                            → {fmtMoney(
                              round2(
                                detail.finance.providerBalance +
                                  detail.finance.releaseAmount,
                              ),
                            )}{' '}
                            ₼
                          </span>
                        </div>
                      )}
                      {detail.finance.bonusAmount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-emerald-800">
                            Bonus ({detail.finance.bonusPct}%) — bonus balansına
                          </span>
                          <span className="font-bold text-emerald-700">
                            +{fmtMoney(detail.finance.bonusAmount)} ₼ (
                            {fmtMoney(detail.finance.providerBonus)} →{' '}
                            {fmtMoney(
                              round2(
                                detail.finance.providerBonus +
                                  detail.finance.bonusAmount,
                              ),
                            )}
                            )
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-emerald-200 pt-2 mt-1">
                        <span className="text-emerald-800 font-bold">
                          Platforma gəliri (cəmi)
                        </span>
                        <span className="font-extrabold text-emerald-700">
                          {fmtMoney(detail.finance.platformTotal)} ₼
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

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
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-6 space-y-3">
              {detail.showRejectForm && (
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">
                    İmtina səbəbi <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    value={detail.rejectReason}
                    onChange={e =>
                      setDetail({ ...detail, rejectReason: e.target.value })
                    }
                    rows={3}
                    autoFocus
                    placeholder="Provayderə göndəriləcək imtina səbəbini yazın…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-600 text-sm resize-none"
                  />
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setDetail(null)}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium text-gray-900"
                >
                  Bağla
                </button>
                {detail.showRejectForm ? (
                  <button
                    onClick={() => handleReject(detail.item!)}
                    disabled={detail.isRejecting || !detail.rejectReason.trim()}
                    className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {detail.isRejecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        İmtina edilir...
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        İmtina et
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => setDetail({ ...detail, showRejectForm: true })}
                    disabled={detail.isApproving}
                    className="flex-1 px-4 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    İmtina et
                  </button>
                )}
                <button
                  onClick={() => handleApprove(detail.item!)}
                  disabled={detail.isApproving || detail.isRejecting}
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
        </div>
      )}
    </AdminLayout>
  );
}
