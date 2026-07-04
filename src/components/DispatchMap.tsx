import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface OrderPoint {
  id: string;
  coords: [number, number];
  title: string;
  budget?: number | null;
}

export interface WorkerPoint {
  id: string;
  coords: [number, number];
  name: string;
  avatar?: string | null;
  online: boolean;
  lastSeen?: string | null;
}

const DEFAULT_CENTER: [number, number] = [40.4093, 49.8671]; // Bakı

/** Sifariş — büdcə bubble-ı (tünd) */
function orderIcon(budget: number | null | undefined, active: boolean): L.DivIcon {
  const label = budget != null ? `${budget} ₼` : 'Sifariş';
  const bg = active ? '#1D4ED8' : '#0A0F1E';
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-120%);white-space:nowrap;">
      <div style="background:${bg};color:#fff;font-weight:800;font-size:12px;line-height:1;
        padding:7px 10px;border-radius:9px;box-shadow:0 4px 10px rgba(0,0,0,.25);
        position:relative;">
        ${label}
        <span style="position:absolute;left:50%;top:100%;transform:translateX(-50%);
          width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
          border-top:6px solid ${bg};"></span>
      </div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** İşçi — avatar/inisial dairə, online halqası */
function workerIcon(w: WorkerPoint, active: boolean): L.DivIcon {
  const ring = w.online ? '#10B981' : '#9CA3AF';
  const size = active ? 44 : 38;
  const inner = w.avatar
    ? `<img src="${w.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : `<div style="width:100%;height:100%;border-radius:50%;background:#2563EB;color:#fff;
        display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">
        ${(w.name || '?').charAt(0).toUpperCase()}</div>`;
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);width:${size}px;height:${size}px;
      border-radius:50%;border:3px solid ${ring};box-shadow:0 3px 8px rgba(0,0,0,.3);
      overflow:hidden;background:#fff;">${inner}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FlyTo({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [center, map]);
  return null;
}

/**
 * Dispetçer canlı xəritəsi — sifarişlər (büdcə bubble) + işçilər (avatar, online
 * halqası). İşçi yeri profiles.latitude/longitude-dən gəlir, panel onu mütəmadi
 * yeniləyir → near real-time.
 */
export default function DispatchMap({
  orders,
  workers,
  activeOrderId,
  activeWorkerId,
  onSelectOrder,
  onSelectWorker,
  className,
}: {
  orders: OrderPoint[];
  workers: WorkerPoint[];
  activeOrderId?: string | null;
  activeWorkerId?: string | null;
  onSelectOrder?: (id: string) => void;
  onSelectWorker?: (id: string) => void;
  className?: string;
}) {
  const flyCenter =
    workers.find((w) => w.id === activeWorkerId)?.coords ??
    orders.find((o) => o.id === activeOrderId)?.coords ??
    null;

  const initialCenter =
    orders[0]?.coords ?? workers[0]?.coords ?? DEFAULT_CENTER;

  return (
    <div className={className ?? 'h-full w-full'}>
      <MapContainer
        center={initialCenter}
        zoom={12}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />

        {orders.map((o) => (
          <Marker
            key={`o-${o.id}`}
            position={o.coords}
            icon={orderIcon(o.budget, o.id === activeOrderId)}
            eventHandlers={{ click: () => onSelectOrder?.(o.id) }}
          >
            <Popup>
              <div className="text-sm font-bold">{o.title || 'Sifariş'}</div>
              {o.budget != null && <div className="text-xs">Büdcə: {o.budget} ₼</div>}
            </Popup>
          </Marker>
        ))}

        {workers.map((w) => (
          <Marker
            key={`w-${w.id}`}
            position={w.coords}
            icon={workerIcon(w, w.id === activeWorkerId)}
            eventHandlers={{ click: () => onSelectWorker?.(w.id) }}
          >
            <Popup>
              <div className="text-sm font-bold">{w.name || 'İşçi'}</div>
              <div className="text-xs">{w.online ? 'Online' : 'Offline'}</div>
            </Popup>
          </Marker>
        ))}

        <FlyTo center={flyCenter} />
      </MapContainer>
    </div>
  );
}
