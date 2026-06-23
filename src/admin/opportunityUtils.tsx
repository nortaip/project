import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type QLabels = Record<string, string>;

/**
 * `service_questions`-dan id→label VƏ name→label xəritəsi qurur.
 *
 * extra_answers açarları iki cür ola bilər:
 *   - mobil app: sual `id` (UUID)        → məs. "81d7f8ae-..."
 *   - web form:  sual `name` (slug)       → məs. "fuel_type"
 * Hər ikisini eyni xəritədə həll edirik ki, kartlarda UUID yox, sualın
 * mətni (label) görünsün.
 */
export function useQuestionLabels(): QLabels {
  const [map, setMap] = useState<QLabels>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('service_questions')
        .select('id,name,label');
      if (cancelled || !data) return;
      const m: QLabels = {};
      for (const r of data as { id: string; name: string | null; label: string | null }[]) {
        if (!r.label) continue;
        if (r.id) m[r.id] = r.label;
        if (r.name) m[r.name] = r.label;
      }
      setMap(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * extra_answers açarını oxunaqlı etiketə çevirir.
 * Tapılmayan UUID üçün `null` qaytarır → UI yalnız cavabı göstərsin (UUID yox).
 */
export function resolveExtraLabel(key: string, qmap: QLabels): string | null {
  if (qmap[key]) return qmap[key];
  if (UUID_RE.test(key)) return null;
  return key.replace(/_/g, ' ');
}

/** extra_answers JSON-unu [label|null, value] cütlərinə çevirir. */
export function parseExtras(
  raw: string | null | undefined,
  qmap: QLabels,
  limit?: number,
): { key: string; label: string | null; value: string }[] {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    const out = Object.entries(parsed)
      .filter(
        ([k, v]) =>
          v != null &&
          String(v).trim() &&
          k !== 'title' &&
          k !== 'description',
      )
      .map(([k, v]) => ({
        key: k,
        label: resolveExtraLabel(k, qmap),
        value: Array.isArray(v) ? v.join(', ') : String(v),
      }));
    return limit ? out.slice(0, limit) : out;
  } catch {
    return [];
  }
}

/** "lat, lng" mətnini koordinata çevirir; uyğun gəlmirsə null. */
export function parseCoords(
  loc: string | null | undefined,
): [number, number] | null {
  if (!loc) return null;
  const m = loc.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}
