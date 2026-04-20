import { proxyJson, type ProxyMode } from './proxy';
import { AllureLaunch, AllureLaunchResult } from '../types';

export interface AllureConfig {
  base: string;
  token: string;
  projectId: string;
  signal?: AbortSignal;
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
}

export const DASHBOARD_ORDER = [
  '[iOS][High/Blocker]',
  '[Android][High/Blocker]',
  '[iOS][Selective]',
  '[Android][Selective]',
] as const;

export type DashboardGroupLabel = typeof DASHBOARD_ORDER[number];

export interface AllureLaunchStatisticItem {
  status?: string;
  count?: number;
}

export interface AllureLaunchMemberStatItem {
  login?: string;
  displayName?: string;
  statistic?: AllureLaunchStatisticItem[];
}

export interface DashboardGroupCounts {
  total: number;
  finished: number;
  remaining_total: number;
  remaining: number;
  in_progress: number;
  manual_finished: number;
}

export interface DashboardUwuCounts {
  total: number;
  done: number;
  left: number;
}

export interface DashboardAlertEntry {
  id: number;
  name: string;
  finished: number;
  total: number;
}

export interface DashboardAggregateResult {
  launches: AllureLaunchResult[];
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>;
  alerts: DashboardAlertEntry[];
  activePeopleCount: number;
  activePeopleLogins: string[];
}

export interface ReadinessLaunchSummary {
  platform: 'android' | 'ios';
  id: number | null;
  name: string;
  total: number;
  finished: number;
  pct: number;
  url: string | null;
}

interface DashboardLaunchCacheCounts {
  total: number;
  finished: number;
  remaining_total: number;
  in_progress: number;
}

interface DashboardLaunchCacheEntry {
  launchId: number;
  name: string;
  createdDate: number;
  status: AllureLaunch['status'];
  label: DashboardGroupLabel | null;
  previewKey: string;
  updatedAt: number;
  counts: DashboardLaunchCacheCounts;
  assignedUnfinished: number;
  manualFinished: number;
  uwu: DashboardUwuCounts | null;
}

interface DashboardReleaseCache {
  version: string;
  savedAt: number;
  launches: Record<string, DashboardLaunchCacheEntry>;
  readiness?: ReadinessLaunchSummary[];
}

function buildAllureHeaders(token: string, extra?: Record<string, string>) {
  const rawToken = String(token || '').trim();
  const authValue = /^Api-Token\s+/i.test(rawToken) || /^Bearer\s+/i.test(rawToken)
    ? rawToken
    : `Api-Token ${rawToken}`;

  return {
    Accept: 'application/json',
    Authorization: authValue,
    ...(extra || {}),
  };
}

function encodeSearchQuery(filters: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(filters));
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function createEmptyDashboardAgg(): Record<DashboardGroupLabel, DashboardGroupCounts> {
  return Object.fromEntries(
    DASHBOARD_ORDER.map(label => [label, { total: 0, finished: 0, remaining_total: 0, remaining: 0, in_progress: 0, manual_finished: 0 }])
  ) as Record<DashboardGroupLabel, DashboardGroupCounts>;
}

function createEmptyDashboardUwuAgg(): Record<DashboardGroupLabel, DashboardUwuCounts> {
  return Object.fromEntries(
    DASHBOARD_ORDER.map(label => [label, { total: 0, done: 0, left: 0 }])
  ) as Record<DashboardGroupLabel, DashboardUwuCounts>;
}

function normalizeStatus(raw: unknown) {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'passed' || value === 'failed' || value === 'broken' || value === 'skipped') return value;
  return 'in_progress';
}

const COMPLETED_STATUSES = new Set(['passed', 'failed', 'broken', 'skipped']);
const NON_COMPLETED_STATUSES = new Set(['in_progress']);
const ALL_ASSIGNED_STATUSES = new Set(['passed', 'failed', 'broken', 'skipped', 'in_progress']);
const DASHBOARD_RELEASE_CACHE_KEY = 'rp_dashboard_release_cache_v1';
const DASHBOARD_RELEASE_CACHE_LIMIT = 8;
const DASHBOARD_RELEASE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function sumByStatuses(list: AllureLaunchStatisticItem[] | undefined, allowed: Set<string>) {
  return (Array.isArray(list) ? list : []).reduce((sum, item) => {
    return allowed.has(normalizeStatus(item?.status)) ? sum + Number(item?.count || 0) : sum;
  }, 0);
}

export function computeLaunchCountsExact(statList: AllureLaunchStatisticItem[] | undefined) {
  const finished = sumByStatuses(statList, COMPLETED_STATUSES);
  const unfinished = sumByStatuses(statList, NON_COMPLETED_STATUSES);
  const total = finished + unfinished;
  return {
    total,
    finished,
    remaining_total: unfinished,
    in_progress: unfinished,
    remaining: 0,
  };
}

export function assignedUnfinishedFromMemberStats(memberStats: AllureLaunchMemberStatItem[] | undefined) {
  return (Array.isArray(memberStats) ? memberStats : []).reduce((sum, item) => {
    return sum + sumByStatuses(item?.statistic, NON_COMPLETED_STATUSES);
  }, 0);
}

export function completedFromMemberStats(memberStats: AllureLaunchMemberStatItem[] | undefined) {
  return (Array.isArray(memberStats) ? memberStats : []).reduce((sum, item) => {
    return sum + sumByStatuses(item?.statistic, COMPLETED_STATUSES);
  }, 0);
}

export function activeLoginsFromMemberStats(memberStats: AllureLaunchMemberStatItem[] | undefined): string[] {
  return (Array.isArray(memberStats) ? memberStats : [])
    .filter(item => sumByStatuses(item?.statistic, ALL_ASSIGNED_STATUSES) > 0)
    .map(item => String(item.login || item.displayName || '').trim())
    .filter(Boolean);
}

export function countActivePeopleFromMemberStats(memberStats: AllureLaunchMemberStatItem[] | undefined): number {
  return (Array.isArray(memberStats) ? memberStats : []).filter(
    item => sumByStatuses(item?.statistic, ALL_ASSIGNED_STATUSES) > 0
  ).length;
}

function dashboardLabelOf(name: string): DashboardGroupLabel | null {
  return DASHBOARD_ORDER.find(label => String(name || '').includes(label)) ?? null;
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function sanitizeDashboardCounts(raw: unknown): DashboardLaunchCacheCounts {
  const value = (raw && typeof raw === 'object') ? raw as Partial<DashboardLaunchCacheCounts> : {};
  return {
    total: Number(value.total || 0),
    finished: Number(value.finished || 0),
    remaining_total: Number(value.remaining_total || 0),
    in_progress: Number(value.in_progress || 0),
  };
}

function sanitizeDashboardUwu(raw: unknown): DashboardUwuCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<DashboardUwuCounts>;
  return {
    total: Number(value.total || 0),
    done: Number(value.done || 0),
    left: Number(value.left || 0),
  };
}

function sanitizeDashboardLaunchCacheEntry(raw: unknown): DashboardLaunchCacheEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<DashboardLaunchCacheEntry>;
  const launchId = Number(value.launchId || 0);
  const previewKey = String(value.previewKey || '').trim();
  if (!launchId || !previewKey) return null;

  const label = value.label && DASHBOARD_ORDER.includes(value.label) ? value.label : null;
  return {
    launchId,
    name: String(value.name || ''),
    createdDate: Number(value.createdDate || 0),
    status: (['RUNNING', 'DONE', 'BROKEN', 'CANCELED'].includes(String(value.status || '')) ? String(value.status || '') : 'DONE') as AllureLaunch['status'],
    label,
    previewKey,
    updatedAt: Number(value.updatedAt || 0),
    counts: sanitizeDashboardCounts(value.counts),
    assignedUnfinished: Number(value.assignedUnfinished || 0),
    manualFinished: Number(value.manualFinished || 0),
    uwu: sanitizeDashboardUwu(value.uwu),
  };
}

function sanitizeReadinessSummaryItem(raw: unknown): ReadinessLaunchSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<ReadinessLaunchSummary>;
  const platform = value.platform === 'android' || value.platform === 'ios' ? value.platform : null;
  if (!platform) return null;
  return {
    platform,
    id: value.id == null ? null : Number(value.id || 0),
    name: String(value.name || ''),
    total: Number(value.total || 0),
    finished: Number(value.finished || 0),
    pct: Number(value.pct || 0),
    url: value.url ? String(value.url) : null,
  };
}

function readDashboardReleaseCache(version?: string): DashboardReleaseCache | null {
  if (!version || !canUseLocalStorage()) return null;

  try {
    const raw = JSON.parse(window.localStorage.getItem(DASHBOARD_RELEASE_CACHE_KEY) || '[]') as unknown[];
    const list = Array.isArray(raw) ? raw : [];
    const matched = list.find(item => String((item as { version?: unknown })?.version || '').trim() === version);
    if (!matched || typeof matched !== 'object') return null;

    const launchesRaw = (matched as { launches?: unknown }).launches;
    const launches = Object.fromEntries(
      Object.entries((launchesRaw && typeof launchesRaw === 'object') ? launchesRaw as Record<string, unknown> : {})
        .map(([key, value]) => [key, sanitizeDashboardLaunchCacheEntry(value)])
        .filter((entry): entry is [string, DashboardLaunchCacheEntry] => Boolean(entry[1]))
    );

    return {
      version,
      savedAt: Number((matched as { savedAt?: unknown }).savedAt || 0),
      launches,
      readiness: Array.isArray((matched as { readiness?: unknown }).readiness)
        ? ((matched as { readiness?: unknown[] }).readiness || [])
            .map(sanitizeReadinessSummaryItem)
            .filter((item): item is ReadinessLaunchSummary => Boolean(item))
        : undefined,
    };
  } catch {
    return null;
  }
}

function writeDashboardReleaseCache(cache: DashboardReleaseCache) {
  if (!cache.version || !canUseLocalStorage()) return;

  try {
    const raw = JSON.parse(window.localStorage.getItem(DASHBOARD_RELEASE_CACHE_KEY) || '[]') as unknown[];
    const list = Array.isArray(raw) ? raw.filter(item => {
      const version = String((item as { version?: unknown })?.version || '').trim();
      const savedAt = Number((item as { savedAt?: unknown })?.savedAt || 0);
      return version && version !== cache.version && Date.now() - savedAt < DASHBOARD_RELEASE_CACHE_TTL_MS;
    }) : [];

    list.push(cache);
    const next = list
      .sort((left, right) => Number((right as { savedAt?: unknown })?.savedAt || 0) - Number((left as { savedAt?: unknown })?.savedAt || 0))
      .slice(0, DASHBOARD_RELEASE_CACHE_LIMIT);

    window.localStorage.setItem(DASHBOARD_RELEASE_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore cache write failures */
  }
}

function buildPreviewCounts(statistic: AllureLaunch['statistic'] | undefined): DashboardLaunchCacheCounts {
  const stat = statistic || {
    total: 0,
    passed: 0,
    failed: 0,
    broken: 0,
    skipped: 0,
    unknown: 0,
  };
  const total = Number(stat.total || 0);
  const finished =
    Number(stat.passed || 0) +
    Number(stat.failed || 0) +
    Number(stat.broken || 0) +
    Number(stat.skipped || 0);
  const inProgress = Math.max(0, Number(stat.unknown || 0));
  return {
    total,
    finished,
    remaining_total: Math.max(0, total - finished),
    in_progress: inProgress,
  };
}

function buildCachedLaunchResult(entry: DashboardLaunchCacheEntry): AllureLaunchResult {
  const meta = parseLaunchMeta(entry.name);
  const total = Number(entry.counts.total || 0);
  const finished = Number(entry.counts.finished || 0);
  return {
    id: entry.launchId,
    name: entry.name,
    platform: meta.platform,
    type: meta.type,
    total,
    finished,
    remaining: Number(entry.counts.remaining_total || 0),
    in_progress: Number(entry.counts.in_progress || 0),
    pct: total > 0 ? Math.round((finished / total) * 100) : 0,
    status: entry.status,
    createdDate: entry.createdDate,
    stream: meta.stream,
  };
}

function buildLaunchPreviewKey(launch: AllureLaunch) {
  const stat = launch?.statistic || {
    total: 0,
    passed: 0,
    failed: 0,
    broken: 0,
    skipped: 0,
    unknown: 0,
  };
  return JSON.stringify([
    String(launch?.name || ''),
    Number(launch?.createdDate || 0),
    String(launch?.status || ''),
    Number(stat.total || 0),
    Number(stat.passed || 0),
    Number(stat.failed || 0),
    Number(stat.broken || 0),
    Number(stat.skipped || 0),
    Number(stat.unknown || 0),
  ]);
}

function isReusableDashboardCacheEntry(entry: DashboardLaunchCacheEntry | null, launch: AllureLaunch) {
  if (!entry) return false;
  if (Date.now() - Number(entry.updatedAt || 0) > DASHBOARD_RELEASE_CACHE_TTL_MS) return false;
  return (
    entry.launchId === Number(launch?.id || 0) &&
    entry.createdDate === Number(launch?.createdDate || 0) &&
    entry.previewKey === buildLaunchPreviewKey(launch)
  );
}

function applyCountsToLaunch(current: AllureLaunchResult, counts: DashboardLaunchCacheCounts): AllureLaunchResult {
  const total = Number(counts.total || 0);
  const finished = Number(counts.finished || 0);
  return {
    ...current,
    total,
    finished,
    remaining: Number(counts.remaining_total || 0),
    in_progress: Number(counts.in_progress || 0),
    pct: total > 0 ? Math.round((finished / total) * 100) : 0,
  };
}

function mergeDashboardAggRow(
  row: DashboardGroupCounts,
  counts: DashboardLaunchCacheCounts,
  assignedUnfinished: number,
  manualFinished: number
) {
  const unfinishedAll = Math.max(0, Number(counts.remaining_total || 0));
  row.total += Number(counts.total || 0);
  row.finished += Number(counts.finished || 0);
  row.remaining_total += unfinishedAll;
  row.remaining += Math.max(0, assignedUnfinished);
  row.in_progress += Math.max(0, unfinishedAll - Math.max(0, assignedUnfinished));
  row.manual_finished += Math.max(0, manualFinished);
}

function mergeDashboardUwuRow(target: DashboardUwuCounts, source: DashboardUwuCounts | null | undefined) {
  if (!source) return;
  target.total += Number(source.total || 0);
  target.done += Number(source.done || 0);
  target.left += Number(source.left || 0);
}

export function readCachedDashboardAggregate(version?: string): DashboardAggregateResult | null {
  const cache = readDashboardReleaseCache(version);
  if (!cache) return null;

  const launches = Object.values(cache.launches)
    .map(buildCachedLaunchResult)
    .sort((a, b) => Number(b.createdDate || 0) - Number(a.createdDate || 0));

  if (!launches.length) return null;

  const agg = createEmptyDashboardAgg();
  const uwu = createEmptyDashboardUwuAgg();
  const alerts: DashboardAlertEntry[] = [];

  Object.values(cache.launches).forEach(entry => {
    const counts = sanitizeDashboardCounts(entry.counts);
    alerts.push({
      id: entry.launchId,
      name: entry.name,
      finished: Number(counts.finished || 0),
      total: Number(counts.total || 0),
    });

    if (!entry.label) return;
    mergeDashboardAggRow(agg[entry.label], counts, Number(entry.assignedUnfinished || 0), Number(entry.manualFinished || 0));
    mergeDashboardUwuRow(uwu[entry.label], entry.uwu);
  });

  return {
    launches,
    agg,
    uwu,
    alerts: alerts.sort((a, b) => b.id - a.id),
    activePeopleCount: 1,
    activePeopleLogins: [],
  };
}

export function readCachedDashboardReadiness(version?: string): ReadinessLaunchSummary[] {
  return readDashboardReleaseCache(version)?.readiness || [];
}

export function writeCachedDashboardReadiness(version: string, readiness: ReadinessLaunchSummary[]) {
  if (!version) return;
  const existing = readDashboardReleaseCache(version) || {
    version,
    savedAt: 0,
    launches: {},
  };

  writeDashboardReleaseCache({
    ...existing,
    version,
    savedAt: Date.now(),
    readiness: readiness.map(item => ({ ...item })),
  });
}

function searchNameContains(value: string) {
  return encodeSearchQuery([{ id: 'name', type: 'string', value: String(value) }]);
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

interface AllureLeafItem {
  status?: string;
  testCaseId?: number;
}

interface TestCaseCustomField {
  name?: string;
  values?: Array<{ name?: string }>;
  customField?: { name?: string };
}

async function allureFetch<T>(
  cfg: AllureConfig,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  init?: RequestInit
): Promise<T> {
  const url = new URL(cfg.base.replace(/\/+$/, '') + path);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }

  const headers = buildAllureHeaders(
    cfg.token,
    (init?.headers as Record<string, string> | undefined) ?? undefined
  );

  if (cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    return proxyJson<T>(
      {
        base: String(cfg.proxyBase).trim(),
        mode: cfg.proxyMode,
        signal: cfg.signal,
      },
      url.toString(),
      { ...init, headers }
    );
  }

  const response = await fetch(url.toString(), {
    ...init,
    headers,
    signal: cfg.signal,
  });

  if (!response.ok) {
    throw new Error(`Allure ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/* Получить список лаунчей для проекта + опциональная фильтрация по версии */
export async function fetchLaunches(
  cfg: AllureConfig,
  releaseVersion?: string,
): Promise<AllureLaunch[]> {
  const result: AllureLaunch[] = [];
  const pageSize = 200;
  const search = releaseVersion
    ? encodeSearchQuery([{ id: 'name', type: 'string', value: releaseVersion }])
    : undefined;

  for (let page = 0; page < 8; page += 1) {
    const data = await allureFetch<{ content?: AllureLaunch[] }>(
      cfg,
      '/api/launch',
      {
        page,
        size: pageSize,
        projectId: cfg.projectId,
        preview: true,
        sort: 'createdDate,desc',
        search,
      }
    );

    const content = Array.isArray(data?.content) ? data.content : [];
    if (!content.length) break;
    result.push(...content);

    if (content.length < pageSize) break;
  }

  if (!releaseVersion) return result;
  return result.filter(launch => String(launch?.name || '').includes(releaseVersion));
}

/* Получить статистику по лаунчу */
export async function fetchLaunchStats(cfg: AllureConfig, launchId: number) {
  return allureFetch(cfg, `/api/launch/${launchId}/statistic`);
}

export async function fetchLaunchMemberStats(cfg: AllureConfig, launchId: number) {
  const data = await allureFetch<{ content?: AllureLaunchMemberStatItem[] } | AllureLaunchMemberStatItem[]>(
    cfg,
    `/api/launch/${launchId}/memberstats`,
    { size: 1000, page: 0 }
  );

  if (Array.isArray(data)) return data;
  return Array.isArray(data?.content) ? data.content : [];
}

async function fetchLaunchLeafItems(cfg: AllureConfig, launchId: number): Promise<AllureLeafItem[]> {
  const out: AllureLeafItem[] = [];
  const pageSize = 1000;

  for (let page = 0; page < 100; page += 1) {
    const data = await allureFetch<{ content?: AllureLeafItem[] }>(
      cfg,
      '/api/testresulttree/leaf',
      {
        launchId,
        sort: 'name,asc',
        size: pageSize,
        page,
      }
    );

    const content = Array.isArray(data?.content) ? data.content : [];
    if (!content.length) break;
    out.push(...content);

    if (content.length < pageSize) break;
  }

  return out;
}

function parseUwUNumber(raw: unknown) {
  if (raw == null) return 0;
  const text = String(raw).trim();
  if (!text || text === '0') return 0;
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

function pickCustomFieldValue(field: TestCaseCustomField | undefined) {
  const direct = typeof field?.name === 'string' ? field.name.trim() : '';
  if (direct) return direct;
  const nested = Array.isArray(field?.values) ? field.values.find(value => String(value?.name || '').trim()) : undefined;
  return String(nested?.name || '').trim();
}

const uwuCaseCache = new Map<number, Promise<number>>();

async function fetchTestCaseUwU(cfg: AllureConfig, testCaseId: number): Promise<number> {
  if (uwuCaseCache.has(testCaseId)) {
    return uwuCaseCache.get(testCaseId)!;
  }

  const promise = allureFetch<{ customFields?: TestCaseCustomField[] }>(
    cfg,
    `/api/testcase/${testCaseId}/overview`
  )
    .then(data => {
      const fields = Array.isArray(data?.customFields) ? data.customFields : [];
      const uwuField = fields.find(field => String(field?.customField?.name || '').trim() === 'UwU');
      return parseUwUNumber(pickCustomFieldValue(uwuField));
    })
    .catch(() => 0);

  uwuCaseCache.set(testCaseId, promise);
  return promise;
}

async function fetchLaunchUwuCounts(cfg: AllureConfig, launchId: number): Promise<DashboardUwuCounts> {
  const result: DashboardUwuCounts = { total: 0, done: 0, left: 0 };
  const leafItems = await fetchLaunchLeafItems(cfg, launchId).catch(() => []);

  await mapLimit(leafItems, 20, async leaf => {
    const testCaseId = Number(leaf?.testCaseId || 0);
    if (!testCaseId) return;

    const uwuNum = await fetchTestCaseUwU(cfg, testCaseId);
    if (!uwuNum) return;

    result.total += uwuNum;
    if (COMPLETED_STATUSES.has(normalizeStatus(leaf?.status))) {
      result.done += uwuNum;
    } else {
      result.left += uwuNum;
    }
  });

  return result;
}

/* Получить список версий для проекта */
export async function fetchVersions(cfg: AllureConfig): Promise<string[]> {
  const launches = await fetchLaunches(cfg);
  return Array.from(new Set(
    launches
      .map(launch => {
        const match = String(launch?.name || '').match(/\d+\.\d+\.\d+/);
        return match?.[0] || '';
      })
      .filter(Boolean)
  )).sort();
}

/* Создать новый ран */
export async function createRun(
  cfg: AllureConfig,
  payload: { name: string; version: string; type: string }
): Promise<{ id: number; name: string }> {
  return allureFetch<{ id: number; name: string }>(
    cfg,
    '/api/launch',
    undefined,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: Number(cfg.projectId),
        name: payload.name,
        tags: [payload.version, payload.type],
      }),
    }
  );
}

/* Получить automated total для лаунча */
export async function fetchAutomatedTotalCases(cfg: AllureConfig, launchId: number, treeId = 14): Promise<number> {
  const search = encodeSearchQuery([{ id: 'automated', type: 'boolean', value: true }]);
  const data = await allureFetch<{ content?: Array<{ statistic?: { total?: number } }> }>(
    cfg,
    '/api/testresulttree/group',
    {
      launchId,
      treeId,
      search,
      sort: 'duration,asc',
      size: 1000,
    }
  );

  return (Array.isArray(data?.content) ? data.content : []).reduce((sum, item) => {
    return sum + Number(item?.statistic?.total || 0);
  }, 0);
}

/* Парсим имя лаунча → платформа и тип */
export function parseLaunchMeta(name: string): Pick<AllureLaunchResult, 'platform' | 'type' | 'stream'> {
  const n = String(name || '').toLowerCase();
  const platform =
    n.includes('android') ? 'android' :
    n.includes('ios') ? 'ios' :
    n.includes('napi') ? 'napi' : 'other';

  const type =
    n.includes('smoke') ? 'smoke' :
    n.includes('selective') ? 'selective' :
    n.includes('regression') ? 'regression' :
    (n.includes('high') || n.includes('hb') || n.includes('blocker')) ? 'high_blocker' : 'other';

  const streamMatch = String(name || '').match(/\[([^\]]+)\]/g);
  const stream = streamMatch
    ? streamMatch.find(value => !value.match(/\[(ios|android|smoke|selective|high|blocker|regression|napi)\]/i))?.replace(/[[\]]/g, '') ?? ''
    : '';

  return { platform, type, stream };
}

/* Преобразовать AllureLaunch → AllureLaunchResult */
export function mapLaunch(l: AllureLaunch): AllureLaunchResult {
  const { platform, type, stream } = parseLaunchMeta(String(l?.name || ''));
  const stat = l?.statistic || {
    total: 0,
    passed: 0,
    failed: 0,
    broken: 0,
    skipped: 0,
    unknown: 0,
  };
  const total = Number(stat.total || 0);
  const finished = Number(stat.passed || 0) + Number(stat.failed || 0) + Number(stat.broken || 0) + Number(stat.skipped || 0);
  const remaining = Math.max(0, total - finished - Number(stat.unknown || 0));
  const in_progress = Number(stat.unknown || 0);
  const pct = total > 0 ? Math.round((finished / total) * 100) : 0;

  return {
    id: Number(l?.id || 0),
    name: String(l?.name || ''),
    platform,
    type,
    total,
    finished,
    remaining,
    in_progress,
    pct,
    status: l?.status || 'RUNNING',
    createdDate: Number(l?.createdDate || Date.now()),
    stream,
  };
}

/* Агрегировать готовность релиза по платформам */
export function aggregateReadiness(launches: AllureLaunchResult[]) {
  const calc = (rows: AllureLaunchResult[]) => {
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const finished = rows.reduce((sum, row) => sum + row.finished, 0);
    return total > 0 ? Math.round((finished / total) * 100) : 0;
  };

  const byPlatType = (platform: string, type: string) =>
    calc(launches.filter(launch => launch.platform === platform && launch.type === type));

  return {
    android: {
      critical: byPlatType('android', 'high_blocker'),
      smoke: byPlatType('android', 'smoke'),
      regression: calc(launches.filter(launch => launch.platform === 'android' && (launch.type === 'selective' || launch.type === 'regression'))),
      napi: calc(launches.filter(launch => launch.platform === 'napi')),
    },
    ios: {
      critical: byPlatType('ios', 'high_blocker'),
      smoke: byPlatType('ios', 'smoke'),
      regression: calc(launches.filter(launch => launch.platform === 'ios' && (launch.type === 'selective' || launch.type === 'regression'))),
      napi: 0,
    },
  };
}

export async function fetchReadinessLaunch(
  cfg: AllureConfig,
  platform: 'Android' | 'iOS',
  releaseVersion?: string
): Promise<AllureLaunch | null> {
  const nameCore = `[ALL][${platform}] Готовность к релизу`;
  const searches = releaseVersion
    ? [searchNameContains(`${nameCore} ${releaseVersion}`), searchNameContains(nameCore)]
    : [searchNameContains(nameCore)];

  for (const search of searches) {
    for (let page = 0; page < 6; page += 1) {
      const data = await allureFetch<{ content?: AllureLaunch[] }>(
        cfg,
        '/api/launch',
        {
          projectId: cfg.projectId,
          preview: true,
          sort: 'createdDate,desc',
          size: 100,
          page,
          search,
        }
      );

      const content = Array.isArray(data?.content) ? data.content : [];
      if (content.length) return content[0];
      if (content.length < 100) break;
    }
  }

  return null;
}

export async function fetchReadinessSummary(
  cfg: AllureConfig,
  releaseVersion?: string
): Promise<ReadinessLaunchSummary[]> {
  const platforms: Array<'Android' | 'iOS'> = ['Android', 'iOS'];
  const launches = await Promise.all(platforms.map(platform => fetchReadinessLaunch(cfg, platform, releaseVersion)));

  const summaries = await Promise.all(launches.map(async (launch, index) => {
    const platform = platforms[index] === 'Android' ? 'android' : 'ios';
    if (!launch) {
      return {
        platform,
        id: null,
        name: '',
        total: 0,
        finished: 0,
        pct: 0,
        url: null,
      } satisfies ReadinessLaunchSummary;
    }

    const stat = await fetchLaunchStats(cfg, Number(launch.id || 0)).catch(() => []);
    const counts = computeLaunchCountsExact(Array.isArray(stat) ? stat : []);
    const total = Number(counts.total || 0);
    const finished = Number(counts.finished || 0);
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0;

    return {
      platform,
      id: Number(launch.id || 0),
      name: String(launch.name || ''),
      total,
      finished,
      pct,
      url: `${cfg.base.replace(/\/+$/, '')}/launch/${launch.id}`,
    } satisfies ReadinessLaunchSummary;
  }));

  return summaries;
}

export async function fetchDashboardAggregate(
  cfg: AllureConfig,
  releaseVersion?: string
): Promise<DashboardAggregateResult> {
  const rawLaunches = await fetchLaunches(cfg, releaseVersion);
  const releaseCache = readDashboardReleaseCache(releaseVersion);
  const initialLaunches = rawLaunches
    .map(mapLaunch)
    .sort((a, b) => Number(b.createdDate || 0) - Number(a.createdDate || 0));
  const launchMap = new Map<number, AllureLaunchResult>(initialLaunches.map(launch => [launch.id, launch]));
  const agg = createEmptyDashboardAgg();
  const uwu = createEmptyDashboardUwuAgg();
  const alerts: DashboardAlertEntry[] = [];
  const nextCacheLaunches = { ...(releaseCache?.launches || {}) };
  const currentLaunchIds = new Set<string>();
  const launchesToRefresh: AllureLaunch[] = [];
  const allActiveLogins = new Set<string>();
  let allActivePeopleRawCount = 0; // fallback when logins are empty

  for (const rawLaunch of rawLaunches) {
    const launchId = Number(rawLaunch.id || 0);
    if (!launchId) continue;

    const launchKey = String(launchId);
    currentLaunchIds.add(launchKey);
    const label = dashboardLabelOf(String(rawLaunch.name || ''));
    const current = launchMap.get(launchId);
    const previewCounts = buildPreviewCounts(rawLaunch.statistic);
    const cachedEntry = sanitizeDashboardLaunchCacheEntry(nextCacheLaunches[launchKey]);

    if (current) {
      launchMap.set(launchId, applyCountsToLaunch(current, previewCounts));
    }

    if (!label) {
      nextCacheLaunches[launchKey] = {
        launchId,
        name: String(rawLaunch.name || ''),
        createdDate: Number(rawLaunch.createdDate || 0),
        status: rawLaunch.status || 'DONE',
        label: null,
        previewKey: buildLaunchPreviewKey(rawLaunch),
        updatedAt: Date.now(),
        counts: previewCounts,
        assignedUnfinished: 0,
        manualFinished: 0,
        uwu: null,
      };
      alerts.push({
        id: launchId,
        name: String(rawLaunch.name || ''),
        finished: Number(previewCounts.finished || 0),
        total: Number(previewCounts.total || 0),
      });
      continue;
    }

    if (cachedEntry && isReusableDashboardCacheEntry(cachedEntry, rawLaunch)) {
      const reusableEntry = cachedEntry;
      const counts = sanitizeDashboardCounts(reusableEntry.counts);
      if (current) {
        launchMap.set(launchId, applyCountsToLaunch(current, counts));
      }
      alerts.push({
        id: launchId,
        name: String(rawLaunch.name || ''),
        finished: Number(counts.finished || 0),
        total: Number(counts.total || 0),
      });
      mergeDashboardAggRow(agg[label], counts, Number(reusableEntry.assignedUnfinished || 0), Number(reusableEntry.manualFinished || 0));
      mergeDashboardUwuRow(uwu[label], reusableEntry.uwu);
      continue;
    }

    launchesToRefresh.push(rawLaunch);
  }

  await mapLimit(launchesToRefresh, 12, async rawLaunch => {
    const launchId = Number(rawLaunch.id || 0);
    if (!launchId) return;

    const launchKey = String(launchId);
    const label = dashboardLabelOf(String(rawLaunch.name || ''));
    const previewCounts = buildPreviewCounts(rawLaunch.statistic);
    const cachedEntry = sanitizeDashboardLaunchCacheEntry(nextCacheLaunches[launchKey]);
    const current = launchMap.get(launchId);

    const [stat, memberStats, launchUwu] = await Promise.all([
      fetchLaunchStats(cfg, launchId).catch(() => null),
      label ? fetchLaunchMemberStats(cfg, launchId).catch(() => null) : Promise.resolve(null),
      label && label.includes('[High/Blocker]')
        ? fetchLaunchUwuCounts(cfg, launchId).catch(() => null)
        : Promise.resolve(null),
    ]);

    const counts = Array.isArray(stat)
      ? computeLaunchCountsExact(stat)
      : cachedEntry?.counts || previewCounts;

    const assignedUnfinished = Array.isArray(memberStats)
      ? assignedUnfinishedFromMemberStats(memberStats)
      : Number(cachedEntry?.assignedUnfinished || 0);

    const manualFinished = Array.isArray(memberStats)
      ? completedFromMemberStats(memberStats)
      : Number(cachedEntry?.manualFinished || 0);

    if (Array.isArray(memberStats) && label) {
      const logins = activeLoginsFromMemberStats(memberStats);
      logins.forEach(login => allActiveLogins.add(login));
      // Track raw count for launches where login field is missing
      const rawCount = countActivePeopleFromMemberStats(memberStats);
      allActivePeopleRawCount = Math.max(allActivePeopleRawCount, rawCount);
    }

    const resolvedUwu = launchUwu || cachedEntry?.uwu || null;

    if (current) {
      launchMap.set(launchId, applyCountsToLaunch(current, counts));
    }

    alerts.push({
      id: launchId,
      name: String(rawLaunch.name || ''),
      finished: Number(counts.finished || 0),
      total: Number(counts.total || 0),
    });

    if (label) {
      mergeDashboardAggRow(agg[label], counts, assignedUnfinished, manualFinished);
      mergeDashboardUwuRow(uwu[label], resolvedUwu);
    }

    nextCacheLaunches[launchKey] = {
      launchId,
      name: String(rawLaunch.name || ''),
      createdDate: Number(rawLaunch.createdDate || 0),
      status: rawLaunch.status || 'DONE',
      label,
      previewKey: buildLaunchPreviewKey(rawLaunch),
      updatedAt: Date.now(),
      counts: sanitizeDashboardCounts(counts),
      assignedUnfinished,
      manualFinished,
      uwu: resolvedUwu,
    };
  });

  Object.keys(nextCacheLaunches).forEach(key => {
    if (!currentLaunchIds.has(key)) {
      delete nextCacheLaunches[key];
    }
  });

  if (releaseVersion) {
    writeDashboardReleaseCache({
      version: releaseVersion,
      savedAt: Date.now(),
      launches: nextCacheLaunches,
      readiness: releaseCache?.readiness,
    });
  }

  const activePeopleLogins = [...allActiveLogins];

  return {
    launches: [...launchMap.values()].sort((a, b) => Number(b.createdDate || 0) - Number(a.createdDate || 0)),
    agg,
    uwu,
    alerts: alerts.sort((a, b) => b.id - a.id),
    // Prefer login-dedup Set; fall back to raw count if logins weren't populated by API
    activePeopleCount: allActiveLogins.size > 0 ? allActiveLogins.size : allActivePeopleRawCount,
    activePeopleLogins,
  };
}
