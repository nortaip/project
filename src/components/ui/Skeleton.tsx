/**
 * Yüklənmə yer tutucusu (skeleton). Data gələnə qədər real məzmunla eyni
 * ölçüdə yer saxlayır ki, məzmun gələndə səhifə "tullanmasın" (CLS).
 * Ölçünü (h-*, w-*) className ilə verin; bg-* / rounded-* verilməyibsə
 * standart rəng və künc tətbiq olunur.
 *
 * Qəsdən tailwind-merge istifadə etmir — ana səhifə paketində olduğu üçün
 * əlavə ~20 KB gətirməsin.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  const bg = /(^|\s)bg-/.test(className) ? '' : ' bg-surface-bg';
  const rounded = /(^|\s)rounded/.test(className) ? '' : ' rounded-md';
  return <span aria-hidden className={`block animate-pulse${bg}${rounded} ${className}`} />;
}
