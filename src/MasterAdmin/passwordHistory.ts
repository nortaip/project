/**
 * Admin tərəfindən başqa istifadəçilərə təyin edilmiş parollar üçün
 * brauzer-əsaslı 24-saatlıq yaddaş.
 *
 * ⚠ DB-də saxlanmır — yalnız bu admin-in öz brauzerinin localStorage-ında.
 * Hack riski daşımır, çünki DB-də plaintext parol yoxdur.
 */

export interface ResetEntry {
  userId: string;
  displayName: string;
  email: string | null;
  password: string;
  setAt: number; // ms epoch
}

const LS_KEY = 'admin:password_reset_history';
export const TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

export function loadHistory(): ResetEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ResetEntry[];
    const fresh = arr.filter((e) => Date.now() - e.setAt < TTL_MS);
    if (fresh.length !== arr.length) {
      localStorage.setItem(LS_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return [];
  }
}

export function saveHistory(entries: ResetEntry[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

export function addEntry(entry: ResetEntry): ResetEntry[] {
  const cur = loadHistory();
  // Hər istifadəçi üçün yalnız ən son giriş saxlanır
  const next = [entry, ...cur.filter((h) => h.userId !== entry.userId)].slice(0, 20);
  saveHistory(next);
  return next;
}

export function getEntryForUser(userId: string): ResetEntry | null {
  return loadHistory().find((e) => e.userId === userId) ?? null;
}

export function removeEntry(userId: string): ResetEntry[] {
  const next = loadHistory().filter((h) => h.userId !== userId);
  saveHistory(next);
  return next;
}

export function clearAll(): void {
  saveHistory([]);
}

export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#%&*';
  const all = upper + lower + digits + symbols;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += symbols[Math.floor(Math.random() * symbols.length)];
  for (let i = 0; i < 8; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

export function fmtTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'indi';
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return new Date(ms).toLocaleString('az');
}
