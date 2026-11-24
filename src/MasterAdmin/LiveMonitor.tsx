import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Flame,
  Globe,
  Hammer,
  LogIn,
  MousePointerClick,
  Pause,
  Play,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from './AdminLayout';

/**
 * Canlı monitor — hazırda platformada nə baş verir:
 *  - onlayn ustalar (boş / işdə), tətbiqdə olan müştərilər və ustalar;
 *  - xəritə: ustalar, usta gözləyən sifarişlər və Uber-sayağı tələb/təklif
 *    əmsalı zonaları (altıbucaqlı);
 *  - canlı axın: istifadəçilər nə edir (sifariş, təklif, baxış, giriş …).
 * Məlumat: admin_live_overview (10 san.) və admin_live_feed (3 san.) RPC-ləri.
 */

interface Counts {
  providers_online: number;
  providers_free: number;
  providers_busy: number;
  providers_bots: number;
  in_app_total: number;
  customers_in_app: number;
  providers_in_app: number;
  admins_in_app: number;
  mobile_in_app: number;
  web_in_app: number;
  active_15m: number;
  active_today: number;
  orders_today: number;
  orders_1h: number;
  offers_today: number;
  jobs_active: number;
  pending_review: number;
  completed_today: number;
  signups_today: number;
  orders_waiting: number;
}

interface ProviderPoint {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  bot: boolean;
  busy: boolean;
  in_app: boolean;
  last_seen_at: string | null;
  categories: string[];
}

interface OrderPoint {
  id: string;
  title: string;
  status: string;
  location: string | null;
  lat: number;
  lng: number;
  offers: number;
  created_at: string | null;
  category: string | null;
}

interface Zone {
  id: string;
  center: [number, number];
  polygon: [number, number][];
  demand: number;
  supply: number;
  new_1h: number;
  coefficient: number;
}

interface OnlineUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  client: string;
  platform: string | null;
  activity: string | null;
  activity_at: number | null;
  seen: number;
}

interface Overview {
  generated_at: number;
  cell_km: number;
  counts: Counts;
  city: { demand: number; supply: number; coefficient: number };
  presence_unavailable: boolean;
  providers: ProviderPoint[];
  orders: OrderPoint[];
  zones: Zone[];
  users: OnlineUser[];
}

interface FeedItem {
  id: string;
  t: number;
  kind: 'action' | 'view' | 'fail' | 'error' | 'online';
  user: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  client: string | null;
  label: string;
  status: number | null;
  ms: number | null;
  path: string | null;
}

type FeedFilter = 'all' | 'action' | 'view' | 'fail' | 'online';

const BAKU: [number, number] = [40.4093, 49.8671];
const OVERVIEW_MS = 10_000;
const FEED_MS = 3_000;
const FEED_KEEP = 300;

const ROLE_LABEL: Record<string, string> = {
  customer: 'Müştəri',
  provider: 'Usta',
  admin: 'Admin',
  master: 'Admin',
  superadmin: 'Admin',
};
const ROLE_CLS: Record<string, string> = {
  customer: 'bg-brand-50 text-brand-700',
  provider: 'bg-emerald-50 text-emerald-700',
  admin: 'bg-violet-50 text-violet-700',
  master: 'bg-violet-50 text-violet-700',
  superadmin: 'bg-violet-50 text-violet-700',
};

const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'Hamısı' },
  { value: 'action', label: 'Əməliyyatlar' },
  { value: 'view', label: 'Baxışlar' },
  { value: 'online', label: 'Giriş / tətbiqi açma' },
  { value: 'fail', label: 'Uğursuz' },
];

const CELL_OPTIONS = [1, 2, 5];

/** Əmsal rəngi: yaşıl (kifayət) → sarı → narıncı → qırmızı (usta çatmır). */
function coefColor(coef: number, demand = 1): string {
  if (demand <= 0) return '#3B82F6';
  if (coef < 1.1) return '#16A34A';
  if (coef < 1.5) return '#EAB308';
  if (coef < 2.0) return '#F97316';
  if (coef < 2.5) return '#EF4444';
  return '#B91C1C';
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
function ago(sec: number | null | undefined, now: number): string {
  if (!sec) return '—';
  const s = Math.max(0, Math.round(now - sec));
  if (s < 10) return 'indicə';
  if (s < 60) return `${s} san əvvəl`;
  if (s < 3600) return `${Math.floor(s / 60)} dəq əvvəl`;
  if (s < 86400) return `${Math.floor(s / 3600)} saat əvvəl`;
  return `${Math.floor(s / 86400)} gün əvvəl`;
}
const isoSec = (iso: string | null) => (iso ? new Date(iso).getTime() / 1000 : null);
const personName = (name: string | null, email: string | null, id: string | null) =>
  name || email || (id ? `ID ${id.slice(0, 8)}` : 'Qonaq');

function zoneLabelIcon(coef: number, demand: number): L.DivIcon {
  const bg = coefColor(coef, demand);
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);background:${bg};color:#fff;
      font-weight:800;font-size:11px;line-height:1;padding:4px 7px;border-radius:999px;
      box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;">x${coef.toFixed(1)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const orderIcon = L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-50%);width:14px;height:14px;border-radius:4px;
    background:#0A0F1E;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

function FitOnce({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === fitKey || points.length === 0) return;
    done.current = fitKey;
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 13 });
  }, [fitKey, points, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 13), { duration: 0.7 });
  }, [target, map]);
  return null;
}

export default function LiveMonitor() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cellKm, setCellKm] = useState(2);
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [layers, setLayers] = useState({ providers: true, orders: true, zones: true, bots: false });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const lastId = useRef<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    supabase
      .from('service_categories')
      .select('id,label')
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCategories((data as { id: string; label: string }[]) ?? []));
  }, []);

  const loadOverview = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_live_overview', {
      p_cell_km: cellKm,
      p_category_id: category || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setOv(data as Overview);
  }, [cellKm, category]);

  const loadFeed = useCallback(async () => {
    if (pausedRef.current) return;
    const { data, error: err } = await supabase.rpc('admin_live_feed', {
      p_after: lastId.current,
      p_limit: lastId.current ? 200 : 120,
    });
    if (err || !data) return;
    const res = data as { items: FeedItem[]; last_id: string | null };
    if (res.items.length === 0) return;
    const first = lastId.current === null;
    lastId.current = res.last_id;
    setFeed((prev) => [...res.items, ...prev].slice(0, FEED_KEEP));
    if (!first) {
      const ids = new Set(res.items.map((i) => i.id));
      setFresh(ids);
      window.setTimeout(() => setFresh(new Set()), 2500);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadOverview();
    }, OVERVIEW_MS);
    return () => window.clearInterval(t);
  }, [loadOverview]);

  useEffect(() => {
    loadFeed();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadFeed();
    }, FEED_MS);
    return () => window.clearInterval(t);
  }, [loadFeed]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => window.clearInterval(t);
  }, []);

  const c = ov?.counts;
  const providers = useMemo(
    () => (ov?.providers ?? []).filter((p) => layers.bots || !p.bot),
    [ov, layers.bots],
  );
  const fitPoints = useMemo<[number, number][]>(
    () => [
      ...(ov?.providers ?? []).filter((p) => !p.bot).map((p) => [p.lat, p.lng] as [number, number]),
      ...(ov?.orders ?? []).map((o) => [o.lat, o.lng] as [number, number]),
    ],
    [ov],
  );
  const hotZones = useMemo(
    () => (ov?.zones ?? []).filter((z) => z.demand > 0).slice(0, 8),
    [ov],
  );
  const visibleFeed = useMemo(
    () =>
      feed.filter((i) =>
        feedFilter === 'all'
          ? true
          : feedFilter === 'fail'
            ? i.kind === 'fail' || i.kind === 'error'
            : i.kind === feedFilter,
      ),
    [feed, feedFilter],
  );

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all border ${
      active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-ink-soft border-border hover:border-brand-300'
    }`;

  const cityCoef = ov?.city.coefficient ?? 1;

  return (
    <AdminLayout
      title="Canlı monitor"
      subtitle={
        ov
          ? `Yenilənib: ${clock(ov.generated_at)} · ustalar və sifarişlər hər 10 san., axın hər 3 san.`
          : 'Yüklənir…'
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger font-bold">
          Məlumat alınmadı: {error}
        </div>
      )}
      {ov?.presence_unavailable && (
        <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning font-bold">
          Redis əlçatmazdır — "tətbiqdə indi" sayları müvəqqəti göstərilmir.
        </div>
      )}

      {/* ─── Göstəricilər ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Tile
          label="Onlayn ustalar"
          value={c?.providers_online}
          icon={<Hammer size={18} />}
          tint="emerald"
          sub={
            c
              ? `${c.providers_free} boş · ${c.providers_busy} işdə${
                  c.providers_bots ? ` · ${c.providers_bots} bot` : ''
                }`
              : ''
          }
          live
        />
        <Tile
          label="Tətbiqdə indi"
          value={c?.in_app_total}
          icon={<Users size={18} />}
          tint="brand"
          sub={c ? `${c.customers_in_app} müştəri · ${c.providers_in_app} usta` : ''}
          live
        />
        <Tile
          label="Mobil / veb"
          value={c ? `${c.mobile_in_app} / ${c.web_in_app}` : undefined}
          icon={<Smartphone size={18} />}
          tint="cyan"
          sub={c ? `Son 15 dəq: ${c.active_15m} · bu gün: ${c.active_today}` : ''}
        />
        <Tile
          label="Usta gözləyən sifariş"
          value={c?.orders_waiting}
          icon={<ClipboardList size={18} />}
          tint="amber"
          sub={c ? `Son 1 saatda ${c.orders_1h} yeni · ${c.jobs_active} işdə` : ''}
        />
        <div className="bg-white rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-muted uppercase tracking-wide">Ümumi əmsal</p>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-50 text-rose-600">
              <Flame size={18} />
            </div>
          </div>
          <p
            className="mt-2 text-2xl font-extrabold"
            style={{ color: ov ? coefColor(cityCoef, ov.city.demand) : undefined }}
          >
            {ov ? `x${cityCoef.toFixed(1)}` : '—'}
          </p>
          <p className="text-xs text-muted mt-1">
            {ov ? `${ov.city.demand} sifariş / ${ov.city.supply} boş usta` : ''}
          </p>
        </div>
        <Tile
          label="Bu gün"
          value={c ? `${c.orders_today} sifariş` : undefined}
          icon={<Zap size={18} />}
          tint="violet"
          sub={
            c
              ? `${c.offers_today} təklif · ${c.completed_today} tamamlandı · ${c.signups_today} qeydiyyat`
              : ''
          }
        />
      </div>
      {c && c.pending_review > 0 && (
        <Link
          to="/Administrator/job-completions"
          className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100"
        >
          <AlertTriangle size={16} /> {c.pending_review} iş admin təsdiqini gözləyir →
        </Link>
      )}

      {/* ─── Xəritə + tətbiqdə olanlar ─────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-border overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
            <LayerToggle
              on={layers.providers}
              onClick={() => setLayers((l) => ({ ...l, providers: !l.providers }))}
              dot="#16A34A"
              label="Ustalar"
            />
            <LayerToggle
              on={layers.orders}
              onClick={() => setLayers((l) => ({ ...l, orders: !l.orders }))}
              dot="#0A0F1E"
              label="Sifarişlər"
            />
            <LayerToggle
              on={layers.zones}
              onClick={() => setLayers((l) => ({ ...l, zones: !l.zones }))}
              dot="#EF4444"
              label="Əmsal zonaları"
            />
            <LayerToggle
              on={layers.bots}
              onClick={() => setLayers((l) => ({ ...l, bots: !l.bots }))}
              dot="#9CA3AF"
              label="Botlar"
            />
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-muted font-bold">Zona:</span>
              {CELL_OPTIONS.map((km) => (
                <button key={km} className={chip(cellKm === km)} onClick={() => setCellKm(km)}>
                  {km} km
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-xl border border-border bg-white px-2 text-sm font-bold text-ink-soft"
            >
              <option value="">Bütün kateqoriyalar</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          <div className="relative isolate h-[440px] sm:h-[540px]">
            <MapContainer center={BAKU} zoom={11} className="h-full w-full" scrollWheelZoom>
              <TileLayer
                attribution="&copy; OpenStreetMap"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitOnce points={fitPoints} fitKey={category || 'all'} />
              <FlyTo target={flyTarget} />
              {layers.zones &&
                (ov?.zones ?? []).map((z) => {
                  const color = coefColor(z.coefficient, z.demand);
                  return (
                    <Polygon
                      key={`z-${z.id}`}
                      positions={z.polygon}
                      pathOptions={{
                        color,
                        weight: 1,
                        fillColor: color,
                        fillOpacity: z.demand > 0 ? 0.28 : 0.08,
                      }}
                    >
                      <Tooltip sticky>
                        <b>x{z.coefficient.toFixed(1)}</b> · {z.demand} sifariş / {z.supply} boş usta
                        {z.new_1h ? ` · son 1 saatda ${z.new_1h} yeni` : ''}
                      </Tooltip>
                    </Polygon>
                  );
                })}
              {layers.zones &&
                (ov?.zones ?? [])
                  .filter((z) => z.demand > 0)
                  .map((z) => (
                    <Marker
                      key={`zl-${z.id}`}
                      position={z.center}
                      icon={zoneLabelIcon(z.coefficient, z.demand)}
                      interactive={false}
                    />
                  ))}
              {layers.orders &&
                (ov?.orders ?? []).map((o) => (
                  <Marker key={`o-${o.id}`} position={[o.lat, o.lng]} icon={orderIcon}>
                    <Popup>
                      <div className="text-sm">
                        <p className="font-extrabold">{o.title}</p>
                        <p className="text-muted">{o.category ?? 'Kateqoriyasız'}</p>
                        {o.location && <p>{o.location}</p>}
                        <p>
                          {o.offers} təklif · {ago(isoSec(o.created_at), now)}
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              {layers.providers &&
                providers.map((p) => (
                  <CircleMarker
                    key={`p-${p.id}`}
                    center={[p.lat, p.lng]}
                    radius={p.in_app ? 9 : 7}
                    pathOptions={{
                      color: p.in_app ? '#1D4ED8' : '#fff',
                      weight: p.in_app ? 3 : 2,
                      fillColor: p.bot ? '#9CA3AF' : p.busy ? '#F97316' : '#16A34A',
                      fillOpacity: 0.95,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-extrabold">{p.name || 'Usta'}</p>
                        <p>
                          {p.bot ? 'Bot' : p.busy ? 'Hazırda işdə' : 'Boş, sifariş gözləyir'}
                          {p.in_app ? ' · tətbiq açıqdır' : ''}
                        </p>
                        {p.categories.length > 0 && (
                          <p className="text-muted">{p.categories.join(', ')}</p>
                        )}
                        <p className="text-muted">
                          Son yer: {ago(isoSec(p.last_seen_at), now)}
                        </p>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
            </MapContainer>
            <div className="absolute left-3 bottom-3 z-[500] rounded-xl bg-white/95 border border-border px-3 py-2 text-[11px] font-bold text-ink-soft shadow-sm space-y-1">
              <div className="flex items-center gap-3">
                <Legend color="#16A34A" label="Boş usta" round />
                <Legend color="#F97316" label="İşdə" round />
                <Legend color="#0A0F1E" label="Sifariş" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted mr-1">Əmsal:</span>
                {[
                  ['#16A34A', 'x1'],
                  ['#EAB308', 'x1.1+'],
                  ['#F97316', 'x1.5+'],
                  ['#EF4444', 'x2+'],
                  ['#B91C1C', 'x2.5+'],
                ].map(([col, l]) => (
                  <span
                    key={l}
                    className="px-1.5 py-0.5 rounded text-white"
                    style={{ background: col }}
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tətbiqdə indi */}
        <div className="bg-white rounded-2xl border border-border flex flex-col min-h-[300px] xl:max-h-[600px]">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <p className="font-extrabold text-ink flex items-center gap-2">
                <LiveDot /> Tətbiqdə indi
              </p>
              <p className="text-xs text-muted">Son 2 dəqiqədə görünənlər</p>
            </div>
            <span className="text-2xl font-extrabold text-ink">{c?.in_app_total ?? '—'}</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {(ov?.users ?? []).length === 0 && (
              <p className="p-6 text-sm text-muted text-center">Hazırda heç kim yoxdur</p>
            )}
            {(ov?.users ?? []).map((u) => (
              <div key={u.id} className="flex items-start gap-3 px-4 py-3">
                <ClientIcon client={u.client} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-bold text-sm text-ink truncate">
                      {personName(u.name, u.email, u.id)}
                    </p>
                    <RoleChip role={u.role} />
                  </div>
                  <p className="text-xs text-ink-soft truncate">
                    {u.activity ?? 'Tətbiqdədir'}
                    {u.activity_at ? ` · ${ago(u.activity_at, now)}` : ''}
                  </p>
                  <p className="text-[11px] text-muted">
                    {u.client === 'mobile'
                      ? `Mobil${u.platform ? ` (${u.platform === 'ios' ? 'iOS' : u.platform === 'android' ? 'Android' : u.platform})` : ''}`
                      : u.client === 'web'
                        ? 'Veb sayt'
                        : 'Digər'}{' '}
                    · {ago(u.seen, now)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Canlı axın + isti zonalar ─────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-border flex flex-col">
          <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
            <p className="font-extrabold text-ink flex items-center gap-2 mr-2">
              <LiveDot paused={paused} /> Canlı axın
            </p>
            {FEED_FILTERS.map((f) => (
              <button
                key={f.value}
                className={chip(feedFilter === f.value)}
                onClick={() => setFeedFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <button
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-sm font-bold text-ink-soft hover:border-brand-300"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? 'Davam et' : 'Dayandır'}
            </button>
          </div>
          <div className="max-h-[560px] overflow-y-auto divide-y divide-border">
            {visibleFeed.length === 0 && (
              <p className="p-6 text-sm text-muted text-center">Hələ hadisə yoxdur</p>
            )}
            {visibleFeed.map((i) => (
              <div
                key={i.id}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-700 ${
                  fresh.has(i.id) ? 'bg-brand-50' : ''
                }`}
              >
                <span className="font-mono text-[11px] text-muted w-14 shrink-0">{clock(i.t)}</span>
                <KindIcon kind={i.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink break-words sm:truncate">
                    <span className="font-bold">{personName(i.name, i.email, i.user)}</span>{' '}
                    <span className={i.kind === 'fail' || i.kind === 'error' ? 'text-danger' : ''}>
                      {i.kind === 'fail' || i.kind === 'error'
                        ? `${i.label} — alınmadı (${i.status})`
                        : i.label}
                    </span>
                  </p>
                </div>
                <RoleChip role={i.role} />
                {i.client && (
                  <span className="text-muted shrink-0 hidden sm:inline">
                    {i.client === 'mobile' ? <Smartphone size={14} /> : i.client === 'web' ? <Globe size={14} /> : null}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border">
          <div className="p-4 border-b border-border">
            <p className="font-extrabold text-ink flex items-center gap-2">
              <Flame size={16} className="text-rose-500" /> Ən yüksək əmsallı zonalar
            </p>
            <p className="text-xs text-muted">
              Əmsal = gözləyən sifariş / boş usta (x1.0 – x3.0). Kliklə xəritədə göstər.
            </p>
          </div>
          <div className="divide-y divide-border">
            {hotZones.length === 0 && (
              <p className="p-6 text-sm text-muted text-center">Usta gözləyən sifariş yoxdur</p>
            )}
            {hotZones.map((z, idx) => (
              <button
                key={z.id}
                onClick={() => setFlyTarget([...z.center] as [number, number])}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-alt"
              >
                <span className="text-xs font-bold text-muted w-4">{idx + 1}</span>
                <span
                  className="px-2 py-1 rounded-lg text-white text-sm font-extrabold"
                  style={{ background: coefColor(z.coefficient, z.demand) }}
                >
                  x{z.coefficient.toFixed(1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">
                    {z.demand} sifariş / {z.supply} boş usta
                  </p>
                  <p className="text-xs text-muted">
                    {z.supply === 0
                      ? 'Yaxında boş usta yoxdur'
                      : z.coefficient > 1
                        ? 'Usta çatışmır'
                        : 'Usta kifayətdir'}
                    {z.new_1h ? ` · son 1 saatda ${z.new_1h} yeni` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

// ── Kiçik komponentlər ─────────────────────────────────────────────
function Tile({
  label,
  value,
  sub,
  icon,
  tint,
  live,
}: {
  label: string;
  value: number | string | undefined;
  sub: string;
  icon: React.ReactNode;
  tint: 'brand' | 'emerald' | 'violet' | 'amber' | 'cyan';
  live?: boolean;
}) {
  const tints = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1.5">
          {live && <LiveDot />}
          {label}
        </p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tints[tint]}`}>
          {icon}
        </div>
      </div>
      <p className="mt-2 text-2xl font-extrabold text-ink">{value ?? '—'}</p>
      <p className="text-xs text-muted mt-1">{sub}</p>
    </div>
  );
}

function LiveDot({ paused }: { paused?: boolean }) {
  if (paused) return <span className="inline-block w-2 h-2 rounded-full bg-muted" />;
  return (
    <span className="relative inline-flex w-2 h-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
      <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function LayerToggle({
  on,
  onClick,
  dot,
  label,
}: {
  on: boolean;
  onClick: () => void;
  dot: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs sm:text-sm font-bold transition-all ${
        on ? 'border-brand-300 bg-brand-50 text-ink' : 'border-border bg-white text-muted'
      }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ background: on ? dot : '#D1D5DB' }}
      />
      {label}
    </button>
  );
}

function Legend({ color, label, round }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-block w-2.5 h-2.5 ${round ? 'rounded-full' : 'rounded-sm'}`}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function RoleChip({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span
      className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
        ROLE_CLS[role] ?? 'bg-surface-alt text-muted'
      }`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function ClientIcon({ client }: { client: string }) {
  return (
    <span className="mt-0.5 w-8 h-8 rounded-lg bg-surface-alt text-ink-soft flex items-center justify-center shrink-0">
      {client === 'mobile' ? <Smartphone size={15} /> : client === 'web' ? <Globe size={15} /> : <Activity size={15} />}
    </span>
  );
}

function KindIcon({ kind }: { kind: FeedItem['kind'] }) {
  const map = {
    action: { icon: <Zap size={14} />, cls: 'bg-brand-50 text-brand-600' },
    view: { icon: <MousePointerClick size={14} />, cls: 'bg-surface-alt text-muted' },
    online: { icon: <LogIn size={14} />, cls: 'bg-emerald-50 text-emerald-600' },
    fail: { icon: <AlertTriangle size={14} />, cls: 'bg-amber-50 text-amber-600' },
    error: { icon: <AlertTriangle size={14} />, cls: 'bg-danger/10 text-danger' },
  } as const;
  const m = map[kind] ?? map.action;
  return (
    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${m.cls}`}>
      {m.icon}
    </span>
  );
}
