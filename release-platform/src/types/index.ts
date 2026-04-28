/* ─── ROLES ───────────────────────────────────────────────── */
export type Role = 'superadmin' | 'admin' | 'manager' | 'analyst' | 'viewer';

export interface User {
  login: string;
  role: Role;
}

/* ─── SETTINGS ────────────────────────────────────────────── */
export const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby1MNW_-mbMh8ukBs94kOc0KXM43yZae7gmCgSLoK9a4Tx3F0JY4lMdQHoWhxyJ1j1XYQ/exec';

export interface AppSettings {
  proxyBase:    string;
  proxyMode:    'query' | 'prefix';
  useProxy:     boolean;
  allureBase:   string;
  allureToken:  string;
  ytBase:       string;
  ytToken:      string;
  biCookie:     string;
  glmBase:      string;
  glmKey:       string;
  glmModel:     string;
  mlHelperBase: string;
  projectId:    string;
  deployLabToken: string;
  gitlabCookie:  string;
  gitlabToken:   string;
  wikiToken:     string;
  webSearchKey:  string;
  bandCookies:      string;
  bandCookiesAdmin: string;
}

export function normalizeGlmBase(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let normalized = raw.replace(/\/+$/, '');
  normalized = normalized.replace(/\/v1\/chat\/completions$/i, '/v1');
  normalized = normalized.replace(/\/chat\/completions$/i, '');

  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function normalizeYtBase(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return 'https://youtrack.wildberries.ru';

  try {
    const url = new URL(raw);
    if (url.hostname === 'youtrack.wb.ru') {
      url.hostname = 'youtrack.wildberries.ru';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace('youtrack.wb.ru', 'youtrack.wildberries.ru').replace(/\/+$/, '') || 'https://youtrack.wildberries.ru';
  }
}

function normalizeDeployLabToken(value: unknown): string {
  const raw = String(value || '').trim();
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

export const DEFAULT_SETTINGS: AppSettings = {
  proxyBase:    'http://localhost:8787',
  proxyMode:    'query',
  useProxy:     true,
  allureBase:   'https://allure-testops.wb.ru',
  allureToken:  '',
  ytBase:       'https://youtrack.wildberries.ru',
  ytToken:      '',
  biCookie:     '',
  glmBase:      'http://localhost:8789/v1',
  glmKey:       '',
  glmModel:     'glm-4',
  mlHelperBase: 'http://127.0.0.1:8788',
  projectId:    '7',
  deployLabToken: '',
  gitlabCookie:  '',
  gitlabToken:   '',
  wikiToken:     '',
  webSearchKey:  '',
  bandCookies:      '',
  bandCookiesAdmin: '',
};

export function normalizeSettings(input?: Partial<AppSettings> | null): AppSettings {
  const value = input || {};

  return {
    proxyBase: typeof value.proxyBase === 'string' ? value.proxyBase : DEFAULT_SETTINGS.proxyBase,
    proxyMode: value.proxyMode === 'prefix' ? 'prefix' : DEFAULT_SETTINGS.proxyMode,
    useProxy: typeof value.useProxy === 'boolean' ? value.useProxy : DEFAULT_SETTINGS.useProxy,
    allureBase: typeof value.allureBase === 'string' ? value.allureBase : DEFAULT_SETTINGS.allureBase,
    allureToken: typeof value.allureToken === 'string' ? value.allureToken : DEFAULT_SETTINGS.allureToken,
    ytBase: normalizeYtBase(typeof value.ytBase === 'string' ? value.ytBase : DEFAULT_SETTINGS.ytBase),
    ytToken: typeof value.ytToken === 'string' ? value.ytToken : DEFAULT_SETTINGS.ytToken,
    biCookie: typeof value.biCookie === 'string' ? value.biCookie : DEFAULT_SETTINGS.biCookie,
    glmBase: typeof value.glmBase === 'string' ? normalizeGlmBase(value.glmBase) : DEFAULT_SETTINGS.glmBase,
    glmKey: typeof value.glmKey === 'string' ? value.glmKey : DEFAULT_SETTINGS.glmKey,
    glmModel: typeof value.glmModel === 'string' ? value.glmModel : DEFAULT_SETTINGS.glmModel,
    mlHelperBase: typeof value.mlHelperBase === 'string' ? value.mlHelperBase : DEFAULT_SETTINGS.mlHelperBase,
    projectId: typeof value.projectId === 'string' ? value.projectId : DEFAULT_SETTINGS.projectId,
    deployLabToken: normalizeDeployLabToken(typeof value.deployLabToken === 'string' ? value.deployLabToken : DEFAULT_SETTINGS.deployLabToken),
    gitlabCookie: typeof value.gitlabCookie === 'string' ? value.gitlabCookie : DEFAULT_SETTINGS.gitlabCookie,
    gitlabToken: typeof value.gitlabToken === 'string' ? value.gitlabToken : DEFAULT_SETTINGS.gitlabToken,
    wikiToken: typeof value.wikiToken === 'string' ? value.wikiToken : DEFAULT_SETTINGS.wikiToken,
    webSearchKey: typeof value.webSearchKey === 'string' ? value.webSearchKey : DEFAULT_SETTINGS.webSearchKey,
    bandCookies: typeof value.bandCookies === 'string' ? value.bandCookies : DEFAULT_SETTINGS.bandCookies,
    bandCookiesAdmin: typeof value.bandCookiesAdmin === 'string' ? value.bandCookiesAdmin : DEFAULT_SETTINGS.bandCookiesAdmin,
  };
}

/* ─── ALLURE TYPES ────────────────────────────────────────── */
export interface AllureLaunch {
  id:         number;
  name:       string;
  status:     'RUNNING' | 'DONE' | 'BROKEN' | 'CANCELED';
  createdDate: number;
  duration:   number;
  statistic: {
    total:      number;
    passed:     number;
    failed:     number;
    broken:     number;
    skipped:    number;
    unknown:    number;
  };
  tags:       string[];
}

export interface AllureLaunchResult {
  id:        number;
  name:      string;
  platform:  'android' | 'ios' | 'napi' | 'other';
  type:      'smoke' | 'selective' | 'high_blocker' | 'regression' | 'other';
  total:     number;
  finished:  number;
  remaining: number;
  in_progress: number;
  pct:       number;
  status:    AllureLaunch['status'];
  createdDate: number;
  stream:    string;
}

export interface ReleaseReadiness {
  version:  string;
  android: {
    critical:   number;
    smoke:      number;
    regression: number;
    napi:       number;
  };
  ios: {
    critical:   number;
    smoke:      number;
    regression: number;
    napi:       number;
  };
  total:    number;
  finished: number;
  remaining: number;
  in_progress: number;
}

/* ─── LAUNCH MODES ────────────────────────────────────────── */
export type RunMode =
  | 'major'
  | 'hf_android'
  | 'hf_ios'
  | 'napi'
  | 'sunday_devices'
  | 'rustore_critical'
  | 'rustore_smoke';

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  major:           'Мажорный релиз',
  hf_android:      'ХФ Android',
  hf_ios:          'ХФ iOS',
  napi:            'NAPI',
  sunday_devices:  'Воскресные раны устройств',
  rustore_critical:'RuStore / AppGallery (Крит-путь)',
  rustore_smoke:   'RuStore / AppGallery (Smoke)',
};

/* ─── CHARTS DATA ─────────────────────────────────────────── */
export interface ReleaseMetrics {
  release:          string;
  tc_total:         number;
  tc_manual:        number;
  tc_auto:          number;
  tc_total_delta:   number;
  cov_swat:         number;
  cov_stream:       number;
  sel_swat:         number;
  sel_stream:       number;
  avg_total_delta:  number;
  chp_total:        number;
  chp_prod:         number;
  chp_bug:          number;
  chp_crash:        number;
  chp_vlet:         number;
  chp_total_delta:  number;
  anom_score:       number;
  release_anoms:    number;
  type_anoms:       number;
  platform_anoms:   number;
}

/* ─── ML ──────────────────────────────────────────────────── */
export interface MLPrediction {
  risk:     number;
  label:    0 | 1;
  features: number[];
}

/* ─── BI USERS ────────────────────────────────────────────── */
export interface BiVersionRow {
  version:     string;
  iosUsers:    number;
  androidUsers:number;
  iosPct:      number;
  androidPct:  number;
  iosDelta:    number;
  androidDelta:number;
}

/* ─── CHP ─────────────────────────────────────────────────── */
export interface ChpRow {
  version:    string;
  total:      number;
  prod:       number;
  bug:        number;
  crash:      number;
  vlet:       number;
  delta:      number;
  severity:   'low' | 'medium' | 'high';
}

/* ─── SWAT ────────────────────────────────────────────────── */
export interface SwatEmployee {
  name:           string;
  platform:       'android' | 'ios' | 'both';
  stream:         string;
  casesTotal:     number;
  casesByDay:     Record<string, number>;
  avgPerCase:     number;
}

export interface SwatLaunch {
  id:       number;
  name:     string;
  date:     string;
  platform: 'android' | 'ios';
  type:     string;
  employees: SwatEmployee[];
}

/* ─── UVU ─────────────────────────────────────────────────── */
export interface UvuVersion {
  version:    string;
  platform:   'android' | 'ios';
  type:       'force' | 'voluntary';
  users:      number;
  pct:        number;
  status:     'active' | 'done' | 'cancelled' | 'pending';
  deadline:   string;
  note:       string;
}

/* ─── DUTY STREAM ─────────────────────────────────────────── */
export interface DutyStream {
  name:       string;
  ios:        string;
  android:    string;
  lead:       string;
  status:     'filled' | 'missing' | 'partial';
}

/* ─── DEVICES ─────────────────────────────────────────────── */
export interface DeviceRow {
  model:    string;
  os:       string;
  share:    number;
  delta:    number;
  platform: 'android' | 'ios';
}

/* ─── WORKFLOW STEP ───────────────────────────────────────── */
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
export interface WorkflowStep {
  id:       string;
  label:    string;
  status:   StepStatus;
  detail?:  string;
}

/* ─── SNAPSHOTS ───────────────────────────────────────────── */
export interface DataSnapshot {
  id:        string;
  label:     string;
  ts:        number;
  release:   string;
  metrics:   Record<string, number>;
}
