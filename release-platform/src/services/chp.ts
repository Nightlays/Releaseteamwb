import { proxyFetch, type ProxyMode } from './proxy';

export interface ChpConfig {
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
  ytBase?: string;
  ytToken?: string;
  deployLabToken?: string;
  signal?: AbortSignal;
}

export interface ChpReleaseTotalRow {
  release: string;
  android: number;
  ios: number;
  total: number;
  delta: number;
  severity: 'low' | 'medium' | 'high';
}

export interface ChpPlatformBuild {
  title: 'Android' | 'iOS';
  counts: Record<string, Record<string, number>>;
  totalsByRelease: Record<string, number>;
  cutoffs: Record<string, string | null>;
  issueKeysByRelease: Record<string, string[]>;
  tableHtml: string;
}

export interface ChpDrivePayload {
  releases: string[];
  and_counts: Record<string, Record<string, number>>;
  and_totals: Record<string, number>;
  and_cutoffs: Record<string, string | null>;
  and_issue_keys: Record<string, string[]>;
  ios_counts: Record<string, Record<string, number>>;
  ios_totals: Record<string, number>;
  ios_cutoffs: Record<string, string | null>;
  ios_issue_keys: Record<string, string[]>;
}

export interface ChpDeployCompositionItem {
  key: string;
  platforms: string[];
  releases: string[];
}

export interface ChpGitlabEntry {
  platform: string;
  fullPath: string;
  iid: number | null;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  mergedAt: string;
  mergedBy: string;
  keys: string[];
}

export interface ChpGitlabOnlyItem {
  key: string;
  reason: string;
  entries: ChpGitlabEntry[];
}

export interface ChpCompositionResult {
  branch: string;
  releaseLabel: string;
  deployUniqueCount: number;
  gitlabUniqueCount: number;
  matchedCount: number;
  deployOnly: ChpDeployCompositionItem[];
  gitlabOnly: ChpGitlabOnlyItem[];
  withoutKeys: ChpGitlabEntry[];
  hasDiff: boolean;
}

export interface ChpRunResult {
  releases: string[];
  latestRelease: string;
  android: ChpPlatformBuild;
  ios: ChpPlatformBuild;
  totalsRows: ChpReleaseTotalRow[];
  totalsText: string;
  drivePayload: ChpDrivePayload;
  deployComposition: {
    rangeKey: string;
    relKeys: string[];
    map: Map<string, { key: string; platforms: Set<string>; releases: Set<string> }>;
    androidIssueKeysByRelease: Record<string, string[]>;
    iosIssueKeysByRelease: Record<string, string[]>;
    onlyRelease: string;
  };
}

type LogLevel = 'info' | 'ok' | 'warn' | 'error';
type LogFn = (message: string, level?: LogLevel) => void;
type ProgressFn = (progress: number) => void;

interface YtIssueBrief {
  idReadable?: string;
  summary?: string;
  fields?: Array<{
    name?: string;
    projectCustomField?: { field?: { name?: string } };
    value?: unknown;
  }>;
}

interface DeployIssue {
  key?: string;
  merged_after_cutoff?: boolean;
}

const DL_BASE = 'https://deploy-lab-api.wb.ru';
const DEFAULT_YT_BASE = 'https://youtrack.wildberries.ru';
const GITLAB_BASE_URL = 'https://gitlab.wildberries.ru';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxyeF_6k6bag74Np_GdHUS17xT7AJLIsDG2gP8JfP3iNtne4MlM1O9jQ__TOl3YYI6v/exec';
const GOOGLE_DRIVE_URL = 'https://drive.google.com/drive/home';
const GITLAB_MR_PAGE_SIZE = 100;
const GITLAB_PROJECTS = [
  { platform: 'Android', fullPath: 'mobile/androidnative/androidnative' },
  { platform: 'iOS', fullPath: 'mobile/ios/marketplace' },
] as const;
const ISSUE_KEY_PREFIX_MAP: Record<string, string> = {
  ANDR: 'ANDR',
  IOS: 'IOS',
};
const YT_RELEASE_FIELD_BY_PLATFORM: Record<'Android' | 'iOS', string[]> = {
  Android: ['{Версия релиза (ex. Sprint) Android}', 'Версия релиза Android', 'Версия релиза'],
  iOS: ['{Версия релиза (ex. Sprint) iOS}', 'Версия релиза iOS', 'Версия релиза'],
};

function normalizeYtBase(value: string | undefined) {
  const raw = String(value || '').trim() || DEFAULT_YT_BASE;
  try {
    const url = new URL(raw);
    if (url.hostname === 'youtrack.wb.ru') {
      url.hostname = 'youtrack.wildberries.ru';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace('youtrack.wb.ru', 'youtrack.wildberries.ru').replace(/\/+$/, '');
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortenBody(text: string, max = 2000) {
  const value = String(text || '');
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function withBearer(token: string) {
  const value = String(token || '').trim();
  if (!value) return '';
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function normalizeDeployLabToken(token: string) {
  const raw = String(token || '').trim();
  if (!raw) return '';

  const compact = raw.replace(/[\r\n\t]+/g, ' ').trim();
  const headerMatch = compact.match(/authorization-deploy-lab\s*:\s*Bearer\s+([A-Za-z0-9._-]+)/i);
  if (headerMatch && headerMatch[1]) return headerMatch[1].trim();

  const bearerMatch = compact.match(/(?:^|\s)Bearer\s+([A-Za-z0-9._-]+)/i);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1].trim();

  const jwtMatch = compact.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch && jwtMatch[0]) return jwtMatch[0].trim();

  return compact.replace(/^['"]+|['"]+$/g, '').trim();
}

function normalizeGitlabToken(raw: string) {
  return String(raw || '')
    .replace(/^PRIVATE-TOKEN\s*:\s*/i, '')
    .trim();
}

function serviceName(name: string) {
  return name || 'request';
}

function parseRelease(value: string) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d{1,4})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareReleaseParts(left: readonly number[], right: readonly number[]) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function displayRelease(release: string) {
  const parts = String(release || '').split('.');
  if (parts.length !== 3) return String(release || '');
  const build = Number(parts[2]);
  return `${parts[0]}.${parts[1]}.${build >= 1000 ? Math.floor(build / 1000) : build}`;
}

function toKey(release: string) {
  const parts = String(release || '').split('.');
  return parts.length === 3 ? displayRelease(release) : String(release || '');
}

function compareReleaseLabels(left: string, right: string) {
  const a = String(left || '').split('.').map(Number);
  const b = String(right || '').split('.').map(Number);
  return (a[0] || 0) - (b[0] || 0) || (a[1] || 0) - (b[1] || 0) || (a[2] || 0) - (b[2] || 0);
}

function normalizePlatformLabel(raw: string) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'android' || value === 'andr') return 'Android';
  if (value === 'ios') return 'iOS';
  return String(raw || '').trim();
}

function normalizeIssueKey(raw: string) {
  const match = String(raw || '').trim().match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!match) return '';
  const prefix = String(match[1] || '').trim().toUpperCase();
  const number = String(match[2] || '').trim();
  const canonicalPrefix = ISSUE_KEY_PREFIX_MAP[prefix] || prefix;
  return canonicalPrefix && number ? `${canonicalPrefix}-${number}` : '';
}

function extractReleaseIssueKeysFromTitle(title: string) {
  const keys = new Set<string>();
  const source = String(title || '');
  const regex = /\b((?:ANDR|IOS)-\d+)\b/ig;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source))) {
    const key = normalizeIssueKey(match[1]);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

function normalizeReleaseForCompare(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const match = text.match(/(\d+\.\d+\.\d{1,4})/);
  if (!match) return '';
  const parsed = parseRelease(match[1]);
  if (!parsed) return '';
  return `${parsed[0]}.${parsed[1]}.${String(parsed[2]).padStart(4, '0')}`;
}

function issueFieldName(field: { name?: string; projectCustomField?: { field?: { name?: string } } } | undefined) {
  return String(field?.name || field?.projectCustomField?.field?.name || '').trim();
}

function extractFieldText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map(item => extractFieldText(item)).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as { text?: string; markdownText?: string; name?: string; localizedName?: string; presentation?: string };
    return String(record.text || record.markdownText || record.name || record.localizedName || record.presentation || '').trim();
  }
  return '';
}

function pickFieldNames(issue: YtIssueBrief, target: string) {
  const out: string[] = [];
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  for (const field of fields) {
    if (issueFieldName(field) !== target) continue;
    const value = field?.value;
    const values = Array.isArray(value) ? value : [value];
    values.forEach(item => {
      const text = extractFieldText(item);
      if (text) out.push(text);
    });
  }
  return out;
}

function pickFirstSubstreamField(issue: YtIssueBrief) {
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  for (const field of fields) {
    const name = issueFieldName(field).toLowerCase();
    if (!name.includes('substream')) continue;
    const value = field?.value;
    const values = Array.isArray(value) ? value : [value];
    return values.map(item => extractFieldText(item)).filter(Boolean);
  }
  return [] as string[];
}

function pickSubstreamDynamic(issue: YtIssueBrief, streamName: string) {
  if (String(streamName || '').trim().toLowerCase() === 'финтех') {
    const values = pickFieldNames(issue, 'Product Финтех');
    if (values.length) return values;
  }
  return pickFirstSubstreamField(issue);
}

function normalizeStream(streams: string[]) {
  if (!streams.length) return '';
  const value = streams[0];
  if (value.toLowerCase().includes('paygate') && value.includes('.')) {
    return value.split('.').pop()?.trim() || value;
  }
  return value;
}

function monthFromIso(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.getMonth() + 1;
}

function quarterFromMonth(month: number | null) {
  if (!month) return 1;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function severityForTotal(total: number): ChpReleaseTotalRow['severity'] {
  if (total >= 18) return 'high';
  if (total >= 10) return 'medium';
  return 'low';
}

function buildProxyOptions(cfg: ChpConfig) {
  if (cfg.useProxy === false || !String(cfg.proxyBase || '').trim()) return null;
  return {
    base: String(cfg.proxyBase || '').trim(),
    mode: cfg.proxyMode,
    signal: cfg.signal,
  };
}

async function fetchWithProxySupport(cfg: ChpConfig, url: string, init?: RequestInit) {
  const proxy = buildProxyOptions(cfg);
  if (proxy) {
    return proxyFetch(proxy, url, init);
  }
  return fetch(url, { ...init, signal: cfg.signal });
}

async function safeReadText(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function fetchJson<T>(
  cfg: ChpConfig,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    service: string;
    log?: LogFn;
  }
) {
  const response = await fetchWithProxySupport(cfg, url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });

  const service = serviceName(options.service);
  if (!response.ok) {
    const text = await safeReadText(response);
    options.log?.(`Запрос ${service} [${response.status} ${response.statusText}]`, 'error');
    if (text) options.log?.(`Тело ответа: ${shortenBody(text)}`, 'error');
    throw new Error(`${service}: HTTP ${response.status} ${response.statusText}`);
  }

  options.log?.(`Запрос ${service} [${response.status} OK]`, 'ok');
  const text = await safeReadText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${service}: HTML вместо JSON ${shortenBody(text, 200)}`);
  }
}

async function fetchText(
  cfg: ChpConfig,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    service: string;
    log?: LogFn;
  }
) {
  const response = await fetchWithProxySupport(cfg, url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });

  const text = await safeReadText(response);
  const service = serviceName(options.service);
  if (!response.ok) {
    options.log?.(`Запрос ${service} [${response.status} ${response.statusText}]`, 'error');
    if (text) options.log?.(`Тело ответа: ${shortenBody(text)}`, 'error');
    throw new Error(`${service}: HTTP ${response.status} ${response.statusText}`);
  }

  options.log?.(`Запрос ${service} [${response.status} OK]`, 'ok');
  return text;
}

function buildDeployHeaders(token: string) {
  const auth = withBearer(normalizeDeployLabToken(token));
  return {
    Accept: 'application/json, text/plain, */*',
    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'authorization-deploy-lab': auth,
    Origin: 'https://deploy-lab.wb.ru',
    Referer: 'https://deploy-lab.wb.ru/',
  };
}

function buildYtHeaders(token: string) {
  return {
    Accept: 'application/json',
    Authorization: withBearer(token),
  };
}

function gitlabHeaders(token: string) {
  return {
    'PRIVATE-TOKEN': normalizeGitlabToken(token),
    Accept: 'application/json',
  };
}

function dlReleaseUrl(platform: 'Android' | 'iOS', release: string) {
  const prefix = platform === 'Android' ? 'ANDROID' : 'IOS';
  return `${DL_BASE}/releaseboss/admin_panel/release/${prefix}_${release}`;
}

function dlIssuesUrl(platform: 'Android' | 'iOS', release: string) {
  const prefix = platform === 'Android' ? 'ANDROID' : 'IOS';
  return `${DL_BASE}/releaseboss/admin_panel/release/${prefix}_${release}/issues`;
}

function ytIssueUrl(base: string, key: string) {
  const fields = [
    'idReadable',
    'summary',
    'fields(projectCustomField(field(name)),value(name,localizedName,text,markdownText,presentation,$type),$type)',
  ].join(',');
  return `${normalizeYtBase(base)}/api/issues/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}&$top=-1`;
}

function youTrackIssueUrl(base: string, key: string) {
  return `${normalizeYtBase(base)}/issue/${encodeURIComponent(key)}/`;
}

function gitlabMergeRequestsUrl(fullPath: string, targetBranch: string, page = 1) {
  const url = new URL(`${GITLAB_BASE_URL}/api/v4/projects/${encodeURIComponent(fullPath)}/merge_requests`);
  url.searchParams.set('state', 'merged');
  url.searchParams.set('target_branch', targetBranch);
  url.searchParams.set('scope', 'all');
  url.searchParams.set('per_page', String(GITLAB_MR_PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('order_by', 'updated_at');
  url.searchParams.set('sort', 'desc');
  return url.toString();
}

function normalizeGitlabMr(project: { platform: string; fullPath: string }, item: Record<string, unknown>): ChpGitlabEntry {
  return {
    platform: normalizePlatformLabel(project.platform),
    fullPath: project.fullPath,
    iid: Number(item?.iid || 0) || null,
    title: String(item?.title || '').trim(),
    sourceBranch: String(item?.source_branch || '').trim(),
    targetBranch: String(item?.target_branch || '').trim(),
    webUrl: String(item?.web_url || '').trim(),
    mergedAt: String(item?.merged_at || item?.updated_at || item?.created_at || '').trim(),
    mergedBy: String((item?.merge_user as { name?: string } | undefined)?.name || (item?.merged_by as { name?: string } | undefined)?.name || (item?.author as { name?: string } | undefined)?.name || '').trim(),
    keys: extractReleaseIssueKeysFromTitle(String(item?.title || '')),
  };
}

function isReleaseTargetMr(entry: ChpGitlabEntry) {
  return /^release\/\d+\.\d+\.\d+$/i.test(String(entry.targetBranch || '').trim());
}

function isRevertGitlabEntry(entry: ChpGitlabEntry | undefined | null) {
  if (!entry) return false;
  return /revert/i.test(String(entry.sourceBranch || '').trim()) || /^\s*revert\b/i.test(String(entry.title || '').trim());
}

async function withPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const size = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: size }, () => run()));
  return results;
}

async function fetchReleaseCutoff(cfg: ChpConfig, platform: 'Android' | 'iOS', release: string, log?: LogFn) {
  const token = String(cfg.deployLabToken || '').trim();
  if (!token) return null;
  try {
    const data = await fetchJson<Record<string, unknown>>(cfg, dlReleaseUrl(platform, release), {
      headers: buildDeployHeaders(token),
      service: 'deploy-lab',
      log,
    });
    for (const [key, value] of Object.entries(data || {})) {
      if (!String(key).toLowerCase().includes('cutoff')) continue;
      if (typeof value === 'number') {
        const timestamp = value > 10000000000 ? value / 1000 : value;
        return new Date(timestamp * 1000).toISOString();
      }
      if (typeof value === 'string') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
    }
  } catch (error) {
    log?.(`[warn] cutoff ${platform} ${release}: ${(error as Error).message}`, 'warn');
  }
  return null;
}

async function fetchDeployIssueKeys(cfg: ChpConfig, platform: 'Android' | 'iOS', release: string, log?: LogFn) {
  const token = String(cfg.deployLabToken || '').trim();
  if (!token) return [] as string[];
  try {
    const list = await fetchJson<unknown>(cfg, dlIssuesUrl(platform, release), {
      headers: buildDeployHeaders(token),
      service: 'deploy-lab',
      log,
    });

    const items = Array.isArray(list)
      ? list
      : Array.isArray((list as { data?: unknown[] })?.data)
        ? (list as { data: unknown[] }).data
        : [];

    const keys: string[] = [];
    items.forEach(item => {
      const issue = item as DeployIssue;
      if (issue?.merged_after_cutoff !== true) return;
      const key = normalizeIssueKey(String(issue.key || '').trim()) || String(issue.key || '').trim().toUpperCase();
      if (key) keys.push(key.toUpperCase());
    });
    return keys;
  } catch (error) {
    log?.(`[err] issues ${platform} ${release}: ${(error as Error).message}`, 'error');
    return [];
  }
}

async function fetchIssueBrief(cfg: ChpConfig, key: string, cache: Map<string, YtIssueBrief>, log?: LogFn) {
  const normalized = normalizeIssueKey(key) || String(key || '').trim();
  if (cache.has(normalized)) return cache.get(normalized)!;

  const token = String(cfg.ytToken || '').trim();
  if (!token) {
    throw new Error('Заполни YouTrack Token в настройках.');
  }

  try {
    const issue = await fetchJson<YtIssueBrief>(cfg, ytIssueUrl(cfg.ytBase || DEFAULT_YT_BASE, normalized), {
      headers: buildYtHeaders(token),
      service: 'youtrack',
      log,
    });
    cache.set(normalized, issue || {});
    return issue || {};
  } catch (error) {
    cache.set(normalized, {});
    throw error;
  }
}

async function computeReleaseCounts(
  cfg: ChpConfig,
  platform: 'Android' | 'iOS',
  release: string,
  issueCache: Map<string, YtIssueBrief>,
  log?: LogFn
) {
  const cutoff = await fetchReleaseCutoff(cfg, platform, release, log);
  const keys = await fetchDeployIssueKeys(cfg, platform, release, log);
  if (!keys.length) {
    return { rowCounts: {} as Record<string, number>, total: 0, cutoff, issueKeys: [] as string[] };
  }

  const uniqueKeys = Array.from(new Set(keys));
  const rowCounts: Record<string, number> = {};

  const resolvedRows = await withPool(uniqueKeys, 8, async issueKey => {
    const issue = await fetchIssueBrief(cfg, issueKey, issueCache, log).catch(error => {
      log?.(`[err] YT ${issueKey}: ${(error as Error).message}`, 'error');
      return {} as YtIssueBrief;
    });
    const stream = normalizeStream(pickFieldNames(issue, 'Stream'));
    const substream = pickSubstreamDynamic(issue, stream)[0] || '';
    return substream ? `${stream} | ${substream}` : (stream || '');
  });

  resolvedRows.forEach(rowKey => {
    if (!rowKey) return;
    rowCounts[rowKey] = (rowCounts[rowKey] || 0) + 1;
  });

  const total = Object.values(rowCounts).reduce((sum, value) => sum + value, 0);
  return { rowCounts, total, cutoff, issueKeys: uniqueKeys };
}

async function buildCountsForPlatform(
  cfg: ChpConfig,
  platform: 'Android' | 'iOS',
  releases: string[],
  issueCache: Map<string, YtIssueBrief>,
  log?: LogFn
) {
  const counts: Record<string, Record<string, number>> = {};
  const totalsByRelease: Record<string, number> = {};
  const cutoffs: Record<string, string | null> = {};
  const issueKeysByRelease: Record<string, string[]> = {};

  await Promise.all(releases.map(async release => {
    try {
      const result = await computeReleaseCounts(cfg, platform, release, issueCache, log);
      const key = toKey(release);
      totalsByRelease[key] = Number(result.total || 0);
      cutoffs[key] = result.cutoff || null;
      issueKeysByRelease[key] = result.issueKeys.slice();

      Object.entries(result.rowCounts).forEach(([rowKey, value]) => {
        counts[rowKey] = counts[rowKey] || {};
        counts[rowKey][key] = (counts[rowKey][key] || 0) + Number(value || 0);
      });
    } catch (error) {
      log?.(`[err] compute ${platform} ${release}: ${(error as Error).message}`, 'error');
    }
  }));

  return { counts, totalsByRelease, cutoffs, issueKeysByRelease };
}

function buildColumnPlan(releases: string[], cutoffs: Record<string, string | null>) {
  const plan: Array<{ kind: 'release' | 'month_total' | 'quarter_total'; label: string; q?: number; m?: number; rel?: string }> = [];
  const qSpans: Array<[number, number, number]> = [];
  let currentQuarter: number | null = null;
  let quarterStartCol: number | null = null;
  let currentMonth: number | null = null;
  let colIdx = 1;

  const RU_MONTH_ABBR: Record<number, string> = {
    1: 'янв.',
    2: 'фев.',
    3: 'мар.',
    4: 'апр.',
    5: 'май',
    6: 'июн.',
    7: 'июл.',
    8: 'авг.',
    9: 'сен.',
    10: 'окт.',
    11: 'ноя.',
    12: 'дек.',
  };

  const closeMonth = (quarter: number, month: number | null) => {
    if (month != null) {
      plan.push({ kind: 'month_total', label: `ИТОГО ${RU_MONTH_ABBR[month] || ''}`, q: quarter, m: month });
    }
  };
  const closeQuarter = (quarter: number) => {
    plan.push({ kind: 'quarter_total', label: `ИТОГО Q${quarter}`, q: quarter });
  };

  releases.forEach(release => {
    const month = monthFromIso(cutoffs[release]) ?? (currentMonth ?? 1);
    const quarter = quarterFromMonth(month);

    if (currentQuarter == null) {
      currentQuarter = quarter;
      quarterStartCol = colIdx;
      currentMonth = month;
    } else if (quarter !== currentQuarter) {
      closeMonth(currentQuarter, currentMonth);
      colIdx += 1;
      closeQuarter(currentQuarter);
      colIdx += 1;
      qSpans.push([quarterStartCol!, colIdx - 1, currentQuarter]);
      currentQuarter = quarter;
      quarterStartCol = colIdx;
      currentMonth = month;
    }

    if (month !== currentMonth) {
      closeMonth(currentQuarter, currentMonth);
      colIdx += 1;
      currentMonth = month;
    }

    plan.push({ kind: 'release', label: displayRelease(release), rel: release, q: currentQuarter, m: currentMonth });
    colIdx += 1;
  });

  if (currentQuarter != null) {
    closeMonth(currentQuarter, currentMonth);
    colIdx += 1;
    closeQuarter(currentQuarter);
    colIdx += 1;
    qSpans.push([quarterStartCol!, colIdx - 1, currentQuarter]);
  }

  return { plan, qSpans };
}

function renderPlatformTableHtml(
  title: 'Android' | 'iOS',
  releases: string[],
  counts: Record<string, Record<string, number>>,
  cutoffs: Record<string, string | null>
) {
  const { plan, qSpans } = buildColumnPlan(releases, cutoffs);
  const streamRows = Object.keys(counts || {});
  const baseName = (value: string) => (value.split(' | ')[0] || '').trim();
  streamRows.sort((a, b) => baseName(a).toLowerCase().localeCompare(baseName(b).toLowerCase()) || a.toLowerCase().localeCompare(b.toLowerCase()));

  let html = '<div class="chp-table-wrap"><table class="chp-table"><thead>';
  html += '<tr><th class="chp-qhdr chp-stream-col"> </th>';
  qSpans.forEach(([start, end, quarter]) => {
    html += `<th class="chp-qhdr" colspan="${end - start + 1}">Q${quarter}</th>`;
  });
  html += '</tr>';

  html += '<tr><th class="chp-relhdr chp-stream-col">Стрим</th>';
  plan.forEach((item, colIndex) => {
    const classes = [item.kind === 'release' ? 'chp-relhdr' : 'chp-itogo-hdr'];
    if (colIndex === 0 || item.kind !== 'release') classes.push('chp-sep-left');
    html += `<th class="${classes.join(' ')}">${escapeHtml(item.label)}</th>`;
  });
  html += '</tr>';

  html += '<tr><th class="chp-subhdr chp-stream-col"> </th>';
  plan.forEach((_, index) => {
    const classes = ['chp-subhdr'];
    if (index === 0) classes.push('chp-sep-left');
    html += index === 0 ? `<th class="${classes.join(' ')}">количество черепиков</th>` : `<th class="${classes.join(' ')}"> </th>`;
  });
  html += '</tr></thead><tbody>';

  const indexToKind = plan.map((item, index) => ({ col: index + 1, def: item }));

  const valueAt = (rowKey: string, label: string) => Number((counts[rowKey] || {})[label] || 0);

  const findMonthRange = (index: number) => {
    let left: number | null = null;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = indexToKind[cursor].def;
      const current = indexToKind[index].def;
      if (candidate.kind === 'release' && candidate.q === current.q && candidate.m === current.m) {
        left = left == null ? indexToKind[cursor].col : Math.min(left, indexToKind[cursor].col);
      } else if (candidate.kind === 'month_total' || candidate.kind === 'quarter_total') {
        break;
      }
    }
    if (left == null) return null;
    return [left, indexToKind[index - 1].col] as const;
  };

  const quarterReleaseRangesBefore = (index: number) => {
    const quarter = indexToKind[index].def.q;
    const ranges: Array<[number, number]> = [];
    let runStart: number | null = null;
    let previous: number | null = null;
    for (let cursor = 0; cursor < index; cursor += 1) {
      const item = indexToKind[cursor];
      if (item.def.q === quarter && item.def.kind === 'release') {
        if (runStart == null) {
          runStart = item.col;
          previous = item.col;
        } else if (item.col === Number(previous) + 1) {
          previous = item.col;
        } else {
          ranges.push([runStart, previous!]);
          runStart = item.col;
          previous = item.col;
        }
      } else if (runStart != null) {
        ranges.push([runStart, previous!]);
        runStart = null;
        previous = null;
      }
    }
    if (runStart != null) ranges.push([runStart, previous!]);
    return ranges;
  };

  const rowsToRender = streamRows.length ? streamRows : [''];
  rowsToRender.forEach(rowKey => {
    html += `<tr><td class="chp-stream-col">${rowKey ? escapeHtml(rowKey) : '&nbsp;'}</td>`;
    plan.forEach((item, colIndex) => {
      const cellClasses = ['chp-num'];
      if (colIndex === 0 || item.kind !== 'release') cellClasses.push('chp-sep-left');
      if (item.kind !== 'release') cellClasses.push('chp-itogo');

      if (item.kind === 'release') {
        const value = valueAt(rowKey, item.label);
        html += value > 0 ? `<td class="${cellClasses.join(' ')}">${value}</td>` : `<td class="${cellClasses.join(' ')}"> </td>`;
        return;
      }

      let sum = 0;
      if (item.kind === 'month_total') {
        const range = findMonthRange(colIndex);
        if (range) {
          const [left, right] = range;
          for (let index = left - 1; index <= right - 1; index += 1) {
            const candidate = plan[index];
            if (candidate?.kind === 'release') sum += valueAt(rowKey, candidate.label);
          }
        }
      } else {
        quarterReleaseRangesBefore(colIndex).forEach(([left, right]) => {
          for (let index = left - 1; index <= right - 1; index += 1) {
            const candidate = plan[index];
            if (candidate?.kind === 'release') sum += valueAt(rowKey, candidate.label);
          }
        });
      }
      html += sum > 0 ? `<td class="${cellClasses.join(' ')}">${sum}</td>` : `<td class="${cellClasses.join(' ')}"> </td>`;
    });
    html += '</tr>';
  });

  html += '<tr><td class="chp-itogo-hdr chp-stream-col" style="font-weight:800">ИТОГО</td>';
  plan.forEach((item, colIndex) => {
    const cellClasses = ['chp-num'];
    if (colIndex === 0 || item.kind !== 'release') cellClasses.push('chp-sep-left');
    if (item.kind !== 'release') cellClasses.push('chp-itogo');
    let sum = 0;
    if (item.kind === 'release') {
      streamRows.forEach(rowKey => { sum += valueAt(rowKey, item.label); });
      html += `<td class="${cellClasses.join(' ')}">${sum}</td>`;
      return;
    }

    if (item.kind === 'month_total') {
      const range = findMonthRange(colIndex);
      if (range) {
        const [left, right] = range;
        streamRows.forEach(rowKey => {
          for (let index = left - 1; index <= right - 1; index += 1) {
            const candidate = plan[index];
            if (candidate?.kind === 'release') sum += valueAt(rowKey, candidate.label);
          }
        });
      }
    } else {
      const ranges = quarterReleaseRangesBefore(colIndex);
      streamRows.forEach(rowKey => {
        ranges.forEach(([left, right]) => {
          for (let index = left - 1; index <= right - 1; index += 1) {
            const candidate = plan[index];
            if (candidate?.kind === 'release') sum += valueAt(rowKey, candidate.label);
          }
        });
      });
    }
    html += sum > 0 ? `<td class="${cellClasses.join(' ')}">${sum}</td>` : `<td class="${cellClasses.join(' ')}"> </td>`;
  });
  html += '</tr></tbody></table></div>';

  return html;
}

function buildTotalsRows(releases: string[], androidTotals: Record<string, number>, iosTotals: Record<string, number>) {
  const order = (left: string, right: string) => compareReleaseLabels(left, right);
  const rels = Array.from(new Set([
    ...Object.keys(androidTotals || {}),
    ...Object.keys(iosTotals || {}),
    ...releases.map(toKey),
  ])).sort(order);

  const rows = rels.map(release => {
    const android = Number(androidTotals[release] || 0);
    const ios = Number(iosTotals[release] || 0);
    return {
      release,
      android,
      ios,
      total: android + ios,
    };
  });

  return rows.map((row, index, list) => {
    const next = list[index + 1];
    const delta = next ? row.total - next.total : 0;
    return {
      ...row,
      delta,
      severity: severityForTotal(row.total),
    };
  });
}

function buildTotalsText(rows: ChpReleaseTotalRow[]) {
  const headers = ['Релиз', 'Android', 'iOS', 'Итого'];
  const widths = headers.map(header => header.length);
  rows.forEach(row => {
    widths[0] = Math.max(widths[0], String(row.release).length);
    widths[1] = Math.max(widths[1], String(row.android).length);
    widths[2] = Math.max(widths[2], String(row.ios).length);
    widths[3] = Math.max(widths[3], String(row.total).length);
  });

  const padCell = (value: unknown, index: number) => {
    const text = String(value);
    return index === 0 ? text.padEnd(widths[index], ' ') : text.padStart(widths[index], ' ');
  };

  const separator = widths.map(width => '—'.repeat(width)).join(' ─ ');
  const lines = [
    headers.map((header, index) => (index === 0 ? header.padEnd(widths[index]) : header.padStart(widths[index]))).join(' | '),
    separator,
  ];

  rows.forEach(row => {
    lines.push([row.release, row.android, row.ios, row.total].map((value, index) => padCell(value, index)).join(' | '));
  });

  return lines.join('\n');
}

function addDeployKey(map: Map<string, { key: string; platforms: Set<string>; releases: Set<string> }>, key: string, platform: 'Android' | 'iOS', release: string) {
  const normalized = normalizeIssueKey(String(key || '').trim()) || String(key || '').trim().toUpperCase();
  if (!normalized) return;
  if (!map.has(normalized)) {
    map.set(normalized, { key: normalized, platforms: new Set(), releases: new Set() });
  }
  const entry = map.get(normalized)!;
  entry.platforms.add(normalizePlatformLabel(platform));
  entry.releases.add(release);
}

function buildDeployCompositionCache(
  releases: string[],
  androidIssueKeysByRelease: Record<string, string[]>,
  iosIssueKeysByRelease: Record<string, string[]>,
  onlyRelease = ''
) {
  const relKeys = onlyRelease ? [toKey(onlyRelease)] : releases.map(toKey);
  const map = new Map<string, { key: string; platforms: Set<string>; releases: Set<string> }>();
  relKeys.forEach(relKey => {
    (androidIssueKeysByRelease[relKey] || []).forEach(key => addDeployKey(map, key, 'Android', relKey));
    (iosIssueKeysByRelease[relKey] || []).forEach(key => addDeployKey(map, key, 'iOS', relKey));
  });
  return {
    rangeKey: onlyRelease ? `last:${toKey(onlyRelease)}` : releases.join('|'),
    relKeys,
    map,
    androidIssueKeysByRelease,
    iosIssueKeysByRelease,
    onlyRelease: onlyRelease ? toKey(onlyRelease) : '',
  };
}

function readIssueReleaseVersions(issue: YtIssueBrief, platform: 'Android' | 'iOS') {
  const fieldNames = YT_RELEASE_FIELD_BY_PLATFORM[platform] || [];
  const targetSet = new Set(fieldNames.map(item => String(item || '').trim()).filter(Boolean));
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  const versions: string[] = [];

  fields.forEach(field => {
    if (!targetSet.has(issueFieldName(field))) return;
    const values = Array.isArray(field?.value) ? field.value : [field?.value];
    values.forEach(value => {
      const normalized = normalizeReleaseForCompare(extractFieldText(value));
      if (normalized) versions.push(normalized);
    });
  });

  return Array.from(new Set(versions));
}

async function fetchGitlabMergedMrs(cfg: ChpConfig, project: { platform: string; fullPath: string }, targetBranch: string, gitlabToken: string, log?: LogFn) {
  const headers = gitlabHeaders(gitlabToken);
  const items: Record<string, unknown>[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const chunk = await fetchJson<Record<string, unknown>[]>(cfg, gitlabMergeRequestsUrl(project.fullPath, targetBranch, page), {
      headers,
      service: 'gitlab',
      log,
    });
    const list = Array.isArray(chunk) ? chunk : [];
    items.push(...list);
    if (list.length < GITLAB_MR_PAGE_SIZE) break;
  }
  return items.map(item => normalizeGitlabMr(project, item)).filter(isReleaseTargetMr);
}

async function collectGitlabComposition(cfg: ChpConfig, targetBranch: string, gitlabToken: string, log?: LogFn) {
  const all = await Promise.all(GITLAB_PROJECTS.map(async project => fetchGitlabMergedMrs(cfg, project, targetBranch, gitlabToken, log)));
  const entries = all.flat();
  const keyMap = new Map<string, { key: string; entries: ChpGitlabEntry[] }>();
  const withoutKeys: ChpGitlabEntry[] = [];

  entries.forEach(entry => {
    if (!entry.keys.length) {
      withoutKeys.push(entry);
      return;
    }
    entry.keys.forEach(key => {
      if (!keyMap.has(key)) keyMap.set(key, { key, entries: [] });
      keyMap.get(key)!.entries.push(entry);
    });
  });

  keyMap.forEach(group => {
    group.entries.sort((left, right) => String(right.mergedAt).localeCompare(String(left.mergedAt)));
  });
  withoutKeys.sort((left, right) => String(right.mergedAt).localeCompare(String(left.mergedAt)));

  return { keyMap, withoutKeys };
}

async function enrichGitlabOnlyWithYtReasons(
  cfg: ChpConfig,
  items: Array<{ key: string; entries: ChpGitlabEntry[] }>,
  targetBranch: string,
  issueCache: Map<string, YtIssueBrief>,
  log?: LogFn
) {
  if (!items.length || !String(cfg.ytToken || '').trim()) return items.map(item => ({ ...item, reason: '' }));
  const targetRelease = normalizeReleaseForCompare(String(targetBranch || '').replace(/^release\//i, ''));

  const enriched = await withPool(items, 6, async item => {
    const firstEntry = item.entries[0];
    const platform = normalizePlatformLabel(firstEntry?.platform || '') === 'Android' ? 'Android' : 'iOS';
    const issue = await fetchIssueBrief(cfg, item.key, issueCache, log).catch(() => ({} as YtIssueBrief));
    const hasIssueData = Boolean(issue?.idReadable || (Array.isArray(issue?.fields) && issue.fields.length));
    const releases = readIssueReleaseVersions(issue, platform);
    let reason = '';

    if (hasIssueData && !releases.length) {
      reason = 'Не найдена версия релиза в задаче';
    } else if (hasIssueData && targetRelease && !releases.includes(targetRelease)) {
      reason = 'Версия релиза в YT не равна ветке в гите';
    }

    return {
      key: item.key,
      entries: item.entries,
      reason,
    };
  });

  return enriched;
}

function compareComposition(
  deployComposition: ChpRunResult['deployComposition'],
  gitlabComposition: Awaited<ReturnType<typeof collectGitlabComposition>>,
  enrichedGitlabOnly: Array<{ key: string; entries: ChpGitlabEntry[]; reason: string }>,
  targetBranch: string,
  lastRelease: string
): ChpCompositionResult {
  const deployMap = deployComposition.map || new Map();
  const gitlabMap = gitlabComposition.keyMap || new Map();

  const deployOnly = Array.from(deployMap.values())
    .filter(item => !gitlabMap.has(item.key))
    .map(item => ({
      key: item.key,
      platforms: Array.from(item.platforms).sort((a, b) => a.localeCompare(b)),
      releases: Array.from(item.releases).sort(compareReleaseLabels),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const gitlabOnly = enrichedGitlabOnly
    .filter(item => !deployMap.has(item.key))
    .filter(item => !isRevertGitlabEntry(item.entries[0]))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(item => ({
      key: item.key,
      reason: item.reason,
      entries: item.entries,
    }));

  const withoutKeys = (gitlabComposition.withoutKeys || []).slice();
  const matchedCount = Array.from(gitlabMap.keys()).filter(key => deployMap.has(key)).length;

  return {
    branch: targetBranch,
    releaseLabel: lastRelease ? displayRelease(lastRelease) : '—',
    deployUniqueCount: deployMap.size,
    gitlabUniqueCount: gitlabMap.size,
    matchedCount,
    deployOnly,
    gitlabOnly,
    withoutKeys,
    hasDiff: deployOnly.length > 0 || gitlabOnly.length > 0 || withoutKeys.length > 0,
  };
}

export function expandChpReleaseRange(startRelease: string, endRelease: string) {
  let start = parseRelease(startRelease);
  let end = parseRelease(endRelease);
  if (!start || !end) {
    throw new Error('Неверный формат релизов. Пример: 7.3.3000');
  }
  if (compareReleaseParts(start, end) > 0) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const out: string[] = [];
  let cursor = [...start] as [number, number, number];
  for (;;) {
    out.push(`${cursor[0]}.${cursor[1]}.${String(cursor[2]).padStart(4, '0')}`);
    if (cursor[0] === end[0] && cursor[1] === end[1] && cursor[2] === end[2]) break;
    cursor[2] += 1000;
    if (cursor[2] >= 10000) {
      cursor[2] = 0;
      cursor[1] += 1;
      if (cursor[1] >= 10) {
        cursor[1] = 0;
        cursor[0] += 1;
      }
    }
  }
  return out;
}

export async function collectChpRange(
  cfg: ChpConfig,
  startRelease: string,
  endRelease: string,
  options?: {
    onLog?: LogFn;
    onProgress?: ProgressFn;
  }
): Promise<ChpRunResult> {
  const onLog = options?.onLog;
  const onProgress = options?.onProgress;

  if (!String(cfg.deployLabToken || '').trim()) {
    throw new Error('Для сбора ЧП заполните DeployLab token.');
  }
  if (!String(cfg.ytToken || '').trim()) {
    throw new Error('Для сбора ЧП заполните YouTrack token.');
  }

  const releases = expandChpReleaseRange(startRelease, endRelease);
  const issueCache = new Map<string, YtIssueBrief>();

  onLog?.(`Релизов для сбора: ${releases.length}`);
  onProgress?.(8);

  const [android, ios] = await Promise.all([
    buildCountsForPlatform(cfg, 'Android', releases, issueCache, onLog),
    buildCountsForPlatform(cfg, 'iOS', releases, issueCache, onLog),
  ]);

  onProgress?.(55);

  const totalsRows = buildTotalsRows(releases, android.totalsByRelease, ios.totalsByRelease);
  const latestRelease = releases[releases.length - 1];
  const drivePayload: ChpDrivePayload = {
    releases: releases.map(toKey),
    and_counts: android.counts,
    and_totals: android.totalsByRelease,
    and_cutoffs: android.cutoffs,
    and_issue_keys: android.issueKeysByRelease,
    ios_counts: ios.counts,
    ios_totals: ios.totalsByRelease,
    ios_cutoffs: ios.cutoffs,
    ios_issue_keys: ios.issueKeysByRelease,
  };

  const deployComposition = buildDeployCompositionCache(
    releases,
    android.issueKeysByRelease,
    ios.issueKeysByRelease,
    latestRelease
  );

  onProgress?.(100);

  return {
    releases,
    latestRelease,
    android: {
      title: 'Android',
      counts: android.counts,
      totalsByRelease: android.totalsByRelease,
      cutoffs: android.cutoffs,
      issueKeysByRelease: android.issueKeysByRelease,
      tableHtml: renderPlatformTableHtml('Android', releases, android.counts, android.cutoffs),
    },
    ios: {
      title: 'iOS',
      counts: ios.counts,
      totalsByRelease: ios.totalsByRelease,
      cutoffs: ios.cutoffs,
      issueKeysByRelease: ios.issueKeysByRelease,
      tableHtml: renderPlatformTableHtml('iOS', releases, ios.counts, ios.cutoffs),
    },
    totalsRows,
    totalsText: buildTotalsText(totalsRows),
    drivePayload,
    deployComposition,
  };
}

export async function compareChpComposition(
  cfg: ChpConfig,
  gitlabToken: string,
  runResult: ChpRunResult,
  options?: {
    onLog?: LogFn;
    onProgress?: ProgressFn;
  }
) {
  const token = normalizeGitlabToken(gitlabToken);
  if (!token) {
    throw new Error('Для проверки состава ЧП заполните GitLab token.');
  }

  const latestRelease = runResult.latestRelease;
  const targetBranch = `release/${latestRelease}`;
  const issueCache = new Map<string, YtIssueBrief>();

  options?.onProgress?.(15);
  const gitlabComposition = await collectGitlabComposition(cfg, targetBranch, token, options?.onLog);
  options?.onProgress?.(85);

  const rawGitlabOnly = Array.from(gitlabComposition.keyMap.values());
  const enriched = await enrichGitlabOnlyWithYtReasons(cfg, rawGitlabOnly, targetBranch, issueCache, options?.onLog);
  options?.onProgress?.(100);

  return compareComposition(runResult.deployComposition, gitlabComposition, enriched, targetBranch, latestRelease);
}

export async function uploadChpToGoogleDrive(
  cfg: ChpConfig,
  payload: ChpDrivePayload,
  options?: { onLog?: LogFn }
) {
  const body = JSON.stringify({ payload });
  const text = await fetchText(cfg, APPS_SCRIPT_URL, {
    method: 'POST',
    body,
    service: 'google-disk',
    log: options?.onLog,
  });

  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Google Disk: невалидный JSON-ответ');
  }

  if (json?.ok !== true) {
    throw new Error(String(json?.error || 'Пустой/невалидный ответ Apps Script'));
  }

  return {
    sheetUrl: String(json.sheetUrl || json.spreadsheetUrl || GOOGLE_DRIVE_URL),
  };
}

export function getDefaultGoogleDriveUrl() {
  return GOOGLE_DRIVE_URL;
}

export function getChpTableStyles() {
  return `
    .chp-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:18px;background:var(--card)}
    .chp-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
    .chp-table thead th{background:var(--card-hi);border-bottom:1px solid var(--border);padding:.65rem .75rem;font-weight:800;color:var(--accent);position:sticky;top:0;z-index:1;white-space:nowrap}
    .chp-table tbody td{border-bottom:1px dashed var(--border);padding:.55rem .7rem;vertical-align:top;white-space:nowrap;color:var(--text)}
    .chp-table thead th:not(:last-child),.chp-table tbody td:not(:last-child){border-right:1px solid var(--surface-soft-3)}
    .chp-table tbody tr:hover td{background:var(--surface-soft)}
    .chp-table td:first-child,.chp-table th:first-child{position:sticky;left:0;background:inherit;z-index:2}
    .chp-stream-col{min-width:320px}
    .chp-sep-left{box-shadow:inset 1px 0 0 var(--border)}
    .chp-qhdr{background:var(--surface-soft-2)!important;color:var(--accent)!important;text-align:center}
    .chp-relhdr{text-align:center}
    .chp-subhdr{background:var(--surface-soft)!important;color:var(--text-3)!important;font-weight:600!important}
    .chp-itogo-hdr{background:var(--surface-soft-2)!important}
    .chp-itogo{background:var(--surface-soft)}
    .chp-num{text-align:right;font-variant-numeric:tabular-nums}
  `;
}
