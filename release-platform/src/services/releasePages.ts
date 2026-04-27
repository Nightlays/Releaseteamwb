import { proxyFetch } from './proxy';
import type { AppSettings } from '../types';

export type PlatformKey = 'android' | 'ios';
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ReleasePageConfig {
  settings: AppSettings;
  signal?: AbortSignal;
  onLog?: (message: string, level?: LogLevel) => void;
  onProgress?: (value: number) => void;
}

export interface ReleaseIssueMeta {
  key: string;
  summary: string;
  stream: string;
  substream: string;
  description: string;
  tags: string[];
  url: string;
  hotfixReason: string;
  hotfixDetails: string;
  locomotive: {
    business: string[];
    product: string[];
    technical: string[];
    any: string[];
  };
}

export interface QuarterAnalysisRow {
  platform: PlatformKey;
  version: string;
  month: number | null;
  stream: string;
  substream: string;
  hotfixReason: string;
  hotfixDetails: string;
  primaryTask: ReleaseIssueMeta | null;
  secondaryTasks: ReleaseIssueMeta[];
  buildTime: string;
  previousRolloutPercent: string;
  plannedHotfixDate: string;
  branchCutTime: string;
  actualSendTime: string;
  enteredReviewTime: string;
  onePercentDate: string;
  sourceCount: number;
}

export interface ChpRangeRow {
  platform: PlatformKey;
  release: string;
  issue: ReleaseIssueMeta;
  broughtBy: string;
  broughtAt: string;
  approval: string;
  mergedAt: string;
}

const DL_BASE = 'https://deploy-lab-api.wb.ru';
const DEFAULT_YT_BASE = 'https://youtrack.wildberries.ru';
const PLATFORM_META: Record<PlatformKey, { label: string; deployPrefix: string }> = {
  android: { label: 'Android', deployPrefix: 'ANDROID' },
  ios: { label: 'iOS', deployPrefix: 'IOS' },
};
const GITLAB_BASE = 'https://gitlab.wildberries.ru';
const GITLAB_GRAPHQL = `${GITLAB_BASE}/api/graphql`;
const GITLAB_PIPELINE_PAGE_SIZE = 100;
const BAND_PAGE_SIZE = 30;
const BAND_PAGE_LIMIT = 400;
const BAND_CHANNELS: Record<PlatformKey, string> = {
  android: 'mccs6h69jtdhu8uzeeg3nz1wxa',
  ios: 'kg4eed6pdpy1pfhhitjtmqqhpe',
};
const HOTFIX_TEMPLATE_CHANNELS: Record<PlatformKey, string> = {
  android: 'bzd6dd5133855cor6faew61xtr',
  ios: 'e87794p6sirx8kyg71dgrzp74r',
};
const RELEASE_FEED_CHANNEL_ID = 'tdj9ns46eprx8n5neupw8ejw9c';
const GITLAB_CONFIG: Record<PlatformKey, {
  fullPath: string;
  jobName: string;
  scope: string;
  storeSection: string;
}> = {
  android: {
    fullPath: 'mobile/androidnative/androidnative',
    jobName: 'build_qa',
    scope: 'all',
    storeSection: 'Google Play',
  },
  ios: {
    fullPath: 'mobile/ios/marketplace',
    jobName: 'build_for_testflight',
    scope: 'finished',
    storeSection: 'AppStore',
  },
};
const LOCOMOTIVE_TAGS = {
  business: ['бизнес локомотив', 'business locomotive', 'business'],
  product: ['продуктовый локомотив', 'продукт локомотив', 'product locomotive', 'product'],
  technical: ['технический локомотив', 'тех локомотив', 'technical locomotive', 'technical'],
};

interface BandPost {
  id?: unknown;
  root_id?: unknown;
  user_id?: unknown;
  create_at?: unknown;
  delete_at?: unknown;
  message?: unknown;
  props?: {
    attachments?: Array<{
      pretext?: unknown;
      title?: unknown;
      text?: unknown;
      fallback?: unknown;
      fields?: Array<{ title?: unknown; value?: unknown }>;
    }>;
  };
}

interface BandEvent {
  createdAt: number;
  text: string;
  postId: string;
}

interface RolloutEvent extends BandEvent {
  platform: PlatformKey;
  store: string;
  version: string;
  percent: number | null;
}

interface DeployReleaseSummary {
  platform: PlatformKey;
  releaseId: string;
  version: string;
  status: string;
  dateMs: number;
  cutoffMs: number;
  deployMs: number;
}

interface BandMilestones {
  buildTf: BandEvent | null;
  enteredReview: BandEvent | null;
  plannedHotfixSend: BandEvent | null;
}

function normalizeYtBase(value: string) {
  return (String(value || '').trim() || DEFAULT_YT_BASE)
    .replace('youtrack.wb.ru', 'youtrack.wildberries.ru')
    .replace(/\/+$/, '');
}

function withBearer(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

function normalizeIssueKey(raw: unknown) {
  const match = String(raw || '').trim().match(/\b((?:ANDR|IOS)-\d+)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function issueFieldName(field: { name?: string; projectCustomField?: { field?: { name?: string } } } | undefined) {
  return String(field?.name || field?.projectCustomField?.field?.name || '').trim();
}

function extractFieldText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (Array.isArray(value)) return value.map(extractFieldText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const record = value as { text?: string; markdownText?: string; name?: string; localizedName?: string; presentation?: string };
    return String(record.text || record.markdownText || record.name || record.localizedName || record.presentation || '').trim();
  }
  return '';
}

function pickFieldNames(issue: { fields?: Array<{ value?: unknown; name?: string; projectCustomField?: { field?: { name?: string } } }> }, target: string) {
  const out: string[] = [];
  for (const field of issue.fields || []) {
    if (issueFieldName(field) !== target) continue;
    const values = Array.isArray(field.value) ? field.value : [field.value];
    values.forEach(value => {
      const text = extractFieldText(value);
      if (text) out.push(text);
    });
  }
  return out;
}

function pickFirstSubstreamField(issue: { fields?: Array<{ value?: unknown; name?: string; projectCustomField?: { field?: { name?: string } } }> }) {
  for (const field of issue.fields || []) {
    if (!issueFieldName(field).toLowerCase().includes('substream')) continue;
    const values = Array.isArray(field.value) ? field.value : [field.value];
    return values.map(extractFieldText).filter(Boolean);
  }
  return [] as string[];
}

function pickSubstream(issue: { fields?: Array<{ value?: unknown; name?: string; projectCustomField?: { field?: { name?: string } } }> }, stream: string) {
  if (stream.trim().toLowerCase() === 'финтех') {
    const fintech = pickFieldNames(issue, 'Product Финтех');
    if (fintech.length) return fintech[0];
  }
  return pickFirstSubstreamField(issue)[0] || '';
}

function normalizeStream(value: string[]) {
  const stream = String(value[0] || '').trim();
  if (stream.toLowerCase().includes('paygate') && stream.includes('.')) {
    return stream.split('.').pop()?.trim() || stream;
  }
  return stream;
}

function parseRelease(raw: string) {
  const match = String(raw || '').trim().match(/^(\d+)\.(\d+)\.(\d{1,4})$/);
  if (!match) return null;
  const buildRaw = String(match[3]);
  const build = Number(buildRaw) * (buildRaw.length < 4 ? Math.pow(10, 4 - buildRaw.length) : 1);
  return { major: Number(match[1]), minor: Number(match[2]), build };
}

function formatRelease(parts: { major: number; minor: number; build: number }) {
  return `${parts.major}.${parts.minor}.${String(parts.build).padStart(4, '0')}`;
}

function compareRelease(left: string, right: string) {
  const a = parseRelease(left);
  const b = parseRelease(right);
  if (!a || !b) return left.localeCompare(right, 'ru');
  return a.major - b.major || a.minor - b.minor || a.build - b.build;
}

export function expandMajorReleaseRange(startRelease: string, endRelease: string) {
  let start = parseRelease(startRelease);
  let end = parseRelease(endRelease);
  if (!start || !end) throw new Error('Релиз должен быть в формате 7.6.0000');
  start = { ...start, build: Math.floor(start.build / 1000) * 1000 };
  end = { ...end, build: Math.floor(end.build / 1000) * 1000 };
  if (compareRelease(formatRelease(start), formatRelease(end)) > 0) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const out: string[] = [];
  const cursor = { ...start };
  for (;;) {
    out.push(formatRelease(cursor));
    if (cursor.major === end.major && cursor.minor === end.minor && cursor.build === end.build) break;
    cursor.build += 1000;
    if (cursor.build >= 10000) {
      cursor.build = 0;
      cursor.minor += 1;
    }
  }
  return out;
}

export function buildHotfixVersions(baseRelease: string) {
  const parsed = parseRelease(baseRelease);
  if (!parsed) throw new Error('Мажорный релиз должен быть в формате 7.5.6000');
  const familyBuild = Math.floor(parsed.build / 10) * 10;
  return Array.from({ length: 9 }, (_, index) => formatRelease({ ...parsed, build: familyBuild + index + 1 }));
}

function releaseFamily(raw: string) {
  const parsed = parseRelease(raw);
  if (!parsed) return '';
  return formatRelease({ ...parsed, build: Math.floor(parsed.build / 10) * 10 });
}

function isHotfixForFamily(version: string, family: string) {
  const parsed = parseRelease(version);
  const familyParsed = parseRelease(family);
  if (!parsed || !familyParsed) return false;
  const rawBuild = String(version || '').trim().match(/^\d+\.\d+\.(\d{1,4})$/)?.[1] || '';
  const shortHotfixBuild = rawBuild.length > 0 && rawBuild.length < 4 ? Number(rawBuild) : NaN;
  if (
    familyParsed.build === 0 &&
    parsed.major === familyParsed.major &&
    parsed.minor === familyParsed.minor &&
    Number.isFinite(shortHotfixBuild) &&
    shortHotfixBuild > 0
  ) {
    return true;
  }
  const blockEnd = Math.min(Math.floor(familyParsed.build / 1000) * 1000 + 1000, 10000);
  return parsed.major === familyParsed.major
    && parsed.minor === familyParsed.minor
    && parsed.build > familyParsed.build
    && parsed.build < blockEnd;
}

function hotfixSummariesForFamily(items: DeployReleaseSummary[], family: string) {
  const byVersion = new Map<string, DeployReleaseSummary>();
  items
    .filter(item => isHotfixForFamily(item.version, family))
    .sort((left, right) => compareRelease(left.version, right.version))
    .forEach(item => {
      if (!byVersion.has(item.version)) byVersion.set(item.version, item);
    });
  return Array.from(byVersion.values());
}

function previousVersion(version: string) {
  const parsed = parseRelease(version);
  if (!parsed || parsed.build <= 0) return '';
  return formatRelease({ ...parsed, build: parsed.build - 1 });
}

function isoToMs(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const normalized = raw
    .replace(/(\.\d{3})\d+(?=[Z+\-])/, '$1')
    .replace(/(\.\d{2})(?=[Z+\-])/, '$10')
    .replace(/(\.\d)(?=[Z+\-])/, '$100');
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function formatDateTime(ms: number) {
  if (!Number.isFinite(ms)) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms)).replace(',', '');
}

function monthFromMs(ms: number) {
  if (!Number.isFinite(ms)) return null;
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', month: 'numeric' }).format(new Date(ms))) - 1;
  return Number.isInteger(month) ? month : null;
}

function yearFromMs(ms: number) {
  if (!Number.isFinite(ms)) return null;
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(new Date(ms)));
  return Number.isFinite(year) ? year : null;
}

function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

function rowAnchorMs(values: Array<number | null | undefined>) {
  const dates = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return dates.length ? Math.min(...dates) : NaN;
}

function deployReleaseUrl(platform: PlatformKey, release: string) {
  return `${DL_BASE}/releaseboss/admin_panel/release/${PLATFORM_META[platform].deployPrefix}_${release}`;
}

function deployReleasesUrl(platform: PlatformKey) {
  return `${DL_BASE}/releaseboss/admin_panel/releases/${PLATFORM_META[platform].deployPrefix}`;
}

function deployIssuesUrl(platform: PlatformKey, release: string) {
  return `${deployReleaseUrl(platform, release)}/issues`;
}

function deployDeployUrl(platform: PlatformKey, release: string) {
  return `${deployReleaseUrl(platform, release)}/deploy`;
}

function ytIssueApiUrl(settings: AppSettings, key: string) {
  const fields = [
    'idReadable',
    'summary',
    'description',
    'tags(name)',
    'fields(projectCustomField(field(name)),value(name,localizedName,text,markdownText,presentation,$type),$type)',
  ].join(',');
  return `${normalizeYtBase(settings.ytBase)}/api/issues/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}&$top=-1`;
}

async function request(cfg: ReleasePageConfig, targetUrl: string, init: RequestInit = {}) {
  const useProxy = cfg.settings.useProxy !== false && cfg.settings.proxyBase.trim();
  const response = useProxy
    ? await proxyFetch({ base: cfg.settings.proxyBase, mode: cfg.settings.proxyMode, signal: cfg.signal }, targetUrl, init)
    : await fetch(targetUrl, { ...init, signal: cfg.signal });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Источник вернул не JSON: ${text.slice(0, 120)}`);
  }
}

function deployHeaders(cfg: ReleasePageConfig) {
  const token = String(cfg.settings.deployLabToken || '').trim();
  return {
    Accept: 'application/json, text/plain, */*',
    ...(token ? { 'authorization-deploy-lab': withBearer(token) } : {}),
  };
}

function normalizeDeployReleaseSummaries(payload: unknown, platform: PlatformKey): DeployReleaseSummary[] {
  const list = Array.isArray((payload as { releases?: unknown[] } | null)?.releases)
    ? (payload as { releases: unknown[] }).releases
    : Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown[] } | null)?.data)
        ? (payload as { data: unknown[] }).data
        : [];

  return list.map(item => {
    const record = item as Record<string, unknown>;
    const version = String(record.version || '').trim();
    if (!parseRelease(version)) return null;
    return {
      platform,
      releaseId: String(record.release_id || record.releaseId || `${PLATFORM_META[platform].deployPrefix}_${version}`),
      version,
      status: String(record.status || ''),
      dateMs: isoToMs(record.date || record.created_at || record.createdAt),
      cutoffMs: isoToMs(record.cutoff_date || record.cutoffDate),
      deployMs: isoToMs(record.deployDate || record.deploy_date),
    } satisfies DeployReleaseSummary;
  }).filter(Boolean) as DeployReleaseSummary[];
}

async function fetchDeployReleaseSummaries(cfg: ReleasePageConfig, platform: PlatformKey) {
  const payload = await request(cfg, deployReleasesUrl(platform), { headers: deployHeaders(cfg) });
  return normalizeDeployReleaseSummaries(payload, platform);
}

function ytHeaders(cfg: ReleasePageConfig) {
  const token = String(cfg.settings.ytToken || '').trim();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: withBearer(token) } : {}),
  };
}

function bandHeaders(cfg: ReleasePageConfig) {
  const cookies = String(cfg.settings.bandCookies || '').trim();
  if (!cookies) return null;
  return {
    Accept: 'application/json',
    'Accept-Language': 'ru',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Cookie': cookies,
  };
}

function isGitlabCookieAuth(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^(gitlab-|glpat-|Bearer\s+|PRIVATE-TOKEN\s+)/i.test(raw)) return false;
  return /[A-Za-z0-9_.-]+=/.test(raw);
}

function normalizeGitlabToken(value: string) {
  return String(value || '').trim().replace(/^(Bearer|PRIVATE-TOKEN)\s+/i, '').trim();
}

function gitlabHeaderVariants(cfg: ReleasePageConfig) {
  const cookie = String(cfg.settings.gitlabCookie || '').trim();
  if (cookie) {
    return [{
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'X-Proxy-Cookie': cookie,
    }];
  }

  const raw = String(cfg.settings.gitlabToken || '').trim();
  if (!raw) return [] as Record<string, string>[];
  if (isGitlabCookieAuth(raw)) {
    return [{
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'X-Proxy-Cookie': raw,
    }];
  }

  const token = normalizeGitlabToken(raw);
  if (!token) return [] as Record<string, string>[];
  return [
    { accept: 'application/json', 'PRIVATE-TOKEN': token },
    { accept: 'application/json', Authorization: `Bearer ${token}` },
  ];
}

async function requestWithHeaderVariants(cfg: ReleasePageConfig, targetUrl: string, headerVariants: Record<string, string>[]) {
  let lastError: Error | null = null;
  for (const headers of headerVariants) {
    try {
      return await request(cfg, targetUrl, { headers });
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError || new Error('GitLab auth failed');
}

function normalizeDeployIssues(payload: unknown) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] } | null)?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { content?: unknown[] } | null)?.content)
        ? (payload as { content: unknown[] }).content
      : [];
  return list.filter(item => (item as { merged_after_cutoff?: boolean })?.merged_after_cutoff === true);
}

function issueKeyFromDeploy(item: unknown) {
  const record = item as {
    key?: string;
    issue_key?: string;
    issueKey?: string;
    idReadable?: string;
    id_readable?: string;
    summary?: string;
    title?: string;
    name?: string;
    url?: string;
    issue?: { key?: string; summary?: string };
    task?: { key?: string };
  };
  const direct = [
    record.key,
    record.issue_key,
    record.issueKey,
    record.idReadable,
    record.id_readable,
    record.issue?.key,
    record.task?.key,
  ];
  for (const value of direct) {
    const key = normalizeIssueKey(value);
    if (key) return key;
  }
  return normalizeIssueKey([record.summary, record.title, record.name, record.url, record.issue?.summary].filter(Boolean).join(' '));
}

function extractEarliestDeployNoteMs(payload: unknown, sectionKey?: string) {
  const section = sectionKey && payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)[sectionKey]
    : payload;
  const dates: number[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    if ('date' in record || 'created_at' in record || 'createdAt' in record) {
      const ms = isoToMs(record.date || record.created_at || record.createdAt);
      if (Number.isFinite(ms)) dates.push(ms);
    }
    Object.values(record).forEach(walk);
  };
  walk(section);
  return dates.length ? Math.min(...dates) : NaN;
}

function normalizeTag(value: string) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function classifyLocomotiveTags(tags: string[]) {
  const result = { business: [] as string[], product: [] as string[], technical: [] as string[], any: [] as string[] };
  for (const raw of tags) {
    const norm = normalizeTag(raw);
    const isLoco = norm.includes('локомотив') || norm.includes('locomotive');
    for (const [kind, needles] of Object.entries(LOCOMOTIVE_TAGS)) {
      if (isLoco && needles.some(needle => norm.includes(needle))) {
        result[kind as keyof typeof LOCOMOTIVE_TAGS].push(raw);
        result.any.push(raw);
      }
    }
  }
  result.any = Array.from(new Set(result.any));
  return result;
}

function cleanMarkdown(value: string) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readHotfixDescription(description: string, label: 'reason' | 'details') {
  const source = cleanMarkdown(description);
  const labelRe = label === 'reason' ? 'Причина\\s+ХФ' : 'Детали\\s+ХФ';
  const pattern = new RegExp(`${labelRe}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:Причина\\s+ХФ|Детали\\s+ХФ)\\s*[:：]|$)`, 'i');
  const match = source.match(pattern);
  return match ? match[1].trim() : '';
}

async function fetchIssueMeta(cfg: ReleasePageConfig, key: string, cache: Map<string, ReleaseIssueMeta>) {
  const normalized = normalizeIssueKey(key);
  if (!normalized) return null;
  if (cache.has(normalized)) return cache.get(normalized)!;
  const raw = await request(cfg, ytIssueApiUrl(cfg.settings, normalized), { headers: ytHeaders(cfg) }).catch(error => {
    cfg.onLog?.(`YT ${normalized}: ${(error as Error).message}`, 'warn');
    return null;
  }) as Record<string, unknown> | null;

  const fieldsIssue = raw as { fields?: Array<{ value?: unknown; name?: string; projectCustomField?: { field?: { name?: string } } }> } | null;
  const stream = normalizeStream(pickFieldNames(fieldsIssue || {}, 'Stream')) || '-';
  const substream = pickSubstream(fieldsIssue || {}, stream) || '-';
  const description = String(raw?.description || '');
  const tags = Array.isArray((raw as { tags?: Array<{ name?: string }> } | null)?.tags)
    ? ((raw as { tags: Array<{ name?: string }> }).tags || []).map(tag => String(tag.name || '').trim()).filter(Boolean)
    : [];
  const meta: ReleaseIssueMeta = {
    key: normalized,
    summary: String(raw?.summary || '').trim(),
    stream,
    substream,
    description,
    tags,
    url: `${normalizeYtBase(cfg.settings.ytBase)}/issue/${encodeURIComponent(normalized)}`,
    hotfixReason: readHotfixDescription(description, 'reason') || '-',
    hotfixDetails: readHotfixDescription(description, 'details') || '-',
    locomotive: classifyLocomotiveTags(tags),
  };
  cache.set(normalized, meta);
  return meta;
}

function selectPrimaryIssueMeta(issues: ReleaseIssueMeta[]) {
  return issues.find(issue => issue.locomotive.any.length) || issues[0] || null;
}

function unwrapBandPostsPayload(raw: unknown): Record<string, unknown> {
  let node = raw;
  for (let index = 0; index < 5; index += 1) {
    if (node && typeof node === 'object' && 'posts' in node && typeof (node as { posts?: unknown }).posts === 'object') {
      return node as Record<string, unknown>;
    }
    if (node && typeof node === 'object' && 'body' in node) {
      const body = (node as { body?: unknown }).body;
      if (typeof body === 'string') {
        try {
          node = JSON.parse(body) as unknown;
          continue;
        } catch {
          break;
        }
      }
      if (body && typeof body === 'object') {
        node = body;
        continue;
      }
    }
    if (node && typeof node === 'object' && 'data' in node && typeof (node as { data?: unknown }).data === 'object') {
      node = (node as { data?: unknown }).data;
      continue;
    }
    break;
  }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

async function fetchBandChannelPostsSince(cfg: ReleasePageConfig, channelId: string, sinceMs: number) {
  const headers = bandHeaders(cfg);
  if (!headers) return [] as BandPost[];
  const postsById = new Map<string, BandPost>();
  let beforeId = '';

  for (let page = 0; page < BAND_PAGE_LIMIT; page += 1) {
    const url = new URL(`https://band.wb.ru/api/v4/channels/${encodeURIComponent(channelId)}/posts`);
    url.searchParams.set('page', '0');
    url.searchParams.set('per_page', String(BAND_PAGE_SIZE));
    if (beforeId) url.searchParams.set('before', beforeId);
    url.searchParams.set('skipFetchThreads', 'false');
    url.searchParams.set('collapsedThreads', 'true');
    url.searchParams.set('collapsedThreadsExtended', 'false');

    const payload = unwrapBandPostsPayload(await request(cfg, url.toString(), { headers }));
    const postsMap = payload.posts && typeof payload.posts === 'object'
      ? payload.posts as Record<string, BandPost>
      : {};
    const order = Array.isArray(payload.order) ? payload.order.map(String) : Object.keys(postsMap);
    if (!order.length && !Object.keys(postsMap).length) break;

    const batch: BandPost[] = [];
    order.forEach(id => {
      const post = postsMap[id];
      if (post && typeof post === 'object') {
        batch.push(post);
        if (!postsById.has(id)) postsById.set(id, post);
      }
    });
    Object.entries(postsMap).forEach(([id, post]) => {
      if (post && typeof post === 'object' && !postsById.has(id)) postsById.set(id, post);
    });

    batch.sort((left, right) => Number(right.create_at || 0) - Number(left.create_at || 0));
    const oldest = batch[batch.length - 1] || null;
    const oldestId = String(oldest?.id || '').trim();
    const oldestCreateAt = Number(oldest?.create_at || 0);
    cfg.onLog?.(`${channelId}: страница ${page + 1}, +${batch.length} сообщений`, 'ok');
    if (!oldestId || oldestId === beforeId) break;
    beforeId = oldestId;
    if (order.length < BAND_PAGE_SIZE) break;
    if (Number.isFinite(sinceMs) && Number.isFinite(oldestCreateAt) && oldestCreateAt < sinceMs) break;
  }

  return Array.from(postsById.values())
    .filter(post => {
      const deletedAt = Number(post.delete_at || 0);
      if (Number.isFinite(deletedAt) && deletedAt > 0) return false;
      const createdAt = Number(post.create_at || 0);
      if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
      if (Number.isFinite(sinceMs) && createdAt < sinceMs) return false;
      return true;
    })
    .sort((left, right) => Number(left.create_at || 0) - Number(right.create_at || 0));
}

function extractBandPostText(post: BandPost) {
  const chunks: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeText(
      String(value || '')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 $2')
        .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^\n*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
    );
    if (text) chunks.push(text);
  };

  push(post.message);
  const attachments = Array.isArray(post.props?.attachments) ? post.props.attachments : [];
  attachments.forEach(attachment => {
    push(attachment.pretext);
    push(attachment.title);
    push(attachment.text);
    push(attachment.fallback);
    const fields = Array.isArray(attachment.fields) ? attachment.fields : [];
    fields.forEach(field => {
      const title = normalizeText(field.title);
      const value = normalizeText(field.value);
      if (title && value) push(`${title}: ${value}`);
      else {
        push(title);
        push(value);
      }
    });
  });
  return normalizeText(chunks.join('\n'));
}

function textHasVersion(text: string, version: string) {
  const escaped = String(version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\d])${escaped}([^\\d]|$)`).test(String(text || ''));
}

function compactReleaseAliases(version: string, includeFamily = false) {
  const raw = String(version || '').trim();
  const parsed = parseRelease(version);
  if (!parsed) return [] as string[];
  const thousand = Math.floor(parsed.build / 1000);
  const familyBuild = thousand * 1000;
  const hotfixIndex = parsed.build - familyBuild;
  const familyFull = formatRelease({ ...parsed, build: familyBuild });
  const compactFamily = `${parsed.major}${parsed.minor}${thousand}`;
  const dottedFamily = `${parsed.major}.${parsed.minor}.${thousand}`;
  const aliases = new Set<string>([raw]);
  if (includeFamily) {
    aliases.add(familyFull);
    aliases.add(compactFamily);
    aliases.add(dottedFamily);
  }
  if (hotfixIndex > 0) {
    aliases.add(`${compactFamily}_${hotfixIndex}`);
    aliases.add(`${compactFamily}-${hotfixIndex}`);
    aliases.add(`${dottedFamily}_${hotfixIndex}`);
    aliases.add(`${dottedFamily}.${hotfixIndex}`);
  }
  return Array.from(aliases);
}

function compactAliasPattern(alias: string) {
  return Array.from(alias).map(char => {
    if (char === '.' ) return '\\s*\\.\\s*';
    if (char === '_' || char === '-') return '\\s*[_-]\\s*';
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
}

function textHasReleaseAlias(text: string, version: string, includeFamily = false) {
  if (textHasVersion(text, version)) return true;
  const source = String(text || '');
  const aliases = compactReleaseAliases(version, includeFamily);
  return aliases.some(alias => {
    if (alias === version) return false;
    const pattern = compactAliasPattern(alias);
    return new RegExp(`(^|[^A-Za-zА-Яа-яЁё0-9])${pattern}($|[^A-Za-zА-Яа-яЁё0-9])`, 'i').test(source);
  });
}

function extractReleaseVersion(text: string, platform: PlatformKey) {
  const source = String(text || '');
  const direct = source.match(/версия\s+(\d+\.\d+\.\d{1,4})/i);
  if (direct) return direct[1];
  if (platform === 'ios') {
    const iosTagged = [...source.matchAll(/\b(\d+\.\d+\.\d{1,4})\b\s+ios\b/ig)];
    if (iosTagged.length) return iosTagged[iosTagged.length - 1][1];
  }
  const generic = [...source.matchAll(/\b(\d+\.\d+\.\d{1,4})\b/g)];
  return generic.length ? generic[generic.length - 1][1] : '';
}

function detectStore(platform: PlatformKey, text: string) {
  const source = String(text || '').toLowerCase();
  if (platform === 'ios') return /app\s*store|appstore/.test(source) ? 'app_store' : '';
  if (/google play|play market|gplay/.test(source)) return 'google_play';
  if (/rustore/.test(source)) return 'ru_store';
  if (/appgallery|app gallery|huawei/.test(source)) return 'app_gallery';
  return '';
}

function parseRolloutEvent(post: BandPost, platform: PlatformKey): RolloutEvent | null {
  const text = extractBandPostText(post);
  if (!text || /снят[ао] с раскатки/i.test(text)) return null;
  const store = detectStore(platform, text);
  if (!store) return null;
  const version = extractReleaseVersion(text, platform);
  const parsed = parseRelease(version);
  if (!parsed) return null;
  const percentMatches = [...text.matchAll(/(\d{1,3})\s*%/g)];
  const percent = percentMatches.length ? Number(percentMatches[percentMatches.length - 1][1]) : null;
  const createdAt = Number(post.create_at || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  return {
    createdAt,
    text,
    postId: String(post.id || ''),
    platform,
    store,
    version: formatRelease(parsed),
    percent: Number.isFinite(percent) ? percent : null,
  };
}

function collectRolloutEvents(posts: BandPost[], platform: PlatformKey) {
  return posts.map(post => parseRolloutEvent(post, platform)).filter(Boolean) as RolloutEvent[];
}

function sameReleaseVersion(left: string, right: string) {
  const a = parseRelease(left);
  const b = parseRelease(right);
  if (!a || !b) return left === right;
  return a.major === b.major && a.minor === b.minor && a.build === b.build;
}

function firstRolloutStartEvent(events: RolloutEvent[], version: string, platform: PlatformKey) {
  const store = platform === 'ios' ? 'app_store' : 'google_play';
  const exact = events
    .filter(event => sameReleaseVersion(event.version, version) && event.store === store && event.percent !== null)
    .sort((left, right) => left.createdAt - right.createdAt);
  return exact.find(event => event.percent === 1) || exact[0] || null;
}

function firstStorePercentEvent(events: RolloutEvent[], version: string, platform: PlatformKey) {
  const store = platform === 'ios' ? 'app_store' : 'google_play';
  return events
    .filter(event => sameReleaseVersion(event.version, version) && event.store === store && event.percent !== null)
    .sort((left, right) => left.createdAt - right.createdAt)[0] || null;
}

function previousRolloutPercent(events: RolloutEvent[], prevVersion: string, beforeMs: number, platform: PlatformKey) {
  const store = platform === 'ios' ? 'app_store' : 'google_play';
  const filtered = events
    .filter(event => sameReleaseVersion(event.version, prevVersion) && event.store === store && event.percent !== null)
    .filter(event => !Number.isFinite(beforeMs) || event.createdAt <= beforeMs)
    .sort((left, right) => left.createdAt - right.createdAt);
  return filtered[filtered.length - 1] || null;
}

function parseRussianMonthIndex(raw: string) {
  const value = String(raw || '').trim().toLowerCase().replace(/ё/g, 'е');
  const map: Record<string, number> = {
    января: 0, январь: 0, янв: 0,
    февраля: 1, февраль: 1, фев: 1,
    марта: 2, март: 2, мар: 2,
    апреля: 3, апрель: 3, апр: 3,
    мая: 4, май: 4,
    июня: 5, июнь: 5, июн: 5,
    июля: 6, июль: 6, июл: 6,
    августа: 7, август: 7, авг: 7,
    сентября: 8, сентябрь: 8, сен: 8, сент: 8,
    октября: 9, октябрь: 9, окт: 9,
    ноября: 10, ноябрь: 10, ноя: 10,
    декабря: 11, декабрь: 11, дек: 11,
  };
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

function buildMskDateMs(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - 3 * 60 * 60 * 1000;
}

function parsePlannedHotfixSendDate(text: string) {
  const source = normalizeText(text);
  const plannedSendPattern = /планов[а-яёa-z]*\s+дат[а-яёa-z]*\s+отправк[а-яёa-z]*/i;
  const trigger = source.search(plannedSendPattern);
  if (trigger < 0) return NaN;
  const tail = source.slice(trigger, trigger + 180);

  let match = tail.match(/планов[а-яёa-z]*\s+дат[а-яёa-z]*\s+отправк[а-яёa-z]*\s*[-–—:]?\s*(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/i)
    || tail.match(/(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const day = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    let parsedYear = Number(match[3]);
    if (parsedYear < 100) parsedYear += 2000;
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    if (day >= 1 && day <= 31 && monthIndex >= 0 && monthIndex <= 11 && parsedYear >= 2000) {
      return buildMskDateMs(parsedYear, monthIndex, day) + (hour * 60 + minute) * 60_000;
    }
  }

  match = tail.match(/(\d{1,2})\s+([А-Яа-яё]+)\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/i);
  if (match) {
    const day = Number(match[1]);
    const monthIndex = parseRussianMonthIndex(match[2]);
    let parsedYear = Number(match[3]);
    if (parsedYear < 100) parsedYear += 2000;
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    if (day >= 1 && day <= 31 && monthIndex !== null && parsedYear >= 2000) {
      return buildMskDateMs(parsedYear, monthIndex, day) + (hour * 60 + minute) * 60_000;
    }
  }
  return NaN;
}

function eventMs(event: BandEvent | RolloutEvent | null | undefined) {
  const value = event?.createdAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

function parseBandMilestones(posts: BandPost[], platform: PlatformKey, versions: string[]) {
  const milestones = new Map<string, BandMilestones>();
  Array.from(new Set(versions.filter(Boolean))).forEach(version => {
    milestones.set(version, { buildTf: null, enteredReview: null, plannedHotfixSend: null });
  });

  const pick = (current: BandEvent | null, candidate: BandEvent) => {
    if (!current) return candidate;
    return candidate.createdAt < current.createdAt ? candidate : current;
  };

  posts.forEach(post => {
    const text = extractBandPostText(post);
    if (!text) return;
    const createdAt = Number(post.create_at || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return;
    milestones.forEach((item, version) => {
      if (!textHasReleaseAlias(text, version)) return;
      const event: BandEvent = { createdAt, text, postId: String(post.id || '') };
      const plannedHotfixSendMs = parsePlannedHotfixSendDate(text);
      if (Number.isFinite(plannedHotfixSendMs)) {
        item.plannedHotfixSend = pick(item.plannedHotfixSend, { ...event, createdAt: plannedHotfixSendMs });
      }
      if (platform === 'ios' && /(testflight|test flight|\btf\b|тест\s*флайт|загружен[ао]?.{0,40}(tf|testflight)|upload.{0,40}testflight)/i.test(text)) {
        item.buildTf = pick(item.buildTf, event);
      }
      if (platform === 'android' && /(qa\s*build|build_qa|собран[ао]?.{0,30}(qa|билд)|qa.{0,20}билд)/i.test(text)) {
        item.buildTf = pick(item.buildTf, event);
      }
      if (/(попал[аио]?|попали|находится|уш[её]л|отправлен[ао]?).{0,60}(провер|review|модерац)|in review/i.test(text)) {
        item.enteredReview = pick(item.enteredReview, event);
      }
    });
  });
  return milestones;
}

function normBandText(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function hotfixReleaseFeedRootMessages(platform: PlatformKey, version: string) {
  return platform === 'ios'
    ? [`#iOS #Hotfix ${version}`, `#IOS #Hotfix ${version}`]
    : [`#Android #Hotfix ${version}`];
}

function isActiveRootPost(post: BandPost) {
  if (!post) return false;
  if (Number(post.delete_at || 0) > 0) return false;
  return !String(post.root_id || '').trim();
}

function findReleaseFeedRootPost(feedPosts: BandPost[], platform: PlatformKey, version: string) {
  const targets = hotfixReleaseFeedRootMessages(platform, version).map(message => normBandText(message).toLowerCase());
  return feedPosts
    .filter(isActiveRootPost)
    .filter(post => targets.includes(normBandText(post.message).toLowerCase()))
    .sort((left, right) => Number(right.create_at || 0) - Number(left.create_at || 0))[0] || null;
}

async function fetchBandThreadPosts(cfg: ReleasePageConfig, rootId: string) {
  const headers = bandHeaders(cfg);
  if (!headers || !rootId) return [] as BandPost[];
  const url = new URL(`https://band.wb.ru/api/v4/posts/${encodeURIComponent(rootId)}/thread`);
  url.searchParams.set('skipFetchThreads', 'false');
  url.searchParams.set('collapsedThreads', 'true');
  url.searchParams.set('collapsedThreadsExtended', 'false');
  url.searchParams.set('direction', 'down');
  url.searchParams.set('perPage', '100');
  const payload = unwrapBandPostsPayload(await request(cfg, url.toString(), { headers }));
  const postsMap = payload.posts && typeof payload.posts === 'object'
    ? payload.posts as Record<string, BandPost>
    : {};
  const order = Array.isArray(payload.order) ? payload.order.map(String) : Object.keys(postsMap);
  const out = order.map(id => postsMap[id]).filter(Boolean);
  Object.entries(postsMap).forEach(([id, post]) => {
    if (!order.includes(id) && post) out.push(post);
  });
  return out
    .filter(post => Number(post.delete_at || 0) <= 0)
    .sort((left, right) => Number(left.create_at || 0) - Number(right.create_at || 0));
}

async function fetchReleaseFeedThreadMilestones(
  cfg: ReleasePageConfig,
  feedPosts: BandPost[],
  platform: PlatformKey,
  version: string,
) {
  const rootPost = findReleaseFeedRootPost(feedPosts, platform, version);
  const rootId = String(rootPost?.id || '').trim();
  if (!rootId) return null;
  try {
    const threadPosts = await fetchBandThreadPosts(cfg, rootId);
    cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: тред релиза найден, сообщений ${threadPosts.length}`, 'ok');
    return parseBandMilestones(threadPosts, platform, [version]).get(version) || null;
  } catch (error) {
    cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: не прочитал тред релиза: ${(error as Error).message}`, 'warn');
    return null;
  }
}

function findHotfixTemplateRootPost(posts: BandPost[], version: string) {
  const roots = posts
    .filter(isActiveRootPost)
    .map(post => ({ post, text: extractBandPostText(post) }))
    .filter(item => item.text);
  const matched = roots
    .map(item => {
      const exact = textHasReleaseAlias(item.text, version);
      const family = textHasReleaseAlias(item.text, version, true);
      const plannedMs = parsePlannedHotfixSendDate(item.text);
      if (!exact && !family) return null;
      return { ...item, exact, family, plannedMs };
    })
    .filter(Boolean) as Array<{ post: BandPost; text: string; exact: boolean; family: boolean; plannedMs: number }>;
  const matchedWithPlan = matched.filter(item => Number.isFinite(item.plannedMs));
  const candidates = matchedWithPlan.length ? matchedWithPlan : matched;
  return candidates
    .sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      if (Number.isFinite(left.plannedMs) && Number.isFinite(right.plannedMs) && left.plannedMs !== right.plannedMs) {
        return left.plannedMs - right.plannedMs;
      }
      return Number(right.post.create_at || 0) - Number(left.post.create_at || 0);
    })[0]?.post || null;
}

function hotfixTemplateDebug(posts: BandPost[], version: string) {
  const roots = posts
    .filter(isActiveRootPost)
    .map(post => ({ post, text: extractBandPostText(post) }))
    .filter(item => item.text);
  const exact = roots.filter(item => textHasReleaseAlias(item.text, version));
  const family = roots.filter(item => textHasReleaseAlias(item.text, version, true));
  const planned = roots.filter(item => Number.isFinite(parsePlannedHotfixSendDate(item.text)));
  const plannedMatched = roots.filter(item => (textHasReleaseAlias(item.text, version) || textHasReleaseAlias(item.text, version, true)) && Number.isFinite(parsePlannedHotfixSendDate(item.text)));
  const sample = (plannedMatched[0] || exact[0] || family[0] || planned[0] || roots[0])?.text || '';
  return {
    roots: roots.length,
    exact: exact.length,
    family: family.length,
    planned: planned.length,
    plannedMatched: plannedMatched.length,
    sample: normalizeText(sample).slice(0, 180),
  };
}

function parseThreadPlannedHotfixMilestone(posts: BandPost[]) {
  let plannedHotfixSend: BandEvent | null = null;
  posts.forEach(post => {
    const text = extractBandPostText(post);
    if (!text) return;
    const plannedMs = parsePlannedHotfixSendDate(text);
    if (!Number.isFinite(plannedMs)) return;
    const event: BandEvent = {
      createdAt: plannedMs,
      text,
      postId: String(post.id || ''),
    };
    if (!plannedHotfixSend || event.createdAt < plannedHotfixSend.createdAt) {
      plannedHotfixSend = event;
    }
  });
  return plannedHotfixSend ? { buildTf: null, enteredReview: null, plannedHotfixSend } satisfies BandMilestones : null;
}

async function fetchHotfixTemplateThreadMilestones(
  cfg: ReleasePageConfig,
  posts: BandPost[],
  platform: PlatformKey,
  version: string,
) {
  const debug = hotfixTemplateDebug(posts, version);
  const aliases = compactReleaseAliases(version).join(', ');
  cfg.onLog?.(
    `${PLATFORM_META[platform].label} ${version}: шаблоны ХФ root=${debug.roots}, exact=${debug.exact}, family=${debug.family}, planned=${debug.planned}, plannedMatched=${debug.plannedMatched}, aliases=${aliases || '-'}`,
    debug.plannedMatched ? 'ok' : debug.exact ? 'ok' : 'warn'
  );
  const rootPost = findHotfixTemplateRootPost(posts, version);
  const rootId = String(rootPost?.id || '').trim();
  if (!rootId) {
    if (debug.sample) {
      cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: root шаблона не найден, пример сообщения: ${debug.sample}`, 'warn');
    }
    return null;
  }
  const rootText = extractBandPostText(rootPost);
  cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: root шаблона найден: ${normalizeText(rootText).slice(0, 180)}`, 'ok');
  const rootMilestones = parseThreadPlannedHotfixMilestone([rootPost]);
  if (rootMilestones?.plannedHotfixSend) {
    cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: плановая дата найдена в root шаблона хотфикса`, 'ok');
  } else {
    cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: root найден, но плановая дата не распарсилась`, 'warn');
  }
  try {
    const threadPosts = await fetchBandThreadPosts(cfg, rootId);
    const unique = new Map<string, BandPost>();
    [rootPost, ...threadPosts].forEach(post => {
      const id = String(post?.id || '');
      if (id && !unique.has(id)) unique.set(id, post);
    });
    const result = parseThreadPlannedHotfixMilestone(Array.from(unique.values())) || rootMilestones;
    cfg.onLog?.(
      `${PLATFORM_META[platform].label} ${version}: шаблон хотфикса найден, плановая дата ${result?.plannedHotfixSend ? 'найдена' : 'не найдена'}`,
      result?.plannedHotfixSend ? 'ok' : 'warn'
    );
    return result;
  } catch (error) {
    cfg.onLog?.(`${PLATFORM_META[platform].label} ${version}: не прочитал тред шаблона хотфикса: ${(error as Error).message}`, 'warn');
    return rootMilestones;
  }
}

function buildGitlabPipelinesUrl(platform: PlatformKey, release: string, page: number) {
  const config = GITLAB_CONFIG[platform];
  const url = new URL(`${GITLAB_BASE}/api/v4/projects/${encodeURIComponent(config.fullPath)}/pipelines`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('ref', `release/${release}`);
  url.searchParams.set('per_page', String(GITLAB_PIPELINE_PAGE_SIZE));
  if (config.scope && config.scope !== 'all') url.searchParams.set('scope', config.scope);
  return url.toString();
}

function buildGitlabPipelineJobsUrl(platform: PlatformKey, iid: string, after: string | null) {
  const config = GITLAB_CONFIG[platform];
  const query = [
    'query getPipelineJobs($fullPath: ID!, $iid: ID!, $after: String) {',
    'project(fullPath: $fullPath) {',
    'pipeline(iid: $iid) {',
    'jobs(after: $after, first: 40) {',
    'pageInfo { hasNextPage endCursor }',
    'nodes { name finishedAt }',
    '}',
    '}',
    '}',
    '}',
  ].join(' ');
  const url = new URL(GITLAB_GRAPHQL);
  url.searchParams.set('query', query);
  url.searchParams.set('operationName', 'getPipelineJobs');
  url.searchParams.set('variables', JSON.stringify({
    fullPath: config.fullPath,
    iid: String(iid),
    after: after || null,
  }));
  return url.toString();
}

async function fetchGitlabOldestPipeline(cfg: ReleasePageConfig, platform: PlatformKey, version: string) {
  const headerVariants = gitlabHeaderVariants(cfg);
  if (!headerVariants.length) return null;
  let oldest: { iid: string; createdMs: number; createdAt: string } | null = null;
  for (let page = 1; page <= 20; page += 1) {
    const data = await requestWithHeaderVariants(cfg, buildGitlabPipelinesUrl(platform, version, page), headerVariants);
    const pipelines = Array.isArray((data as { pipelines?: unknown[] } | null)?.pipelines)
      ? (data as { pipelines: Array<Record<string, unknown>> }).pipelines
      : Array.isArray(data)
        ? data as Array<Record<string, unknown>>
        : [];
    if (!pipelines.length) break;
    for (const pipeline of pipelines) {
      const createdAt = String(pipeline.created_at || pipeline.createdAt || pipeline.created || '');
      const createdMs = isoToMs(createdAt);
      const iid = String(pipeline.iid || '').trim();
      if (!Number.isFinite(createdMs) || !iid) continue;
      if (!oldest || createdMs < oldest.createdMs) {
        oldest = { iid, createdMs, createdAt };
      }
    }
    if (pipelines.length < GITLAB_PIPELINE_PAGE_SIZE) break;
  }
  return oldest;
}

async function fetchGitlabPipelineJobFinishedAt(cfg: ReleasePageConfig, platform: PlatformKey, iid: string) {
  const headerVariants = gitlabHeaderVariants(cfg);
  if (!headerVariants.length || !iid) return NaN;
  const jobName = GITLAB_CONFIG[platform].jobName;
  let after: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const data = await requestWithHeaderVariants(cfg, buildGitlabPipelineJobsUrl(platform, iid, after), headerVariants);
    const jobs = (data as {
      data?: {
        project?: {
          pipeline?: {
            jobs?: {
              nodes?: Array<{ name?: string; finishedAt?: string }>;
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        };
      };
    } | null)?.data?.project?.pipeline?.jobs;
    const nodes = Array.isArray(jobs?.nodes) ? jobs.nodes : [];
    const target = nodes.find(node => String(node?.name || '').trim() === jobName);
    if (target?.finishedAt) return isoToMs(target.finishedAt);
    if (!jobs?.pageInfo?.hasNextPage || !jobs.pageInfo.endCursor) break;
    after = jobs.pageInfo.endCursor;
  }
  return NaN;
}

async function fetchDeployBundle(
  cfg: ReleasePageConfig,
  platform: PlatformKey,
  release: string,
  summary?: DeployReleaseSummary | null,
) {
  const [base, deploy, issuesPayload] = await Promise.all([
    request(cfg, deployReleaseUrl(platform, release), { headers: deployHeaders(cfg) }).catch(error => {
      cfg.onLog?.(`Deploy ${PLATFORM_META[platform].label} ${release}: ${(error as Error).message}`, 'warn');
      return null;
    }),
    request(cfg, deployDeployUrl(platform, release), { headers: deployHeaders(cfg) }).catch(() => null),
    request(cfg, deployIssuesUrl(platform, release), { headers: deployHeaders(cfg) }).catch(error => {
      cfg.onLog?.(`Issues ${PLATFORM_META[platform].label} ${release}: ${(error as Error).message}`, 'warn');
      return [];
    }),
  ]);
  const detailCutoffMs = isoToMs((base as { cutoff_date?: unknown; cutoffDate?: unknown } | null)?.cutoff_date || (base as { cutoffDate?: unknown } | null)?.cutoffDate);
  return {
    releaseMs: summary?.dateMs ?? NaN,
    cutoffMs: Number.isFinite(detailCutoffMs) ? detailCutoffMs : summary?.cutoffMs ?? NaN,
    storeMs: extractEarliestDeployNoteMs(deploy, GITLAB_CONFIG[platform].storeSection),
    issues: normalizeDeployIssues(issuesPayload),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, run));
  return out;
}

export async function collectQuarterReleaseAnalysis(
  cfg: ReleasePageConfig,
  release: string,
  year: number
): Promise<QuarterAnalysisRow[]> {
  if (!cfg.settings.deployLabToken.trim()) throw new Error('Заполни DeployLab token в настройках.');
  if (!cfg.settings.ytToken.trim()) throw new Error('Заполни YouTrack token в настройках.');
  const family = releaseFamily(release);
  if (!family) throw new Error('Мажорный релиз должен быть в формате 7.5.6000');

  const [androidReleaseSummaries, iosReleaseSummaries] = await Promise.all([
    fetchDeployReleaseSummaries(cfg, 'android'),
    fetchDeployReleaseSummaries(cfg, 'ios'),
  ]);
  const deployHotfixes: Record<PlatformKey, DeployReleaseSummary[]> = {
    android: hotfixSummariesForFamily(androidReleaseSummaries, family),
    ios: hotfixSummariesForFamily(iosReleaseSummaries, family),
  };
  (['android', 'ios'] as PlatformKey[]).forEach(platform => {
    const versions = deployHotfixes[platform].map(item => item.version);
    cfg.onLog?.(
      `DeployLab ${PLATFORM_META[platform].label}: ${versions.length ? `нашел ${versions.join(', ')}` : `хотфиксы для ${family} не найдены`}`,
      versions.length ? 'ok' : 'warn'
    );
  });

  const jobs = (['android', 'ios'] as PlatformKey[]).flatMap(platform => (
    deployHotfixes[platform].map(summary => ({ platform, version: summary.version, summary }))
  ));
  const allVersions = [family, ...jobs.map(job => job.version)].filter(Boolean);
  if (!jobs.length) {
    cfg.onProgress?.(100);
    return [];
  }
  const sinceMs = Date.UTC(year, 0, 1, 0, 0, 0);
  const issueCache = new Map<string, ReleaseIssueMeta>();
  const sources: Record<PlatformKey, { rolloutEvents: RolloutEvent[]; milestones: Map<string, BandMilestones> }> = {
    android: { rolloutEvents: [], milestones: new Map() },
    ios: { rolloutEvents: [], milestones: new Map() },
  };
  let releaseFeedPosts: BandPost[] = [];
  const hotfixTemplatePosts: Record<PlatformKey, BandPost[]> = {
    android: [],
    ios: [],
  };

  if (String(cfg.settings.bandCookies || '').trim()) {
    const [androidPosts, iosPosts, feedPosts, androidTemplatePosts, iosTemplatePosts] = await Promise.all([
      fetchBandChannelPostsSince(cfg, BAND_CHANNELS.android, sinceMs),
      fetchBandChannelPostsSince(cfg, BAND_CHANNELS.ios, sinceMs),
      fetchBandChannelPostsSince(cfg, RELEASE_FEED_CHANNEL_ID, sinceMs).catch(error => {
        cfg.onLog?.(`Лента релизов: ${(error as Error).message}`, 'warn');
        return [] as BandPost[];
      }),
      fetchBandChannelPostsSince(cfg, HOTFIX_TEMPLATE_CHANNELS.android, sinceMs).catch(error => {
        cfg.onLog?.(`Шаблоны хотфиксов Android: ${(error as Error).message}`, 'warn');
        return [] as BandPost[];
      }),
      fetchBandChannelPostsSince(cfg, HOTFIX_TEMPLATE_CHANNELS.ios, sinceMs).catch(error => {
        cfg.onLog?.(`Шаблоны хотфиксов iOS: ${(error as Error).message}`, 'warn');
        return [] as BandPost[];
      }),
    ]);
    releaseFeedPosts = feedPosts;
    hotfixTemplatePosts.android = androidTemplatePosts;
    hotfixTemplatePosts.ios = iosTemplatePosts;
    sources.android = {
      rolloutEvents: collectRolloutEvents(androidPosts, 'android'),
      milestones: parseBandMilestones(androidPosts, 'android', allVersions),
    };
    sources.ios = {
      rolloutEvents: collectRolloutEvents(iosPosts, 'ios'),
      milestones: parseBandMilestones(iosPosts, 'ios', allVersions),
    };
    cfg.onLog?.(
      `Band: Android ${androidPosts.length}, iOS ${iosPosts.length}, лента релизов ${feedPosts.length}, шаблоны Android ${androidTemplatePosts.length}, iOS ${iosTemplatePosts.length} сообщений`,
      'ok'
    );
  } else {
    cfg.onLog?.('Band cookies не заданы: Band-тайминги будут пустыми', 'warn');
  }

  let done = 0;
  const rows = await mapLimit(jobs, 3, async job => {
    cfg.onLog?.(`Собираю ${PLATFORM_META[job.platform].label} ${job.version}`);
    const deploy = await fetchDeployBundle(cfg, job.platform, job.version, job.summary);
    const keys = Array.from(new Set(deploy.issues.map(issueKeyFromDeploy).filter(Boolean)));
    const metas = (await mapLimit(keys, 6, key => fetchIssueMeta(cfg, key, issueCache))).filter(Boolean) as ReleaseIssueMeta[];
    const milestones = sources[job.platform].milestones.get(job.version) || null;
    const threadMilestones = releaseFeedPosts.length
      ? await fetchReleaseFeedThreadMilestones(cfg, releaseFeedPosts, job.platform, job.version)
      : null;
    const templateMilestones = hotfixTemplatePosts[job.platform].length
      ? await fetchHotfixTemplateThreadMilestones(cfg, hotfixTemplatePosts[job.platform], job.platform, job.version)
      : null;
    const rollout = firstRolloutStartEvent(sources[job.platform].rolloutEvents, job.version, job.platform);
    const actualSend = firstStorePercentEvent(sources[job.platform].rolloutEvents, job.version, job.platform);
    const previous = previousRolloutPercent(
      sources[job.platform].rolloutEvents,
      previousVersion(job.version),
      eventMs(actualSend) || eventMs(rollout),
      job.platform
    );

    let gitlabBuildMs = NaN;
    if (gitlabHeaderVariants(cfg).length) {
      try {
        const oldestPipeline = await fetchGitlabOldestPipeline(cfg, job.platform, job.version);
        if (oldestPipeline?.iid) {
          gitlabBuildMs = await fetchGitlabPipelineJobFinishedAt(cfg, job.platform, oldestPipeline.iid);
        }
      } catch (error) {
        cfg.onLog?.(`GitLab ${PLATFORM_META[job.platform].label} ${job.version}: ${(error as Error).message}`, 'warn');
      }
    }

    const buildFromBand = eventMs(milestones?.buildTf);
    const plannedHotfixMs = eventMs(templateMilestones?.plannedHotfixSend) || eventMs(threadMilestones?.plannedHotfixSend) || eventMs(milestones?.plannedHotfixSend);
    const enteredReviewMs = eventMs(milestones?.enteredReview);
    const buildMs = job.platform === 'ios'
      ? (Number.isFinite(buildFromBand) ? buildFromBand : gitlabBuildMs)
      : (Number.isFinite(gitlabBuildMs) ? gitlabBuildMs : buildFromBand);
    const anchorMs = rowAnchorMs([
      eventMs(rollout),
      eventMs(actualSend),
      plannedHotfixMs,
      buildMs,
      deploy.cutoffMs,
      deploy.releaseMs,
    ]);
    done += 1;
    cfg.onProgress?.(Math.round((done / jobs.length) * 100));
    if (
      !metas.length &&
      !Number.isFinite(deploy.cutoffMs) &&
      !Number.isFinite(deploy.releaseMs) &&
      !Number.isFinite(deploy.storeMs) &&
      !Number.isFinite(buildMs) &&
      !Number.isFinite(plannedHotfixMs) &&
      !Number.isFinite(enteredReviewMs) &&
      !actualSend &&
      !rollout &&
      !previous
    ) return null;

    const primary = selectPrimaryIssueMeta(metas);
    const secondary = primary ? metas.filter(meta => meta !== primary) : metas.slice(1);
    const month = monthFromMs(anchorMs);
    const rowYear = yearFromMs(anchorMs) || year;
    if (rowYear !== year) return null;
    return {
      platform: job.platform,
      version: job.version,
      month,
      stream: Array.from(new Set(metas.map(meta => meta.stream).filter(Boolean))).join(', ') || '-',
      substream: Array.from(new Set(metas.map(meta => meta.substream).filter(Boolean))).join(', ') || '-',
      hotfixReason: primary?.hotfixReason || '-',
      hotfixDetails: primary?.hotfixDetails || '-',
      primaryTask: primary,
      secondaryTasks: secondary,
      buildTime: formatDateTime(buildMs),
      previousRolloutPercent: previous ? `${previous.percent}% ${previous.version} · ${formatDateTime(previous.createdAt)}` : '-',
      plannedHotfixDate: formatDateTime(plannedHotfixMs),
      branchCutTime: formatDateTime(deploy.cutoffMs),
      actualSendTime: formatDateTime(eventMs(actualSend)),
      enteredReviewTime: formatDateTime(enteredReviewMs),
      onePercentDate: rollout ? `${rollout.percent}% · ${formatDateTime(eventMs(rollout))}` : '-',
      sourceCount: [
        deploy.issues.length ? true : null,
        Number.isFinite(deploy.releaseMs),
        Number.isFinite(deploy.cutoffMs),
        actualSend,
        Number.isFinite(buildMs),
        Number.isFinite(plannedHotfixMs),
        Number.isFinite(enteredReviewMs),
        rollout,
        previous,
      ].filter(Boolean).length,
    } satisfies QuarterAnalysisRow;
  });
  return rows.filter(Boolean).sort((a, b) => compareRelease(a!.version, b!.version)) as QuarterAnalysisRow[];
}

export async function collectChpReleaseRange(
  cfg: ReleasePageConfig,
  startRelease: string,
  endRelease: string,
  streamFilter: string
): Promise<ChpRangeRow[]> {
  if (!cfg.settings.deployLabToken.trim()) throw new Error('Заполни DeployLab token в настройках.');
  if (!cfg.settings.ytToken.trim()) throw new Error('Заполни YouTrack token в настройках.');
  const releases = expandMajorReleaseRange(startRelease, endRelease);
  const issueCache = new Map<string, ReleaseIssueMeta>();
  const jobs = releases.flatMap(release => (['android', 'ios'] as PlatformKey[]).map(platform => ({ platform, release })));
  const normalizedFilter = streamFilter.trim().toLowerCase().replace(/ё/g, 'е');
  let done = 0;
  const chunks = await mapLimit(jobs, 3, async job => {
    cfg.onLog?.(`ЧП ${PLATFORM_META[job.platform].label} ${job.release}`);
    const deploy = await fetchDeployBundle(cfg, job.platform, job.release);
    const keys = Array.from(new Set(deploy.issues.map(issueKeyFromDeploy).filter(Boolean)));
    const metas = (await mapLimit(keys, 6, key => fetchIssueMeta(cfg, key, issueCache))).filter(Boolean) as ReleaseIssueMeta[];
    done += 1;
    cfg.onProgress?.(Math.round((done / jobs.length) * 100));
    return metas
      .filter(meta => !normalizedFilter || meta.stream.toLowerCase().replace(/ё/g, 'е').includes(normalizedFilter))
      .map(meta => ({
        platform: job.platform,
        release: job.release,
        issue: meta,
        broughtBy: '-',
        broughtAt: '-',
        approval: '-',
        mergedAt: '-',
      } satisfies ChpRangeRow));
  });
  return chunks.flat().sort((a, b) => compareRelease(a.release, b.release) || a.issue.key.localeCompare(b.issue.key));
}

export function platformLabel(platform: PlatformKey) {
  return PLATFORM_META[platform].label;
}
