import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Radio } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import BrigadeDispatchPanel from './BrigadeDispatchPanel';

interface Brigade {
  id: string;
  owner_id: string;
  name: string;
  categories: string[];
  balance: number;
}

/**
 * Dispetçer DASHBOARD — admin-üslublu, geniş iş ekranı.
 * Əsas tab bar (Navbar) Layout-dan gəlir; bu səhifə tam-genişlikdə dashboard-dur.
 * Default görünüş "Xəritə" — işçilərin canlı yeri + sifarişlər. Yalnız
 * owner/dispatcher girə bilər.
 */
export default function BrigadeDispatchFullscreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [brigade, setBrigade] = useState<Brigade | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: b, error: bErr }, { data: role }] = await Promise.all([
        supabase
          .from('brigades')
          .select('id, owner_id, name, categories, balance')
          .eq('id', id)
          .single(),
        supabase.rpc('brigade_role', { p_brigade_id: id }),
      ]);
      if (bErr) throw bErr;
      setBrigade(b as Brigade);
      setCanManage(role === 'owner' || role === 'dispatcher');
    } catch (e) {
      message.error(`Yüklənmədi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-surface-bg">
        <span className="inline-block w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!brigade || !canManage) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 bg-surface-bg p-6 text-center">
        <p className="font-extrabold text-ink text-lg">
          Bu panelə yalnız briqada sahibi və ya dispatcher girə bilər.
        </p>
        <button
          onClick={() => navigate(`/brigades/${id ?? ''}`)}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white font-bold"
        >
          <ArrowLeft size={16} /> Briqadaya qayıt
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface-bg min-h-[calc(100vh-64px)]">
      {/* Admin-üslublu başlıq */}
      <div className="border-b border-border bg-white">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/brigades/${brigade.id}`)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600"
          >
            <ArrowLeft size={18} /> Geri
          </button>
          <div className="w-px h-6 bg-border" />
          <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Building2 size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-ink text-base truncate leading-tight">
              {brigade.name}
            </p>
            <p className="text-[11px] text-muted leading-tight">Dispetçer dashboard</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
            <Radio size={13} className="animate-pulse" /> Canlı
          </span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        <BrigadeDispatchPanel
          brigadeId={brigade.id}
          brigadeOwnerId={brigade.owner_id}
          brigadeCategories={brigade.categories ?? []}
          brigadeBalance={brigade.balance ?? 0}
          fullscreen
          defaultView="map"
        />
      </div>
    </div>
  );
}
