/**
 * Təklif şərtləri üçün ortaq formatlama — qiymət vahidi ("15 ₼/m² × 40 m²")
 * və ustanın gəliş günü (Bakı vaxtı, UTC+4).
 *
 * Backend müqaviləsi:
 *   - service_categories.price_unit: 'fixed' | 'm2' | 'hour'
 *   - opportunities_offers.proposed_at: timestamptz; yalnız tarix seçilibsə
 *     Bakı vaxtı ilə 00:00 kimi saxlanır → ekranda yalnız tarix göstərilir
 *   - offer_amount həmişə ümumi məbləğdir (= unit_price × quantity)
 *
 * Bütün ekranlar (müştəri təklif siyahıları, usta təklifləri, admin) bu
 * modulu işlətməlidir ki, eyni təklif hər yerdə eyni cür görünsün.
 */
import i18n from '../i18n';
import { n } from './format';

export type PriceUnit = 'fixed' | 'm2' | 'hour';
export const PRICE_UNITS: PriceUnit[] = ['fixed', 'm2', 'hour'];

/** Gəliş günü bu gündən ən çox neçə gün sonra ola bilər (server də yoxlayır). */
export const MAX_SCHEDULE_DAYS = 90;

/** Azərbaycanda yay vaxtı yoxdur — Bakı həmişə UTC+4. */
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Təklif sətrinin şərtlərlə bağlı sahələri (bütün sorğu formaları üçün). */
export interface OfferTerms {
  offer_amount?: number | string | null;
  proposed_at?: string | null;
  price_unit?: string | null;
  unit_price?: number | string | null;
  quantity?: number | string | null;
  notes?: string | null;
}

export function normalizePriceUnit(v: unknown): PriceUnit {
  return v === 'm2' || v === 'hour' ? v : 'fixed';
}

// ── Rəqəm / qiymət ─────────────────────────────────────────────────

/** 15 → "15", 12.5 → "12.5", 12.345 → "12.35" (lazımsız sıfırlar atılır). */
export function fmtNum(v: unknown): string {
  return String(Math.round(n(v) * 100) / 100);
}

/** "120 ₼" / "12.5 ₼" */
export function fmtAzn(v: unknown): string {
  return `${fmtNum(v)} ₼`;
}

/** Vahidin adı: "Bütün iş üçün" / "Kvadrat metr başı" / "Saatlıq" */
export function priceUnitLabel(unit: unknown): string {
  return i18n.t(`offerTerms.unit.${normalizePriceUnit(unit)}`);
}

/** Vahid qiymətin şəkilçisi: "₼/m²", "₼/saat" (fixed üçün sadəcə "₼"). */
export function unitPriceSuffix(unit: unknown): string {
  const u = normalizePriceUnit(unit);
  return u === 'fixed' ? '₼' : i18n.t(`offerTerms.unitPrice.${u}`);
}

/** Miqdarın vahidi: "m²", "saat". */
export function quantityUnit(unit: unknown): string {
  const u = normalizePriceUnit(unit);
  return u === 'fixed' ? '' : i18n.t(`offerTerms.qty.${u}`);
}

/**
 * "15 ₼/m² × 40 m²" — yalnız m2/hour təkliflərində; sabit qiymətli (və ya
 * köhnə, vahidsiz) təkliflər üçün null.
 */
export function priceBreakdown(o: OfferTerms | null | undefined): string | null {
  if (!o) return null;
  const unit = normalizePriceUnit(o.price_unit);
  if (unit === 'fixed' || o.unit_price == null || o.quantity == null) return null;
  return `${fmtNum(o.unit_price)} ${unitPriceSuffix(unit)} × ${fmtNum(o.quantity)} ${quantityUnit(unit)}`;
}

/** Vahid qiymət × miqdar (2 onluğa yuvarlaqlaşdırılmış) — formada canlı "Cəmi". */
export function computeTotal(unitPrice: unknown, quantity: unknown): number {
  return Math.round(n(unitPrice) * n(quantity) * 100) / 100;
}

// ── Tarix (Bakı vaxtı) ─────────────────────────────────────────────

const pad = (x: number) => String(x).padStart(2, '0');

export function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Bakıda bu günün tarixi: "2026-11-17". */
export function bakuTodayYmd(now: Date = new Date()): string {
  const d = new Date(now.getTime() + BAKU_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2026-11-17" + 3 → "2026-11-20" */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Gəliş günü üçün icazəli aralıq: bu gün … +90 gün. */
export function scheduleBounds(): { min: string; max: string } {
  const min = bakuTodayYmd();
  return { min, max: addDaysYmd(min, MAX_SCHEDULE_DAYS) };
}

export function isYmdInSchedule(ymd: string): boolean {
  const { min, max } = scheduleBounds();
  return isYmd(ymd) && ymd >= min && ymd <= max;
}

/**
 * timestamptz → Bakı vaxtı ilə {ymd, hm, hasTime}. 00:00 "gün ərzində"
 * (dəqiq saatsız) sayılır.
 */
export function toBakuParts(
  iso: string | null | undefined,
): { ymd: string; hm: string; hasTime: boolean } | null {
  if (!iso) return null;
  if (isYmd(iso)) return { ymd: iso, hm: '', hasTime: false };
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + BAKU_OFFSET_MS);
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  return {
    ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hm: `${pad(h)}:${pad(mi)}`,
    hasTime: h !== 0 || mi !== 0,
  };
}

/**
 * place_bid / yeniləmə üçün dəyər: yalnız tarix → "2026-11-20" (RPC),
 * saat varsa → "2026-11-20T15:30:00+04:00".
 */
export function buildProposedAt(ymd: string, hm?: string | null): string {
  if (hm && /^\d{2}:\d{2}$/.test(hm) && hm !== '00:00') return `${ymd}T${hm}:00+04:00`;
  return ymd;
}

/**
 * Cədvələ birbaşa yazmaq üçün (PATCH proposed_at): həmişə tam timestamptz —
 * yalnız tarix seçilibsə Bakı vaxtı ilə 00:00.
 */
export function buildProposedAtTimestamp(ymd: string, hm?: string | null): string {
  const time = hm && /^\d{2}:\d{2}$/.test(hm) ? hm : '00:00';
  return `${ymd}T${time}:00+04:00`;
}

/** i18n dili → Intl locale. */
export function intlLocale(lang?: string): string {
  const l = (lang ?? i18n.language ?? 'az').slice(0, 2).toLowerCase();
  if (l === 'en') return 'en-GB';
  if (l === 'ru') return 'ru-RU';
  if (l === 'zh') return 'zh-CN';
  return 'az-Latn-AZ';
}

/**
 * "2026-11-20" → "20 noyabr, cümə" (həftə günü + tarix; il yalnız cari il
 * deyilsə). Saat qurşağından asılı deyil — gün dəyişmir.
 */
export function formatYmd(ymd: string | null | undefined, opts?: { weekday?: boolean }): string {
  if (!ymd) return '—';
  const base = ymd.slice(0, 10);
  if (!isYmd(base)) return ymd;
  const [y, m, d] = base.split('-').map(Number);
  const showYear = String(y) !== bakuTodayYmd().slice(0, 4);
  try {
    return new Intl.DateTimeFormat(intlLocale(), {
      timeZone: 'UTC',
      weekday: opts?.weekday === false ? undefined : 'long',
      day: 'numeric',
      month: 'long',
      year: showYear ? 'numeric' : undefined,
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return base;
  }
}

/**
 * Ustanın gəliş günü: "20 noyabr, cümə · 15:30" (saat yalnız təyin
 * olunubsa). Boşdursa null.
 */
export function formatVisitDay(iso: string | null | undefined): string | null {
  const p = toBakuParts(iso);
  if (!p) return null;
  const date = formatYmd(p.ymd);
  return p.hasTime ? `${date} · ${p.hm}` : date;
}

/** "Bu gün" / "Sabah" / "Keçib" — yoxdursa null. */
export function relativeDayLabel(iso: string | null | undefined): string | null {
  const p = toBakuParts(iso);
  if (!p) return null;
  const today = bakuTodayYmd();
  if (p.ymd === today) return i18n.t('offerTerms.today');
  if (p.ymd === addDaysYmd(today, 1)) return i18n.t('offerTerms.tomorrow');
  if (p.ymd < today) return i18n.t('offerTerms.past');
  return null;
}

/** Gəliş gününə görə müqayisə (gün göstərilməyənlər sonda). */
export function compareVisitDay(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  const fa = Number.isFinite(ta);
  const fb = Number.isFinite(tb);
  if (fa && fb) return ta - tb;
  if (fa) return -1;
  if (fb) return 1;
  return 0;
}

// ── Sıralama ───────────────────────────────────────────────────────

export type OfferSort = 'earliest' | 'cheapest';

/** Müştərinin təklif siyahısı: ən tez gəliş günü və ya ən aşağı qiymət. */
export function sortOffers<T extends OfferTerms>(list: T[], mode: OfferSort): T[] {
  const copy = [...list];
  copy.sort((a, b) => {
    if (mode === 'cheapest') {
      const d = n(a.offer_amount) - n(b.offer_amount);
      return d !== 0 ? d : compareVisitDay(a.proposed_at, b.proposed_at);
    }
    const d = compareVisitDay(a.proposed_at, b.proposed_at);
    return d !== 0 ? d : n(a.offer_amount) - n(b.offer_amount);
  });
  return copy;
}

// ── Xətalar ────────────────────────────────────────────────────────

/**
 * Server xətasındakı kod prefiksini atır:
 * "OFFER_FIELD_LOCKED: tarixi yalnız usta…" → "tarixi yalnız usta…"
 */
export function stripErrorCode(msg: string | null | undefined): string {
  const s = (msg ?? '').trim();
  const m = s.match(/^[A-Z][A-Z0-9_]{2,}:\s*(.+)$/s);
  const out = m ? m[1] : s;
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : s;
}
