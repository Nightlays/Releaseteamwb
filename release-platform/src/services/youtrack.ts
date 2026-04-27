import { aggregateReadiness, fetchAutomatedTotalCases, fetchLaunches, mapLaunch } from './allure';
import { proxyFetch, proxyJson, type ProxyMode } from './proxy';
import { ReleaseMetrics, ChpRow, BiVersionRow } from '../types';

export interface YtConfig {
  base: string;
  token: string;
  signal?: AbortSignal;
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
  deployLabToken?: string;
  biCookie?: string;
  allureBase?: string;
  allureToken?: string;
  projectId?: string;
}

export interface BiDeviceRow {
  platform: 'android' | 'ios';
  manufacturer: string;
  model: string;
  users: number;
  total: number;
  share: number;
}

export interface BiDeviceOsRow {
  platform: 'android' | 'ios';
  os: string;
  users: number;
  total: number;
  share: number;
}

export interface BiDevicesPayload {
  rows: BiDeviceRow[];
  osRows: BiDeviceOsRow[];
  fetchedAt: string;
  totals: Record<'android' | 'ios', number>;
}

export interface BiUserRecord {
  platform: 'iOS' | 'Android';
  release: string;
  users: number;
  share: number | null;
}

export interface BiUsersSnapshotPayload {
  records: BiUserRecord[];
  fetchedAt: string;
}

interface YtCustomField {
  name?: string;
  value?: unknown;
}

interface YtIssue {
  id?: string;
  idReadable?: string;
  summary?: string;
  tags?: Array<{ name?: string }>;
  customFields?: YtCustomField[];
  fields?: Array<{ name?: string; value?: unknown }>;
}

interface YtSortedIssueNode {
  id?: string;
}

interface YtIssuesGetterIssue {
  id?: string;
  idReadable?: string;
  summary?: string;
  description?: string;
  fields?: Array<{
    name?: string;
    value?: unknown;
    projectCustomField?: { field?: { name?: string } };
  }>;
}

interface DeployIssue {
  key?: string;
  summary?: string;
  title?: string;
  name?: string;
  type?: unknown;
  tags?: Array<string | { name?: string }>;
  merged_after_cutoff?: boolean;
}

export type EpicUserStoryMode = 'elena' | 'nadezhda' | 'darya';

export interface EpicUserStoryRow {
  key: string;
  summary: string;
  type: string;
  typeBucket: 'user_story' | 'epic' | 'task' | 'other';
  description: string;
  state: string;
  isRejected: boolean;
}

export interface EpicUserStoryCommonIssueRef {
  platform: 'ios' | 'android';
  key: string;
  url: string;
}

export interface EpicUserStoryCommonRow {
  issueRef: string;
  summary: string;
  issues: EpicUserStoryCommonIssueRef[];
}

export interface EpicUserStoryDigestResult {
  mode: EpicUserStoryMode;
  modeLabel: string;
  release: string;
  text: string;
  chips: string[];
  boardUrls: {
    ios?: string;
    android?: string;
    current?: string;
  };
  details: {
    iosRows?: EpicUserStoryRow[];
    androidRows?: EpicUserStoryRow[];
    commonRows?: EpicUserStoryCommonRow[];
    userStoryRows?: EpicUserStoryRow[];
    epicRows?: EpicUserStoryRow[];
    taskRows?: EpicUserStoryRow[];
  };
}

const BI_BASE = 'https://bi.wb.ru';
const BI_API_QUEUE = `${BI_BASE}/bi/v2/queue`;
const BI_API_QUEUE_V1 = `${BI_BASE}/bi/queue`;
const BI_API_CACHE = `${BI_BASE}/cache-puller/api/v1/cache`;
const BI_DATASOURCE_ID = 11386;
const BI_DEVICE_DS_ID = 14517;
const BI_DEVICE_OS_DS_ID = 16888;
const BI_DBCONN_ID = 4;
const BI_V2_DATASOURCES = new Set([BI_DATASOURCE_ID, BI_DEVICE_DS_ID, BI_DEVICE_OS_DS_ID]);
const BI_READY_STATUSES = new Set(['RESOLVED', 'DONE', 'SUCCESS', 'READY', 'CACHE_READY']);
const BI_ERROR_STATUSES = new Set(['FAILED', 'ERROR']);

const DEPLOY_ISSUES_URL_TMPL = 'https://deploy-lab-api.wb.ru/releaseboss/admin_panel/release/{prefix}_{rel}/issues';
const BI_INTERVAL = 'last_2_days';
const BI_PLATFORM_ORDER = ['iOS', 'Android'] as const;
const SORTED_ISSUES_FIELDS = 'tree(id,matches,ordered,parentId,summaryTextSearchResult(highlightRanges(endOffset,startOffset),textRange(endOffset,startOffset)))';
const AGILE_SPRINTS_FIELDS = 'archived,finish,goal,id,isDefault,isStarted,name,ordinal,report(id),start';
const ISSUES_GETTER_FIELDS =
  '$type,attachments(id),canAddPublicComment,canUpdateVisibility,commentsCount,created,fields($type,hasStateMachine,id,isUpdatable,name,projectCustomField($type,bundle(id),canBeEmpty,emptyFieldText,field(fieldType(isMultiValue,valueType),id,localizedName,name,ordinal),id,isEstimation,isPublic,isSpentTime,ordinal,size),value($type,archived,avatarUrl,buildIntegration,buildLink,color(background,foreground,id),description,fullName,id,isResolved,localizedName,login,markdownText,minutes,name,presentation,ringId,text)),hasEmail,id,idReadable,project($type,id,isDemo,leader(id),name,plugins(helpDeskSettings(enabled)),ringId,shortName),reporter($type,avatarUrl,banBadge,banned,canReadProfile,email,fullName,id,isEmailVerified,isLocked,issueRelatedGroup(icon),login,name,online,profiles(general(trackOnlineStatus)),ringId,userType(id)),resolved,summary,tags(color(id),id,isUpdatable,isUsable,name,owner(id),query),transaction(authorId,timestamp),updated,updater($type,avatarUrl,banBadge,banned,canReadProfile,email,fullName,id,isEmailVerified,isLocked,issueRelatedGroup(icon),login,name,online,profiles(general(trackOnlineStatus)),ringId,userType(id)),visibility($type,implicitPermittedUsers($type,avatarUrl,banBadge,banned,canReadProfile,email,fullName,id,isEmailVerified,isLocked,issueRelatedGroup(icon),login,name,online,profiles(general(trackOnlineStatus)),ringId,userType(id)),permittedGroups($type,allUsersGroup,icon,id,name,ringId),permittedUsers($type,avatarUrl,banBadge,banned,canReadProfile,email,fullName,id,isEmailVerified,isLocked,issueRelatedGroup(icon),login,name,online,profiles(general(trackOnlineStatus)),ringId,userType(id))),voters(hasVote),votes,watchers(hasStar)';
const ISSUE_FALLBACK_FIELDS =
  'id,idReadable,summary,description,fields($type,name,projectCustomField(field(name)),value($type,name,localizedName,text,markdownText,presentation))';
const TOP_ROOT = 101;
const IOS_SPRINT_FIELD = '{Версия релиза (ex. Sprint) iOS}';
const ANDROID_SPRINT_FIELD = '{Версия релиза (ex. Sprint) Android}';
const STORY_EPIC_AGILE_IDS = {
  ios: '83-469',
  android: '83-2175',
} as const;

function withBearer(token: string): string {
  const raw = String(token || '').trim();
  if (!raw) return '';
  return /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

function normalizeDeployLabToken(token: string): string {
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

function getProxyOptions(cfg: YtConfig) {
  if (cfg.useProxy === false || !String(cfg.proxyBase || '').trim()) return null;
  return {
    base: String(cfg.proxyBase).trim(),
    mode: cfg.proxyMode,
    signal: cfg.signal,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function findStringDeep(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return '';

  if (key in input && typeof (input as Record<string, unknown>)[key] === 'string') {
    return String((input as Record<string, unknown>)[key] || '').trim();
  }

  for (const value of Object.values(input as Record<string, unknown>)) {
    const nested = findStringDeep(value, key);
    if (nested) return nested;
  }

  return '';
}

function isBiV2DataSource(dataSourceId: number) {
  return BI_V2_DATASOURCES.has(dataSourceId);
}

function getBiQueueUrl(dataSourceId: number) {
  return isBiV2DataSource(dataSourceId)
    ? `${BI_API_QUEUE}/datasource/${dataSourceId}`
    : `${BI_API_QUEUE_V1}/datasource/${dataSourceId}`;
}

function getBiStatusUrl(requestId: string) {
  return `${BI_API_QUEUE_V1}/dbconn/${BI_DBCONN_ID}/request/${encodeURIComponent(requestId)}/status`;
}

function getBiResultUrl(requestId: string, dataSourceId: number) {
  return isBiV2DataSource(dataSourceId)
    ? `${BI_API_CACHE}/result/request/${encodeURIComponent(requestId)}?onlyCache=false`
    : `${BI_BASE}/bi/cache/result/request/${encodeURIComponent(requestId)}?onlyCache=false`;
}

function getBiReferer(dataSourceId: number) {
  return `https://bi.wb.ru/env/all/queries/${dataSourceId}`;
}

function buildBiHeaders(cookie: string, dataSourceId: number, key?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://bi.wb.ru',
    Referer: getBiReferer(dataSourceId),
    'X-Proxy-Cookie': cookie,
  };

  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers['X-Authorization'] = `Bearer ${key}`;
  }

  return headers;
}

async function proxyResponseJson(
  cfg: YtConfig,
  targetUrl: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const proxy = getProxyOptions(cfg);
  if (!proxy) {
    throw new Error('Для WB BI нужен локальный proxy.');
  }

  const response = await proxyFetch(proxy, targetUrl, init);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    json: safeJson<Record<string, unknown>>(text),
  };
}

async function runBiQuery(cfg: YtConfig, dataSourceId: number, body: Record<string, unknown>) {
  const cookie = String(cfg.biCookie || '').trim();
  if (!cookie) {
    throw new Error('Добавь WB BI Cookie в настройки.');
  }

  const queue = await proxyResponseJson(cfg, getBiQueueUrl(dataSourceId), {
    method: 'POST',
    headers: {
      ...buildBiHeaders(cookie, dataSourceId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!queue.ok) {
    throw new Error(`WB BI очередь вернула HTTP ${queue.status} для datasource ${dataSourceId}.`);
  }

  const requestId = findStringDeep(queue.json, 'requestId');
  const key = findStringDeep(queue.json, 'key');

  if (!requestId || !key) {
    throw new Error(`WB BI не вернул requestId/key для datasource ${dataSourceId}.`);
  }

  try {
    localStorage.setItem('bi_key_jwt', key);
  } catch {
    /* ignore */
  }

  const authHeaders = buildBiHeaders(cookie, dataSourceId, key);
  const startedAt = Date.now();
  const pollMs = 1500;
  const timeoutMs = 180000;

  if (isBiV2DataSource(dataSourceId)) {
    while (Date.now() - startedAt < timeoutMs) {
      const result = await proxyResponseJson(cfg, getBiResultUrl(requestId, dataSourceId), {
        headers: authHeaders,
      });
      const resultData = (result.json?.data as { rows?: unknown[] } | undefined) || undefined;
      const resultMeta = (result.json?.meta as { status?: string } | undefined) || undefined;
      const rows = Array.isArray(resultData?.rows) ? resultData.rows : null;
      const rawStatus = String(resultMeta?.status || result.json?.status || '').toUpperCase();

      if (result.ok && Array.isArray(rows) && (rows.length > 0 || BI_READY_STATUSES.has(rawStatus))) {
        return rows;
      }

      if (BI_ERROR_STATUSES.has(rawStatus)) {
        throw new Error(`WB BI статус ${rawStatus} для datasource ${dataSourceId}.`);
      }

      await sleep(pollMs);
    }

    throw new Error(`WB BI timeout для datasource ${dataSourceId}.`);
  }

  while (Date.now() - startedAt < timeoutMs) {
    const status = await proxyResponseJson(cfg, getBiStatusUrl(requestId), {
      headers: authHeaders,
    });
    const statusData = (status.json?.data as { status?: string } | undefined) || undefined;
    const rawStatus = String(statusData?.status || status.json?.status || '').toUpperCase();

    if (status.ok && BI_READY_STATUSES.has(rawStatus)) {
      break;
    }

    if (BI_ERROR_STATUSES.has(rawStatus)) {
      throw new Error(`WB BI статус ${rawStatus} для datasource ${dataSourceId}.`);
    }

    await sleep(pollMs);
  }

  const result = await proxyResponseJson(cfg, getBiResultUrl(requestId, dataSourceId), {
    headers: authHeaders,
  });

  if (!result.ok) {
    throw new Error(`WB BI result вернул HTTP ${result.status} для datasource ${dataSourceId}.`);
  }

  const resultData = (result.json?.data as { rows?: unknown[] } | undefined) || undefined;
  return Array.isArray(resultData?.rows) ? resultData.rows : [];
}

async function requestJson<T>(
  cfg: YtConfig,
  targetUrl: string,
  init?: RequestInit
): Promise<T> {
  const proxy = getProxyOptions(cfg);
  if (proxy) {
    return proxyJson<T>(proxy, targetUrl, init);
  }

  const response = await fetch(targetUrl, { ...init, signal: cfg.signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function buildYtHeaders(token: string, extra?: Record<string, string>) {
  return {
    Accept: 'application/json',
    Authorization: withBearer(token),
    ...(extra || {}),
  };
}

function normalizeYtBaseUrl(base: string) {
  const raw = String(base || '').trim() || 'https://youtrack.wildberries.ru';
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

function buildYtAbsoluteUrl(base: string, path: string) {
  return normalizeYtBaseUrl(base) + path;
}

function buildDeployHeaders(token: string, extra?: Record<string, string>) {
  const auth = withBearer(normalizeDeployLabToken(token));
  return {
    Accept: 'application/json, text/plain, */*',
    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'authorization-deploy-lab': auth,
    Origin: 'https://deploy-lab.wb.ru',
    Referer: 'https://deploy-lab.wb.ru/',
    ...(extra || {}),
  };
}

async function ytFetch<T>(
  cfg: YtConfig,
  path: string,
  params?: Record<string, string>,
  init?: RequestInit
): Promise<T> {
  const url = new URL(normalizeYtBaseUrl(cfg.base) + path);
  if (params) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return requestJson<T>(cfg, url.toString(), {
    ...init,
    headers: buildYtHeaders(cfg.token, (init?.headers as Record<string, string> | undefined) ?? undefined),
  });
}

function readFieldValue(issue: YtIssue, targetNames: string[]): unknown {
  const wanted = new Set(targetNames.map(name => name.toLowerCase()));
  const fields = Array.isArray(issue.customFields) ? issue.customFields : issue.fields || [];
  for (const field of fields) {
    const name = String(field?.name || '').toLowerCase();
    if (wanted.has(name)) return field?.value;
  }
  return undefined;
}

function readFieldName(issue: YtIssue, targetNames: string[]): string {
  const value = readFieldValue(issue, targetNames);
  if (!value) return '';
  if (Array.isArray(value)) {
    const first = value[0] as { name?: string; localizedName?: string; presentation?: string } | undefined;
    return String(first?.name || first?.localizedName || first?.presentation || '').trim();
  }
  if (typeof value === 'object') {
    const record = value as { name?: string; localizedName?: string; presentation?: string; text?: string };
    return String(record.name || record.localizedName || record.presentation || record.text || '').trim();
  }
  return String(value).trim();
}

function normalizeIssue(issue: YtIssue) {
  const customFields = Array.isArray(issue.customFields) ? issue.customFields : [];
  return {
    ...issue,
    id: issue.id || issue.idReadable || '',
    idReadable: issue.idReadable || issue.id || '',
    summary: issue.summary || '',
    tags: Array.isArray(issue.tags) ? issue.tags : [],
    customFields,
    fields: customFields.map(field => ({ name: field.name, value: field.value })),
  };
}

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}

const storyEpicBoardInfoCache = new Map<string, { url: string; releaseFinishMs: number | null }>();

function buildStoryEpicQuery(release: string, sprintField: string) {
  return `(Type: Epic OR Type: {User Story}) AND (${sprintField}: ${release}) AND State: -Rejected`;
}

function buildStoryEpicQueryByField(release: string, sprintField: string) {
  return `(${sprintField}: ${release}) AND (Type: {User Story} OR Type: {Epic}) AND State: -Rejected`;
}

function buildTasksQueryByField(release: string, sprintField: string) {
  return `(${sprintField}: ${release}) AND (Type: -{User Story}) AND (Type: -{Epic}) AND State: -Rejected AND ((description: флаг OR description: enable OR description: 'фф') OR (summary: флаг OR summary: enable OR summary: 'фф'))`;
}

async function fetchSortedIssueIdsByQuery(cfg: YtConfig, query: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('$top', '-1');
  params.set('fields', SORTED_ISSUES_FIELDS);
  params.set('flatten', 'true');
  params.set('query', query);
  params.set('skipRoot', '0');
  params.set('topRoot', String(TOP_ROOT));
  params.set('unresolvedOnly', 'false');

  const data = await requestJson<{ tree?: YtSortedIssueNode[] }>(
    cfg,
    `${buildYtAbsoluteUrl(cfg.base, '/api/sortedIssues')}?${params.toString()}`,
    {
      headers: buildYtHeaders(cfg.token),
    }
  );

  const tree = Array.isArray(data?.tree) ? data.tree : [];
  return tree.map(node => String(node?.id || '').trim()).filter(Boolean);
}

async function fetchSingleIssueFallback(cfg: YtConfig, id: string): Promise<YtIssuesGetterIssue | null> {
  const params = new URLSearchParams();
  params.set('fields', ISSUE_FALLBACK_FIELDS);

  const data = await requestJson<YtIssuesGetterIssue>(
    cfg,
    `${buildYtAbsoluteUrl(cfg.base, `/api/issues/${encodeURIComponent(id)}`)}?${params.toString()}`,
    {
      headers: buildYtHeaders(cfg.token),
    }
  ).catch(error => {
    if (isAbortError(error)) throw error;
    return null;
  });

  return data && typeof data === 'object' ? data : null;
}

async function fetchIssuesGetterBatch(cfg: YtConfig, ids: string[]): Promise<YtIssuesGetterIssue[]> {
  if (!ids.length) return [];

  const params = new URLSearchParams();
  params.set('$top', '-1');
  params.set('fields', ISSUES_GETTER_FIELDS);
  params.set('fieldsVisibleOnList', 'true');

  const data = await requestJson<YtIssuesGetterIssue[]>(
    cfg,
    `${buildYtAbsoluteUrl(cfg.base, '/api/issuesGetter')}?${params.toString()}`,
    {
      method: 'POST',
      headers: buildYtHeaders(cfg.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(ids.map(id => ({ id }))),
    }
  ).catch(error => {
    if (isAbortError(error)) throw error;
    return [];
  });

  return Array.isArray(data) ? data : [];
}

async function fetchIssueDetailsForOrder(cfg: YtConfig, ids: string[]): Promise<YtIssuesGetterIssue[]> {
  if (!ids.length) return [];

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const byId = new Map<string, YtIssuesGetterIssue>();

  const firstPass = await fetchIssuesGetterBatch(cfg, uniqueIds);
  firstPass.forEach(item => {
    const id = String(item?.id || '').trim();
    if (id) byId.set(id, item);
  });

  const missing = uniqueIds.filter(id => !byId.has(id));
  if (missing.length) {
    const batchSize = 20;
    for (let index = 0; index < missing.length; index += batchSize) {
      const recovered = await fetchIssuesGetterBatch(cfg, missing.slice(index, index + batchSize));
      recovered.forEach(item => {
        const id = String(item?.id || '').trim();
        if (id) byId.set(id, item);
      });
    }
  }

  const stillMissing = uniqueIds.filter(id => !byId.has(id));
  for (const id of stillMissing) {
    const fallback = await fetchSingleIssueFallback(cfg, id);
    const recoveredId = String(fallback?.id || '').trim();
    if (recoveredId) byId.set(recoveredId, fallback!);
  }

  return Array.from(byId.values());
}

async function fetchAgileSprints(cfg: YtConfig, agileId: string) {
  const params = new URLSearchParams();
  params.set('issuesQuery', '');
  params.set('$top', '-1');
  params.set('fields', AGILE_SPRINTS_FIELDS);

  const data = await requestJson<Array<{ id?: string; name?: string; finish?: string | number }>>(
    cfg,
    `${buildYtAbsoluteUrl(cfg.base, `/api/agiles/${agileId}/sprints/`)}?${params.toString()}`,
    {
      headers: buildYtHeaders(cfg.token),
    }
  );

  return Array.isArray(data) ? data : [];
}

function normalizeReleaseName(value: unknown) {
  return String(value || '').trim();
}

function parseYtDateMs(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return Number.NaN;
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function formatStoreDate(ms: number) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    const date = new Date(ms);
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  }
}

function latestStoreDate(results: Array<{ releaseFinishMs?: number | null }>) {
  const candidates = results.map(item => Number(item?.releaseFinishMs)).filter(value => Number.isFinite(value));
  if (!candidates.length) return '';
  return formatStoreDate(Math.max(...candidates));
}

async function fetchStoryEpicBoardInfo(cfg: YtConfig, agileId: string, release: string) {
  const releaseNorm = normalizeReleaseName(release);
  const cacheKey = `${cfg.base}::${agileId}::${releaseNorm}`;
  if (storyEpicBoardInfoCache.has(cacheKey)) {
    return storyEpicBoardInfoCache.get(cacheKey)!;
  }

  const sprints = await fetchAgileSprints(cfg, agileId);
  const sprint = sprints.find(item => normalizeReleaseName(item?.name) === releaseNorm);
  const url = sprint?.id
    ? `${normalizeYtBaseUrl(cfg.base)}/agiles/${agileId}/${sprint.id}`
    : `${normalizeYtBaseUrl(cfg.base)}/agiles/${agileId}/current`;
  const finishMs = parseYtDateMs(sprint?.finish);
  const info = {
    url,
    releaseFinishMs: Number.isFinite(finishMs) ? finishMs : null,
  };

  storyEpicBoardInfoCache.set(cacheKey, info);
  return info;
}

function issueFieldNameForDigest(field: { name?: string; projectCustomField?: { field?: { name?: string } } } | undefined) {
  return String(field?.name || field?.projectCustomField?.field?.name || '').trim();
}

function extractFieldTextForDigest(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (typeof value === 'object') {
    const record = value as { text?: string; markdownText?: string; name?: string; localizedName?: string; presentation?: string };
    if (typeof record.text === 'string') return record.text;
    if (typeof record.markdownText === 'string') return record.markdownText;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.localizedName === 'string') return record.localizedName;
    if (typeof record.presentation === 'string') return record.presentation;
  }
  if (Array.isArray(value)) {
    return value.map(item => extractFieldTextForDigest(item)).filter(Boolean).join(' ');
  }
  return '';
}

function readDigestIssueType(issue: YtIssuesGetterIssue) {
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  for (const field of fields) {
    const fieldName = issueFieldNameForDigest(field).toLowerCase();
    if (fieldName !== 'type' && fieldName !== 'тип') continue;
    return extractFieldTextForDigest(field?.value).trim();
  }
  return '';
}

function readDigestIssueDescription(issue: YtIssuesGetterIssue) {
  if (typeof issue?.description === 'string') return issue.description.trim();
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  for (const field of fields) {
    const fieldName = issueFieldNameForDigest(field).toLowerCase();
    if (fieldName !== 'description' && fieldName !== 'описание') continue;
    return extractFieldTextForDigest(field?.value).trim();
  }
  return '';
}

function readDigestIssueState(issue: YtIssuesGetterIssue) {
  const fields = Array.isArray(issue?.fields) ? issue.fields : [];
  for (const field of fields) {
    const fieldName = issueFieldNameForDigest(field).toLowerCase();
    if (fieldName !== 'state' && fieldName !== 'status' && fieldName !== 'состояние' && fieldName !== 'статус') continue;
    return extractFieldTextForDigest(field?.value).trim();
  }
  return '';
}

function isRejectedState(rawState: unknown) {
  const value = String(rawState || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return value === 'rejected' || value.startsWith('rejected ');
}

function normalizeTypeBucket(rawType: string): EpicUserStoryRow['typeBucket'] {
  const value = String(rawType || '').trim().toLowerCase();
  if (value === 'user story' || value === 'userstory' || value === 'история пользователя') return 'user_story';
  if (value === 'epic' || value === 'эпик') return 'epic';
  if (value === 'task' || value === 'задача') return 'task';
  return 'other';
}

function normalizeDigestIssue(issue: Partial<YtIssuesGetterIssue>): EpicUserStoryRow {
  const type = readDigestIssueType(issue as YtIssuesGetterIssue);
  const state = readDigestIssueState(issue as YtIssuesGetterIssue);
  return {
    key: String(issue?.idReadable || issue?.id || '-').trim(),
    summary: String(issue?.summary || '').trim(),
    type,
    typeBucket: normalizeTypeBucket(type),
    description: readDigestIssueDescription(issue as YtIssuesGetterIssue),
    state,
    isRejected: isRejectedState(state),
  };
}

function orderedDigestRows(idsInOrder: string[], issueItems: YtIssuesGetterIssue[], options?: { keepMissing?: boolean }) {
  const keepMissing = Boolean(options?.keepMissing);
  const byId = new Map<string, YtIssuesGetterIssue>();
  issueItems.forEach(item => {
    const id = String(item?.id || '').trim();
    if (id) byId.set(id, item);
  });

  return idsInOrder
    .map(id => byId.get(id) || (keepMissing ? {
      id,
      idReadable: id,
      summary: 'Нет данных по задаче (issuesGetter)',
    } : null))
    .filter(Boolean)
    .map(item => normalizeDigestIssue(item as Partial<YtIssuesGetterIssue>));
}

function buildIssueLink(base: string, key: string) {
  return `${base.replace(/\/+$/, '')}/issue/${encodeURIComponent(key)}`;
}

function asMarkdownCell(value: unknown) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildIssueLinks(base: string, rows: EpicUserStoryRow[]) {
  return rows.map(row => {
    const key = asMarkdownCell(row.key);
    return `[${key}](${buildIssueLink(base, row.key)})`;
  }).join(', ');
}

function normalizeSummaryForMatch(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildCommonRows(base: string, iosRows: EpicUserStoryRow[], androidRows: EpicUserStoryRow[]) {
  const iosMap = new Map<string, EpicUserStoryRow[]>();
  const androidMap = new Map<string, EpicUserStoryRow[]>();

  iosRows.forEach(row => {
    const key = normalizeSummaryForMatch(row.summary);
    if (!key) return;
    if (!iosMap.has(key)) iosMap.set(key, []);
    iosMap.get(key)!.push(row);
  });

  androidRows.forEach(row => {
    const key = normalizeSummaryForMatch(row.summary);
    if (!key) return;
    if (!androidMap.has(key)) androidMap.set(key, []);
    androidMap.get(key)!.push(row);
  });

  const commonRows: EpicUserStoryCommonRow[] = [];
  const commonKeys = new Set<string>();

  iosMap.forEach((iosList, key) => {
    const androidList = androidMap.get(key);
    if (!androidList?.length) return;
    commonKeys.add(key);
    const sampleSummary = iosList[0]?.summary || androidList[0]?.summary || '';
    commonRows.push({
      issueRef: `${buildIssueLinks(base, iosList)} / ${buildIssueLinks(base, androidList)}`,
      summary: asMarkdownCell(sampleSummary),
      issues: [
        ...iosList.map(row => ({ platform: 'ios' as const, key: row.key, url: buildIssueLink(base, row.key) })),
        ...androidList.map(row => ({ platform: 'android' as const, key: row.key, url: buildIssueLink(base, row.key) })),
      ],
    });
  });

  commonRows.sort((left, right) => left.summary.localeCompare(right.summary, 'ru', { sensitivity: 'base' }));
  return { rows: commonRows, keys: commonKeys };
}

function withoutCommonRows(rows: EpicUserStoryRow[], commonKeys: Set<string>) {
  return rows.filter(row => !commonKeys.has(normalizeSummaryForMatch(row.summary)));
}

function buildPlatformTable(base: string, title: string, rows: EpicUserStoryRow[], boardLabel: string, boardUrl: string) {
  const lines = [title];
  if (boardUrl) {
    lines.push(`[Ссылка на доску ${boardLabel}](${String(boardUrl).trim()})`);
  }
  lines.push('| Номер задачи | Название задачи |');
  lines.push('| --- | --- |');

  if (!rows.length) {
    lines.push('| - | Нет задач по запросу |');
    return lines;
  }

  rows.forEach(row => {
    const key = asMarkdownCell(row.key);
    const summary = asMarkdownCell(row.summary);
    lines.push(`| [${key}](${buildIssueLink(base, row.key)}) | ${summary} |`);
  });

  return lines;
}

function buildCommonTable(commonRows: EpicUserStoryCommonRow[]) {
  const lines = ['Общие крупные задачи.', '| Номер задачи | Название задачи |', '| --- | --- |'];
  if (!commonRows.length) {
    lines.push('| - | Нет общих задач по названию |');
    return lines;
  }

  commonRows.forEach(row => {
    lines.push(`| ${row.issueRef} | ${row.summary} |`);
  });

  return lines;
}

function buildElenaMessage(
  base: string,
  release: string,
  releaseStoreDate: string,
  iosRows: EpicUserStoryRow[],
  iosBoardUrl: string,
  androidRows: EpicUserStoryRow[],
  androidBoardUrl: string
) {
  const lines: string[] = [];
  const common = buildCommonRows(base, iosRows, androidRows);
  const iosPlatformRows = withoutCommonRows(iosRows, common.keys);
  const androidPlatformRows = withoutCommonRows(androidRows, common.keys);

  lines.push(releaseStoreDate
    ? `Релиз ${release}. Плановая дата отправки релиза в стор ${releaseStoreDate}.`
    : `Релиз ${release}.`);
  lines.push('');
  lines.push(...buildPlatformTable(base, 'iOS крупные задачи.', iosPlatformRows, 'IOS', iosBoardUrl));
  lines.push('');
  lines.push(...buildPlatformTable(base, 'Android крупные задачи.', androidPlatformRows, 'Android', androidBoardUrl));
  lines.push('');
  lines.push(...buildCommonTable(common.rows));

  return {
    text: lines.join('\n'),
    iosRows: iosPlatformRows,
    androidRows: androidPlatformRows,
    commonRows: common.rows,
  };
}

function appendNadezhdaSection(base: string, lines: string[], title: string, rows: EpicUserStoryRow[]) {
  lines.push(`${title}:`);
  if (!rows.length) {
    lines.push('Нет задач');
    lines.push('');
    return;
  }

  rows.forEach(row => {
    const key = asMarkdownCell(row.key);
    const summary = asMarkdownCell(row.summary);
    lines.push(`[${key}](${buildIssueLink(base, row.key)}) ${summary}`);
  });
  lines.push('');
}

function buildNadezhdaTable(base: string, userStoryRows: EpicUserStoryRow[], epicRows: EpicUserStoryRow[], taskRows: EpicUserStoryRow[]) {
  const lines: string[] = [];
  appendNadezhdaSection(base, lines, 'User Story', userStoryRows);
  appendNadezhdaSection(base, lines, 'Epic', epicRows);
  appendNadezhdaSection(base, lines, 'Другие задачи', taskRows);
  return lines.join('\n').trimEnd();
}

function buildNadezhdaMessage(
  base: string,
  release: string,
  platformLabel: string,
  emoji: string,
  boardLabel: string,
  boardUrl: string,
  userStoryRows: EpicUserStoryRow[],
  epicRows: EpicUserStoryRow[],
  taskRows: EpicUserStoryRow[]
) {
  const lines = [
    `**Привет! ${release} ${platformLabel}  ${emoji}**`,
    '**Проверьте пожалуйста флаги в задачах релиза**',
  ];

  if (boardUrl) {
    lines.push(`[Ссылка на доску ${boardLabel}](${String(boardUrl).trim()})`);
  }

  lines.push('');
  lines.push(buildNadezhdaTable(base, userStoryRows, epicRows, taskRows));
  return lines.join('\n');
}

async function collectDigestRowsByQuery(cfg: YtConfig, query: string) {
  const sortedIds = await fetchSortedIssueIdsByQuery(cfg, query);
  const issueItems = await fetchIssueDetailsForOrder(cfg, sortedIds);
  return orderedDigestRows(sortedIds, issueItems, { keepMissing: true });
}

async function collectPlatformDigest(cfg: YtConfig, release: string, platform: 'ios' | 'android') {
  const sprintField = platform === 'ios' ? IOS_SPRINT_FIELD : ANDROID_SPRINT_FIELD;
  const agileId = platform === 'ios' ? STORY_EPIC_AGILE_IDS.ios : STORY_EPIC_AGILE_IDS.android;
  const query = buildStoryEpicQuery(release, sprintField);

  const [boardInfo, sortedIds] = await Promise.all([
    fetchStoryEpicBoardInfo(cfg, agileId, release),
    fetchSortedIssueIdsByQuery(cfg, query),
  ]);
  const issueItems = await fetchIssueDetailsForOrder(cfg, sortedIds);

  return {
    rows: orderedDigestRows(sortedIds, issueItems),
    boardUrl: boardInfo.url,
    releaseFinishMs: boardInfo.releaseFinishMs,
  };
}

async function buildElenaDigest(cfg: YtConfig, release: string): Promise<EpicUserStoryDigestResult> {
  const [iosResult, androidResult] = await Promise.all([
    collectPlatformDigest(cfg, release, 'ios'),
    collectPlatformDigest(cfg, release, 'android'),
  ]);

  const message = buildElenaMessage(
    cfg.base,
    release,
    latestStoreDate([iosResult, androidResult]),
    iosResult.rows,
    iosResult.boardUrl,
    androidResult.rows,
    androidResult.boardUrl
  );

  return {
    mode: 'elena',
    modeLabel: 'Елена',
    release,
    text: message.text,
    chips: [
      `Релиз: ${release}`,
      `iOS: ${message.iosRows.length}`,
      `Android: ${message.androidRows.length}`,
      `Общие: ${message.commonRows.length}`,
      `Всего: ${message.iosRows.length + message.androidRows.length + message.commonRows.length}`,
    ],
    boardUrls: {
      ios: iosResult.boardUrl,
      android: androidResult.boardUrl,
    },
    details: {
      iosRows: message.iosRows,
      androidRows: message.androidRows,
      commonRows: message.commonRows,
    },
  };
}

async function buildNadezhdaLikeDigest(
  cfg: YtConfig,
  release: string,
  options: {
    mode: 'nadezhda' | 'darya';
    sprintField: string;
    agileId: string;
    boardLabel: string;
    platformLabel: string;
    emoji: string;
    modeLabel: string;
  }
): Promise<EpicUserStoryDigestResult> {
  const [storyEpicRows, taskRows, boardInfo] = await Promise.all([
    collectDigestRowsByQuery(cfg, buildStoryEpicQueryByField(release, options.sprintField)),
    collectDigestRowsByQuery(cfg, buildTasksQueryByField(release, options.sprintField)),
    fetchStoryEpicBoardInfo(cfg, options.agileId, release),
  ]);

  const userStoryRows = storyEpicRows.filter(row => row.typeBucket === 'user_story');
  const epicRows = storyEpicRows.filter(row => row.typeBucket !== 'user_story');
  const totalCount = userStoryRows.length + epicRows.length + taskRows.length;

  return {
    mode: options.mode,
    modeLabel: options.modeLabel,
    release,
    text: buildNadezhdaMessage(
      cfg.base,
      release,
      options.platformLabel,
      options.emoji,
      options.boardLabel,
      boardInfo.url,
      userStoryRows,
      epicRows,
      taskRows
    ),
    chips: [
      `Режим: ${options.modeLabel}`,
      `Релиз: ${release}`,
      `User Story: ${userStoryRows.length}`,
      `Epic: ${epicRows.length}`,
      `Tasks: ${taskRows.length}`,
      `Всего: ${totalCount}`,
    ],
    boardUrls: {
      current: boardInfo.url,
      ...(options.mode === 'nadezhda' ? { ios: boardInfo.url } : { android: boardInfo.url }),
    },
    details: {
      userStoryRows,
      epicRows,
      taskRows,
    },
  };
}

export async function buildEpicUserStoryDigest(
  cfg: YtConfig,
  release: string,
  mode: EpicUserStoryMode
): Promise<EpicUserStoryDigestResult> {
  const normalizedRelease = String(release || '').trim();
  if (!normalizedRelease) {
    throw new Error('Укажи номер релиза.');
  }

  if (!String(cfg.token || '').trim()) {
    throw new Error('Заполни YouTrack Token в настройках.');
  }

  if (mode === 'nadezhda') {
    return buildNadezhdaLikeDigest(cfg, normalizedRelease, {
      mode: 'nadezhda',
      sprintField: IOS_SPRINT_FIELD,
      agileId: STORY_EPIC_AGILE_IDS.ios,
      boardLabel: 'IOS',
      platformLabel: 'iOS',
      emoji: ':apple_company:',
      modeLabel: 'Надежда(iOS)',
    });
  }

  if (mode === 'darya') {
    return buildNadezhdaLikeDigest(cfg, normalizedRelease, {
      mode: 'darya',
      sprintField: ANDROID_SPRINT_FIELD,
      agileId: STORY_EPIC_AGILE_IDS.android,
      boardLabel: 'Android',
      platformLabel: 'Android',
      emoji: ':android:',
      modeLabel: 'Надежда(Andr)',
    });
  }

  return buildElenaDigest(cfg, normalizedRelease);
}

function extractTypeValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return extractTypeValue(value[0]);
  if (typeof value === 'object') {
    const record = value as { name?: string; localizedName?: string; presentation?: string; value?: string };
    return String(record.name || record.localizedName || record.presentation || record.value || '').trim();
  }
  return '';
}

function extractIssueType(issue: DeployIssue | YtIssue): string {
  if ('customFields' in issue || 'fields' in issue) {
    const direct = readFieldName(issue as YtIssue, ['Type', 'Тип']);
    if (direct) return direct;
  }

  const candidates = [
    (issue as { type?: unknown }).type,
    (issue as { issueType?: unknown }).issueType,
    (issue as { typeName?: unknown }).typeName,
  ];

  for (const candidate of candidates) {
    const value = extractTypeValue(candidate);
    if (value) return value;
  }

  return '';
}

function extractIssueTags(issue: DeployIssue | YtIssue): string[] {
  return (Array.isArray(issue.tags) ? issue.tags : [])
    .map(tag => {
      if (typeof tag === 'string') return tag;
      return tag?.name || '';
    })
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function classifyDeployIssue(issue: DeployIssue) {
  const summary = normalizeName(issue.summary || issue.title || issue.name || '');
  const type = normalizeName(extractIssueType(issue));
  const tags = extractIssueTags(issue).map(normalizeName);

  return {
    isProduct: type.includes('аналит') || type.includes('analytics') || summary.includes('аналит'),
    isVlet: tags.some(tag => tag.includes('влет') || tag.includes('vlet')) || summary.includes('влет') || summary.includes('влёт') || summary.includes('vlet'),
    isCrash: tags.some(tag => tag.includes('краш') || tag.includes('crash')) || summary.includes('краш') || summary.includes('crash'),
    isBug: type.includes('bug') || type.includes('баг') || summary.includes('ошибк') || summary.includes('дефект') || summary.includes('bug'),
  };
}

function severityForChp(total: number): ChpRow['severity'] {
  if (total >= 18) return 'high';
  if (total >= 10) return 'medium';
  return 'low';
}

async function fetchDeployIssues(cfg: YtConfig, prefix: 'IOS' | 'ANDROID', release: string): Promise<DeployIssue[]> {
  const token = String(cfg.deployLabToken || '').trim();
  if (!token) return [];

  const url = DEPLOY_ISSUES_URL_TMPL
    .replace('{prefix}', prefix)
    .replace('{rel}', release);

  const data = await requestJson<unknown>(cfg, url, {
    headers: buildDeployHeaders(token),
  });

  if (Array.isArray(data)) return data as DeployIssue[];
  if (Array.isArray((data as { data?: unknown[] })?.data)) return (data as { data: DeployIssue[] }).data;
  if (Array.isArray((data as { content?: unknown[] })?.content)) return (data as { content: DeployIssue[] }).content;
  return [];
}

function createBiBody(platform: typeof BI_PLATFORM_ORDER[number], interval = BI_INTERVAL) {
  return {
    onlyCache: false,
    dashboardId: 0,
    metaOnly: false,
    widgetId: 0,
    withLimitation: false,
    dataSourceId: BI_DATASOURCE_ID,
    queryParams: [
      {
        id: 19683,
        key: 'interval',
        live: true,
        order: 0,
        position: 'atop',
        selectConfig: { cascadeColumns: [], columnAdditional: null, isCascade: false, isMultiselect: false, optionsArray: [] },
        serializationMethodId: 'unquoted',
        typeId: 'dateTimeRange',
        value: { start: interval },
      },
      {
        id: 34007,
        key: 'platform',
        live: false,
        order: 1,
        position: 'atop',
        selectConfig: { isMultiselect: true, optionsArray: ['iOS', 'Android'], optionsTypeId: 'manual' },
        serializationMethodId: 'singleQuoted',
        typeId: 'select',
        value: [{ label: platform, value: platform }],
      },
      {
        id: 37333,
        key: 'ru_fil',
        live: false,
        order: 2,
        position: 'atop',
        selectConfig: { isMultiselect: false, optionsArray: ['and 1=1'], optionsTypeId: 'manual' },
        serializationMethodId: 'unquoted',
        typeId: 'select',
        value: [{ label: 'and 1=1', value: 'and 1=1' }],
      },
      {
        id: 48021,
        key: 'Версии',
        live: false,
        order: 3,
        position: 'atop',
        selectConfig: { cascadeColumns: [], columnAdditional: null, isCascade: false, isMultiselect: false, optionsArray: [] },
        serializationMethodId: 'unquoted',
        typeId: 'string',
        value: "'All'",
      },
    ],
  };
}

function rowsToBiRecords(rows: unknown[]): Array<{ release: string; users: number; share: number | null }> {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    if (Array.isArray(row)) {
      const [release, users, share] = row;
      return {
        release: String(release || ''),
        users: Number(users || 0),
        share: share == null ? null : Number(share),
      };
    }

    const record = row as Record<string, unknown>;
    return {
      release: String(record.release || record.ver || record.version || ''),
      users: Number(record.users || record.value || record.count || 0),
      share: record.share == null ? null : Number(record.share),
    };
  }).filter(row => row.release);
}

function toDevicePlatform(platform: 'Android' | 'iOS'): 'android' | 'ios' {
  return platform === 'iOS' ? 'ios' : 'android';
}

function createDeviceBody(platform: 'Android' | 'iOS', interval: string) {
  return {
    dashboardId: 0,
    dataSourceId: BI_DEVICE_DS_ID,
    metaOnly: false,
    onlyCache: false,
    widgetId: 0,
    withLimitation: false,
    queryParams: [
      {
        id: 78811,
        key: 'Платформа',
        live: false,
        order: 0,
        position: 'atop',
        selectConfig: { isMultiselect: false, optionsArray: ['Android', 'iOS'], optionsTypeId: 'manual' },
        serializationMethodId: 'singleQuoted',
        typeId: 'select',
        value: [{ label: platform, value: platform }],
      },
      {
        id: 19966,
        key: 'interval',
        live: true,
        order: 1,
        position: 'atop',
        selectConfig: { cascadeColumns: [], columnAdditional: null, isCascade: false, isMultiselect: false, optionsArray: [] },
        serializationMethodId: 'unquoted',
        typeId: 'dateRange',
        value: { start: interval },
      },
    ],
  };
}

function createDeviceOsBody(platform: 'Android' | 'iOS', interval: string) {
  return {
    dashboardId: 0,
    dataSourceId: BI_DEVICE_OS_DS_ID,
    metaOnly: false,
    onlyCache: false,
    widgetId: 0,
    withLimitation: true,
    queryParams: [
      {
        id: 20208,
        key: 'interval',
        live: true,
        order: 0,
        position: 'atop',
        selectConfig: { cascadeColumns: [], columnAdditional: null, isCascade: false, isMultiselect: false, optionsArray: [] },
        serializationMethodId: 'unquoted',
        typeId: 'dateRange',
        value: { start: interval },
      },
      {
        id: 78834,
        key: 'Платформа',
        live: false,
        order: 1,
        position: 'atop',
        selectConfig: { isMultiselect: false, optionsArray: ['Android', 'iOS'], optionsTypeId: 'manual' },
        serializationMethodId: 'singleQuoted',
        typeId: 'select',
        value: [{ label: platform, value: platform }],
      },
    ],
  };
}

function rowsToDeviceRecords(rows: unknown[], platform: 'Android' | 'iOS'): BiDeviceRow[] {
  const normalizedPlatform = toDevicePlatform(platform);

  return (Array.isArray(rows) ? rows : []).map(row => {
    if (Array.isArray(row)) {
      const [manufacturer, model, users, total, share] = row;
      return {
        platform: normalizedPlatform,
        manufacturer: String(manufacturer || '').trim(),
        model: String(model || '').trim(),
        users: Number(users || 0),
        total: Number(total || 0),
        share: Number(share == null ? 0 : share),
      };
    }

    const record = row as Record<string, unknown>;
    return {
      platform: normalizedPlatform,
      manufacturer: String(record.manufacturer || record.vendor || ''),
      model: String(record.release || record.model || record.device || ''),
      users: Number(record.users || record.value || record.count || 0),
      total: Number(record.total || 0),
      share: Number(record.share == null ? 0 : record.share),
    };
  }).filter(row => row.model).sort((a, b) => b.users - a.users);
}

function rowsToDeviceOsRecords(rows: unknown[], platform: 'Android' | 'iOS'): BiDeviceOsRow[] {
  const normalizedPlatform = toDevicePlatform(platform);

  return (Array.isArray(rows) ? rows : []).map(row => {
    if (Array.isArray(row)) {
      const [os, users, total, share] = row;
      return {
        platform: normalizedPlatform,
        os: String(os || '').trim(),
        users: Number(users || 0),
        total: Number(total || 0),
        share: Number(share == null ? 0 : share),
      };
    }

    const record = row as Record<string, unknown>;
    return {
      platform: normalizedPlatform,
      os: String(record.os || record.version || record.release || ''),
      users: Number(record.users || record.value || record.count || 0),
      total: Number(record.total || 0),
      share: Number(record.share == null ? 0 : record.share),
    };
  }).filter(row => row.os).sort((a, b) => b.users - a.users);
}

async function fetchBiPlatform(cfg: YtConfig, platform: typeof BI_PLATFORM_ORDER[number], interval = BI_INTERVAL) {
  const rows = await runBiQuery(cfg, BI_DATASOURCE_ID, createBiBody(platform, interval));
  return rowsToBiRecords(rows);
}

export async function fetchBiUsersSnapshot(
  cfg: YtConfig,
  options?: { platforms?: Array<'iOS' | 'Android'>; interval?: string }
): Promise<BiUsersSnapshotPayload> {
  const platforms: Array<'iOS' | 'Android'> = options?.platforms?.length ? options.platforms : ['iOS', 'Android'];
  const interval = String(options?.interval || BI_INTERVAL).trim() || BI_INTERVAL;

  const records = (await Promise.all(platforms.map(async platform => {
    const rows = await fetchBiPlatform(cfg, platform, interval);
    return rows.map(row => ({
      platform,
      release: row.release,
      users: Number(row.users || 0),
      share: row.share == null ? null : Number(row.share),
    } satisfies BiUserRecord));
  }))).flat();

  return {
    records,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchBiDevices(
  cfg: YtConfig,
  options?: { platforms?: Array<'Android' | 'iOS'>; interval?: string }
): Promise<BiDevicesPayload> {
  const platforms: Array<'Android' | 'iOS'> = options?.platforms?.length ? options.platforms : ['Android', 'iOS'];
  const interval = String(options?.interval || 'last_2_days').trim() || 'last_2_days';

  const pairs = await Promise.all(platforms.map(async platform => {
    const [deviceRows, osRows] = await Promise.all([
      runBiQuery(cfg, BI_DEVICE_DS_ID, createDeviceBody(platform, interval)),
      runBiQuery(cfg, BI_DEVICE_OS_DS_ID, createDeviceOsBody(platform, interval)),
    ]);

    return {
      rows: rowsToDeviceRecords(deviceRows, platform),
      osRows: rowsToDeviceOsRecords(osRows, platform),
    };
  }));

  const rows = pairs.flatMap(pair => pair.rows);
  const osRows = pairs.flatMap(pair => pair.osRows);
  const totals: Record<'android' | 'ios', number> = { android: 0, ios: 0 };

  rows.forEach(row => {
    const current = totals[row.platform];
    totals[row.platform] = Math.max(current, Number(row.total || 0));
  });

  osRows.forEach(row => {
    const current = totals[row.platform];
    totals[row.platform] = Math.max(current, Number(row.total || 0));
  });

  if (!totals.android) {
    totals.android = osRows
      .filter(row => row.platform === 'android')
      .reduce((sum, row) => sum + Number(row.users || 0), 0)
      || rows.filter(row => row.platform === 'android').reduce((sum, row) => sum + Number(row.users || 0), 0);
  }

  if (!totals.ios) {
    totals.ios = osRows
      .filter(row => row.platform === 'ios')
      .reduce((sum, row) => sum + Number(row.users || 0), 0)
      || rows.filter(row => row.platform === 'ios').reduce((sum, row) => sum + Number(row.users || 0), 0);
  }

  return {
    rows,
    osRows,
    totals,
    fetchedAt: new Date().toISOString(),
  };
}

/* Получить задачи по версии (для копирования) */
export async function fetchIssuesByVersion(
  cfg: YtConfig,
  version: string,
  tags?: string[]
): Promise<YtIssue[]> {
  const query = `Fix versions: {${version}}${tags?.length ? ` tag: ${tags.join(', ')}` : ''}`;
  const data = await ytFetch<YtIssue[]>(cfg, '/api/issues', {
    fields: 'id,idReadable,summary,tags(name),customFields(name,value(name,localizedName,presentation,text,markdownText))',
    query,
    $top: '500',
  });

  return (Array.isArray(data) ? data : []).map(normalizeIssue);
}

/* Скопировать задачи из одной версии в другую */
export async function copyIssuesToVersion(
  cfg: YtConfig,
  issueIds: string[],
  targetVersion: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ copied: string[]; skipped: string[]; errors: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < issueIds.length; i += 1) {
    const id = issueIds[i];
    try {
      await ytFetch(
        cfg,
        `/api/issues/${encodeURIComponent(id)}`,
        undefined,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customFields: [{ name: 'Fix versions', value: [{ name: targetVersion }] }],
          }),
        }
      );
      copied.push(id);
    } catch (error) {
      if (String((error as Error)?.message || '').includes('already')) skipped.push(id);
      else errors.push(id);
    }
    onProgress?.(i + 1, issueIds.length);
  }

  return { copied, skipped, errors };
}

/* Получить метрики релизов для Charts */
export async function fetchReleaseMetrics(cfg: YtConfig, releases: string[]): Promise<ReleaseMetrics[]> {
  if (!releases.length) return [];

  const metrics = await Promise.all(releases.map(async release => {
    const hasAllure = Boolean(cfg.allureBase && cfg.allureToken && cfg.projectId);
    const launches = hasAllure
      ? (await fetchLaunches(
          {
            base: String(cfg.allureBase),
            token: String(cfg.allureToken),
            projectId: String(cfg.projectId),
            signal: cfg.signal,
            proxyBase: cfg.proxyBase,
            proxyMode: cfg.proxyMode,
            useProxy: cfg.useProxy,
          },
          release
        )).map(mapLaunch)
      : [];

    const readiness = aggregateReadiness(launches);
    const tcTotal = launches.reduce((sum, launch) => sum + launch.total, 0);
    const automatedCounts = hasAllure
      ? await Promise.all(launches.map(launch => fetchAutomatedTotalCases({
          base: String(cfg.allureBase),
          token: String(cfg.allureToken),
          projectId: String(cfg.projectId),
          signal: cfg.signal,
          proxyBase: cfg.proxyBase,
          proxyMode: cfg.proxyMode,
          useProxy: cfg.useProxy,
        }, launch.id).catch(() => 0)))
      : [];
    const tcAuto = automatedCounts.reduce((sum, value) => sum + Number(value || 0), 0);
    const chp = await fetchChpByRelease(cfg, release).catch(() => ({
      version: release,
      total: 0,
      prod: 0,
      bug: 0,
      crash: 0,
      vlet: 0,
      delta: 0,
      severity: 'low' as const,
    }));

    const covSwat = Math.round((readiness.android.critical + readiness.ios.critical) / 2);
    const covStream = Math.round((readiness.android.smoke + readiness.ios.smoke) / 2);
    const selSwat = Math.round((readiness.android.regression + readiness.ios.regression) / 2);
    const selStream = Math.round((covStream + selSwat) / 2);

    return {
      release,
      tc_total: tcTotal,
      tc_manual: Math.max(0, tcTotal - tcAuto),
      tc_auto: Math.max(0, tcAuto),
      tc_total_delta: 0,
      cov_swat: covSwat,
      cov_stream: covStream,
      sel_swat: selSwat,
      sel_stream: selStream,
      avg_total_delta: 0,
      chp_total: chp.total,
      chp_prod: chp.prod,
      chp_bug: chp.bug,
      chp_crash: chp.crash,
      chp_vlet: chp.vlet,
      chp_total_delta: 0,
      anom_score: 0,
      release_anoms: 0,
      type_anoms: 0,
      platform_anoms: 0,
    };
  }));

  return metrics.map((metric, index, rows) => {
    const prev = index > 0 ? rows[index - 1] : null;
    const tcDelta = prev ? metric.tc_total - prev.tc_total : 0;
    const chpDelta = prev ? metric.chp_total - prev.chp_total : 0;
    const releaseAnoms = Math.abs(tcDelta) >= 300 || Math.abs(chpDelta) >= 4 ? 1 : 0;
    const typeAnoms = [metric.chp_prod, metric.chp_bug, metric.chp_crash, metric.chp_vlet].filter(value => value >= 3).length;
    const platformAnoms = [metric.cov_swat, metric.cov_stream, metric.sel_swat, metric.sel_stream].filter(value => value < 70).length;
    const anomBase = Number((
      (releaseAnoms * 0.2)
      + (typeAnoms * 0.05)
      + (platformAnoms * 0.04)
      + (Math.max(0, metric.chp_total - 2) * 0.015)
    ).toFixed(2));
    const anomScore = Number(Math.min(0.99, anomBase).toFixed(2));

    return {
      ...metric,
      tc_total_delta: tcDelta,
      avg_total_delta: prev ? Number((tcDelta / Math.max(1, prev.tc_total) * 100).toFixed(1)) : 0,
      chp_total_delta: chpDelta,
      release_anoms: releaseAnoms,
      type_anoms: typeAnoms,
      platform_anoms: platformAnoms,
      anom_score: anomScore,
    };
  });
}

/* Получить данные BI-пользователей */
export async function fetchBiUsers(cfg: YtConfig, releases: string[], interval = BI_INTERVAL): Promise<BiVersionRow[]> {
  const [iosRows, androidRows] = await Promise.all([
    fetchBiPlatform(cfg, 'iOS', interval),
    fetchBiPlatform(cfg, 'Android', interval),
  ]);

  const iosMap = new Map(iosRows.map(row => [row.release, row]));
  const androidMap = new Map(androidRows.map(row => [row.release, row]));

  return releases.map((release, index) => {
    const ios = iosMap.get(release);
    const android = androidMap.get(release);
    const prevRelease = index > 0 ? releases[index - 1] : '';
    const prevIos = iosMap.get(prevRelease);
    const prevAndroid = androidMap.get(prevRelease);

    return {
      version: release,
      iosUsers: Number(ios?.users || 0),
      androidUsers: Number(android?.users || 0),
      iosPct: Number((ios?.share == null ? 0 : ios.share).toFixed(2)),
      androidPct: Number((android?.share == null ? 0 : android.share).toFixed(2)),
      iosDelta: prevIos ? Number((((Number(ios?.users || 0) - Number(prevIos.users || 0)) / Math.max(1, Number(prevIos.users || 0))) * 100).toFixed(1)) : 0,
      androidDelta: prevAndroid ? Number((((Number(android?.users || 0) - Number(prevAndroid.users || 0)) / Math.max(1, Number(prevAndroid.users || 0))) * 100).toFixed(1)) : 0,
    };
  });
}

/* ЧП по релизу */
export async function fetchChpByRelease(
  cfg: YtConfig,
  release: string,
  platform: 'all' | 'android' | 'ios' = 'all'
): Promise<ChpRow> {
  const prefixes: Array<'IOS' | 'ANDROID'> = platform === 'ios'
    ? ['IOS']
    : platform === 'android'
      ? ['ANDROID']
      : ['IOS', 'ANDROID'];

  const deployIssues = (await Promise.all(prefixes.map(prefix => fetchDeployIssues(cfg, prefix, release))))
    .flat()
    .filter(issue => issue?.merged_after_cutoff === true);

  if (deployIssues.length) {
    const counts = deployIssues.reduce((acc, issue) => {
      const flags = classifyDeployIssue(issue);
      if (flags.isProduct) acc.prod += 1;
      if (flags.isVlet) acc.vlet += 1;
      if (flags.isCrash) acc.crash += 1;
      if (flags.isBug) acc.bug += 1;
      return acc;
    }, { prod: 0, bug: 0, crash: 0, vlet: 0 });

    const total = deployIssues.length;
    return {
      version: release,
      total,
      prod: counts.prod,
      bug: counts.bug,
      crash: counts.crash,
      vlet: counts.vlet,
      delta: 0,
      severity: severityForChp(total),
    };
  }

  const issues = await fetchIssuesByVersion(cfg, release);
  const counts = issues.reduce((acc, issue) => {
    const summary = normalizeName(issue.summary || '');
    const type = normalizeName(readFieldName(issue, ['Type', 'Тип']));
    const tags = extractIssueTags(issue).map(normalizeName);

    if (type.includes('аналит') || type.includes('analytics') || summary.includes('аналит')) acc.prod += 1;
    if (type.includes('bug') || type.includes('баг') || summary.includes('ошибк') || summary.includes('дефект')) acc.bug += 1;
    if (tags.some(tag => tag.includes('краш') || tag.includes('crash')) || summary.includes('краш') || summary.includes('crash')) acc.crash += 1;
    if (tags.some(tag => tag.includes('влет') || tag.includes('vlet')) || summary.includes('влет') || summary.includes('влёт') || summary.includes('vlet')) acc.vlet += 1;

    return acc;
  }, { prod: 0, bug: 0, crash: 0, vlet: 0 });

  const total = issues.length;
  return {
    version: release,
    total,
    prod: counts.prod,
    bug: counts.bug,
    crash: counts.crash,
    vlet: counts.vlet,
    delta: 0,
    severity: severityForChp(total),
  };
}
