/**
 * Admin tərəfindən başqa istifadəçilərə təyin edilmiş parollar üçün
 * yalnız yaddaşda (in-memory) saxlanan qısamüddətli tarixçə.
 *
 * ⚠ Plaintext parollar localStorage-a YAZILMIR — yalnız cari səhifə
 * sessiyasının yaddaşında saxlanır və səhifə yenilənəndə itir.
 */

export interface ResetEntry {
  userId: string;
  displayName: string;
  email: string | null;
  password: string;
  setAt: number; // ms epoch
}

export const TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

// In-memory saxlama — modul səviyyəsində Map (userId → entry)
const store = new Map<string, ResetEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.setAt >= TTL_MS) store.delete(key);
  }
}

export function loadHistory(): ResetEntry[] {
  pruneExpired();
  return Array.from(store.values()).sort((a, b) => b.setAt - a.setAt);
}

export function saveHistory(entries: ResetEntry[]): void {
  store.clear();
  for (const e of entries) store.set(e.userId, e);
}

export function addEntry(entry: ResetEntry): ResetEntry[] {
  pruneExpired();
  store.delete(entry.userId);
  store.set(entry.userId, entry);
  // Ən çox 20 giriş saxla — ən köhnələri sil
  const all = Array.from(store.values()).sort((a, b) => b.setAt - a.setAt);
  for (const extra of all.slice(20)) store.delete(extra.userId);
  return loadHistory();
}

export function getEntryForUser(userId: string): ResetEntry | null {
  pruneExpired();
  return store.get(userId) ?? null;
}

export function removeEntry(userId: string): ResetEntry[] {
  store.delete(userId);
  return loadHistory();
}

export function clearAll(): void {
  store.clear();
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
