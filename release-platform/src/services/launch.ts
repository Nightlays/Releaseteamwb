/* Launch service — Allure run creator + Band posting + major release workflow */

import { AppSettings } from '../types';
import { RunMode, DutyStream } from '../types';

// ─── ALLURE CONSTANTS ──────────────────────────────────────────
const ALLURE_BASE          = 'https://allure-testops.wb.ru';
const ALLURE_LAUNCHES_BASE = 'https://allure-testops.wb.ru/launch';
const RUN_CREATOR_PROJECT_ID   = 7;

const RUN_TP_CP_ANDROID       = 1998;
const RUN_TP_CP_IOS           = 3258;
const RUN_TP_NAPI_BASE        = 1036;
const RUN_TP_NAPI_IOS         = 1869;
const RUN_TP_NAPI_ANDROID     = 1871;
const RUN_TP_SMOKE_RUSTORE    = 999;
const RUN_TP_SMOKE_APPGALLERY = 1000;
const RUN_TP_MAJOR_READINESS  = 3918;

const RUN_TAG_ANDROID   = 4115;
const RUN_TAG_IOS       = 1711;
const RUN_TAG_REGRESSION = 278;

const ALLURE_TESTPLAN_LEAF_URL =
  'https://allure-testops.wb.ru/api/testplan/3918/tree/leaf?treeId=987&projectId=7&path=7904&sort=name%2Casc&size=100';

// ─── BAND CONSTANTS ────────────────────────────────────────────
const BAND_BASE              = 'https://band.wb.ru';
const BAND_TEAM_ID           = 'dp75hbjcibyjdjzt7x3m68auic';
const RELEASE_FEED_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const MAJOR_POLL_TITLE       = 'Облако компонентов';

// SWAT QA channel — где пишут дежурных (BAND_CHANNEL_ID_FIXED в legacy)
export const SWAT_QA_CHANNEL_ID      = '6sqki85urpbfbqdkcdfen33owh';
// SWAT Team Only — куда постим раны (SWAT_TEAM_ONLY_CHANNEL_ID в legacy)
export const SWAT_CHANNEL_ID         = 'nq1amqo347gy9d46oe14zgs44w';
export const FEED_CHANNEL_ID         = 'tdj9ns46eprx8n5neupw8ejw9c';
const GROUP_ANDROID_ID               = 'bbtekcuhfjykmm9awe56gebj9y';
const GROUP_IOS_ID                   = '6skkxrr3ufrkmy1u3paepd35ar';

export const NOTICE_CHANNELS: Array<{ id: string; name: string }> = [
  { id: 'e87794p6sirx8kyg71dgrzp74r', name: 'mp-ios-release' },
  { id: 'bzd6dd5133855cor6faew61xtr', name: 'mp-Релиз Андроид' },
  { id: '11pg8zfbdfbwpdzijiseg6g6zr', name: 'Олеся и Лиды QA' },
  { id: SWAT_QA_CHANNEL_ID, name: 'SWAT QA' },
];

// ─── DEPLOY LAB CONSTANTS ──────────────────────────────────────
const DEPLOY_LAB_BASE_URL = 'https://deploy-lab-api.wb.ru';

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

export interface BandPost {
  id: string;
  user_id: string;
  channel_id: string;
  root_id: string;
  message: string;
  create_at: number;
  update_at?: number;
  delete_at: number;
  props?: Record<string, unknown>;
}

interface AllureRunRecord {
  id: number;
  name: string;
  url: string;
}

export interface AllureRunsForPlatform {
  blockerHigh: AllureRunRecord[];
  selective: AllureRunRecord[];
}

export type MajorWorkflowResolvedStatus = 'pending' | 'done';

export interface MajorWorkflowSyncResult {
  statuses: MajorWorkflowResolvedStatus[];
  threadText: string;
  rootId: string;
  finalRunUrl: string;
}

// ─── ALLURE HELPERS ────────────────────────────────────────────

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

// ─── BAND HELPERS ──────────────────────────────────────────────

function getMmCsrf(cookies: string): string {
  const match = String(cookies || '').match(/MMCSRF=([^;]+)/);
  return match ? match[1].trim() : '';
}

function getCurrentBandUserId(cookies: string): string {
  const match = String(cookies || '').match(/MMUSERID=([^;]+)/);
  return match ? match[1].trim() : '';
}

export function normBandText(message: string): string {
  return String(message || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n')
    .trim();
}

function bandGetHeaders(cookies: string): Record<string, string> {
  const mmCsrf = getMmCsrf(cookies);
  return {
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Content-Type': 'application/json',
    Origin: BAND_BASE,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Cookie': cookies,
    ...(mmCsrf ? { 'X-CSRF-Token': mmCsrf } : {}),
  };
}

function bandReadHeaders(cookies: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Accept-Language': 'ru',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Cookie': cookies,
  };
}

interface BandPayload {
  posts?: Record<string, BandPost>;
  order?: string[];
}

function unwrapBandPayload(raw: unknown): BandPayload {
  let node: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (node && typeof node === 'object') {
      const n = node as Record<string, unknown>;
      if (n.posts && typeof n.posts === 'object') return n as BandPayload;
      if (n.body !== undefined) {
        node = typeof n.body === 'string' ? (() => { try { return JSON.parse(n.body as string); } catch { return n.body; } })() : n.body;
        continue;
      }
      if (n.data && typeof n.data === 'object') { node = n.data; continue; }
    }
    break;
  }
  return (raw && typeof raw === 'object') ? raw as BandPayload : {};
}

function collectBandPosts(payload: BandPayload): BandPost[] {
  const postsMap = (payload?.posts && typeof payload.posts === 'object') ? payload.posts : {};
  const order = Array.isArray(payload?.order) ? payload.order : [];
  const result: BandPost[] = [];
  if (order.length) {
    const used = new Set<string>();
    for (const id of order) {
      const post = postsMap[id];
      if (post) { result.push(post); used.add(id); }
    }
    for (const [id, post] of Object.entries(postsMap)) {
      if (!used.has(id) && post) result.push(post);
    }
  } else {
    result.push(...Object.values(postsMap).filter(Boolean));
  }
  return result;
}

function getBandCreateAt(post: BandPost): number {
  const n = Number(post?.create_at);
  return Number.isFinite(n) ? n : 0;
}

function isActiveBandRootPost(post: BandPost): boolean {
  if (!post) return false;
  if (Number(post.delete_at) > 0) return false;
  return !post.root_id;
}

function findLatestRootPostByMessage(posts: BandPost[], message: string, userId: string): BandPost | null {
  const target = normBandText(message).toLowerCase();
  let found: BandPost | null = null;
  for (const post of posts) {
    if (!isActiveBandRootPost(post)) continue;
    if (userId && post.user_id !== userId) continue;
    if (normBandText(post.message).toLowerCase() !== target) continue;
    if (!found || getBandCreateAt(post) > getBandCreateAt(found)) found = post;
  }
  return found;
}

function findEarliestOwnThreadPost(posts: BandPost[], rootId: string, userId: string): BandPost | null {
  let found: BandPost | null = null;
  for (const post of posts) {
    if (Number(post.delete_at) > 0) continue;
    if (post.root_id !== rootId) continue;
    if (userId && post.user_id !== userId) continue;
    if (!found || getBandCreateAt(post) < getBandCreateAt(found)) found = post;
  }
  return found;
}

function findLatestOwnThreadReply(
  posts: BandPost[],
  rootId: string,
  userId: string,
  predicate: (text: string, post: BandPost) => boolean,
): BandPost | null {
  let found: BandPost | null = null;
  for (const post of posts) {
    if (Number(post.delete_at) > 0) continue;
    if (String(post.root_id || '').trim() !== String(rootId || '').trim()) continue;
    if (userId && String(post.user_id || '').trim() !== String(userId || '').trim()) continue;
    const text = normBandText(post.message);
    if (!predicate(text, post)) continue;
    if (!found || getBandCreateAt(post) > getBandCreateAt(found)) found = post;
  }
  return found;
}

function hasOwnThreadReply(
  posts: BandPost[],
  rootId: string,
  userId: string,
  predicate: (text: string, post: BandPost) => boolean,
): boolean {
  return Boolean(findLatestOwnThreadReply(posts, rootId, userId, predicate));
}

function isBandPollPost(post: BandPost): boolean {
  if (!post || typeof post !== 'object') return false;
  const text = normBandText(post.message);
  if (/^\/poll\b/i.test(text)) return true;
  if (text.includes('Настройки опроса:') && text.includes('Всего ответов:')) return true;

  const props = (post.props && typeof post.props === 'object') ? post.props : {};
  if (props.poll_id || props.pollId || props['poll-id']) return true;

  const attachments = Array.isArray(props.attachments) ? props.attachments : [];
  return attachments.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const title = String((item as Record<string, unknown>).title || '').trim();
    const textValue = String((item as Record<string, unknown>).text || '').trim();
    if (title.includes('Опрос') || title.includes('Poll')) return true;
    if (textValue.includes('Настройки опроса:') || textValue.includes('Всего ответов:')) return true;
    const actions = Array.isArray((item as Record<string, unknown>).actions)
      ? ((item as Record<string, unknown>).actions as Array<Record<string, unknown>>)
      : [];
    return actions.some((action) =>
      /удалить ответы|добавить вариант ответа|завершить опрос|удалить опрос/i.test(String(action?.name || '').trim()),
    );
  });
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
  const init: RequestInit = { method, headers, signal, cache: 'no-store' };
  if (body !== undefined && body !== null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const resp = await fetch(proxyUrl, init);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status} для ${targetUrl}: ${text.slice(0, 200)}`);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

async function proxyBlobRequest(
  proxyBase: string,
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Blob> {
  const base = String(proxyBase || '').replace(/\/+$/, '');
  const proxyUrl = `${base}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const resp = await fetch(proxyUrl, { method, headers, signal, cache: 'no-store' });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Proxy HTTP ${resp.status} для ${targetUrl}: ${text.slice(0, 200)}`);
  }
  return resp.blob();
}

// ─── ALLURE API ────────────────────────────────────────────────

async function allureFetch<T>(
  token: string, method: string, path: string, body?: unknown, signal?: AbortSignal,
): Promise<T> {
  const url = `${ALLURE_BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
  const init: RequestInit = {
    method, headers: allureHeaders(token), signal, mode: 'cors', credentials: 'omit',
  };
  if (body !== undefined && body !== null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Allure HTTP ${resp.status} для ${path}: ${text.slice(0, 200)}`);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

async function allureFetchUrl<T>(token: string, url: string, signal?: AbortSignal): Promise<T> {
  const headers = allureHeaders(token);
  const resp = await fetch(url, { headers, signal, mode: 'cors', credentials: 'omit' });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Allure HTTP ${resp.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

async function allureRequestUrl<T>(
  token: string,
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
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
  if (!resp.ok) throw new Error(`Allure HTTP ${resp.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

// ─── BAND API ──────────────────────────────────────────────────

async function bandFetchChannelPostsSince(
  proxyBase: string, cookies: string, channelId: string, sinceMs: number, signal?: AbortSignal,
): Promise<BandPost[]> {
  const url = `${BAND_BASE}/api/v4/channels/${encodeURIComponent(channelId)}/posts?since=${sinceMs}&skipFetchThreads=false&collapsedThreads=true&collapsedThreadsExtended=false`;
  const raw = await proxyRequest<unknown>(proxyBase, 'GET', url, bandReadHeaders(cookies), undefined, signal);
  return collectBandPosts(unwrapBandPayload(raw));
}

async function bandFetchActiveRootPostsWindow(
  proxyBase: string,
  cookies: string,
  channelId: string,
  sinceMs: number,
  signal?: AbortSignal,
  options?: { perPage?: number; pageLimit?: number },
): Promise<BandPost[]> {
  const minCreatedAt = Number(sinceMs);
  const perPage = Math.max(10, Math.min(200, Number(options?.perPage) || 100));
  const pageLimit = Math.max(1, Math.min(120, Number(options?.pageLimit) || 60));
  const postsById = new Map<string, BandPost>();
  let beforeId = '';

  for (let page = 0; page < pageLimit; page += 1) {
    if (signal?.aborted) break;
    const url = new URL(`${BAND_BASE}/api/v4/channels/${encodeURIComponent(channelId)}/posts`);
    url.searchParams.set('page', '0');
    url.searchParams.set('per_page', String(perPage));
    if (beforeId) url.searchParams.set('before', beforeId);
    url.searchParams.set('skipFetchThreads', 'false');
    url.searchParams.set('collapsedThreads', 'true');
    url.searchParams.set('collapsedThreadsExtended', 'false');

    const raw = await proxyRequest<unknown>(proxyBase, 'GET', url.toString(), bandReadHeaders(cookies), undefined, signal);
    const payload = unwrapBandPayload(raw);
    const postsMap = payload?.posts && typeof payload.posts === 'object' ? payload.posts : {};
    const order = Array.isArray(payload?.order) ? payload.order : Object.keys(postsMap);
    if (!order.length && !Object.keys(postsMap).length) break;

    const batch: BandPost[] = [];
    for (const id of order) {
      const post = postsMap[id];
      if (post && typeof post === 'object') {
        batch.push(post);
        if (!postsById.has(String(id))) postsById.set(String(id), post);
      }
    }
    for (const [id, post] of Object.entries(postsMap)) {
      if (post && typeof post === 'object' && !postsById.has(String(id))) {
        postsById.set(String(id), post);
      }
    }

    batch.sort((a, b) => getBandCreateAt(b) - getBandCreateAt(a));
    const oldestPost = batch[batch.length - 1] || null;
    const oldestId = String(oldestPost?.id || '').trim();
    const oldestCreateAt = oldestPost ? getBandCreateAt(oldestPost) : 0;

    if (!oldestId || oldestId === beforeId) break;
    beforeId = oldestId;
    if (order.length < perPage) break;
    if (Number.isFinite(minCreatedAt) && oldestCreateAt && oldestCreateAt < minCreatedAt) break;
  }

  return [...postsById.values()]
    .filter(post => {
      if (!isActiveBandRootPost(post)) return false;
      const createdAt = getBandCreateAt(post);
      if (Number.isFinite(minCreatedAt) && createdAt && createdAt < minCreatedAt) return false;
      return createdAt > 0;
    })
    .sort((a, b) => getBandCreateAt(b) - getBandCreateAt(a));
}

async function bandFetchThreadPosts(
  proxyBase: string,
  cookies: string,
  rootId: string,
  signal?: AbortSignal,
  options?: { perPage?: number; updatesOnly?: boolean; fromUpdateAt?: number; direction?: 'up' | 'down' },
): Promise<BandPost[]> {
  const opts = options || {};
  const url = new URL(`${BAND_BASE}/api/v4/posts/${encodeURIComponent(rootId)}/thread`);
  url.searchParams.set('skipFetchThreads', 'false');
  url.searchParams.set('collapsedThreads', 'true');
  url.searchParams.set('collapsedThreadsExtended', 'false');
  url.searchParams.set('direction', opts.direction || 'down');
  url.searchParams.set('perPage', String(Math.max(1, Math.min(200, Number(opts.perPage) || 60))));
  if (opts.updatesOnly) url.searchParams.set('updatesOnly', 'true');
  if (Number.isFinite(Number(opts.fromUpdateAt))) url.searchParams.set('fromUpdateAt', String(Number(opts.fromUpdateAt)));
  const raw = await proxyRequest<unknown>(proxyBase, 'GET', url.toString(), bandReadHeaders(cookies), undefined, signal);
  return collectBandPosts(unwrapBandPayload(raw)).sort((a, b) => (Number(a.create_at) || 0) - (Number(b.create_at) || 0));
}

async function bandPatchPost(
  proxyBase: string, cookies: string, post: BandPost, message: string, signal?: AbortSignal,
): Promise<void> {
  const url = `${BAND_BASE}/api/v4/posts/${encodeURIComponent(post.id)}/patch`;
  const normalized = normBandText(message);
  const body = {
    ...post,
    message: normalized,
    channelId: post.channel_id,
    rootId: post.root_id,
    fileInfos: [],
    uploadsInProgress: [],
    createAt: 0,
    updateAt: 0,
  };
  await proxyRequest<unknown>(proxyBase, 'PUT', url, bandGetHeaders(cookies), body, signal);
}

async function bandCreateReply(
  proxyBase: string, cookies: string, channelId: string, rootId: string, message: string, signal?: AbortSignal,
): Promise<BandPost> {
  const userId = getCurrentBandUserId(cookies);
  const normalized = normBandText(message);
  const nowMs = Date.now();
  const payload = {
    file_ids: [], message: normalized, channel_id: channelId, root_id: rootId,
    pending_post_id: `${userId}:${nowMs}`, user_id: userId, create_at: 0,
    metadata: {}, props: {}, update_at: nowMs, reply_count: 0,
  };
  return proxyRequest<BandPost>(proxyBase, 'POST', `${BAND_BASE}/api/v4/posts`, bandGetHeaders(cookies), payload, signal);
}

async function bandExecuteCommand(
  proxyBase: string, cookies: string, command: string, channelId: string, rootId: string, signal?: AbortSignal,
): Promise<void> {
  const normalized = command.replace(/[""«»]/g, '"').trim();
  const payload = { command: normalized, channel_id: channelId, team_id: BAND_TEAM_ID, root_id: rootId };
  await proxyRequest<unknown>(proxyBase, 'POST', `${BAND_BASE}/api/v4/commands/execute`, bandGetHeaders(cookies), payload, signal);
}

// ─── BAND GROUP MANAGEMENT ─────────────────────────────────────

async function bandSearchUserId(
  proxyBase: string, cookies: string, handle: string, signal?: AbortSignal,
): Promise<string> {
  const term = handle.replace(/^@+/, '');
  const data = await proxyRequest<unknown>(
    proxyBase, 'POST', `${BAND_BASE}/api/v4/users/search`,
    bandGetHeaders(cookies), { term, team_id: '' }, signal,
  );
  if (!Array.isArray(data)) return '';
  for (const user of data as Array<{ username?: string; id?: string }>) {
    if (user?.username === term && typeof user.id === 'string') return user.id;
  }
  const first = (data as Array<{ id?: string }>)[0];
  return typeof first?.id === 'string' ? first.id : '';
}

async function bandSearchUserIds(
  proxyBase: string, cookies: string, handles: string[], signal?: AbortSignal,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const handle of handles) {
    const id = await bandSearchUserId(proxyBase, cookies, handle, signal);
    if (id) out[handle] = id;
  }
  return out;
}

export type BandPresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

export interface BandUserSuggestion {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  position: string;
  avatarStamp: number;
  presence: BandPresenceStatus;
}

function normalizeBandUserSuggestion(user: {
  id?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  email?: string;
  position?: string;
  last_picture_update?: number | string;
  update_at?: number | string;
  create_at?: number | string;
}): BandUserSuggestion | null {
  const username = String(user?.username || '').trim().replace(/^@+/, '');
  if (!username) return null;
  const firstName = String(user?.first_name || '').trim();
  const lastName = String(user?.last_name || '').trim();
  const nickname = String(user?.nickname || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || nickname || username;
  return {
    id: String(user?.id || username).trim() || username,
    handle: `@${username}`,
    displayName,
    email: String(user?.email || '').trim(),
    position: String(user?.position || '').trim(),
    avatarStamp: Number(user?.last_picture_update || user?.update_at || user?.create_at || 0) || 0,
    presence: 'offline',
  };
}

export async function searchBandUsers(
  proxyBase: string,
  cookies: string,
  term: string,
  signal?: AbortSignal,
): Promise<BandUserSuggestion[]> {
  const query = String(term || '').trim();
  if (query.length < 2 || !cookies.trim()) return [];
  const data = await proxyRequest<unknown>(
    proxyBase,
    'POST',
    `${BAND_BASE}/api/v4/users/search`,
    bandGetHeaders(cookies),
    { term: query.replace(/^@+/, ''), team_id: '' },
    signal,
  );
  const seen = new Set<string>();
  const users = (Array.isArray(data) ? data : [])
    .map(user => normalizeBandUserSuggestion(user as Parameters<typeof normalizeBandUserSuggestion>[0]))
    .filter((user): user is BandUserSuggestion => Boolean(user))
    .filter(user => {
      const key = user.handle.toLocaleLowerCase('ru-RU');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  const ids = users.map(user => user.id).filter(Boolean);
  if (!ids.length) return users;

  try {
    const statuses = await proxyRequest<Array<{ user_id?: string; status?: string }>>(
      proxyBase,
      'POST',
      `${BAND_BASE}/api/v4/users/status/ids`,
      bandGetHeaders(cookies),
      ids,
      signal,
    );
    const presenceById: Record<string, BandPresenceStatus> = {};
    for (const item of Array.isArray(statuses) ? statuses : []) {
      const uid = String(item?.user_id || '').trim();
      const raw = String(item?.status || '').trim().toLowerCase();
      if (uid) presenceById[uid] = (['online', 'away', 'dnd'].includes(raw) ? raw : 'offline') as BandPresenceStatus;
    }
    return users.map(user => ({ ...user, presence: presenceById[user.id] ?? 'offline' }));
  } catch {
    return users;
  }
}

export async function fetchBandUsersByUsernames(
  proxyBase: string,
  cookies: string,
  usernames: string[],
  signal?: AbortSignal,
): Promise<BandUserSuggestion[]> {
  const requestedUsernames = [...new Set(
    (Array.isArray(usernames) ? usernames : [])
      .map(username => String(username || '').trim().replace(/^@+/, '').toLocaleLowerCase('ru-RU'))
      .filter(Boolean),
  )];
  if (!requestedUsernames.length || !cookies.trim()) return [];

  const data = await proxyRequest<unknown>(
    proxyBase,
    'POST',
    `${BAND_BASE}/api/v4/users/usernames`,
    bandGetHeaders(cookies),
    requestedUsernames,
    signal,
  );

  return (Array.isArray(data) ? data : [])
    .map(user => normalizeBandUserSuggestion(user as Parameters<typeof normalizeBandUserSuggestion>[0]))
    .filter((user): user is BandUserSuggestion => Boolean(user));
}

export async function fetchBandUserAvatarBlob(
  proxyBase: string,
  cookies: string,
  userId: string,
  avatarStamp = 0,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const id = String(userId || '').trim();
  if (!id || !cookies.trim()) return null;

  const url = `${BAND_BASE}/api/v4/users/${encodeURIComponent(id)}/image?_=${encodeURIComponent(String(avatarStamp || Date.now()))}`;
  const blob = await proxyBlobRequest(
    proxyBase,
    'GET',
    url,
    {
      ...bandReadHeaders(cookies),
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    signal,
  );

  if (!blob.size) return null;
  const type = String(blob.type || '').toLowerCase();
  if (type && !type.startsWith('image/')) return null;
  return blob;
}

export async function fetchBandDisplayNamesByHandles(
  proxyBase: string,
  cookies: string,
  handles: string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const normalizedHandles = [...new Set(
    (Array.isArray(handles) ? handles : [])
      .map(handle => toHandle(String(handle || '').trim()))
      .filter(Boolean)
      .map(handle => handle.toLocaleLowerCase('ru-RU')),
  )];
  if (!normalizedHandles.length || !cookies.trim()) return {};

  const out: Record<string, string> = {};
  const batchSize = 50;
  for (let i = 0; i < normalizedHandles.length; i += batchSize) {
    const batch = normalizedHandles.slice(i, i + batchSize);
    const users = await fetchBandUsersByUsernames(
      proxyBase,
      cookies,
      batch.map(handle => handle.replace(/^@+/, '')),
      signal,
    );
    for (const user of users) {
      const key = String(user.handle || '').trim().toLocaleLowerCase('ru-RU');
      const displayName = String(user.displayName || '').trim();
      if (key && displayName) out[key] = displayName;
    }
  }
  return out;
}

export async function fetchBandPresenceByHandles(
  proxyBase: string, cookies: string, handles: string[], signal?: AbortSignal,
): Promise<Record<string, BandPresenceStatus>> {
  if (!handles.length) return {};
  const handleToId = await bandSearchUserIds(proxyBase, cookies, handles, signal);
  const ids = Object.values(handleToId).filter(Boolean);
  if (!ids.length) return {};

  const statuses = await proxyRequest<Array<{ user_id?: string; status?: string }>>(
    proxyBase, 'POST', `${BAND_BASE}/api/v4/users/status/ids`,
    bandGetHeaders(cookies), ids, signal,
  );

  const idToStatus: Record<string, BandPresenceStatus> = {};
  for (const item of Array.isArray(statuses) ? statuses : []) {
    const uid = String(item?.user_id || '').trim();
    const raw = String(item?.status || '').trim().toLowerCase();
    if (uid) idToStatus[uid] = (['online', 'away', 'dnd'].includes(raw) ? raw : 'offline') as BandPresenceStatus;
  }

  const result: Record<string, BandPresenceStatus> = {};
  for (const [handle, id] of Object.entries(handleToId)) {
    result[handle] = idToStatus[id] ?? 'offline';
  }
  return result;
}

async function bandGetGroupUserIds(
  proxyBase: string, adminCookies: string, groupId: string, signal?: AbortSignal,
): Promise<string[]> {
  const url = `${BAND_BASE}/api/v4/users?in_group=${encodeURIComponent(groupId)}&page=0&per_page=200&sort=`;
  const data = await proxyRequest<unknown>(proxyBase, 'GET', url, bandReadHeaders(adminCookies), undefined, signal);
  if (!Array.isArray(data)) return [];
  return (data as Array<{ id?: string }>).filter(u => typeof u?.id === 'string').map(u => u.id as string);
}

async function bandDeleteGroupMembersBulk(
  proxyBase: string, adminCookies: string, groupId: string, userIds: string[], signal?: AbortSignal,
): Promise<void> {
  if (!userIds.length) return;
  const url = `${BAND_BASE}/api/v4/groups/${encodeURIComponent(groupId)}/members`;
  await proxyRequest<unknown>(proxyBase, 'DELETE', url, bandGetHeaders(adminCookies), { user_ids: userIds }, signal);
}

async function bandAddGroupMembers(
  proxyBase: string, adminCookies: string, groupId: string, userIds: string[], signal?: AbortSignal,
): Promise<void> {
  if (!userIds.length) return;
  const url = `${BAND_BASE}/api/v4/groups/${encodeURIComponent(groupId)}/members`;
  await proxyRequest<unknown>(proxyBase, 'POST', url, bandGetHeaders(adminCookies), { user_ids: userIds }, signal);
}

export async function updateBandGroupForPlatform(
  platform: 'ios' | 'android',
  rows: CollectionRow[],
  proxyBase: string,
  cookies: string,
  adminCookies: string,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveAdmin = adminCookies.trim() || cookies.trim();
  if (!effectiveAdmin) throw new Error('Band cookies не заданы.');
  const groupId = platform === 'ios' ? GROUP_IOS_ID : GROUP_ANDROID_ID;
  const label = platform === 'ios' ? 'iOS (@qadutyios)' : 'Android (@qadutyandr)';

  const handles = [...new Set(
    rows
      .map(r => platform === 'ios' ? r.iosDuty : r.androidDuty)
      .filter(Boolean),
  )];
  onLog(`Обновляю группу ${label}: ${handles.length} дежурных...`);

  onLog(`Ищу user ID для ${handles.length} хэндлов...`);
  const handleToId = await bandSearchUserIds(proxyBase, cookies, handles, signal);
  const newUserIds = Object.values(handleToId);
  onLog(`Найдено ID: ${newUserIds.length}/${handles.length}`, newUserIds.length < handles.length ? 'warn' : 'ok');

  onLog('Получаю текущих участников группы...');
  const currentIds = await bandGetGroupUserIds(proxyBase, effectiveAdmin, groupId, signal);
  onLog(`Текущих участников: ${currentIds.length}`, 'ok');

  if (currentIds.length) {
    onLog(`Удаляю ${currentIds.length} текущих участников...`);
    await bandDeleteGroupMembersBulk(proxyBase, effectiveAdmin, groupId, currentIds, signal);
    onLog('Участники удалены.', 'ok');
  }

  if (newUserIds.length) {
    onLog(`Добавляю ${newUserIds.length} дежурных в группу...`);
    await bandAddGroupMembers(proxyBase, effectiveAdmin, groupId, newUserIds, signal);
    onLog(`Группа ${label} обновлена.`, 'ok');
  } else {
    onLog(`Нет ID для добавления в группу ${label}.`, 'warn');
  }
}

// ─── DEPLOY LAB ────────────────────────────────────────────────

function normalizeDeployLabVersion(version: string): string {
  const raw = String(version || '').trim();
  const match = raw.match(/^(\d+)\.(\d+)\.(\d{1,4})$/);
  if (!match) return raw.replace(/\D+/g, '.').replace(/^\.+|\.+$/g, '');

  const major = String(Number(match[1]));
  const minor = String(Number(match[2]));
  const buildRaw = String(match[3] || '').trim();
  if (buildRaw.length >= 4) return `${major}.${minor}.${buildRaw.padStart(4, '0')}`;

  const buildNum = Number(buildRaw);
  if (!Number.isFinite(buildNum)) return raw;
  const buildNorm = String(buildNum * Math.pow(10, 4 - buildRaw.length)).padStart(4, '0');
  return `${major}.${minor}.${buildNorm}`;
}

function buildDeployLabReleaseId(platform: 'ios' | 'android', version: string): string {
  const platformUp = platform === 'ios' ? 'IOS' : 'ANDROID';
  const ver = normalizeDeployLabVersion(version);
  return `${platformUp}_${ver}`;
}

function buildDeployLabHeaders(token: string): Record<string, string> {
  const raw = String(token || '').trim().replace(/^Bearer\s+/i, '').replace(/^authorization-deploy-lab\s*:\s*/i, '').trim();
  return {
    accept: '*/*',
    'accept-language': 'ru-RU,ru;q=0.9',
    'X-Releaseboss-Readonly-Token': raw,
    origin: 'https://deploy-lab.wb.ru',
    referer: 'https://deploy-lab.wb.ru/',
    'X-Proxy-Cookie': '',
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function unwrapDeployLabPayload(payload: unknown): unknown {
  let node = payload;
  for (let i = 0; i < 4; i += 1) {
    if (Array.isArray(node)) return node;
    if (node && typeof node === 'object' && Array.isArray((node as Record<string, unknown>).components)) return node;

    if (node && typeof node === 'object' && (node as Record<string, unknown>).body !== undefined) {
      const body = (node as Record<string, unknown>).body;
      if (typeof body === 'string') {
        const parsed = safeParseJson(body);
        if (parsed !== null) { node = parsed; continue; }
      } else if (body && typeof body === 'object') {
        node = body;
        continue;
      }
    }

    if (node && typeof node === 'object' && (node as Record<string, unknown>).data !== undefined) {
      const data = (node as Record<string, unknown>).data;
      if (typeof data === 'string') {
        const parsed = safeParseJson(data);
        if (parsed !== null) { node = parsed; continue; }
      } else if (data && typeof data === 'object') {
        node = data;
        continue;
      }
    }

    break;
  }
  return node;
}

function extractDeployLabComponents(payload: unknown): string[] {
  let node: unknown = payload;
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(node)) break;
    if (node && typeof node === 'object') {
      const n = node as Record<string, unknown>;
      if (Array.isArray(n.components)) { node = n.components; break; }
      if (n.body !== undefined) { node = typeof n.body === 'string' ? (() => { try { return JSON.parse(n.body as string); } catch { return n.body; } })() : n.body; continue; }
      if (n.data !== undefined) { node = typeof n.data === 'string' ? (() => { try { return JSON.parse(n.data as string); } catch { return n.data; } })() : n.data; continue; }
    }
    break;
  }
  const list = Array.isArray(node) ? node : (Array.isArray((node as Record<string, unknown>)?.components) ? (node as Record<string, unknown>).components as unknown[] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    let name = '';
    if (typeof item === 'string') name = item.trim();
    else if (item && typeof item === 'object') {
      const it = item as Record<string, unknown>;
      name = String(it.name || it.component || '').trim();
    }
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

export async function fetchDeployLabComponents(
  platform: 'ios' | 'android', release: string, token: string, proxyBase: string, signal?: AbortSignal,
): Promise<string[]> {
  if (!token.trim()) throw new Error('Deploy Lab token не задан — заполни в Настройках.');
  const releaseId = buildDeployLabReleaseId(platform, release);
  const url = `${DEPLOY_LAB_BASE_URL}/releaseboss/admin_panel/release/${encodeURIComponent(releaseId)}/components`;
  const headers = buildDeployLabHeaders(token);
  const data = await proxyRequest<unknown>(proxyBase, 'GET', url, headers, undefined, signal);
  return extractDeployLabComponents(data);
}

// ─── RUN CREATOR API ───────────────────────────────────────────

async function findExistingLaunch(
  token: string, launchName: string, signal?: AbortSignal,
): Promise<LaunchRecord | null> {
  const filter = base64Utf8(JSON.stringify([{ id: 'name', value: String(launchName || ''), type: 'string' }]));
  const q = new URLSearchParams({
    page: '0', size: '25', search: filter,
    projectId: String(RUN_CREATOR_PROJECT_ID), preview: 'true', sort: 'createdDate,desc',
  });
  const data = await allureFetch<{ content?: Array<{ id?: number; name?: string }> }>(
    token, 'GET', `/launch?${q}`, undefined, signal,
  );
  const exact = String(launchName || '').trim();
  const found = (Array.isArray(data?.content) ? data.content : [])
    .find(item => String(item?.name || '').trim() === exact);
  if (!found?.id) return null;
  return { id: Number(found.id), name: String(found.name || ''), url: `${ALLURE_LAUNCHES_BASE}/${found.id}`, reused: true };
}

async function createTag(token: string, name: string, signal?: AbortSignal): Promise<number> {
  const data = await allureFetch<{ id?: number }>(token, 'POST', '/launch/tag', { name }, signal);
  if (!data?.id) throw new Error(`Не удалось создать тег '${name}'`);
  return Number(data.id);
}

async function runTestplan(
  token: string, tpId: number, launchName: string, tagIds: number[], signal?: AbortSignal,
): Promise<LaunchRecord> {
  const existing = await findExistingLaunch(token, launchName, signal);
  if (existing) return existing;
  const data = await allureFetch<{ id?: number; name?: string }>(
    token, 'POST', `/testplan/${tpId}/run`,
    { launchName, tags: tagIds.map(id => ({ id })) }, signal,
  );
  if (!data?.id) throw new Error(`Тест-план ${tpId} не запустился`);
  return { id: Number(data.id), name: String(data.name || launchName), url: `${ALLURE_LAUNCHES_BASE}/${data.id}`, reused: false };
}

async function syncTestplan(token: string, tpId: number, signal?: AbortSignal): Promise<void> {
  await allureFetch(token, 'POST', `/testplan/${tpId}/sync`, null, signal);
}

// ─── COLLECTION CONSTANTS ──────────────────────────────────────

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const COLLECTION_ALLURE_SYNC_URL = 'https://allure-testops.wb.ru/api/testplan/3918/sync';

const STREAM_ALIASES: Record<string, string[]> = {
  'Core': ['Core Android', 'Core iOS'],
  'C2C': ['С2С', 'С2C', 'C2С'],
  'Корзина (B2B)': ['B2B', 'Корзина B2B', 'Корзина (B2B)'],
  'Способы доставки': ['Способы доставок'],
  'ДБО Депозиты и накопления': ['Депозиты и накопления'],
  'WB Клуб': ['wb club', 'WB Club', 'ВБ Клуб', 'вб клуб'],
};

const EXCLUDED_STREAMS = [
  'WBA Автоматизаторы аналитики',
  'Релизный стрим (мигра, вшитки)',
  'Релизный стрим (мигра, вшитки,сват)',
  'Релизный стрим (мигра, вшитки, сват)',
];

const FINTECH_PREFIX_RE = /^\[Финтех\]\s*/i;
const PLATFORM_SEP = '(?:\\s*[-—:–.]+\\s*|\\s+)*';
const DUTY_WORD = 'Дежурн[\\p{L}\\p{N}_]*';
const DUTY_PERSON_CAPTURE = '(?:[^@\\n\\r,;]*?)@([^\\n\\r,;]+?)(?=\\s*(?:[\\n\\r,;]|$))';
const RE_BLOCK_QUOTED = new RegExp(`${DUTY_WORD}\\s*"([^"]+)"([\\s\\S]*?)(?=${DUTY_WORD}\\s*"|$)`, 'giu');
const RE_BLOCK_OT = new RegExp(`${DUTY_WORD}\\s+от\\s+([^\\n\\r"]+)\\s*([\\s\\S]*?)(?=${DUTY_WORD}|$)`, 'giu');
const RE_BLOCK_HEADER = new RegExp(`${DUTY_WORD}\\s+(?!от\\b)([^\\n\\r"@]+?)\\s*[\\r\\n]+([\\s\\S]*?)(?=${DUTY_WORD}|$)`, 'giu');
const RE_INLINE_FREE = new RegExp(`${DUTY_WORD}\\s+([^\\n\\r"@]+?)` + PLATFORM_SEP + DUTY_PERSON_CAPTURE, 'giu');
const RE_ANDROID = new RegExp('\\b(?:Android|andr)\\b' + PLATFORM_SEP + DUTY_PERSON_CAPTURE, 'iu');
const RE_IOS = new RegExp('\\bios\\b' + PLATFORM_SEP + DUTY_PERSON_CAPTURE, 'iu');

export function hasCollectionPingMessage(messages: string[]): boolean {
  const list = Array.isArray(messages) ? messages : [];
  return list.some(message => {
    const text = normStr(String(message || ''));
    return Boolean(
      text
        && text.includes('привет, просьба указать дежурных на ближайший релиз')
        && text.includes('дежурный "название_стрима"'),
    );
  });
}

// ─── COLLECTION TYPES ──────────────────────────────────────────

export interface CollectionRow {
  stream: string;
  streamDisplay: string;
  iosDuty: string;
  androidDuty: string;
  iosLeads: string[];
  androidLeads: string[];
  requireIos: boolean;
  requireAndroid: boolean;
  missing: boolean;
  postId?: string;
  iosPostId?: string;
  androidPostId?: string;
}

export interface CollectionResult {
  rows: CollectionRow[];
  pingText: string;
  sinceMs: number;
  messages: string[];
  pingFound: boolean;
}

export interface CollectionIdMaps {
  ios: Record<string, string>;
  android: Record<string, string>;
}

export interface CollectionWorkflowStepDef {
  code: string;
  title: string;
  action: 'publishPing' | 'publishMissing' | 'findIds' | 'clearGroups' | 'addGroups';
}

interface CollectionDutyMeta {
  post_id: string;
  Android_post_id: string;
  iOS_post_id: string;
  create_at: number;
}

interface CollectionDutyParseRow {
  Android: string;
  iOS: string;
  _meta: CollectionDutyMeta;
}

export const COLLECTION_WORKFLOW_STEPS: CollectionWorkflowStepDef[] = [
  { code: 'Шаг 1', title: 'Опубликовать в чат просьбу указать дежурных', action: 'publishPing' },
  { code: 'Шаг 2', title: 'Опубликовать в чат недостающих дежурных', action: 'publishMissing' },
  { code: 'Шаг 3', title: 'Запросить user_id новых дежурных', action: 'findIds' },
  { code: 'Шаг 4', title: 'Удалить старых дежурных из групп', action: 'clearGroups' },
  { code: 'Шаг 5', title: 'Добавить новых дежурных в группы', action: 'addGroups' },
];

export interface DutyEditorAllureLeaf {
  id: number | null;
  name: string;
}

export interface DutyEditorLeadEntry {
  name: string;
  values: string[];
  allureLeafId?: number | null;
}

export interface DutyEditorStreamGroupEntry {
  name: string;
  streams: string[];
}

export interface DutyEditorData {
  leadsEntries: DutyEditorLeadEntry[];
  streamEntries: DutyEditorStreamGroupEntry[];
  tables: unknown[];
  meta: Record<string, unknown>;
  allureLeaves: DutyEditorAllureLeaf[];
}

export const DUTY_EDITOR_ALLURE_TREE_ID = 406;
export const DUTY_EDITOR_ALLURE_SEARCH = 'W3siaWQiOiJjZnYuLTIiLCJ0eXBlIjoibG9uZ0FycmF5IiwidmFsdWUiOls3MDExOV19XQ%3D%3D';
export const QA_LEADS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPTT8Gc8rQLKV7tIrtwsUQd_ciUOkESbS7WoQ3JfPEoBtxB0gr6GpOs640uBIaPTCy8A/exec';
export const DUTY_EDITOR_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby305NTQLS73Dw9CyG_QKkRMMljub5wkkdIlBpvHDuR6S9SntfPLTkR4jiq6uHXwHkoMg/exec';
export const DUTY_EDITOR_DOC_URL = 'https://docs.google.com/document/d/1glaEFkdpAzGuRyQZYz1muBzVkFOnKyn85BW-CXLFSFU/edit?tab=t.0';
export const DUTY_EDITOR_JSON_URL = 'https://drive.google.com/file/d/1Arzm2ZEix5aVyp0lqAFeZxLnDnkfkkUb/view?usp=sharing';
const DUTY_EDITOR_ALLURE_STREAMS_URL = `https://allure-testops.wb.ru/api/testcasetree/leaf?projectId=7&treeId=${DUTY_EDITOR_ALLURE_TREE_ID}&path=7904&path=70119&search=${DUTY_EDITOR_ALLURE_SEARCH}&sort=name%2Casc&size=100`;
const DUTY_EDITOR_ALLURE_CREATE_URL = `https://allure-testops.wb.ru/api/testcasetree/leaf?projectId=7&treeId=${DUTY_EDITOR_ALLURE_TREE_ID}&path=7904&path=70119`;
const DUTY_EDITOR_ALLURE_RENAME_URL = `https://allure-testops.wb.ru/api/testcasetree/leaf/rename?projectId=7&treeId=${DUTY_EDITOR_ALLURE_TREE_ID}&search=${DUTY_EDITOR_ALLURE_SEARCH}`;
const DUTY_EDITOR_ALLURE_TESTCASE_BASE_URL = 'https://allure-testops.wb.ru/api/testcase';
const DUTY_EDITOR_ALLURE_TAG_ID = 25;
const DUTY_EDITOR_ALLURE_STATUS_ID = -3;
const DUTY_EDITOR_ALLURE_WORKFLOW_ID = 1;

// ─── COLLECTION HELPERS ────────────────────────────────────────

function normStr(s: string): string {
  return String(s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function normLooseStr(s: string): string {
  return String(s || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[«»"""'`]/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toHandle(value: string): string {
  let v = String(value || '').trim().replace(/^@+/, '').trim();
  if (!v) return '';
  const nextMentionIdx = v.indexOf('@');
  if (nextMentionIdx >= 0) v = v.slice(0, nextMentionIdx).trim();
  v = v
    .replace(/\s*[\(\[][^\)\]]*$/u, '')
    .replace(/\s+(?:на\s+выходн(?:ые|ых)?|с\s+\d|до\s+\d|временно|замена|резерв|backup)(?:\s|$).*$/iu, '')
    .replace(/[\s/\\|,;:–—-]+$/u, '')
    .trim();
  return v ? '@' + v : '';
}

function normalizeStringList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return [...new Set(input.map(item => String(item || '').trim()).filter(Boolean))];
  }
  if (typeof input === 'string') {
    return [...new Set(
      input
        .split(/[,\n;]/)
        .map(item => item.trim())
        .filter(Boolean),
    )];
  }
  return [];
}

function normalizeLeadsData(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string[]> = {};
  for (const [handleRaw, value] of Object.entries(input as Record<string, unknown>)) {
    const handle = toHandle(handleRaw);
    const streams = normalizeStringList(value);
    if (handle && streams.length) out[handle] = streams;
  }
  return out;
}

function normalizeStreamGroupsData(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string[]> = {};
  for (const [groupName, value] of Object.entries(input as Record<string, unknown>)) {
    const name = String(groupName || '').trim();
    const streams = normalizeStringList(value);
    if (name && streams.length) out[name] = streams;
  }
  return out;
}

function normalizeDutyEditorAllureLeaves(input: unknown): DutyEditorAllureLeaf[] {
  const out: DutyEditorAllureLeaf[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(input) ? input : normalizeStringList(input)) {
    const raw: Record<string, unknown> = item && typeof item === 'object' ? item as Record<string, unknown> : { name: item };
    const idValue = Number(raw.id);
    const id = Number.isFinite(idValue) && idValue > 0 ? idValue : null;
    const name = String(raw.name || '').trim();
    if (!name) continue;
    const key = `${id || 0}::${normStr(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name });
  }
  return out;
}

function dutyEditorAllureNames(leaves: DutyEditorAllureLeaf[]): string[] {
  return normalizeDutyEditorAllureLeaves(leaves).map(leaf => leaf.name).filter(Boolean);
}

function mergeLeadMaps(...sources: Array<Record<string, string[]> | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const source of sources) {
    for (const [leadRaw, streamsRaw] of Object.entries(source || {})) {
      const lead = toHandle(leadRaw);
      if (!lead) continue;
      if (!Array.isArray(out[lead])) out[lead] = [];
      for (const streamRaw of Array.isArray(streamsRaw) ? streamsRaw : []) {
        const stream = String(streamRaw || '').trim();
        if (stream && !out[lead].includes(stream)) out[lead].push(stream);
      }
    }
  }
  return normalizeLeadsData(out);
}

function makeDutyEditorLeadEntry(name: string, values: string[], allureLeafId?: number | null): DutyEditorLeadEntry {
  const id = Number(allureLeafId);
  return {
    name: String(name || '').trim(),
    values: Array.isArray(values) ? values.map(item => String(item || '').trim()) : [],
    allureLeafId: Number.isFinite(id) && id > 0 ? id : null,
  };
}

function isDutyEditorCoreEntry(entry: DutyEditorLeadEntry): boolean {
  return normStr(entry?.name || '') === normStr('Core');
}

function buildDutyEditorLeadModel(
  leads: Record<string, string[]>,
  allureLeaves: DutyEditorAllureLeaf[],
): { entries: DutyEditorLeadEntry[]; hiddenLeadAssignments: Record<string, string[]> } {
  const normalizedLeads = normalizeLeadsData(leads);
  const leaves = normalizeDutyEditorAllureLeaves(allureLeaves);
  const streamNames = leaves.map(leaf => leaf.name).filter(Boolean);

  if (!streamNames.length) {
    const entries: DutyEditorLeadEntry[] = [];
    for (const [lead, streams] of Object.entries(normalizedLeads)) {
      const streamList = Array.isArray(streams) ? streams : [];
      if (!streamList.length) {
        entries.push(makeDutyEditorLeadEntry('', [lead]));
        continue;
      }
      for (const stream of streamList) entries.push(makeDutyEditorLeadEntry(stream, [lead]));
    }
    return { entries, hiddenLeadAssignments: {} };
  }

  const aliases = buildHardcodedAliases();
  const streamNorm2Canonical = buildStreamNorm2Canonical(streamNames, aliases);
  const visibleStreamNorms = new Set(streamNames.map(stream => normStr(stream)));
  const hasSharedCoreLeaf = leaves.some(leaf => normStr(leaf.name) === normStr('Core'));
  const hasPlatformCoreLeaves = leaves.some(leaf => {
    const n = normStr(leaf.name);
    return n === normStr('Core iOS') || n === normStr('Core Android');
  });
  const useSharedCoreLeaf = hasSharedCoreLeaf && !hasPlatformCoreLeaves;
  const visibleByNorm = new Map<string, string>();
  const visibleByLooseNorm = new Map<string, string>();
  for (const streamName of streamNames) {
    const n = normStr(streamName);
    if (n && !visibleByNorm.has(n)) visibleByNorm.set(n, streamName);
    const loose = normLooseStr(streamName);
    if (loose && !visibleByLooseNorm.has(loose)) visibleByLooseNorm.set(loose, streamName);
  }

  const leadByVisibleStreamNorm = new Map<string, string>();
  const hiddenLeadAssignments: Record<string, string[]> = {};
  let coreIosLead = '';
  let coreAndroidLead = '';

  for (const [leadRaw, streamsRaw] of Object.entries(normalizedLeads)) {
    const lead = toHandle(leadRaw);
    if (!lead) continue;
    for (const streamRaw of Array.isArray(streamsRaw) ? streamsRaw : []) {
      const stream = String(streamRaw || '').trim();
      if (!stream) continue;
      const streamNorm = normStr(stream);
      const streamLoose = normLooseStr(stream);

      if (useSharedCoreLeaf && streamNorm === normStr('Core iOS')) {
        if (!coreIosLead) {
          coreIosLead = lead;
        } else {
          if (!Array.isArray(hiddenLeadAssignments[lead])) hiddenLeadAssignments[lead] = [];
          if (!hiddenLeadAssignments[lead].includes(stream)) hiddenLeadAssignments[lead].push(stream);
        }
        continue;
      }

      if (useSharedCoreLeaf && streamNorm === normStr('Core Android')) {
        if (!coreAndroidLead) {
          coreAndroidLead = lead;
        } else {
          if (!Array.isArray(hiddenLeadAssignments[lead])) hiddenLeadAssignments[lead] = [];
          if (!hiddenLeadAssignments[lead].includes(stream)) hiddenLeadAssignments[lead].push(stream);
        }
        continue;
      }

      const canonical = visibleByNorm.get(streamNorm)
        || visibleByLooseNorm.get(streamLoose)
        || streamNorm2Canonical[streamNorm]
        || streamNorm2Canonical[streamLoose]
        || '';
      const canonicalNorm = canonical ? normStr(canonical) : '';

      if (canonical && visibleStreamNorms.has(canonicalNorm) && !leadByVisibleStreamNorm.has(canonicalNorm)) {
        leadByVisibleStreamNorm.set(canonicalNorm, lead);
        continue;
      }

      if (!Array.isArray(hiddenLeadAssignments[lead])) hiddenLeadAssignments[lead] = [];
      if (!hiddenLeadAssignments[lead].includes(stream)) hiddenLeadAssignments[lead].push(stream);
    }
  }

  const entries = leaves.map(leaf => {
    if (useSharedCoreLeaf && normStr(leaf.name) === normStr('Core')) {
      return makeDutyEditorLeadEntry(leaf.name, [coreIosLead, coreAndroidLead], leaf.id);
    }
    return makeDutyEditorLeadEntry(leaf.name, [leadByVisibleStreamNorm.get(normStr(leaf.name)) || ''], leaf.id);
  });
  return { entries, hiddenLeadAssignments: normalizeLeadsData(hiddenLeadAssignments) };
}

function mapToStreamEntries(streamsTree: Record<string, string[]>): DutyEditorStreamGroupEntry[] {
  return Object.entries(streamsTree)
    .map(([name, streams]) => ({ name, streams: [...streams] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function entriesToLeadMap(entries: DutyEditorLeadEntry[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seenStreams = new Set<string>();
  for (const entry of entries) {
    const streamName = String(entry?.name || '').trim();
    if (!streamName) throw new Error('Заполни название стрима');
    const values = Array.isArray(entry?.values)
      ? entry.values.map(item => String(item || '').trim())
      : normalizeStringList(entry?.values || []);
    const fields = isDutyEditorCoreEntry(entry)
      ? [
          { streamName: 'Core iOS', lead: String(values[0] || '').trim() },
          { streamName: 'Core Android', lead: String(values[1] || '').trim() },
        ]
      : [{ streamName, lead: String(values[0] || '').trim() }];

    for (const field of fields) {
      const lead = toHandle(field.lead);
      if (!lead) {
        if (isDutyEditorCoreEntry(entry)) throw new Error('Заполни лидов iOS и Android для стрима "Core"');
        throw new Error(`Заполни лида для стрима "${streamName}"`);
      }
      const streamKey = normStr(field.streamName);
      if (seenStreams.has(streamKey)) throw new Error(`Повторяющееся название стрима: ${field.streamName}`);
      seenStreams.add(streamKey);
      if (!Array.isArray(out[lead])) out[lead] = [];
      out[lead].push(field.streamName);
    }
  }
  return normalizeLeadsData(out);
}

function entriesToStreamMap(entries: DutyEditorStreamGroupEntry[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    const streams = normalizeStringList(entry?.streams || []);
    if (name && streams.length) out[name] = streams;
  }
  return out;
}

function normalizeDutyEditorResponse(payload: unknown): {
  leads: Record<string, string[]>;
  streamsTree: Record<string, string[]>;
  tables: unknown[];
  meta: Record<string, unknown>;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Apps Script вернул пустой ответ для редактора');
  }
  const raw = payload as Record<string, unknown>;
  if (raw.ok === false) {
    throw new Error(String(raw.error || 'Apps Script вернул ошибку'));
  }
  const root = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : raw;
  const leadsRaw = root.leads || root.qaLeads || root.leadsJson;
  const streamsRaw = root.streamsTree || root.streamGroups || root.streams;
  const tablesRaw = root.tables || root.docTables || [];
  if (!leadsRaw || !streamsRaw) {
    throw new Error('Ответ Apps Script не содержит обязательные поля leads и streamsTree');
  }
  return {
    leads: normalizeLeadsData(leadsRaw),
    streamsTree: normalizeStreamGroupsData(streamsRaw),
    tables: Array.isArray(tablesRaw) ? [...tablesRaw] : [],
    meta: root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta)
      ? { ...(root.meta as Record<string, unknown>) }
      : {},
  };
}

export function buildSinceWindow(): { sinceMs: number; baseUtcDate: Date } {
  const nowPseudoMsk = new Date(Date.now() + MSK_OFFSET_MS);
  const dow = nowPseudoMsk.getUTCDay();
  const daysBack = (dow + 7 - 3) % 7;
  const y = nowPseudoMsk.getUTCFullYear();
  const m = nowPseudoMsk.getUTCMonth();
  const d = nowPseudoMsk.getUTCDate() - daysBack;
  const baseMskMs = Date.UTC(y, m, d, 0, 0, 0, 0);
  const sinceMs = baseMskMs - MSK_OFFSET_MS;
  return { sinceMs, baseUtcDate: new Date(sinceMs) };
}

function displayStreamName(streamName: string): string {
  return String(streamName || '').replace(FINTECH_PREFIX_RE, '').trim();
}

function buildHardcodedAliases(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(STREAM_ALIASES)) {
    const kk = key.trim();
    if (kk && Array.isArray(val)) out[kk] = val.map(x => String(x || '').trim()).filter(Boolean);
  }
  return out;
}

function buildHardcodedExcludeSet(): Set<string> {
  return new Set(EXCLUDED_STREAMS.map(x => normStr(x)));
}

function buildStreamNorm2Canonical(allStreams: string[], streamAliases: Record<string, string[]>): Record<string, string> {
  const norm2orig: Record<string, string> = {};
  for (const stream of allStreams) {
    const full = normStr(stream);
    if (full) norm2orig[full] = stream;
    const fullLoose = normLooseStr(stream);
    if (fullLoose && !norm2orig[fullLoose]) norm2orig[fullLoose] = stream;
    const short = normStr(displayStreamName(stream));
    if (short && !norm2orig[short]) norm2orig[short] = stream;
    const shortLoose = normLooseStr(displayStreamName(stream));
    if (shortLoose && !norm2orig[shortLoose]) norm2orig[shortLoose] = stream;
  }
  const out = { ...norm2orig };
  for (const [canonical, aliases] of Object.entries(streamAliases || {})) {
    let canonicalReal = '';
    const canonicalNorm = normStr(canonical);
    if (norm2orig[canonicalNorm]) {
      canonicalReal = norm2orig[canonicalNorm];
    } else {
      for (const alias of aliases ?? []) {
        const an = normStr(alias);
        if (norm2orig[an]) { canonicalReal = norm2orig[an]; break; }
      }
    }
    if (!canonicalReal) continue;
    if (canonicalNorm) out[canonicalNorm] = canonicalReal;
    const cLoose = normLooseStr(canonical);
    if (cLoose) out[cLoose] = canonicalReal;
    out[normStr(canonicalReal)] = canonicalReal;
    const crLoose = normLooseStr(canonicalReal);
    if (crLoose) out[crLoose] = canonicalReal;
    for (const alias of aliases ?? []) {
      const an = normStr(alias);
      if (an) out[an] = canonicalReal;
      const al = normLooseStr(alias);
      if (al) out[al] = canonicalReal;
    }
  }
  return out;
}

function matchStream(rawName: string, streamNorm2Canonical: Record<string, string>): string {
  const cleaned = String(rawName || '')
    .replace(/^[«"'\s]+|[»"'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const kn = normStr(cleaned);
  if (streamNorm2Canonical[kn]) return streamNorm2Canonical[kn];
  const kl = normLooseStr(cleaned);
  if (kl && streamNorm2Canonical[kl]) return streamNorm2Canonical[kl];
  let best = '';
  let bestLen = -1;
  for (const [aliasNorm, canonical] of Object.entries(streamNorm2Canonical)) {
    if (!aliasNorm) continue;
    const strictHit = kn && (kn.includes(aliasNorm) || aliasNorm.includes(kn));
    const looseHit = kl && (kl.includes(aliasNorm) || aliasNorm.includes(kl));
    if (!strictHit && !looseHit) continue;
    if (aliasNorm.length > bestLen) { best = canonical; bestLen = aliasNorm.length; }
  }
  return best || '';
}

interface LeadIndex {
  leadByStreamNorm: Map<string, Set<string>>;
  coreAndroid: Set<string>;
  coreIos: Set<string>;
}

function buildLeadIndex(leads: Record<string, string[]>, streamNorm2Canonical: Record<string, string>): LeadIndex {
  const leadByStreamNorm = new Map<string, Set<string>>();
  const coreAndroid = new Set<string>();
  const coreIos = new Set<string>();
  for (const [handleRaw, streams] of Object.entries(leads || {})) {
    let handle = String(handleRaw || '').trim();
    if (!handle) continue;
    if (!handle.startsWith('@')) handle = '@' + handle;
    for (const streamRaw of (Array.isArray(streams) ? streams : [])) {
      const stream = String(streamRaw || '').trim();
      if (!stream) continue;
      const nrm = normStr(stream);
      if (nrm === normStr('Core Android')) { coreAndroid.add(handle); continue; }
      if (nrm === normStr('Core iOS')) { coreIos.add(handle); continue; }
      const canonical = streamNorm2Canonical[nrm] || stream;
      const key = normStr(canonical);
      if (!leadByStreamNorm.has(key)) leadByStreamNorm.set(key, new Set());
      leadByStreamNorm.get(key)!.add(handle);
    }
  }
  return { leadByStreamNorm, coreAndroid, coreIos };
}

function leadsForStream(streamCanonical: string, platform: 'iOS' | 'Android', leadIndex: LeadIndex): string[] {
  const streamNorm = normStr(streamCanonical);
  if (streamNorm === normStr('Core')) {
    const chosen = platform === 'Android' ? leadIndex.coreAndroid : leadIndex.coreIos;
    return Array.from(chosen).sort();
  }
  if (streamNorm === normStr('Core iOS')) return Array.from(leadIndex.coreIos || []).sort();
  if (streamNorm === normStr('Core Android')) return Array.from(leadIndex.coreAndroid || []).sort();
  const values = leadIndex.leadByStreamNorm.get(streamNorm);
  return values ? Array.from(values).sort() : [];
}

function parseDuties(
  postsOrMessages: Array<BandPost | string>,
  allStreams: string[],
  streamAliases: Record<string, string[]>,
): { duties: Record<string, CollectionDutyParseRow> } {
  const duties: Record<string, CollectionDutyParseRow> = {};
  const streamNorm2Canonical = buildStreamNorm2Canonical(allStreams, streamAliases);

  const ensureRow = (streamName: string) => {
    if (!duties[streamName]) {
      duties[streamName] = {
        Android: '',
        iOS: '',
        _meta: {
          post_id: '',
          Android_post_id: '',
          iOS_post_id: '',
          create_at: -1,
        },
      };
    }
    return duties[streamName];
  };

  const touchPostMeta = (row: CollectionDutyParseRow, postId: string, createdAt: number) => {
    if (!postId) return;
    const created = Number(createdAt);
    const current = Number(row._meta.create_at);
    if (created >= (Number.isFinite(current) ? current : -1)) {
      row._meta.create_at = Number.isFinite(created) ? created : -1;
      row._meta.post_id = postId;
    }
  };

  const entries = (Array.isArray(postsOrMessages) ? postsOrMessages : [])
    .map(item => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const message = typeof item.message === 'string' ? item.message : '';
        if (!message.trim()) return null;
        return {
          message,
          postId: String(item.id || '').trim(),
          createdAt: Number(item.create_at) || 0,
        };
      }
      const message = String(item || '').trim();
      return message ? { message, postId: '', createdAt: 0 } : null;
    })
    .filter((entry): entry is { message: string; postId: string; createdAt: number } => Boolean(entry));

  for (const entry of entries) {
    const msg = entry.message;
    for (const m of msg.matchAll(RE_BLOCK_QUOTED)) {
      const streamRaw = String(m[1] || '').trim();
      const body = String(m[2] || '');
      const streamName = matchStream(streamRaw, streamNorm2Canonical);
      if (!streamName) continue;
      const row = ensureRow(streamName);
      const ma = body.match(RE_ANDROID);
      const mi = body.match(RE_IOS);
      if (ma) {
        row.Android = toHandle(ma[1]);
        if (entry.postId) row._meta.Android_post_id = entry.postId;
      }
      if (mi) {
        row.iOS = toHandle(mi[1]);
        if (entry.postId) row._meta.iOS_post_id = entry.postId;
      }
      touchPostMeta(row, entry.postId, entry.createdAt);
    }
  }

  for (const entry of entries) {
    const msg = entry.message;
    for (const m of msg.matchAll(RE_BLOCK_OT)) {
      const streamRaw = String(m[1] || '').trim();
      const body = String(m[2] || '');
      const streamName = matchStream(streamRaw, streamNorm2Canonical);
      if (!streamName) continue;
      const row = ensureRow(streamName);
      const ma = body.match(RE_ANDROID);
      const mi = body.match(RE_IOS);
      if (ma && !row.Android) {
        row.Android = toHandle(ma[1]);
        if (entry.postId) row._meta.Android_post_id = entry.postId;
      }
      if (mi && !row.iOS) {
        row.iOS = toHandle(mi[1]);
        if (entry.postId) row._meta.iOS_post_id = entry.postId;
      }
      touchPostMeta(row, entry.postId, entry.createdAt);
    }
  }

  for (const entry of entries) {
    const msg = entry.message;
    for (const m of msg.matchAll(RE_BLOCK_HEADER)) {
      const header = String(m[1] || '').trim();
      const body = String(m[2] || '');
      const streamName = matchStream(header, streamNorm2Canonical);
      if (!streamName) continue;
      const row = ensureRow(streamName);
      const ma = body.match(RE_ANDROID);
      const mi = body.match(RE_IOS);
      if (ma && !row.Android) {
        row.Android = toHandle(ma[1]);
        if (entry.postId) row._meta.Android_post_id = entry.postId;
      }
      if (mi && !row.iOS) {
        row.iOS = toHandle(mi[1]);
        if (entry.postId) row._meta.iOS_post_id = entry.postId;
      }
      touchPostMeta(row, entry.postId, entry.createdAt);
    }
  }

  for (const entry of entries) {
    const msg = entry.message;
    for (const m of msg.matchAll(RE_INLINE_FREE)) {
      const rawName = String(m[1] || '').replace(/\s+/g, ' ').trim();
      const person = toHandle(m[2]);
      if (!rawName || !person) continue;
      const tokens = rawName.split(/\s+/).filter(Boolean);
      let platform = '';
      let baseStream = rawName;
      if (tokens.length) {
        const last = normStr(tokens[tokens.length - 1]);
        if (last === 'android' || last === 'andr' || last === 'ios') {
          platform = (last === 'ios') ? 'iOS' : 'Android';
          baseStream = tokens.slice(0, -1).join(' ').trim();
        }
      }
      const streamName = matchStream(baseStream, streamNorm2Canonical);
      if (!streamName) continue;
      const row = ensureRow(streamName);
      if (platform) {
        if (platform === 'iOS') {
          row.iOS = person;
          if (entry.postId) row._meta.iOS_post_id = entry.postId;
        } else {
          row.Android = person;
          if (entry.postId) row._meta.Android_post_id = entry.postId;
        }
      }
      touchPostMeta(row, entry.postId, entry.createdAt);
    }
  }

  return { duties };
}

function requiredPlatformsForStream(streamName: string): { requireIos: boolean; requireAndroid: boolean } {
  const title = normStr(displayStreamName(streamName));
  const hasCore = title.includes('core');
  const hasIos = title.includes('ios') || title.includes('айос');
  const hasAndroid = title.includes('android') || title.includes('andr') || title.includes('андроид');
  if (hasCore && hasIos && !hasAndroid) return { requireIos: true, requireAndroid: false };
  if (hasCore && hasAndroid && !hasIos) return { requireIos: false, requireAndroid: true };
  return { requireIos: true, requireAndroid: true };
}

function buildCollectionRows(
  allStreams: string[],
  duties: Record<string, CollectionDutyParseRow>,
  leadIndex: LeadIndex,
  excludeSet: Set<string>,
): CollectionRow[] {
  const rows: CollectionRow[] = [];
  for (const stream of allStreams) {
    if (excludeSet.has(normStr(stream))) continue;
    const row = duties[stream] || {};
    const iosDuty = String(row.iOS || '').trim();
    const androidDuty = String(row.Android || '').trim();
    const iosLeads = leadsForStream(stream, 'iOS', leadIndex);
    const androidLeads = leadsForStream(stream, 'Android', leadIndex);
    const req = requiredPlatformsForStream(stream);
    const missing = (req.requireIos && !iosDuty) || (req.requireAndroid && !androidDuty);
    const meta = row._meta || { post_id: '', Android_post_id: '', iOS_post_id: '', create_at: -1 };
    rows.push({
      stream,
      streamDisplay: displayStreamName(stream),
      iosDuty,
      androidDuty,
      iosLeads,
      androidLeads,
      requireIos: req.requireIos,
      requireAndroid: req.requireAndroid,
      missing,
      postId: meta.post_id || '',
      iosPostId: meta.iOS_post_id || meta.post_id || '',
      androidPostId: meta.Android_post_id || meta.post_id || '',
    });
  }
  return rows;
}

export function buildPingRequestMessageForMissing(rows: CollectionRow[]): string {
  const missingRows = rows.filter(r => r.missing);
  if (!missingRows.length) return '';
  const lines: string[] = [];
  for (const row of missingRows) {
    const leadsOrdered: string[] = [];
    if (row.requireIos && !row.iosDuty) {
      for (const h of row.iosLeads) { if (!leadsOrdered.includes(h)) leadsOrdered.push(h); }
    }
    if (row.requireAndroid && !row.androidDuty) {
      for (const h of row.androidLeads) { if (!leadsOrdered.includes(h)) leadsOrdered.push(h); }
    }
    lines.push(`${row.streamDisplay} - ${leadsOrdered.join(' ')}`.trim());
  }
  const header = [
    'Привет, просьба указать дежурных на ближайший релиз отдельным тредом по шаблону',
    'Дежурный "Название_стрима"',
    'iOS - @дежурный',
    'Android - @дежурный',
  ].join('\n');
  const footer = '\n\nЕсли дежурных будет лид, тред создадим сами, можно самостоятельно его не присылать';
  return `${header}\n\n${lines.join('\n')}${footer}`;
}

const BAND_THREAD_URL_BASE = 'https://band.wb.ru/mobile-team/pl/';

function normThread(value: string): string {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/[\s\-_.,;:!?'"()[\]{}/\\]+/g, '');
}

function normThreadLoose(value: string): string {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, '').replace(/[-_.,;:!?'"()[\]{}/\\]+/g, '');
}

function buildDutyThreadUrl(postId: string): string {
  const value = String(postId || '').trim();
  return value ? `${BAND_THREAD_URL_BASE}${encodeURIComponent(value)}` : '';
}

function buildDutyThreadBullet(display: string, url: string, indent: number): string {
  const prefix = '    '.repeat(Math.max(0, indent));
  const tail = url ? `[тред](${url})` : 'тред';
  return `${prefix}*   ${display} - ${tail}`;
}

export function buildCurrentDutyThreadsCopyText(
  rows: CollectionRow[],
  streamGroups: DutyEditorStreamGroupEntry[],
): string {
  const streamList = (Array.isArray(rows) ? rows : [])
    .map(r => String(r.streamDisplay || r.stream || '').trim())
    .filter(Boolean);

  const rowByNorm: Record<string, CollectionRow> = {};
  const rowByLoose: Record<string, CollectionRow> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const name of [row.streamDisplay, row.stream]) {
      const value = String(name || '').trim();
      if (!value) continue;
      const n = normThread(value);
      const l = normThreadLoose(value);
      if (n && !rowByNorm[n]) rowByNorm[n] = row;
      if (l && !rowByLoose[l]) rowByLoose[l] = row;
    }
  }

  const groupingMap: Record<string, string[]> = {};
  for (const g of streamGroups) {
    if (g.name) groupingMap[g.name] = g.streams;
  }

  const excludedItems: string[] = Array.isArray(groupingMap['Excluded']) ? groupingMap['Excluded'] : [];
  const excludedNorm = new Set(excludedItems.map(normThread).filter(Boolean));
  const excludedLoose = new Set(excludedItems.map(normThreadLoose).filter(Boolean));
  const isExcluded = (name: string) => {
    const v = String(name || '').trim();
    return excludedNorm.has(normThread(v)) || excludedLoose.has(normThreadLoose(v));
  };

  const filteredStreams = streamList.filter(s => !isExcluded(s));
  const byNorm: Record<string, string> = {};
  const byLoose: Record<string, string> = {};
  for (const s of filteredStreams) {
    const n = normThread(s); const l = normThreadLoose(s);
    if (n) byNorm[n] = s;
    if (l && !byLoose[l]) byLoose[l] = s;
  }
  const resolveStream = (name: string) => byNorm[normThread(name)] || byLoose[normThreadLoose(name)] || '';

  const resolveRow = (streamName: string): CollectionRow | undefined =>
    rowByNorm[normThread(streamName)] || rowByLoose[normThreadLoose(streamName)];

  const dutyUrl = (streamName: string, platform: string): string => {
    const row = resolveRow(streamName);
    if (!row) return '';
    const normalizedPlatform = normThread(platform);
    const postId = normalizedPlatform === 'ios'
      ? (row.iosPostId || row.postId || row.androidPostId || '')
      : normalizedPlatform === 'android'
        ? (row.androidPostId || row.postId || row.iosPostId || '')
        : (row.postId || row.iosPostId || row.androidPostId || '');
    return buildDutyThreadUrl(postId);
  };

  const lines: string[] = [];
  const covered = new Set<string>();
  let firstGroup = true;

  for (const [groupNameRaw, items] of Object.entries(groupingMap)) {
    const groupName = String(groupNameRaw || '').trim();
    if (!groupName || groupName === 'Excluded') continue;
    if (!firstGroup) lines.push('');
    firstGroup = false;
    lines.push(`*   ${groupName}:`);
    for (const itemRaw of items) {
      const item = String(itemRaw || '').trim();
      if (!item || isExcluded(item)) continue;
      const itemNorm = normThread(item);
      if (itemNorm === 'android' || itemNorm === 'ios') {
        const baseStream = resolveStream(groupName);
        if (baseStream && !isExcluded(baseStream)) {
          covered.add(normThread(baseStream));
          lines.push(buildDutyThreadBullet(item, dutyUrl(baseStream, item), 1));
          continue;
        }
      }
      const streamName = resolveStream(item);
      if (streamName && !isExcluded(streamName)) {
        covered.add(normThread(streamName));
        lines.push(buildDutyThreadBullet(item, dutyUrl(streamName, ''), 1));
      } else {
        lines.push(buildDutyThreadBullet(item, '', 1));
      }
    }
  }

  const leftovers = filteredStreams.filter(s => !covered.has(normThread(s)) && !isExcluded(s));
  if (leftovers.length) {
    if (lines.length) lines.push('');
    for (const s of leftovers) lines.push(buildDutyThreadBullet(s, dutyUrl(s, ''), 0));
  }

  if (!lines.length) return 'Нет данных для формирования треда (не найдены стримы в Allure или посты с дежурными в Band).';
  return lines.join('\n');
}

export function buildCurrentDutiesCopyText(rows: CollectionRow[]): string {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return '';
  const iosLines: string[] = [];
  const androidLines: string[] = [];
  for (const row of source) {
    const stream = String(row.streamDisplay || row.stream || '').trim();
    if (!stream) continue;
    iosLines.push(`${stream} ${row.iosDuty || '?'}`);
    androidLines.push(`${stream} ${row.androidDuty || '?'}`);
  }
  return ['[iOS]', ...iosLines, '', '[Android]', ...androidLines].join('\n').trim();
}

async function fetchQaLeadsFromGas(proxyBase: string, gasUrl: string, signal?: AbortSignal): Promise<Record<string, string[]>> {
  const url = String(gasUrl || '').trim() || QA_LEADS_SCRIPT_URL;
  const data = await proxyRequest<unknown>(proxyBase, 'GET', url, { Accept: 'application/json' }, undefined, signal);
  let leadsRaw: unknown = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (d.leads && typeof d.leads === 'object' && !Array.isArray(d.leads)) leadsRaw = d.leads;
    else if (d.qaLeads && typeof d.qaLeads === 'object' && !Array.isArray(d.qaLeads)) leadsRaw = d.qaLeads;
    else if (d.leadsJson && typeof d.leadsJson === 'object' && !Array.isArray(d.leadsJson)) leadsRaw = d.leadsJson;
    else if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) leadsRaw = d.data;
  }
  return normalizeLeadsData(leadsRaw);
}

async function collectDutyRowsSince(
  proxyBase: string,
  cookies: string,
  allureToken: string,
  gasUrl: string,
  sinceMs: number,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
  syncAllure = false,
): Promise<CollectionResult> {
  const sinceStr = new Date(sinceMs).toLocaleString('ru', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  onLog(`База выборки: с ${sinceStr} (МСК)`);

  if (syncAllure) {
    onLog('Шаг 1/5: синхронизирую test plan Allure...');
    try {
      await proxyRequest<unknown>(proxyBase, 'POST', COLLECTION_ALLURE_SYNC_URL, allureHeaders(allureToken), null, signal);
      onLog('Синхронизация завершена.', 'ok');
    } catch (e) {
      onLog(`Синхронизация не удалась (${e instanceof Error ? e.message : e}) — продолжаю.`, 'warn');
    }
  }

  onLog(syncAllure ? 'Шаг 2/5: загружаю список стримов из Allure...' : 'Обновляю список стримов из Allure...');
  const streams = await fetchDutyStreamNames(allureToken, signal);
  onLog(`Стримов: ${streams.length}`, 'ok');

  onLog(syncAllure ? 'Шаг 3/5: загружаю лидов QA...' : 'Обновляю лидов QA...');
  let leadsRaw: Record<string, string[]> = {};
  try {
    leadsRaw = await fetchQaLeadsFromGas(proxyBase, gasUrl, signal);
    onLog(`Лидов: ${Object.keys(leadsRaw).length}`, 'ok');
  } catch (e) {
    onLog(`Лиды не загружены (${e instanceof Error ? e.message : e}) — продолжаю без лидов.`, 'warn');
  }

  onLog(syncAllure ? 'Шаг 4/5: читаю сообщения из Band SWAT QA...' : 'Обновляю сообщения из Band SWAT QA...');
  const allPosts = await bandFetchChannelPostsSince(proxyBase, cookies, SWAT_QA_CHANNEL_ID, sinceMs, signal);
  const posts: BandPost[] = [];
  const messages: string[] = [];
  for (const post of allPosts) {
    if (Number(post.delete_at) > 0) continue;
    if (Number(post.create_at) < sinceMs) continue;
    const msg = typeof post.message === 'string' ? post.message.trim() : '';
    if (msg) {
      posts.push(post);
      messages.push(msg);
    }
  }
  posts.sort((a, b) => (Number(a.create_at) || 0) - (Number(b.create_at) || 0));
  onLog(`Сообщений: ${messages.length}`, 'ok');

  onLog(syncAllure ? 'Шаг 5/5: парсю дежурных...' : 'Обновляю разбор дежурных...');
  const aliases = buildHardcodedAliases();
  const excludeSet = buildHardcodedExcludeSet();
  const { duties } = parseDuties(posts, streams, aliases);
  const streamMap = buildStreamNorm2Canonical(streams, aliases);
  const leadIndex = buildLeadIndex(leadsRaw, streamMap);
  const rows = buildCollectionRows(streams, duties, leadIndex, excludeSet);
  const pingText = buildPingRequestMessageForMissing(rows);
  const pingFound = pingText
    ? hasCollectionPingMessage(messages)
      || messages.some(message => normBandText(message).toLowerCase() === normBandText(pingText).toLowerCase())
    : true;

  const missing = rows.filter(r => r.missing).length;
  const filled = rows.length - missing;
  onLog(`Готово: стримов=${rows.length}, найдено=${filled}, пропусков=${missing}`, missing > 0 ? 'warn' : 'ok');

  return { rows, pingText, sinceMs, messages, pingFound };
}

export async function runCollection(
  proxyBase: string,
  cookies: string,
  allureToken: string,
  gasUrl: string,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<CollectionResult> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы — укажи в Настройках.');
  const windowInfo = buildSinceWindow();
  return collectDutyRowsSince(proxyBase, cookies, allureToken, gasUrl, windowInfo.sinceMs, onLog, signal, true);
}

export async function refreshCollectionSince(
  proxyBase: string,
  cookies: string,
  gasUrl: string,
  allureToken: string,
  sinceMs: number,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<CollectionResult> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы — укажи в Настройках.');
  return collectDutyRowsSince(proxyBase, cookies, allureToken, gasUrl, sinceMs, onLog, signal, false);
}

export async function publishCollectionPing(
  proxyBase: string,
  cookies: string,
  rows: CollectionRow[],
  signal?: AbortSignal,
): Promise<void> {
  const message = buildPingRequestMessageForMissing(rows);
  if (!message) return;
  await bandPostMessage(proxyBase, cookies, message, { channelId: SWAT_QA_CHANNEL_ID }, signal);
}

export async function publishMissingDutyPosts(
  proxyBase: string,
  cookies: string,
  rows: CollectionRow[],
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<void> {
  const missingRows = rows.filter(row => row.missing);
  if (!missingRows.length) {
    onLog('Все дежурные уже собраны — публикация недостающих не нужна.', 'ok');
    return;
  }
  for (const row of missingRows) {
    const iosValue = row.iosDuty || (row.requireIos ? (row.iosLeads.length ? row.iosLeads.join(' ') : '- ?') : '—');
    const androidValue = row.androidDuty || (row.requireAndroid ? (row.androidLeads.length ? row.androidLeads.join(' ') : '- ?') : '—');
    const message = `Дежурный "${row.streamDisplay || row.stream}"\niOS - ${iosValue}\nAndroid - ${androidValue}`;
    await bandPostMessage(proxyBase, cookies, message, { channelId: SWAT_QA_CHANNEL_ID }, signal);
    onLog(`Опубликован запрос по стриму "${row.streamDisplay || row.stream}".`, 'ok');
  }
}

export async function findCollectionUserIds(
  proxyBase: string,
  cookies: string,
  rows: CollectionRow[],
  signal?: AbortSignal,
): Promise<CollectionIdMaps> {
  const iosHandles = [...new Set(rows.map(row => toHandle(row.iosDuty)).filter(Boolean))];
  const androidHandles = [...new Set(rows.map(row => toHandle(row.androidDuty)).filter(Boolean))];
  const [ios, android] = await Promise.all([
    bandSearchUserIds(proxyBase, cookies, iosHandles, signal),
    bandSearchUserIds(proxyBase, cookies, androidHandles, signal),
  ]);
  return { ios, android };
}

export async function clearBandDutyGroups(
  proxyBase: string,
  cookies: string,
  adminCookies: string,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveAdmin = adminCookies.trim() || cookies.trim();
  if (!effectiveAdmin) throw new Error('Band cookies не заданы.');
  const [iosIds, androidIds] = await Promise.all([
    bandGetGroupUserIds(proxyBase, effectiveAdmin, GROUP_IOS_ID, signal),
    bandGetGroupUserIds(proxyBase, effectiveAdmin, GROUP_ANDROID_ID, signal),
  ]);
  if (iosIds.length) {
    await bandDeleteGroupMembersBulk(proxyBase, effectiveAdmin, GROUP_IOS_ID, iosIds, signal);
    onLog(`Группа @qadutyios очищена: ${iosIds.length}`, 'ok');
  } else {
    onLog('Группа @qadutyios уже пуста.', 'ok');
  }
  if (androidIds.length) {
    await bandDeleteGroupMembersBulk(proxyBase, effectiveAdmin, GROUP_ANDROID_ID, androidIds, signal);
    onLog(`Группа @qadutyandr очищена: ${androidIds.length}`, 'ok');
  } else {
    onLog('Группа @qadutyandr уже пуста.', 'ok');
  }
}

export async function addBandDutyGroups(
  proxyBase: string,
  cookies: string,
  adminCookies: string,
  idMaps: CollectionIdMaps,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveAdmin = adminCookies.trim() || cookies.trim();
  if (!effectiveAdmin) throw new Error('Band cookies не заданы.');
  const iosIds = Object.values(idMaps.ios || {});
  const androidIds = Object.values(idMaps.android || {});
  if (iosIds.length) {
    await bandAddGroupMembers(proxyBase, effectiveAdmin, GROUP_IOS_ID, iosIds, signal);
    onLog(`В @qadutyios добавлено ${iosIds.length} дежурных.`, 'ok');
  } else {
    onLog('Нет iOS user_id для добавления в @qadutyios.', 'warn');
  }
  if (androidIds.length) {
    await bandAddGroupMembers(proxyBase, effectiveAdmin, GROUP_ANDROID_ID, androidIds, signal);
    onLog(`В @qadutyandr добавлено ${androidIds.length} дежурных.`, 'ok');
  } else {
    onLog('Нет Android user_id для добавления в @qadutyandr.', 'warn');
  }
}

// ─── DUTY STREAMS ──────────────────────────────────────────────

export async function fetchDutyStreamNames(token: string, signal?: AbortSignal): Promise<string[]> {
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

export async function fetchDutyEditorAllureStreams(
  token: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return dutyEditorAllureNames(await fetchDutyEditorAllureLeaves(token, signal));
}

export async function fetchDutyEditorAllureLeaves(
  token: string,
  signal?: AbortSignal,
): Promise<DutyEditorAllureLeaf[]> {
  if (!String(token || '').trim()) return [];
  const leaves: DutyEditorAllureLeaf[] = [];
  for (let page = 0; page < 50; page++) {
    const url = new URL(DUTY_EDITOR_ALLURE_STREAMS_URL);
    url.searchParams.set('page', String(page));
    const data = await allureFetchUrl<{
      content?: Array<{ id?: number; name?: string }>;
      last?: boolean;
      totalPages?: number;
    }>(token, url.toString(), signal);
    const content = Array.isArray(data?.content) ? data.content : [];
    for (const item of content) {
      const name = String(item?.name || '').trim();
      const id = Number(item?.id);
      if (name) leaves.push({ id: Number.isFinite(id) && id > 0 ? id : null, name });
    }
    if (data?.last) break;
    const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : null;
    if (totalPages !== null && page >= totalPages - 1) break;
  }
  return normalizeDutyEditorAllureLeaves(leaves);
}

export async function createDutyEditorAllureLeaf(
  token: string,
  streamName: string,
  signal?: AbortSignal,
): Promise<DutyEditorAllureLeaf> {
  const name = String(streamName || '').trim();
  if (!name) throw new Error('Заполни название стрима');
  const created = await allureRequestUrl<{ id?: number; name?: string }>(
    token,
    'POST',
    DUTY_EDITOR_ALLURE_CREATE_URL,
    { name },
    signal,
  );
  const createdId = Number(created?.id);
  if (!Number.isFinite(createdId) || createdId <= 0) {
    throw new Error('Allure не вернул id нового стрима');
  }
  await allureRequestUrl<unknown>(
    token,
    'POST',
    `${DUTY_EDITOR_ALLURE_TESTCASE_BASE_URL}/${encodeURIComponent(String(createdId))}/tag`,
    [{ id: DUTY_EDITOR_ALLURE_TAG_ID }],
    signal,
  );
  await allureRequestUrl<unknown>(
    token,
    'PATCH',
    `${DUTY_EDITOR_ALLURE_TESTCASE_BASE_URL}/${encodeURIComponent(String(createdId))}`,
    {
      statusId: DUTY_EDITOR_ALLURE_STATUS_ID,
      workflowId: DUTY_EDITOR_ALLURE_WORKFLOW_ID,
    },
    signal,
  );
  return { id: createdId, name: String(created?.name || name).trim() || name };
}

export async function renameDutyEditorAllureLeaf(
  token: string,
  leafId: number,
  streamName: string,
  signal?: AbortSignal,
): Promise<void> {
  const id = Number(leafId);
  const name = String(streamName || '').trim();
  if (!Number.isFinite(id) || id <= 0) throw new Error('Некорректный leafId для rename Allure');
  if (!name) throw new Error('Заполни название стрима');
  const url = `${DUTY_EDITOR_ALLURE_RENAME_URL}&leafId=${encodeURIComponent(String(id))}`;
  await allureRequestUrl<unknown>(token, 'POST', url, { name }, signal);
}

export async function deleteDutyEditorAllureLeaf(
  token: string,
  leafId: number,
  signal?: AbortSignal,
): Promise<void> {
  const id = Number(leafId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Некорректный leafId для удаления Allure');
  await allureRequestUrl<unknown>(
    token,
    'DELETE',
    `${DUTY_EDITOR_ALLURE_TESTCASE_BASE_URL}/${encodeURIComponent(String(id))}?force=false`,
    undefined,
    signal,
  );
}

export async function fetchDutyEditorData(
  proxyBase: string,
  token: string,
  signal?: AbortSignal,
): Promise<DutyEditorData> {
  const url = new URL(DUTY_EDITOR_SCRIPT_URL);
  url.searchParams.set('op', 'read');
  const [scriptRaw, allureLeaves] = await Promise.all([
    proxyRequest<unknown>(
      proxyBase,
      'GET',
      url.toString(),
      { Accept: 'application/json' },
      undefined,
      signal,
    ),
    fetchDutyEditorAllureLeaves(token, signal).catch(() => []),
  ]);
  const normalized = normalizeDutyEditorResponse(scriptRaw);
  const fallbackLeaves = normalizeDutyEditorAllureLeaves(
    (normalized.meta as Record<string, unknown>).allureLeaves ||
    (normalized.meta as Record<string, unknown>).allureStreams,
  );
  const effectiveLeaves = allureLeaves.length ? allureLeaves : fallbackLeaves;
  const leadModel = buildDutyEditorLeadModel(normalized.leads, effectiveLeaves);
  return {
    leadsEntries: leadModel.entries,
    streamEntries: mapToStreamEntries(normalized.streamsTree),
    tables: normalized.tables,
    meta: {
      ...normalized.meta,
      allureLeaves: effectiveLeaves,
      allureStreams: effectiveLeaves,
      hiddenLeadAssignments: leadModel.hiddenLeadAssignments,
    },
    allureLeaves: effectiveLeaves,
  };
}

export async function saveDutyEditorData(
  proxyBase: string,
  data: DutyEditorData,
  signal?: AbortSignal,
): Promise<DutyEditorData> {
  const meta = (data.meta || {}) as Record<string, unknown>;
  const hiddenLeads = normalizeLeadsData(meta.hiddenLeadAssignments || {});
  const visibleLeads = entriesToLeadMap(data.leadsEntries);
  const payload = {
    op: 'save',
    leads: mergeLeadMaps(hiddenLeads, visibleLeads),
    streamsTree: entriesToStreamMap(data.streamEntries),
    tables: Array.isArray(data.tables) ? [...data.tables] : [],
    meta: {
      ...(data.meta || {}),
      hiddenLeadAssignments: hiddenLeads,
    },
  };
  delete (payload.meta as Record<string, unknown>).allureLeaves;
  delete (payload.meta as Record<string, unknown>).allureStreams;

  const raw = await proxyRequest<unknown>(
    proxyBase,
    'POST',
    DUTY_EDITOR_SCRIPT_URL,
    { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
    JSON.stringify(payload),
    signal,
  );
  const normalized = (() => {
    try {
      return normalizeDutyEditorResponse(raw);
    } catch {
      return {
        leads: mergeLeadMaps(hiddenLeads, visibleLeads),
        streamsTree: entriesToStreamMap(data.streamEntries),
        tables: Array.isArray(data.tables) ? [...data.tables] : [],
        meta: { ...(data.meta || {}) },
      };
    }
  })();
  const allureLeaves = normalizeDutyEditorAllureLeaves(
    data.allureLeaves ||
    (normalized.meta as Record<string, unknown>).allureLeaves ||
    (normalized.meta as Record<string, unknown>).allureStreams,
  );
  const leadModel = buildDutyEditorLeadModel(normalized.leads, allureLeaves);
  return {
    leadsEntries: leadModel.entries,
    streamEntries: mapToStreamEntries(normalized.streamsTree),
    tables: normalized.tables,
    meta: { ...normalized.meta, allureLeaves, allureStreams: allureLeaves, hiddenLeadAssignments: leadModel.hiddenLeadAssignments },
    allureLeaves,
  };
}

// ─── BAND POST / SCHEDULE ──────────────────────────────────────

export interface BandPostOptions {
  channelId: string;
  rootId?: string;
}

export async function bandPostMessage(
  proxyBase: string, cookies: string, message: string, opts: BandPostOptions, signal?: AbortSignal,
): Promise<{ id?: string }> {
  const channelId = opts.channelId;
  const rootId = opts.rootId || '';
  const userId = getCurrentBandUserId(cookies);
  const mmCsrf = getMmCsrf(cookies);
  const nowMs = Date.now();
  const payload = {
    file_ids: [], message: String(message || '').trim(), channel_id: channelId, root_id: rootId,
    pending_post_id: `${userId}:${nowMs}`, user_id: userId, create_at: 0, metadata: {}, props: {}, update_at: nowMs, reply_count: 0,
  };
  const headers: Record<string, string> = {
    Accept: '*/*', 'Accept-Language': 'ru', 'Content-Type': 'application/json',
    Origin: BAND_BASE, 'X-Requested-With': 'XMLHttpRequest', 'X-Proxy-Cookie': cookies,
    ...(mmCsrf ? { 'X-CSRF-Token': mmCsrf } : {}),
  };
  return proxyRequest<{ id?: string }>(proxyBase, 'POST', `${BAND_BASE}/api/v4/posts`, headers, payload, signal);
}

export async function bandScheduleMessage(
  proxyBase: string, cookies: string, message: string, scheduledAtMs: number,
  opts: BandPostOptions, signal?: AbortSignal,
): Promise<unknown> {
  const channelId = opts.channelId;
  const rootId = opts.rootId || '';
  const userId = getCurrentBandUserId(cookies);
  const mmCsrf = getMmCsrf(cookies);
  const payload = {
    id: '', scheduled_at: scheduledAtMs, create_at: 0, user_id: userId, channel_id: channelId,
    root_id: rootId, message: String(message || '').trim(), props: {}, metadata: {}, file_ids: [],
  };
  const headers: Record<string, string> = {
    Accept: '*/*', 'Accept-Language': 'ru', 'Content-Type': 'application/json',
    Origin: BAND_BASE, 'X-Requested-With': 'XMLHttpRequest', 'X-Proxy-Cookie': cookies,
    ...(mmCsrf ? { 'X-CSRF-Token': mmCsrf } : {}),
  };
  return proxyRequest<unknown>(proxyBase, 'POST', `${BAND_BASE}/api/v4/posts/schedule`, headers, payload, signal);
}

// ─── MAJOR RELEASE HELPERS ─────────────────────────────────────

export function buildMajorRootMessage(platform: 'ios' | 'android', release: string): string {
  return platform === 'ios' ? `#IOS #Release ${release}` : `#Android #Release ${release}`;
}

export function buildMajorReadinessLaunchName(platform: 'ios' | 'android', release: string): string {
  return `[ALL][${platform === 'ios' ? 'iOS' : 'Android'}] Готовность к релизу ${release}`;
}

function buildMajorReleaseTagName(release: string): string {
  const digits = String(release || '').replace(/\D+/g, '');
  const shortTag = digits.slice(0, 3);
  if (shortTag.length < 3) throw new Error('Не удалось собрать короткий тег релиза для рана готовности.');
  return shortTag;
}

export function buildMajorThreadTemplate(platform: 'ios' | 'android', release: string): string {
  const today = new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const d = new Date();
  const dayOfWeek = d.getDay();
  const daysUntil = ((2 - dayOfWeek + 7) % 7) || 7;
  d.setDate(d.getDate() + daysUntil);
  const nextTue = d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const devDuty = platform === 'ios' ? '@mp-ios-release-dev-duty' : '@mp-release-android-dev-duty';
  return [
    `OS версия: ${release || '[версия]'}`,
    'Релиз',
    'Ссылка на доску: ',
    '',
    'Ссылка на релизный таск:',
    '',
    `Сроки готовности сборок: ${today}`,
    `Сроки выкатки: ${nextTue}`,
    `Ориентировочное время старта регресса: ${today}`,
    `Ожидаемое время окончания проверки: ${nextTue}`,
    'Время старта регресс:',
    'Таблица для стримов: https://docs.google.com/spreadsheets/d/1W7fNhN5BD-ItG03za-U2-uPotvDfiZbt_baiyZXgLpI/edit?gid=557393962#gid=557393962',
    'Сборка: ',
    '',
    'Финальный ран: ',
    '',
    `Ответственный разработчик: ${devDuty}`,
    '',
    '',
    'Ссылки на прогоны:',
    '| Стрим | HB | Selective |',
    '| --- | --- | --- |',
    'Дежурные:',
  ].join('\n');
}

export function buildMajorPollText(streamNames: string[]): string {
  const excluded = buildHardcodedExcludeSet();
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of Array.isArray(streamNames) ? streamNames : []) {
    const label = String(item || '').trim();
    if (!label) continue;
    if (excluded.has(normStr(label))) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  if (!labels.length) throw new Error('Allure не вернул ни одного стрима для опроса');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const parts = [
    `/poll "${esc(MAJOR_POLL_TITLE)}"`,
    ...labels.map(l => `"${esc(l)}"`),
    '--progress',
    `--votes=${labels.length}`,
  ];
  return parts.join(' ');
}

function getTextSectionLines(text: string, sectionHeader: string, nextSectionHeader: string): string[] {
  const normalizedText = normBandText(text);
  const startMarker = `${sectionHeader}\n`;
  const startIdx = normalizedText.indexOf(startMarker);
  if (startIdx === -1) return [];
  const contentStart = startIdx + startMarker.length;
  const endIdx = nextSectionHeader
    ? normalizedText.indexOf(`\n${nextSectionHeader}`, startIdx + sectionHeader.length)
    : -1;
  const content = endIdx === -1
    ? normalizedText.slice(contentStart)
    : normalizedText.slice(contentStart, endIdx);
  return String(content || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function getMajorReleaseLineValue(text: string, lineLabel: string): string {
  const normalizedText = normBandText(text);
  const label = String(lineLabel || '').trim();
  if (!label) return '';
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*(.*)$`, 'm');
  const match = normalizedText.match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

function getRunsSectionData(text: string): { blockerHigh: string[]; selective: string[] } {
  const normalizedText = normalizeRunsSection(text);
  const tableLines = getTextSectionLines(normalizedText, 'Ссылки на прогоны:', 'Дежурные:');
  const blockerHigh: string[] = [];
  const selective: string[] = [];

  for (const line of tableLines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const streamCell = cells[1];
    if (!streamCell || /^---$/i.test(streamCell) || /^стрим$/i.test(streamCell)) continue;
    const blockerHighCell = cells[2];
    const selectiveCell = cells[3];
    if (blockerHighCell && blockerHighCell !== '—') blockerHigh.push(blockerHighCell);
    if (selectiveCell && selectiveCell !== '—') selective.push(selectiveCell);
  }

  return { blockerHigh, selective };
}

async function findMajorReadinessRun(
  platform: 'ios' | 'android',
  release: string,
  token: string,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<LaunchRecord | null> {
  if (!token) return null;
  const expectedName = buildMajorReadinessLaunchName(platform, release);
  const items = await searchAllureLaunchesByName(token, proxyBase, expectedName, signal);
  const exact = items.find((item) => item.name.trim() === expectedName);
  const found = exact || items[0];
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    url: `${ALLURE_LAUNCHES_BASE}/${found.id}`,
    reused: true,
  };
}

function hasExpectedMajorReadinessReference(
  lineValue: string,
  platform: 'ios' | 'android',
  release: string,
  readinessRun: LaunchRecord | null,
): boolean {
  const source = String(lineValue || '').trim();
  if (!source) return false;
  const expectedName = buildMajorReadinessLaunchName(platform, release);
  const expectedShortLabel = buildPublishedRunLabel(expectedName);
  const expectedBracketed = `[${expectedName}]`;
  const expectedShortBracketed = `[${expectedShortLabel}]`;
  const expectedUrl = readinessRun?.url || '';
  if (expectedUrl && source.includes(expectedUrl)) return true;
  if (source.includes(expectedBracketed)) return true;
  if (source.includes(expectedShortBracketed)) return true;
  if (source === expectedName) return true;
  if (source === expectedShortLabel) return true;
  return false;
}

// ─── MAJOR FIND FEED ROOT ──────────────────────────────────────

async function majorFindFeedRoot(
  proxyBase: string, cookies: string, platform: 'ios' | 'android', release: string, signal?: AbortSignal,
): Promise<BandPost> {
  const userId = getCurrentBandUserId(cookies);
  const rootMessage = buildMajorRootMessage(platform, release);
  const posts = await bandFetchChannelPostsSince(proxyBase, cookies, FEED_CHANNEL_ID, Date.now() - RELEASE_FEED_LOOKBACK_MS, signal);
  const found = findLatestRootPostByMessage(posts, rootMessage, userId);
  if (!found) throw new Error(`Тред "${rootMessage}" не найден в ленте релизов — сначала выполни шаг 1.`);
  return found;
}

export async function syncMajorWorkflowState(
  platform: 'ios' | 'android',
  release: string,
  token: string,
  proxyBase: string,
  cookies: string,
  signal?: AbortSignal,
): Promise<MajorWorkflowSyncResult> {
  const baseline: MajorWorkflowResolvedStatus[] = Array.from({ length: 8 }, () => 'pending');
  const normalizedRelease = String(release || '').trim();
  if (!normalizedRelease) {
    return { statuses: baseline, threadText: '', rootId: '', finalRunUrl: '' };
  }

  let readinessRun: LaunchRecord | null = null;
  if (token) {
    try {
      readinessRun = await findMajorReadinessRun(platform, normalizedRelease, token, proxyBase, signal);
    } catch {
      readinessRun = null;
    }
  }
  let streamsSheetExists = false;
  try {
    const sheetState = await checkMajorReleaseStreamsSheet(normalizedRelease, proxyBase, signal);
    streamsSheetExists = Boolean(sheetState.exists);
  } catch {
    streamsSheetExists = false;
  }

  if (!String(cookies || '').trim()) {
    return {
      statuses: [
        'pending', // 1: Feed Post
        'pending', // 2: Fill Duty
        streamsSheetExists ? 'done' : 'pending', // 3: Streams Sheet
        'pending', // 4: Poll
        'pending', // 5: Reminder
        'pending', // 6: Components
        'pending', // 7: Fill Runs
        readinessRun ? 'done' : 'pending', // 8: Readiness Run
      ],
      threadText: '',
      rootId: '',
      finalRunUrl: readinessRun?.url || '',
    };
  }

  let rootPost: BandPost | null = null;
  try {
    rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, normalizedRelease, signal);
  } catch {
    rootPost = null;
  }

  if (!rootPost) {
    return {
      statuses: [
        'pending', // 1: Feed Post
        'pending', // 2: Fill Duty
        streamsSheetExists ? 'done' : 'pending', // 3: Streams Sheet
        'pending', // 4: Poll
        'pending', // 5: Reminder
        'pending', // 6: Components
        'pending', // 7: Fill Runs
        readinessRun ? 'done' : 'pending', // 8: Readiness Run
      ],
      threadText: '',
      rootId: '',
      finalRunUrl: readinessRun?.url || '',
    };
  }

  const rootId = String(rootPost.id || '').trim();
  const userId = getCurrentBandUserId(cookies);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, rootId, userId);
  const mainText = normBandText(mainPost?.message || '');
  const dutyLines = getTextSectionLines(mainText, 'Дежурные:', '');
  const runsData = getRunsSectionData(mainText);
  const finalRunValue = getMajorReleaseLineValue(mainText, 'Финальный ран:');
  const reminderNeedle = platform === 'ios'
    ? '@qadutyios - проверка тега'
    : '@qadutyandr - проверка тега';

  const statuses: MajorWorkflowResolvedStatus[] = [
    'done', // 1: Feed Post (root post found means step 1 done)
    dutyLines.length ? 'done' : 'pending', // 2: Fill Duty
    streamsSheetExists ? 'done' : 'pending', // 3: Streams Sheet
    hasOwnThreadReply(threadPosts, rootId, '', (_text, post) => isBandPollPost(post)) ? 'done' : 'pending', // 4: Poll
    hasOwnThreadReply(threadPosts, rootId, userId, (text) => text.includes(reminderNeedle)) ? 'done' : 'pending', // 5: Reminder
    hasOwnThreadReply(threadPosts, rootId, userId, (text) => text.startsWith('Компоненты:')) ? 'done' : 'pending', // 6: Components
    (runsData.blockerHigh.length || runsData.selective.length) ? 'done' : 'pending', // 7: Fill Runs
    (readinessRun && hasExpectedMajorReadinessReference(finalRunValue, platform, normalizedRelease, readinessRun)) ? 'done' : 'pending', // 8: Readiness
  ];

  return {
    statuses,
    threadText: mainText,
    rootId,
    finalRunUrl: readinessRun?.url || '',
  };
}

// ─── MAJOR STEP FUNCTIONS ──────────────────────────────────────

export async function majorPublishFeedPost(
  platform: 'ios' | 'android', release: string, threadText: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы — заполни в Настройках.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const userId = getCurrentBandUserId(cookies);
  const rootMessage = buildMajorRootMessage(platform, release);
  const normalized = normBandText(threadText);
  if (!normalized) throw new Error('Текст сообщения в треде пуст.');

  const label = platform === 'ios' ? 'iOS' : 'Android';
  onLog(`[${label}] Загружаю посты ленты релизов...`);
  const channelPosts = await bandFetchChannelPostsSince(proxyBase, cookies, FEED_CHANNEL_ID, Date.now() - RELEASE_FEED_LOOKBACK_MS, signal);

  let rootPost = findLatestRootPostByMessage(channelPosts, rootMessage, userId);
  if (!rootPost) {
    onLog(`[${label}] Публикую корневое сообщение "${rootMessage}"...`);
    const nowMs = Date.now();
    rootPost = await proxyRequest<BandPost>(proxyBase, 'POST', `${BAND_BASE}/api/v4/posts`, bandGetHeaders(cookies), {
      file_ids: [], message: normBandText(rootMessage), channel_id: FEED_CHANNEL_ID, root_id: '',
      pending_post_id: `${userId}:${nowMs}`, user_id: userId, create_at: 0,
      metadata: {}, props: {}, update_at: nowMs, reply_count: 0,
    }, signal);
    onLog(`[${label}] Корневое сообщение создано: ${rootPost.id}`, 'ok');
    await new Promise(r => setTimeout(r, 150));
  } else {
    onLog(`[${label}] Корневое сообщение найдено: ${rootPost.id}`, 'ok');
  }

  const rootId = rootPost.id;
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, rootId, userId);
  if (mainPost) {
    const existing = normBandText(mainPost.message);
    if (existing === normalized) {
      onLog(`[${label}] Тред не изменён (актуален).`, 'ok');
    } else {
      await bandPatchPost(proxyBase, cookies, mainPost, normalized, signal);
      onLog(`[${label}] Тред обновлён (patch ${mainPost.id}).`, 'ok');
    }
  } else {
    await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, normalized, signal);
    onLog(`[${label}] Тред опубликован в "${rootMessage}".`, 'ok');
  }
}

export async function majorFillDuty(
  platform: 'ios' | 'android', release: string, streams: DutyStream[],
  proxyBase: string, cookies: string, adminCookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
  collectionRows?: CollectionRow[],
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const userId = getCurrentBandUserId(cookies);
  const label = platform === 'ios' ? 'iOS' : 'Android';

  const dutyLines = streams
    .filter(s => s.name && (platform === 'ios' ? s.ios : s.android))
    .map(s => `${s.name} ${platform === 'ios' ? s.ios : s.android}`);

  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  onLog(`[${label}] Тред найден: ${rootId}`, 'ok');

  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, rootId, userId);
  if (!mainPost) throw new Error('Основное сообщение в треде не найдено — сначала выполни шаг 1.');
  onLog(`[${label}] Найден основной пост в треде: ${mainPost.id}`, 'ok');

  const text = normBandText(mainPost.message);
  const marker = 'Дежурные:';
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) throw new Error('В тексте не найдена строка «Дежурные:» — обнови шаблон (шаг 1).');

  const newText = text.slice(0, markerIdx + marker.length) + (dutyLines.length ? '\n' + dutyLines.join('\n') : '');
  const normalized = normBandText(newText);
  if (normBandText(mainPost.message) === normalized) {
    onLog(`[${label}] Тред не изменён (актуален).`, 'ok');
  } else {
    await bandPatchPost(proxyBase, cookies, mainPost, normalized, signal);
    onLog(`[${label}] Дежурные вставлены (${dutyLines.length} стримов), тред обновлён.`, 'ok');
  }

  if (collectionRows && collectionRows.length > 0) {
    const effectiveAdmin = (adminCookies || '').trim() || cookies.trim();
    if (effectiveAdmin) {
      try {
        await updateBandGroupForPlatform(platform, collectionRows, proxyBase, cookies, effectiveAdmin, onLog, signal);
      } catch (e) {
        onLog(`[${label}] Обновление группы не удалось: ${e instanceof Error ? e.message : e}`, 'warn');
      }
    } else {
      onLog(`[${label}] Band admin cookies не заданы — группа @${platform === 'ios' ? 'qadutyios' : 'qadutyandr'} не обновлена.`, 'warn');
    }
  }
}

export async function majorPublishPoll(
  platform: 'ios' | 'android', release: string, pollText: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  if (!pollText.trim()) throw new Error('Текст опроса пуст — дождись загрузки стримов из Allure.');
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  onLog(`[${label}] Тред найден: ${rootId}`, 'ok');
  await bandExecuteCommand(proxyBase, cookies, pollText, FEED_CHANNEL_ID, rootId, signal);
  onLog(`[${label}] Опрос отправлен в тред.`, 'ok');
}

export async function majorPublishReminder(
  platform: 'ios' | 'android', release: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const text = platform === 'ios'
    ? '@qadutyios - проверка тега :) Ребят напоминаю, нужно будет проверить запустились ли АТ в ранах ХБ по вашему стриму и все ли ок'
    : '@qadutyandr - проверка тега :) Ребят напоминаю, нужно будет проверить запустились ли АТ в ранах ХБ по вашему стриму и все ли ок';
  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, text, signal);
  onLog(`[${label}] Напоминание отправлено в тред.`, 'ok');
}

function sortComponentDisplayTexts(texts: string[]): string[] {
  return [...texts].sort((a, b) => {
    const rankOf = (s: string) => /^[A-Za-z]/.test(s) ? 0 : /^[Ѐ-ӿ]/.test(s) ? 1 : /^\d/.test(s) ? 2 : 3;
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'ru-RU');
  });
}

export async function majorPublishComponents(
  platform: 'ios' | 'android', release: string, componentsText: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
  options?: { updateExisting?: boolean },
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  if (!componentsText.trim()) throw new Error('Список компонентов пуст — введи в поле ввода.');
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const rawLines = componentsText.split('\n').map(l => l.trim()).filter(Boolean);
  const lines = sortComponentDisplayTexts(rawLines);
  const text = normBandText(`Компоненты:\n${lines.map(l => `- ${l}`).join('\n')}`);
  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  const userId = getCurrentBandUserId(cookies);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const compPost = threadPosts.find(p =>
    Number(p.delete_at) === 0 && p.root_id === rootId && p.user_id === userId &&
    normBandText(p.message).startsWith('Компоненты:'),
  );
  if (compPost) {
    if (normBandText(compPost.message) !== text) {
      await bandPatchPost(proxyBase, cookies, compPost, text, signal);
      onLog(`[${label}] Компоненты обновлены (patch ${compPost.id}, ${lines.length} шт.).`, 'ok');
    } else {
      if (options?.updateExisting) {
        onLog(`[${label}] Компоненты уже актуальны.`, 'ok');
      } else {
        const noticeText = 'Предыдущий список компонентов актуален, новых компонентов нет.';
        await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, noticeText, signal);
        onLog(`[${label}] Новых компонентов нет — отправлено уведомление в тред.`, 'ok');
      }
    }
  } else {
    await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, text, signal);
    onLog(`[${label}] Компоненты опубликованы (${lines.length} шт.).`, 'ok');
  }
}

export async function majorPublishComponentsFromDeployLab(
  platform: 'ios' | 'android', release: string, deployLabToken: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
  options?: { updateExisting?: boolean },
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const label = platform === 'ios' ? 'iOS' : 'Android';

  onLog(`[${label}] Загружаю компоненты из Deploy Lab...`);
  const rawComponents = await fetchDeployLabComponents(platform, release, deployLabToken, proxyBase, signal);
  const components = sortComponentDisplayTexts(rawComponents);
  onLog(`[${label}] Компонентов: ${components.length}`, components.length ? 'ok' : 'warn');
  if (!components.length) throw new Error('Deploy Lab вернул пустой список компонентов.');

  const text = normBandText(`Компоненты:\n${components.map(c => `- ${c}`).join('\n')}`);
  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  const userId = getCurrentBandUserId(cookies);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const compPost = threadPosts.find(p =>
    Number(p.delete_at) === 0 && p.root_id === rootId && p.user_id === userId &&
    normBandText(p.message).startsWith('Компоненты:'),
  );
  if (compPost) {
    if (normBandText(compPost.message) !== text) {
      await bandPatchPost(proxyBase, cookies, compPost, text, signal);
      onLog(`[${label}] Компоненты обновлены из Deploy Lab (patch ${compPost.id}, ${components.length} шт.).`, 'ok');
    } else {
      if (options?.updateExisting) {
        onLog(`[${label}] Компоненты уже актуальны.`, 'ok');
      } else {
        const noticeText = 'Предыдущий список компонентов актуален, новых компонентов нет.';
        await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, noticeText, signal);
        onLog(`[${label}] Новых компонентов нет — отправлено уведомление в тред.`, 'ok');
      }
    }
  } else {
    await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, text, signal);
    onLog(`[${label}] Компоненты из Deploy Lab опубликованы (${components.length} шт.).`, 'ok');
  }
}

async function searchAllureLaunchesByName(
  token: string, proxyBase: string, nameTerm: string, signal?: AbortSignal,
): Promise<Array<{ id: number; name: string }>> {
  const search = base64Utf8(JSON.stringify([{ id: 'name', type: 'string', value: nameTerm }]));
  const url = `${ALLURE_BASE}/api/launch?page=0&size=100&projectId=7&preview=true&sort=createdDate%2Cdesc&search=${encodeURIComponent(search)}`;
  const data = await proxyRequest<{ content?: Array<{ id?: number; name?: string }> }>(
    proxyBase, 'GET', url, allureHeaders(token), undefined, signal,
  );
  return (Array.isArray(data?.content) ? data.content : [])
    .map(it => ({ id: Number(it.id), name: String(it.name || '') }))
    .filter(it => Number.isFinite(it.id) && it.id > 0);
}

export async function fetchAllureRunsForPlatform(
  version: string, platform: 'ios' | 'android', token: string, proxyBase: string, signal?: AbortSignal,
): Promise<AllureRunsForPlatform> {
  const platformTag = platform === 'ios' ? '[iOS]' : '[Android]';
  const hbTerms = [`[High/Blocker][DeployLab] Регресс ${version}`, `[High/Blocker] Регресс ${version}`];
  const selTerms = [`[Selective][DeployLab] Регресс ${version}`, `[Selective] Регресс ${version}`];

  const byIdHB = new Map<number, { id: number; name: string }>();
  for (const term of hbTerms) {
    const items = await searchAllureLaunchesByName(token, proxyBase, term, signal);
    for (const it of items) {
      if (it.name.includes(platformTag)) byIdHB.set(it.id, it);
    }
  }
  const byIdSel = new Map<number, { id: number; name: string }>();
  for (const term of selTerms) {
    const items = await searchAllureLaunchesByName(token, proxyBase, term, signal);
    for (const it of items) {
      if (it.name.includes(platformTag)) byIdSel.set(it.id, it);
    }
  }
  const toRecord = (it: { id: number; name: string }): AllureRunRecord => ({
    id: it.id, name: it.name, url: `${ALLURE_LAUNCHES_BASE}/${it.id}`,
  });
  return {
    blockerHigh: Array.from(byIdHB.values()).map(toRecord),
    selective: Array.from(byIdSel.values()).map(toRecord),
  };
}

function buildPublishedRunLabel(runName: string): string {
  const name = runName.trim();
  if (!name) return 'Ран';
  if (/^\[AQA\]/i.test(name)) return 'AQA (Общие автотесты)';
  const match = name.match(/\[Stream\s+([^\]]+)\]/i);
  if (match?.[1]) return match[1].trim();
  return name;
}

function escapeTableCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').trim() || '—';
}

function buildRunsTableLines(blockerHighRuns: AllureRunRecord[], selectiveRuns: AllureRunRecord[]): string[] {
  const groups = new Map<string, { blockerHigh: AllureRunRecord[]; selective: AllureRunRecord[] }>();
  const order: string[] = [];
  const ensureGroup = (label: string) => {
    const norm = label.trim() || 'Ран';
    if (!groups.has(norm)) { groups.set(norm, { blockerHigh: [], selective: [] }); order.push(norm); }
    return groups.get(norm)!;
  };
  blockerHighRuns.forEach(r => ensureGroup(buildPublishedRunLabel(r.name)).blockerHigh.push(r));
  selectiveRuns.forEach(r => ensureGroup(buildPublishedRunLabel(r.name)).selective.push(r));
  const lines = ['| Стрим | HB | Selective |', '| --- | --- | --- |'];
  for (const label of order) {
    const g = groups.get(label)!;
    const rowCount = Math.max(g.blockerHigh.length, g.selective.length, 1);
    for (let idx = 0; idx < rowCount; idx++) {
      const hb = g.blockerHigh[idx];
      const sel = g.selective[idx];
      lines.push(`| ${escapeTableCell(label)} | ${hb ? `[Ран](${hb.url})` : '—'} | ${sel ? `[Ран](${sel.url})` : '—'} |`);
    }
  }
  return lines;
}

function fillTextSection(text: string, sectionHeader: string, nextSectionHeader: string, lines: string[]): string {
  const startMarker = sectionHeader + '\n';
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return text;
  const contentStart = startIdx + startMarker.length;
  const endMarker = '\n' + nextSectionHeader;
  const endIdx = text.indexOf(endMarker, startIdx + sectionHeader.length);
  if (endIdx === -1) return text;
  const newContent = lines.length ? lines.join('\n') + '\n' : '';
  return text.slice(0, contentStart) + newContent + text.slice(endIdx);
}

function normalizeRunsSection(text: string): string {
  return text.replace(/^Ссылки на прогоны\+ дежурные:$/m, 'Ссылки на прогоны:');
}

export async function majorFillRuns(
  platform: 'ios' | 'android', release: string, token: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!token) throw new Error('Allure токен не задан.');
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const userId = getCurrentBandUserId(cookies);
  const label = platform === 'ios' ? 'iOS' : 'Android';

  onLog(`[${label}] Ищу раны Allure для версии ${release}...`);
  const { blockerHigh, selective } = await fetchAllureRunsForPlatform(release, platform, token, proxyBase, signal);
  onLog(`[${label}] Blocker+High: ${blockerHigh.length}, Selective: ${selective.length}`, 'ok');
  for (const r of blockerHigh) onLog(`  [H/B] ${r.name}`);
  for (const r of selective) onLog(`  [Sel] ${r.name}`);

  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, rootId, userId);
  if (!mainPost) throw new Error('Основное сообщение в треде не найдено — сначала выполни шаг 1.');

  const baseText = normalizeRunsSection(normBandText(mainPost.message));
  const runsTableLines = buildRunsTableLines(blockerHigh, selective);
  const textWithRuns = fillTextSection(baseText, 'Ссылки на прогоны:', 'Дежурные:', runsTableLines);

  if (normBandText(mainPost.message) === normBandText(textWithRuns)) {
    onLog(`[${label}] Таблица прогонов уже актуальна.`, 'ok');
    return;
  }
  await bandPatchPost(proxyBase, cookies, mainPost, textWithRuns, signal);
  onLog(`[${label}] Таблица прогонов обновлена.`, 'ok');
}

function replaceMajorLine(text: string, lineLabel: string, lineValue: string): string {
  const source = text;
  const label = lineLabel.trim();
  if (!label) return source;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(${escaped})(?:[ \\t]*[^\\n]*)?$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, lineValue ? `$1 ${lineValue}` : '$1');
  if (!source.trim()) return lineValue ? `${label} ${lineValue}` : label;
  return `${source.replace(/\s*$/, '')}\n${lineValue ? `${label} ${lineValue}` : label}`;
}

export async function majorCreateReadinessRun(
  platform: 'ios' | 'android', release: string, token: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<LaunchRecord> {
  if (!token) throw new Error('Allure токен не задан.');
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  const userId = getCurrentBandUserId(cookies);
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const platformTagId = platform === 'ios' ? RUN_TAG_IOS : RUN_TAG_ANDROID;
  const launchName = buildMajorReadinessLaunchName(platform, release);
  const tagName = buildMajorReleaseTagName(release);

  onLog(`[${label}] Синхронизирую тест-план ${RUN_TP_MAJOR_READINESS}...`);
  await syncTestplan(token, RUN_TP_MAJOR_READINESS, signal);
  await new Promise(r => setTimeout(r, 300));

  onLog(`[${label}] Создаю тег "${tagName}"...`);
  const releaseTagId = await createTag(token, tagName, signal);
  onLog(`[${label}] Запускаю ран "${launchName}"...`);
  const run = await runTestplan(token, RUN_TP_MAJOR_READINESS, launchName, [releaseTagId, RUN_TAG_REGRESSION, platformTagId], signal);
  onLog(`[${label}] ${run.reused ? 'Найден существующий' : 'Создан'} ран: ${run.url}`, 'ok');

  const runLabel = buildPublishedRunLabel(run.name);
  const finalRunValue = `[${runLabel}](${run.url})`;
  onLog(`[${label}] Обновляю тред ("Финальный ран: ${finalRunValue}")...`);

  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const rootId = rootPost.id;
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, rootId, userId);
  if (!mainPost) throw new Error('Основное сообщение в треде не найдено — сначала выполни шаг 1.');

  const existingText = normBandText(mainPost.message);
  const newText = replaceMajorLine(existingText, 'Финальный ран:', finalRunValue);
  if (existingText !== normBandText(newText)) {
    await bandPatchPost(proxyBase, cookies, mainPost, newText, signal);
    onLog(`[${label}] Тред обновлён (Финальный ран обновлён).`, 'ok');
  } else {
    onLog(`[${label}] Финальный ран уже актуален в треде.`, 'ok');
  }

  return run;
}

// ─── NON-MAJOR SCENARIO ────────────────────────────────────────

function launchLink(run: LaunchRecord): string {
  return `[${run.name}](${run.url})`;
}

function runMessageLink(run: LaunchRecord): string {
  return `Ран: ${launchLink(run)}`;
}

function buildRunCreatorMessage(greeting: string, runs: LaunchRecord[], buildValue: string, includeBuildSection: boolean): string {
  const runList = (Array.isArray(runs) ? runs : []).filter(Boolean);
  if (!includeBuildSection) {
    return [greeting, ...runList.map(runMessageLink)].join('\n').trim();
  }

  const buildText = String(buildValue || '').trim();
  if (buildText) {
    return [greeting, `Сборка: ${buildText}`, ...runList.map(runMessageLink)].join('\n').trim();
  }
  if (runList.length) {
    const [firstRun, ...restRuns] = runList;
    return [greeting, `Сборка: ${runMessageLink(firstRun)}`, ...restRuns.map(runMessageLink)].join('\n').trim();
  }
  return [greeting, 'Сборка:'].join('\n').trim();
}

export async function runCreatorScenario(
  mode: RunMode, release: string, settings: AppSettings,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal, buildValue = '',
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
    return { runs, message: buildRunCreatorMessage(`Привет, новый крит-путь для ХФ Android, релиз ${release}`, runs, buildValue, true) };
  }

  if (mode === 'hf_ios') {
    const tagRelease = await ensureReleaseTag();
    const name = `[SWAT][Крит-путь][iOS] ${release}`;
    onLog(`Запускаю тест-план ${RUN_TP_CP_IOS} → ${name}`);
    const run = await runTestplan(token, RUN_TP_CP_IOS, name, [tagRelease, RUN_TAG_IOS], signal);
    onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
    runs.push(run);
    return { runs, message: buildRunCreatorMessage(`Привет, новый крит-путь для ХФ iOS, релиз ${release}`, runs, buildValue, true) };
  }

  if (mode === 'napi') {
    const plans = [
      { tpId: RUN_TP_NAPI_BASE,    name: `[SWAT][Android и iOS] Релиз Napi ${release}` },
      { tpId: RUN_TP_NAPI_IOS,     name: `[SWAT][Финтех + Корзина][iOS] Релиз Napi ${release}` },
      { tpId: RUN_TP_NAPI_ANDROID, name: `[SWAT][Финтех + Корзина][Android] Релиз Napi ${release}` },
    ];
    onLog('Проверяю существующие NAPI раны...');
    const existing = await Promise.all(plans.map(p => findExistingLaunch(token, p.name, signal)));
    const missing = plans.filter((_, i) => !existing[i]);
    let tagNapi = 0;
    let tagRelease = 0;
    if (missing.length) {
      tagRelease = await ensureReleaseTag();
      onLog(`Синхронизирую тест-кейсы (${missing.map(p => p.tpId).join(', ')})...`);
      for (const p of missing) await syncTestplan(token, p.tpId, signal);
      tagNapi = await createTag(token, 'napi', signal);
    }
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (existing[i]) { onLog(`Найден существующий ран: ${launchLink(existing[i]!)}`, 'warn'); runs.push(existing[i]!); continue; }
      const tagIds = p.tpId === RUN_TP_NAPI_BASE
        ? [RUN_TAG_ANDROID, RUN_TAG_IOS, tagRelease, tagNapi]
        : p.tpId === RUN_TP_NAPI_IOS ? [RUN_TAG_IOS, tagRelease, tagNapi] : [tagRelease, RUN_TAG_ANDROID, tagNapi];
      onLog(`Запускаю ${p.tpId} → ${p.name}`);
      const run = await runTestplan(token, p.tpId, p.name, tagIds, signal);
      onLog(`Ран: ${launchLink(run)}`, 'ok');
      runs.push(run);
    }
    return { runs, message: buildRunCreatorMessage(`Привет, новый регресс для NAPI, релиз ${release}`, runs, buildValue, false) };
  }

  if (mode === 'sunday_devices') {
    const tagRelease = await ensureReleaseTag();
    const deviceRuns = [
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь][Android] Тест UI Старых устройств ${release}` },
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь][Android] Раскладушки (FOLD) ${release}` },
      { tpId: RUN_TP_CP_IOS,     name: `[SWAT][Крит-путь][IOS] Тест UI Старых устройств ${release}` },
      { tpId: RUN_TP_CP_IOS,     name: `[SWAT][Крит-путь][IOS] iPAD ${release}` },
    ];
    for (const r of deviceRuns) {
      const tagIds = r.tpId === RUN_TP_CP_ANDROID ? [RUN_TAG_ANDROID, tagRelease] : [RUN_TAG_IOS, tagRelease];
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, tagIds, signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return { runs, message: buildRunCreatorMessage(`Привет, новые воскресные раны устройств, релиз ${release}`, runs, buildValue, true) };
  }

  if (mode === 'rustore_critical') {
    const tagRelease = await ensureReleaseTag();
    const tagApp = await createTag(token, 'AppGallery', signal);
    const tagRu  = await createTag(token, 'RuStore', signal);
    const pairs = [
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь] AppGallery ${release}`, extraTag: tagApp },
      { tpId: RUN_TP_CP_ANDROID, name: `[SWAT][Крит-путь] RuStore ${release}`,    extraTag: tagRu  },
    ];
    for (const r of pairs) {
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, [RUN_TAG_ANDROID, tagRelease, r.extraTag], signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return { runs, message: buildRunCreatorMessage(`Привет, новый крит-путь для RuStore / AppGallery, релиз ${release}`, runs, buildValue, true) };
  }

  if (mode === 'rustore_smoke') {
    const tagRelease = await ensureReleaseTag();
    const tagApp = await createTag(token, 'AppGallery', signal);
    const tagRu  = await createTag(token, 'RuStore', signal);
    const pairs = [
      { tpId: RUN_TP_SMOKE_RUSTORE,    name: `[SWAT][Android][Smoke] RuStore ${release}`,    extraTag: tagRu  },
      { tpId: RUN_TP_SMOKE_APPGALLERY, name: `[SWAT][Android][Smoke] AppGallery ${release}`, extraTag: tagApp },
    ];
    for (const r of pairs) {
      onLog(`Запускаю ${r.tpId} → ${r.name}`);
      const run = await runTestplan(token, r.tpId, r.name, [RUN_TAG_ANDROID, tagRelease, r.extraTag], signal);
      onLog(`Ран: ${launchLink(run)}`, run.reused ? 'warn' : 'ok');
      runs.push(run);
    }
    return { runs, message: buildRunCreatorMessage(`Привет, новый Smoke для RuStore / AppGallery, релиз ${release}`, runs, buildValue, true) };
  }

  return { runs: [], message: '' };
}

// ─── STREAMS SHEET ─────────────────────────────────────────────

interface ReleaseStreamsSheetResponse {
  exists: boolean;
  created: boolean;
  releaseCode: string;
  sheetName: string;
  sheetUrl: string;
  sheetId: number | null;
}

function normalizeReleaseStreamsSheetResponse(payload: unknown): ReleaseStreamsSheetResponse {
  const source = payload && typeof payload === 'object' && 'data' in payload && (payload as { data?: unknown }).data
    ? (payload as { data?: unknown }).data
    : payload;
  if (!source || typeof source !== 'object') {
    throw new Error('Apps Script вернул пустой ответ по таблице стримов');
  }
  const root = source as Record<string, unknown>;
  return {
    exists: Boolean(root.exists),
    created: Boolean(root.created),
    releaseCode: String(root.releaseCode || '').trim(),
    sheetName: String(root.sheetName || '').trim(),
    sheetUrl: String(root.sheetUrl || root.url || '').trim(),
    sheetId: root.sheetId == null ? null : Number(root.sheetId),
  };
}

async function requestReleaseStreamsSheet(
  proxyBase: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReleaseStreamsSheetResponse> {
  const parsed = await proxyRequest<unknown>(
    proxyBase,
    'POST',
    DUTY_EDITOR_SCRIPT_URL,
    { 'Content-Type': 'text/plain;charset=utf-8' },
    JSON.stringify(payload),
    signal,
  );
  if (parsed && typeof parsed === 'object' && (parsed as { ok?: boolean }).ok === false) {
    throw new Error(String((parsed as { error?: unknown }).error || 'Apps Script не обработал таблицу стримов'));
  }
  return normalizeReleaseStreamsSheetResponse(parsed);
}

export async function checkMajorReleaseStreamsSheet(
  release: string,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<ReleaseStreamsSheetResponse> {
  const normalizedRelease = String(release || '').trim();
  if (!normalizedRelease) {
    return { exists: false, created: false, releaseCode: '', sheetName: '', sheetUrl: '', sheetId: null };
  }
  return requestReleaseStreamsSheet(proxyBase, {
    op: 'releaseStreamsSheetCheck',
    release: normalizedRelease,
  }, signal);
}

function replaceMajorReleaseLine(text: string, lineLabel: string, lineValue: string): string {
  const source = String(text || '');
  const label = String(lineLabel || '').trim();
  const value = String(lineValue || '').trim();
  if (!label) return source;
  const pattern = new RegExp(`^(${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:[ \\t]*[^\\n]*)?$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, value ? `$1 ${value}` : '$1');
  if (!source.trim()) return value ? `${label} ${value}` : label;
  return `${source.replace(/\s*$/, '')}\n${value ? `${label} ${value}` : label}`;
}

async function findMajorReleaseMainPost(
  platform: 'ios' | 'android',
  release: string,
  proxyBase: string,
  cookies: string,
  signal?: AbortSignal,
): Promise<{ mainPost: BandPost; text: string }> {
  const userId = getCurrentBandUserId(cookies);
  const rootPost = await majorFindFeedRoot(proxyBase, cookies, platform, release, signal);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, String(rootPost.id || ''), signal);
  const mainPost = findEarliestOwnThreadPost(threadPosts, String(rootPost.id || ''), userId);
  if (!mainPost) throw new Error('Основное сообщение в треде не найдено — сначала выполни шаг 1.');
  return { mainPost, text: normBandText(mainPost.message) };
}

async function resolveMajorReleaseExpectedFinishValue(
  platform: 'ios' | 'android',
  release: string,
  threadText: string,
  proxyBase: string,
  cookies: string,
  signal?: AbortSignal,
): Promise<string> {
  const localValue = getMajorReleaseLineValue(threadText, 'Ожидаемое время окончания проверки:');
  if (localValue) return localValue;
  const details = await findMajorReleaseMainPost(platform, release, proxyBase, cookies, signal);
  const threadValue = getMajorReleaseLineValue(details.text, 'Ожидаемое время окончания проверки:');
  if (!threadValue) throw new Error('Не нашёл строку "Ожидаемое время окончания проверки:" в треде релиза.');
  return threadValue;
}

async function updateMajorReleaseThreadLine(
  platform: 'ios' | 'android',
  release: string,
  lineLabel: string,
  lineValue: string,
  proxyBase: string,
  cookies: string,
  signal?: AbortSignal,
): Promise<'updated' | 'unchanged'> {
  const details = await findMajorReleaseMainPost(platform, release, proxyBase, cookies, signal);
  const updated = replaceMajorReleaseLine(details.text, lineLabel, lineValue);
  if (updated === details.text) return 'unchanged';
  await bandPatchPost(proxyBase, cookies, details.mainPost, updated, signal);
  return 'updated';
}

export async function ensureMajorStreamsSheet(
  platform: 'ios' | 'android', release: string, allureToken: string, proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal, threadText = '',
): Promise<ReleaseStreamsSheetResponse> {
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const normalizedRelease = String(release || '').trim();
  if (!normalizedRelease) throw new Error(`Укажи версию ${label}.`);
  if (!String(allureToken || '').trim()) throw new Error('Allure token не задан — он нужен для списка стримов.');
  if (!String(cookies || '').trim()) throw new Error('Band cookies не заданы — они нужны для обновления ссылки в треде.');

  onLog(`[${label}] Загружаю стримы из Allure для таблицы...`);
  const streams = await fetchDutyEditorAllureStreams(allureToken, signal);
  if (!streams.length) throw new Error('Не удалось получить стримы из Allure для таблицы.');
  onLog(`[${label}] Получено стримов: ${streams.length}.`, 'ok');

  const expectedFinish = await resolveMajorReleaseExpectedFinishValue(platform, normalizedRelease, threadText, proxyBase, cookies, signal);
  onLog(`[${label}] Ожидаемое время окончания проверки: ${expectedFinish}`, 'ok');

  onLog(`[${label}] Создаю или проверяю вкладку таблицы стримов...`);
  const result = await requestReleaseStreamsSheet(proxyBase, {
    op: 'releaseStreamsSheetEnsure',
    release: normalizedRelease,
    expectedFinish,
    streams,
  }, signal);

  if (result.sheetUrl) {
    try {
      const status = await updateMajorReleaseThreadLine(
        platform, normalizedRelease, 'Таблица для стримов:', result.sheetUrl, proxyBase, cookies, signal,
      );
      if (status === 'updated') {
        onLog(`[${label}] Ссылка на таблицу обновлена в треде.`, 'ok');
      } else {
        onLog(`[${label}] Ссылка на таблицу уже актуальна в треде.`, 'ok');
      }
    } catch (error) {
      onLog(`[${label}] Таблица готова, но ссылку в треде обновить не удалось: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  if (result.created) {
    onLog(`[${label}] Вкладка ${result.sheetName || result.releaseCode} создана.`, 'ok');
  } else {
    onLog(`[${label}] Вкладка ${result.sheetName || result.releaseCode} уже существует.`, 'ok');
  }
  return result;
}

// ─── RELEASE NOTICE ────────────────────────────────────────────

async function fetchDeployLabReleaseInfo(
  platform: 'ios' | 'android', release: string, deployLabToken: string, proxyBase: string, signal?: AbortSignal,
): Promise<{ cutoff?: string }> {
  const releaseId = buildDeployLabReleaseId(platform, release);
  const url = `${DEPLOY_LAB_BASE_URL}/releaseboss/admin_panel/release/${encodeURIComponent(releaseId)}`;
  try {
    const data = await proxyRequest<unknown>(proxyBase, 'GET', url, buildDeployLabHeaders(deployLabToken), undefined, signal);
    const payload = unwrapDeployLabPayload(data);
    const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const raw = source.date
      ?? source.cutoff_date
      ?? source.cutoff
      ?? source.cutoffDate
      ?? source.cut_off
      ?? source.cutoff_at
      ?? source.cutoffAt;
    return { cutoff: raw ? String(raw) : undefined };
  } catch {
    return {};
  }
}

type NoticeCutoffItem = { platform: 'ios' | 'android'; cutoffMs: number };

const NOTICE_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NOTICE_WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function noticeTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDeployLabCutoffMs(value?: string): number {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const iso = raw
    .replace(/(\.\d{3})\d+(?=[Z+\-])/, '$1')
    .replace(/(\.\d{2})(?=[Z+\-])/, '$10')
    .replace(/(\.\d)(?=[Z+\-])/, '$100');
  const normalized = iso.includes('T') && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? `${iso}+03:00`
    : iso;
  return new Date(normalized).getTime();
}

function noticeMskParts(ms: number) {
  const d = new Date(Number(ms) + MSK_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

function noticeMeta(ms: number) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return null;
  const parts = noticeMskParts(value);
  const weekdayDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return {
    ...parts,
    weekday: NOTICE_WEEKDAYS[weekdayDate.getUTCDay()] || '',
    monthLabel: NOTICE_MONTHS[parts.month - 1] || '',
    dateKey: `${parts.year}-${noticeTwo(parts.month)}-${noticeTwo(parts.day)}`,
    minuteKey: String(Math.floor(value / 60000)),
  };
}

function formatNoticeDate(ms: number): string {
  const meta = noticeMeta(ms);
  return meta ? `${meta.day} ${meta.monthLabel} (${meta.weekday})` : '';
}

function formatNoticeTime(ms: number): string {
  const meta = noticeMeta(ms);
  return meta ? `${noticeTwo(meta.hours)}:${noticeTwo(meta.minutes)}` : '';
}

function formatNoticeDateTime(ms: number): string {
  const date = formatNoticeDate(ms);
  const time = formatNoticeTime(ms);
  return date && time ? `${date} - в ${time}` : '';
}

function buildNoticeCodeFreezeMs(cutoffMs: number): number {
  const parts = noticeMskParts(cutoffMs);
  return Date.UTC(parts.year, parts.month - 1, parts.day - 1, 19, 0, 0, 0) - MSK_OFFSET_MS;
}

function buildNoticeFallbackText(release: string): string {
  const releaseText = String(release || '').trim() || '[релиз]';
  return [
    `❗️ Катофф ${releaseText} - [заполни дату и время вручную]`,
    `❗️ Кодфриз ${releaseText} - [заполни дату и время вручную]`,
    '❗️ Просьба все стримы проверить свои тест-планы, а так же актуализировать статус задач',
  ].join('\n');
}

function buildNoticeCutoffLine(release: string, items: NoticeCutoffItem[]): string {
  const releaseText = String(release || '').trim();
  const normalizedItems = items.filter(item => Number.isFinite(item.cutoffMs));
  if (!normalizedItems.length) return `❗️ Катофф ${releaseText} - [заполни дату и время вручную]`;

  if (normalizedItems.length === 1) {
    return `❗️ Катофф ${releaseText} - ${formatNoticeDateTime(normalizedItems[0].cutoffMs)}`;
  }

  const dateKeys = new Set(normalizedItems.map(item => noticeMeta(item.cutoffMs)?.dateKey).filter(Boolean));
  const minuteKeys = new Set(normalizedItems.map(item => noticeMeta(item.cutoffMs)?.minuteKey).filter(Boolean));

  if (dateKeys.size === 1) {
    const sharedDate = formatNoticeDate(normalizedItems[0].cutoffMs);
    if (minuteKeys.size === 1) {
      return `❗️ Катофф ${releaseText} - ${sharedDate} - в ${formatNoticeTime(normalizedItems[0].cutoffMs)}`;
    }
    const details = normalizedItems
      .map(item => `${item.platform === 'ios' ? 'iOS' : 'Android'} в ${formatNoticeTime(item.cutoffMs)}`)
      .join(', ');
    return `❗️ Катофф ${releaseText} - ${sharedDate} - ${details}`;
  }

  const details = normalizedItems
    .map(item => `${item.platform === 'ios' ? 'iOS' : 'Android'} ${formatNoticeDate(item.cutoffMs)} в ${formatNoticeTime(item.cutoffMs)}`)
    .join(', ');
  return `❗️ Катофф ${releaseText} - ${details}`;
}

export async function fetchMajorReleaseNoticeText(
  iosRelease: string, androidRelease: string, deployLabToken: string, proxyBase: string, signal?: AbortSignal,
): Promise<string> {
  const parts = [
    iosRelease.trim() ? `iOS ${iosRelease.trim()}` : '',
    androidRelease.trim() ? `Android ${androidRelease.trim()}` : '',
  ].filter(Boolean);
  const releaseText = parts.length ? parts.join(' / ') : (iosRelease.trim() || androidRelease.trim() || '[релиз]');
  if (!deployLabToken || (!iosRelease.trim() && !androidRelease.trim())) {
    return buildNoticeFallbackText(releaseText);
  }

  const releaseCandidates: Array<{ platform: 'ios' | 'android'; release: string }> = [
    { platform: 'android', release: androidRelease.trim() || iosRelease.trim() },
    { platform: 'ios', release: iosRelease.trim() || androidRelease.trim() },
  ];
  const releases = releaseCandidates.filter(item => item.release);
  const results = await Promise.allSettled(
    releases.map(async item => {
      const info = await fetchDeployLabReleaseInfo(item.platform, item.release, deployLabToken, proxyBase, signal);
      const cutoffMs = parseDeployLabCutoffMs(info.cutoff);
      return Number.isFinite(cutoffMs) ? { platform: item.platform, cutoffMs } : null;
    }),
  );
  const items = results
    .filter((item): item is PromiseFulfilledResult<NoticeCutoffItem | null> => item.status === 'fulfilled')
    .map(item => item.value)
    .filter((item): item is NoticeCutoffItem => Boolean(item && Number.isFinite(item.cutoffMs)))
    .sort((a, b) => a.cutoffMs - b.cutoffMs);
  if (!items.length) return buildNoticeFallbackText(releaseText);

  const primaryCutoffMs = Math.min(...items.map(item => item.cutoffMs));
  return [
    buildNoticeCutoffLine(releaseText, items),
    `❗️ Кодфриз ${releaseText} - ${formatNoticeDateTime(buildNoticeCodeFreezeMs(primaryCutoffMs))}`,
    '❗️ Просьба все стримы проверить свои тест-планы, а так же актуализировать статус задач',
  ].join('\n');
}

export async function majorPublishReleaseNotice(
  noticeText: string, proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
  onChannelStatus?: (channelId: string, state: 'idle' | 'loading' | 'success' | 'error', message?: string) => void,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!noticeText.trim()) throw new Error('Текст оповещения пуст.');
  const normalized = normBandText(noticeText);
  const errors: string[] = [];
  for (const channel of NOTICE_CHANNELS) {
    onChannelStatus?.(channel.id, 'loading');
    try {
      onLog(`Публикую оповещение в "${channel.name}"...`);
      await bandPostMessage(proxyBase, cookies, normalized, { channelId: channel.id }, signal);
      onChannelStatus?.(channel.id, 'success');
      onLog(`Опубликовано в "${channel.name}".`, 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onChannelStatus?.(channel.id, 'error', message);
      errors.push(`${channel.name}: ${message}`);
      onLog(`Не удалось опубликовать в "${channel.name}": ${message}`, 'error');
    }
  }
  if (errors.length) throw new Error(errors[0]);
}

// ─── DUTY PING ─────────────────────────────────────────────────

export async function fetchDutyPingPendingStreams(
  platform: 'ios' | 'android', release: string, token: string, proxyBase: string, signal?: AbortSignal,
): Promise<string[]> {
  const run = await findMajorReadinessRun(platform, release, token, proxyBase, signal);
  if (!run) return [];
  const excludeSet = buildHardcodedExcludeSet();
  const pendingMap = await fetchDutyPingPendingLeafMap(run.id, token, proxyBase, signal);
  return sortComponentDisplayTexts([...new Set(
    [...pendingMap.values()]
      .map(name => String(name || '').trim())
      .filter(name => Boolean(name) && !excludeSet.has(normStr(name))),
  )]);
}

export function buildDutyPingMessage(
  platform: 'ios' | 'android', pendingStreams: string[], dutyRows: CollectionRow[],
): string {
  if (!pendingStreams.length) return '';
  const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
  const lines: string[] = [`Коллеги, просьба написать сроки проставления оков по платформе ${platformLabel}`, ''];
  const rowNames = dutyRows
    .flatMap(row => [row.stream, row.streamDisplay])
    .map(name => String(name || '').trim())
    .filter(Boolean);
  const streamNorm2Canonical = buildStreamNorm2Canonical(rowNames, buildHardcodedAliases());
  const findDutyRow = (streamName: string) => {
    const direct = dutyRows.find(row => row.stream === streamName || row.streamDisplay === streamName);
    if (direct) return direct;
    const matched = matchStream(streamName, streamNorm2Canonical);
    return matched ? dutyRows.find(row => row.stream === matched || row.streamDisplay === matched) : undefined;
  };
  for (const streamName of pendingStreams) {
    const row = findDutyRow(streamName);
    const handle = platform === 'ios' ? row?.iosDuty : row?.androidDuty;
    lines.push(`${streamName} ${String(handle || '?').trim() || '?'}`.trimEnd());
  }
  return lines.join('\n').replace(/\s+$/u, '') + '\n';
}

export async function postDutyPingToThread(
  platform: 'ios' | 'android', release: string, message: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);
  if (!message.trim()) throw new Error('Сообщение пинга пусто.');
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
  const rootPost = await findDutyPingReleaseFeedRoot(platform, release, proxyBase, cookies, signal);
  const rootId = rootPost.id;
  const userId = getCurrentBandUserId(cookies);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal, {
    perPage: 200,
    updatesOnly: true,
    fromUpdateAt: DUTY_PING_THREAD_FROM_UPDATE_AT,
  });
  const existingPing = findDutyPingBasePost(threadPosts, rootId, userId, platformLabel);
  const normalized = normBandText(message);
  if (existingPing) {
    onLog(`[${label}] Найден существующий пинг, сохраняю текущий текст и запускаю мониторинг.`, 'ok');
  } else {
    await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, normalized, signal);
    onLog(`[${label}] Пинг опубликован в тред.`, 'ok');
  }
}

export async function findExistingDutyPingMessage(
  platform: 'ios' | 'android', release: string,
  proxyBase: string, cookies: string, signal?: AbortSignal,
): Promise<string> {
  if (!cookies.trim() || !release.trim()) return '';
  const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
  const rootPost = await findDutyPingReleaseFeedRoot(platform, release, proxyBase, cookies, signal);
  const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootPost.id, signal, {
    perPage: 200,
    updatesOnly: true,
    fromUpdateAt: DUTY_PING_THREAD_FROM_UPDATE_AT,
  });
  const existing = findDutyPingBasePost(threadPosts, rootPost.id, getCurrentBandUserId(cookies), platformLabel);
  return existing ? String(existing.message || '') : '';
}

// ─── ALLURE B64 QUERY ──────────────────────────────────────────

function allureB64Query(filters: Array<{ id: string; type: string; value: unknown }>): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(filters))));
}

// ─── FIXED DUTY PING PENDING STREAMS ──────────────────────────

export async function fetchDutyPingPendingLeafMap(
  launchId: string | number, token: string, proxyBase: string, signal?: AbortSignal,
): Promise<Map<string, string>> {
  const search = allureB64Query([{ id: 'progress', type: 'testProgressStatusArray', value: ['pending'] }]);
  const result = new Map<string, string>();
  let page = 0;
  for (let guard = 0; guard < 100; guard++) {
    if (signal?.aborted) break;
    const url = `${ALLURE_BASE}/api/testresulttree/leaf?launchId=${encodeURIComponent(String(launchId))}&search=${encodeURIComponent(search)}&sort=name%2Casc&size=200&page=${page}`;
    const data = await proxyRequest<{ content?: Array<{ id?: unknown; name?: unknown }>; last?: boolean; totalPages?: number }>(
      proxyBase, 'GET', url, allureHeaders(token), undefined, signal,
    );
    const content = Array.isArray(data?.content) ? data.content : [];
    for (const item of content) {
      const id = String(item?.id || '').trim();
      const name = String(item?.name || '').trim();
      if (id && name) result.set(id, name);
    }
    if (data?.last) break;
    if (typeof data?.totalPages === 'number' && page >= data.totalPages - 1) break;
    if (!content.length) break;
    page++;
  }
  return result;
}

// ─── BAND CHANNEL USERS ────────────────────────────────────────

export async function bandFetchChannelUsers(
  channelId: string, proxyBase: string, cookies: string, signal?: AbortSignal,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let page = 0; page < 8; page++) {
    if (signal?.aborted) break;
    const url = new URL(`${BAND_BASE}/api/v4/users`);
    url.searchParams.set('in_channel', channelId);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '200');
    url.searchParams.set('sort', 'admin');
    const data = await proxyRequest<Array<{ id?: string; username?: string }>>(
      proxyBase, 'GET', url.toString(), bandReadHeaders(cookies), undefined, signal,
    );
    if (!Array.isArray(data) || !data.length) break;
    for (const user of data) {
      const id = String(user?.id || '').trim();
      const username = String(user?.username || '').trim();
      if (id && username) result[id] = username;
    }
    if (data.length < 200) break;
  }
  return result;
}

// ─── YOUTRACK ─────────────────────────────────────────────────

const YT_AGILE_ID_IOS     = '83-469';
const YT_AGILE_ID_ANDROID = '83-2175';
const YT_SPRINT_FIELD_IOS     = '{Версия релиза (ex. Sprint) iOS}';
const YT_SPRINT_FIELD_ANDROID = '{Версия релиза (ex. Sprint) Android}';

function normalizeReleaseName(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}


export interface MajorYtData {
  boardUrl: string;
  ticketKey: string;
  ticketUrl: string;
  ticketSummary: string;
}

export async function fetchMajorYtData(
  platform: 'ios' | 'android', release: string, ytBase: string, ytToken: string,
  proxyBase: string, signal?: AbortSignal,
): Promise<MajorYtData> {
  const base = ytBase.replace(/\/+$/, '') || 'https://youtrack.wildberries.ru';
  const token = ytToken.trim();
  if (!token) throw new Error('Не задан YouTrack токен — заполни в Настройках.');
  if (!release.trim()) throw new Error('Укажи версию релиза.');

  const agileId = platform === 'ios' ? YT_AGILE_ID_IOS : YT_AGILE_ID_ANDROID;
  const sprintField = platform === 'ios' ? YT_SPRINT_FIELD_IOS : YT_SPRINT_FIELD_ANDROID;
  const releaseNorm = normalizeReleaseName(release);

  let boardUrl = '';
  try {
    const sprintsUrl = new URL(`${base}/api/agiles/${agileId}/sprints/`);
    sprintsUrl.searchParams.set('issuesQuery', '');
    sprintsUrl.searchParams.set('$top', '-1');
    sprintsUrl.searchParams.set('fields', 'id,name,finish');
    const sprintsRaw = await proxyRequest<Array<{ id?: string; name?: string; finish?: unknown }>>(
      proxyBase, 'GET', sprintsUrl.toString(),
      { Accept: 'application/json', Authorization: `Bearer ${token}` },
      undefined, signal,
    );
    const sprints = Array.isArray(sprintsRaw) ? sprintsRaw : [];
    const sprint = sprints.find(s => normalizeReleaseName(String(s?.name || '')) === releaseNorm);
    boardUrl = sprint?.id
      ? `${base}/agiles/${agileId}/${sprint.id}`
      : `${base}/agiles/${agileId}/current`;
  } catch { /* boardUrl stays empty */ }

  let ticketKey = '', ticketUrl = '', ticketSummary = '';
  try {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();
    const query = `(${sprintField}: ${esc(release)}) AND (summary: "Релизный тикет")`;
    const issuesUrl = new URL(`${base}/api/issues`);
    issuesUrl.searchParams.set('query', query);
    issuesUrl.searchParams.set('$top', '100');
    issuesUrl.searchParams.set('fields', 'id,idReadable,summary');
    const issues = await proxyRequest<Array<{ idReadable?: string; summary?: string }>>(
      proxyBase, 'GET', issuesUrl.toString(),
      { Accept: 'application/json', Authorization: `Bearer ${token}` },
      undefined, signal,
    );
    const list = Array.isArray(issues) ? issues : [];
    const exact = list.find(i => {
      const s = String(i?.summary || '').trim().toUpperCase();
      return s.includes('РЕЛИЗНЫЙ ТИКЕТ');
    });
    if (exact?.idReadable) {
      ticketKey = String(exact.idReadable).trim();
      ticketUrl = `${base}/issue/${encodeURIComponent(ticketKey)}`;
      ticketSummary = String(exact.summary || '').trim();
    }
  } catch { /* ticket stays empty */ }

  return { boardUrl, ticketKey, ticketUrl, ticketSummary };
}

// ─── REFRESH POLL TEXT FROM ALLURE ────────────────────────────

export async function refreshMajorPollTextFromAllure(
  token: string, proxyBase: string, signal?: AbortSignal,
): Promise<string> {
  const streamNames = await fetchDutyEditorAllureStreams(token, signal);
  if (!streamNames.length) throw new Error('Allure не вернул ни одного стрима для опроса');
  return buildMajorPollText(streamNames);
}

// ─── MSK TIME HELPERS ─────────────────────────────────────────

function getMskParts(ms: number): { year: number; month: number; day: number; hours: number; minutes: number } {
  const d = new Date(Number(ms) + MSK_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

function getMskTimeStr(ms: number): string {
  const p = getMskParts(ms);
  return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
}

function buildDutyPingEtaFromMinutes(baseMs: number, minutes: number): string {
  return getMskTimeStr(baseMs + Math.max(0, minutes) * 60 * 1000);
}

function buildDutyPingEtaFromHHMM(baseMs: number, hh: number, mm: number): string {
  const p = getMskParts(baseMs);
  let etaMs = Date.UTC(p.year, p.month - 1, p.day, hh, mm, 0, 0) - MSK_OFFSET_MS;
  if (etaMs < baseMs - 10 * 60 * 1000) etaMs += 24 * 60 * 60 * 1000;
  return getMskTimeStr(etaMs);
}

// ─── DUTY PING ETA PARSING ────────────────────────────────────

const DUTY_PING_RELEASE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DUTY_PING_THREAD_FROM_UPDATE_AT = 1565303257750;
const DUTY_PING_OK  = ':green_verify:';
const DUTY_PING_ETA = ':spiral_calendar_pad:';
const DUTY_PING_ETA_APPROX_WORDS_PART = '(?:около|примерно|приблизительно|ориентировочно|где\\s*[-–—]?\\s*то|гдето)';
const DUTY_PING_WORD_LEFT = '(?<![\\p{L}\\p{N}_])';
const DUTY_PING_WORD_RIGHT = '(?![\\p{L}\\p{N}_])';

function dutyPingWordRe(pattern: string, flags = 'iu'): RegExp {
  return new RegExp(`${DUTY_PING_WORD_LEFT}${pattern}${DUTY_PING_WORD_RIGHT}`, flags);
}

const DUTY_PING_TIME_HHMM_RE = dutyPingWordRe('([01]?\\d|2[0-3])\\s*[:.]\\s*([0-5]\\d)');
const DUTY_PING_TIME_TO_RE = dutyPingWordRe('до\\s*([01]?\\d|2[0-3])(?:\\s*[:.]\\s*([0-5]\\d))?');
const DUTY_PING_TIME_H_ONLY_RE = new RegExp(`${DUTY_PING_WORD_LEFT}(?:в|к)\\s*([01]?\\d|2[0-3])${DUTY_PING_WORD_RIGHT}(?!\\s*[:.]\\s*\\d)`, 'iu');
const DUTY_PING_RANGE_MIN_SUFFIX_RE = dutyPingWordRe('(\\d{1,3})\\s*[-–]\\s*(\\d{1,3})\\s*(?:мин|минута|минуты|минут|минуток|минутак|m|м)');
const DUTY_PING_RANGE_MIN_PREFIX_RE = dutyPingWordRe('(?:минут(?:ок|ак)?|мин)\\s*(\\d{1,3})\\s*[-–]\\s*(\\d{1,3})');
const DUTY_PING_RANGE_NUMBERS_CONTEXT_MIN_RE = dutyPingWordRe('(\\d{1,3})\\s*[-–]\\s*(\\d{1,3})');
const DUTY_PING_MIN_PREFIX_RE = dutyPingWordRe('(?:минут(?:ок|ак)?|мин)\\s*(\\d{1,3})');
const DUTY_PING_MIN_SUFFIX_RE = dutyPingWordRe('(\\d{1,3})\\s*(?:мин|минута|минуты|минут|минуток|минутак|m|м)');
const DUTY_PING_H_SHORT_RE = /(?:^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*ч(?!\p{L}|\p{N})/iu;
const DUTY_PING_M_SHORT_RE = /(?:^|[^\p{L}\p{N}])(\d{1,3})\s*м(?!\p{L}|\p{N})/iu;
const DUTY_PING_ONE_HOUR_FUZZY_RE = dutyPingWordRe('(?:часик(?:а)?|часок)');
const DUTY_PING_RANGE_HOURS_RE = dutyPingWordRe('(\\d+(?:[.,]\\d+)?)\\s*[-–]\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:ч\\.?|час(?:а|ов)?|часик(?:а)?|часка)');
const DUTY_PING_HOURS_RE = dutyPingWordRe(`(?:через\\s*)?(?:${DUTY_PING_ETA_APPROX_WORDS_PART}\\s*)?(\\d+(?:[.,]\\d+)?)\\s*(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)`);
const DUTY_PING_HOURS_REV_RE = dutyPingWordRe('(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)\\s*(\\d+(?:[.,]\\d+)?)');
const DUTY_PING_HALF_HOUR_WORD_RE = dutyPingWordRe('(?:полчаса|полчасика|пол-часа|пол часа|полчас)');
const DUTY_PING_ONE_AND_HALF_WORD_RE = dutyPingWordRe('(?:полтора\\s*часа|часа\\s*полтора|час-полтора)');
const DUTY_PING_HOUR_MAYBE_ONE_AND_HALF_RE = new RegExp(`${DUTY_PING_WORD_LEFT}час(?:а)?${DUTY_PING_WORD_RIGHT}[^\\n]{0,30}${DUTY_PING_WORD_LEFT}полтора${DUTY_PING_WORD_RIGHT}`, 'iu');
const DUTY_PING_ONE_HOUR_APPROX_RE = dutyPingWordRe(`(?:${DUTY_PING_ETA_APPROX_WORDS_PART})\\s*(?:час|часик(?:а)?|часок)`);
const DUTY_PING_THROUGH_HOUR_RE = dutyPingWordRe('через\\s*(?:часок|часик|час)');
const DUTY_PING_WITHIN_ONE_HOUR_RE = dutyPingWordRe('(?:в\\s+течение|в\\s+течении)\\s*(?:ближайш(?:ий|его)\\s*)?(?:часа|час|часик(?:а)?|часок)');
const DUTY_PING_ONE_HOUR_PLAIN_RE = dutyPingWordRe('час');
const DUTY_PING_WORD_HOURS_RE = dutyPingWordRe(`(?:через\\s*)?(?:${DUTY_PING_ETA_APPROX_WORDS_PART}\\s*)?(один|одна|одну|раз|два|две|двух|пару|пара|пары|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|полтора)\\s*(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)`);
const DUTY_PING_WORD_HOURS_REV_RE = dutyPingWordRe('(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)\\s*(один|одна|одну|раз|два|две|двух|пару|пара|пары|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|полтора)');
const DUTY_PING_WORD_MIN_RE = dutyPingWordRe(`(?:через\\s*)?(?:${DUTY_PING_ETA_APPROX_WORDS_PART}\\s*)?(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|пятнадцать|двадцать|тридцать|сорок)\\s*(?:минут(?:ок|ак)?|мин|m|м)`);
const DUTY_PING_WORD_MIN_REV_RE = dutyPingWordRe('(?:минут(?:ок|ак)?|мин|m|м)\\s*(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|пятнадцать|двадцать|тридцать|сорок)');
const DUTY_PING_WITHIN_WORD_HOURS_RE = dutyPingWordRe('(?:в\\s+течение|в\\s+течении)\\s*(один|одна|одну|раз|два|две|двух|пару|пара|пары|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|полтора)\\s*(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)');
const DUTY_PING_WITHIN_HOURS_RE = dutyPingWordRe('(?:в\\s+течение|в\\s+течении)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:час(?:а|ов)?|часик(?:а)?|часка|ч\\.?)');
const DUTY_PING_REPLY_STREAM_SPLIT_RE = /\s*(?:[-—:–|]|->|=>)\s*/u;
const DUTY_PING_REPLY_TIME_BOUNDARY_RE = dutyPingWordRe(`(?:до|в|к|через|${DUTY_PING_ETA_APPROX_WORDS_PART}|минут(?:ок|ак)?|мин|час(?:а|ов)?|ч\\.?|полтора|полчаса|полчасика|пол-часа|пол часа)`);
const DUTY_PING_REPLY_QUOTED_STREAM_RE = /["«]([^"»]{2,120})["»]/gu;
const DUTY_PING_NUM_WORDS: Record<string, number> = {
  'ноль': 0,
  'один': 1,
  'одна': 1,
  'одну': 1,
  'раз': 1,
  'два': 2,
  'две': 2,
  'двух': 2,
  'пару': 2,
  'пара': 2,
  'пары': 2,
  'три': 3,
  'трех': 3,
  'трёх': 3,
  'четыре': 4,
  'четырех': 4,
  'четырёх': 4,
  'пять': 5,
  'шесть': 6,
  'семь': 7,
  'восемь': 8,
  'восьми': 8,
  'девять': 9,
  'десять': 10,
  'пятнадцать': 15,
  'двадцать': 20,
  'тридцать': 30,
  'сорок': 40,
  'полтора': 1.5,
};

function normDutyPingText(t: string): string {
  return String(t || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[    ]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ');
}

function dutyPingWordValue(word: string): number | null {
  const key = String(word || '').trim().toLocaleLowerCase('ru-RU');
  return Object.prototype.hasOwnProperty.call(DUTY_PING_NUM_WORDS, key) ? DUTY_PING_NUM_WORDS[key] : null;
}

function parseDutyPingMinutesLikeText(text: string): number | null {
  const source = normDutyPingText(text);
  if (!source) return null;

  if (DUTY_PING_THROUGH_HOUR_RE.test(source)) return 60;
  if (DUTY_PING_HALF_HOUR_WORD_RE.test(source)) return 30;
  if (DUTY_PING_ONE_AND_HALF_WORD_RE.test(source)) return 90;
  if (DUTY_PING_HOUR_MAYBE_ONE_AND_HALF_RE.test(source)) return 90;
  if (DUTY_PING_ONE_HOUR_APPROX_RE.test(source)) return 60;
  if (DUTY_PING_WITHIN_ONE_HOUR_RE.test(source)) return 60;
  if (DUTY_PING_ONE_HOUR_FUZZY_RE.test(source)) return 60;
  if (DUTY_PING_ONE_HOUR_PLAIN_RE.test(source)) return 60;

  let match = source.match(DUTY_PING_WITHIN_WORD_HOURS_RE);
  if (match) {
    const value = dutyPingWordValue(match[1] || '');
    if (value != null) return Math.round(value * 60);
  }

  match = source.match(DUTY_PING_WITHIN_HOURS_RE);
  if (match) return Math.round(parseFloat(String(match[1]).replace(',', '.')) * 60);

  match = source.match(DUTY_PING_WORD_HOURS_RE);
  if (match) {
    const value = dutyPingWordValue(match[1] || '');
    if (value != null) return Math.round(value * 60);
  }

  match = source.match(DUTY_PING_WORD_HOURS_REV_RE);
  if (match) {
    const value = dutyPingWordValue(match[1] || '');
    if (value != null) return Math.round(value * 60);
  }

  match = source.match(DUTY_PING_WORD_MIN_RE);
  if (match) {
    const value = dutyPingWordValue(match[1] || '');
    if (value != null) return Math.round(value);
  }

  match = source.match(DUTY_PING_WORD_MIN_REV_RE);
  if (match) {
    const value = dutyPingWordValue(match[1] || '');
    if (value != null) return Math.round(value);
  }

  match = source.match(DUTY_PING_H_SHORT_RE);
  if (match) return Math.round(parseFloat(String(match[1]).replace(',', '.')) * 60);

  match = source.match(DUTY_PING_M_SHORT_RE);
  if (match) return Number(match[1]);

  match = source.match(DUTY_PING_HOURS_RE);
  if (match) return Math.round(parseFloat(String(match[1]).replace(',', '.')) * 60);

  match = source.match(DUTY_PING_HOURS_REV_RE);
  if (match) return Math.round(parseFloat(String(match[1]).replace(',', '.')) * 60);

  match = source.match(DUTY_PING_RANGE_HOURS_RE);
  if (match) {
    const left = parseFloat(String(match[1]).replace(',', '.'));
    const right = parseFloat(String(match[2]).replace(',', '.'));
    return Math.round(Math.max(left, right) * 60);
  }

  match = source.match(DUTY_PING_RANGE_MIN_SUFFIX_RE);
  if (match) return Math.max(Number(match[1]), Number(match[2]));

  match = source.match(DUTY_PING_RANGE_MIN_PREFIX_RE);
  if (match) return Math.max(Number(match[1]), Number(match[2]));

  match = source.match(DUTY_PING_RANGE_NUMBERS_CONTEXT_MIN_RE);
  if (match && /\b(?:минут(?:ок|ак)?|мин|m|м)\b/iu.test(source)) return Math.max(Number(match[1]), Number(match[2]));

  match = source.match(DUTY_PING_MIN_PREFIX_RE);
  if (match) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 24 * 60) return value;
  }

  match = source.match(DUTY_PING_MIN_SUFFIX_RE);
  if (match) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 24 * 60) return value;
  }

  match = source.match(/^\s*(\d{1,3})\s*[!?.,…]?\s*$/u);
  if (match) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 24 * 60) return value;
  }

  return null;
}

function parseDutyPingEta(text: string, createdAtMs: number): string | null {
  const src = normDutyPingText(text);
  if (!src) return null;

  const relativeMinutes = parseDutyPingMinutesLikeText(src);
  if (relativeMinutes != null) {
    return buildDutyPingEtaFromMinutes(createdAtMs, Math.max(0, Math.min(relativeMinutes, 24 * 60)));
  }

  let match = src.match(DUTY_PING_TIME_HHMM_RE);
  if (match) return buildDutyPingEtaFromHHMM(createdAtMs, Number(match[1]), Number(match[2]));

  match = src.match(DUTY_PING_TIME_TO_RE);
  if (match) return buildDutyPingEtaFromHHMM(createdAtMs, Number(match[1]), Number(match[2] || 0));

  match = src.match(DUTY_PING_TIME_H_ONLY_RE);
  if (match) return buildDutyPingEtaFromHHMM(createdAtMs, Number(match[1]), 0);

  return null;
}

// ─── DUTY PING MESSAGE UPDATE HELPERS ─────────────────────────

function lineWithDutyPingStatus(baseLine: string, status: string | null): string {
  let line = String(baseLine || '').trimEnd();
  line = line.replace(/\s*:green_verify:\s*/gi, ' ');
  line = line.replace(/\s*:verified:\s*/gi, ' ');
  line = line.replace(/\s*:multi-search:\s*/gi, ' ');
  line = line.replace(/\s*:spiral_calendar_pad:\s*\d{1,2}\s*[:.]\s*\d{2}\s*/gi, ' ');
  line = line.replace(/\s*:spiral_calendar_pad:\s*/gi, ' ');
  line = line.replace(/\s+/g, ' ').trim();
  return status ? `${line}   ${status}`.trimEnd() : line;
}

function matchDutyPingStreamFromLine(line: string, streamsSorted: string[]): string {
  let value = String(line || '').trimStart();
  value = value.replace(/^[-–—•*✅☑️🟩🟢]+\s*/u, '');
  for (const stream of streamsSorted) {
    if (!value.startsWith(stream)) continue;
    const rest = value.slice(stream.length);
    if (!rest || /[\s\-–—:]/.test(rest[0])) return stream;
  }
  return '';
}

function resolveDutyPingUserStreams(
  username: string,
  streamOrder: string[],
  usernameToStreams: Record<string, string[]>,
  streamToHandle: Record<string, string>,
): string[] {
  const userKey = String(username || '').trim().toLocaleLowerCase('ru-RU');
  if (!userKey) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();
  const direct = Array.isArray(usernameToStreams[userKey]) ? usernameToStreams[userKey] : [];
  for (const stream of direct) {
    if (streamOrder.includes(stream) && !seen.has(stream)) {
      seen.add(stream);
      resolved.push(stream);
    }
  }
  if (resolved.length) return resolved;

  for (const stream of streamOrder) {
    const handle = String(streamToHandle[stream] || '').replace(/^@+/, '').trim().toLocaleLowerCase('ru-RU');
    if (handle && handle !== '?' && handle === userKey && !seen.has(stream)) {
      seen.add(stream);
      resolved.push(stream);
    }
  }
  return resolved;
}

function extractDutyPingReplyStreams(
  text: string,
  allowedStreams: string[],
  streamNorm2Canonical: Record<string, string>,
): string[] {
  const allowed = Array.isArray(allowedStreams) ? allowedStreams.filter(Boolean) : [];
  if (!allowed.length) return [];
  const allowedSet = new Set(allowed);
  const candidates: string[] = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = String(rawLine || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[    ]/g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!line) continue;

    for (const match of line.matchAll(DUTY_PING_REPLY_QUOTED_STREAM_RE)) {
      const quoted = String(match[1] || '').trim().replace(/\s+/g, ' ');
      if (quoted) candidates.push(quoted);
    }

    const prefixSep = line.split(DUTY_PING_REPLY_STREAM_SPLIT_RE, 1)[0].trim();
    if (prefixSep && prefixSep !== line) candidates.push(prefixSep);

    const boundaryMatch = line.match(DUTY_PING_REPLY_TIME_BOUNDARY_RE);
    if (boundaryMatch && Number.isFinite(boundaryMatch.index)) {
      const prefixTime = line.slice(0, boundaryMatch.index).trim().replace(/[-—:–|,.;\s]+$/u, '');
      if (prefixTime && prefixTime !== line) candidates.push(prefixTime);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const matched = matchStream(candidate, streamNorm2Canonical);
    if (!matched || !allowedSet.has(matched) || seen.has(matched)) continue;
    seen.add(matched);
    resolved.push(matched);
  }
  return resolved;
}

function updateDutyPingMessagePreservingBase(
  baseMessage: string,
  streamOrder: string[],
  streamToHandle: Record<string, string>,
  streamToStatus: Record<string, string | null>,
): string {
  const lines = String(baseMessage || '').split(/\r?\n/);
  const updated = new Set<string>();
  const streamsSorted = [...streamOrder].sort((a, b) => b.length - a.length);

  for (let i = 0; i < lines.length; i++) {
    const matched = matchDutyPingStreamFromLine(lines[i], streamsSorted);
    if (!matched) continue;
    const status = Object.prototype.hasOwnProperty.call(streamToStatus, matched) ? streamToStatus[matched] : null;
    if (status == null) { updated.add(matched); continue; }
    lines[i] = lineWithDutyPingStatus(lines[i], status);
    updated.add(matched);
  }

  const missing = streamOrder.filter(s => !updated.has(s));
  if (missing.length) {
    if (lines.length && String(lines[lines.length - 1] || '').trim()) lines.push('');
    for (const stream of missing) {
      const handle = String(streamToHandle[stream] || '?').trim() || '?';
      const status = Object.prototype.hasOwnProperty.call(streamToStatus, stream) ? streamToStatus[stream] : null;
      let line = `${stream} ${handle}`.trimEnd();
      if (status) line = `${line}   ${status}`;
      lines.push(line);
    }
  }
  return lines.join('\n').replace(/\s+$/u, '') + '\n';
}

function markDutyPingMessageAllOk(baseMessage: string, knownStreams: string[]): { message: string; changed: boolean } {
  const lines = String(baseMessage || '').split(/\r?\n/);
  const streamsSorted = [...new Set((Array.isArray(knownStreams) ? knownStreams : []).filter(Boolean))]
    .sort((a, b) => String(b).length - String(a).length);
  let changed = false;

  for (let index = 0; index < lines.length; index++) {
    const matched = matchDutyPingStreamFromLine(lines[index], streamsSorted);
    if (!matched) continue;
    const nextLine = lineWithDutyPingStatus(lines[index], DUTY_PING_OK);
    if (nextLine !== lines[index]) {
      lines[index] = nextLine;
      changed = true;
    }
  }

  return { message: lines.join('\n').replace(/\s+$/u, '') + '\n', changed };
}

function findDutyPingBasePost(
  threadPosts: BandPost[],
  rootId: string,
  userId: string,
  platformLabel: string,
): BandPost | null {
  const root = String(rootId || '').trim();
  const currentUserId = String(userId || '').trim();
  const platformNeedle = String(platformLabel || '').toLocaleLowerCase('ru-RU');
  let found: BandPost | null = null;

  for (const post of Array.isArray(threadPosts) ? threadPosts : []) {
    if (!post || typeof post !== 'object') continue;
    if (Number(post.delete_at) > 0) continue;
    if (String(post.root_id || '').trim() !== root) continue;
    if (currentUserId && String(post.user_id || '').trim() !== currentUserId) continue;
    const lowered = String(post.message || '').toLocaleLowerCase('ru-RU');
    if (!lowered.includes('просьба написать сроки') || !lowered.includes(platformNeedle)) continue;
    if (!found || (Number(post.create_at) || 0) > (Number(found.create_at) || 0)) found = post;
  }

  return found;
}

function findDutyPingRootPostFromFeedPosts(
  platform: 'ios' | 'android',
  release: string,
  feedPosts: BandPost[],
): BandPost | null {
  const platformTag = platform === 'ios' ? '#ios' : '#android';
  const releaseNeedle = String(release || '').trim().toLocaleLowerCase('ru-RU');
  let found: BandPost | null = null;

  for (const post of Array.isArray(feedPosts) ? feedPosts : []) {
    if (!isActiveBandRootPost(post)) continue;
    const lowered = normBandText(post.message).toLocaleLowerCase('ru-RU');
    if (!lowered.includes(platformTag) || !lowered.includes('#release') || !lowered.includes(releaseNeedle)) continue;
    if (!found || getBandCreateAt(post) > getBandCreateAt(found)) found = post;
  }

  return found;
}

async function findDutyPingReleaseFeedRoot(
  platform: 'ios' | 'android',
  release: string,
  proxyBase: string,
  cookies: string,
  signal?: AbortSignal,
): Promise<BandPost> {
  const sinceMs = Date.now() - DUTY_PING_RELEASE_LOOKBACK_MS;
  const activePosts = await bandFetchActiveRootPostsWindow(proxyBase, cookies, FEED_CHANNEL_ID, sinceMs, signal, {
    perPage: 200,
    pageLimit: 24,
  });
  let rootPost = findDutyPingRootPostFromFeedPosts(platform, release, activePosts);

  if (!rootPost) {
    const fallbackPosts = await bandFetchChannelPostsSince(proxyBase, cookies, FEED_CHANNEL_ID, sinceMs, signal);
    rootPost = findDutyPingRootPostFromFeedPosts(platform, release, fallbackPosts);
  }

  if (!rootPost) {
    const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
    throw new Error(`Тред релиза для ${platformLabel} ${release} не найден в ленте релизов — сначала выполни шаг 1.`);
  }
  return rootPost;
}

async function dutyPingTestResultExistsInLaunch(
  testResultId: string,
  launchId: string,
  token: string,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const id = String(testResultId || '').trim();
  if (!id) return true;
  try {
    const data = await proxyRequest<{ launchId?: unknown; launch_id?: unknown }>(
      proxyBase, 'GET', `${ALLURE_BASE}/api/testresult/${encodeURIComponent(id)}`,
      allureHeaders(token), undefined, signal,
    );
    const currentLaunchId = data && (data.launchId ?? data.launch_id);
    if (currentLaunchId == null) return true;
    return String(currentLaunchId) === String(launchId);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    if (/Proxy HTTP 404|Allure HTTP 404/.test(error instanceof Error ? error.message : String(error))) return false;
    return true;
  }
}

function removeDutyPingTrackedStream(
  stream: string,
  streamOrder: string[],
  streamToIds: Record<string, string[]>,
  streamVerified: Record<string, boolean>,
  streamEta: Record<string, string>,
  streamToHandle: Record<string, string>,
  usernameToStreams: Record<string, string[]>,
): string[] {
  const streamName = String(stream || '').trim();
  if (!streamName) return streamOrder;
  delete streamToIds[streamName];
  delete streamVerified[streamName];
  delete streamEta[streamName];
  delete streamToHandle[streamName];
  for (const [login, streams] of Object.entries(usernameToStreams)) {
    const next = (Array.isArray(streams) ? streams : []).filter(item => item !== streamName);
    if (next.length) usernameToStreams[login] = next;
    else delete usernameToStreams[login];
  }
  return streamOrder.filter(item => item !== streamName);
}

// ─── DUTY PING FULL POLLING LOOP ──────────────────────────────

export interface DutyPingState {
  message: string;
  pendingCount: number;
  verifiedCount: number;
  done: boolean;
}

export async function runDutyPingPolling(
  platform: 'ios' | 'android', release: string,
  token: string, proxyBase: string, cookies: string,
  collectionRows: CollectionRow[],
  onState: (state: DutyPingState) => void,
  onLog: (msg: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!token) throw new Error('Нужен Allure токен.');
  if (!cookies.trim()) throw new Error('Band cookies не заданы.');
  if (!release.trim()) throw new Error(`Укажи версию ${platform === 'ios' ? 'iOS' : 'Android'}.`);

  const label = platform === 'ios' ? 'iOS' : 'Android';
  const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
  const aliases = buildHardcodedAliases();
  const excludeSet = buildHardcodedExcludeSet();

  onLog(`[${label}] Ищу запуск готовности в Allure...`);
  const run = await findMajorReadinessRun(platform, release, token, proxyBase, signal);
  if (!run) throw new Error(`Не найден запуск готовности для ${platformLabel} ${release}`);
  const launchId = run.id;
  onLog(`[${label}] launchId: ${launchId}`, 'ok');

  onLog(`[${label}] Получаю pending кейсы...`);
  const initialPendingMap = await fetchDutyPingPendingLeafMap(launchId, token, proxyBase, signal);
  onLog(`[${label}] Pending стримов: ${initialPendingMap.size}`, initialPendingMap.size ? 'ok' : 'warn');

  if (!initialPendingMap.size) {
    let syncedMessage = '';
    try {
      const rootPost = await findDutyPingReleaseFeedRoot(platform, release, proxyBase, cookies, signal);
      const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootPost.id, signal, {
        perPage: 200,
        updatesOnly: true,
        fromUpdateAt: DUTY_PING_THREAD_FROM_UPDATE_AT,
      });
      const existingPost = findDutyPingBasePost(threadPosts, rootPost.id, getCurrentBandUserId(cookies), platformLabel);
      if (existingPost) {
        const knownStreams = [...new Set(
          collectionRows
            .flatMap(row => [row.stream, row.streamDisplay])
            .map(item => String(item || '').trim())
            .filter(Boolean),
        )];
        const synced = markDutyPingMessageAllOk(String(existingPost.message || ''), knownStreams);
        syncedMessage = synced.message;
        if (synced.changed) {
          await bandPatchPost(proxyBase, cookies, existingPost, synced.message, signal);
          onLog(`[${label}] Pending пустой, проставил OK в существующем пинге.`, 'ok');
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      onLog(`[${label}] Не удалось синхронизировать существующий пинг без pending: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
    onState({ message: syncedMessage, pendingCount: 0, verifiedCount: 0, done: true });
    onLog(`[${label}] Нет pending стримов — всё закрыто.`, 'ok');
    return;
  }

  const streamToIds: Record<string, string[]> = {};
  const streamVerified: Record<string, boolean> = {};
  const streamEta: Record<string, string> = {};
  const streamToHandle: Record<string, string> = {};
  let streamOrder: string[] = [];
  const collectionRowNames = collectionRows
    .flatMap(row => [row.stream, row.streamDisplay])
    .map(name => String(name || '').trim())
    .filter(Boolean);
  const collectionStreamNorm2Canonical = buildStreamNorm2Canonical(collectionRowNames, aliases);
  const findCollectionRow = (streamName: string) => {
    const direct = collectionRows.find(row => row.stream === streamName || row.streamDisplay === streamName);
    if (direct) return direct;
    const matched = matchStream(streamName, collectionStreamNorm2Canonical);
    return matched ? collectionRows.find(row => row.stream === matched || row.streamDisplay === matched) : undefined;
  };

  const getStreamHandle = (name: string): string => {
    const row = findCollectionRow(name);
    return String(platform === 'ios' ? (row?.iosDuty || '?') : (row?.androidDuty || '?')).trim() || '?';
  };

  const ensureStream = (name: string, id: string): boolean => {
    const streamName = String(name || '').trim();
    if (!streamName || excludeSet.has(normStr(streamName))) return false;
    if (!streamOrder.includes(streamName)) {
      streamOrder.push(streamName);
      streamVerified[streamName] = false;
    }
    if (!streamToIds[streamName]) streamToIds[streamName] = [];
    if (id && !streamToIds[streamName].includes(id)) streamToIds[streamName].push(id);
    if (!Object.prototype.hasOwnProperty.call(streamToHandle, streamName)) {
      streamToHandle[streamName] = getStreamHandle(streamName);
    }
    return true;
  };

  const sortTrackedStreams = () => {
    streamOrder = sortComponentDisplayTexts(streamOrder);
  };

  for (const [id, name] of initialPendingMap) {
    ensureStream(name, id);
  }
  sortTrackedStreams();

  if (!streamOrder.length) {
    onState({ message: '', pendingCount: 0, verifiedCount: 0, done: true });
    onLog(`[${label}] В pending нет корректных стримов.`, 'warn');
    return;
  }

  const rootPost = await findDutyPingReleaseFeedRoot(platform, release, proxyBase, cookies, signal);
  const rootId = rootPost.id;
  const myUserId = getCurrentBandUserId(cookies);

  onLog(`[${label}] Загружаю пользователей канала...`);
  let userIdToUsername: Record<string, string> = {};
  try {
    userIdToUsername = await bandFetchChannelUsers(FEED_CHANNEL_ID, proxyBase, cookies, signal);
  } catch { /* proceed without usernames */ }
  onLog(`[${label}] Пользователей: ${Object.keys(userIdToUsername).length}`, 'ok');

  const usernameToStreams: Record<string, string[]> = {};
  const trackUsernameForStream = (stream: string) => {
    const login = String(streamToHandle[stream] || '').replace(/^@+/, '').trim().toLocaleLowerCase('ru-RU');
    if (!login || login === '?') return;
    if (!usernameToStreams[login]) usernameToStreams[login] = [];
    if (!usernameToStreams[login].includes(stream)) usernameToStreams[login].push(stream);
  };
  streamOrder.forEach(trackUsernameForStream);

  const buildInitialMessage = () => {
    const lines = [`Коллеги, просьба написать сроки проставления оков по платформе ${platformLabel}`, ''];
    for (const stream of streamOrder) {
      const handle = String(streamToHandle[stream] || '?').trim() || '?';
      lines.push(`${stream} ${handle}`.trimEnd());
    }
    return lines.join('\n').replace(/\s+$/u, '') + '\n';
  };

  const threadPosts0 = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal, {
    perPage: 200,
    updatesOnly: true,
    fromUpdateAt: DUTY_PING_THREAD_FROM_UPDATE_AT,
  });
  let pingPost = findDutyPingBasePost(threadPosts0, rootId, myUserId, platformLabel);
  let pingCreatedAt = pingPost ? Number(pingPost.create_at) : 0;

  let initialMsg = buildInitialMessage();
  if (pingPost) {
    onLog(`[${label}] Найден существующий пинг.`, 'ok');
    initialMsg = String(pingPost.message || initialMsg);
    const knownStreams = [...new Set([
      ...collectionRows.flatMap(row => [row.stream, row.streamDisplay]),
      ...streamOrder,
    ].map(item => String(item || '').trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const line of initialMsg.split(/\r?\n/)) {
      const matched = matchDutyPingStreamFromLine(line, knownStreams);
      if (matched && ensureStream(matched, '')) trackUsernameForStream(matched);
    }
    sortTrackedStreams();
  } else {
    pingPost = await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, normBandText(initialMsg), signal);
    pingCreatedAt = Number(pingPost.create_at);
    onLog(`[${label}] Пинг опубликован.`, 'ok');
  }

  onState({
    message: initialMsg,
    pendingCount: streamOrder.length,
    verifiedCount: 0,
    done: false,
  });

  const seenPostUat: Record<string, number> = {};
  const etaParseWarned = new Set<string>();

  while (true) {
    if (signal?.aborted) break;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    if (signal?.aborted) break;

    try {
      const currentPendingMap = await fetchDutyPingPendingLeafMap(launchId, token, proxyBase, signal);
      const currentPendingIds = new Set(currentPendingMap.keys());
      const currentPendingStreams = new Set<string>();
      let addedStream = false;

      for (const [id, rawName] of currentPendingMap) {
        const streamName = String(rawName || '').trim();
        if (!streamName || excludeSet.has(normStr(streamName))) continue;
        currentPendingStreams.add(streamName);
        const wasKnown = streamOrder.includes(streamName);
        if (ensureStream(streamName, id)) {
          trackUsernameForStream(streamName);
          if (!wasKnown) {
            addedStream = true;
            onLog(`[${label}] Добавлен новый pending-стрим: ${streamName}`, 'warn');
          }
        }
      }
      if (addedStream) sortTrackedStreams();

      for (const stream of [...streamOrder]) {
        const ids = Array.isArray(streamToIds[stream]) ? [...streamToIds[stream]] : [];
        const keepIds: string[] = [];
        for (const testResultId of ids) {
          if (currentPendingIds.has(testResultId)) {
            keepIds.push(testResultId);
            continue;
          }
          const exists = await dutyPingTestResultExistsInLaunch(testResultId, String(launchId), token, proxyBase, signal);
          if (exists) {
            keepIds.push(testResultId);
          } else {
            onLog(`[${label}] TestResult ${testResultId} удален из рана для "${stream}"`, 'warn');
          }
        }
        if (keepIds.length || !ids.length) {
          streamToIds[stream] = keepIds;
        } else {
          streamOrder = removeDutyPingTrackedStream(stream, streamOrder, streamToIds, streamVerified, streamEta, streamToHandle, usernameToStreams);
          onLog(`[${label}] Стрим удален из трекинга: ${stream}`, 'warn');
        }
      }

      for (const stream of streamOrder) {
        const wasVerified = streamVerified[stream];
        const nowPending = currentPendingStreams.has(stream);
        if (!nowPending && !wasVerified) { streamVerified[stream] = true; onLog(`[${label}] OK: ${stream}`, 'ok'); }
        if (nowPending && wasVerified) { streamVerified[stream] = false; onLog(`[${label}] Pending вернулся: ${stream}`, 'warn'); }
      }

      const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal, {
        perPage: 200,
        updatesOnly: true,
        fromUpdateAt: DUTY_PING_THREAD_FROM_UPDATE_AT,
      });

      if (!pingPost || !threadPosts.find(p => p.id === pingPost!.id)) {
        const found = findDutyPingBasePost(threadPosts, rootId, myUserId, platformLabel);
        if (found) {
          pingPost = found;
          pingCreatedAt = Number(found.create_at);
          onLog(`[${label}] Пинг-пост найден заново.`, 'warn');
        }
      }

      if (!pingPost) { onLog(`[${label}] Пинг-пост не найден, следующий цикл...`, 'warn'); continue; }
      const baseMessage = String(pingPost.message || '');
      const activeStreamMap = buildStreamNorm2Canonical(streamOrder, aliases);
      const okInMessage = new Set<string>();
      const streamsSorted = [...streamOrder].sort((a, b) => String(b).length - String(a).length);
      for (const line of baseMessage.split(/\r?\n/)) {
        const matched = matchDutyPingStreamFromLine(line, streamsSorted);
        if (!matched) continue;
        const lowered = line.toLocaleLowerCase('ru-RU');
        if (lowered.includes(':green_verify:') || lowered.includes(':verified:')) {
          okInMessage.add(matched);
        }
        const etaMatch = line.match(/:spiral_calendar_pad:\s*(\d{1,2})\s*[:.]\s*(\d{2})/i);
        if (etaMatch) {
          streamEta[matched] = `${String(Number(etaMatch[1])).padStart(2, '0')}:${etaMatch[2]}`;
        }
      }

      for (const post of threadPosts) {
        if (!post || post.root_id !== rootId || post.id === rootId || post.id === pingPost.id) continue;
        const createdAt = Number(post.create_at);
        if (pingCreatedAt && createdAt < pingCreatedAt) continue;
        const updateAt = Number(post.update_at) || createdAt;
        const prevUat = seenPostUat[post.id];
        if (typeof prevUat === 'number' && updateAt <= prevUat) continue;
        seenPostUat[post.id] = updateAt;

        const username = String(userIdToUsername[String(post.user_id || '')] || '').trim();
        if (!username) continue;
        const matchedStreams = resolveDutyPingUserStreams(username, streamOrder, usernameToStreams, streamToHandle);
        if (!matchedStreams.length) continue;

        const msg = normDutyPingText(post.message);
        const explicitStreams = extractDutyPingReplyStreams(msg, matchedStreams, activeStreamMap);
        const replyStreams = explicitStreams.length ? explicitStreams : matchedStreams;
        const eta = parseDutyPingEta(msg, createdAt);
        if (eta) {
          const changed: string[] = [];
          for (const s of replyStreams) {
            if (streamEta[s] !== eta) {
              streamEta[s] = eta;
              changed.push(s);
            }
          }
          if (changed.length) onLog(`[${label}] ETA для ${changed.join(', ')} (@${username}): ${eta}`, 'ok');
        } else if (!etaParseWarned.has(post.id)) {
          etaParseWarned.add(post.id);
          onLog(`[${label}] Не смог разобрать ETA для ${replyStreams.join(', ')} (@${username}).`, 'warn');
        }
      }

      const streamToStatus: Record<string, string | null> = {};
      for (const stream of streamOrder) {
        if (streamVerified[stream]) { streamToStatus[stream] = DUTY_PING_OK; }
        else if (streamEta[stream]) { streamToStatus[stream] = `${DUTY_PING_ETA} ${streamEta[stream]}`; }
        else { streamToStatus[stream] = okInMessage.has(stream) ? '' : null; }
      }

      const newMessage = updateDutyPingMessagePreservingBase(baseMessage, streamOrder, streamToHandle, streamToStatus);
      if (normBandText(newMessage) !== normBandText(baseMessage)) {
        await bandPatchPost(proxyBase, cookies, pingPost, normBandText(newMessage), signal);
        pingPost = { ...pingPost, message: newMessage };
        onLog(`[${label}] Сообщение-пинг обновлено.`, 'ok');
      }

      if (!streamOrder.length) {
        onState({ message: newMessage, pendingCount: 0, verifiedCount: 0, done: true });
        onLog(`[${label}] Все стримы сняты с трекинга.`, 'ok');
        break;
      }

      const verifiedCount = streamOrder.filter(s => streamVerified[s]).length;
      const pendingCount = streamOrder.length - verifiedCount;
      onState({ message: newMessage, pendingCount, verifiedCount, done: pendingCount === 0 });

      if (pendingCount === 0) {
        onLog(`[${label}] Все стримы закрыты.`, 'ok');
        break;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      onLog(`[${label}] Ошибка цикла: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    }
  }
}

// ─── NAPI HOSTS ────────────────────────────────────────────────

const NAPI_HOSTS_CHANNEL_ID = 'y14x9xytq7y7uduux8worartmh';

export async function fetchNapiHostsText(proxyBase: string, cookies: string, signal?: AbortSignal): Promise<string> {
  const url = `${BAND_BASE}/api/v4/channels/${encodeURIComponent(NAPI_HOSTS_CHANNEL_ID)}/pinned`;
  const data = await proxyRequest<unknown>(proxyBase, 'GET', url, bandReadHeaders(cookies), undefined, signal);
  const payload = unwrapBandPayload(data);
  const posts = collectBandPosts(payload);
  for (const post of posts) {
    if (Number(post.delete_at) > 0) continue;
    const message = String(post.message || '');
    const hostLines = message.split(/\r?\n/).map(l => l.trim()).filter(l => /^(?:\d{1,3}\.){3}\d{1,3}\s+[a-z0-9.-]+$/i.test(l));
    if (hostLines.length) return `Хосты напи:\n${hostLines.join('\n')}`;
  }
  throw new Error('Не удалось найти pinned-сообщение с NAPI-хостами.');
}

// ─── NON-MAJOR FEED POST ───────────────────────────────────────

function buildNonMajorThreadMessage(
  release: string, run: LaunchRecord, boardUrl: string,
  ticketKey: string, ticketUrl: string, buildValue: string,
): string {
  const p = getMskParts(Date.now());
  const today = `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
  const buildText = String(buildValue || '').trim();
  const releaseTaskLine = ticketKey && ticketUrl
    ? `Релизный таск: [${ticketKey}](${ticketUrl})`
    : 'Релизный таск: -';
  return [
    `OS версия: ${release}`,
    `Ссылка на доску: ${String(boardUrl || '').trim()}`,
    '',
    releaseTaskLine,
    '',
    `Сроки готовности сборок: ${today}`,
    `Сроки выкатки: ${today}`,
    `Ориентировочное время старта регресса: ${today}`,
    `Ожидаемое время окончания проверки: ${today}`,
    buildText ? `Сборка: ${buildText}` : 'Сборка:',
    `Ран: [${run.name}](${run.url})`,
  ].join('\n');
}

export type NonMajorFeedPreviewItem = { rootMessage: string; threadMessage: string };

export function buildNonMajorSwatText(copyMessage: string, leadTag: string, napiHostsText?: string): string {
  let text = `${copyMessage}\n\nSWAT${leadTag ? `\n${leadTag}` : ''}`.trim();
  if (napiHostsText) text = `${text}\n\n${napiHostsText}`.trim();
  return text;
}

export function buildNonMajorFeedPreviewItems(
  mode: RunMode, release: string, runs: LaunchRecord[], buildValue: string,
  boardUrl: string, ticketKey: string, ticketUrl: string,
): NonMajorFeedPreviewItem[] {
  if (!release.trim()) throw new Error('Укажи версию релиза.');

  if (mode === 'hf_android') {
    const run = runs.find(r => String(r.name || '').includes('[Android]')) || runs[0];
    if (!run) throw new Error('Не нашёл ссылку на ран Android.');
    return [{ rootMessage: `#Android #Hotfix ${release}`, threadMessage: buildNonMajorThreadMessage(release, run, boardUrl, ticketKey, ticketUrl, buildValue) }];
  }

  if (mode === 'hf_ios') {
    const run = runs.find(r => /\[iOS\]|\[IOS\]/i.test(String(r.name || ''))) || runs[0];
    if (!run) throw new Error('Не нашёл ссылку на ран iOS.');
    return [{ rootMessage: `#iOS #Hotfix ${release}`, threadMessage: buildNonMajorThreadMessage(release, run, boardUrl, ticketKey, ticketUrl, buildValue) }];
  }

  if (mode === 'rustore_critical' || mode === 'rustore_smoke') {
    const huaweiRun = runs.find(r => String(r.name || '').includes('AppGallery'));
    const rustoreRun = runs.find(r => /RuStore|Rustore/.test(String(r.name || '')));
    if (!huaweiRun || !rustoreRun) throw new Error('Не нашёл ссылки на раны AppGallery/RuStore.');
    return [
      { rootMessage: `#Android #Release #Huawei ${release}`, threadMessage: buildNonMajorThreadMessage(release, huaweiRun, boardUrl, ticketKey, ticketUrl, buildValue) },
      { rootMessage: `#Android #Release #Rustore ${release}`, threadMessage: buildNonMajorThreadMessage(release, rustoreRun, boardUrl, ticketKey, ticketUrl, buildValue) },
    ];
  }

  throw new Error('Для выбранного режима публикация в ленту релизов не поддерживается.');
}

export async function publishNonMajorFeedPosts(
  mode: RunMode, release: string, runs: LaunchRecord[], buildValue: string,
  boardUrl: string, ticketKey: string, ticketUrl: string,
  proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<void> {
  if (!cookies.trim()) throw new Error('Band cookies не заданы — заполни в Настройках.');
  if (!release.trim()) throw new Error('Укажи версию релиза.');
  const userId = getCurrentBandUserId(cookies);
  const channelPosts = await bandFetchChannelPostsSince(proxyBase, cookies, FEED_CHANNEL_ID, Date.now() - RELEASE_FEED_LOOKBACK_MS, signal);
  const posts = buildNonMajorFeedPreviewItems(mode, release, runs, buildValue, boardUrl, ticketKey, ticketUrl);

  for (const item of posts) {
    let rootPost = findLatestRootPostByMessage(channelPosts, item.rootMessage, userId);
    let rootId: string;
    if (!rootPost) {
      onLog(`Публикую "${item.rootMessage}"...`);
      const created = await bandPostMessage(proxyBase, cookies, normBandText(item.rootMessage), { channelId: FEED_CHANNEL_ID }, signal);
      rootId = String(created.id || '');
      onLog(`Корень опубликован: #${rootId}`, 'ok');
    } else {
      rootId = String(rootPost.id || '');
      onLog(`Найден существующий тред "${item.rootMessage}"`, 'ok');
    }
    const threadPosts = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
    const existing = findEarliestOwnThreadPost(threadPosts, rootId, userId);
    const normalized = normBandText(item.threadMessage);
    if (existing) {
      if (normBandText(existing.message) !== normalized) {
        await bandPatchPost(proxyBase, cookies, existing, normalized, signal);
        onLog(`Тред обновлён: "${item.rootMessage}"`, 'ok');
      } else {
        onLog(`Тред уже актуален: "${item.rootMessage}"`, 'ok');
      }
    } else {
      await bandCreateReply(proxyBase, cookies, FEED_CHANNEL_ID, rootId, normalized, signal);
      onLog(`Тред опубликован: "${item.rootMessage}"`, 'ok');
    }
    if (posts.length > 1) await new Promise<void>(r => setTimeout(r, 150));
  }
}

// ─── AUTO-RESOLVE BUILD VALUE ───────────────────────────────────

const RELEASE_ANDROID_BOT_USERNAME = 'release-android-bot';
const IOS_BUILDS_CHANNEL_ID = 'sm7z55bao7gmumy7cbxq31159y';
const IOS_BUILDS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ANDROID_BOT_REPLY_DELAY_MS = 10_000;
const ANDROID_BOT_POLL_MS = 2_000;
const ANDROID_BOT_TIMEOUT_MS = 30_000;

function formatReleaseShort(release: string): string {
  const parts = String(release || '').trim().split('.').map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return String(release || '').trim();
  const last = parts[parts.length - 1].replace(/0+$/, '') || '0';
  parts[parts.length - 1] = last;
  return parts.join('.');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function bandFindUserByUsername(
  proxyBase: string, cookies: string, username: string, signal?: AbortSignal,
): Promise<{ id: string; username: string }> {
  const data = await proxyRequest<{ id?: string; username?: string }>(
    proxyBase, 'GET',
    `${BAND_BASE}/api/v4/users/username/${encodeURIComponent(username)}`,
    bandReadHeaders(cookies), undefined, signal,
  );
  const id = String(data?.id || '').trim();
  if (!id) throw new Error(`Пользователь "${username}" не найден в Band.`);
  return { id, username: String(data?.username || username) };
}

async function bandOpenDirectChannel(
  proxyBase: string, cookies: string, otherUserId: string, signal?: AbortSignal,
): Promise<string> {
  const myUserId = getCurrentBandUserId(cookies);
  const data = await proxyRequest<{ id?: string }>(
    proxyBase, 'POST', `${BAND_BASE}/api/v4/channels/direct`,
    bandGetHeaders(cookies), [myUserId, otherUserId], signal,
  );
  const channelId = String(data?.id || '').trim();
  if (!channelId) throw new Error('Не удалось открыть direct-канал с ботом.');
  return channelId;
}

export async function resolveIosBuildFromBand(
  release: string, proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<string> {
  const rel = String(release || '').trim();
  if (!rel) throw new Error('Укажи версию релиза.');
  const sinceMs = Date.now() - IOS_BUILDS_LOOKBACK_MS;
  onLog(`Сборка: ищу iOS сборку по релизу ${rel} в канале сборок...`);
  let posts: BandPost[] = [];
  try {
    onLog('Сборка: читаю канал сборок за последние 7 дней...');
    posts = await bandFetchActiveRootPostsWindow(proxyBase, cookies, IOS_BUILDS_CHANNEL_ID, sinceMs, signal, {
      perPage: 100,
      pageLimit: 60,
    });
  } catch (error) {
    onLog(`iOS сборка: не удалось прочитать канал сборок: ${error instanceof Error ? error.message : String(error)}`, 'warn');
  }
  const re = new RegExp(`${escapeRegExp(rel)}\\s*\\((\\d+)\\)`, 'i');
  let found: { buildValue: string; createdAt: number } | null = null;
  for (const post of posts) {
    if (Number(post.delete_at) > 0) continue;
    if (String(post.root_id || '').trim()) continue;
    const text = String(post.message || '');
    if (!/testflight/i.test(text)) continue;
    const match = text.match(re);
    if (!match) continue;
    const buildValue = `${rel}(${match[1]})`;
    const createdAt = Number(post.create_at) || 0;
    if (!found || createdAt > found.createdAt) found = { buildValue, createdAt };
  }
  if (!found) { onLog('iOS сборка: не найдена в канале.', 'warn'); return ''; }
  onLog(`Сборка найдена: ${found.buildValue}`, 'ok');
  return found.buildValue;
}

export async function resolveAndroidBuildFromBot(
  mode: RunMode, release: string, proxyBase: string, cookies: string,
  onLog: (msg: string, level?: LogLevel) => void, signal?: AbortSignal,
): Promise<string> {
  const rel = String(release || '').trim();
  if (!rel) throw new Error('Укажи версию релиза.');

  let command: string;
  if (mode === 'hf_android') {
    command = `lastpipe ${rel}`;
  } else {
    const short = formatReleaseShort(rel).replace(/\./g, '');
    if (!short) throw new Error('Не удалось вычислить короткий номер релиза для бота.');
    command = `руху все ${short}`;
  }

  onLog(`Ищу DM-канал с ${RELEASE_ANDROID_BOT_USERNAME}...`);
  const botUser = await bandFindUserByUsername(proxyBase, cookies, RELEASE_ANDROID_BOT_USERNAME, signal);
  const channelId = await bandOpenDirectChannel(proxyBase, cookies, botUser.id, signal);
  onLog(`DM-канал найден. Отправляю: "${command}"`);

  const rootPost = await bandPostMessage(proxyBase, cookies, command, { channelId }, signal);
  const rootId = String(rootPost.id || '').trim();
  if (!rootId) {
    if (mode === 'hf_android') {
      onLog('Сборка: не удалось создать тред запроса к release-android-bot, продолжаю без pipeline.', 'warn');
      return '';
    }
    throw new Error('Не удалось отправить сообщение боту.');
  }

  onLog('Жду ответ бота...');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ANDROID_BOT_REPLY_DELAY_MS);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

  const deadline = Date.now() + ANDROID_BOT_TIMEOUT_MS;
  const pipelineRe = /https:\/\/gitlab\.wildberries\.ru\/[^\s)]+\/-\/pipelines\/\d+(?:[^\s)]*)?/i;
  let lastBotMessage = '';

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const replies = await bandFetchThreadPosts(proxyBase, cookies, rootId, signal);
    for (const reply of replies) {
      if (reply.id === rootId || reply.user_id !== botUser.id) continue;
      const msg = String(reply.message || '');
      if (msg.trim()) lastBotMessage = msg;
      const m = msg.match(pipelineRe);
      if (m) { onLog(`Pipeline URL найден: ${m[0]}`, 'ok'); return m[0]; }
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ANDROID_BOT_POLL_MS);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  const tail = lastBotMessage
    ? ` Последний ответ бота: ${lastBotMessage.replace(/\s+/g, ' ').trim().slice(0, 220)}`
    : '';
  if (mode === 'hf_android') {
    onLog(`Сборка: pipeline ещё не появился, продолжаю без него.${tail}`, 'warn');
    return '';
  }
  throw new Error(`Не удалось получить ссылку на pipeline от release-android-bot.${tail}`);
}
