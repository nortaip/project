import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Filter,
  Inbox,
  Search,
  Sparkles,
  Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { OpportunityDetailsModal } from './EditOfferModal';
import EditOpportunityModal from './EditOpportunityModal';

interface Opportunity {
  id: string;
  title: string;
  description: string;
  location: string;
  date: string;
  status?: string;
  category_id: string;
  subcategory_id: string;
  extra_answers: string;
  budget?: number | null;
  created_at: string;
  created_by: string;
}

interface Offer {
  id: string;
  opportunity_id: string;
  provider_id: string;
  offer_amount: number;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled' | string;
  created_at: string;
}

interface Profile {
  id: string;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}

type StatusFilter = 'all' | 'unaccepted' | 'pending' | 'accepted' | 'rejected' | 'completed';

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'unaccepted', label: 'Qəbul edilməyənlər' },
  { key: 'pending', label: 'Gözləyən' },
  { key: 'accepted', label: 'Qəbul edilmiş' },
  { key: 'completed', label: 'Tamamlanmış' },
  { key: 'rejected', label: 'Rədd edilmiş' },
  { key: 'all', label: 'Hamısı' },
];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
    pending: { bg: 'bg-amber-50', fg: 'text-amber-700 border-amber-200', label: 'Gözləyir', Icon: Clock },
    accepted: { bg: 'bg-emerald-50', fg: 'text-emerald-700 border-emerald-200', label: 'Qəbul edilib', Icon: CheckCircle2 },
    rejected: { bg: 'bg-rose-50', fg: 'text-rose-700 border-rose-200', label: 'Rədd edilib', Icon: XCircle },
    completed: { bg: 'bg-violet-50', fg: 'text-violet-700 border-violet-200', label: 'Tamamlanıb', Icon: CheckCircle2 },
    cancelled: { bg: 'bg-gray-100', fg: 'text-gray-600 border-gray-200', label: 'Ləğv edilib', Icon: XCircle },
  };
  const m = map[status] ?? { bg: 'bg-gray-100', fg: 'text-gray-600 border-gray-200', label: status, Icon: Clock };
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${m.bg} ${m.fg}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

const OpportunitiesPageAdmin: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [offers, setOffers] = useState<Record<string, Offer[]>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('unaccepted');
  const [search, setSearch] = useState('');
  const [detailsOpportunity, setDetailsOpportunity] = useState<Opportunity | null>(null);
  const [editOpportunity, setEditOpportunity] = useState<Opportunity | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const { data: opps, error } = await supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        setLoading(false);
        return;
      }
      const oppList = (opps ?? []) as Opportunity[];
      setOpportunities(oppList);

      const oppIds = oppList.map((o) => o.id);
      let offerList: Offer[] = [];
      if (oppIds.length > 0) {
        const { data: offData } = await supabase
          .from('opportunities_offers')
          .select('id, opportunity_id, provider_id, offer_amount, status, created_at')
          .in('opportunity_id', oppIds);
        offerList = (offData ?? []) as Offer[];
      }

      const map: Record<string, Offer[]> = {};
      for (const off of offerList) {
        if (!map[off.opportunity_id]) map[off.opportunity_id] = [];
        map[off.opportunity_id].push(off);
      }
      setOffers(map);

      const userIds = Array.from(
        new Set<string>([
          ...oppList.map((o) => o.created_by).filter(Boolean),
          ...offerList.map((o) => o.provider_id).filter(Boolean),
        ]),
      );
      if (userIds.length > 0) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('id, name, phone_number, email')
          .in('id', userIds);
        const profMap: Record<string, Profile> = {};
        for (const p of (profData ?? []) as Profile[]) {
          profMap[p.id] = p;
        }
        setProfiles(profMap);
      }

      setLoading(false);
    };
    void fetchAll();
  }, []);

  const counts = useMemo(() => {
    let pending = 0;
    let accepted = 0;
    let rejected = 0;
    let completed = 0;
    let total = 0;
    for (const list of Object.values(offers)) {
      for (const o of list) {
        total++;
        if (o.status === 'pending') pending++;
        else if (o.status === 'accepted') accepted++;
        else if (o.status === 'rejected') rejected++;
        else if (o.status === 'completed') completed++;
      }
    }
    return { total, pending, accepted, rejected, completed, unaccepted: pending + rejected };
  }, [offers]);

  const filteredOpportunities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((op) => {
      const opOffers = offers[op.id] ?? [];

      let statusMatch = true;
      if (filter !== 'all') {
        if (filter === 'unaccepted') {
          statusMatch = opOffers.some((o) => o.status === 'pending' || o.status === 'rejected');
        } else {
          statusMatch = opOffers.some((o) => o.status === filter);
        }
      }
      if (!statusMatch) return false;

      if (!q) return true;
      const inTitle = op.title?.toLowerCase().includes(q);
      const inDesc = op.description?.toLowerCase().includes(q);
      const creator = profiles[op.created_by];
      const inCreator =
        creator?.name?.toLowerCase().includes(q) ||
        creator?.phone_number?.toLowerCase().includes(q);
      return inTitle || inDesc || inCreator;
    });
  }, [opportunities, offers, filter, search, profiles]);

  const visibleOffersFor = (oppId: string): Offer[] => {
    const list = offers[oppId] ?? [];
    if (filter === 'all') return list;
    if (filter === 'unaccepted') {
      return list.filter((o) => o.status === 'pending' || o.status === 'rejected');
    }
    return list.filter((o) => o.status === filter);
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Cəmi təklif" value={counts.total} tint="brand" />
        <StatCard label="Qəbul edilməyib" value={counts.unaccepted} tint="amber" />
        <StatCard label="Qəbul edilib" value={counts.accepted} tint="emerald" />
        <StatCard label="Tamamlanıb" value={counts.completed} tint="violet" />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-ink-soft text-sm font-bold">
            <Filter size={16} /> Status filtri
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Başlıq, müştəri, açıqlama..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-colors ${
                  active
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-ink-soft border-border hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center text-muted">
          Yüklənir...
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center text-muted flex flex-col items-center gap-3">
          <Inbox size={32} className="text-muted/60" />
          <p className="font-bold">Bu filtrə uyğun fürsət yoxdur</p>
          <p className="text-xs">Status filtrini dəyişməyə cəhd edin.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOpportunities.map((op) => {
            const creator = profiles[op.created_by];
            const visible = visibleOffersFor(op.id);
            return (
              <div
                key={op.id}
                className="bg-white border border-border rounded-2xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-extrabold text-ink text-lg">{op.title}</h3>
                      {op.status && statusBadge(op.status)}
                    </div>
                    <p className="text-sm text-ink-soft mt-1">
                      <b>Müştəri:</b>{' '}
                      {creator
                        ? `${creator.name ?? '—'} (${creator.phone_number ?? creator.email ?? '—'})`
                        : op.created_by.slice(0, 8)}
                      {op.budget != null && (
                        <span className="ml-2 text-muted">
                          · Büdcə: <b>{op.budget} ₼</b>
                        </span>
                      )}
                    </p>
                    {op.description && (
                      <p className="text-sm text-muted mt-2 line-clamp-2">{op.description}</p>
                    )}
                  </div>
                  <div className="inline-flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDetailsOpportunity(op)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-50 text-brand-700 font-bold text-sm hover:bg-brand-100 transition-colors"
                    >
                      <Eye size={14} /> Detallar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditOpportunity(op)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition-colors"
                    >
                      Düzəlt
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={14} className="text-brand-600" />
                    <span className="font-bold text-sm text-ink">
                      Təkliflər ({visible.length}
                      {visible.length !== (offers[op.id]?.length ?? 0) && (
                        <span className="text-muted font-normal">
                          {' / '}{offers[op.id]?.length ?? 0}
                        </span>
                      )}
                      )
                    </span>
                  </div>
                  {visible.length === 0 ? (
                    <p className="text-xs text-muted">Filtrə uyğun təklif yoxdur</p>
                  ) : (
                    <ul className="space-y-2">
                      {visible.map((offer) => {
                        const provider = profiles[offer.provider_id];
                        return (
                          <li
                            key={offer.id}
                            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-alt"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="font-extrabold text-ink">
                                  {offer.offer_amount} ₼
                                </span>
                                {statusBadge(offer.status)}
                              </div>
                              <p className="text-xs text-muted mt-0.5 truncate">
                                {provider?.name ?? '—'} ·{' '}
                                {provider?.phone_number ?? provider?.email ?? '—'}
                              </p>
                            </div>
                            <span className="text-xs text-muted shrink-0">
                              {new Date(offer.created_at).toLocaleDateString('az', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailsOpportunity && (
        <OpportunityDetailsModal
          opportunity={detailsOpportunity}
          creator={profiles[detailsOpportunity.created_by]}
          offers={offers[detailsOpportunity.id] ?? []}
          profiles={profiles}
          onClose={() => setDetailsOpportunity(null)}
          onEditOffer={() => {}}
        />
      )}

      {editOpportunity && (
        <EditOpportunityModal
          opportunity={editOpportunity}
          onClose={() => setEditOpportunity(null)}
          onSuccess={() => {
            // Refresh opportunities list
            const fetchAll = async () => {
              const { data: opps } = await supabase
                .from('opportunities')
                .select('*')
                .order('created_at', { ascending: false });
              if (opps) setOpportunities(opps);
            };
            fetchAll();
          }}
        />
      )}
    </div>
  );
};

function StatCard({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'brand' | 'amber' | 'emerald' | 'violet';
}) {
  const map: Record<typeof tint, string> = {
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <p className="text-xs font-bold text-muted uppercase tracking-wide">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-extrabold ${map[tint].split(' ')[1]}`}>{value}</span>
        <span className={`text-xs font-bold ${map[tint]} px-2 py-0.5 rounded-md`}>təklif</span>
      </div>
    </div>
  );
}

export default OpportunitiesPageAdmin;
