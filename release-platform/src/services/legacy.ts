import { MODULES, type ModuleDefinition, type ModuleId } from '../config/modules';
import { normalizeSettings, type AppSettings, type Role } from '../types';

export interface RbacRole {
  id: string;
  label: string;
}

export interface RbacUser {
  login: string;
  pass: string;
  role: string;
}

export interface UserAccessConfig {
  useRole?: boolean;
  access?: string[];
}

export interface RbacConfig {
  roles: RbacRole[];
  users: RbacUser[];
  roleAccess: Record<string, string[]>;
  userAccess: Record<string, UserAccessConfig>;
}

export const AUTH_KEY = 'rb_auth_ok_v1';
export const USER_KEY = 'rb_user_v1';
export const ROLE_KEY = 'rb_role_v1';
export const ACCESS_KEY = 'rb_role_access_v1';
export const USER_ACCESS_KEY = 'rb_user_access_v1';
export const USERS_OVERRIDE_KEY = 'rb_users_override_v1';

const DEFAULT_ROLES: RbacRole[] = [
  { id: 'superadmin', label: 'Суперадмин' },
  { id: 'admin', label: 'Администратор' },
  { id: 'manager', label: 'Менеджер' },
  { id: 'analyst', label: 'Аналитик' },
  { id: 'viewer', label: 'Наблюдатель' },
];

const PROXY_RUNTIME_KEY = 'rb_proxy_runtime_v1';
const ML_HELPER_RUNTIME_KEY = 'rb_ml_helper_runtime_v1';
const DASHBOARD_BASE_URL_KEY = 'rb__baseUrl';
const DASHBOARD_TOKEN_KEY = 'rb__token';
const DASHBOARD_PROJECT_ID_KEY = 'rb__projectId';
const SHARED_ALLURE_TOKEN_KEY = 'swat_uwu_token';
const YT_TOKEN_KEY = 'wb_all_table_yt_token';
const DEPLOY_TOKEN_KEY = 'wb_all_table_deploy_token';
const RELEASE_DEPLOY_TOKEN_KEY = 'wb_release_launch_deploy_lab_token';
const GITLAB_COOKIE_KEY = 'wb_all_table_gitlab_cookie';
const GITLAB_TOKEN_KEY = 'wb_all_table_gitlab_token';
const BI_USERS_SETTINGS_KEY = 'bi_users_calc_settings_v1';
const WIKI_TOKEN_KEY = 'wb_all_table_wiki_token';
const BAND_COOKIES_KEY = 'wb_all_table_band_read_cookies';
const BAND_COOKIES_LEGACY_KEY = 'band_android_rollout_v1_band_cookies';
const BAND_PROXY_KEY = 'band_android_rollout_v1_proxy_base';
const GRAPHS_LLM_BASE_KEY = 'wb_graphs_ai_llm_base_url';
const GRAPHS_LLM_MODEL_KEY = 'wb_graphs_ai_llm_model';
const GRAPHS_LLM_API_KEY = 'wb_graphs_ai_llm_api_key';
const LAUNCH_SETTINGS_KEY = 'wb_release_launch_settings_v1';
const CHP_STORAGE_KEYS = ['chp_turtles_v1_0_3', 'chp_turtles_v1_0_2'];

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function readText(key: string): string {
  try {
    return String(localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function readChpStoredGitlabToken(): string {
  try {
    for (const key of CHP_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { gitlabToken?: string } | null;
      const token = String(parsed?.gitlabToken || '').trim();
      if (token) return token;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function syncChpStoredGitlabToken(token: string) {
  try {
    const raw = localStorage.getItem(CHP_STORAGE_KEYS[0]);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    localStorage.setItem(CHP_STORAGE_KEYS[0], JSON.stringify({
      ...parsed,
      gitlabToken: token,
      savedAt: Date.now(),
    }));
  } catch {
    /* ignore */
  }
}

function normalizeProxyMode(mode: unknown): AppSettings['proxyMode'] {
  return mode === 'prefix' ? 'prefix' : 'query';
}

function normalizeRole(role: string): Role {
  if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'analyst' || role === 'viewer') return role;
  return 'viewer';
}

export function getRoleLabel(role: string, roles: RbacRole[]): string {
  return roles.find(item => item.id === role)?.label || role;
}

export function getLegacyAssetUrl(filePath: string): string {
  const baseUrl = new URL(document.baseURI || window.location.origin);
  return new URL(`legacy/${filePath}`, baseUrl).toString();
}

export function buildLegacyModuleUrl(module: ModuleDefinition, settings: AppSettings): string {
  const url = new URL(getLegacyAssetUrl(module.legacyId));
  if (settings.proxyBase.trim()) {
    url.searchParams.set('rbProxyBase', settings.proxyBase.trim());
    url.searchParams.set('rbProxyMode', settings.proxyMode);
    url.searchParams.set('rbUseProxy', settings.useProxy ? '1' : '0');
  }
  url.searchParams.set('shell', 'release-platform');
  return url.toString();
}

export function getDefaultRoleAccess(): Record<string, string[]> {
  const all = MODULES.filter(module => !module.explicitAccess).map(module => module.legacyId);
  const analyst = all.filter(id => /dashboard|Графики|BiUser|Популярные/u.test(id));
  return {
    superadmin: ['*', 'access-management'],
    admin: ['*', 'access-management'],
    manager: all.slice(),
    analyst: analyst.length ? analyst : all.slice(0, 1),
    viewer: all.slice(0, 1),
  };
}

export function resolveAllowedLegacyIds(login: string, role: string, roleAccess: Record<string, string[]>, userAccess: Record<string, UserAccessConfig>): Set<string> {
  const override = userAccess[login];
  if (override && override.useRole === false) {
    return new Set((override.access || []).filter(Boolean));
  }

  const list = roleAccess[role] || [];
  if (list.includes('*')) {
    const explicit = list.filter(item => item !== '*');
    return new Set([
      ...MODULES.filter(module => !module.explicitAccess).map(module => module.legacyId),
      ...explicit,
    ]);
  }
  return new Set(list);
}

export function canAccessModule(module: ModuleDefinition, role: string, allowedLegacyIds: Set<string>): boolean {
  if (module.superadminOnly && role !== 'superadmin') return false;
  if (module.id === 'access' && (role === 'superadmin' || role === 'admin')) return true;
  return allowedLegacyIds.has(module.legacyId);
}

export function getFirstAllowedModuleId(login: string, role: string, roleAccess: Record<string, string[]>, userAccess: Record<string, UserAccessConfig>): ModuleId {
  const allowedLegacyIds = resolveAllowedLegacyIds(login, role, roleAccess, userAccess);
  const fallback = MODULES.find(module => canAccessModule(module, role, allowedLegacyIds) && !module.openNewTab)
    || MODULES.find(module => canAccessModule(module, role, allowedLegacyIds))
    || MODULES[0];
  return fallback.id;
}

export async function loadRbacConfig(): Promise<RbacConfig> {
  const response = await fetch(getLegacyAssetUrl('rb_roles_access.json'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`RBAC config HTTP ${response.status}`);
  }

  const text = await response.text();
  let raw: Partial<RbacConfig>;
  try {
    raw = JSON.parse(text) as Partial<RbacConfig>;
  } catch {
    throw new Error('RBAC config вернул не JSON. Проверь /legacy/rb_roles_access.json.');
  }

  const localRoleAccess = readJson<Record<string, string[]>>(ACCESS_KEY) || {};
  const localUserAccess = readJson<Record<string, UserAccessConfig>>(USER_ACCESS_KEY) || {};

  const localUsers = readJson<RbacUser[]>(USERS_OVERRIDE_KEY);
  const baseUsers = Array.isArray(raw.users) ? raw.users : [];
  const mergedUsers = localUsers && localUsers.length
    ? localUsers
    : baseUsers;

  return {
    roles: Array.isArray(raw.roles) && raw.roles.length ? raw.roles : DEFAULT_ROLES,
    users: mergedUsers,
    roleAccess: { ...getDefaultRoleAccess(), ...(raw.roleAccess || {}), ...localRoleAccess },
    userAccess: { ...(raw.userAccess || {}), ...localUserAccess },
  };
}

export function persistLocalUsers(users: RbacUser[]) {
  writeJson(USERS_OVERRIDE_KEY, users);
}

export function persistLocalRoleAccess(roleAccess: Record<string, string[]>) {
  writeJson(ACCESS_KEY, roleAccess);
}

export function persistLocalUserAccess(userAccess: Record<string, UserAccessConfig>) {
  writeJson(USER_ACCESS_KEY, userAccess);
}

export function clearLocalAccessOverrides() {
  try {
    localStorage.removeItem(USERS_OVERRIDE_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(USER_ACCESS_KEY);
  } catch { /* ignore */ }
}

export function readStoredAuth() {
  const authed = readText(AUTH_KEY) === '1';
  const login = readText(USER_KEY);
  const role = normalizeRole(readText(ROLE_KEY));
  return { authed, login, role };
}

export function persistAuth(login: string, role: string) {
  try {
    localStorage.setItem(AUTH_KEY, '1');
    localStorage.setItem(USER_KEY, login);
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
  } catch {
    /* ignore */
  }
}

export function readLegacyBootstrapSettings(): Partial<AppSettings> {
  const proxyRuntime = readJson<{ base?: string; mode?: string; useProxy?: boolean }>(PROXY_RUNTIME_KEY);
  const mlHelperRuntime = readJson<{ base?: string }>(ML_HELPER_RUNTIME_KEY);
  const biUsersSettings = readJson<{ cookie?: string }>(BI_USERS_SETTINGS_KEY);

  return {
    proxyBase: proxyRuntime?.base || readText(BAND_PROXY_KEY) || undefined,
    proxyMode: normalizeProxyMode(proxyRuntime?.mode),
    useProxy: proxyRuntime?.useProxy !== false,
    allureBase: readText(DASHBOARD_BASE_URL_KEY) || undefined,
    allureToken: readText(SHARED_ALLURE_TOKEN_KEY) || readText(DASHBOARD_TOKEN_KEY) || undefined,
    projectId: readText(DASHBOARD_PROJECT_ID_KEY) || undefined,
    ytToken: readText(YT_TOKEN_KEY) || undefined,
    biCookie: biUsersSettings?.cookie || undefined,
    deployLabToken: readText(RELEASE_DEPLOY_TOKEN_KEY) || readText(DEPLOY_TOKEN_KEY) || undefined,
    gitlabCookie: readText(GITLAB_COOKIE_KEY) || undefined,
    gitlabToken: readText(GITLAB_TOKEN_KEY) || readChpStoredGitlabToken() || undefined,
    wikiToken: readText(WIKI_TOKEN_KEY) || undefined,
    bandCookies: readText(BAND_COOKIES_KEY) || readText(BAND_COOKIES_LEGACY_KEY) || undefined,
    glmBase: readText(GRAPHS_LLM_BASE_KEY) || undefined,
    glmModel: readText(GRAPHS_LLM_MODEL_KEY) || undefined,
    glmKey: readText(GRAPHS_LLM_API_KEY) || undefined,
    mlHelperBase: mlHelperRuntime?.base || undefined,
  };
}

export function syncLegacySettings(settings: AppSettings) {
  const safe = normalizeSettings(settings);

  writeJson(PROXY_RUNTIME_KEY, {
    base: safe.proxyBase.trim(),
    mode: safe.proxyMode,
    useProxy: safe.useProxy,
  });
  writeJson(ML_HELPER_RUNTIME_KEY, { base: safe.mlHelperBase.trim() });
  writeJson(BI_USERS_SETTINGS_KEY, {
    ...(readJson<Record<string, unknown>>(BI_USERS_SETTINGS_KEY) || {}),
    proxyBase: safe.proxyBase.trim(),
    proxyMode: safe.proxyMode,
    useProxy: safe.useProxy,
    cookie: safe.biCookie,
  });

  try {
    localStorage.setItem(DASHBOARD_BASE_URL_KEY, safe.allureBase.trim());
    localStorage.setItem(DASHBOARD_TOKEN_KEY, safe.allureToken.trim());
    localStorage.setItem(DASHBOARD_PROJECT_ID_KEY, safe.projectId.trim());
    localStorage.setItem(SHARED_ALLURE_TOKEN_KEY, safe.allureToken.trim());
    localStorage.setItem(YT_TOKEN_KEY, safe.ytToken.trim());
    localStorage.setItem(DEPLOY_TOKEN_KEY, safe.deployLabToken.trim());
    localStorage.setItem(RELEASE_DEPLOY_TOKEN_KEY, safe.deployLabToken.trim());
    localStorage.setItem(GITLAB_COOKIE_KEY, safe.gitlabCookie);
    localStorage.setItem(GITLAB_TOKEN_KEY, safe.gitlabToken.trim());
    localStorage.setItem(WIKI_TOKEN_KEY, safe.wikiToken);
    localStorage.setItem(BAND_COOKIES_KEY, safe.bandCookies);
    localStorage.setItem(BAND_COOKIES_LEGACY_KEY, safe.bandCookies);
    localStorage.setItem(BAND_PROXY_KEY, safe.proxyBase.trim());
    localStorage.setItem(GRAPHS_LLM_BASE_KEY, safe.glmBase.trim());
    localStorage.setItem(GRAPHS_LLM_MODEL_KEY, safe.glmModel.trim());
    localStorage.setItem(GRAPHS_LLM_API_KEY, safe.glmKey.trim());
  } catch {
    /* ignore */
  }

  syncChpStoredGitlabToken(safe.gitlabToken.trim());

  const launchSettings = {
    ...(readJson<Record<string, unknown>>(LAUNCH_SETTINGS_KEY) || {}),
    proxyBase: safe.proxyBase.trim(),
    allureCookies: safe.allureToken.trim(),
    bandCookiesRead: safe.bandCookies,
    bandCookiesAdmin: safe.bandCookies,
  };
  writeJson(LAUNCH_SETTINGS_KEY, launchSettings);
}
