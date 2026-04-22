/* Launch service — Allure TestOps run creator + Band posting + duty stream collection */

import { AppSettings } from '../types';
import { RunMode } from '../types';

// ─── ALLURE CONSTANTS ──────────────────────────────────────────
const ALLURE_BASE = 'https://allure-testops.wb.ru';
const RUN_CREATOR_PROJECT_ID = 7;

const RUN_TP_CP_ANDROID       = 1998;
const RUN_TP_CP_IOS           = 3258;
const RUN_TP_NAPI_BASE        = 1036;
const RUN_TP_NAPI_IOS         = 1869;
const RUN_TP_NAPI_ANDROID     = 1871;
const RUN_TP_SMOKE_RUSTORE    = 999;
const RUN_TP_SMOKE_APPGALLERY = 1000;

const RUN_TAG_ANDROID = 4115;
const RUN_TAG_IOS     = 1711;

const ALLURE_TESTPLAN_LEAF_URL =
  'https://allure-testops.wb.ru/api/testplan/3918/tree/leaf?treeId=987&projectId=7&path=7904&sort=name%2Casc&size=100';

// ─── BAND CONSTANTS ────────────────────────────────────────────
const BAND_BASE               = 'https://band.wb.ru';
export const SWAT_CHANNEL_ID  = 'nq1amqo347gy9d46oe14zgs44w';
export const FEED_CHANNEL_ID  = 'tdj9ns46eprx8n5neupw8ejw9c';

// ─── TYPES ─────────────────────────────────────────────────────
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface LaunchRecord {
  id: number;
  name: string;
  url: string;
  reused: boolean;
}

export interface ScenarioResult {
  runs: LaunchRecord[];
  message: string;
}

// ─── HELPERS ───────────────────────────────────────────────────

function allureHeaders(token: string): Record<string, string> {
  const raw = String(token || '').trim().replace(/^Api-Token\s+/i, '');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Api-Token ${raw}`,
  };
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function getMmCsrf(cookies: string): string {
  const match = String(cookies || '').match(/MMCSRF=([^;]+)/);
  return match ? match[1].trim() : '';
}

function getCurrentBandUserId(cookies: string): string {
  const match = String(cookies || '').match(/MMUSERID=([^;]+)/);
  return match ? match[1].trim() : '';
}

// ─── PROXY FETCH ───────────────────────────────────────────────

async function proxyRequest<T>(
  proxyBase: string,
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const base = String(proxyBase || '').replace(/\/+$/, '');
  const proxyUrl = `${base}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const init: RequestInit = {
    method,
    headers,
    signal,
    cache: 'no-store',
  };
  if (body !== undefined && body !== null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const resp = await fetch(proxyUrl, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Proxy HTTP ${resp.status} для ${targetUrl}: ${text.slice(0, 200)}`);
  }
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

// ─── ALLURE API ────────────────────────────────────────────────

async function allureFetch<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${ALLURE_BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
  const init: RequestInit = {
    method,
    headers: allureHeaders(token),
    signal,
    mode: 'cors',
    credentials: 'omit',
  };
  if (body !== undefined && body !== null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Allure HTTP ${resp.status} для ${path}: ${text.slice(0, 200)}`);
  }
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

async function allureFetchUrl<T>(
  token: string,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const headers = allureHeaders(token);
  const resp = await fetch(url, { headers, signal, mode: 'cors', credentials: 'omit' });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Allure HTTP ${resp.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

// ─── RUN CREATOR API ───────────────────────────────────────────

async function findExistingLaunch(
  token: string,
  launchName: string,
  signal?: AbortSignal,
): Promise<LaunchRecord | null> {
  const filter = base64Utf8(JSON.stringify([
    { id: 'name', value: String(launchName || ''), type: 'string' },
  ]));
  const q = new URLSearchParams({
    page: '0',
    size: '25',
    search: filter,
    projectId: String(RUN_CREATOR_PROJECT_ID),
    preview: 'true',
    sort: 'createdDate,desc',
  });
  const data = await allureFetch<{ content?: Array<{ id?: number; name?: string }> }>(
    token, 'GET', `/launch?${q}`, undefined, signal,
  );
  const exact = String(launchName || '').trim();
  const found = (Array.isArray(data?.content) ? data.content : [])
    .find(item => String((item?.name) || '').trim() === exact);
  if (!found?.id) return null;
  return {
    id: Number(found.id),
    name: String(found.name || ''),
    url: `${ALLURE_BASE}/launch/${found.id}`,
    reused: true,
  };
}

async function createTag(token: string, name: string, signal?: AbortSignal): Promise<number> {
  const data = await allureFetch<{ id?: number }>(token, 'POST', '/launch/tag', { name }, signal);
  if (!data?.id) throw new Error(`Не удалось создать тег '${name}'`);
  return Number(data.id);
}

async function runTestplan(
  token: string,
  tpId: number,
  launchName: string,
  tagIds: number[],
  signal?: AbortSignal,
): Promise<LaunchRecord> {
  const existing = await findExistingLaunch(token, launchName, signal);
  if (existing) return existing;

  const data = await allureFetch<{ id?: number; name?: string }>(
    token, 'POST', `/testplan/${tpId}/run`,
    { launchName, tags: tagIds.map(id => ({ id })) },
    signal,
  );
  if (!data?.id) throw new Error(`Тест-план ${tpId} не запустился`);
  return {
    id: Number(data.id),
    name: String(data.name || launchName),
    url: `${ALLURE_BASE}/launch/${data.id}`,
    reused: false,
  };
}

async function syncTestplan(token: string, tpId: number, signal?: AbortSignal): Promise<void> {
  await allureFetch(token, 'POST', `/testplan/${tpId}/sync`, null, signal);
}

// ─── DUTY STREAMS ──────────────────────────────────────────────

export async function fetchDutyStreamNames(
  token: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const names: string[] = [];

  for (let page = 0; page < 50; page++) {
    const url = new URL(ALLURE_TESTPLAN_LEAF_URL);
    url.searchParams.set('page', String(page));

    const data = await allureFetchUrl<{
      content?: Array<{ name?: string }>;
      last?: boolean;
      totalPages?: number;
    }>(token, url.toString(), signal);

    const content = Array.isArray(data?.content) ? data.content : [];
    for (const item of content) {
      const name = String(item?.name || '').trim();
      if (name) names.push(name);
    }

    if (data?.last) break;
    const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : null;
    if (totalPages !== null && page >= totalPages - 1) break;
  }

  return [...new Set(names.filter(Boolean))];
}

// ─── BAND POSTING ──────────────────────────────────────────────

export interface BandPostOptions {
  channelId: string;
  rootId?: string;
}

export async function bandPostMessage(
  proxyBase: string,
  cookies: string,
  message: string,
  opts: BandPostOptions,
  signal?: AbortSignal,
): Promise<{ id?: string }> {
  const channelId = opts.channelId;
  const rootId = opts.rootId || '';
  const userId = getCurrentBandUserId(cookies);
  const mmCsrf = getMmCsrf(cookies);
  const nowMs = Date.now();

  const payload = {
    file_ids: [],
    message: String(message || '').trim(),
    channel_id: channelId,
    root_id: rootId,
    pending_post_id: `${userId}:${nowMs}`,
    user_id: userId,
    create_at: 0,
    metadata: {},
    props: {},
    update_at: nowMs,
    reply_count: 0,
  };

  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Content-Type': 'application/json',
    'Origin': BAND_BASE,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Cookie': cookies,
    ...(mmCsrf ? { 'X-CSRF-Token': mmCsrf } : {}),
  };

  return proxyRequest<{ id?: string }>(
    proxyBase, 'POST', `${BAND_BASE}/api/v4/posts`, headers, payload, signal,
  );
}

export async function bandScheduleMessage(
  proxyBase: string,
  cookies: string,
  message: string,
  scheduledAtMs: number,
  opts: BandPostOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  const channelId = opts.channelId;
  const rootId = opts.rootId || '';
  const userId = getCurrentBandUserId(cookies);
  const mmCsrf = getMmCsrf(cookies);

  const payload = {
    id: '',
    scheduled_at: scheduledAtMs,
    create_at: 0,
    user_id: userId,
    channel_id: channelId,
    root_id: rootId,
    message: String(message || '').trim(),
    props: {},
    metadata: {},
    file_ids: [],
  };

  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Content-Type': 'application/json',
    'Origin': BAND_BASE,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Cookie': cookies,
    ...(mmCsrf ? { 'X-CSRF-Token': mmCsrf } : {}),
  };

  return proxyRequest<unknown>(
    proxyBase, 'POST', `${BAND_BASE}/api/v4/posts/schedule`, headers, payload, signal,
  );
}

// ─── SCENARIO ORCHESTRATOR ─────────────────────────────────────

function launchLink(run: LaunchRecord): string {
  return `[${run.name}](${run.url})`;
}

export async function runCreatorScenario(
  mode: RunMode,
  release: string,
  settings: AppSettings,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<ScenarioResult> {
  const token = String(settings.allureToken || '').replace(/^Api-Token\s+/i, '').trim();
  if (!token) throw new Error('Не задан Allure токен — заполни в Настройках.');
  if (!release.trim()) throw new Error('Не задан номер релиза.');

  let releaseTagId = 0;

  async function ensureReleaseTag(): Promise<number> {
    if (releaseTagId) return releaseTagId;
    onLog('Создаю тег релиза...');
    releaseTagId = await createTag(token, release, signal);
    onLog(`Тег релиза: id=${releaseTagId}`, 'ok');
    return releaseTagId;
  }

  const runs: LaunchRecord[] = [];

  if (mode === 'hf_android') {
    const tagRelease = await ensureReleaseTag();
    const name = `[SWAT][Крит-путь][Android] ${release}`;
    onLog(`Запускаю тест-план ${RUN_TP_CP_ANDROID} → ${name}`);
    const run = await runTestplan(token, RUN_TP_CP_ANDROID, name, [RUN_TAG_ANDROID, tagRelease], signal);
    onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
    runs.push(run);

    return {
      runs,
      message: `Привет, новый крит-путь для ХФ Android, релиз ${release}\n${launchLink(run)}`,
    };
  }

  if (mode === 'hf_ios') {
    const tagRelease = await ensureReleaseTag();
    const name = `[SWAT][Крит-путь][iOS] ${release}`;
    onLog(`Запускаю тест-план ${RUN_TP_CP_IOS} → ${name}`);
    const run = await runTestplan(token, RUN_TP_CP_IOS, name, [tagRelease, RUN_TAG_IOS], signal);
    onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
    runs.push(run);

    return {
      runs,
      message: `Привет, новый крит-путь для ХФ iOS, релиз ${release}\n${launchLink(run)}`,
    };
  }

  if (mode === 'napi') {
    const plans = [
      { tpId: RUN_TP_NAPI_BASE,     name: `[SWAT][Android и iOS] Релиз Napi ${release}` },
      { tpId: RUN_TP_NAPI_IOS,      name: `[SWAT][Финтех + Корзина][iOS] Релиз Napi ${release}` },
      { tpId: RUN_TP_NAPI_ANDROID,  name: `[SWAT][Финтех + Корзина][Android] Релиз Napi ${release}` },
    ];

    onLog('Проверяю существующие NAPI раны...');
    const existing = await Promise.all(plans.map(p => findExistingLaunch(token, p.name, signal)));
    const missing = plans.filter((_, i) => !existing[i]);

    let tagNapi = 0;
    let tagRelease = 0;

    if (missing.length) {
      tagRelease = await ensureReleaseTag();
      onLog(`Синхронизирую тест-кейсы (${missing.map(p => p.tpId).join(', ')})...`);
      for (const p of missing) {
        await syncTestplan(token, p.tpId, signal);
      }
      tagNapi = await createTag(token, 'napi', signal);
    }

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (existing[i]) {
        onLog(`Найден существующий ран: ${launchLink(existing[i]!)}`, 'warn');
        runs.push(existing[i]!);
        continue;
      }
      const tagIds = p.tpId === RUN_TP_NAPI_BASE
        ? [RUN_TAG_ANDROID, RUN_TAG_IOS, tagRelease, tagNapi]
        : p.tpId === RUN_TP_NAPI_IOS
          ? [RUN_TAG_IOS, tagRelease, tagNapi]
          : [tagRelease, RUN_TAG_ANDROID, tagNapi];

      onLog(`Запускаю ${p.tpId} → ${p.name}`);
      const run = await runTestplan(token, p.tpId, p.name, tagIds, signal);
      onLog(`Ран: ${launchLink(run)}`, 'ok');
      runs.push(run);
    }

    return {
      runs,
      message: `Привет, новый регресс для NAPI, релиз ${release}\n${runs.map(launchLink).join('\n')}`,
    };
  }

  if (mode === 'sunday_devices') {
    const tagRelease = await ensureReleaseTag();
    const deviceRuns: Array<{ tpId: number; name: string }> = [
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь][Android] Тест UI Старых устройств ${release}` },
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь][Android] Раскладушки (FOLD) ${release}` },
      { tpId: RUN_TP_CP_IOS,     name: `[SWAT][Крит-путь][IOS] Тест UI Старых устройств ${release}` },
      { tpId: RUN_TP_CP_IOS,     name: `[SWAT][Крит-путь][IOS] iPAD ${release}` },
    ];
    for (const r of deviceRuns) {
      const tagIds = r.tpId === RUN_TP_CP_ANDROID
        ? [RUN_TAG_ANDROID, tagRelease]
        : [RUN_TAG_IOS, tagRelease];
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, tagIds, signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return {
      runs,
      message: `Привет, новые воскресные раны устройств, релиз ${release}\n${runs.map(launchLink).join('\n')}`,
    };
  }

  if (mode === 'rustore_critical') {
    const tagRelease = await ensureReleaseTag();
    const tagApp = await createTag(token, 'AppGallery', signal);
    const tagRu  = await createTag(token, 'RuStore', signal);

    const pairs: Array<{ tpId: number; name: string; extraTag: number }> = [
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь] AppGallery ${release}`, extraTag: tagApp },
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь] RuStore ${release}`,    extraTag: tagRu  },
    ];
    for (const r of pairs) {
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, [RUN_TAG_ANDROID, tagRelease, r.extraTag], signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return {
      runs,
      message: `Привет, новый крит-путь для RuStore / AppGallery, релиз ${release}\n${runs.map(launchLink).join('\n')}`,
    };
  }

  if (mode === 'rustore_smoke') {
    const tagRelease = await ensureReleaseTag();
    const tagApp = await createTag(token, 'AppGallery', signal);
    const tagRu  = await createTag(token, 'RuStore', signal);

    const pairs: Array<{ tpId: number; name: string; extraTag: number }> = [
      { tpId: RUN_TP_SMOKE_RUSTORE,    name: `[SWAT][Android][Smoke] RuStore ${release}`,    extraTag: tagRu  },
      { tpId: RUN_TP_SMOKE_APPGALLERY, name: `[SWAT][Android][Smoke] AppGallery ${release}`, extraTag: tagApp },
    ];
    for (const r of pairs) {
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, [RUN_TAG_ANDROID, tagRelease, r.extraTag], signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return {
      runs,
      message: `Привет, новый Smoke для RuStore / AppGallery, релиз ${release}\n${runs.map(launchLink).join('\n')}`,
    };
  }

  // major — just return empty result; major flow handled separately in the component
  return { runs: [], message: '' };
}
