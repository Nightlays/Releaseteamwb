import { proxyFetch, type ProxyMode } from './proxy';

const SWAT_DAYS_URL = 'https://script.google.com/macros/s/AKfycbwr0XB69uSvHtUDczPUq96NEpSwmcSuwj_KbZ3ULcu-2mVG9MtMcdH409dD-X6ozVL_Ug/exec';

export interface SwatServiceConfig {
  base: string;
  token: string;
  projectId: string;
  signal?: AbortSignal;
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
}

export interface SwatEmployeeDayCell {
  day: string;
  worked: boolean;
  text: string;
  title: string;
}

export interface SwatEmployeeRow {
  login: string;
  fullName: string;
  platform: 'android' | 'ios' | 'both' | 'other';
  targetStream: string;
  allStreamsText: string;
  allStreamsHover: string;
  uwuSum: number;
  uwuText: string;
  workedHoursTotal: number;
  uwuPerHour: number | null;
  uwuPerHourText: string;
  iosMinutes: number;
  androidMinutes: number;
  iosHoursText: string;
  androidHoursText: string;
  iosCases: number;
  androidCases: number;
  avgMsPerCase: number;
  avgText: string;
  days: SwatEmployeeDayCell[];
}

export interface SwatPlatformModel {
  days: string[];
  amountByDay: Record<string, { Android: number; iOS: number; All: number }>;
  avgByDay: Record<string, { Android: number; iOS: number; All: number }>;
  workersByDay: Record<string, { Android: number; iOS: number; All: number }>;
  releaseAvgA: number;
  releaseAvgI: number;
  releaseAvgAll: number;
  swatCountByDay: Record<string, number>;
  uniqueWorkersA: number;
  uniqueWorkersI: number;
}

export interface SwatChartRow {
  login: string;
  fullName: string;
  dayCounts: number[];
  total: number;
}

export interface SwatChartStreamRow {
  login: string;
  fullName: string;
  streams: Array<{
    stream: string;
    dayCounts: number[];
    total: number;
  }>;
}

export interface SwatLaunchSummary {
  id: number;
  name: string;
  stream: string;
  platform: 'Android' | 'iOS' | 'Other';
  url: string;
}

export interface SwatUserOption {
  login: string;
  fullName: string;
}

export interface SwatReleaseReport {
  release: string;
  days: string[];
  swatCount: number;
  launchesCount: number;
  totalCases: number;
  totalCasesAndroid: number;
  totalCasesIos: number;
  overallAvgMMSS: string;
  employees: SwatEmployeeRow[];
  platformModel: SwatPlatformModel;
  launches: SwatLaunchSummary[];
  chartRowsAndroid: SwatChartRow[];
  chartRowsIos: SwatChartRow[];
  chartRowsStreams: SwatChartStreamRow[];
  users: SwatUserOption[];
}

type LogFn = (text: string, level?: 'info' | 'ok' | 'warn' | 'error') => void;
type ProgressFn = (value: number) => void;

interface SwatLaunch {
  id?: number;
  name?: string;
}

interface SwatMemberStatItem {
  assignee?: string;
  durationSum?: number;
  retriedCount?: number;
  statistic?: Array<{ status?: string; count?: number }>;
}

interface TimelineLeaf {
  testedBy?: string;
  start?: number;
  stop?: number;
  duration?: number;
}

interface TimelineNode {
  groups?: TimelineNode[];
  leafs?: TimelineLeaf[];
}

interface LeafItem {
  testedBy?: string;
  testCaseId?: number;
}

interface SwatBundleEntry {
  login?: string;
  full_name?: string;
  stream?: string;
}

interface SwatBundle {
  worked_SWAT?: { login?: SwatBundleEntry[] };
  worked_days?: Record<string, { login?: Record<string, number> }>;
}

interface TestCaseCustomField {
  name?: string;
  values?: Array<{ name?: string }>;
  customField?: { name?: string };
}

function toInt(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toNum(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeLogin(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function platformOfLaunchName(name: string): 'Android' | 'iOS' | 'Other' {
  const s = String(name || '');
  if (s.includes('[Android]')) return 'Android';
  if (s.includes('[iOS]')) return 'iOS';
  return 'Other';
}

function shortStreamName(launchName: string) {
  const name = String(launchName || '').trim();
  const match = /\[Stream\s*([^\]]+)\]/i.exec(name);
  if (match && match[1]) return match[1].trim();
  return name
    .replace(/\[High\/Blocker\]\s*/g, '')
    .replace(/\[DeployLab\]\s*/g, '')
    .replace(/\s*\[(Android|iOS)\]\s*/g, ' ')
    .trim();
}

function memberTotalCount(memberItem: SwatMemberStatItem) {
  let count = 0;
  const stats = Array.isArray(memberItem?.statistic) ? memberItem.statistic : [];
  for (const item of stats) {
    if (!('status' in item) || item.status == null) continue;
    count += toInt(item.count);
  }
  return count;
}

function fmtMMSSFromMs(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtHHMMFromMinutes(min: number) {
  const m = Math.max(0, Math.round(toNum(min)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

export function formatUwU(value: number) {
  const x = toNum(value);
  if (!Number.isFinite(x) || x <= 0) return '0';
  const s = x.toFixed(2);
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function calcUwUPerHour(uwuSum: number, workedHours: number) {
  const uwu = toNum(uwuSum);
  const hours = toNum(workedHours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return uwu / hours;
}

function fmtShiftHours(h: number) {
  const n = toNum(h);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = String(n);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export function ruDowShort(dateStr: string) {
  const [y, m, d] = String(dateStr).split('-').map(n => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay();
  return ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][day] || '—';
}

export function ddmm(dateStr: string) {
  const [_, m, d] = String(dateStr).split('-');
  if (!m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}

function toMskDateKeyFromEpochMs(ms: number) {
  const d = new Date(toInt(ms) + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal) {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  }
  const concurrency = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function b64Query(obj: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function buildHeaders(token: string) {
  const rawToken = String(token || '').trim();
  const authValue = /^Api-Token\s+/i.test(rawToken) || /^Bearer\s+/i.test(rawToken)
    ? rawToken
    : `Api-Token ${rawToken}`;
  return {
    Accept: 'application/json',
    Authorization: authValue,
  };
}

async function getJson<T>(cfg: SwatServiceConfig, url: string): Promise<T> {
  const init: RequestInit = { headers: buildHeaders(cfg.token), signal: cfg.signal };
  let response: Response;
  if (cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    response = await proxyFetch(
      {
        base: String(cfg.proxyBase).trim(),
        mode: cfg.proxyMode,
        signal: cfg.signal,
      },
      url,
      init
    );
  } else {
    response = await fetch(url, init);
  }

  if (!response.ok) {
    throw new Error(`SWAT HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function getPublicJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`SWAT days HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchSwatDaysBundle(release: string, signal?: AbortSignal) {
  const u = new URL(SWAT_DAYS_URL);
  u.searchParams.set('release', release);
  return getPublicJson<SwatBundle>(u.toString(), signal);
}

async function fetchLaunchesHB(cfg: SwatServiceConfig, version: string) {
  const terms = [
    `[High/Blocker][DeployLab] Регресс ${version}`,
    `[High/Blocker] Регресс ${version}`,
  ];

  const uniq = new Map<number, SwatLaunch>();
  const size = 1000;

  for (const term of terms) {
    const search = b64Query([{ id: 'name', type: 'string', value: term }]);
    let page = 0;

    while (true) {
      const url = new URL(`${cfg.base.replace(/\/+$/, '')}/api/launch`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('size', String(size));
      url.searchParams.set('search', search);
      url.searchParams.set('projectId', String(cfg.projectId));
      url.searchParams.set('preview', 'true');
      url.searchParams.set('sort', 'createdDate,desc');

      const data = await getJson<{ content?: SwatLaunch[] }>(cfg, url.toString());
      const content = Array.isArray(data?.content) ? data.content : [];
      if (!content.length) break;

      for (const item of content) {
        const id = toInt(item?.id);
        if (!id) continue;
        uniq.set(id, item);
      }

      if (content.length < size) break;
      page += 1;
    }
  }

  return Array.from(uniq.values());
}

async function fetchMemberStats(cfg: SwatServiceConfig, launchId: number) {
  const url = new URL(`${cfg.base.replace(/\/+$/, '')}/api/launch/${launchId}/memberstats`);
  url.searchParams.set('size', '1000');
  url.searchParams.set('page', '0');
  const data = await getJson<{ content?: SwatMemberStatItem[] } | SwatMemberStatItem[]>(cfg, url.toString());
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { content?: SwatMemberStatItem[] }).content)) {
    return (data as { content?: SwatMemberStatItem[] }).content || [];
  }
  return [];
}

async function fetchTimeline(cfg: SwatServiceConfig, launchId: number) {
  const url = new URL(`${cfg.base.replace(/\/+$/, '')}/api/testresult/timeline`);
  url.searchParams.set('launchId', String(launchId));
  url.searchParams.set('label', 'host, thread');
  return getJson<{ groups?: TimelineNode[] }>(cfg, url.toString());
}

function walkTimelineGroups(node: TimelineNode | undefined, onLeaf: (leaf: TimelineLeaf) => void) {
  if (!node) return;
  if (Array.isArray(node.leafs)) {
    for (const leaf of node.leafs) onLeaf(leaf);
  }
  if (Array.isArray(node.groups)) {
    for (const group of node.groups) walkTimelineGroups(group, onLeaf);
  }
}

async function listLeaf(cfg: SwatServiceConfig, launchId: number) {
  const out: LeafItem[] = [];
  const pageSize = 500;
  let page = 0;
  while (true) {
    const url = new URL(`${cfg.base.replace(/\/+$/, '')}/api/testresulttree/leaf`);
    url.searchParams.set('launchId', String(launchId));
    url.searchParams.set('sort', 'name,asc');
    url.searchParams.set('size', String(pageSize));
    url.searchParams.set('page', String(page));
    const data = await getJson<{ content?: LeafItem[] }>(cfg, url.toString());
    const content = Array.isArray(data?.content) ? data.content : [];
    if (!content.length) break;
    out.push(...content);
    if (content.length < pageSize) break;
    page += 1;
  }
  return out;
}

function pickCustomFieldValue(field: TestCaseCustomField | undefined) {
  const direct = typeof field?.name === 'string' ? field.name.trim() : '';
  if (direct) return direct;
  const nested = Array.isArray(field?.values) ? field.values.find(value => String(value?.name || '').trim()) : undefined;
  return String(nested?.name || '').trim();
}

function parseUwUNumber(raw: unknown) {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim();
  if (!s || s === '0') return 0;
  const num = parseFloat(s.replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

async function fetchTestCaseOverview(cfg: SwatServiceConfig, testCaseId: number) {
  const url = `${cfg.base.replace(/\/+$/, '')}/api/testcase/${testCaseId}/overview`;
  return getJson<{ customFields?: TestCaseCustomField[] }>(cfg, url);
}

export async function buildSwatReleaseReport(
  cfg: SwatServiceConfig,
  release: string,
  options?: {
    onLog?: LogFn;
    onProgress?: ProgressFn;
  }
): Promise<SwatReleaseReport> {
  const cleanRelease = String(release || '').trim();
  const cleanToken = String(cfg.token || '').trim();
  if (!cleanToken) throw new Error('Вставьте Allure Api-Token.');
  if (!cleanRelease) throw new Error('Укажите версию релиза (например 7.4.5000).');

  const log = (text: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') => options?.onLog?.(text, level);
  const progress = (value: number) => options?.onProgress?.(value);

  log('[Шаг 1/4] Получаю SWAT и worked_days…');
  progress(10);
  const swatBundle = await fetchSwatDaysBundle(cleanRelease, cfg.signal);

  const rawList = Array.isArray(swatBundle?.worked_SWAT?.login) ? swatBundle.worked_SWAT.login : [];
  const swatEntries = rawList
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const login = normalizeLogin(item.login);
      if (!login) return null;
      return {
        login,
        full_name: String(item.full_name || '').trim() || login,
        targetStream: String(item.stream || '').trim() || '',
      };
    })
    .filter(Boolean) as Array<{ login: string; full_name: string; targetStream: string }>;

  swatEntries.sort((a, b) => {
    const an = String(a.full_name || a.login || '');
    const bn = String(b.full_name || b.login || '');
    const c = an.localeCompare(bn, 'ru');
    if (c !== 0) return c;
    return String(a.login).localeCompare(String(b.login), 'ru');
  });

  if (!swatEntries.length) {
    throw new Error('SWAT список пустой.');
  }

  const swatLogins = swatEntries.map(item => item.login);
  const swatSet = new Set(swatLogins);
  const fullNameByLogin = Object.fromEntries(swatEntries.map(item => [item.login, item.full_name]));
  const targetStreamByLogin = Object.fromEntries(swatEntries.map(item => [item.login, item.targetStream]));
  const users: SwatUserOption[] = swatEntries.map(item => ({ login: item.login, fullName: item.full_name }));

  const workedDays = swatBundle && typeof swatBundle === 'object' && swatBundle.worked_days && typeof swatBundle.worked_days === 'object'
    ? swatBundle.worked_days
    : {};

  const days = Object.keys(workedDays).sort();
  const presenceByDay: Record<string, Set<string>> = {};
  const shiftHoursByDay: Record<string, Record<string, number>> = {};
  const totalWorkedHoursByLogin: Record<string, number> = {};
  const swatCountByDay: Record<string, number> = {};

  for (const day of days) {
    const map = workedDays?.[day]?.login && typeof workedDays[day].login === 'object' ? workedDays[day].login : {};
    const set = new Set<string>();
    const shiftMap: Record<string, number> = {};
    for (const [login, value] of Object.entries(map || {})) {
      const normalized = normalizeLogin(login);
      if (!normalized) continue;
      set.add(normalized);
      const hours = toNum(value);
      shiftMap[normalized] = hours;
      totalWorkedHoursByLogin[normalized] = toNum(totalWorkedHoursByLogin[normalized]) + hours;
    }
    presenceByDay[day] = set;
    shiftHoursByDay[day] = shiftMap;
    swatCountByDay[day] = set.size;
  }

  log('[Шаг 2/4] Ищу High/Blocker запуски…');
  progress(25);
  const launches = await fetchLaunchesHB(cfg, cleanRelease);
  if (!launches.length) {
    throw new Error('Не найдено запусков High/Blocker для этого релиза.');
  }
  log(`Найдено запусков: ${launches.length}`, 'ok');

  log('[Шаг 3/4] Считаю memberstats…');
  progress(35);
  const perUser: Record<string, { iosDurMs: number; androidDurMs: number; iosCases: number; androidCases: number; streams: Record<string, { iosDurMs: number; androidDurMs: number; iosCases: number; androidCases: number }>; uwuSum: number }> = {};
  let swatTotalNoRetry = 0;
  let swatTotalNoRetryAndroid = 0;
  let swatTotalNoRetryIos = 0;
  const globalStreamAgg: Record<string, { iOS: { total: number }; Android: { total: number } }> = {};

  const ensureGlobal = (stream: string) => {
    if (globalStreamAgg[stream]) return globalStreamAgg[stream];
    globalStreamAgg[stream] = { iOS: { total: 0 }, Android: { total: 0 } };
    return globalStreamAgg[stream];
  };

  const ensureUser = (login: string) => {
    if (perUser[login]) return perUser[login];
    perUser[login] = {
      iosDurMs: 0,
      androidDurMs: 0,
      iosCases: 0,
      androidCases: 0,
      streams: {},
      uwuSum: 0,
    };
    return perUser[login];
  };

  const ensureStream = (user: ReturnType<typeof ensureUser>, stream: string) => {
    if (user.streams[stream]) return user.streams[stream];
    user.streams[stream] = { iosDurMs: 0, androidDurMs: 0, iosCases: 0, androidCases: 0 };
    return user.streams[stream];
  };

  await mapLimit(launches, 6, async (launch, index) => {
    if (cfg.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const launchId = toInt(launch?.id);
    const name = String(launch?.name || '');
    const platform = platformOfLaunchName(name);
    const stream = shortStreamName(name);
    if (index % 6 === 0) {
      log(`[Шаг 3/4] memberstats… ${index}/${launches.length}`);
      progress(35 + Math.round((index / Math.max(launches.length, 1)) * 20));
    }

    const members = await fetchMemberStats(cfg, launchId);
    for (const member of members) {
      const assignee = normalizeLogin(member?.assignee);
      if (!assignee) continue;

      const totalCases = memberTotalCount(member);
      const durMs = toInt(member?.durationSum);
      const retried = toInt(member?.retriedCount);
      const totalCasesWithRetries = totalCases + retried;

      if (platform === 'iOS' || platform === 'Android') {
        const global = ensureGlobal(stream);
        global[platform].total += totalCasesWithRetries;
      }

      if (!swatSet.has(assignee)) continue;
      if (totalCases > 0) {
        swatTotalNoRetry += totalCases;
        if (platform === 'Android') swatTotalNoRetryAndroid += totalCases;
        else if (platform === 'iOS') swatTotalNoRetryIos += totalCases;
      }

      const user = ensureUser(assignee);
      const streamData = ensureStream(user, stream);

      if (platform === 'iOS') {
        user.iosCases += totalCasesWithRetries;
        user.iosDurMs += durMs;
        streamData.iosCases += totalCasesWithRetries;
        streamData.iosDurMs += durMs;
      } else if (platform === 'Android') {
        user.androidCases += totalCasesWithRetries;
        user.androidDurMs += durMs;
        streamData.androidCases += totalCasesWithRetries;
        streamData.androidDurMs += durMs;
      }
    }
  }, cfg.signal);

  let swatAvgMsSum = 0;
  let swatAvgCount = 0;
  for (const login of swatLogins) {
    const user = perUser[login];
    if (!user) continue;
    const totalCases = toInt(user.iosCases) + toInt(user.androidCases);
    if (totalCases <= 0) continue;
    const totalDurMs = toInt(user.iosDurMs) + toInt(user.androidDurMs);
    swatAvgMsSum += totalDurMs / totalCases;
    swatAvgCount += 1;
  }
  const overallAvgMsPerCase = swatAvgCount > 0 ? swatAvgMsSum / swatAvgCount : 0;
  const overallAvgMMSS = overallAvgMsPerCase > 0 ? fmtMMSSFromMs(overallAvgMsPerCase) : '—';

  log('[Шаг 3/4] Собираю UwU…');
  progress(58);
  const uwuCache = new Map<number, { uwuRaw: string | null }>();
  const leafPairs: Array<{ login: string; tcid: number }> = [];

  await mapLimit(launches, 4, async (launch, index) => {
    if (cfg.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const launchId = toInt(launch?.id);
    if (index % 4 === 0) {
      log(`[Шаг 3/4] UwU… ${index}/${launches.length}`);
    }
    const items = await listLeaf(cfg, launchId);
    for (const item of items) {
      const testedBy = normalizeLogin(item?.testedBy);
      if (!testedBy || !swatSet.has(testedBy)) continue;
      const tcid = toInt(item?.testCaseId);
      if (!tcid) continue;
      leafPairs.push({ login: testedBy, tcid });
    }
  }, cfg.signal);

  const uniqTcids = Array.from(new Set(leafPairs.map(item => item.tcid)));
  await mapLimit(uniqTcids, 16, async (tcid, index) => {
    if (cfg.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (index % 200 === 0) {
      log(`[Шаг 3/4] UwU… testcase ${index}/${uniqTcids.length}`);
      progress(58 + Math.round((index / Math.max(uniqTcids.length, 1)) * 12));
    }
    const overview = await fetchTestCaseOverview(cfg, tcid).catch(() => ({ customFields: [] as TestCaseCustomField[] }));
    const fields = Array.isArray(overview?.customFields) ? overview.customFields : [];
    const uwuField = fields.find(field => String(field?.customField?.name || '').trim() === 'UwU');
    uwuCache.set(tcid, { uwuRaw: pickCustomFieldValue(uwuField) || null });
  }, cfg.signal);

  for (const pair of leafPairs) {
    const uwuRaw = uwuCache.get(pair.tcid)?.uwuRaw;
    const uwuNum = parseUwUNumber(uwuRaw);
    const user = ensureUser(pair.login);
    user.uwuSum = toNum(user.uwuSum) + uwuNum;
  }

  log('[Шаг 4/4] Считаю время и кейсы по дням…');
  progress(74);
  const durByUserDay: Record<string, Record<string, number>> = {};
  const casesByDayPlatform: Record<string, { Android: number; iOS: number }> = {};
  const usersByDayPlatform: Record<string, { Android: Set<string>; iOS: Set<string> }> = {};
  const casesByUserDayPlatform: Record<'Android' | 'iOS', Record<string, Record<string, number>>> = { Android: {}, iOS: {} };
  const casesByUserDayStream: Record<string, Record<string, Record<string, number>>> = {};

  const addDur = (login: string, day: string, ms: number) => {
    if (!durByUserDay[login]) durByUserDay[login] = {};
    durByUserDay[login][day] = (durByUserDay[login][day] || 0) + ms;
  };

  const ensureDayPlatform = (day: string) => {
    if (!casesByDayPlatform[day]) casesByDayPlatform[day] = { Android: 0, iOS: 0 };
    if (!usersByDayPlatform[day]) usersByDayPlatform[day] = { Android: new Set(), iOS: new Set() };
  };

  const addUserDayCase = (login: string, day: string, platform: 'Android' | 'iOS') => {
    if (!casesByUserDayPlatform[platform][login]) casesByUserDayPlatform[platform][login] = {};
    casesByUserDayPlatform[platform][login][day] = (casesByUserDayPlatform[platform][login][day] || 0) + 1;
  };

  const addUserDayStreamCase = (login: string, day: string, stream: string) => {
    const streamName = String(stream || 'Без стрима').trim() || 'Без стрима';
    if (!casesByUserDayStream[login]) casesByUserDayStream[login] = {};
    if (!casesByUserDayStream[login][streamName]) casesByUserDayStream[login][streamName] = {};
    casesByUserDayStream[login][streamName][day] = (casesByUserDayStream[login][streamName][day] || 0) + 1;
  };

  await mapLimit(launches, 4, async (launch, index) => {
    if (cfg.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const launchId = toInt(launch?.id);
    const name = String(launch?.name || '');
    const platform = platformOfLaunchName(name);
    const stream = shortStreamName(name) || 'Без стрима';
    if (index % 4 === 0) {
      log(`[Шаг 4/4] timeline… ${index}/${launches.length}`);
      progress(74 + Math.round((index / Math.max(launches.length, 1)) * 20));
    }
    const timeline = await fetchTimeline(cfg, launchId);
    const rootGroups = Array.isArray(timeline?.groups) ? timeline.groups : [];

    for (const group of rootGroups) {
      walkTimelineGroups(group, leaf => {
        const testedBy = normalizeLogin(leaf?.testedBy);
        if (!testedBy || !swatSet.has(testedBy)) return;
        const start = toInt(leaf?.start);
        const stop = 'stop' in (leaf || {}) ? toInt(leaf?.stop) : (start + toInt(leaf?.duration));
        const dur = Math.max(0, stop - start);
        const dayKey = toMskDateKeyFromEpochMs(start);
        addDur(testedBy, dayKey, dur);
        if (platform === 'Android' || platform === 'iOS') {
          ensureDayPlatform(dayKey);
          casesByDayPlatform[dayKey][platform] += 1;
          usersByDayPlatform[dayKey][platform].add(testedBy);
          addUserDayCase(testedBy, dayKey, platform);
          addUserDayStreamCase(testedBy, dayKey, stream);
        }
      });
    }
  }, cfg.signal);

  const employeeRows: SwatEmployeeRow[] = [];
  const rowsCasesAndroid: SwatChartRow[] = [];
  const rowsCasesIos: SwatChartRow[] = [];
  const rowsCasesStreams: SwatChartStreamRow[] = [];

  for (const login of swatLogins) {
    const user = perUser[login] || { iosDurMs: 0, androidDurMs: 0, iosCases: 0, androidCases: 0, streams: {}, uwuSum: 0 };
    const iosMinutes = Math.round(toInt(user.iosDurMs) / 60_000);
    const androidMinutes = Math.round(toInt(user.androidDurMs) / 60_000);
    const iosHoursText = fmtHHMMFromMinutes(iosMinutes);
    const androidHoursText = fmtHHMMFromMinutes(androidMinutes);

    let primaryStream = '';
    let primaryTotalCases = -1;
    const streamEntries = Object.entries(user.streams || {});
    for (const [streamName, streamState] of streamEntries) {
      const totalCases = toInt(streamState.iosCases) + toInt(streamState.androidCases);
      if (totalCases > primaryTotalCases) {
        primaryTotalCases = totalCases;
        primaryStream = streamName;
      }
    }

    const orderedStreams: string[] = [];
    if (primaryStream) orderedStreams.push(primaryStream);
    streamEntries
      .filter(([stream]) => stream && stream !== primaryStream)
      .sort((a, b) => {
        const A = a[1] || {};
        const B = b[1] || {};
        const ai = Math.round(toInt(A.iosDurMs) / 60_000);
        const bi = Math.round(toInt(B.iosDurMs) / 60_000);
        if (bi !== ai) return bi - ai;
        const at = Math.round((toInt(A.iosDurMs) + toInt(A.androidDurMs)) / 60_000);
        const bt = Math.round((toInt(B.iosDurMs) + toInt(B.androidDurMs)) / 60_000);
        return bt - at;
      })
      .forEach(([stream]) => orderedStreams.push(stream));

    const allStreamsText = orderedStreams.length ? orderedStreams.join(' + ') : '—';
    const hoverLines: string[] = [];
    for (const streamName of orderedStreams) {
      const streamState = user.streams?.[streamName] || { iosCases: 0, androidCases: 0 };
      const global = globalStreamAgg[streamName] || { iOS: { total: 0 }, Android: { total: 0 } };
      const iosEmp = toInt(streamState.iosCases);
      const andEmp = toInt(streamState.androidCases);
      const iosTotalAll = toInt(global.iOS?.total);
      const andTotalAll = toInt(global.Android?.total);
      const parts: string[] = [];
      if (iosEmp > 0) parts.push(`iOS ${iosEmp}/${iosTotalAll}`);
      if (andEmp > 0) parts.push(`Android ${andEmp}/${andTotalAll}`);
      if (parts.length) hoverLines.push(`${streamName} — ${parts.join(', ')}`);
    }
    const allStreamsHover = hoverLines.length ? hoverLines.join('\n') : allStreamsText;

    const totalCases = toInt(user.iosCases) + toInt(user.androidCases);
    const totalDurMs = toInt(user.iosDurMs) + toInt(user.androidDurMs);
    const avgMsPerCase = totalCases > 0 ? totalDurMs / totalCases : 0;
    const workedHoursTotal = toNum(totalWorkedHoursByLogin[login] || 0);
    const uwuPerHour = calcUwUPerHour(toNum(user.uwuSum), workedHoursTotal);

    const dayCells: SwatEmployeeDayCell[] = days.map(day => {
      const workedFromShift = !!presenceByDay?.[day]?.has(login);
      const shiftHours = toNum(shiftHoursByDay?.[day]?.[login] || 0);
      const ms = toInt(durByUserDay?.[login]?.[day] || 0);
      const minFromTimeline = Math.round(ms / 60_000);
      const allureHours = fmtHHMMFromMinutes(minFromTimeline);
      const worked = workedFromShift || shiftHours > 0 || minFromTimeline > 0;

      let text = '';
      let title = '';
      const shiftText = fmtShiftHours(shiftHours);
      if (minFromTimeline > 0) {
        text = shiftText ? `${allureHours} (${shiftText})` : allureHours;
        title = shiftText ? `Allure: ${allureHours}ч, Смена: ${shiftText}ч` : `Allure: ${allureHours}ч`;
      } else if (shiftText) {
        text = `0:00 (${shiftText})`;
        title = `Allure: 0:00ч, Смена: ${shiftText}ч`;
      } else {
        text = '';
        title = worked ? 'worked_days: есть, но тайминг не найден' : 'не работал';
      }
      return { day, worked, text, title };
    });

    const employeePlatform: SwatEmployeeRow['platform'] =
      toInt(user.iosCases) > 0 && toInt(user.androidCases) > 0
        ? 'both'
        : toInt(user.androidCases) > 0
          ? 'android'
          : toInt(user.iosCases) > 0
            ? 'ios'
            : 'other';

    employeeRows.push({
      login,
      fullName: fullNameByLogin[login] || login,
      platform: employeePlatform,
      targetStream: targetStreamByLogin[login] || '',
      allStreamsText,
      allStreamsHover,
      uwuSum: toNum(user.uwuSum || 0),
      uwuText: formatUwU(toNum(user.uwuSum || 0)),
      workedHoursTotal,
      uwuPerHour,
      uwuPerHourText: uwuPerHour == null ? '—' : formatUwU(uwuPerHour),
      iosMinutes,
      androidMinutes,
      iosHoursText,
      androidHoursText,
      iosCases: toInt(user.iosCases),
      androidCases: toInt(user.androidCases),
      avgMsPerCase,
      avgText: avgMsPerCase > 0 ? fmtMMSSFromMs(avgMsPerCase) : '—',
      days: dayCells,
    });

    const androidDayCounts = days.map(day => toInt(casesByUserDayPlatform.Android?.[login]?.[day] || 0));
    const iosDayCounts = days.map(day => toInt(casesByUserDayPlatform.iOS?.[login]?.[day] || 0));
    rowsCasesAndroid.push({
      login,
      fullName: fullNameByLogin[login] || login,
      dayCounts: androidDayCounts,
      total: androidDayCounts.reduce((sum, value) => sum + toInt(value), 0),
    });
    rowsCasesIos.push({
      login,
      fullName: fullNameByLogin[login] || login,
      dayCounts: iosDayCounts,
      total: iosDayCounts.reduce((sum, value) => sum + toInt(value), 0),
    });

    const streamRows = Object.entries(casesByUserDayStream?.[login] || {})
      .map(([stream, byDay]) => {
        const dayCounts = days.map(day => toInt(byDay?.[day] || 0));
        const total = dayCounts.reduce((sum, value) => sum + toInt(value), 0);
        return { stream, dayCounts, total };
      })
      .filter(row => toInt(row.total) > 0)
      .sort((a, b) => (toInt(b.total) - toInt(a.total)) || String(a.stream || '').localeCompare(String(b.stream || ''), 'ru'));
    rowsCasesStreams.push({
      login,
      fullName: fullNameByLogin[login] || login,
      streams: streamRows,
    });
  }

  const amountByDay: SwatPlatformModel['amountByDay'] = {};
  const avgByDay: SwatPlatformModel['avgByDay'] = {};
  const workersByDay: SwatPlatformModel['workersByDay'] = {};
  const dailyAllAvg: number[] = [];

  for (const day of days) {
    ensureDayPlatform(day);
    const aCases = toInt(casesByDayPlatform[day]?.Android || 0);
    const iCases = toInt(casesByDayPlatform[day]?.iOS || 0);
    const aSet = usersByDayPlatform[day]?.Android || new Set<string>();
    const iSet = usersByDayPlatform[day]?.iOS || new Set<string>();
    const aWorkers = aSet.size || 0;
    const iWorkers = iSet.size || 0;
    const union = new Set<string>([...aSet, ...iSet]);
    const allWorkers = union.size || 0;
    const aAvg = aWorkers > 0 ? aCases / aWorkers : 0;
    const iAvg = iWorkers > 0 ? iCases / iWorkers : 0;
    const allAvg = aAvg + iAvg;
    amountByDay[day] = { Android: aCases, iOS: iCases, All: aCases + iCases };
    avgByDay[day] = { Android: aAvg, iOS: iAvg, All: allAvg };
    workersByDay[day] = { Android: aWorkers, iOS: iWorkers, All: allWorkers };
    dailyAllAvg.push(allAvg);
  }

  const releaseAvgAll = dailyAllAvg.length ? dailyAllAvg.reduce((sum, value) => sum + value, 0) / dailyAllAvg.length : 0;
  const uniqueWorkersASet = new Set<string>();
  const uniqueWorkersISet = new Set<string>();
  for (const day of days) {
    for (const user of usersByDayPlatform[day]?.Android || []) uniqueWorkersASet.add(user);
    for (const user of usersByDayPlatform[day]?.iOS || []) uniqueWorkersISet.add(user);
  }
  const uniqueWorkersA = uniqueWorkersASet.size || 0;
  const uniqueWorkersI = uniqueWorkersISet.size || 0;
  let totalACases = 0;
  let totalICases = 0;
  for (const day of days) {
    totalACases += toInt(amountByDay[day]?.Android || 0);
    totalICases += toInt(amountByDay[day]?.iOS || 0);
  }
  const releaseAvgA = uniqueWorkersA > 0 ? totalACases / uniqueWorkersA : 0;
  const releaseAvgI = uniqueWorkersI > 0 ? totalICases / uniqueWorkersI : 0;

  const platformModel: SwatPlatformModel = {
    days,
    amountByDay,
    avgByDay,
    workersByDay,
    releaseAvgA,
    releaseAvgI,
    releaseAvgAll,
    swatCountByDay,
    uniqueWorkersA,
    uniqueWorkersI,
  };

  progress(100);
  log(`Готово: SWAT ${swatEntries.length}, запусков ${launches.length}`, 'ok');

  return {
    release: cleanRelease,
    days,
    swatCount: swatEntries.length,
    launchesCount: launches.length,
    totalCases: swatTotalNoRetry,
    totalCasesAndroid: swatTotalNoRetryAndroid,
    totalCasesIos: swatTotalNoRetryIos,
    overallAvgMMSS,
    employees: employeeRows,
    platformModel,
    launches: launches.map(launch => {
      const id = toInt(launch?.id);
      const name = String(launch?.name || '');
      return {
        id,
        name,
        stream: shortStreamName(name),
        platform: platformOfLaunchName(name),
        url: `${cfg.base.replace(/\/+$/, '')}/launch/${id}`,
      };
    }),
    chartRowsAndroid: rowsCasesAndroid,
    chartRowsIos: rowsCasesIos,
    chartRowsStreams: rowsCasesStreams,
    users,
  };
}
