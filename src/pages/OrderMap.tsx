import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  Polyline,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  Crosshair,
  MapPin,
  Search,
  Star,
  Users,
  X,
} from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui';
import AcceptOfferModal from '../admin/AcceptOfferModal';

// ────────────────────────────────────────────────────────────────────────────
// Tiplər
// ────────────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  label: string;
}
interface Subcategory {
  id: string;
  label: string;
}
interface Question {
  name: string;
  label?: string;
  question?: string;
  type: 'text' | 'textarea' | 'select' | 'tel' | 'date' | 'number';
  required?: boolean;
  options?: string[] | string;
}
interface OnlineProvider {
  id: string;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  latitude: number;
  longitude: number;
}
interface LiveOffer {
  id: string;
  provider_id: string;
  brigade_id: string | null;
  offer_amount: number | null;
  status: string;
  created_at: string;
  provider: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    rating: number | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  brigade: { id: string; name: string; logo_url: string | null } | null;
}

type Phase = 'category' | 'subcategory' | 'questions' | 'confirm' | 'searching' | 'accepted';

const BAKU: [number, number] = [40.4093, 49.8671];
const RADIUS_OPTIONS: { value: number; label: string }[] = [
  { value: 50, label: '50 m' },
  { value: 200, label: '200 m' },
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
  { value: 5000, label: '5 km' },
];

// ────────────────────────────────────────────────────────────────────────────
// Köməkçilər
// ────────────────────────────────────────────────────────────────────────────

/** İki koordinat arasında məsafə (metr, haversine). */
function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseOptions(opts: Question['options']): string[] {
  if (!opts) return [];
  if (Array.isArray(opts)) return opts;
  try {
    const j = JSON.parse(opts);
    if (Array.isArray(j)) return j.map(String);
  } catch {
    /* JSON deyil — vergüllə bölünmüş siyahı sayılır */
  }
  return opts.split(',').map((s) => s.trim()).filter(Boolean);
}

function userIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;transform:translate(-50%,-50%);">
      <span style="position:absolute;inset:-9px;border-radius:9999px;background:rgba(37,99,235,.25);animation:omPulse 1.8s ease-out infinite"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:#2563EB;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35)"></span>
    </div>`,
    iconSize: [0, 0],
  });
}

function providerIcon(p: OnlineProvider, active: boolean): L.DivIcon {
  const size = active ? 44 : 36;
  const inner = p.avatar_url
    ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9999px" />`
    : `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font:700 ${size / 2.4}px sans-serif;color:white;background:#059669;border-radius:9999px">${(p.name || 'U').charAt(0).toUpperCase()}</span>`;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:9999px;border:3px solid ${active ? '#1D4ED8' : '#10B981'};box-shadow:0 3px 8px rgba(0,0,0,.3);overflow:hidden;background:white">${inner}</div>`,
    iconSize: [0, 0],
  });
}

function FlyTo({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom ?? Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [center, zoom, map]);
  return null;
}

function FitRoute({ a, b }: { a: [number, number] | null; b: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (a && b) map.fitBounds(L.latLngBounds([a, b]).pad(0.35), { animate: true });
  }, [a, b, map]);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Əsas səhifə — Uber-üslub sifariş ekranı
// ────────────────────────────────────────────────────────────────────────────

export default function OrderMap() {
  const navigate = useNavigate();
  // Xəritə / lokasiya
  const [myPos, setMyPos] = useState<[number, number] | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [radius, setRadius] = useState(50);
  const [providers, setProviders] = useState<OnlineProvider[]>([]);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);

  // Sifariş axını
  const [phase, setPhase] = useState<Phase>('category');
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcats, setSubcats] = useState<Subcategory[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [subcat, setSubcat] = useState<Subcategory | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Axtarış / təkliflər
  const [oppId, setOppId] = useState<string | null>(null);
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [activeOffer, setActiveOffer] = useState<LiveOffer | null>(null);
  const [acceptOffer, setAcceptOffer] = useState<LiveOffer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);

  const offersRef = useRef<LiveOffer[]>([]);
  offersRef.current = offers;

  // ── Geolokasiya ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setMyPos(c);
        setFlyTarget(c);
      },
      () => setGeoDenied(true),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // ── Onlayn ustalar (30 saniyədə bir + realtime) ─────────────────────────
  const loadProviders = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, avatar_url, rating, latitude, longitude')
      .eq('role', 'provider')
      .eq('is_online', true)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(300);
    setProviders(
      ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id),
        name: (p.name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
        rating: p.rating != null ? Number(p.rating) : null,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
      })),
    );
  }, []);

  useEffect(() => {
    void loadProviders();
    const iv = setInterval(() => void loadProviders(), 30000);
    const ch = supabase
      .channel('order-map-providers')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        () => void loadProviders(),
      )
      .subscribe();
    return () => {
      clearInterval(iv);
      void supabase.removeChannel(ch);
    };
  }, [loadProviders]);

  // ── Kateqoriyalar ────────────────────────────────────────────────────────
  useEffect(() => {
    void supabase
      .from('service_categories')
      .select('id, label')
      .order('label')
      .then(({ data }) => setCategories((data ?? []) as Category[]));
  }, []);

  // Radius daxilindəki ustalar (xəritə görünüşü üçün)
  const nearby = useMemo(() => {
    if (!myPos) return providers;
    return providers.filter(
      (p) => distanceM(myPos, [p.latitude, p.longitude]) <= radius,
    );
  }, [providers, myPos, radius]);

  // ── Login yoxlaması — axının əvvəlində ──────────────────────────────────
  const requireAuth = async (): Promise<boolean> => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return true;
    navigate('/login', {
      state: { message: 'Sifariş vermək üçün daxil olun', from: '/order' },
    });
    return false;
  };

  // ── Kateqoriya seçimi ────────────────────────────────────────────────────
  const pickCategory = async (c: Category) => {
    // Anonim istifadəçi axına başlamamış login-ə yönləndirilir
    if (!(await requireAuth())) return;
    setCategory(c);
    const { data } = await supabase
      .from('service_subcategories')
      .select('id, label')
      .eq('category_id', c.id)
      .order('label');
    const list = (data ?? []) as Subcategory[];
    setSubcats(list);
    if (list.length > 0) {
      setPhase('subcategory');
    } else {
      await loadQuestions(c.id, null);
    }
  };

  const loadQuestions = async (categoryId: string, subcategoryId: string | null) => {
    let q = supabase
      .from('service_questions')
      .select('*')
      .eq('category_id', categoryId)
      .order('order_num', { ascending: true });
    if (subcategoryId) q = q.eq('subcategory_id', subcategoryId);
    const { data } = await q;
    setQuestions((data ?? []) as Question[]);
    setQIdx(0);
    setAnswers({});
    setPhase((data ?? []).length > 0 ? 'questions' : 'confirm');
  };

  // ── Sifarişi göndər ──────────────────────────────────────────────────────
  const submitOrder = async () => {
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        navigate('/login', {
          state: { message: 'Sifariş vermək üçün daxil olun', from: '/order' },
        });
        return;
      }
      const locationStr = myPos
        ? `${myPos[0].toFixed(6)}, ${myPos[1].toFixed(6)}`
        : address.trim();
      if (!locationStr) {
        message.error('Ünvan daxil edin və ya lokasiyaya icazə verin');
        return;
      }
      const title = subcat ? `${category!.label} — ${subcat.label}` : category!.label;
      const { data, error } = await supabase
        .from('opportunities')
        .insert({
          title,
          description: note,
          created_by: userId,
          date: new Date().toISOString().substring(0, 10),
          location: locationStr,
          category_id: category!.id,
          subcategory_id: subcat?.id ?? null,
          status: 'pending',
          budget: answers.budget ? Number(answers.budget) : null,
          extra_answers: JSON.stringify(answers),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      setOppId(data!.id as string);
      setOffers([]);
      setPhase('searching');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Təklifləri canlı izlə ────────────────────────────────────────────────
  const loadOffers = useCallback(async (opportunityId: string) => {
    const { data: rows } = await supabase
      .from('opportunities_offers')
      .select('id, provider_id, brigade_id, offer_amount, status, created_at')
      .eq('opportunity_id', opportunityId)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: true });
    const base = (rows ?? []) as Array<Omit<LiveOffer, 'provider' | 'brigade'>>;
    if (base.length === 0) {
      setOffers([]);
      return;
    }
    const provIds = Array.from(new Set(base.map((o) => o.provider_id)));
    const brigIds = Array.from(new Set(base.map((o) => o.brigade_id).filter(Boolean))) as string[];
    const [pResp, bResp] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, avatar_url, rating, latitude, longitude')
        .in('id', provIds),
      brigIds.length > 0
        ? supabase.from('brigades').select('id, name, logo_url').in('id', brigIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string; logo_url: string | null }> }),
    ]);
    const pMap: Record<string, LiveOffer['provider']> = {};
    for (const p of (pResp.data ?? []) as Array<Record<string, unknown>>) {
      pMap[String(p.id)] = {
        id: String(p.id),
        name: (p.name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
        rating: p.rating != null ? Number(p.rating) : null,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
      };
    }
    const bMap: Record<string, LiveOffer['brigade']> = {};
    for (const b of (bResp.data ?? []) as Array<{ id: string; name: string; logo_url: string | null }>) {
      bMap[b.id] = b;
    }
    const enriched: LiveOffer[] = base.map((o) => ({
      ...o,
      provider: pMap[o.provider_id] ?? null,
      brigade: o.brigade_id ? (bMap[o.brigade_id] ?? null) : null,
    }));
    if (enriched.length > offersRef.current.length) {
      message.success('Yeni təklif gəldi!');
    }
    setOffers(enriched);
  }, []);

  useEffect(() => {
    if (!oppId || phase !== 'searching') return;
    void loadOffers(oppId);
    const iv = setInterval(() => void loadOffers(oppId), 8000);
    const ch = supabase
      .channel(`order-map-offers-${oppId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities_offers',
          filter: `opportunity_id=eq.${oppId}`,
        },
        () => void loadOffers(oppId),
      )
      .subscribe();
    return () => {
      clearInterval(iv);
      void supabase.removeChannel(ch);
    };
  }, [oppId, phase, loadOffers]);

  // Aktiv təklifin usta koordinatı (marşrut xətti üçün)
  const routeEnd: [number, number] | null = useMemo(() => {
    if (!activeOffer?.provider?.latitude || !activeOffer?.provider?.longitude) return null;
    return [activeOffer.provider.latitude, activeOffer.provider.longitude];
  }, [activeOffer]);

  const resetFlow = () => {
    setPhase('category');
    setCategory(null);
    setSubcat(null);
    setQuestions([]);
    setAnswers({});
    setNote('');
    setOppId(null);
    setOffers([]);
    setActiveOffer(null);
  };

  const q = questions[qIdx];

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-[calc(100dvh-64px)] w-full overflow-hidden">
      <style>{`@keyframes omPulse{0%{transform:scale(.5);opacity:.9}100%{transform:scale(2.2);opacity:0}}`}</style>

      {/* Xəritə */}
      <MapContainer
        center={myPos ?? BAKU}
        zoom={15}
        className="absolute inset-0 z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FlyTo center={flyTarget} />
        {myPos && (
          <>
            <Marker
              position={myPos}
              icon={userIcon()}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  setMyPos([ll.lat, ll.lng]);
                },
              }}
            />
            <Circle
              center={myPos}
              radius={radius}
              pathOptions={{ color: '#2563EB', weight: 1.5, fillOpacity: 0.07 }}
            />
          </>
        )}
        {nearby.map((p) => (
          <Marker
            key={p.id}
            position={[p.latitude, p.longitude]}
            icon={providerIcon(p, activeOffer?.provider_id === p.id)}
          />
        ))}
        {phase === 'searching' && myPos && routeEnd && (
          <>
            <Polyline
              positions={[myPos, routeEnd]}
              pathOptions={{ color: '#1D4ED8', weight: 4, dashArray: '10 8', opacity: 0.85 }}
            />
            <FitRoute a={myPos} b={routeEnd} />
          </>
        )}
      </MapContainer>

      {/* Üst panel: radius + onlayn sayı */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between gap-2 pointer-events-none">
        <div className="flex gap-1.5 flex-wrap pointer-events-auto">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRadius(r.value)}
              className={`h-9 px-3 rounded-full text-xs font-bold shadow-card transition-colors ${
                radius === r.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-ink hover:bg-brand-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex flex-col gap-2 items-end">
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white shadow-card text-xs font-bold text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {nearby.length} usta onlayn
          </span>
          <button
            type="button"
            onClick={() => myPos && setFlyTarget([...myPos])}
            className="w-9 h-9 rounded-full bg-white shadow-card flex items-center justify-center text-brand-700 hover:bg-brand-50"
            title="Mənim yerim"
          >
            <Crosshair size={16} />
          </button>
        </div>
      </div>

      {geoDenied && !myPos && (
        <div className="absolute top-16 left-3 right-3 z-10 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium rounded-xl px-3 py-2">
          Lokasiyaya icazə verilmədi — xəritədə bütün onlayn ustalar göstərilir.
          Sifariş verəndə ünvanı əl ilə yazacaqsınız.
        </div>
      )}

      {/* Alt vərəq (bottom sheet) */}
      <div
        className={`absolute left-0 right-0 bottom-0 z-20 bg-white rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,.18)] transition-transform ${
          sheetOpen ? '' : 'translate-y-[calc(100%-56px)]'
        }`}
      >
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          className="w-full pt-2.5 pb-1 flex justify-center"
        >
          <span className="w-12 h-1.5 rounded-full bg-border" />
        </button>

        <div className="max-h-[62dvh] overflow-y-auto px-4 pb-5 [scrollbar-width:thin]">
          {/* ── Faza: kateqoriya ── */}
          {phase === 'category' && (
            <>
              <h1 className="text-lg font-extrabold text-ink mb-0.5">
                Hansı xidmət lazımdır?
              </h1>
              <p className="text-xs text-muted mb-3">
                Kateqoriyanı seçin — usta çağırışı bir dəqiqə çəkir.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void pickCategory(c)}
                    className="h-14 px-3 rounded-2xl bg-surface-bg hover:bg-brand-50 text-left text-sm font-bold text-ink transition-colors flex items-center gap-2"
                  >
                    <Search size={15} className="text-brand-600 shrink-0" />
                    <span className="line-clamp-2">{c.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Faza: alt-kateqoriya ── */}
          {phase === 'subcategory' && category && (
            <>
              <SheetHeader
                title={category.label}
                subtitle="Dəqiq xidməti seçin"
                onBack={resetFlow}
              />
              <div className="space-y-2">
                {subcats.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSubcat(s);
                      void loadQuestions(category.id, s.id);
                    }}
                    className="w-full h-12 px-4 rounded-2xl bg-surface-bg hover:bg-brand-50 text-left text-sm font-bold text-ink transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Faza: suallar (bir-bir, Uber-üslub) ── */}
          {phase === 'questions' && q && (
            <>
              <SheetHeader
                title={q.question || q.label || q.name}
                subtitle={`Sual ${qIdx + 1} / ${questions.length}`}
                onBack={() =>
                  qIdx > 0 ? setQIdx(qIdx - 1) : setPhase(subcats.length ? 'subcategory' : 'category')
                }
              />
              <div className="h-1.5 rounded-full bg-surface-bg mb-4 overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all"
                  style={{ width: `${((qIdx + 1) / questions.length) * 100}%` }}
                />
              </div>
              <QuestionField
                q={q}
                value={answers[q.name] ?? ''}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.name]: v }))}
              />
              <Button
                variant="primary"
                size="lg"
                className="w-full mt-4"
                disabled={q.required !== false && !(answers[q.name] ?? '').trim()}
                onClick={() =>
                  qIdx < questions.length - 1 ? setQIdx(qIdx + 1) : setPhase('confirm')
                }
              >
                {qIdx < questions.length - 1 ? 'Növbəti' : 'Davam et'}
              </Button>
            </>
          )}

          {/* ── Faza: təsdiq ── */}
          {phase === 'confirm' && category && (
            <>
              <SheetHeader
                title="Sifarişi təsdiqlə"
                subtitle={subcat ? `${category.label} — ${subcat.label}` : category.label}
                onBack={() =>
                  questions.length > 0
                    ? setPhase('questions')
                    : subcats.length
                      ? setPhase('subcategory')
                      : setPhase('category')
                }
              />
              {!myPos && (
                <label className="block mb-3">
                  <span className="text-xs font-bold text-muted">Ünvan</span>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Məs: Nizami küç. 12, Bakı"
                    className="mt-1 w-full h-12 rounded-2xl border border-border px-4 text-sm"
                  />
                </label>
              )}
              {myPos && (
                <p className="mb-3 text-xs text-muted inline-flex items-center gap-1">
                  <MapPin size={12} className="text-brand-600" />
                  Lokasiyanız xəritədəki mavi nöqtədir (markeri sürüşdürüb dəqiqləşdirə bilərsiniz).
                </p>
              )}
              <label className="block mb-4">
                <span className="text-xs font-bold text-muted">Qeyd (istəyə bağlı)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Problemi qısa təsvir edin…"
                  className="mt-1 w-full rounded-2xl border border-border px-4 py-3 text-sm resize-none"
                />
              </label>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={submitting}
                onClick={() => void submitOrder()}
              >
                Usta çağır
              </Button>
              <p className="mt-2 text-center text-[11px] text-muted">
                Sifariş bütün uyğun onlayn ustalara göndərilir — məsafədən asılı olmayaraq
                istənilən usta təklif verə bilər.
              </p>
            </>
          )}

          {/* ── Faza: axtarış + təkliflər ── */}
          {phase === 'searching' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-extrabold text-ink">
                  {offers.length === 0 ? 'Ustalar axtarılır…' : 'Təkliflər'}
                </h2>
                <button
                  type="button"
                  onClick={resetFlow}
                  className="w-8 h-8 rounded-full bg-surface-bg flex items-center justify-center text-muted hover:text-ink"
                  title="Ləğv et / yeni sifariş"
                >
                  <X size={15} />
                </button>
              </div>
              {offers.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-center">
                  <span className="relative flex w-16 h-16 mb-3">
                    <span className="absolute inset-0 rounded-full bg-brand-100 animate-ping" />
                    <span className="relative w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center">
                      <Search size={24} className="text-brand-600" />
                    </span>
                  </span>
                  <p className="text-sm font-bold text-ink">Onlayn ustalara bildiriş getdi</p>
                  <p className="text-xs text-muted mt-1">
                    Təkliflər gəldikcə burada canlı görünəcək.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {offers.map((o) => (
                    <OfferCard
                      key={o.id}
                      offer={o}
                      active={activeOffer?.id === o.id}
                      onSelect={() => setActiveOffer(o)}
                      onAccept={() => setAcceptOffer(o)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Faza: qəbul edildi ── */}
          {phase === 'accepted' && (
            <div className="py-6 flex flex-col items-center text-center">
              <CheckCircle2 size={48} className="text-emerald-500 mb-3" />
              <h2 className="text-lg font-extrabold text-ink">Sifariş başladı! 🎉</h2>
              <p className="text-sm text-muted mt-1 mb-4">
                Usta təsdiqləndi. Gedişatı “Sifarişlərim” bölməsindən izləyin.
              </p>
              <div className="flex gap-2">
                <Link to="/my-opportunities">
                  <Button variant="primary">Sifarişlərim</Button>
                </Link>
                <Button variant="ghost" onClick={resetFlow}>
                  Yeni sifariş
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {acceptOffer && (
        <AcceptOfferModal
          offerId={acceptOffer.id}
          amount={Number(acceptOffer.offer_amount ?? 0)}
          providerName={acceptOffer.provider?.name ?? undefined}
          onClose={() => setAcceptOffer(null)}
          onSuccess={() => {
            setAcceptOffer(null);
            setPhase('accepted');
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Alt komponentlər
// ────────────────────────────────────────────────────────────────────────────

function SheetHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <button
        type="button"
        onClick={onBack}
        className="w-9 h-9 rounded-full bg-surface-bg flex items-center justify-center text-ink hover:bg-border shrink-0"
      >
        <ChevronLeft size={17} />
      </button>
      <div className="min-w-0">
        <h2 className="text-base font-extrabold text-ink leading-tight line-clamp-2">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  if (q.type === 'select') {
    const opts = parseOptions(q.options);
    return (
      <div className="space-y-2">
        {opts.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`w-full h-12 px-4 rounded-2xl text-left text-sm font-bold transition-colors ${
              value === o
                ? 'bg-brand-600 text-white'
                : 'bg-surface-bg text-ink hover:bg-brand-50'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-2xl border border-border px-4 py-3 text-sm resize-none"
        placeholder="Cavabınızı yazın…"
      />
    );
  }
  return (
    <input
      type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : q.type === 'tel' ? 'tel' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-12 rounded-2xl border border-border px-4 text-sm"
      placeholder="Cavabınızı yazın…"
    />
  );
}

function OfferCard({
  offer,
  active,
  onSelect,
  onAccept,
}: {
  offer: LiveOffer;
  active: boolean;
  onSelect: () => void;
  onAccept: () => void;
}) {
  const p = offer.provider;
  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border p-3 cursor-pointer transition-colors ${
        active ? 'border-brand-600 bg-brand-50/50' : 'border-border bg-white hover:border-brand-300'
      }`}
    >
      <div className="flex items-center gap-3">
        {p?.avatar_url ? (
          <img
            src={p.avatar_url}
            alt=""
            className="w-11 h-11 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 font-extrabold shrink-0">
            {(p?.name || 'U').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-ink text-sm">{p?.name || 'Usta'}</span>
            {p?.rating != null && p.rating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600">
                <Star size={11} fill="currentColor" /> {p.rating.toFixed(1)}
              </span>
            )}
          </div>
          {offer.brigade && (
            <Link
              to={`/brigades/${offer.brigade.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:underline"
            >
              <Building2 size={11} /> {offer.brigade.name} komandası
            </Link>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-extrabold text-ink">
            {offer.offer_amount != null ? `${offer.offer_amount} ₼` : '—'}
          </div>
        </div>
      </div>

      {active && (
        <div className="mt-3 pt-3 border-t border-border/70 flex items-center gap-2">
          <Link
            to={`/provider/${offer.provider_id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-10 rounded-xl bg-surface-bg hover:bg-border text-ink text-xs font-bold flex items-center justify-center gap-1.5"
          >
            <Users size={13} /> Ustanın profili
          </Link>
          {offer.brigade && (
            <Link
              to={`/brigades/${offer.brigade.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 h-10 rounded-xl bg-surface-bg hover:bg-border text-ink text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Building2 size={13} /> Komanda
            </Link>
          )}
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onAccept();
            }}
          >
            Qəbul et
          </Button>
        </div>
      )}
    </div>
  );
}
