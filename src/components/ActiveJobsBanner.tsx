import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, ChevronRight, MapPin, PlayCircle } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

interface ActiveJob {
  id: string;
  brigade_id: string;
  source_id: string;
  status: 'accepted' | 'in_progress';
  assigned_at: string;
  opportunity?: {
    id: string;
    title: string | null;
    location: string | null;
    budget: number | null;
  } | null;
  brigade?: { id: string; name: string } | null;
}

/**
 * Provayder/işçinin əsas səhifəsində aktiv (qəbul edilmiş və ya davam edən)
 * briqada sifarişlərini göstərən banner.
 */
export default function ActiveJobsBanner() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void load();
    const channel = supabase
      .channel('active-jobs-banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brigade_assignments' },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const load = async () => {
    try {
      const { data: members } = await supabase
        .from('brigade_members')
        .select('id')
        .eq('profile_id', user!.id)
        .eq('is_active', true);
      const memberIds = (members ?? []).map((m) => m.id);
      if (memberIds.length === 0) {
        setJobs([]);
        return;
      }

      const { data, error } = await supabase
        .from('brigade_assignments')
        .select(
          'id, brigade_id, source_id, status, assigned_at, brigade:brigades(id, name)',
        )
        .in('member_id', memberIds)
        .in('status', ['accepted', 'in_progress'])
        .order('assigned_at', { ascending: false })
        .limit(20);
      if (error) throw error;

      const rows = (data ?? []) as unknown as ActiveJob[];
      const oppIds = Array.from(new Set(rows.map((r) => r.source_id)));
      let oppMap: Record<string, ActiveJob['opportunity']> = {};
      if (oppIds.length > 0) {
        const { data: opps } = await supabase
          .from('opportunities')
          .select('id, title, location, budget')
          .in('id', oppIds);
        oppMap = Object.fromEntries(
          (opps ?? []).map((o) => [o.id, o as ActiveJob['opportunity']]),
        );
      }
      setJobs(
        rows.map((r) => ({ ...r, opportunity: oppMap[r.source_id] ?? null })),
      );
    } catch (e) {
      console.error('ActiveJobsBanner load error:', e);
    }
  };

  const handleStart = async (job: ActiveJob) => {
    setBusy(job.id);
    const { error } = await supabase
      .from('brigade_assignments')
      .update({ status: 'in_progress' })
      .eq('id', job.id);
    setBusy(null);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('İş başladı');
    await load();
  };

  const handleComplete = async (job: ActiveJob) => {
    if (!confirm('İşi tamamladığını qeyd edirsən?')) return;
    setBusy(job.id);
    const { error } = await supabase.rpc('brigade_assignment_complete', {
      p_assignment_id: job.id,
    });
    setBusy(null);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success('Tamamlandı');
    await load();
  };

  if (jobs.length === 0) return null;

  return (
    <div className="mb-5 bg-gradient-to-br from-brand-50 to-accent-50 border-2 border-brand-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Briefcase size={18} className="text-brand-700" />
          <h3 className="text-base font-extrabold text-ink">
            Aktiv işlərim ({jobs.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => navigate('/account/incoming')}
          className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
        >
          Hamısı <ChevronRight size={14} />
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
        {jobs.map((j) => {
          const isInProgress = j.status === 'in_progress';
          return (
            <div
              key={j.id}
              className={`shrink-0 w-72 bg-white rounded-xl p-3 border ${
                isInProgress
                  ? 'border-amber-300'
                  : 'border-brand-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                    isInProgress
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-brand-50 text-brand-700'
                  }`}
                >
                  {isInProgress ? 'Davam edir' : 'Qəbul edildi'}
                </span>
                <span className="text-xs text-muted truncate">
                  {j.brigade?.name ?? '—'}
                </span>
              </div>
              <p className="font-extrabold text-ink text-sm line-clamp-1">
                {j.opportunity?.title ?? 'Sifariş'}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {j.opportunity?.budget != null && (
                  <span className="font-bold text-brand-700">
                    {j.opportunity.budget} AZN
                  </span>
                )}
                {j.opportunity?.location && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin size={11} />
                    <span className="truncate">{j.opportunity.location}</span>
                  </span>
                )}
              </div>
              <div className="mt-3">
                {!isInProgress ? (
                  <button
                    type="button"
                    onClick={() => handleStart(j)}
                    disabled={busy === j.id}
                    className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold disabled:opacity-50"
                  >
                    <PlayCircle size={14} /> İşi başlat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleComplete(j)}
                    disabled={busy === j.id}
                    className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                  >
                    Tamamla
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
