/**
 * Pul / rəqəm formatlama helper-ləri.
 *
 * NƏ ÜÇÜN: PostgREST `numeric` sütunları JSON-da STRING kimi qaytarır
 * (məs. balance: "12.50"). Birbaşa `value.toFixed(2)` çağırışı string-də
 * crash verir ("toFixed is not a function"). Bu helper-lər həmişə əvvəlcə
 * `Number(...)`-ə çevirir, ona görə həm number, həm string, həm null/undefined
 * təhlükəsiz işləyir.
 *
 * İSTİFADƏ: balansı / məbləği ekranda göstərəndə `azn(x)` və ya `money(x)`
 * işlət, bare `x.toFixed(2)` YOX.
 */

/** İstənilən dəyəri təhlükəsiz `number`-ə çevirir (NaN → 0). */
export function n(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/** Pul məbləği — sabit onluq (default 2), heç vaxt crash etmir. "12.50" */
export function money(value: unknown, fractionDigits = 2): string {
  return n(value).toFixed(fractionDigits);
}

/** Pul + AZN simvolu. "12.50 ₼" */
export function azn(value: unknown, fractionDigits = 2): string {
  return `${money(value, fractionDigits)} ₼`;
}

/** Faiz dəyəri. "9.5%" */
export function pct(value: unknown, fractionDigits = 1): string {
  return `${n(value).toFixed(fractionDigits)}%`;
}

/** Reytinq kimi tək onluqlu rəqəm. "4.9" */
export function rating(value: unknown): string {
  return n(value).toFixed(1);
}

/** Böyük rəqəmləri qısaldır: 1500 → "1.5k", 12 → "12" */
export function compact(value: unknown): string {
  const num = n(value);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return Math.round(num).toString();
}
