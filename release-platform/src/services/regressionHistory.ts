import { proxyJson } from './proxy';

export interface RegressionRunRecord {
  id: string;
  version: string;
  platform: 'ios' | 'android' | 'all';
  startTs: number;
  endTs: number;
  totalCases: number;
  finishedCases: number;
  durationHours: number;
  peopleCount: number;
  velocityPerHour: number;
  velocityPerPersonPerHour: number;
  // Daily people distribution: { date: 'YYYY-MM-DD', people: string[], count: number }[]
  dailyPeopleDistribution: DailyPeopleEntry[];
}

export interface DailyPeopleEntry {
  date: string;    // 'YYYY-MM-DD' Moscow time
  people: string[];
  count: number;
}

export interface RegressionBaseline {
  medianVpP: number | null;
  medianVelocity: number | null;
  runCount: number;
  recentRuns: RegressionRunRecord[];
  // Aggregated daily distribution across all runs
  avgPeopleByWeekday: Record<number, number>; // 0=Sun..6=Sat → avg active people
}

export interface GasConfig {
  gasUrl: string;
  proxyBase?: string;
  useProxy?: boolean;
}

const GAS_FILE = 'regression_runs_history.json';
const LS_FALLBACK_KEY = 'wb_regression_runs_v1';
const MAX_RECORDS = 100;

// ── GAS transport ──────────────────────────────────────────────────────────

function buildGasGetUrl(gasUrl: string) {
  return `${gasUrl.replace(/\/+$/, '')}?op=get&name=${encodeURIComponent(GAS_FILE)}`;
}

function buildGasSaveUrl(gasUrl: string) {
  return `${gasUrl.replace(/\/+$/, '')}?name=${encodeURIComponent(GAS_FILE)}`;
}

async function gasFetch(cfg: GasConfig, url: string, init?: RequestInit): Promise<Response> {
  const proxyBase = String(cfg.proxyBase || '').trim();
  if (cfg.useProxy !== false && proxyBase) {
    return proxyJson(
      { base: proxyBase, mode: 'query' },
      url,
      init,
    ) as unknown as Response;
  }
  return fetch(url, init);
}

// ── localStorage fallback ──────────────────────────────────────────────────

function lsLoad(): RegressionRunRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as RegressionRunRecord[]) : [];
  } catch { return []; }
}

function lsSave(runs: RegressionRunRecord[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(runs)); } catch { /* quota */ }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function loadRegressionRuns(cfg: GasConfig): Promise<RegressionRunRecord[]> {
  const gasUrl = String(cfg.gasUrl || '').trim();
  if (!gasUrl) return lsLoad();

  try {
    const res = await gasFetch(cfg, buildGasGetUrl(gasUrl), { method: 'GET' });
    if (!res.ok) return lsLoad();
    const text = await res.text();
    const parsed = JSON.parse(text);
    const runs: RegressionRunRecord[] = Array.isArray(parsed) ? parsed : [];
    // Sync to localStorage as offline cache
    lsSave(runs);
    return runs;
  } catch {
    return lsLoad();
  }
}

export async function saveRegressionRun(cfg: GasConfig, run: RegressionRunRecord): Promise<void> {
  const current = await loadRegressionRuns(cfg);
  const filtered = current.filter(r => r.id !== run.id);
  const updated = [...filtered, run]
    .sort((a, b) => a.endTs - b.endTs)
    .slice(-MAX_RECORDS);

  // Always save to localStorage first (fast, offline-safe)
  lsSave(updated);

  const gasUrl = String(cfg.gasUrl || '').trim();
  if (!gasUrl) return;

  try {
    await gasFetch(cfg, buildGasSaveUrl(gasUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  } catch { /* GAS unavailable — localStorage is already updated */ }
}

export function buildRegressionRunId(version: string, platform: string, endTs: number): string {
  return `${version}::${platform}::${endTs}`;
}

// ── Analytics ──────────────────────────────────────────────────────────────

function med(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function tsMoscowDate(ts: number): string {
  const moscowOffset = 3 * 3600000;
  const d = new Date(ts + moscowOffset);
  return d.toISOString().slice(0, 10);
}

export function buildDailyPeopleDistribution(
  snapshots: Array<{ updatedAt: number; activePeopleCount: number; activePeopleLogins?: string[] }>
): DailyPeopleEntry[] {
  const byDate = new Map<string, Set<string>>();

  for (const snap of snapshots) {
    const date = tsMoscowDate(Number(snap.updatedAt || 0));
    if (!byDate.has(date)) byDate.set(date, new Set());
    const logins = snap.activePeopleLogins || [];
    if (logins.length > 0) {
      logins.forEach(l => byDate.get(date)!.add(l));
    } else if (snap.activePeopleCount > 0) {
      // No logins available — use synthetic placeholder keys
      for (let i = 0; i < snap.activePeopleCount; i++) {
        byDate.get(date)!.add(`__person_${i}`);
      }
    }
  }

  return [...byDate.entries()]
    .map(([date, set]) => ({ date, people: [...set], count: set.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeRegressionBaseline(runs: RegressionRunRecord[]): RegressionBaseline {
  const filtered = runs
    .filter(r =>
      r.durationHours >= 0.5 &&
      r.finishedCases >= 10 &&
      r.peopleCount >= 1 &&
      Number.isFinite(r.velocityPerPersonPerHour) &&
      r.velocityPerPersonPerHour > 0,
    )
    .sort((a, b) => a.endTs - b.endTs)
    .slice(-15);

  // Build avg people by weekday (Moscow time, 0=Sun..6=Sat)
  const weekdayBuckets: Record<number, number[]> = {};
  for (const run of filtered) {
    for (const entry of (run.dailyPeopleDistribution || [])) {
      const d = new Date(entry.date + 'T12:00:00+03:00');
      const wd = d.getDay();
      if (!weekdayBuckets[wd]) weekdayBuckets[wd] = [];
      weekdayBuckets[wd].push(entry.count);
    }
  }

  const avgPeopleByWeekday: Record<number, number> = {};
  for (const [wd, counts] of Object.entries(weekdayBuckets)) {
    const avg = counts.reduce((s, v) => s + v, 0) / counts.length;
    avgPeopleByWeekday[Number(wd)] = Math.round(avg);
  }

  if (!filtered.length) {
    return { medianVpP: null, medianVelocity: null, runCount: 0, recentRuns: [], avgPeopleByWeekday };
  }

  return {
    medianVpP: med(filtered.map(r => r.velocityPerPersonPerHour)),
    medianVelocity: med(filtered.map(r => r.velocityPerHour)),
    runCount: filtered.length,
    recentRuns: filtered,
    avgPeopleByWeekday,
  };
}

// Sub-linear people scaling: n^0.78
// 1→2: +74% velocity; 1→4: ×2.8; 1→8: ×5.5 (not ×8)
export function forecastVelocityWithPeople(
  baseline: RegressionBaseline,
  currentPeopleCount: number,
): number | null {
  if (baseline.medianVpP == null || currentPeopleCount < 1) return null;
  const n = Math.max(1, Math.round(currentPeopleCount));
  return baseline.medianVpP * Math.pow(n, 0.78);
}

// Inverse: how many people needed to reach target velocity
export function requiredPeopleForVelocity(
  baseline: RegressionBaseline,
  targetVelocityPerHour: number,
): number | null {
  if (baseline.medianVpP == null || baseline.medianVpP <= 0 || targetVelocityPerHour <= 0) return null;
  return Math.ceil(Math.pow(targetVelocityPerHour / baseline.medianVpP, 1 / 0.78));
}

// Expected people count for today based on historical weekday patterns
export function expectedPeopleCountForToday(baseline: RegressionBaseline): number | null {
  const today = new Date().getDay();
  const val = baseline.avgPeopleByWeekday[today];
  return val != null && val > 0 ? val : null;
}
