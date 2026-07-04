/**
 * Azərbaycan hərflərini nəzərə alaraq SEO-dostu slug yaradır.
 * "Avtomobil xidmətləri" → "avtomobil-xidmetleri"
 */
const AZ_MAP: Record<string, string> = {
  ə: 'e', Ə: 'e',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ü: 'u', Ü: 'u',
  ç: 'c', Ç: 'c',
  ş: 's', Ş: 's',
  й: 'y', ё: 'e',
};

export function slugify(input: string): string {
  return (input ?? '')
    .trim()
    .replace(/[əƏğĞıİöÖüÜçÇşŞйё]/g, (c) => AZ_MAP[c] ?? c)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diakritikləri sil
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
