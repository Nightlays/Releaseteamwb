import { proxyFetch } from './proxy';
import type { AppSettings } from '../types';

export type RolloutPlatformId = 'android' | 'ios';
export type RolloutLogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface RolloutPlatformConfig {
  id: RolloutPlatformId;
  label: string;
  channelId: string;
  channelUrl: string;
  heroTitle: string;
  heroDescription: string;
  heroFacts: Array<{ label: string; value: string }>;
  sourceSubtitle: string;
  channelMeta: string;
  openLinkLabel: string;
  resultsTitle: string;
  resultsSubtitle: string;
  rulesTitle: string;
  rulesIntro: string;
  rules: string[];
}

interface BandPost {
  id?: unknown;
  root_id?: unknown;
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

export interface RolloutStoreEvent {
  id: string;
  createdAt: number;
  text: string;
  store: 'google_play' | 'ru_store' | 'app_gallery' | 'app_store';
  storeLabel: string;
  version: string;
  family: string;
  percent: number | null;
  stageText: string;
  finalCompleted: boolean;
  stageLabel: string;
}

export interface AndroidRolloutGroup {
  platform: 'android';
  family: string;
  googleOnePercent: RolloutStoreEvent | null;
  googleHundredPercent: RolloutStoreEvent | null;
  ruStoreLatest: RolloutStoreEvent | null;
  appGalleryLatest: RolloutStoreEvent | null;
  events: RolloutStoreEvent[];
}

export interface IosRolloutGroup {
  platform: 'ios';
  family: string;
  appStoreFirstRollout: RolloutStoreEvent | null;
  appStoreFinal: RolloutStoreEvent | null;
  events: RolloutStoreEvent[];
}

export type RolloutGroup = AndroidRolloutGroup | IosRolloutGroup;

export interface RolloutReportSummary {
  releases: number;
  events: number;
  start: number;
  final: number;
  extraA: number;
  extraB: number;
}

export interface RolloutReportResult {
  allGroups: RolloutGroup[];
  groups: RolloutGroup[];
  events: RolloutStoreEvent[];
  summary: RolloutReportSummary;
  postsCount: number;
}

export interface RolloutReportConfig {
  settings: AppSettings;
  platform: RolloutPlatformId;
  lookbackDays: number;
  releaseFrom?: string;
  releaseTo?: string;
  signal?: AbortSignal;
  onLog?: (message: string, level?: RolloutLogLevel) => void;
}

export interface RolloutExportDataset {
  rows: Array<Record<string, string | number>>;
  columns: string[];
  values: string[][];
  filename: string;
}

export const ROLLOUT_DEFAULT_LOOKBACK_DAYS = 180;
export const ROLLOUT_DISK_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby3HoKkxtLw6Dtw9EWG8cic0EjX4cfH0xQgPoBKwXVNSm5WVFYUpPWcEHO6EC4kptdgjw/exec';
export const ROLLOUT_DISK_SPREADSHEET_ID = '1to6NsQ4bj7l266OobbK0yDH_ha0A1HFs-wsrr1pbvEQ';
export const ROLLOUT_DISK_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${ROLLOUT_DISK_SPREADSHEET_ID}/edit`;
export const ROLLOUT_DISK_SHEET_NAMES: Record<RolloutPlatformId, string> = {
  android: 'Android 2026',
  ios: 'iOS 2026',
};

const PROXY_COOKIE_HEADER = 'X-Proxy-Cookie';
const MSK_TIMEZONE = 'Europe/Moscow';
const PAGE_SIZE = 30;
const PAGE_LIMIT = 400;

export const ROLLOUT_PLATFORM_CONFIG: Record<RolloutPlatformId, RolloutPlatformConfig> = {
  android: {
    id: 'android',
    label: 'Android',
    channelId: 'mccs6h69jtdhu8uzeeg3nz1wxa',
    channelUrl: 'https://band.wb.ru/mobile-team/channels/android-announcement',
    heroTitle: 'Android rollout report',
    heroDescription: 'Отчёт по Android announcement: показывает старт процента раскатки и финал раскатки в Google Play, а также последние найденные версии в RuStore и AppGallery.',
    heroFacts: [
      { label: 'Канал', value: 'Android announcement' },
      { label: 'Старт', value: 'Первое процентное сообщение: 1%, 5%, 10% и т.д.' },
      { label: 'Финал', value: 'Последнее сообщение процента раскатки на 100%, включая hotfix 0001 / 0002' },
      { label: 'Доп. stores', value: 'Последние версии RuStore и AppGallery' },
    ],
    sourceSubtitle: 'Использует Band cookies и proxy из общих настроек платформы. В отчёте остаются только фильтры релизов.',
    channelMeta: 'Канал Android announcement — публикации о раскатке в Google Play, RuStore и AppGallery.',
    openLinkLabel: 'Открыть Android канал',
    resultsTitle: 'Android релизы и магазины',
    resultsSubtitle: 'Табличный отчёт по release-family: старт процента раскатки, финал раскатки и отдельные колонки для RuStore и AppGallery.',
    rulesTitle: 'Как считается Android отчёт',
    rulesIntro: 'Группировка строится по base-release: версия вида 7.5.6002 попадает в семейство 7.5.6000. Это позволяет видеть, какой hotfix довёл релиз до 100% и какие версии ушли в другие stores.',
    rules: [
      'В поле ПР старт берётся первое найденное процентное сообщение для семейства релиза. Если 1% отсутствует, используется следующее доступное значение, например 5%.',
      'В поле ПР 100% берётся последнее найденное сообщение на 100% и показывается фактическая версия, например 7.5.6002.',
      'Для RuStore и AppGallery показывается последнее найденное сообщение по семейству и его фактическая версия.',
      'Сообщения без версии или без store-маркера не участвуют.',
      'Диапазон релизов работает inclusively: можно задать 7.5 -> 7.6 или точные версии.',
    ],
  },
  ios: {
    id: 'ios',
    label: 'iOS',
    channelId: 'kg4eed6pdpy1pfhhitjtmqqhpe',
    channelUrl: 'https://band.wb.ru/wb/channels/mp-ios-releases',
    heroTitle: 'iOS rollout report',
    heroDescription: 'Отчёт по каналу iOS releases: показывает первое процентное событие в AppStore и финальную версию, которой раскатка была завершена.',
    heroFacts: [
      { label: 'Канал', value: 'mp-ios-releases' },
      { label: 'Старт', value: 'Первое процентное сообщение: 1%, 2%, 5%, 10% и т.д.' },
      { label: 'Финал', value: 'Сообщение "Раскатка в AppStore завершена" или "Успех"' },
      { label: 'Семейство', value: 'Hotfix привязывается к base-release как в Android' },
    ],
    sourceSubtitle: 'Использует Band cookies и proxy из общих настроек платформы. В отчёте остаются только фильтры релизов.',
    channelMeta: 'Канал mp-ios-releases — публикации о раскатке в AppStore.',
    openLinkLabel: 'Открыть iOS канал',
    resultsTitle: 'iOS релизы',
    resultsSubtitle: 'Табличный отчёт по release-family: старт раскатки в AppStore, финальная версия и все matched-сообщения.',
    rulesTitle: 'Как считается iOS отчёт',
    rulesIntro: 'Группировка строится по base-release так же, как в Android. Версия вида 7.5.6002 попадает в семейство 7.5.6000, чтобы можно было увидеть фактический hotfix, которым завершили раскатку.',
    rules: [
      'В поле AS старт берётся первое найденное процентное сообщение для семейства релиза, даже если это 2%, 5% или 10%.',
      'В поле AS финал берётся последнее сообщение, где раскатка в AppStore завершена, либо последнее 100%-сообщение, если оно есть.',
      'Финальной считается версия из сообщения вида "Раскатка в AppStore завершена".',
      'Сообщения без версии или без AppStore не участвуют.',
      'Диапазон релизов работает inclusively: можно задать 7.5 -> 7.6 или точные версии.',
    ],
  },
};

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeRolloutText(value: unknown) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unwrapBandPostsPayload(raw: unknown): Record<string, unknown> {
  let node = raw as unknown;
  for (let i = 0; i < 5; i += 1) {
    if (node && typeof node === 'object' && 'posts' in node && typeof (node as { posts?: unknown }).posts === 'object') {
      return node as Record<string, unknown>;
    }
    if (node && typeof node === 'object' && 'body' in node) {
      const body = (node as { body?: unknown }).body;
      if (typeof body === 'string') {
        const parsed = safeJson(body);
        if (parsed && typeof parsed === 'object') {
          node = parsed;
          continue;
        }
      } else if (body && typeof body === 'object') {
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

function collectBandPosts(payload: Record<string, unknown>) {
  const postsMap = payload.posts && typeof payload.posts === 'object' ? payload.posts as Record<string, BandPost> : {};
  const order = Array.isArray(payload.order) ? payload.order.map(String) : Object.keys(postsMap);
  const seen = new Set<string>();
  const posts: BandPost[] = [];
  for (const id of order) {
    const post = postsMap[id];
    if (post && typeof post === 'object') {
      posts.push(post);
      seen.add(String(id));
    }
  }
  for (const [id, post] of Object.entries(postsMap)) {
    if (seen.has(String(id))) continue;
    if (post && typeof post === 'object') posts.push(post);
  }
  return posts;
}

function buildBandHeaders(cookies: string) {
  const value = String(cookies || '').trim();
  if (!value) throw new Error('Вставь Band cookies (чтение).');
  return {
    Accept: 'application/json',
    'Accept-Language': 'ru',
    'X-Requested-With': 'XMLHttpRequest',
    [PROXY_COOKIE_HEADER]: value,
  };
}

async function proxyRequestJson(
  settings: AppSettings,
  targetUrl: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  const base = String(settings.proxyBase || '').trim();
  if (!base) throw new Error('Укажи proxy base.');
  const response = await proxyFetch(
    { base, mode: settings.proxyMode, signal },
    targetUrl,
    init,
  );
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const parsed = safeJson(raw);
    const detail = parsed && typeof parsed === 'object'
      ? [parsed.message, parsed.error, parsed.details].filter(Boolean).join(' | ')
      : String(raw || '').trim();
    throw new Error(detail ? `Proxy HTTP ${response.status}: ${detail}` : `Proxy HTTP ${response.status}`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return safeJson(text) || { raw: text };
}

export async function checkRolloutProxy(settings: AppSettings) {
  const base = String(settings.proxyBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Укажи proxy base.');
  const response = await fetch(`${base}/health`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(`Proxy health error (${response.status})`);
  }
  return payload as { ok: boolean; host?: string; port?: number | string };
}

async function fetchBandChannelPostsSince(cfg: RolloutReportConfig, sinceMs: number) {
  const platform = ROLLOUT_PLATFORM_CONFIG[cfg.platform];
  const headers = buildBandHeaders(cfg.settings.bandCookies);
  const postsById = new Map<string, BandPost>();
  let beforeId = '';

  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    if (cfg.signal?.aborted) break;

    const url = new URL(`https://band.wb.ru/api/v4/channels/${encodeURIComponent(platform.channelId)}/posts`);
    url.searchParams.set('page', '0');
    url.searchParams.set('per_page', String(PAGE_SIZE));
    if (beforeId) url.searchParams.set('before', beforeId);
    url.searchParams.set('skipFetchThreads', 'false');
    url.searchParams.set('collapsedThreads', 'true');
    url.searchParams.set('collapsedThreadsExtended', 'false');

    const payload = unwrapBandPostsPayload(await proxyRequestJson(cfg.settings, url.toString(), { method: 'GET', headers }, cfg.signal));
    const batch = collectBandPosts(payload);
    for (const post of batch) {
      const id = String(post.id || '').trim();
      if (id && !postsById.has(id)) postsById.set(id, post);
    }

    batch.sort((a, b) => (Number(b.create_at) || 0) - (Number(a.create_at) || 0));
    const oldest = batch[batch.length - 1] || null;
    const oldestId = String(oldest?.id || '').trim();
    const oldestCreateAt = Number(oldest?.create_at || 0);
    cfg.onLog?.(`Band page ${page + 1}: +${batch.length} постов, oldest=${oldestId || 'n/a'}`);

    if (!oldestId || oldestId === beforeId) break;
    beforeId = oldestId;
    if (batch.length < PAGE_SIZE) break;
    if (Number.isFinite(sinceMs) && Number.isFinite(oldestCreateAt) && oldestCreateAt < sinceMs) break;
  }

  return Array.from(postsById.values())
    .filter(post => {
      const deletedAt = Number(post.delete_at);
      if (Number.isFinite(deletedAt) && deletedAt > 0) return false;
      if (String(post.root_id || '').trim()) return false;
      const createdAt = Number(post.create_at);
      if (Number.isFinite(sinceMs) && Number.isFinite(createdAt) && createdAt < sinceMs) return false;
      return Number.isFinite(createdAt) && createdAt > 0;
    })
    .sort((a, b) => (Number(a.create_at) || 0) - (Number(b.create_at) || 0));
}

export function extractBandPostText(post: BandPost) {
  const chunks: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeRolloutText(
      String(value || '')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 $2')
        .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1'),
    );
    if (text) chunks.push(text);
  };

  push(post.message || '');

  const attachments = Array.isArray(post.props?.attachments) ? post.props.attachments : [];
  for (const attachment of attachments) {
    push(attachment.pretext);
    push(attachment.title);
    push(attachment.text);
    push(attachment.fallback);
    const fields = Array.isArray(attachment.fields) ? attachment.fields : [];
    for (const field of fields) {
      const title = normalizeRolloutText(field.title || '');
      const value = normalizeRolloutText(field.value || '');
      if (title && value) push(`${title}: ${value}`);
      else {
        push(title);
        push(value);
      }
    }
  }

  return normalizeRolloutText(chunks.join('\n'));
}

interface ParsedRelease {
  major: number;
  minor: number;
  build: number;
}

function parseReleaseVersion(raw: unknown): ParsedRelease | null {
  const match = String(raw || '').trim().match(/^(\d+)\.(\d+)\.(\d{1,4})$/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const build = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(build)) return null;
  return { major, minor, build };
}

export function buildReleaseFamily(version: string) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return String(version || '').trim();
  const familyBuild = Math.floor(parsed.build / 10) * 10;
  return `${parsed.major}.${parsed.minor}.${String(familyBuild).padStart(4, '0')}`;
}

export function compareRolloutVersions(a: string, b: string) {
  const pa = parseReleaseVersion(a);
  const pb = parseReleaseVersion(b);
  if (!pa || !pb) return String(a || '').localeCompare(String(b || ''), 'ru');
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.build - pb.build;
}

export function compareRolloutVersionsDesc(a: string, b: string) {
  return compareRolloutVersions(b, a);
}

function parseRangeBoundary(value: string, edge: 'from' | 'to') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const fullMatch = raw.match(/^(\d+)\.(\d+)\.(\d{1,4})$/);
  if (fullMatch) {
    const major = Number(fullMatch[1]);
    const minor = Number(fullMatch[2]);
    const buildRaw = String(fullMatch[3] || '');
    if (buildRaw.length < 4) {
      if (edge === 'from') {
        // Use the release family as lower bound so short builds like "7.5.4" (family "7.5.0000")
        // are not pushed to "7.5.4000" which would exclude all smaller-build releases (e.g., iOS).
        const build = Number(buildRaw);
        const familyBuild = Math.floor(build / 10) * 10;
        return `${major}.${minor}.${String(familyBuild).padStart(4, '0')}`;
      }
      return `${major}.${minor}.${buildRaw.padEnd(4, '0')}`;
    }
    return buildReleaseFamily(raw);
  }

  const short = raw.match(/^(\d+)\.(\d+)$/);
  if (short) {
    const major = Number(short[1]);
    const minor = Number(short[2]);
    return `${major}.${minor}.${edge === 'to' ? '9999' : '0000'}`;
  }

  return null;
}

export function filterRolloutGroupsByRange(groups: RolloutGroup[], fromRaw = '', toRaw = '') {
  const from = parseRangeBoundary(fromRaw, 'from');
  const to = parseRangeBoundary(toRaw, 'to');

  if (fromRaw && from === null) throw new Error('Поле "С релиза" должно быть в формате 7.5 или 7.5.6000');
  if (toRaw && to === null) throw new Error('Поле "По релиз" должно быть в формате 7.5 или 7.5.6000');

  let lower = from || '';
  let upper = to || '';
  if (lower && upper && compareRolloutVersions(lower, upper) > 0) {
    const tmp = lower;
    lower = upper;
    upper = tmp;
  }

  if (!lower && !upper) return groups;
  return groups.filter(group => {
    const family = String(group.family || '').trim();
    if (lower && compareRolloutVersions(family, lower) < 0) return false;
    if (upper && compareRolloutVersions(family, upper) > 0) return false;
    return true;
  });
}

function inferStageLabel(text: string) {
  const source = String(text || '').toLowerCase();
  if (source.includes('раскат')) return 'раскатка';
  if (source.includes('модерац')) return 'модерация';
  if (source.includes('публик')) return 'публикация';
  if (source.includes('отправ')) return 'отправка';
  if (source.includes('review')) return 'review';
  return 'этап не определён';
}

function detectAndroidStore(text: string): RolloutStoreEvent['store'] | '' {
  const source = String(text || '').toLowerCase();
  if (/google play|play market|gplay/.test(source)) return 'google_play';
  if (/rustore/.test(source)) return 'ru_store';
  if (/appgallery|app gallery|huawei appgallery|huawei gallery/.test(source)) return 'app_gallery';
  return '';
}

function isIosAppStoreMessage(text: string) {
  return /app\s*store|appstore/i.test(String(text || '').toLowerCase());
}

function isIosFinalRollout(text: string) {
  const source = String(text || '');
  return /раскатка\s+в\s+app\s*store\s+завершен[ао]/i.test(source)
    || /в\s+app\s*store\s+завершен[ао]/i.test(source)
    || /завершение\s+раскатки\s+в\s+app\s*store\s*\((успех|success)/i.test(source)
    || /завершение\s+раскатки\s+в\s+app\s*store[\s\S]*?✅/i.test(source);
}

function extractReleaseVersion(text: string, platformId: RolloutPlatformId) {
  const source = String(text || '');
  const directMatch = source.match(/версия\s+(\d+\.\d+\.\d{1,4})/i);
  if (directMatch) return String(directMatch[1] || '').trim();

  if (platformId === 'ios') {
    const iosTagged = [...source.matchAll(/\b(\d+\.\d+\.\d{1,4})\b\s+ios\b/ig)];
    if (iosTagged.length) return String(iosTagged[iosTagged.length - 1][1] || '').trim();
  }

  const generic = [...source.matchAll(/\b(\d+\.\d+\.\d{1,4})\b/g)];
  return generic.length ? String(generic[generic.length - 1][1] || '').trim() : '';
}

function deriveStageText(text: string, version: string, percent: number | null, platformId: RolloutPlatformId, finalCompleted: boolean) {
  const source = normalizeRolloutText(text);
  if (platformId === 'ios') {
    if (finalCompleted) return 'Раскатка в AppStore завершена';
    if (percent !== null && /опубликован[аоы]?\s+в\s+app\s*store/i.test(source)) return 'опубликована';
    if (/завершение\s+раскатки/i.test(source)) return 'завершение раскатки';
  }

  let stageText = '';
  if (percent !== null) {
    const stageMatch = source.match(new RegExp(`версия\\s+${version.replace(/\./g, '\\.')}\\s+([\\s\\S]*?)\\s+${percent}\\s*%`, 'i'));
    stageText = normalizeRolloutText(stageMatch?.[1] || '');
  }
  if (!stageText) {
    const anchorPattern = platformId === 'ios'
      ? new RegExp(`${version.replace(/\./g, '\\.')}\\s+ios`, 'i')
      : new RegExp(`версия\\s+${version.replace(/\./g, '\\.')}`, 'i');
    const split = source.split(anchorPattern);
    const afterVersion = split[1] || '';
    stageText = normalizeRolloutText(afterVersion.replace(/\s+/g, ' ').slice(0, 160));
  }

  return stageText
    .replace(/\s+на$/i, '')
    .replace(/\s+пользовател[ея][йь]?\.?$/i, '')
    .replace(/\s+в\s+app\s*store$/i, '')
    .replace(/\s+в\s+(google play|rustore|appgallery)$/i, '')
    .replace(/\s+для\s+app\s*store$/i, '')
    .replace(/\s+для\s+(google play|rustore|appgallery)$/i, '')
    .trim();
}

export function getRolloutStoreLabel(store: string) {
  if (store === 'google_play') return 'Google Play';
  if (store === 'ru_store') return 'RuStore';
  if (store === 'app_gallery') return 'AppGallery';
  if (store === 'app_store') return 'AppStore';
  return 'Unknown';
}

export function parseRolloutStoreEvent(post: BandPost, platformId: RolloutPlatformId): RolloutStoreEvent | null {
  const text = extractBandPostText(post);
  if (!text) return null;
  if (/снят[ао] с раскатки/i.test(text)) return null;

  const store = platformId === 'ios'
    ? (isIosAppStoreMessage(text) ? 'app_store' : '')
    : detectAndroidStore(text);
  if (!store) return null;

  const version = extractReleaseVersion(text, platformId);
  const percentMatches = [...text.matchAll(/(\d{1,3})\s*%/g)];
  if (!version) return null;
  const percent = percentMatches.length ? Number(percentMatches[percentMatches.length - 1][1]) : null;
  if (percent !== null && !Number.isFinite(percent)) return null;
  const finalCompleted = platformId === 'ios' && isIosFinalRollout(text);
  const createdAt = Number(post.create_at || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  const stageText = deriveStageText(text, version, percent, platformId, finalCompleted);
  return {
    id: String(post.id || '').trim(),
    createdAt,
    text,
    store,
    storeLabel: getRolloutStoreLabel(store),
    version,
    family: buildReleaseFamily(version),
    percent,
    stageText,
    finalCompleted,
    stageLabel: finalCompleted ? 'раскатка завершена' : inferStageLabel(stageText),
  };
}

export function groupRolloutEvents(events: RolloutStoreEvent[], platformId: RolloutPlatformId): RolloutGroup[] {
  const map = new Map<string, RolloutGroup>();
  for (const event of events) {
    if (!map.has(event.family)) {
      map.set(event.family, platformId === 'ios'
        ? {
            platform: 'ios',
            family: event.family,
            appStoreFirstRollout: null,
            appStoreFinal: null,
            events: [],
          }
        : {
            platform: 'android',
            family: event.family,
            googleOnePercent: null,
            googleHundredPercent: null,
            ruStoreLatest: null,
            appGalleryLatest: null,
            events: [],
          });
    }
    const group = map.get(event.family);
    if (!group) continue;
    group.events.push(event);

    if (group.platform === 'ios') {
      if (event.store === 'app_store' && event.percent !== null && !group.appStoreFirstRollout) group.appStoreFirstRollout = event;
      if (event.store === 'app_store' && (event.finalCompleted || event.percent === 100)) group.appStoreFinal = event;
    } else {
      if (event.store === 'google_play' && event.percent !== null && !group.googleOnePercent) group.googleOnePercent = event;
      if (event.store === 'google_play' && event.percent === 100) group.googleHundredPercent = event;
      if (event.store === 'ru_store') group.ruStoreLatest = event;
      if (event.store === 'app_gallery') group.appGalleryLatest = event;
    }
  }

  return Array.from(map.values())
    .map(group => {
      group.events.sort((a, b) => a.createdAt - b.createdAt);
      if (group.platform === 'ios') {
        if (!group.appStoreFirstRollout) {
          group.appStoreFirstRollout = group.events.find(event => event.store === 'app_store' && event.percent !== null) || null;
        }
        const finalEvents = group.events.filter(event => event.store === 'app_store' && (event.finalCompleted || event.percent === 100));
        group.appStoreFinal = finalEvents.length ? finalEvents[finalEvents.length - 1] : null;
      } else {
        if (!group.googleOnePercent) {
          group.googleOnePercent = group.events.find(event => event.store === 'google_play' && event.percent !== null) || null;
        }
        const allGoogleHundred = group.events.filter(event => event.store === 'google_play' && event.percent === 100);
        group.googleHundredPercent = allGoogleHundred.length ? allGoogleHundred[allGoogleHundred.length - 1] : null;
        const ruStoreEvents = group.events.filter(event => event.store === 'ru_store');
        group.ruStoreLatest = ruStoreEvents.length ? ruStoreEvents[ruStoreEvents.length - 1] : null;
        const appGalleryEvents = group.events.filter(event => event.store === 'app_gallery');
        group.appGalleryLatest = appGalleryEvents.length ? appGalleryEvents[appGalleryEvents.length - 1] : null;
      }
      return group;
    })
    .sort((a, b) => compareRolloutVersionsDesc(a.family, b.family));
}

export function buildRolloutSummary(groups: RolloutGroup[], events: RolloutStoreEvent[], platformId: RolloutPlatformId): RolloutReportSummary {
  if (platformId === 'ios') {
    const iosGroups = groups.filter((group): group is IosRolloutGroup => group.platform === 'ios');
    return {
      releases: groups.length,
      events: events.length,
      start: iosGroups.filter(group => !!group.appStoreFirstRollout).length,
      final: iosGroups.filter(group => !!group.appStoreFinal).length,
      extraA: iosGroups.filter(group => group.events.some(event => event.store === 'app_store')).length,
      extraB: events.filter(event => event.store === 'app_store' && event.finalCompleted).length,
    };
  }
  const androidGroups = groups.filter((group): group is AndroidRolloutGroup => group.platform === 'android');
  return {
    releases: groups.length,
    events: events.length,
    start: androidGroups.filter(group => !!group.googleOnePercent).length,
    final: androidGroups.filter(group => !!group.googleHundredPercent).length,
    extraA: androidGroups.filter(group => !!group.ruStoreLatest).length,
    extraB: androidGroups.filter(group => !!group.appGalleryLatest).length,
  };
}

export async function collectRolloutReport(cfg: RolloutReportConfig): Promise<RolloutReportResult> {
  const platform = ROLLOUT_PLATFORM_CONFIG[cfg.platform];
  const lookbackDays = Math.max(1, Number(cfg.lookbackDays) || ROLLOUT_DEFAULT_LOOKBACK_DAYS);
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const rangeNote = [
    cfg.releaseFrom ? `from=${cfg.releaseFrom}` : '',
    cfg.releaseTo ? `to=${cfg.releaseTo}` : '',
  ].filter(Boolean).join(', ');

  cfg.onLog?.(`Старт загрузки: platform=${platform.label}, channel=${platform.channelId}, since=${formatMskDateTime(sinceMs)} МСК${rangeNote ? `, ${rangeNote}` : ''}`);
  const posts = await fetchBandChannelPostsSince(cfg, sinceMs);
  cfg.onLog?.(`Из Band получено ${posts.length} root-постов.`, 'ok');

  const events = posts
    .map(post => parseRolloutStoreEvent(post, platform.id))
    .filter(Boolean) as RolloutStoreEvent[];

  if (platform.id === 'ios') {
    const appStoreEvents = events.filter(event => event.store === 'app_store').length;
    const finalEvents = events.filter(event => event.store === 'app_store' && event.finalCompleted).length;
    cfg.onLog?.(`Распознано ${events.length} iOS store-событий: AppStore=${appStoreEvents}, финал=${finalEvents}.`, 'ok');
  } else {
    const googlePlayEvents = events.filter(event => event.store === 'google_play').length;
    const ruStoreEvents = events.filter(event => event.store === 'ru_store').length;
    const appGalleryEvents = events.filter(event => event.store === 'app_gallery').length;
    cfg.onLog?.(`Распознано ${events.length} store-событий: Google Play=${googlePlayEvents}, RuStore=${ruStoreEvents}, AppGallery=${appGalleryEvents}.`, 'ok');
  }

  const allGroups = groupRolloutEvents(events, platform.id);
  const groups = filterRolloutGroupsByRange(allGroups, cfg.releaseFrom || '', cfg.releaseTo || '');
  cfg.onLog?.(`После группировки и диапазона осталось ${groups.length} release-строк.`, groups.length ? 'ok' : 'warn');

  return {
    allGroups,
    groups,
    events,
    summary: buildRolloutSummary(groups, events, platform.id),
    postsCount: posts.length,
  };
}

export function formatMskDate(ms: number) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms));
}

export function formatMskDateTime(ms: number) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms)).replace(',', '');
}

export function normalizeRolloutExportCell(value: unknown) {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildRolloutExportRows(groups: RolloutGroup[], platformId: RolloutPlatformId) {
  return groups.map(group => {
    if (platformId === 'ios' && group.platform === 'ios') {
      const one = group.appStoreFirstRollout;
      const final = group.appStoreFinal;
      const versions = Array.from(new Set(group.events.map(event => event.version))).sort(compareRolloutVersionsDesc);
      return {
        platform: 'ios',
        release_family: group.family,
        versions: versions.join(', '),
        events_count: group.events.length,
        appstore_start_date: one ? formatMskDate(one.createdAt) : '',
        appstore_start_datetime_msk: one ? formatMskDateTime(one.createdAt) : '',
        appstore_start_version: one ? one.version : '',
        appstore_start_percent: one && one.percent !== null ? String(one.percent) : '',
        appstore_start_stage: one ? one.stageLabel : '',
        appstore_start_stage_text: one ? one.stageText : '',
        appstore_start_message: one ? one.text : '',
        appstore_final_date: final ? formatMskDate(final.createdAt) : '',
        appstore_final_datetime_msk: final ? formatMskDateTime(final.createdAt) : '',
        appstore_final_version: final ? final.version : '',
        appstore_final_stage: final ? final.stageLabel : '',
        appstore_final_stage_text: final ? final.stageText : '',
        appstore_final_message: final ? final.text : '',
      };
    }

    if (group.platform !== 'android') {
      return {
        platform: platformId,
        release_family: group.family,
        versions: group.events.map(event => event.version).join(', '),
        events_count: group.events.length,
      };
    }

    const one = group.googleOnePercent;
    const hundred = group.googleHundredPercent;
    const ruStore = group.ruStoreLatest;
    const appGallery = group.appGalleryLatest;
    const versions = Array.from(new Set(group.events.map(event => event.version))).sort(compareRolloutVersionsDesc);
    return {
      platform: 'android',
      release_family: group.family,
      versions: versions.join(', '),
      events_count: group.events.length,
      one_percent_date: one ? formatMskDate(one.createdAt) : '',
      one_percent_datetime_msk: one ? formatMskDateTime(one.createdAt) : '',
      one_percent_version: one ? one.version : '',
      one_percent_stage: one ? one.stageLabel : '',
      one_percent_stage_text: one ? one.stageText : '',
      one_percent_message: one ? one.text : '',
      hundred_percent_date: hundred ? formatMskDate(hundred.createdAt) : '',
      hundred_percent_datetime_msk: hundred ? formatMskDateTime(hundred.createdAt) : '',
      hundred_percent_version: hundred ? hundred.version : '',
      hundred_percent_stage: hundred ? hundred.stageLabel : '',
      hundred_percent_stage_text: hundred ? hundred.stageText : '',
      hundred_percent_message: hundred ? hundred.text : '',
      rustore_date: ruStore ? formatMskDate(ruStore.createdAt) : '',
      rustore_datetime_msk: ruStore ? formatMskDateTime(ruStore.createdAt) : '',
      rustore_version: ruStore ? ruStore.version : '',
      rustore_stage: ruStore ? ruStore.stageLabel : '',
      rustore_stage_text: ruStore ? ruStore.stageText : '',
      rustore_message: ruStore ? ruStore.text : '',
      appgallery_date: appGallery ? formatMskDate(appGallery.createdAt) : '',
      appgallery_datetime_msk: appGallery ? formatMskDateTime(appGallery.createdAt) : '',
      appgallery_version: appGallery ? appGallery.version : '',
      appgallery_stage: appGallery ? appGallery.stageLabel : '',
      appgallery_stage_text: appGallery ? appGallery.stageText : '',
      appgallery_message: appGallery ? appGallery.text : '',
    };
  });
}

export function buildRolloutExportFilename(platformId: RolloutPlatformId, ext: string, releaseFrom = '', releaseTo = '') {
  const parts = ['band-store-rollout', platformId];
  if (releaseFrom) parts.push(`from-${releaseFrom.replace(/[^\d.]+/g, '-')}`);
  if (releaseTo) parts.push(`to-${releaseTo.replace(/[^\d.]+/g, '-')}`);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  parts.push(stamp);
  return `${parts.join('_')}.${ext}`;
}

export function buildRolloutExportDataset(groups: RolloutGroup[], platformId: RolloutPlatformId, releaseFrom = '', releaseTo = '', ext = 'csv'): RolloutExportDataset | null {
  const rows = buildRolloutExportRows(groups, platformId)
    .sort((a, b) => compareRolloutVersionsDesc(String(a.release_family || ''), String(b.release_family || '')));
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]);
  const normalizedRows = rows.map(row => Object.fromEntries(
    columns.map(column => [column, normalizeRolloutExportCell(row[column as keyof typeof row])]),
  )) as Array<Record<string, string | number>>;
  const values = normalizedRows.map(row => columns.map(column => normalizeRolloutExportCell(row[column])));
  return {
    rows: normalizedRows,
    columns,
    values,
    filename: buildRolloutExportFilename(platformId, ext, releaseFrom, releaseTo),
  };
}

export async function uploadRolloutDatasetToDisk(settings: AppSettings, platformId: RolloutPlatformId, dataset: RolloutExportDataset, filters: { releaseFrom: string; releaseTo: string; lookbackDays: number }, signal?: AbortSignal) {
  const platform = ROLLOUT_PLATFORM_CONFIG[platformId];
  const payload = {
    spreadsheetId: ROLLOUT_DISK_SPREADSHEET_ID,
    spreadsheetUrl: ROLLOUT_DISK_SPREADSHEET_URL,
    source: 'band-rollout-report',
    reportName: `${platform.label} rollout report`,
    platform: platform.id,
    platformLabel: platform.label,
    sheetName: ROLLOUT_DISK_SHEET_NAMES[platform.id],
    fileName: dataset.filename,
    generatedAt: new Date().toISOString(),
    filters,
    columns: dataset.columns.slice(),
    rows: dataset.values.map(row => row.slice()),
  };

  return proxyRequestJson(
    settings,
    ROLLOUT_DISK_APPS_SCRIPT_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    },
    signal,
  );
}
