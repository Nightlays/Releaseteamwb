import { GOOGLE_APPS_SCRIPT_URL } from '../types';
import { proxyFetch, type ProxyMode } from './proxy';

export const BI_INTERVAL_OPTIONS = ['today', 'yesterday', 'last_2_days', 'last_7_days', 'last_30_days'] as const;

export type BiInterval = typeof BI_INTERVAL_OPTIONS[number];
export type BiLoadState = 'idle' | 'loading' | 'ok' | 'warn' | 'error';

export interface BiSnapshotBase {
  time: string;
}

export interface BiDriveRuntimeSettings {
  proxyBase: string;
  proxyMode?: ProxyMode;
  useProxy: boolean;
}

export const BI_DRIVE_URL = GOOGLE_APPS_SCRIPT_URL;

export function isBiInterval(value: unknown): value is BiInterval {
  return BI_INTERVAL_OPTIONS.includes(value as BiInterval);
}

export function normalizeBiInterval(value: unknown, fallback: BiInterval = 'last_2_days'): BiInterval {
  return isBiInterval(value) ? value : fallback;
}

export function isValidBiSnapshotTime(value: unknown) {
  const text = String(value || '').trim();
  return Boolean(text) && !Number.isNaN(Date.parse(text));
}

export function sortBiSnapshots<T extends BiSnapshotBase>(items: T[]) {
  return items.slice().sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

export function mergeBiSnapshots<T extends BiSnapshotBase>(localItems: T[], remoteItems: T[], limit: number) {
  const byTime = new Map<string, T>();
  [...localItems, ...remoteItems].forEach(snapshot => {
    if (!isValidBiSnapshotTime(snapshot.time)) return;
    byTime.set(snapshot.time, snapshot);
  });
  return sortBiSnapshots([...byTime.values()]).slice(-limit);
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage errors */
  }
}

export function readBiSnapshotHistory<T extends BiSnapshotBase>(
  key: string,
  normalize: (value: unknown) => T | null,
) {
  const raw = readJsonStorage<unknown>(key, []);
  if (!Array.isArray(raw)) return [] as T[];
  return sortBiSnapshots(raw.map(normalize).filter((item): item is T => Boolean(item)));
}

export function writeBiSnapshotHistory<T extends BiSnapshotBase>(key: string, history: T[], limit: number) {
  writeJsonStorage(key, sortBiSnapshots(history).slice(-limit));
}

export function appendBiSnapshot<T extends BiSnapshotBase>(
  key: string,
  history: T[],
  snapshot: T,
  limit: number,
) {
  const next = mergeBiSnapshots(history, [snapshot], limit);
  writeBiSnapshotHistory(key, next, limit);
  return next;
}

export function normalizeBiSnapshotsPayload<T extends BiSnapshotBase>(
  raw: unknown,
  normalize: (value: unknown) => T | null,
) {
  const source = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
  const items = Array.isArray(source) ? source : source ? [source] : [];
  return items.map(normalize).filter((item): item is T => Boolean(item));
}

export async function biDriveFetch(settings: BiDriveRuntimeSettings, rawUrl: string, init?: RequestInit) {
  const headers = {
    Accept: 'application/json',
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };

  if (settings.useProxy !== false && String(settings.proxyBase || '').trim()) {
    return proxyFetch(
      {
        base: String(settings.proxyBase || '').trim(),
        mode: settings.proxyMode || 'prefix',
      },
      rawUrl,
      {
        ...init,
        headers,
      },
    );
  }

  return fetch(rawUrl, {
    ...init,
    headers,
  });
}

export function buildBiDriveGetUrl(name: string) {
  return `${BI_DRIVE_URL}?op=get&name=${encodeURIComponent(name)}`;
}

export function buildBiDriveSaveUrl(name: string) {
  return `${BI_DRIVE_URL}?name=${encodeURIComponent(name)}`;
}
