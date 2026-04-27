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
const LOCOMOTIVE_TAGS = {
  business: ['бизнес локомотив', 'business locomotive', 'business'],
  product: ['продуктовый локомотив', 'продукт локомотив', 'product locomotive', 'product'],
  technical: ['технический локомотив', 'тех локомотив', 'technical locomotive', 'technical'],
};

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

function deployReleaseUrl(platform: PlatformKey, release: string) {
  return `${DL_BASE}/releaseboss/admin_panel/release/${PLATFORM_META[platform].deployPrefix}_${release}`;
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

function ytHeaders(cfg: ReleasePageConfig) {
  const token = String(cfg.settings.ytToken || '').trim();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: withBearer(token) } : {}),
  };
}

function normalizeDeployIssues(payload: unknown) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] } | null)?.data)
      ? (payload as { data: unknown[] }).data
      : [];
  return list.filter(item => (item as { merged_after_cutoff?: boolean })?.merged_after_cutoff === true);
}

function issueKeyFromDeploy(item: unknown) {
  const record = item as { key?: string; issue_key?: string; idReadable?: string; summary?: string };
  return normalizeIssueKey(record.key || record.issue_key || record.idReadable || record.summary);
}

function extractEarliestDeployNoteMs(payload: unknown) {
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
  walk(payload);
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
    hotfixReason: readHotfixDescription(description, 'reason') || 'TBD',
    hotfixDetails: readHotfixDescription(description, 'details') || 'TBD',
    locomotive: classifyLocomotiveTags(tags),
  };
  cache.set(normalized, meta);
  return meta;
}

async function fetchDeployBundle(cfg: ReleasePageConfig, platform: PlatformKey, release: string) {
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
  const cutoffMs = isoToMs((base as { cutoff_date?: unknown; cutoffDate?: unknown } | null)?.cutoff_date || (base as { cutoffDate?: unknown } | null)?.cutoffDate);
  return {
    cutoffMs,
    storeMs: extractEarliestDeployNoteMs(deploy),
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
  const versions = buildHotfixVersions(release);
  const issueCache = new Map<string, ReleaseIssueMeta>();
  const jobs = versions.flatMap(version => (['android', 'ios'] as PlatformKey[]).map(platform => ({ platform, version })));
  let done = 0;
  const rows = await mapLimit(jobs, 3, async job => {
    cfg.onLog?.(`Собираю ${PLATFORM_META[job.platform].label} ${job.version}`);
    const deploy = await fetchDeployBundle(cfg, job.platform, job.version);
    const keys = Array.from(new Set(deploy.issues.map(issueKeyFromDeploy).filter(Boolean)));
    const metas = (await mapLimit(keys, 6, key => fetchIssueMeta(cfg, key, issueCache))).filter(Boolean) as ReleaseIssueMeta[];
    done += 1;
    cfg.onProgress?.(Math.round((done / jobs.length) * 100));
    if (!metas.length && !Number.isFinite(deploy.cutoffMs) && !Number.isFinite(deploy.storeMs)) return null;
    const primary = metas[0] || null;
    const anchorMs = deploy.storeMs || deploy.cutoffMs;
    const month = monthFromMs(anchorMs);
    const rowYear = Number.isFinite(anchorMs)
      ? Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(new Date(anchorMs)))
      : year;
    if (rowYear !== year) return null;
    return {
      platform: job.platform,
      version: job.version,
      month,
      stream: Array.from(new Set(metas.map(meta => meta.stream).filter(Boolean))).join(', ') || '-',
      substream: Array.from(new Set(metas.map(meta => meta.substream).filter(Boolean))).join(', ') || '-',
      hotfixReason: primary?.hotfixReason || 'TBD',
      hotfixDetails: primary?.hotfixDetails || 'TBD',
      primaryTask: primary,
      secondaryTasks: metas.slice(1),
      buildTime: '-',
      previousRolloutPercent: '-',
      plannedHotfixDate: '-',
      branchCutTime: formatDateTime(deploy.cutoffMs),
      actualSendTime: formatDateTime(deploy.storeMs),
      enteredReviewTime: '-',
      onePercentDate: formatDateTime(deploy.storeMs),
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

