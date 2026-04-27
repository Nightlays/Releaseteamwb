import { proxyFetch, type ProxyMode } from './proxy';

const PAGE_SIZE = 1000;
const KINDS = ['Smoke', 'Selective'] as const;
export const UWU_SWAT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwr0XB69uSvHtUDczPUq96NEpSwmcSuwj_KbZ3ULcu-2mVG9MtMcdH409dD-X6ozVL_Ug/exec';
const DAY_SLOTS = [
  { key: 'fri', title: 'Пятница', weekday: 5, threshold: 200 },
  { key: 'sat', title: 'Суббота', weekday: 6, threshold: 650 },
  { key: 'sun', title: 'Воскресенье', weekday: 0, threshold: 650 },
  { key: 'mon', title: 'Понедельник', weekday: 1, threshold: 650 },
] as const;

type UwuPlatformKey = 'Android' | 'iOS' | '—';
export type UwuPlatformFilter = Exclude<UwuPlatformKey, '—'> | null;

export interface UwuServiceConfig {
  base: string;
  token: string;
  projectId: string;
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
  swatEndpoint?: string;
}

export interface UwuRunOptions {
  releaseVersion: string;
  includeHighBlocker: boolean;
  includeSelective: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, status: string) => void;
}

export interface UwuPlatformStats {
  totalCases: number;
  uwuSum: number;
  uwuPresent: number;
  durTotalMs: number;
}

export interface UwuStats extends UwuPlatformStats {
  byPlatform: Partial<Record<UwuPlatformKey, UwuPlatformStats>>;
}

export interface UwuSwatMember {
  login: string;
  name: string;
  targetStream: string;
  daysWorked: number;
}

export interface UwuCaseDetail {
  testCaseId: number;
  uwuNum: number;
}

export interface UwuPersonStreamRow {
  stream: string;
  stats: UwuStats;
}

export interface UwuPersonRow extends UwuSwatMember {
  stats: UwuStats;
  caseDetails: UwuCaseDetail[];
  streams: UwuPersonStreamRow[];
}

export interface UwuStreamMemberRow extends UwuSwatMember {
  stats: UwuStats;
}

export interface UwuStreamRow {
  stream: string;
  stats: UwuStats;
  members: UwuStreamMemberRow[];
}

export interface UwuDayRow {
  login: string;
  name: string;
  cases: number;
  uwu: number;
  hours: number | null;
}

export interface UwuTimeEvent {
  login: string;
  name: string;
  dayKey: string;
  uwuNum: number;
  hourFloat: number;
  timeLabel: string;
}

export interface UwuDaySlot {
  key: 'fri' | 'sat' | 'sun' | 'mon';
  title: string;
  weekday: number;
  threshold: number;
  dayKey: string | null;
  label: string;
  rows: UwuDayRow[];
  events: UwuTimeEvent[];
}

export interface UwuLaunchSummary {
  id: number;
  name: string;
  stream: string;
  platform: UwuPlatformFilter;
  startMs: number;
  uwuSum: number;
  swatCaseCount: number;
  uwuCaseCount: number;
}

export interface UwuReport {
  releaseVersion: string;
  generatedAt: string;
  includeHighBlocker: boolean;
  includeSelective: boolean;
  launches: UwuLaunchSummary[];
  swatMembers: UwuSwatMember[];
  people: UwuPersonRow[];
  streams: UwuStreamRow[];
  daySlots: UwuDaySlot[];
  totals: {
    launchCount: number;
    leafCount: number;
    swatCaseCount: number;
    peopleCount: number;
    streamCount: number;
  };
}

interface SwatPayload {
  worked_SWAT?: {
    login?: Array<{
      login?: string;
      full_name?: string;
      stream?: string;
    }>;
  };
  worked_days?: Record<string, { login?: Record<string, number | string> }>;
}

interface AllureLaunch {
  id?: number;
  name?: string;
  createdDate?: number;
  start?: number;
  startTime?: number;
}

interface AllureMemberStat {
  assignee?: string;
  durationSum?: number;
}

interface AllureLeafItem {
  testedBy?: string;
  testCaseId?: number;
  start?: number;
  startTime?: number;
  time?: number;
  status?: string;
  _launchId?: number;
  _launchName?: string;
  _streamName?: string;
  _platform?: UwuPlatformFilter;
  _launchStart?: number;
}

interface TimelineLeaf {
  testedBy?: string;
  start?: number;
}

interface TimelineGroup {
  leafs?: TimelineLeaf[];
  groups?: TimelineGroup[];
}

interface TestCaseCustomField {
  name?: string;
  values?: Array<{ name?: string }>;
  customField?: { name?: string };
}

function normalizeLogin(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function createEmptyStats(): UwuStats {
  return {
    totalCases: 0,
    uwuSum: 0,
    uwuPresent: 0,
    durTotalMs: 0,
    byPlatform: {},
  };
}

function hasStats(stats: UwuStats) {
  return Number(stats.totalCases || 0) > 0
    || Number(stats.uwuSum || 0) > 0
    || Number(stats.uwuPresent || 0) > 0
    || Number(stats.durTotalMs || 0) > 0;
}

function cloneStats(stats: UwuStats): UwuStats {
  return {
    totalCases: Number(stats.totalCases || 0),
    uwuSum: Number(stats.uwuSum || 0),
    uwuPresent: Number(stats.uwuPresent || 0),
    durTotalMs: Number(stats.durTotalMs || 0),
    byPlatform: Object.fromEntries(
      Object.entries(stats.byPlatform || {}).map(([platform, bucket]) => [
        platform,
        {
          totalCases: Number(bucket?.totalCases || 0),
          uwuSum: Number(bucket?.uwuSum || 0),
          uwuPresent: Number(bucket?.uwuPresent || 0),
          durTotalMs: Number(bucket?.durTotalMs || 0),
        },
      ])
    ) as Partial<Record<UwuPlatformKey, UwuPlatformStats>>,
  };
}

function ensurePlatformBucket(stats: UwuStats, platform: UwuPlatformKey) {
  const existing = stats.byPlatform[platform];
  if (existing) return existing;
  const bucket = { totalCases: 0, uwuSum: 0, uwuPresent: 0, durTotalMs: 0 };
  stats.byPlatform[platform] = bucket;
  return bucket;
}

function addCaseStats(stats: UwuStats, uwuNum: number, hasUwU: number, platform: UwuPlatformFilter) {
  const key: UwuPlatformKey = platform || '—';
  stats.totalCases += 1;
  stats.uwuSum += uwuNum;
  stats.uwuPresent += hasUwU;
  const bucket = ensurePlatformBucket(stats, key);
  bucket.totalCases += 1;
  bucket.uwuSum += uwuNum;
  bucket.uwuPresent += hasUwU;
}

function addDurationStats(stats: UwuStats, durationMs: number, platform: UwuPlatformFilter) {
  const duration = Number(durationMs || 0);
  if (!duration) return;
  const key: UwuPlatformKey = platform || '—';
  stats.durTotalMs += duration;
  const bucket = ensurePlatformBucket(stats, key);
  bucket.durTotalMs += duration;
}

export function aggregateUwuStats(stats: UwuStats | null | undefined, platform: UwuPlatformFilter): UwuPlatformStats {
  if (!stats) return { totalCases: 0, uwuSum: 0, uwuPresent: 0, durTotalMs: 0 };
  if (!platform) {
    return {
      totalCases: Number(stats.totalCases || 0),
      uwuSum: Number(stats.uwuSum || 0),
      uwuPresent: Number(stats.uwuPresent || 0),
      durTotalMs: Number(stats.durTotalMs || 0),
    };
  }
  const bucket = stats.byPlatform?.[platform];
  return {
    totalCases: Number(bucket?.totalCases || 0),
    uwuSum: Number(bucket?.uwuSum || 0),
    uwuPresent: Number(bucket?.uwuPresent || 0),
    durTotalMs: Number(bucket?.durTotalMs || 0),
  };
}

export function normalizeUwuReleaseVersion(value: unknown) {
  const raw = String(value || '').trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!raw) return '';

  const normalizeBuildPart = (build: string | undefined) => {
    const digits = String(build || '').trim();
    if (!digits) return '0000';
    if (!/^\d{1,4}$/.test(digits)) return digits;
    return digits.padEnd(4, '0');
  };

  let match = raw.match(/^(\d+)\.(\d+)\.(\d{4})$/);
  if (match) {
    return `${Number(match[1])}.${Number(match[2])}.${match[3]}`;
  }

  match = raw.match(/^(\d+)\.(\d+)(?:\.(\d{1,3}))?$/);
  if (match) {
    return `${Number(match[1])}.${Number(match[2])}.${normalizeBuildPart(match[3])}`;
  }

  match = raw.match(/^(\d)(\d)(\d)$/);
  if (match) {
    return `${Number(match[1])}.${Number(match[2])}.${normalizeBuildPart(match[3])}`;
  }

  return raw;
}

function authHeader(token: string) {
  const raw = String(token || '').trim();
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  headers.Authorization = /^(Api-Token|Bearer)\s/i.test(raw) ? raw : `Api-Token ${raw}`;
  return headers;
}

function encodeSearchQuery(filters: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(filters));
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function buildSearch(term: string) {
  return encodeSearchQuery([{ id: 'name', type: 'string', value: term }]);
}

function pickCustomFieldValue(field: TestCaseCustomField | undefined) {
  const direct = typeof field?.name === 'string' ? field.name.trim() : '';
  if (direct) return direct;
  const nested = Array.isArray(field?.values) ? field.values.find(value => String(value?.name || '').trim()) : undefined;
  return String(nested?.name || '').trim();
}

function parseUwUNumber(raw: unknown) {
  if (raw == null) return 0;
  const text = String(raw).trim();
  if (!text || text === '0') return 0;
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

function extractStreamName(launchName: string) {
  if (!launchName) return '—';
  const match = /Stream\s+([^\]]+)/i.exec(launchName);
  if (match) return match[1].trim();
  let normalized = String(launchName);
  normalized = normalized
    .replace(/\[Android\]/gi, '')
    .replace(/\[iOS\]/gi, '')
    .replace(/\[High\/Blocker\]/gi, '')
    .replace(/\[Selective\]/gi, '')
    .replace(/\[DeployLab\]/gi, '')
    .replace(/\[Smoke\]/gi, '')
    .replace(/\[Regression\]/gi, '');
  normalized = normalized.replace(/Stream/gi, '');
  normalized = normalized.replace(/Регресс\s+[^\s]+/gi, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized || launchName;
}

function extractPlatformFromLaunchName(launchName: string): UwuPlatformFilter {
  if (!launchName) return null;
  if (/\[Android\]/i.test(launchName)) return 'Android';
  if (/\[iOS\]/i.test(launchName)) return 'iOS';
  return null;
}

function toMskDateKeyFromEpochMs(ms: number) {
  const date = new Date((Number(ms) || 0) + 3 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function toMskHourFloat(ms: number) {
  const date = new Date((Number(ms) || 0) + 3 * 60 * 60 * 1000);
  return date.getUTCHours() + (date.getUTCMinutes() / 60);
}

function toMskTimeLabel(ms: number) {
  const date = new Date((Number(ms) || 0) + 3 * 60 * 60 * 1000);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeDayKey(rawDay: unknown) {
  const value = String(rawDay || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDayKeyToUtcDate(dayKey: string) {
  return new Date(`${dayKey}T00:00:00Z`);
}

function dayLabelWithDate(dayName: string, dayKey: string | null) {
  if (!dayKey) return dayName;
  const date = parseDayKeyToUtcDate(dayKey);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dayName} (${dd}.${mm})`;
}

function latestDayKeyByWeekday(dayKeys: string[], weekday: number) {
  let best: string | null = null;
  for (const key of dayKeys) {
    const date = parseDayKeyToUtcDate(key);
    if (date.getUTCDay() !== weekday) continue;
    if (!best || key > best) best = key;
  }
  return best;
}

function incNestedMap(rootMap: Map<string, Map<string, number>>, dayKey: string, login: string, delta: number) {
  if (!dayKey || !login) return;
  let dayMap = rootMap.get(dayKey);
  if (!dayMap) {
    dayMap = new Map();
    rootMap.set(dayKey, dayMap);
  }
  dayMap.set(login, (dayMap.get(login) || 0) + delta);
}

function emitProgress(onProgress: UwuRunOptions['onProgress'], progress: number, status: string) {
  onProgress?.(Math.max(0, Math.min(100, progress)), status);
}

function walkTimelineGroups(node: TimelineGroup | null | undefined, onLeaf: (leaf: TimelineLeaf) => void) {
  if (!node) return;
  if (Array.isArray(node.leafs)) {
    for (const leaf of node.leafs) onLeaf(leaf);
  }
  if (Array.isArray(node.groups)) {
    for (const group of node.groups) walkTimelineGroups(group, onLeaf);
  }
}

async function fetchJson<T>(
  cfg: UwuServiceConfig,
  targetUrl: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<T> {
  const headers = {
    Accept: 'application/json',
    ...authHeader(cfg.token),
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };

  const response = (cfg.useProxy !== false && String(cfg.proxyBase || '').trim())
    ? await proxyFetch(
        {
          base: String(cfg.proxyBase).trim(),
          mode: cfg.proxyMode,
          signal,
        },
        targetUrl,
        { ...init, headers }
      )
    : await fetch(targetUrl, {
        ...init,
        headers,
        signal,
      });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const suffix = body ? ` — ${body.slice(0, 240)}` : '';
    throw new Error(`HTTP ${response.status} ${targetUrl}${suffix}`);
  }

  return response.json() as Promise<T>;
}

async function allureGet<T>(
  cfg: UwuServiceConfig,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(path, cfg.base.replace(/\/+$/, '/') );
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return fetchJson<T>(cfg, url.toString(), { method: 'GET' }, signal);
}

async function fetchSwatPayload(endpoint: string, releaseVersion: string, signal?: AbortSignal) {
  const url = new URL(endpoint);
  url.searchParams.set('release', releaseVersion);
  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить SWAT (HTTP ${response.status})`);
  }
  return response.json() as Promise<SwatPayload>;
}

function buildSwatDirectory(payload: SwatPayload) {
  const swatSet = new Set<string>();
  const swatNameMap = new Map<string, string>();
  const swatTargetStreamMap = new Map<string, string>();
  const swatDaysMap = new Map<string, number>();
  const workedHoursByDayLogin = new Map<string, Map<string, number>>();

  const swatList = Array.isArray(payload?.worked_SWAT?.login) ? payload.worked_SWAT!.login! : [];
  for (const item of swatList) {
    const loginNorm = normalizeLogin(item?.login);
    if (!loginNorm) continue;
    swatSet.add(loginNorm);
    const fullName = String(item?.full_name || '').trim();
    swatNameMap.set(loginNorm, fullName || String(item?.login || loginNorm));
    const targetStream = String(item?.stream || '').trim();
    if (targetStream) swatTargetStreamMap.set(loginNorm, targetStream);
  }

  const workedDays = payload?.worked_days && typeof payload.worked_days === 'object'
    ? payload.worked_days
    : {};

  Object.entries(workedDays).forEach(([rawDay, dayObj]) => {
    const dayKey = normalizeDayKey(rawDay);
    const logins = dayObj?.login && typeof dayObj.login === 'object' ? dayObj.login : {};
    Object.entries(logins).forEach(([login, hours]) => {
      const loginNorm = normalizeLogin(login);
      if (!loginNorm) return;
      swatDaysMap.set(loginNorm, (swatDaysMap.get(loginNorm) || 0) + 1);
      if (!dayKey) return;
      const hoursNum = Number(hours);
      if (!Number.isFinite(hoursNum)) return;
      let dayMap = workedHoursByDayLogin.get(dayKey);
      if (!dayMap) {
        dayMap = new Map();
        workedHoursByDayLogin.set(dayKey, dayMap);
      }
      dayMap.set(loginNorm, hoursNum);
    });
  });

  return {
    swatSet,
    swatNameMap,
    swatTargetStreamMap,
    swatDaysMap,
    workedHoursByDayLogin,
  };
}

async function findLaunches(
  cfg: UwuServiceConfig,
  releaseVersion: string,
  includeHighBlocker: boolean,
  includeSelective: boolean,
  signal?: AbortSignal
) {
  if (!includeHighBlocker && !includeSelective) {
    return [];
  }

  const launches = new Map<number, AllureLaunch>();
  const useLegacyLogic = includeHighBlocker && includeSelective;
  const terms: string[] = [];

  if (useLegacyLogic) {
    for (const kind of KINDS) {
      terms.push(`[${kind}] Регресс ${releaseVersion}`);
      if (kind === 'Smoke') {
        terms.push(`[High/Blocker][DeployLab] Регресс ${releaseVersion}`);
      }
      if (kind === 'Selective') {
        terms.push(`[Selective][DeployLab] Регресс ${releaseVersion}`);
      }
    }
  } else {
    if (includeHighBlocker) terms.push(`[High/Blocker][DeployLab] Регресс ${releaseVersion}`);
    if (includeSelective) terms.push(`[Selective][DeployLab] Регресс ${releaseVersion}`);
  }

  for (const term of terms) {
    for (let page = 0; page < 100; page += 1) {
      const data = await allureGet<{ content?: AllureLaunch[] }>(
        cfg,
        '/api/launch',
        {
          page,
          size: PAGE_SIZE,
          search: buildSearch(term),
          projectId: cfg.projectId,
          preview: true,
          sort: 'createdDate,desc',
        },
        signal
      );
      const content = Array.isArray(data?.content) ? data.content : [];
      if (!content.length) break;
      content.forEach(item => {
        const id = Number(item?.id || 0);
        if (!Number.isNaN(id) && id > 0) launches.set(id, item);
      });
      if (content.length < PAGE_SIZE) break;
    }
  }

  return Array.from(launches.values());
}

async function listLeaf(cfg: UwuServiceConfig, launchId: number, signal?: AbortSignal) {
  const items: AllureLeafItem[] = [];
  for (let page = 0; page < 100; page += 1) {
    const data = await allureGet<{ content?: AllureLeafItem[] }>(
      cfg,
      '/api/testresulttree/leaf',
      {
        launchId,
        sort: 'name,asc',
        size: PAGE_SIZE,
        page,
      },
      signal
    );
    const content = Array.isArray(data?.content) ? data.content : [];
    if (!content.length) break;
    items.push(...content);
    if (content.length < PAGE_SIZE) break;
  }
  return items;
}

async function fetchTimeline(cfg: UwuServiceConfig, launchId: number, signal?: AbortSignal) {
  return allureGet<{ groups?: TimelineGroup[] }>(
    cfg,
    '/api/testresult/timeline',
    {
      launchId,
      label: 'host, thread',
    },
    signal
  );
}

async function fetchLaunchMemberStats(cfg: UwuServiceConfig, launchId: number, signal?: AbortSignal) {
  const data = await allureGet<{ content?: AllureMemberStat[] }>(
    cfg,
    `/api/launch/${launchId}/memberstats`,
    {
      size: 1000,
      page: 0,
    },
    signal
  );
  return Array.isArray(data?.content) ? data.content : [];
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

export async function fetchUwuReport(cfg: UwuServiceConfig, options: UwuRunOptions): Promise<UwuReport> {
  const token = String(cfg.token || '').trim();
  const releaseVersion = normalizeUwuReleaseVersion(options.releaseVersion);
  if (!token) {
    throw new Error('Не задан Allure token.');
  }
  if (!releaseVersion) {
    throw new Error('Не задан релиз.');
  }

  emitProgress(options.onProgress, 0, 'Читаю SWAT…');
  const swatPayload = await fetchSwatPayload(cfg.swatEndpoint || UWU_SWAT_ENDPOINT, releaseVersion, options.signal);
  const {
    swatSet,
    swatNameMap,
    swatTargetStreamMap,
    swatDaysMap,
    workedHoursByDayLogin,
  } = buildSwatDirectory(swatPayload);

  emitProgress(options.onProgress, 5, 'Ищу лаунчи Smoke/Selective…');
  const launches = await findLaunches(cfg, releaseVersion, options.includeHighBlocker, options.includeSelective, options.signal);

  if (!launches.length) {
    return {
      releaseVersion,
      generatedAt: new Date().toISOString(),
      includeHighBlocker: options.includeHighBlocker,
      includeSelective: options.includeSelective,
      launches: [],
      swatMembers: Array.from(swatSet).map(login => ({
        login,
        name: swatNameMap.get(login) || login,
        targetStream: swatTargetStreamMap.get(login) || '',
        daysWorked: Number(swatDaysMap.get(login) || 0),
      })),
      people: [],
      streams: [],
      daySlots: DAY_SLOTS.map(slot => ({
        ...slot,
        dayKey: null,
        label: slot.title,
        rows: [],
        events: [],
      })),
      totals: {
        launchCount: 0,
        leafCount: 0,
        swatCaseCount: 0,
        peopleCount: 0,
        streamCount: 0,
      },
    };
  }

  const peopleStatsMap = new Map<string, UwuStats>();
  const caseDetailsMap = new Map<string, UwuCaseDetail[]>();
  const streamStatsMap = new Map<string, UwuStats>();
  const streamSwatStatsMap = new Map<string, Map<string, UwuStats>>();
  const timelineStartsByLaunchLogin = new Map<number, Map<string, number[]>>();
  const casesByDayLogin = new Map<string, Map<string, number>>();
  const uwuByDayLogin = new Map<string, Map<string, number>>();
  const uwuTimeEvents: Array<Omit<UwuTimeEvent, 'name'>> = [];
  const testCaseCache = new Map<number, Promise<{ uwuRaw: string; platform: string }>>();
  const launchSummaryMap = new Map<number, UwuLaunchSummary>();
  let allLeafItems: AllureLeafItem[] = [];

  emitProgress(options.onProgress, 10, `Найдено лаунчей: ${launches.length}. Читаю тест-кейсы…`);

  const getTestCaseUwU = async (testCaseId: number) => {
    if (testCaseCache.has(testCaseId)) {
      return testCaseCache.get(testCaseId)!;
    }
    const promise = allureGet<{ customFields?: TestCaseCustomField[] }>(
      cfg,
      `/api/testcase/${testCaseId}/overview`,
      {},
      options.signal
    )
      .then(data => {
        const fields = Array.isArray(data?.customFields) ? data.customFields : [];
        const uwuField = fields.find(field => String(field?.customField?.name || '').trim() === 'UwU');
        const platformField = fields.find(field => String(field?.customField?.name || '').trim() === 'Platform');
        return {
          uwuRaw: pickCustomFieldValue(uwuField),
          platform: pickCustomFieldValue(platformField),
        };
      })
      .catch(() => ({ uwuRaw: '', platform: '' }));
    testCaseCache.set(testCaseId, promise);
    return promise;
  };

  let processedLaunches = 0;
  for (const launch of launches) {
    const id = Number(launch?.id || 0);
    if (!id) continue;

    const launchName = String(launch?.name || '');
    const streamName = extractStreamName(launchName);
    const platform = extractPlatformFromLaunchName(launchName);
    const launchStart = Number(launch?.start || launch?.startTime || launch?.createdDate || 0);

    launchSummaryMap.set(id, {
      id,
      name: launchName,
      stream: streamName,
      platform,
      startMs: launchStart,
      uwuSum: 0,
      swatCaseCount: 0,
      uwuCaseCount: 0,
    });

    const memberStats = await fetchLaunchMemberStats(cfg, id, options.signal).catch(() => []);
    memberStats.forEach(member => {
      const assignee = normalizeLogin(member?.assignee);
      if (!assignee || !swatSet.has(assignee)) return;
      const durationMs = Number(member?.durationSum || 0);
      if (!durationMs) return;

      let personStats = peopleStatsMap.get(assignee);
      if (!personStats) {
        personStats = createEmptyStats();
        peopleStatsMap.set(assignee, personStats);
      }
      addDurationStats(personStats, durationMs, platform);

      let streamStats = streamStatsMap.get(streamName);
      if (!streamStats) {
        streamStats = createEmptyStats();
        streamStatsMap.set(streamName, streamStats);
      }
      addDurationStats(streamStats, durationMs, platform);

      let streamMembers = streamSwatStatsMap.get(streamName);
      if (!streamMembers) {
        streamMembers = new Map();
        streamSwatStatsMap.set(streamName, streamMembers);
      }
      let streamPersonStats = streamMembers.get(assignee);
      if (!streamPersonStats) {
        streamPersonStats = createEmptyStats();
        streamMembers.set(assignee, streamPersonStats);
      }
      addDurationStats(streamPersonStats, durationMs, platform);
    });

    const leafItems = await listLeaf(cfg, id, options.signal);
    leafItems.forEach(item => {
      item._launchId = id;
      item._launchName = launchName;
      item._streamName = streamName;
      item._platform = platform;
      item._launchStart = launchStart;
    });

    try {
      const timeline = await fetchTimeline(cfg, id, options.signal);
      const roots = Array.isArray(timeline?.groups) ? timeline.groups : [];
      const startsByLogin = new Map<string, number[]>();
      roots.forEach(group => {
        walkTimelineGroups(group, leaf => {
          const testedBy = normalizeLogin(leaf?.testedBy);
          if (!testedBy || !swatSet.has(testedBy)) return;
          const startMs = Number(leaf?.start || 0);
          if (!startMs) return;
          const arr = startsByLogin.get(testedBy) || [];
          arr.push(startMs);
          startsByLogin.set(testedBy, arr);
        });
      });
      startsByLogin.forEach(arr => arr.sort((a, b) => a - b));
      timelineStartsByLaunchLogin.set(id, startsByLogin);
    } catch {
      /* ignore timeline errors */
    }

    allLeafItems = allLeafItems.concat(leafItems);
    processedLaunches += 1;
    emitProgress(
      options.onProgress,
      10 + Math.round((processedLaunches / launches.length) * 20),
      `Читаю тест-кейсы… (${processedLaunches}/${launches.length})`
    );
  }

  const swatItems = allLeafItems.filter(item => {
    const testedBy = normalizeLogin(item?.testedBy);
    return Boolean(testedBy && swatSet.has(testedBy) && item?.testCaseId != null);
  });

  emitProgress(options.onProgress, 35, `SWAT-кейсов: ${swatItems.length}. Считаю UwU…`);

  let processedCases = 0;
  await mapLimit(swatItems, 10, async item => {
    const login = normalizeLogin(item?.testedBy);
    const testCaseId = Number(item?.testCaseId || 0);
    if (!login || !testCaseId) {
      processedCases += 1;
      return;
    }

    const overview = await getTestCaseUwU(testCaseId);
    const uwuNum = parseUwUNumber(overview.uwuRaw);
    const hasUwU = uwuNum > 0 ? 1 : 0;
    const streamName = item._streamName || extractStreamName(String(item._launchName || ''));
    const platform = item._platform || null;
    const launchId = Number(item._launchId || 0);
    const launchSummary = launchId ? launchSummaryMap.get(launchId) : null;
    if (launchSummary) {
      launchSummary.swatCaseCount += 1;
      launchSummary.uwuSum += uwuNum;
      if (uwuNum > 0) {
        launchSummary.uwuCaseCount += 1;
      }
    }

    let startMs = Number(item?.start || item?.startTime || item?.time || 0);
    if (!startMs && launchId) {
      const startsByLogin = timelineStartsByLaunchLogin.get(launchId);
      const queue = startsByLogin?.get(login);
      if (queue && queue.length) {
        startMs = Number(queue.shift() || 0);
      }
    }
    if (!startMs) {
      startMs = Number(item._launchStart || 0);
    }

    if (startMs) {
      const dayKey = toMskDateKeyFromEpochMs(startMs);
      incNestedMap(casesByDayLogin, dayKey, login, 1);
      incNestedMap(uwuByDayLogin, dayKey, login, uwuNum);

      const hourFloat = toMskHourFloat(startMs);
      if (uwuNum > 0 && hourFloat >= 10 && hourFloat <= 22) {
        uwuTimeEvents.push({
          login,
          dayKey,
          uwuNum,
          hourFloat,
          timeLabel: toMskTimeLabel(startMs),
        });
      }
    }

    let personStats = peopleStatsMap.get(login);
    if (!personStats) {
      personStats = createEmptyStats();
      peopleStatsMap.set(login, personStats);
    }
    addCaseStats(personStats, uwuNum, hasUwU, platform);

    const personCases = caseDetailsMap.get(login) || [];
    personCases.push({ testCaseId, uwuNum });
    caseDetailsMap.set(login, personCases);

    let streamStats = streamStatsMap.get(streamName);
    if (!streamStats) {
      streamStats = createEmptyStats();
      streamStatsMap.set(streamName, streamStats);
    }
    addCaseStats(streamStats, uwuNum, hasUwU, platform);

    let streamMembers = streamSwatStatsMap.get(streamName);
    if (!streamMembers) {
      streamMembers = new Map();
      streamSwatStatsMap.set(streamName, streamMembers);
    }
    let streamPersonStats = streamMembers.get(login);
    if (!streamPersonStats) {
      streamPersonStats = createEmptyStats();
      streamMembers.set(login, streamPersonStats);
    }
    addCaseStats(streamPersonStats, uwuNum, hasUwU, platform);

    processedCases += 1;
    if (processedCases % 10 === 0 || processedCases === swatItems.length) {
      emitProgress(
        options.onProgress,
        35 + Math.round((processedCases / Math.max(1, swatItems.length)) * 65),
        `Обработано SWAT-кейсов: ${processedCases}/${swatItems.length}`
      );
    }
  });

  const swatMembers = Array.from(swatSet)
    .map(login => ({
      login,
      name: swatNameMap.get(login) || login,
      targetStream: swatTargetStreamMap.get(login) || '',
      daysWorked: Number(swatDaysMap.get(login) || 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));

  const people = swatMembers
    .map(member => {
      const stats = peopleStatsMap.get(member.login) || createEmptyStats();
      const streams = Array.from(streamSwatStatsMap.entries())
        .map(([stream, members]) => ({
          stream,
          stats: members.get(member.login) || createEmptyStats(),
        }))
        .filter(entry => hasStats(entry.stats))
        .sort((a, b) => b.stats.uwuSum - a.stats.uwuSum || a.stream.localeCompare(b.stream, 'ru'));

      return {
        ...member,
        stats,
        caseDetails: [...(caseDetailsMap.get(member.login) || [])].sort((a, b) => b.uwuNum - a.uwuNum || b.testCaseId - a.testCaseId),
        streams,
      } satisfies UwuPersonRow;
    })
    .filter(row => hasStats(row.stats) || row.caseDetails.length || row.streams.length);

  const streams = Array.from(streamStatsMap.entries())
    .map(([stream, stats]) => ({
      stream,
      stats,
      members: Array.from((streamSwatStatsMap.get(stream) || new Map()).entries())
        .map(([login, memberStats]) => ({
          login,
          name: swatNameMap.get(login) || login,
          targetStream: swatTargetStreamMap.get(login) || '',
          daysWorked: Number(swatDaysMap.get(login) || 0),
          stats: memberStats,
        }))
        .filter(member => hasStats(member.stats))
        .sort((a, b) => b.stats.uwuSum - a.stats.uwuSum || a.name.localeCompare(b.name, 'ru')),
    }))
    .filter(row => hasStats(row.stats))
    .sort((a, b) => b.stats.uwuSum - a.stats.uwuSum || a.stream.localeCompare(b.stream, 'ru'));

  const allDayKeys = Array.from(new Set([...casesByDayLogin.keys(), ...uwuByDayLogin.keys()])).sort();
  const daySlots = DAY_SLOTS.map(slot => {
    const dayKey = latestDayKeyByWeekday(allDayKeys, slot.weekday);
    const caseMap = dayKey ? (casesByDayLogin.get(dayKey) || new Map()) : new Map<string, number>();
    const uwuMap = dayKey ? (uwuByDayLogin.get(dayKey) || new Map()) : new Map<string, number>();
    const hoursMap = dayKey ? (workedHoursByDayLogin.get(dayKey) || new Map()) : new Map<string, number>();
    const logins = new Set([...caseMap.keys(), ...uwuMap.keys()]);
    const rows = Array.from(logins)
      .map(login => ({
        login,
        name: swatNameMap.get(login) || login,
        cases: Number(caseMap.get(login) || 0),
        uwu: Number(uwuMap.get(login) || 0),
        hours: hoursMap.has(login) ? Number(hoursMap.get(login) || 0) : null,
      }))
      .filter(row => row.cases > 0 || row.uwu > 0)
      .sort((a, b) => b.uwu - a.uwu || b.cases - a.cases || a.name.localeCompare(b.name, 'ru'));

    const events = uwuTimeEvents
      .filter(event => event.dayKey === dayKey)
      .map(event => ({
        ...event,
        name: swatNameMap.get(event.login) || event.login,
      }))
      .sort((a, b) => a.hourFloat - b.hourFloat || a.name.localeCompare(b.name, 'ru'));

    return {
      ...slot,
      dayKey,
      label: dayLabelWithDate(slot.title, dayKey),
      rows,
      events,
    } satisfies UwuDaySlot;
  });

  emitProgress(options.onProgress, 100, 'Готово. Можно смотреть отчёт и выгружать результат.');

  return {
    releaseVersion,
    generatedAt: new Date().toISOString(),
    includeHighBlocker: options.includeHighBlocker,
    includeSelective: options.includeSelective,
    launches: Array.from(launchSummaryMap.values()).sort((a, b) => b.startMs - a.startMs || b.id - a.id),
    swatMembers,
    people,
    streams,
    daySlots,
    totals: {
      launchCount: launchSummaryMap.size,
      leafCount: allLeafItems.length,
      swatCaseCount: swatItems.length,
      peopleCount: people.length,
      streamCount: streams.length,
    },
  };
}
