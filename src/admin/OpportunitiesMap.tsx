import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  id: string;
  coords: [number, number];
  title: string;
  subtitle?: string;
}

const DEFAULT_CENTER: [number, number] = [40.4093, 49.8671]; // Bakı

function pinIcon(active: boolean): L.DivIcon {
  const size = active ? 40 : 30;
  const color = active ? '#1D4ED8' : '#2563EB';
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-100%);display:flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" stroke="white" stroke-width="1.5" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))">
        <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/>
        <circle cx="12" cy="9" r="2.6" fill="white" stroke="none"/>
      </svg></div>`,
    iconSize: [size, size],
    iconAnchor: [0, 0],
  });
}

function FlyTo({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [center, map]);
  return null;
}

/** Sorğuları canlı xəritədə göstərir (OpenStreetMap, açar tələb etmir). */
export default function OpportunitiesMap({
  points,
  activeId,
  onSelect,
  className,
}: {
  points: MapPoint[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const activeCoords = points.find((p) => p.id === activeId)?.coords ?? null;
  return (
    <div className={className ?? 'h-full w-full'}>
      <MapContainer
        center={points[0]?.coords ?? DEFAULT_CENTER}
        zoom={11}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />
        {points.map((p) => (
          <Marker
            key={p.id}
            position={p.coords}
            icon={pinIcon(p.id === activeId)}
            eventHandlers={{ click: () => onSelect?.(p.id) }}
          >
            <Popup>
              <div className="text-sm font-bold">{p.title || '—'}</div>
              {p.subtitle && <div className="text-xs">{p.subtitle}</div>}
            </Popup>
          </Marker>
        ))}
        <FlyTo center={activeCoords} />
      </MapContainer>
    </div>
  );
}
