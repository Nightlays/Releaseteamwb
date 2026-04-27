import { proxyFetch, type ProxyMode } from './proxy';
import { normalizeGlmBase, type ReleaseMetrics } from '../types';

export interface ChartsConfig {
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
  signal?: AbortSignal;
  allureBase: string;
  allureToken: string;
  projectId: string;
  deployLabToken?: string;
  ytBase?: string;
  ytToken?: string;
  wikiToken?: string;
  bandCookies?: string;
  gitlabToken?: string;
  gitlabCookie?: string;
  mlHelperBase?: string;
  glmBase?: string;
  glmKey?: string;
  glmModel?: string;
}

export interface ChartsTaskTypeDetail {
  key: string;
  summary: string;
  status: string;
  stream: string;
  merged_after_cutoff: boolean;
}

export interface ChartsTaskTypeRow {
  release: string;
  counts: Record<string, number>;
  details: Record<string, ChartsTaskTypeDetail[]>;
}

export interface ChartsChpTypeRow {
  release: string;
  product: number;
  vlet: number;
  bug: number;
  crash: number;
}

export interface ChartsTcRow {
  release: string;
  manual: number;
  auto: number;
  total: number;
}

export interface ChartsCoverageRow {
  release: string;
  swatCount: number;
  swatPeople: number;
  streamCount: number;
  total: number;
}

export interface ChartsAvgRow {
  release: string;
  swatMs: number;
  streamMs: number;
  totalMs: number;
  swatWeighted: number;
  streamWeighted: number;
  totalWeighted: number;
}

export interface ChartsChpRow {
  release: string;
  ios: number;
  android: number;
  total: number;
}

export interface ChartsDowntimeInterval {
  startLabel: string;
  endLabel: string;
  durationMinutes: number;
}

export interface ChartsDowntimeRow {
  rawDate: string;
  shortDate: string;
  release: string;
  releaseShort: string;
  totalMinutes: number;
  intervalText: string;
  domainText?: string;
  ownersText?: string;
  brokenText?: string;
  fixedText?: string;
  commentText?: string;
  warnings?: string[];
  intervals: ChartsDowntimeInterval[];
  startMs: number | null;
  endMs: number | null;
}

export interface ChartsDowntimeReleaseRow {
  release: string;
  totalMinutes: number;
  days: number;
  entries: number;
}

export interface ChartsTimingRow {
  release: string;
  iosCutLabel: string;
  androidCutLabel: string;
  iosStoreLabel: string;
  androidStoreLabel: string;
  iosRegressionLabel: string;
  androidRegressionLabel: string;
  iosCutMinutes: number | null;
  androidCutMinutes: number | null;
  iosStoreMinutes: number | null;
  androidStoreMinutes: number | null;
  iosRegressionMinutes: number | null;
  androidRegressionMinutes: number | null;
  iosLagMinutes: number | null;
  androidLagMinutes: number | null;
}

export interface ChartsStreamDeltaRow {
  release: string;
  stream: string;
  manualBefore: number;
  manualAfter: number;
  manualDelta: number;
  autoBefore: number;
  autoAfter: number;
  autoDelta: number;
  uwuManualBefore: number;
  uwuManualAfter: number;
  uwuManualDelta: number;
  uwuAutoBefore: number;
  uwuAutoAfter: number;
  uwuAutoDelta: number;
}

export interface ChartsStreamInsightItem {
  stream: string;
  delta: number;
  before: number;
  after: number;
  tone: 'good' | 'bad';
  external: boolean;
}

export interface ChartsStreamInsightSummary {
  from: string;
  to: string;
  unitLabel: string;
  added: ChartsStreamInsightItem[];
  removed: ChartsStreamInsightItem[];
}

export interface ChartsAnomalyItem {
  label: string;
  delta: number;
  deltaPct: number;
  last: number;
  prev: number;
  z?: number;
}

export interface ChartsAnomalyBucket {
  count: number;
  list: ChartsAnomalyItem[];
}

export interface ChartsAnomalies {
  release: ChartsAnomalyBucket;
  type: ChartsAnomalyBucket;
  platform: ChartsAnomalyBucket;
  score: number;
}

export type ChartsMlFeatureKey =
  | 'tc_total'
  | 'tc_total_delta'
  | 'tc_total_delta_pct'
  | 'tc_volatility'
  | 'tc_slope_pct'
  | 'cov_swat_delta_pct'
  | 'cov_stream_delta_pct'
  | 'sel_swat_delta_pct'
  | 'sel_stream_delta_pct'
  | 'avg_total_delta'
  | 'chp_total_delta_pct'
  | 'chp_ios_delta_pct'
  | 'chp_android_delta_pct'
  | 'release_anoms'
  | 'type_anoms'
  | 'platform_anoms'
  | 'anom_score';

export type ChartsMlFeatures = Record<ChartsMlFeatureKey, number>;

export interface ChartsMlDatasetEntry {
  id: string;
  time: string;
  features: ChartsMlFeatures;
  label: 'ok' | 'fail' | null;
  labeledAt?: string | null;
  release?: string | null;
  predictedRiskPct?: number | null;
  linearProbability?: number | null;
  catboostProbability?: number | null;
}

export interface ChartsMlHelperHealth {
  online: boolean;
  busy: boolean;
  error: string;
  checkedAt: number;
  base?: string;
  endpoint?: string;
  trainedAt?: string;
  commandHints?: Record<string, string>;
}

export interface ChartsMlPrediction {
  engine: 'catboost' | 'linear' | 'none';
  activeProbability: number | null;
  linearProbability: number | null;
  catboostProbability: number | null;
  labeledSamples: number;
  trained: boolean;
  reason: string;
  datasetQuality: 'low' | 'medium' | 'high';
  datasetQualityText: string;
  datasetQualityHint: string;
  modelAgreementPct: number | null;
  agreementText: string;
  featureDrivers: Array<{
    key: ChartsMlFeatureKey;
    label: string;
    contribution: number;
    value: number;
  }>;
}

export type ChartsMlSummaryTone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface ChartsMlSummaryMetric {
  label: string;
  current: string;
  base: string;
  delta: string;
  tone: ChartsMlSummaryTone;
  note: string;
}

export type ChartsMlSummarySectionId = 'overview' | 'regress' | 'release' | 'types' | 'streams';

export interface ChartsMlSummarySection {
  id: ChartsMlSummarySectionId;
  title: string;
  subtitle: string;
  tone: ChartsMlSummaryTone;
  overview: string[];
  risks: string[];
  changes: string[];
  recommendations: string[];
  highlights: ChartsMlSummaryMetric[];
}

export interface ChartsMlSummary {
  statusText: string;
  statusTone: ChartsMlSummaryTone;
  engineLabel: string;
  helperText: string;
  helperTone: ChartsMlSummaryTone;
  trainingText: string;
  compareText: string;
  overview: string[];
  risks: string[];
  changes: string[];
  recommendations: string[];
  manualChecks: string[];
  highlights: ChartsMlSummaryMetric[];
  sections: Record<ChartsMlSummarySectionId, ChartsMlSummarySection>;
}

export interface ChartsMetricRow extends ReleaseMetrics {
  tc_total_delta_pct: number;
  tc_volatility: number;
  tc_slope_pct: number;
  cov_swat_delta_pct: number;
  cov_stream_delta_pct: number;
  sel_swat_delta_pct: number;
  sel_stream_delta_pct: number;
  avg_total: number;
  avg_weighted: number;
  chp_ios: number;
  chp_android: number;
  chp_ios_delta_pct: number;
  chp_android_delta_pct: number;
  mlRiskPct: number | null;
}

export interface ChartsAiMetricSnapshot {
  label: string;
  current: string;
  currentRaw: number | null;
  base: string;
  baseRaw: number | null;
  delta: number | null;
  deltaPct: number | null;
  better: string;
  note: string;
}

export interface ChartsAiContext {
  releaseWindow: {
    from: string;
    to: string;
    count: number;
    releases: string[];
    currentRelease: string;
    previousRelease: string;
    compareMode: 'previous_release' | 'mean_history';
    baseReleases: string[];
  };
  mlRisk: {
    engine: string;
    regressionProbabilityPct: number | null;
    linearProbabilityPct: number | null;
    catboostProbabilityPct: number | null;
    labeledSamples: number;
    features: Partial<Record<ChartsMlFeatureKey, number>>;
  };
  keyMetrics: {
    regress: ChartsAiMetricSnapshot[];
    release: ChartsAiMetricSnapshot[];
    timings: ChartsAiMetricSnapshot[];
  };
  anomalies: ChartsAnomalies;
  streams: {
    hb: ChartsAiStreamDeltaSnapshot | null;
    selective: ChartsAiStreamDeltaSnapshot | null;
    uwu: ChartsAiStreamDeltaSnapshot | null;
    internalStreams: string[];
    externalStreams: string[];
  };
  taskTypes: {
    ios: ChartsAiTypeSnapshot | null;
    android: ChartsAiTypeSnapshot | null;
    chpAll: ChartsAiTypeSnapshot | null;
    chpIos: ChartsAiTypeSnapshot | null;
    chpAndroid: ChartsAiTypeSnapshot | null;
  };
  recentReleases: {
    testCases: Array<Record<string, string | number>>;
    coverage: Array<Record<string, string | number>>;
    selective: Array<Record<string, string | number>>;
    avgMinutes: Array<Record<string, string | number>>;
    chp: Array<Record<string, string | number>>;
    timings: Array<Record<string, string | number>>;
  };
  devDowntime: {
    ios: ChartsAiMetricSnapshot;
    android: ChartsAiMetricSnapshot;
    total: ChartsAiMetricSnapshot;
    currentDays: {
      ios: number;
      android: number;
      total: number;
    };
  };
  mlSummary?: {
    statusText: string;
    statusTone: ChartsMlSummaryTone;
    engineLabel: string;
    helperText: string;
    trainingText: string;
    compareText: string;
    overview: string[];
    risks: string[];
    changes: string[];
    recommendations: string[];
    manualChecks: string[];
    sections: Array<{
      id: ChartsMlSummarySectionId;
      title: string;
      subtitle: string;
      tone: ChartsMlSummaryTone;
      overview: string[];
      risks: string[];
      changes: string[];
      recommendations: string[];
    }>;
  };
  displayedTables?: {
    streamDeltaRows: Array<{
      release: string;
      stream: string;
      manualDelta: number;
      autoDelta: number;
      uwuManualDelta: number;
      uwuAutoDelta: number;
    }>;
    chpTypesHistory: {
      all: Array<{ release: string; product: number; vlet: number; bug: number; crash: number }>;
      ios: Array<{ release: string; product: number; vlet: number; bug: number; crash: number }>;
      android: Array<{ release: string; product: number; vlet: number; bug: number; crash: number }>;
    };
    devDowntimeByRelease: {
      ios: Array<{ release: string; totalMinutes: number; days: number }>;
      android: Array<{ release: string; totalMinutes: number; days: number }>;
    };
  };
}

export interface ChartsAiTypeSnapshot {
  platform: string;
  release: string;
  topTypes: Array<{ name: string; count: number }>;
}

export interface ChartsAiStreamDeltaSnapshot {
  from: string;
  to: string;
  unit: string;
  added: Array<{ stream: string; delta: number; before: number; after: number; external: boolean }>;
  removed: Array<{ stream: string; delta: number; before: number; after: number; external: boolean }>;
}

export interface ChartsReport {
  releases: string[];
  metrics: ChartsMetricRow[];
  tcRows: ChartsTcRow[];
  coverageRows: ChartsCoverageRow[];
  selectiveRows: ChartsCoverageRow[];
  avgRows: ChartsAvgRow[];
  chpRows: ChartsChpRow[];
  devDowntime: {
    iosRows: ChartsDowntimeRow[];
    androidRows: ChartsDowntimeRow[];
    iosByRelease: ChartsDowntimeReleaseRow[];
    androidByRelease: ChartsDowntimeReleaseRow[];
  };
  timings: ChartsTimingRow[];
  taskTypes: {
    iosTypes: string[];
    androidTypes: string[];
    iosRows: ChartsTaskTypeRow[];
    androidRows: ChartsTaskTypeRow[];
  };
  chpTypes: {
    rows: ChartsChpTypeRow[];
    iosRows: ChartsChpTypeRow[];
    androidRows: ChartsChpTypeRow[];
  };
  streamInsights: {
    hb: ChartsStreamInsightSummary | null;
    selective: ChartsStreamInsightSummary | null;
    uwu: ChartsStreamInsightSummary | null;
    internalStreams: string[];
    externalStreams: string[];
  };
  streamDeltaRows: ChartsStreamDeltaRow[];
  anomalies: ChartsAnomalies;
  ml: {
    features: ChartsMlFeatures | null;
    dataset: ChartsMlDatasetEntry[];
    prediction: ChartsMlPrediction;
    helperHealth: ChartsMlHelperHealth;
    summary: ChartsMlSummary;
  };
  aiContext: ChartsAiContext;
}

export interface CollectChartsOptions {
  compareMode?: 'prev' | 'mean';
  onLog?: (text: string, level?: 'info' | 'ok' | 'warn' | 'error') => void;
  onProgress?: (done: number, total: number) => void;
}

const PAGE_SIZE = 200;
const LEAF_PAGE_SIZE = 1000;
const SWAT_LIST_URL = 'https://script.google.com/macros/s/AKfycbzLmb5ATmHOip7REPsl_iSLH2GuEHui0W_czyrPgW_8G1Wl-RY8CiM2UeAdqQQEwoNx-Q/exec';
const ML_DRIVE_URL = 'https://script.google.com/macros/s/AKfycby1MNW_-mbMh8ukBs94kOc0KXM43yZae7gmCgSLoK9a4Tx3F0JY4lMdQHoWhxyJ1j1XYQ/exec';
const ML_DRIVE_FILE = 'wb_graphs_v0_2_9_ml_dataset.json';
const GITLAB_BASE_URL = 'https://gitlab.wildberries.ru';
const GITLAB_GRAPHQL_URL = `${GITLAB_BASE_URL}/api/graphql`;
const GITLAB_PIPELINE_PAGE_SIZE = 100;
const DEPLOY_ISSUES_URL_TMPL = 'https://deploy-lab-api.wb.ru/releaseboss/admin_panel/release/{prefix}_{rel}/issues';
const DEPLOY_BASE_URL_TMPL = 'https://deploy-lab-api.wb.ru/releaseboss/admin_panel/release/{prefix}_{rel}';
const DEPLOY_DEPLOY_URL_TMPL = 'https://deploy-lab-api.wb.ru/releaseboss/admin_panel/release/{prefix}_{rel}/deploy';
const WIKI_DEV_OUTAGES_URL = 'https://wiki.wb.ru/api/v1/space/308/article/6157';
const BAND_ANDROID_DEV_FAILURES_CHANNEL_ID = 'csbuypwc93yozfazeqkkncboch';
const BAND_DEFAULT_LOOKBACK_DAYS = 365;
const BAND_LOOKBACK_BUFFER_DAYS = 7;
const RELEASE_MARKER_MAX_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const FEATURE_KEYS: ChartsMlFeatureKey[] = [
  'tc_total', 'tc_total_delta', 'tc_total_delta_pct',
  'tc_volatility', 'tc_slope_pct',
  'cov_swat_delta_pct', 'cov_stream_delta_pct',
  'sel_swat_delta_pct', 'sel_stream_delta_pct',
  'avg_total_delta',
  'chp_total_delta_pct', 'chp_ios_delta_pct', 'chp_android_delta_pct',
  'release_anoms', 'type_anoms', 'platform_anoms', 'anom_score',
];

function formatChpTypeLabel(label: string) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'product') return 'Аналитика';
  if (normalized === 'vlet') return 'Влет';
  if (normalized === 'bug') return 'Баг';
  if (normalized === 'crash') return 'Краш';
  return label;
}
export const FEATURE_LABELS: Record<ChartsMlFeatureKey, string> = {
  tc_total: 'Объём регресса',
  tc_total_delta: 'Изменение объёма регресса',
  tc_total_delta_pct: 'Изменение объёма регресса, %',
  tc_volatility: 'Волатильность TC',
  tc_slope_pct: 'Тренд TC %',
  cov_swat_delta_pct: 'Изменение HB SWAT, %',
  cov_stream_delta_pct: 'Изменение HB Stream, %',
  sel_swat_delta_pct: 'Изменение Selective SWAT, %',
  sel_stream_delta_pct: 'Изменение Selective Stream, %',
  avg_total_delta: 'Изменение среднего времени',
  chp_total_delta_pct: 'Изменение ЧП всего, %',
  chp_ios_delta_pct: 'Изменение ЧП iOS, %',
  chp_android_delta_pct: 'Изменение ЧП Android, %',
  release_anoms: 'Аномалии релиза',
  type_anoms: 'Аномалии типов',
  platform_anoms: 'Аномалии платформ',
  anom_score: 'Суммарный балл аномалий',
};

export function getChartsMlFeatureLabel(key: string) {
  return FEATURE_LABELS[key as ChartsMlFeatureKey] || key;
}
const ML_DATA_KEY = 'wb_graphs_v0_2_9_ml_dataset';
const ML_LAST_EXPORT_KEY = 'wb_graphs_v0_2_9_ml_last_export_id';
const DEFAULT_CHARTS_ML_HELPER_BASE = 'http://127.0.0.1:8788';
const CHARTS_AI_SUMMARY_CACHE = new Map<string, string>();
const GITLAB_PIPELINE_CONFIG = {
  IOS: {
    fullPath: 'mobile/ios/marketplace',
    scope: 'finished',
    jobName: 'build_for_testflight',
    offsetMinutes: 15,
  },
  ANDROID: {
    fullPath: 'mobile/androidnative/androidnative',
    scope: 'all',
    jobName: 'build_qa',
    offsetMinutes: 0,
  },
} as const;
const TYPES_CANON_ORDER = [
  'Task', 'Bug', 'Release', 'Epic', 'Defect', 'Analytics', 'User Story', 'Testing', 'Documentation', 'Test automation', 'Feature', 'Tech Dept',
];

let ortModulePromise: Promise<typeof import('onnxruntime-web') | null> | null = null;
let catboostSessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;
let catboostManifestVersionPromise: Promise<string | null> | null = null;
let catboostSessionVersion: string | null = null;
const CATBOOST_TRAINED_AT_STORAGE_KEY = 'wb_graphs_catboost_trained_at_v1';
const testCaseOverviewCache = new Map<string, Promise<AllureTestCaseOverview | null>>();
const ytIssueMetaCache = new Map<string, Promise<YtIssueMeta>>();
const ytIssueMetaForbiddenByAuth = new Set<string>();
const ytIssueMetaForbiddenMessageByAuth = new Map<string, string>();
const tcStreamCache = new Map<string, string>();
const tcUwuCache = new Map<string, number>();
let tcLocalCacheLoaded = false;
const swatCache = new Map<string, Promise<{ set: Set<string>; total: number }>>();

interface AllureLaunchLite {
  id?: number;
  name?: string;
  createdDate?: number;
}

interface AllureMemberStatItem {
  assignee?: string;
  durationSum?: number;
  retriedCount?: number;
  statistic?: Array<{ status?: string; count?: number; duration?: number; total?: number; time?: number; tests?: number }>;
}

interface AllureLaunchStatisticItem {
  count?: number;
}

interface AllureLaunchLeafItem {
  id?: string | number;
  resultId?: string | number;
  testResultId?: string | number;
  testCaseId?: string | number;
  testCase?: { id?: string | number; testCaseId?: string | number };
  result?: { id?: string | number };
}

interface AllureTestCaseOverview {
  customFields?: Array<{
    name?: string;
    values?: Array<{ name?: string }> | { name?: string } | string;
    customField?: { name?: string };
  }>;
}

interface DeployIssue {
  key?: string;
  summary?: string;
  title?: string;
  name?: string;
  status?: string;
  stream?: string;
  type?: unknown;
  tags?: Array<string | { name?: string }>;
  merged_after_cutoff?: boolean;
}

interface YtIssueResponse {
  tags?: Array<{ name?: string }>;
  fields?: Array<{
    name?: string;
    projectCustomField?: { field?: { name?: string } };
    value?: unknown;
  }>;
}

interface YtIssueMeta {
  tags: string[];
  typeValues: string[];
}

type GitlabPipelineInfo = {
  iid?: string | number;
  created_at?: string;
  createdAt?: string;
  created?: string;
};

type GitlabJobsPage = {
  data?: {
    project?: {
      pipeline?: {
        jobs?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          nodes?: Array<{ name?: string; finishedAt?: string }>;
        };
      };
    };
  };
};

type ChartsLinearModel =
  | {
      trained: false;
      count: number;
      minCount: number;
      reason: string;
    }
  | {
      trained: true;
      count: number;
      minCount: number;
      mean: number[];
      std: number[];
      w: number[];
      reason?: undefined;
    };

function log(options: CollectChartsOptions | undefined, text: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') {
  options?.onLog?.(text, level);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function markYtMetaForbidden(authKey: string, message: string) {
  ytIssueMetaForbiddenByAuth.add(authKey);
  ytIssueMetaForbiddenMessageByAuth.set(authKey, message);
}

function encodeSearchQuery(filters: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(filters));
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function buildAllureHeaders(token: string, extra?: Record<string, string>) {
  const rawToken = String(token || '').trim();
  const authValue = /^Api-Token\s+/i.test(rawToken) || /^Bearer\s+/i.test(rawToken)
    ? rawToken
    : `Api-Token ${rawToken}`;

  return {
    Accept: 'application/json',
    Authorization: authValue,
    ...(extra || {}),
  };
}

function buildYtHeaders(token: string, extra?: Record<string, string>) {
  return {
    Accept: 'application/json',
    Authorization: /^Bearer\s+/i.test(String(token || '').trim()) ? String(token || '').trim() : `Bearer ${String(token || '').trim()}`,
    ...(extra || {}),
  };
}

function normalizeChartsYtBase(base: string) {
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

function getYtMetaAuthKey(cfg: ChartsConfig) {
  return `${normalizeChartsYtBase(String(cfg.ytBase || ''))}::${String(cfg.ytToken || '').trim()}`;
}

function issueNeedsYtMeta(issue: DeployIssue) {
  const type = String(extractIssueType(issue) || '').trim();
  const tags = extractIssueTags(issue);
  return !type || !tags.length;
}

function isHttp403Error(error: unknown) {
  const message = String((error as Error)?.message || error || '');
  return /^HTTP 403\b/i.test(message);
}

function buildWikiHeaders(token: string, extra?: Record<string, string>) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  return {
    Accept: 'application/json',
    Authorization: /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`,
    ...(extra || {}),
  };
}

function buildBandHeaders(cookies: string, extra?: Record<string, string>) {
  const raw = String(cookies || '').trim();
  if (!raw) return null;
  return {
    Accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    'x-proxy-cookie': raw,
    ...(extra || {}),
  };
}

function normalizeDeployLabToken(token: string) {
  const raw = String(token || '').trim();
  if (!raw) return '';

  const compact = raw.replace(/[\r\n\t]+/g, ' ').trim();
  const headerMatch = compact.match(/authorization-deploy-lab\s*:\s*Bearer\s+([A-Za-z0-9._-]+)/i);
  if (headerMatch?.[1]) return headerMatch[1].trim();

  const bearerMatch = compact.match(/(?:^|\s)Bearer\s+([A-Za-z0-9._-]+)/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();

  return compact.replace(/^['"]+|['"]+$/g, '').trim();
}

function buildDeployHeaders(token: string, extra?: Record<string, string>) {
  const clean = normalizeDeployLabToken(token);
  return {
    Accept: 'application/json',
    'authorization-deploy-lab': `Bearer ${clean}`,
    ...(extra || {}),
  };
}

function normalizeGitlabToken(value: string) {
  return String(value || '').trim().replace(/^(Bearer|PRIVATE-TOKEN)\s+/i, '').trim();
}

function isGitlabCookieAuth(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^(gitlab-|glpat-|Bearer\s+|PRIVATE-TOKEN\s+)/i.test(raw)) return false;
  return /[A-Za-z0-9_.-]+=/.test(raw);
}

function buildGitlabHeaderVariants(rawToken = '', rawCookie = ''): Record<string, string>[] {
  const cookieValue = String(rawCookie || '').trim();
  if (cookieValue) {
    return [{
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-proxy-cookie': cookieValue,
    }];
  }

  const tokenSource = String(rawToken || '').trim();
  if (!tokenSource) return [];
  if (isGitlabCookieAuth(tokenSource)) {
    return [{
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-proxy-cookie': tokenSource,
    }];
  }

  const token = normalizeGitlabToken(tokenSource);
  if (!token) return [];
  return [
    { accept: 'application/json', 'PRIVATE-TOKEN': token },
    { accept: 'application/json', Authorization: `Bearer ${token}` },
  ];
}

async function fetchJson<T>(
  cfg: ChartsConfig,
  targetUrl: string,
  init?: RequestInit,
  allowRawFetch = true
): Promise<T> {
  if (cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    const response = await proxyFetch(
      {
        base: String(cfg.proxyBase).trim(),
        mode: cfg.proxyMode,
        signal: cfg.signal,
      },
      targetUrl,
      init
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 220)}` : ''}`);
    }

    return response.json() as Promise<T>;
  }

  if (!allowRawFetch) {
    throw new Error('Proxy не настроен для этого запроса');
  }

  const response = await fetch(targetUrl, { ...init, signal: cfg.signal });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 220)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

async function fetchJsonWithHeaderVariants<T>(
  cfg: ChartsConfig,
  targetUrl: string,
  headerVariants: Record<string, string>[]
): Promise<T> {
  let lastError: Error | null = null;
  for (let index = 0; index < headerVariants.length; index += 1) {
    try {
      return await fetchJson<T>(cfg, targetUrl, { headers: headerVariants[index] }, false);
    } catch (error) {
      lastError = error as Error;
      const message = String((error as Error)?.message || '');
      if (!/^HTTP 401\b/i.test(message) || index === headerVariants.length - 1) {
        throw error;
      }
    }
  }
  throw lastError || new Error('GitLab auth failed');
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>, signal?: AbortSignal) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

function parseVersion(value: string) {
  const raw = String(value || '').trim();
  const parts = raw.split('.').map(chunk => chunk.trim());
  if (parts.length < 3) return null;
  const [major, minor, buildRaw] = parts;
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor) || !/^\d+$/.test(buildRaw)) return null;
  const majorN = Number(major);
  const minorN = Number(minor);
  let build = Number(buildRaw);
  if (!Number.isFinite(build)) return null;
  if (buildRaw.length < 4) build *= Math.pow(10, 4 - buildRaw.length);
  const buildStrNorm = String(build).padStart(4, '0');
  return { major, minor, majorN, minorN, build, buildStrNorm };
}

export function buildMajorReleaseRange(from: string, to: string) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b || a.majorN !== b.majorN) return [];

  const step = 1000;
  const aKey = a.minorN * 10000 + a.build;
  const bKey = b.minorN * 10000 + b.build;
  const lo = aKey <= bKey ? a : b;
  const hi = aKey <= bKey ? b : a;
  const out: string[] = [];

  for (let minor = lo.minorN; minor <= hi.minorN; minor += 1) {
    let startBuild = 0;
    let endBuild = 9000;
    if (minor === lo.minorN) startBuild = Math.ceil(lo.build / step) * step;
    if (minor === hi.minorN) endBuild = Math.floor(hi.build / step) * step;
    if (startBuild > endBuild) continue;
    for (let build = startBuild; build <= endBuild; build += step) {
      out.push(`${lo.major}.${minor}.${String(build).padStart(4, '0')}`);
    }
  }

  return out;
}

function normalizeLogin(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function fetchSwatLogins(release: string, signal?: AbortSignal) {
  const normalized = String(release || '').trim();
  if (!normalized) return { set: new Set<string>(), total: 0 };
  if (swatCache.has(normalized)) return swatCache.get(normalized)!;

  const promise = (async () => {
    const url = new URL(SWAT_LIST_URL);
    url.searchParams.set('release', normalized);
    const response = await fetch(url.toString(), { signal });
    if (!response.ok) throw new Error(`SWAT list HTTP ${response.status}`);
    const data = await response.json();
    const rawLogins = Array.isArray(data?.worked_SWAT?.login) ? data.worked_SWAT.login : [];
    const set = new Set<string>();
    for (const login of rawLogins) {
      const norm = normalizeLogin(login);
      if (norm) set.add(norm);
    }
    return {
      set,
      total: Number(data?.worked_SWAT?.total || 0) || set.size,
    };
  })();

  swatCache.set(normalized, promise);
  return promise;
}

function buildAllureUrl(cfg: ChartsConfig, path: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(String(cfg.allureBase || '').replace(/\/+$/, '') + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchAllureJson<T>(
  cfg: ChartsConfig,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  init?: RequestInit
) {
  return fetchJson<T>(cfg, buildAllureUrl(cfg, path, params), {
    ...init,
    headers: buildAllureHeaders(cfg.allureToken, (init?.headers as Record<string, string> | undefined) ?? undefined),
  });
}

async function fetchLaunchesByTerms(cfg: ChartsConfig, terms: string[]) {
  const byId = new Map<number, AllureLaunchLite>();
  for (const term of terms.filter(Boolean)) {
    const search = encodeSearchQuery([{ id: 'name', type: 'string', value: term }]);
    for (let page = 0; page < 8; page += 1) {
      const data = await fetchAllureJson<{ content?: AllureLaunchLite[] }>(
        cfg,
        '/api/launch',
        {
          page,
          size: PAGE_SIZE,
          search,
          projectId: cfg.projectId,
          preview: true,
          sort: 'createdDate,desc',
        }
      );
      const content = Array.isArray(data?.content) ? data.content : [];
      if (!content.length) break;
      content.forEach(item => {
        const id = Number(item?.id || 0);
        if (id) byId.set(id, item);
      });
      if (content.length < PAGE_SIZE) break;
    }
  }
  return Array.from(byId.values());
}

async function fetchChartLaunchesByKind(cfg: ChartsConfig, release: string, kind: 'Smoke' | 'Selective') {
  const terms = [`[${kind}] Регресс ${release}`];
  if (kind === 'Smoke') terms.push(`[High/Blocker][DeployLab] Регресс ${release}`);
  if (kind === 'Selective') terms.push(`[Selective][DeployLab] Регресс ${release}`);
  return fetchLaunchesByTerms(cfg, terms);
}

async function fetchHBLaunches(cfg: ChartsConfig, release: string) {
  return fetchLaunchesByTerms(cfg, [`[High/Blocker][DeployLab] Регресс ${release}`]);
}

async function fetchHBLaunchesSwatRelease(cfg: ChartsConfig, release: string) {
  return fetchLaunchesByTerms(cfg, [
    `[High/Blocker][DeployLab] Регресс ${release}`,
    `[High/Blocker] Регресс ${release}`,
  ]);
}

async function fetchLaunchStatistic(cfg: ChartsConfig, launchId: number) {
  const data = await fetchAllureJson<AllureLaunchStatisticItem[] | { count?: number }[]>(
    cfg,
    `/api/launch/${launchId}/statistic`
  );
  const items = Array.isArray(data) ? data : [];
  return items.reduce((sum, item) => sum + Number(item?.count || 0), 0);
}

async function fetchAutomatedTotalCases(cfg: ChartsConfig, launchId: number, treeId = 14) {
  const search = encodeSearchQuery([{ id: 'automated', type: 'boolean', value: true }]);
  const data = await fetchAllureJson<{ content?: Array<{ statistic?: { total?: number } }> }>(
    cfg,
    '/api/testresulttree/group',
    {
      launchId,
      treeId,
      search,
      sort: 'duration,asc',
      size: PAGE_SIZE,
    }
  );
  return (Array.isArray(data?.content) ? data.content : []).reduce((sum, item) => sum + Number(item?.statistic?.total || 0), 0);
}

async function fetchMemberStats(cfg: ChartsConfig, launchId: number) {
  const data = await fetchAllureJson<AllureMemberStatItem[] | { content?: AllureMemberStatItem[] }>(
    cfg,
    `/api/launch/${launchId}/memberstats`,
    { size: 1000, page: 0 }
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.content) ? data.content : [];
}

async function fetchLaunchLeafItems(cfg: ChartsConfig, launchId: number, automatedOnly = false) {
  const out: AllureLaunchLeafItem[] = [];
  const search = automatedOnly ? encodeSearchQuery([{ id: 'automated', type: 'boolean', value: true }]) : undefined;

  for (let page = 0; page < 100; page += 1) {
    const data = await fetchAllureJson<{ content?: AllureLaunchLeafItem[] }>(
      cfg,
      '/api/testresulttree/leaf',
      {
        launchId,
        sort: 'duration,asc',
        size: LEAF_PAGE_SIZE,
        page,
        search,
      }
    );
    const content = Array.isArray(data?.content) ? data.content : [];
    if (!content.length) break;
    out.push(...content);
    if (content.length < LEAF_PAGE_SIZE) break;
  }

  return out;
}

function loadTcLocalCaches() {
  if (tcLocalCacheLoaded || typeof window === 'undefined') return;
  tcLocalCacheLoaded = true;
  try {
    const rawStream = localStorage.getItem('wb_tc_stream_cache_v1');
    const parsedStream = safeJsonParse<Record<string, string>>(rawStream || '{}', {});
    Object.entries(parsedStream || {}).forEach(([key, value]) => {
      if (key && value) tcStreamCache.set(String(key), String(value));
    });
  } catch {
    /* noop */
  }
  try {
    const rawUwu = localStorage.getItem('wb_tc_uwu_cache_v1');
    const parsedUwu = safeJsonParse<Record<string, number>>(rawUwu || '{}', {});
    Object.entries(parsedUwu || {}).forEach(([key, value]) => {
      const n = Number(value);
      if (key && Number.isFinite(n)) tcUwuCache.set(String(key), n);
    });
  } catch {
    /* noop */
  }
}

function persistTcLocalCaches() {
  if (typeof window === 'undefined') return;
  try {
    const streamObj: Record<string, string> = {};
    tcStreamCache.forEach((value, key) => {
      streamObj[key] = value;
    });
    localStorage.setItem('wb_tc_stream_cache_v1', JSON.stringify(streamObj));
  } catch {
    /* noop */
  }
  try {
    const uwuObj: Record<string, number> = {};
    tcUwuCache.forEach((value, key) => {
      uwuObj[key] = value;
    });
    localStorage.setItem('wb_tc_uwu_cache_v1', JSON.stringify(uwuObj));
  } catch {
    /* noop */
  }
}

function isStreamFieldName(name: string) {
  const lower = String(name || '').toLowerCase();
  return lower.includes('stream') || lower.includes('стрим');
}

function isUwuFieldName(name: string) {
  return String(name || '').trim().toLowerCase() === 'uwu';
}

function normalizeUwuValue(value: unknown) {
  if (value == null) return 0;
  const raw = String(value).trim().replace(',', '.');
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

async function fetchTestCaseOverview(cfg: ChartsConfig, testCaseId: string) {
  if (testCaseOverviewCache.has(testCaseId)) return testCaseOverviewCache.get(testCaseId)!;
  const promise = fetchAllureJson<AllureTestCaseOverview>(cfg, `/api/testcase/${testCaseId}/overview`)
    .catch(() => null);
  testCaseOverviewCache.set(testCaseId, promise);
  return promise;
}

function extractStreamFromOverview(overview: AllureTestCaseOverview | null) {
  const list = Array.isArray(overview?.customFields) ? overview.customFields : [];
  for (const item of list) {
    const fieldName = String(item?.customField?.name || '').trim();
    if (!isStreamFieldName(fieldName)) continue;
    const direct = typeof item?.name === 'string' ? item.name.trim() : '';
    if (direct) return direct;
    const values = item?.values;
    if (Array.isArray(values) && values.length) {
      const first = values[0];
      const value = typeof first === 'string' ? first : String(first?.name || '').trim();
      if (value) return value;
    }
    if (typeof values === 'string' && values.trim()) return values.trim();
    if (values && typeof values === 'object' && String((values as { name?: string }).name || '').trim()) {
      return String((values as { name?: string }).name || '').trim();
    }
  }
  return 'Без стрима';
}

function extractUwuFromOverview(overview: AllureTestCaseOverview | null) {
  const list = Array.isArray(overview?.customFields) ? overview.customFields : [];
  for (const item of list) {
    const fieldName = String(item?.customField?.name || '').trim();
    if (!isUwuFieldName(fieldName)) continue;
    const direct = typeof item?.name === 'string' ? item.name.trim() : '';
    if (direct) return normalizeUwuValue(direct);
    const values = item?.values;
    if (Array.isArray(values) && values.length) {
      const first = values[0];
      const value = typeof first === 'string' ? first : first?.name;
      return normalizeUwuValue(value);
    }
    if (typeof values === 'string') return normalizeUwuValue(values);
    if (values && typeof values === 'object') return normalizeUwuValue((values as { name?: string }).name);
  }
  return 0;
}

function getLeafTestCaseId(leaf: AllureLaunchLeafItem) {
  const id = leaf?.testCaseId ?? leaf?.testCase?.id ?? leaf?.testCase?.testCaseId;
  return id == null ? '' : String(id);
}

async function collectStreamCountsByLaunch(
  cfg: ChartsConfig,
  launchId: number,
  allMap: Map<string, number>,
  autoMap: Map<string, number>,
  allUwuMap: Map<string, number>,
  autoUwuMap: Map<string, number>,
  opts?: { includeAll?: boolean; includeAuto?: boolean; includeUwu?: boolean }
) {
  loadTcLocalCaches();
  const includeAll = opts?.includeAll !== false;
  const includeAuto = opts?.includeAuto !== false;
  const includeUwu = opts?.includeUwu !== false;

  const consumeLeafs = async (leafs: AllureLaunchLeafItem[], targetMap: Map<string, number>, targetUwuMap: Map<string, number>) => {
    for (const leaf of leafs) {
      let stream = 'Без стрима';
      let uwu = 0;
      const testCaseId = getLeafTestCaseId(leaf);
      if (testCaseId) {
        if (tcStreamCache.has(testCaseId)) stream = String(tcStreamCache.get(testCaseId) || 'Без стрима');
        if (tcUwuCache.has(testCaseId)) uwu = Number(tcUwuCache.get(testCaseId) || 0);

        if (!tcStreamCache.has(testCaseId) || (includeUwu && !tcUwuCache.has(testCaseId))) {
          const overview = await fetchTestCaseOverview(cfg, testCaseId);
          if (!tcStreamCache.has(testCaseId)) {
            stream = extractStreamFromOverview(overview);
            tcStreamCache.set(testCaseId, stream);
          }
          if (includeUwu && !tcUwuCache.has(testCaseId)) {
            uwu = extractUwuFromOverview(overview);
            tcUwuCache.set(testCaseId, uwu);
          }
        }
      }

      targetMap.set(stream, (targetMap.get(stream) || 0) + 1);
      if (includeUwu) {
        targetUwuMap.set(stream, (targetUwuMap.get(stream) || 0) + Number(uwu || 0));
      }
    }
  };

  if (includeAll) {
    await consumeLeafs(await fetchLaunchLeafItems(cfg, launchId, false), allMap, allUwuMap);
  }

  if (includeAuto) {
    await consumeLeafs(await fetchLaunchLeafItems(cfg, launchId, true), autoMap, autoUwuMap);
  }

  persistTcLocalCaches();
}

function mergeMapCounts(target: Map<string, number>, source: Map<string, number>) {
  source.forEach((value, key) => {
    target.set(key, (target.get(key) || 0) + Number(value || 0));
  });
}

function buildCountsByStream(
  allMap: Map<string, number>,
  autoMap: Map<string, number>,
  allUwuMap: Map<string, number>,
  autoUwuMap: Map<string, number>
) {
  const out = new Map<string, { manual: number; auto: number; uwuManual: number; uwuAuto: number }>();
  const streams = new Set<string>([
    ...allMap.keys(),
    ...autoMap.keys(),
    ...allUwuMap.keys(),
    ...autoUwuMap.keys(),
  ]);

  streams.forEach(stream => {
    const allCount = Number(allMap.get(stream) || 0);
    const autoCount = Number(autoMap.get(stream) || 0);
    const allUwu = Number(allUwuMap.get(stream) || 0);
    const autoUwu = Number(autoUwuMap.get(stream) || 0);
    out.set(stream, {
      manual: Math.max(0, allCount - autoCount),
      auto: autoCount,
      uwuManual: Math.max(0, allUwu - autoUwu),
      uwuAuto: autoUwu,
    });
  });

  return out;
}

function memberTotalCount(member: AllureMemberStatItem) {
  let total = 0;
  const stat = Array.isArray(member?.statistic) ? member.statistic : [];
  for (const item of stat) {
    total += Number(item?.count || item?.total || item?.tests || 0);
  }
  return total > 0 ? total : 0;
}

function memberTotalCountSwatRelease(member: AllureMemberStatItem) {
  let total = 0;
  const stat = Array.isArray(member?.statistic) ? member.statistic : [];
  for (const item of stat) {
    if (!('status' in item) || item.status == null) continue;
    total += Number(item?.count || 0);
  }
  return total > 0 ? total : 0;
}

function memberRetryCount(member: AllureMemberStatItem) {
  const retries = Number(member?.retriedCount || 0);
  return retries > 0 ? retries : 0;
}

function swatStreamAgg(memberStats: AllureMemberStatItem[], swatSet: Set<string>) {
  let swatTotal = 0;
  let streamTotal = 0;
  let swatDur = 0;
  let streamDur = 0;

  for (const member of memberStats || []) {
    const assignee = normalizeLogin(member?.assignee);
    const total = memberTotalCount(member);
    const duration = Number(member?.durationSum || 0) || 0;
    if (total <= 0) continue;

    if (assignee && swatSet.has(assignee)) {
      swatTotal += total;
      swatDur += duration;
    } else {
      streamTotal += total;
      streamDur += duration;
    }
  }

  return { swatTotal, streamTotal, swatDur, streamDur };
}

function extractSwatAssignees(memberStats: AllureMemberStatItem[], swatSet: Set<string>) {
  const out = new Set<string>();
  for (const member of memberStats || []) {
    const assignee = normalizeLogin(member?.assignee);
    if (!assignee || !swatSet.has(assignee)) continue;
    if (memberTotalCount(member) > 0) out.add(assignee);
  }
  return out;
}

function normalizeIssueTypeValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return normalizeIssueTypeValue(value[0]);
  if (value && typeof value === 'object') {
    const record = value as { name?: string; localizedName?: string; presentation?: string; value?: string };
    return String(record.name || record.localizedName || record.presentation || record.value || '').trim();
  }
  return '';
}

function extractIssueType(issue: DeployIssue | YtIssueResponse) {
  const candidates = [
    (issue as { type?: unknown }).type,
    (issue as { issueType?: unknown }).issueType,
    (issue as { typeName?: unknown }).typeName,
  ];

  for (const candidate of candidates) {
    const value = normalizeIssueTypeValue(candidate);
    if (value) return value;
  }

  const fields: NonNullable<YtIssueResponse['fields']> = Array.isArray((issue as YtIssueResponse).fields)
    ? (issue as YtIssueResponse).fields as NonNullable<YtIssueResponse['fields']>
    : [];
  for (const field of fields) {
    const name = String(field?.name || field?.projectCustomField?.field?.name || '').trim().toLowerCase();
    if (name === 'type' || name === 'тип') {
      const value = normalizeIssueTypeValue(field?.value);
      if (value) return value;
    }
  }

  return '';
}

function extractIssueTags(issue: DeployIssue | YtIssueResponse) {
  const tags: unknown[] = Array.isArray((issue as { tags?: unknown[] }).tags)
    ? (issue as { tags?: unknown[] }).tags as unknown[]
    : [];
  return tags
    .map(tag => {
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag === 'object') return String((tag as { name?: string }).name || '');
      return '';
    })
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function normalizeName(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function buildNormSet(list: string[]) {
  return new Set(list.map(normalizeName).filter(Boolean));
}

function hasTagFromSet(tags: string[], wantedSet: Set<string>) {
  return tags.some(tag => wantedSet.has(normalizeName(tag)));
}

function textHasAny(text: string, needles: string[]) {
  return needles.some(needle => needle && text.includes(needle));
}

const CHPTYPES_CONFIG = {
  product: {
    typeSet: buildNormSet(['Аналитика', 'Analytics', 'Analitics']),
    titleKeys: ['analytics', 'analitics', 'аналитика', 'аналитикой'].map(normalizeName),
  },
  vlet: {
    tagSet: buildNormSet(['Влет', 'Влёт', 'ВЛЁТ', 'Vlet']),
  },
  bug: {
    typeSet: buildNormSet(['Баг', 'Bug']),
    titleKeys: ['баг', 'bug', 'ошибк', 'дефект'].map(normalizeName),
  },
  crash: {
    tagSet: buildNormSet(['Краш', 'Crash']),
    titleKeys: ['краш', 'crash'].map(normalizeName),
  },
};

function aggregateIssuesByType(items: DeployIssue[]) {
  const counts: Record<string, number> = {};
  const details: Record<string, ChartsTaskTypeDetail[]> = {};
  const typeSet = new Set<string>();

  for (const item of items || []) {
    const type = normalizeIssueTypeValue(extractIssueType(item) || 'Unknown') || 'Unknown';
    typeSet.add(type);
    counts[type] = (counts[type] || 0) + 1;
    if (!details[type]) details[type] = [];
    details[type].push({
      key: String(item?.key || ''),
      summary: String(item?.summary || item?.title || item?.name || ''),
      status: String(item?.status || ''),
      stream: String(item?.stream || ''),
      merged_after_cutoff: item?.merged_after_cutoff === true,
    });
  }

  Object.values(details).forEach(list => list.sort((left, right) => left.key.localeCompare(right.key)));
  return { counts, details, typeSet };
}

function sortTypesByCanon(typeSet: Set<string>) {
  const types = Array.from(typeSet || []);
  const canon = types.filter(type => TYPES_CANON_ORDER.includes(type));
  const rest = types.filter(type => !TYPES_CANON_ORDER.includes(type));
  canon.sort((left, right) => TYPES_CANON_ORDER.indexOf(left) - TYPES_CANON_ORDER.indexOf(right));
  rest.sort((left, right) => left.localeCompare(right));
  return [...canon, ...rest];
}

function uniqueIssuesByKey(list: DeployIssue[]) {
  const map = new Map<string, DeployIssue>();
  for (const item of list || []) {
    const key = String(item?.key || '').trim().toUpperCase();
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function computeChpTypesCounts(issues: DeployIssue[], metaByKey: Map<string, YtIssueMeta>) {
  const counts = { product: 0, vlet: 0, bug: 0, crash: 0 };
  for (const issue of issues || []) {
    const type = normalizeName(extractIssueType(issue));
    const summary = normalizeName([issue?.summary, issue?.title, issue?.name].filter(Boolean).join(' '));
    const key = String(issue?.key || '').trim().toUpperCase();
    const meta = key ? (metaByKey.get(key) || { tags: [], typeValues: [] }) : { tags: [], typeValues: [] };
    const ytTypeMatch = (meta.typeValues || []).some(value =>
      CHPTYPES_CONFIG.product.typeSet.has(normalizeName(value)) || textHasAny(normalizeName(value), CHPTYPES_CONFIG.product.titleKeys)
    );

    if (
      CHPTYPES_CONFIG.product.typeSet.has(type)
      || textHasAny(type, CHPTYPES_CONFIG.product.titleKeys)
      || textHasAny(summary, CHPTYPES_CONFIG.product.titleKeys)
      || ytTypeMatch
    ) {
      counts.product += 1;
    }

    if (
      CHPTYPES_CONFIG.bug.typeSet.has(type)
      || textHasAny(type, CHPTYPES_CONFIG.bug.titleKeys)
      || textHasAny(summary, CHPTYPES_CONFIG.bug.titleKeys)
    ) {
      counts.bug += 1;
    }

    const tags = extractIssueTags(issue).concat(meta.tags || []);
    if (hasTagFromSet(tags, CHPTYPES_CONFIG.crash.tagSet) || textHasAny(summary, CHPTYPES_CONFIG.crash.titleKeys)) {
      counts.crash += 1;
    }
  }
  return counts;
}

function computeVletCount(issues: DeployIssue[], metaByKey: Map<string, YtIssueMeta>) {
  let total = 0;
  for (const issue of issues || []) {
    const key = String(issue?.key || '').trim().toUpperCase();
    const meta = key ? (metaByKey.get(key) || { tags: [], typeValues: [] }) : { tags: [], typeValues: [] };
    const tags = extractIssueTags(issue).concat(meta.tags || []);
    if (hasTagFromSet(tags, CHPTYPES_CONFIG.vlet.tagSet)) total += 1;
  }
  return total;
}

function classifyDeployIssue(issue: DeployIssue) {
  const summary = normalizeName(issue?.summary || issue?.title || issue?.name || '');
  const type = normalizeName(extractIssueType(issue));
  const tags = extractIssueTags(issue).map(normalizeName);
  return {
    isProduct: type.includes('аналит') || type.includes('analytics') || summary.includes('аналит'),
    isVlet: tags.some(tag => tag.includes('влет') || tag.includes('влёт') || tag.includes('vlet')) || summary.includes('влет') || summary.includes('влёт') || summary.includes('vlet'),
    isCrash: tags.some(tag => tag.includes('краш') || tag.includes('crash')) || summary.includes('краш') || summary.includes('crash'),
    isBug: type.includes('bug') || type.includes('баг') || summary.includes('ошибк') || summary.includes('дефект') || summary.includes('bug'),
  };
}

async function fetchDeployIssuesList(cfg: ChartsConfig, prefix: 'IOS' | 'ANDROID', release: string) {
  const token = String(cfg.deployLabToken || '').trim();
  if (!token) return [];
  const url = DEPLOY_ISSUES_URL_TMPL.replace('{prefix}', prefix).replace('{rel}', release);
  const data = await fetchJson<unknown>(
    cfg,
    url,
    { headers: buildDeployHeaders(token) }
  );
  if (Array.isArray(data)) return data as DeployIssue[];
  if (Array.isArray((data as { data?: unknown[] })?.data)) return (data as { data: DeployIssue[] }).data;
  if (Array.isArray((data as { content?: unknown[] })?.content)) return (data as { content: DeployIssue[] }).content;
  return [];
}

async function fetchDeployIssueCount(cfg: ChartsConfig, prefix: 'IOS' | 'ANDROID', release: string) {
  const issues = await fetchDeployIssuesList(cfg, prefix, release);
  return issues.filter(item => item?.merged_after_cutoff === true).length;
}

async function fetchYtIssueMeta(cfg: ChartsConfig, key: string) {
  const normalized = String(key || '').trim().toUpperCase();
  if (!normalized || !String(cfg.ytToken || '').trim() || !String(cfg.ytBase || '').trim()) {
    return { tags: [], typeValues: [] };
  }
  const authKey = getYtMetaAuthKey(cfg);
  if (ytIssueMetaForbiddenByAuth.has(authKey)) {
    return { tags: [], typeValues: [] };
  }
  const cacheKey = `${authKey}::${normalized}`;
  if (ytIssueMetaCache.has(cacheKey)) return ytIssueMetaCache.get(cacheKey)!;

  const promise = (async () => {
    const fields = [
      'idReadable',
      'summary',
      'tags(name)',
      'fields(projectCustomField(field(name)),value(name,$type),$type)',
    ].join(',');
    const url = `${normalizeChartsYtBase(String(cfg.ytBase || ''))}/api/issues/${encodeURIComponent(normalized)}?fields=${encodeURIComponent(fields)}&$top=-1`;
    try {
      const data = await fetchJson<YtIssueResponse>(cfg, url, { headers: buildYtHeaders(String(cfg.ytToken || '').trim()) });
      const tags = extractIssueTags(data);
      const fields = Array.isArray(data?.fields) ? data.fields : [];
      const typeValues = fields.flatMap(field => {
        const fieldName = String(field?.projectCustomField?.field?.name || field?.name || '').trim();
        if (fieldName !== 'Type' && fieldName !== 'Тип') return [];
        const value = field?.value;
        if (Array.isArray(value)) return value.map(normalizeIssueTypeValue).filter(Boolean);
        const single = normalizeIssueTypeValue(value);
        return single ? [single] : [];
      });
      return { tags, typeValues };
    } catch (error) {
      if (isHttp403Error(error)) {
        markYtMetaForbidden(
          authKey,
          'YouTrack вернул 403 на чтение meta issue. Обогащение по Type/tags отключено, используем только данные DeployLab.'
        );
      }
      return { tags: [], typeValues: [] };
    }
  })();

  ytIssueMetaCache.set(cacheKey, promise);
  return promise;
}

async function fetchYtIssueMetaBatch(cfg: ChartsConfig, issues: DeployIssue[], options?: CollectChartsOptions) {
  const metaByKey = new Map<string, YtIssueMeta>();
  const ytMetaAuthKey = getYtMetaAuthKey(cfg);
  const keys = Array.from(
    new Set(
      issues
        .filter(issueNeedsYtMeta)
        .map(item => String(item?.key || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (!keys.length || !String(cfg.ytToken || '').trim() || ytIssueMetaForbiddenByAuth.has(ytMetaAuthKey)) {
    const warning = ytIssueMetaForbiddenMessageByAuth.get(ytMetaAuthKey);
    if (warning) log(options, warning, 'warn');
    return metaByKey;
  }

  const firstKey = keys[0]!;
  const firstMeta = await fetchYtIssueMeta(cfg, firstKey);
  metaByKey.set(firstKey, firstMeta);

  if (ytIssueMetaForbiddenByAuth.has(ytMetaAuthKey)) {
    const warning = ytIssueMetaForbiddenMessageByAuth.get(ytMetaAuthKey);
    if (warning) log(options, warning, 'warn');
    return metaByKey;
  }

  const restKeys = keys.slice(1);
  if (restKeys.length) {
    for (const key of restKeys) {
      if (cfg.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (ytIssueMetaForbiddenByAuth.has(ytMetaAuthKey)) break;
      metaByKey.set(key, await fetchYtIssueMeta(cfg, key));
    }
  }

  return metaByKey;
}

function dayShortRuFromDow(dow: number) {
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][dow] || '';
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function parseTzOffsetMinutes(iso: string) {
  const match = String(iso || '').match(/([+-])(\d{2}):?(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function normalizeIsoForJs(value: unknown) {
  const raw = String(value || '').trim();
  return raw || '';
}

function toMskLocalParts(iso: unknown) {
  const normalized = normalizeIsoForJs(iso);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  const offsetMinutes = parseTzOffsetMinutes(normalized);
  const msLocal = date.getTime() + offsetMinutes * 60_000;
  const localDate = new Date(msLocal);
  const dow = localDate.getUTCDay();
  const dd = pad2(localDate.getUTCDate());
  const mm = pad2(localDate.getUTCMonth() + 1);
  const hh = pad2(localDate.getUTCHours());
  const min = pad2(localDate.getUTCMinutes());
  return {
    msLocal,
    dow,
    dayShort: dayShortRuFromDow(dow),
    fullText: `${dayShortRuFromDow(dow)} ${dd}.${mm} ${hh}:${min}`,
  };
}

function labelFromMsLocal(msLocal: number) {
  const date = new Date(msLocal);
  return `${dayShortRuFromDow(date.getUTCDay())} ${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function yValueFromIsoCut(iso: unknown) {
  const parts = toMskLocalParts(iso);
  if (!parts) return null;
  const date = new Date(parts.msLocal);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return { y: minutes, msLocal: parts.msLocal, label: parts.fullText };
}

function yValueFromMsLocalCut(msLocal: number | null | undefined) {
  const ms = Number(msLocal);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return { y: minutes, msLocal: ms, label: labelFromMsLocal(ms) };
}

function extractEarliestNoteDate(deployObj: unknown, sectionKey: string) {
  if (!deployObj || typeof deployObj !== 'object') return null;
  const section = (deployObj as Record<string, unknown>)[sectionKey];
  if (!section || typeof section !== 'object') return null;
  const notes: Array<{ date?: string }> = Array.isArray((section as { notes?: unknown[] }).notes)
    ? (section as { notes?: Array<{ date?: string }> }).notes ?? []
    : [];
  const dates = notes
    .map(note => toMskLocalParts(note?.date))
    .map(parts => Number(parts?.msLocal || NaN))
    .filter(Number.isFinite);
  return dates.length ? Math.min(...dates) : null;
}

async function fetchDeployDates(cfg: ChartsConfig, prefix: 'IOS' | 'ANDROID', release: string) {
  const token = String(cfg.deployLabToken || '').trim();
  if (!token) return { cutoff: null as string | null, storeMsLocal: null as number | null };

  const baseUrl = DEPLOY_BASE_URL_TMPL.replace('{prefix}', prefix).replace('{rel}', release);
  const deployUrl = DEPLOY_DEPLOY_URL_TMPL.replace('{prefix}', prefix).replace('{rel}', release);

  let cutoffIso: string | null = null;
  let storeMsLocal: number | null = null;

  try {
    const base = await fetchJson<Record<string, unknown>>(cfg, baseUrl, { headers: buildDeployHeaders(token) });
    cutoffIso = String(base?.cutoff_date || '') || null;
  } catch {
    cutoffIso = null;
  }

  try {
    const deploy = await fetchJson<Record<string, unknown>>(cfg, deployUrl, { headers: buildDeployHeaders(token) });
    storeMsLocal = prefix === 'ANDROID'
      ? extractEarliestNoteDate(deploy, 'Google Play')
      : extractEarliestNoteDate(deploy, 'AppStore');
  } catch {
    storeMsLocal = null;
  }

  return { cutoff: cutoffIso, storeMsLocal };
}

function parseIsoToMs(iso: string | null | undefined) {
  const date = new Date(String(iso || ''));
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function buildGitlabPipelinesUrl(config: typeof GITLAB_PIPELINE_CONFIG[keyof typeof GITLAB_PIPELINE_CONFIG], release: string, page = 1) {
  const url = new URL(`${GITLAB_BASE_URL}/api/v4/projects/${encodeURIComponent(config.fullPath)}/pipelines`);
  if (config.scope && String(config.scope).toLowerCase() !== 'all') {
    url.searchParams.set('scope', config.scope);
  }
  url.searchParams.set('page', String(page));
  url.searchParams.set('ref', `release/${release}`);
  url.searchParams.set('per_page', String(GITLAB_PIPELINE_PAGE_SIZE));
  return url.toString();
}

function buildGitlabPipelineJobsUrl(config: typeof GITLAB_PIPELINE_CONFIG[keyof typeof GITLAB_PIPELINE_CONFIG], iid: string, after: string | null = null) {
  const query = [
    'query getPipelineJobs($fullPath: ID!, $iid: ID!, $after: String) {',
    '  project(fullPath: $fullPath) {',
    '    pipeline(iid: $iid) {',
    '      jobs(after: $after, first: 20) {',
    '        pageInfo { hasNextPage endCursor }',
    '        nodes { name finishedAt }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join(' ');

  const url = new URL(GITLAB_GRAPHQL_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('operationName', 'getPipelineJobs');
  url.searchParams.set('variables', JSON.stringify({
    fullPath: config.fullPath,
    iid: String(iid),
    after: after || null,
  }));
  return url.toString();
}

async function fetchGitlabOldestPipeline(cfg: ChartsConfig, config: typeof GITLAB_PIPELINE_CONFIG[keyof typeof GITLAB_PIPELINE_CONFIG], release: string) {
  const headerVariants = buildGitlabHeaderVariants(String(cfg.gitlabToken || '').trim(), String(cfg.gitlabCookie || '').trim());
  if (!headerVariants.length) return null;

  let oldest: { iid: string; createdAt: string; createdMs: number } | null = null;
  for (let page = 1; page <= 50; page += 1) {
    const data = await fetchJsonWithHeaderVariants<GitlabPipelineInfo[] | { pipelines?: GitlabPipelineInfo[] }>(
      cfg,
      buildGitlabPipelinesUrl(config, release, page),
      headerVariants
    );
    const pipelines = Array.isArray(data)
      ? data
      : Array.isArray((data as { pipelines?: unknown[] })?.pipelines)
        ? ((data as { pipelines: GitlabPipelineInfo[] }).pipelines)
        : [];

    if (!pipelines.length) break;

    for (const pipeline of pipelines) {
      const createdAt = String(pipeline?.created_at || pipeline?.createdAt || pipeline?.created || '');
      const createdMs = parseIsoToMs(createdAt);
      if (!createdAt || !Number.isFinite(createdMs)) continue;
      const iid = String(pipeline?.iid || '').trim();
      if (!iid) continue;
      if (!oldest || createdMs! < oldest.createdMs) {
        oldest = { iid, createdAt, createdMs: createdMs! };
      }
    }

    if (pipelines.length < GITLAB_PIPELINE_PAGE_SIZE) break;
  }

  return oldest;
}

async function fetchGitlabPipelineJobFinishedAt(cfg: ChartsConfig, config: typeof GITLAB_PIPELINE_CONFIG[keyof typeof GITLAB_PIPELINE_CONFIG], iid: string) {
  const headerVariants = buildGitlabHeaderVariants(String(cfg.gitlabToken || '').trim(), String(cfg.gitlabCookie || '').trim());
  if (!headerVariants.length || !iid) return null;

  let after: string | null = null;
  for (let page = 0; page < 30; page += 1) {
    const data: GitlabJobsPage = await fetchJsonWithHeaderVariants<GitlabJobsPage>(
      cfg,
      buildGitlabPipelineJobsUrl(config, iid, after),
      headerVariants
    );

    const jobs = data?.data?.project?.pipeline?.jobs;
    const nodes: Array<{ name?: string; finishedAt?: string }> = Array.isArray(jobs?.nodes) ? jobs.nodes : [];
    const target = nodes.find((node: { name?: string; finishedAt?: string }) => String(node?.name || '').trim() === config.jobName);
    if (target?.finishedAt) return target.finishedAt;
    if (!jobs?.pageInfo?.hasNextPage || !jobs?.pageInfo?.endCursor) break;
    after = jobs.pageInfo.endCursor;
  }
  return null;
}

async function fetchRegressionStartPoint(cfg: ChartsConfig, platformKey: keyof typeof GITLAB_PIPELINE_CONFIG, release: string) {
  const config = GITLAB_PIPELINE_CONFIG[platformKey];
  if (!config) return null;
  const oldest = await fetchGitlabOldestPipeline(cfg, config, release);
  if (!oldest?.iid) return null;
  const finishedAt = await fetchGitlabPipelineJobFinishedAt(cfg, config, oldest.iid);
  const parts = toMskLocalParts(finishedAt);
  if (!parts) return null;
  const shiftedMs = parts.msLocal + config.offsetMinutes * 60_000;
  return yValueFromMsLocalCut(shiftedMs);
}

type ChartsReleaseMarker = {
  release: string;
  fromMs: number;
  toMs: number;
  source: string;
};

type ParsedDowntimeInterval = {
  start: Date;
  end: Date;
  durationMinutes: number;
};

type AndroidBandEvent = {
  id: string;
  kind: 'fail' | 'recovery';
  createdAtMs: number;
  title: string;
  text: string;
  branch: string;
  jobType: string;
  triggeredBy: string;
  commitMessage: string;
  mergeRequestUrl: string;
  pipelineUrl: string;
};

function normalizeReleaseWindowStart(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeReleaseWindowEnd(ms: number) {
  const date = new Date(ms);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function collectReleaseMarker(
  releaseMarkersMap: Map<string, { release: string; fromMs: number; toMs: number; sources: Set<string>; regressionFromMs: number; deployFromMs: number; deployToMs: number }>,
  release: string,
  ms: number | null | undefined,
  source: 'allure' | 'deploy' | 'regression'
) {
  const value = Number(ms);
  if (!release || !Number.isFinite(value)) return;
  const previous = releaseMarkersMap.get(release);
  if (!previous) {
    releaseMarkersMap.set(release, {
      release,
      fromMs: value,
      toMs: value,
      sources: new Set([source]),
      regressionFromMs: source === 'regression' ? value : Infinity,
      deployFromMs: source === 'deploy' ? value : Infinity,
      deployToMs: source === 'deploy' ? value : -Infinity,
    });
    return;
  }

  if (value < previous.fromMs) previous.fromMs = value;
  if (value > previous.toMs) previous.toMs = value;
  if (source === 'regression' && value < previous.regressionFromMs) previous.regressionFromMs = value;
  if (source === 'deploy') {
    if (value < previous.deployFromMs) previous.deployFromMs = value;
    if (value > previous.deployToMs) previous.deployToMs = value;
  }
  previous.sources.add(source);
}

function buildReleaseMarkersList(
  releaseMarkersMap: Map<string, { release: string; fromMs: number; toMs: number; sources: Set<string>; regressionFromMs: number; deployFromMs: number; deployToMs: number }>
): ChartsReleaseMarker[] {
  return Array.from(releaseMarkersMap.values())
    .filter(item => item && Number.isFinite(item.fromMs) && Number.isFinite(item.toMs))
    .map(item => {
      const rawTo = normalizeReleaseWindowEnd(item.toMs);
      const hasRegression = Number.isFinite(item.regressionFromMs) && item.regressionFromMs !== Infinity;
      const hasDeploy = Number.isFinite(item.deployFromMs) && item.deployFromMs !== Infinity;
      const rawFrom = hasRegression
        ? normalizeReleaseWindowStart(item.regressionFromMs)
        : hasDeploy
          ? normalizeReleaseWindowStart(item.deployFromMs)
          : normalizeReleaseWindowStart(item.fromMs);
      const fromMs = rawTo - rawFrom > RELEASE_MARKER_MAX_WINDOW_MS
        ? rawTo - RELEASE_MARKER_MAX_WINDOW_MS
        : rawFrom;
      return {
        release: item.release,
        fromMs,
        toMs: rawTo,
        source: Array.from(item.sources || []).join(', '),
      };
    })
    .sort((left, right) => (left.fromMs - right.fromMs) || compareReleaseAsc(left.release, right.release));
}

function applyReleaseMarkersToDowntimeRows(rows: ChartsDowntimeRow[], releaseMarkers: ChartsReleaseMarker[]) {
  const markers = Array.isArray(releaseMarkers) ? releaseMarkers.slice() : [];
  if (!markers.length) {
    return rows.map(row => ({
      ...row,
      release: '',
      releaseShort: '',
    }));
  }

  return rows.map(row => {
    const anchorMs = Number.isFinite(Number(row.startMs)) ? Number(row.startMs) : Number(row.endMs);
    const matched = markers.filter(item => Number.isFinite(anchorMs) && anchorMs >= item.fromMs && anchorMs <= item.toMs);
    const marker = matched.length === 1 ? matched[0] : null;
    return {
      ...row,
      release: marker?.release || '',
      releaseShort: marker?.release ? formatReleaseShort(marker.release) : '',
    };
  });
}

function filterDowntimeRowsByAssignedRelease(rows: ChartsDowntimeRow[]) {
  return (Array.isArray(rows) ? rows : []).filter(row => String(row.release || '').trim());
}

function summarizeDowntimeByRelease(rows: ChartsDowntimeRow[], releases: string[]) {
  const buckets = new Map<string, { totalMinutes: number; days: Set<string>; entries: number }>();
  releases.forEach(release => {
    buckets.set(release, { totalMinutes: 0, days: new Set<string>(), entries: 0 });
  });

  (rows || []).forEach(row => {
    const release = String(row.release || '').trim();
    if (!release || !buckets.has(release)) return;
    const bucket = buckets.get(release)!;
    bucket.totalMinutes += Number(row.totalMinutes || 0);
    bucket.entries += 1;
    if (row.rawDate) bucket.days.add(row.rawDate);
  });

  return releases.map(release => {
    const bucket = buckets.get(release) || { totalMinutes: 0, days: new Set<string>(), entries: 0 };
    return {
      release,
      totalMinutes: bucket.totalMinutes,
      days: bucket.days.size,
      entries: bucket.entries,
    } satisfies ChartsDowntimeReleaseRow;
  });
}

const RU_MONTHS: Record<string, number> = {
  январ: 0,
  феврал: 1,
  март: 2,
  апрел: 3,
  ма: 4,
  июн: 5,
  июл: 6,
  август: 7,
  сентябр: 8,
  октябр: 9,
  ноябр: 10,
  декабр: 11,
};

function normalizeWikiMultilineText(value: unknown) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWikiInlineText(value: unknown) {
  return normalizeWikiMultilineText(value).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractWikiCellText(node: Element | null) {
  if (!node) return '';
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  clone.querySelectorAll('p, li, div').forEach(el => {
    if (!el.textContent?.endsWith('\n')) el.append('\n');
  });
  return normalizeWikiMultilineText(clone.textContent || '');
}

function buildNaiveDate(year: number, monthIndex: number, day: number, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute, 0, 0));
}

function parseDevDowntimeTime(raw: string) {
  const match = String(raw || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseDevDowntimeRowDate(rawDate: string, baseYear: number) {
  const text = normalizeWikiInlineText(rawDate).toLowerCase().replace(/[ё]/g, 'е');
  const dotMatch = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (dotMatch) {
    const day = Number(dotMatch[1]);
    const month = Number(dotMatch[2]) - 1;
    const year = dotMatch[3] ? Number(dotMatch[3].length === 2 ? `20${dotMatch[3]}` : dotMatch[3]) : baseYear;
    return buildNaiveDate(year, month, day);
  }

  const words = text.split(/\s+/);
  const day = Number(words.find(part => /^\d{1,2}$/.test(part)) || 1);
  const monthIndex = Object.entries(RU_MONTHS).find(([key]) => text.includes(key))?.[1] ?? 0;
  return buildNaiveDate(baseYear, monthIndex, day);
}

function shortenDevDowntimeDateLabel(rawDate: string) {
  const text = normalizeWikiInlineText(rawDate);
  const dotMatch = text.match(/(\d{1,2})[./](\d{1,2})/);
  if (dotMatch) return `${dotMatch[1].padStart(2, '0')}.${dotMatch[2].padStart(2, '0')}`;
  const parsed = parseDevDowntimeRowDate(text, new Date().getUTCFullYear());
  return `${pad2(parsed.getUTCDate())}.${pad2(parsed.getUTCMonth() + 1)}`;
}

function formatDevDowntimeDayLabel(date: Date) {
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}`;
}

function formatDevDowntimeDateTime(date: Date) {
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function formatDevDowntimeMinutes(value: number | null | undefined) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '—';
  return `${Math.max(0, Math.round(minutes))} мин`;
}

function parseDevDowntimeLine(line: string, rowDate: Date) {
  const normalized = normalizeWikiInlineText(line).replace(/^[0-9]+[.)]\s*/, '').trim();
  if (!normalized) return { interval: null as ParsedDowntimeInterval | null, warning: '' };
  const match = normalized.match(/(?:с\s*)?(\d{1,2}(?::\d{2})?)(?:\s+\d{1,2}(?:[./]\d{1,2})?)?\s+(?:и\s+)?до\s+(\d{1,2}(?::\d{2})?)(?:\s+\d{1,2}(?:[./]\d{1,2})?)?/i);
  if (!match) return { interval: null as ParsedDowntimeInterval | null, warning: normalized };
  const startTime = parseDevDowntimeTime(match[1]);
  const endTime = parseDevDowntimeTime(match[2]);
  if (!startTime || !endTime) return { interval: null as ParsedDowntimeInterval | null, warning: normalized };
  let start = buildNaiveDate(rowDate.getUTCFullYear(), rowDate.getUTCMonth(), rowDate.getUTCDate(), startTime.hour, startTime.minute);
  let end = buildNaiveDate(rowDate.getUTCFullYear(), rowDate.getUTCMonth(), rowDate.getUTCDate(), endTime.hour, endTime.minute);
  if (end.getTime() < start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return {
    interval: {
      start,
      end,
      durationMinutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)),
    },
    warning: '',
  };
}

function parseDevDowntimeIntervals(raw: string, rowDate: Date) {
  const lines = normalizeWikiMultilineText(raw)
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const intervals: ParsedDowntimeInterval[] = [];
  const warnings: string[] = [];
  lines.forEach(line => {
    const parsed = parseDevDowntimeLine(line, rowDate);
    if (parsed.interval) intervals.push(parsed.interval);
    else if (parsed.warning) warnings.push(parsed.warning);
  });
  return { intervals, warnings };
}

function getDevDowntimeRowRange(row: Pick<ChartsDowntimeRow, 'startMs' | 'endMs'>) {
  return {
    startMs: Number(row?.startMs || NaN),
    endMs: Number(row?.endMs || NaN),
  };
}

async function fetchWikiDevDowntimeRows(cfg: ChartsConfig) {
  const headers = buildWikiHeaders(String(cfg.wikiToken || '').trim());
  if (!headers) return [] as ChartsDowntimeRow[];
  const payload = await fetchJson<Record<string, unknown>>(cfg, WIKI_DEV_OUTAGES_URL, { headers }, false);
  const article = payload?.article as { content?: string; updated_at?: string; created_at?: string } | undefined;
  const html = String(article?.content || '').trim();
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];
  const baseYearSource = article?.updated_at || article?.created_at || new Date().toISOString();
  const baseYear = new Date(baseYearSource).getUTCFullYear() || new Date().getUTCFullYear();
  const rows: ChartsDowntimeRow[] = [];
  Array.from(table.querySelectorAll('tr')).slice(1).forEach(tr => {
    const cells = Array.from(tr.children || []);
    if (cells.length < 5) return;
    const rawDate = extractWikiCellText(cells[0]);
    if (!rawDate) return;
    const rowDate = parseDevDowntimeRowDate(rawDate, baseYear);
    const domainText = extractWikiCellText(cells[1]);
    const ownersText = extractWikiCellText(cells[2]);
    const downtimeText = extractWikiCellText(cells[3]);
    const commentText = extractWikiCellText(cells[4]);
    const { intervals, warnings } = parseDevDowntimeIntervals(downtimeText, rowDate);
    const totalMinutes = intervals.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
    rows.push({
      rawDate,
      shortDate: shortenDevDowntimeDateLabel(rawDate),
      release: '',
      releaseShort: '',
      totalMinutes,
      intervalText: intervals.length
        ? intervals.map((interval, index) => `${index + 1}) ${formatDevDowntimeDateTime(interval.start)} -> ${formatDevDowntimeDateTime(interval.end)} (${formatDevDowntimeMinutes(interval.durationMinutes)})`).join('\n')
        : normalizeWikiInlineText(downtimeText),
      domainText,
      ownersText,
      commentText,
      warnings,
      intervals: intervals.map(interval => ({
        startLabel: formatDevDowntimeDateTime(interval.start),
        endLabel: formatDevDowntimeDateTime(interval.end),
        durationMinutes: interval.durationMinutes,
      })),
      startMs: intervals[0]?.start.getTime() ?? rowDate.getTime(),
      endMs: intervals.length ? intervals[intervals.length - 1].end.getTime() : rowDate.getTime(),
    });
  });
  rows.sort((left, right) => Number(left.startMs || 0) - Number(right.startMs || 0));
  return rows;
}

function unwrapBandPostsPayload(raw: unknown): Record<string, unknown> {
  let node = raw as Record<string, unknown> | undefined;
  for (let index = 0; index < 4; index += 1) {
    if (node && typeof node === 'object' && node.posts && typeof node.posts === 'object') {
      return node;
    }
    if (node && typeof node === 'object' && node.body !== undefined) {
      if (typeof node.body === 'string') {
        try {
          const parsed = JSON.parse(node.body);
          if (parsed && typeof parsed === 'object') {
            node = parsed as Record<string, unknown>;
            continue;
          }
        } catch {
          /* noop */
        }
      } else if (node.body && typeof node.body === 'object') {
        node = node.body as Record<string, unknown>;
        continue;
      }
    }
    if (node && typeof node === 'object' && node.data && typeof node.data === 'object') {
      node = node.data as Record<string, unknown>;
      continue;
    }
    break;
  }
  return (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
}

async function fetchBandChannelPostsSince(cfg: ChartsConfig, channelId: string, sinceMs: number) {
  const headers = buildBandHeaders(String(cfg.bandCookies || '').trim());
  if (!headers) return [] as Record<string, unknown>[];
  const postsById = new Map<string, Record<string, unknown>>();
  const perPage = 30;
  let beforeId = '';

  for (let page = 0; page < 400; page += 1) {
    const url = new URL(`https://band.wb.ru/api/v4/channels/${encodeURIComponent(channelId)}/posts`);
    url.searchParams.set('page', '0');
    url.searchParams.set('per_page', String(perPage));
    if (beforeId) url.searchParams.set('before', beforeId);
    url.searchParams.set('skipFetchThreads', 'false');
    url.searchParams.set('collapsedThreads', 'true');
    url.searchParams.set('collapsedThreadsExtended', 'false');

    const payload = unwrapBandPostsPayload(await fetchJson<Record<string, unknown>>(cfg, url.toString(), { headers }, false));
    const postsMap = payload.posts && typeof payload.posts === 'object' ? payload.posts as Record<string, Record<string, unknown>> : {};
    const order = Array.isArray(payload.order) ? payload.order as string[] : Object.keys(postsMap);
    if (!order.length && !Object.keys(postsMap).length) break;

    const batch: Array<Record<string, unknown>> = [];
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

    batch.sort((left, right) => (Number(right?.create_at || 0) - Number(left?.create_at || 0)));
    const oldestPost = batch[batch.length - 1] || null;
    const oldestId = String(oldestPost?.id || '').trim();
    const oldestCreateAt = Number(oldestPost?.create_at || 0);
    if (!oldestId || oldestId === beforeId) break;
    beforeId = oldestId;
    if (order.length < perPage) break;
    if (Number.isFinite(sinceMs) && Number.isFinite(oldestCreateAt) && oldestCreateAt < sinceMs) break;
  }

  return Array.from(postsById.values())
    .filter(post => {
      const deletedAt = Number(post?.delete_at);
      if (Number.isFinite(deletedAt) && deletedAt > 0) return false;
      if (String(post?.root_id || '').trim()) return false;
      const createdAt = Number(post?.create_at);
      if (Number.isFinite(sinceMs) && Number.isFinite(createdAt) && createdAt < sinceMs) return false;
      return Number.isFinite(createdAt) && createdAt > 0;
    })
    .sort((left, right) => Number(left?.create_at || 0) - Number(right?.create_at || 0));
}

function normalizeBandMessageText(value: unknown) {
  return normalizeWikiMultilineText(
    String(value || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 $2')
      .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
  );
}

function extractBandPostText(post: Record<string, unknown>) {
  const chunks: string[] = [];
  const pushChunk = (value: unknown) => {
    const text = normalizeBandMessageText(value);
    if (text) chunks.push(text);
  };
  pushChunk(post?.message);
  const attachments = Array.isArray((post?.props as { attachments?: unknown[] } | undefined)?.attachments)
    ? ((post?.props as { attachments?: Array<Record<string, unknown>> }).attachments || [])
    : [];
  attachments.forEach(attachment => {
    pushChunk(attachment?.pretext);
    pushChunk(attachment?.title);
    pushChunk(attachment?.text);
    pushChunk(attachment?.fallback);
    const fields = Array.isArray(attachment?.fields) ? attachment.fields as Array<Record<string, unknown>> : [];
    fields.forEach(field => {
      const title = normalizeWikiInlineText(field?.title);
      const value = normalizeBandMessageText(field?.value);
      if (title && value) pushChunk(`${title}: ${value}`);
      else {
        pushChunk(title);
        pushChunk(value);
      }
    });
  });
  return normalizeWikiMultilineText(chunks.join('\n'));
}

function parseBandPostDetails(text: string) {
  const normalized = normalizeBandMessageText(text);
  const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const details = {
    text: normalized,
    title: lines[0] || '',
    branch: '',
    jobType: '',
    triggeredBy: '',
    commitMessage: '',
    mergeRequestUrl: '',
    pipelineUrl: '',
  };
  const commitLines: string[] = [];
  let captureCommit = false;
  lines.slice(1).forEach(rawLine => {
    const line = rawLine.trim();
    const plain = line.replace(/^[\\\-\s*]+/, '').trim();
    const mrMatch = line.match(/https?:\/\/gitlab\.wildberries\.ru\/\S*?\/merge_requests\/\d+\/?/i);
    if (mrMatch && !details.mergeRequestUrl) details.mergeRequestUrl = mrMatch[0];
    if (/^Pipeline:/i.test(plain)) {
      const pipelineMatch = line.match(/https?:\/\/\S+/i);
      if (pipelineMatch && !details.pipelineUrl) details.pipelineUrl = pipelineMatch[0];
      captureCommit = false;
      return;
    }
    if (/^Branch:/i.test(plain)) {
      details.branch = plain.replace(/^Branch:\s*/i, '').trim();
      captureCommit = false;
      return;
    }
    if (/^Job Type:/i.test(plain)) {
      details.jobType = plain.replace(/^Job Type:\s*/i, '').trim();
      captureCommit = false;
      return;
    }
    if (/^Triggered By:/i.test(plain)) {
      details.triggeredBy = plain.replace(/^Triggered By:\s*/i, '').trim();
      captureCommit = false;
      return;
    }
    if (/^Commit Message:/i.test(plain)) {
      captureCommit = true;
      const rest = plain.replace(/^Commit Message:\s*/i, '').trim();
      if (rest) commitLines.push(rest);
      return;
    }
    if (captureCommit) {
      if (/^(See merge request|Please review the pipeline|Details:|Детали:|Pipeline:|Branch:|Job Type:|Triggered By:)/i.test(plain)) {
        captureCommit = false;
      } else {
        commitLines.push(plain);
      }
    }
  });
  details.commitMessage = normalizeWikiMultilineText(commitLines.join('\n'));
  return details;
}

function classifyBandAndroidDevPost(details: { text: string; branch: string }) {
  const text = String(details?.text || '');
  const branch = String(details?.branch || '').trim().toLowerCase();
  if (branch && branch !== 'dev') return '';
  if (!branch && !/\bbranch:\s*`?dev`?\b/i.test(text)) return '';
  const lower = text.toLowerCase();
  if (/alert:\s*build debug failed/i.test(text) || lower.includes('дев поломан') || lower.includes('dev сломан')) return 'fail';
  if (lower.includes('dev починен') || lower.includes('dev снова зеленый') || lower.includes('dev снова зелёный') || lower.includes('дев снова работает')) return 'recovery';
  return '';
}

function parseBandAndroidDevEvent(post: Record<string, unknown>): AndroidBandEvent | null {
  const createdAtMs = Number(post?.create_at);
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  const text = extractBandPostText(post);
  if (!text) return null;
  const details = parseBandPostDetails(text);
  const kind = classifyBandAndroidDevPost(details) as 'fail' | 'recovery' | '';
  if (!kind) return null;
  return {
    ...details,
    id: String(post?.id || ''),
    kind,
    createdAtMs,
  };
}

function getBandDowntimeFetchWindow(releaseMarkers: ChartsReleaseMarker[]) {
  const msList: number[] = [];
  (releaseMarkers || []).forEach(marker => {
    if (Number.isFinite(Number(marker?.fromMs))) msList.push(Number(marker.fromMs));
    if (Number.isFinite(Number(marker?.toMs))) msList.push(Number(marker.toMs));
  });
  if (!msList.length) {
    return {
      sinceMs: Date.now() - BAND_DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      untilMs: null as number | null,
    };
  }
  return {
    sinceMs: Math.max(0, Math.min(...msList) - BAND_LOOKBACK_BUFFER_DAYS * 24 * 60 * 60 * 1000),
    untilMs: Math.max(...msList) + BAND_LOOKBACK_BUFFER_DAYS * 24 * 60 * 60 * 1000,
  };
}

function filterDowntimeRowsByWindow(rows: ChartsDowntimeRow[], sinceMs: number, untilMs: number | null) {
  return (rows || []).filter(row => {
    const range = getDevDowntimeRowRange(row);
    if (Number.isFinite(sinceMs) && Number.isFinite(range.endMs) && range.endMs < sinceMs) return false;
    if (Number.isFinite(Number(untilMs)) && Number.isFinite(range.startMs) && range.startMs > Number(untilMs)) return false;
    return true;
  });
}

function buildAndroidDevDowntimeRows(posts: Record<string, unknown>[]) {
  const events = (posts || [])
    .map(parseBandAndroidDevEvent)
    .filter((item): item is AndroidBandEvent => Boolean(item))
    .sort((left, right) => left.createdAtMs - right.createdAtMs);

  const rowsByKey = new Map<number, ChartsDowntimeRow>();
  let activeFailure: (AndroidBandEvent & { repeatedFailures: AndroidBandEvent[] }) | null = null;
  const ensureRow = (date: Date) => {
    const key = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const existing = rowsByKey.get(key);
    if (existing) return existing;
    const row: ChartsDowntimeRow = {
      rawDate: formatDevDowntimeDayLabel(date),
      shortDate: formatDevDowntimeDayLabel(date),
      release: '',
      releaseShort: '',
      totalMinutes: 0,
      intervalText: '',
      brokenText: '',
      fixedText: '',
      commentText: '',
      warnings: [],
      intervals: [],
      startMs: null,
      endMs: null,
    };
    rowsByKey.set(key, row);
    return row;
  };

  events.forEach(event => {
    if (event.kind === 'fail') {
      if (!activeFailure) {
        activeFailure = { ...event, repeatedFailures: [] };
      } else {
        activeFailure.repeatedFailures.push(event);
      }
      return;
    }
    if (event.kind !== 'recovery' || !activeFailure || event.createdAtMs < activeFailure.createdAtMs) return;
    const start = new Date(activeFailure.createdAtMs);
    const end = new Date(event.createdAtMs);
    const durationMinutes = Math.round((event.createdAtMs - activeFailure.createdAtMs) / 60000);
    if (durationMinutes < 0) return;
    const row = ensureRow(end);
    const repeatedFailures = activeFailure.repeatedFailures.length;
    row.totalMinutes += durationMinutes;
    row.startMs = row.startMs == null ? start.getTime() : Math.min(row.startMs, start.getTime());
    row.endMs = row.endMs == null ? end.getTime() : Math.max(row.endMs, end.getTime());
    row.intervals.push({
      startLabel: formatDevDowntimeDateTime(start),
      endLabel: formatDevDowntimeDateTime(end),
      durationMinutes,
    });
    row.intervalText = row.intervals
      .map((interval, index) => `${index + 1}) ${interval.startLabel} -> ${interval.endLabel} (${formatDevDowntimeMinutes(interval.durationMinutes)})`)
      .join('\n');
    row.brokenText = [row.brokenText, activeFailure.triggeredBy || '—'].filter(Boolean).join('\n');
    row.fixedText = [row.fixedText, event.triggeredBy || '—'].filter(Boolean).join('\n');
    const commentParts = [
      activeFailure.commitMessage ? `fail: ${normalizeWikiInlineText(activeFailure.commitMessage)}` : '',
      event.commitMessage ? `fix: ${normalizeWikiInlineText(event.commitMessage)}` : '',
      activeFailure.mergeRequestUrl ? `MR fail: ${activeFailure.mergeRequestUrl}` : '',
      event.mergeRequestUrl && event.mergeRequestUrl !== activeFailure.mergeRequestUrl ? `MR fix: ${event.mergeRequestUrl}` : '',
      repeatedFailures ? `повторных fail до восстановления: ${repeatedFailures}` : '',
    ].filter(Boolean);
    if (commentParts.length) {
      row.commentText = [row.commentText, commentParts.join(' | ')].filter(Boolean).join('\n');
    }
    if (repeatedFailures) {
      row.warnings = [...(row.warnings || []), `До восстановления было ${repeatedFailures + 1} fail-сообщения подряд`];
    }
    activeFailure = null;
  });

  return Array.from(rowsByKey.values()).sort((left, right) => Number(left.startMs || 0) - Number(right.startMs || 0));
}

async function fetchAndroidDevDowntimeRows(cfg: ChartsConfig, releaseMarkers: ChartsReleaseMarker[]) {
  const headers = buildBandHeaders(String(cfg.bandCookies || '').trim());
  if (!headers) return [] as ChartsDowntimeRow[];
  const { sinceMs, untilMs } = getBandDowntimeFetchWindow(releaseMarkers);
  const posts = await fetchBandChannelPostsSince(cfg, BAND_ANDROID_DEV_FAILURES_CHANNEL_ID, sinceMs);
  let rows = buildAndroidDevDowntimeRows(posts);
  rows = filterDowntimeRowsByWindow(rows, sinceMs, untilMs);
  rows = filterDowntimeRowsByAssignedRelease(applyReleaseMarkersToDowntimeRows(rows, releaseMarkers));
  return rows;
}

function normalizeStreamLabel(value: unknown) {
  let text = String(value || '').trim();
  text = text.replace(/^stream\s+/i, '').trim();
  return text || 'Без стрима';
}

function isExternalStreamLabel(label: string) {
  const normalized = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return ['финтех', 'банк', 'payments', 'платежи', 'travel', 'тревел', 'wb club', 'вб клуб']
    .some(value => normalized === value || normalized.includes(value));
}

function buildLatestStreamDeltaSummary(
  series: Array<{ release: string; counts: Map<string, number> }>,
  unitLabel: string
): ChartsStreamInsightSummary | null {
  if (!Array.isArray(series) || series.length < 2) return null;
  const previous = series[series.length - 2];
  const current = series[series.length - 1];
  const streams = new Set<string>([
    ...Array.from(previous.counts.keys()),
    ...Array.from(current.counts.keys()),
  ]);

  const deltas: ChartsStreamInsightItem[] = [];
  streams.forEach(rawStream => {
    const stream = normalizeStreamLabel(rawStream);
    const before = Number(previous.counts.get(rawStream) || 0);
    const after = Number(current.counts.get(rawStream) || 0);
    const delta = after - before;
    if (!delta) return;
    deltas.push({
      stream,
      delta,
      before,
      after,
      tone: delta > 0 ? 'bad' : 'good',
      external: isExternalStreamLabel(stream),
    });
  });

  deltas.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.delta - left.delta || left.stream.localeCompare(right.stream));
  return {
    from: previous.release,
    to: current.release,
    unitLabel,
    added: deltas.filter(item => item.delta > 0).slice(0, 3),
    removed: deltas.filter(item => item.delta < 0).slice(0, 3),
  };
}

function seriesStats(series: number[]) {
  const values = (Array.isArray(series) ? series : []).map(value => Number(value) || 0);
  const last = values.length ? values[values.length - 1] : 0;
  const prev = values.length > 1 ? values[values.length - 2] : 0;
  const delta = last - prev;
  const deltaPct = prev !== 0 ? (delta / prev) * 100 : (last !== 0 ? 100 : 0);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const std = values.length
    ? Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length)
    : 0;
  const slopePct = values.length > 1 ? ((last - values[0]) / (values[0] || 1)) * 100 : 0;
  return { last, prev, delta, deltaPct, mean, std, vol: std, slopePct, data: values };
}

function buildSeriesFromRows<T>(rows: T[], pick: (row: T) => number) {
  return (Array.isArray(rows) ? rows : []).map(row => Number(pick(row)) || 0);
}

function anomalyFromSeries(series: number[], label: string, options?: { pct?: number; z?: number; minAbs?: number }) {
  const stat = seriesStats(series);
  if (stat.data.length < 2) return null;
  const z = stat.std ? ((stat.last - stat.mean) / stat.std) : 0;
  const minAbs = Number(options?.minAbs ?? 5);
  const pct = Number(options?.pct ?? 30);
  const zThreshold = Number(options?.z ?? 2);
  const deltaAbs = Math.abs(stat.delta);
  const deltaPctAbs = Math.abs(stat.deltaPct);
  const isAnomaly = (Math.abs(z) >= zThreshold && deltaAbs >= minAbs) || (deltaPctAbs >= pct && deltaAbs >= minAbs);
  if (!isAnomaly) return null;
  return { label, delta: stat.delta, deltaPct: stat.deltaPct, last: stat.last, prev: stat.prev, z };
}

function buildLagSeries(storeSeries: Array<number | null>, cutSeries: Array<number | null>) {
  const length = Math.max(storeSeries.length, cutSeries.length);
  const out: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const store = Number(storeSeries[index]);
    const cut = Number(cutSeries[index]);
    if (Number.isFinite(store) && Number.isFinite(cut)) out.push(store - cut);
  }
  return out;
}

function detectReleaseAnomalies(report: Pick<ChartsReport, 'tcRows' | 'coverageRows' | 'selectiveRows' | 'avgRows' | 'chpRows' | 'timings'>): ChartsAnomalyBucket {
  const rows: ChartsAnomalyItem[] = [];
  const tcSeries = buildSeriesFromRows(report.tcRows, row => row.total);
  const covSwatSeries = buildSeriesFromRows(report.coverageRows, row => row.swatCount);
  const covStreamSeries = buildSeriesFromRows(report.coverageRows, row => row.streamCount);
  const covTotalSeries = buildSeriesFromRows(report.coverageRows, row => row.total);
  const selectiveSeries = buildSeriesFromRows(report.selectiveRows, row => row.total);
  const avgSeries = buildSeriesFromRows(report.avgRows, row => row.totalMs / 60000);
  const avgWeightedSeries = buildSeriesFromRows(report.avgRows, row => row.totalWeighted / 60000);
  const chpSeries = buildSeriesFromRows(report.chpRows, row => row.total);
  const cutIosSeries = report.timings.map(row => row.iosCutMinutes).filter((value): value is number => Number.isFinite(value as number));
  const cutAndroidSeries = report.timings.map(row => row.androidCutMinutes).filter((value): value is number => Number.isFinite(value as number));
  const storeIosSeries = report.timings.map(row => row.iosStoreMinutes).filter((value): value is number => Number.isFinite(value as number));
  const storeAndroidSeries = report.timings.map(row => row.androidStoreMinutes).filter((value): value is number => Number.isFinite(value as number));
  const regIosSeries = report.timings.map(row => row.iosRegressionMinutes).filter((value): value is number => Number.isFinite(value as number));
  const regAndroidSeries = report.timings.map(row => row.androidRegressionMinutes).filter((value): value is number => Number.isFinite(value as number));
  const lagIosSeries = buildLagSeries(report.timings.map(row => row.iosStoreMinutes), report.timings.map(row => row.iosCutMinutes));
  const lagAndroidSeries = buildLagSeries(report.timings.map(row => row.androidStoreMinutes), report.timings.map(row => row.androidCutMinutes));

  const push = (label: string, series: number[], opts?: { pct?: number; z?: number; minAbs?: number }) => {
    const item = anomalyFromSeries(series, label, opts);
    if (item) rows.push(item);
  };

  push('TC Total', tcSeries, { pct: 25, z: 2 });
  push('High/Blocker SWAT', covSwatSeries, { pct: 30, z: 2 });
  push('High/Blocker STREAM', covStreamSeries, { pct: 30, z: 2 });
  push('High/Blocker SWAT+Stream', covTotalSeries, { pct: 30, z: 2 });
  push('Selective Total', selectiveSeries, { pct: 30, z: 2 });
  push('Avg Time (Total)', avgSeries, { pct: 15, z: 2, minAbs: 0.5 });
  push('Avg Time (Weighted)', avgWeightedSeries, { pct: 15, z: 2, minAbs: 0.5 });
  push('Cherepiki Total', chpSeries, { pct: 40, z: 2, minAbs: 3 });
  push('iOS Cutoff', cutIosSeries, { pct: 3, z: 2, minAbs: 15 });
  push('Android Cutoff', cutAndroidSeries, { pct: 3, z: 2, minAbs: 15 });
  push('Regression Start iOS', regIosSeries, { pct: 3, z: 2, minAbs: 15 });
  push('Regression Start Android', regAndroidSeries, { pct: 3, z: 2, minAbs: 15 });
  push('Store iOS', storeIosSeries, { pct: 3, z: 2, minAbs: 20 });
  push('Store Android', storeAndroidSeries, { pct: 3, z: 2, minAbs: 20 });
  push('Lag Store iOS', lagIosSeries, { pct: 20, z: 2, minAbs: 15 });
  push('Lag Store Android', lagAndroidSeries, { pct: 20, z: 2, minAbs: 15 });

  rows.sort((left, right) => (Math.abs(right.z || 0) + Math.abs(right.deltaPct || 0) / 100) - (Math.abs(left.z || 0) + Math.abs(left.deltaPct || 0) / 100));
  return { count: rows.length, list: rows.slice(0, 4) };
}

function typeAnomsFromRows(rows: ChartsTaskTypeRow[], platformLabel: string) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const last = rows[rows.length - 1] || { counts: {} };
  const prev = rows[rows.length - 2] || { counts: {} };
  const keys = new Set<string>([...Object.keys(last.counts || {}), ...Object.keys(prev.counts || {})]);
  const out: ChartsAnomalyItem[] = [];
  keys.forEach(key => {
    const lastValue = Number(last.counts?.[key] || 0);
    const prevValue = Number(prev.counts?.[key] || 0);
    const delta = lastValue - prevValue;
    const deltaAbs = Math.abs(delta);
    const deltaPct = prevValue ? (delta / prevValue) * 100 : (lastValue ? 100 : 0);
    if (deltaAbs >= 20 || (deltaAbs >= 5 && Math.abs(deltaPct) >= 60)) {
      out.push({ label: `${platformLabel}: ${key}`, delta, deltaPct, last: lastValue, prev: prevValue });
    }
  });
  return out;
}

function typeAnomsFromChp(rows: ChartsChpTypeRow[], labelPrefix: string) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const keys: Array<keyof ChartsChpTypeRow> = ['product', 'vlet', 'bug', 'crash'];
  const out: ChartsAnomalyItem[] = [];
  for (const key of keys) {
    const lastValue = Number(last?.[key] || 0);
    const prevValue = Number(prev?.[key] || 0);
    const delta = lastValue - prevValue;
    const deltaAbs = Math.abs(delta);
    const deltaPct = prevValue ? (delta / prevValue) * 100 : (lastValue ? 100 : 0);
    if (deltaAbs >= 10 || (deltaAbs >= 3 && Math.abs(deltaPct) >= 60)) {
      out.push({ label: `${labelPrefix}: ${String(key).toUpperCase()}`, delta, deltaPct, last: lastValue, prev: prevValue });
    }
  }
  return out;
}

function detectTypeAnomalies(report: Pick<ChartsReport, 'taskTypes' | 'chpTypes'>): ChartsAnomalyBucket {
  const out = [
    ...typeAnomsFromRows(report.taskTypes.iosRows, 'iOS'),
    ...typeAnomsFromRows(report.taskTypes.androidRows, 'Android'),
    ...typeAnomsFromChp(report.chpTypes.rows, 'ЧП'),
  ];
  out.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  return { count: out.length, list: out.slice(0, 6) };
}

function detectPlatformAnomalies(report: Pick<ChartsReport, 'chpRows' | 'taskTypes'>): ChartsAnomalyBucket {
  const out: ChartsAnomalyItem[] = [];
  if (report.chpRows.length >= 2) {
    const last = report.chpRows[report.chpRows.length - 1];
    const prev = report.chpRows[report.chpRows.length - 2];
    const metrics = [
      { label: 'Cherepiki iOS', last: Number(last.ios || 0), prev: Number(prev.ios || 0) },
      { label: 'Cherepiki Android', last: Number(last.android || 0), prev: Number(prev.android || 0) },
    ];
    metrics.forEach(metric => {
      const delta = metric.last - metric.prev;
      const deltaAbs = Math.abs(delta);
      const deltaPct = metric.prev ? (delta / metric.prev) * 100 : (metric.last ? 100 : 0);
      if (deltaAbs >= 5 && Math.abs(deltaPct) >= 40) {
        out.push({ label: metric.label, delta, deltaPct, last: metric.last, prev: metric.prev });
      }
    });
  }

  const sumTotals = (rows: ChartsTaskTypeRow[]) => rows.map(row => Object.values(row.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0));
  const iosSeries = sumTotals(report.taskTypes.iosRows);
  const androidSeries = sumTotals(report.taskTypes.androidRows);
  const iosAnom = anomalyFromSeries(iosSeries, 'Types iOS Total', { pct: 35, z: 2, minAbs: 5 });
  const androidAnom = anomalyFromSeries(androidSeries, 'Types Android Total', { pct: 35, z: 2, minAbs: 5 });
  if (iosAnom) out.push(iosAnom);
  if (androidAnom) out.push(androidAnom);

  out.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  return { count: out.length, list: out.slice(0, 4) };
}

function computeAnomalies(report: Pick<ChartsReport, 'tcRows' | 'coverageRows' | 'selectiveRows' | 'avgRows' | 'chpRows' | 'timings' | 'taskTypes' | 'chpTypes'>): ChartsAnomalies {
  const release = detectReleaseAnomalies(report);
  const type = detectTypeAnomalies(report);
  const platform = detectPlatformAnomalies(report);
  return {
    release,
    type,
    platform,
    score: release.count + type.count + platform.count,
  };
}

function featureVector(features: ChartsMlFeatures) {
  return FEATURE_KEYS.map(key => Number(features?.[key] ?? 0));
}

function featureVectorKey(features: ChartsMlFeatures) {
  return JSON.stringify(featureVector(features).map(value => Number(value.toFixed(4))));
}

function normalizeMlEntry(entry: unknown, index = 0): ChartsMlDatasetEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Partial<ChartsMlDatasetEntry>;
  const features = source.features && typeof source.features === 'object' ? { ...(source.features as ChartsMlFeatures) } : null;
  if (!features) return null;
  return {
    id: String(source.id || `ml_${Date.now()}_${index}`),
    time: String(source.time || new Date().toISOString()),
    features,
    label: source.label === 'ok' || source.label === 'fail' ? source.label : null,
    labeledAt: source.labeledAt ? String(source.labeledAt) : null,
    release: source.release ? String(source.release) : null,
    predictedRiskPct: Number.isFinite(Number(source.predictedRiskPct)) ? Number(source.predictedRiskPct) : null,
    linearProbability: Number.isFinite(Number(source.linearProbability)) ? Number(source.linearProbability) : null,
    catboostProbability: Number.isFinite(Number(source.catboostProbability)) ? Number(source.catboostProbability) : null,
  };
}

function normalizeChartsMlDataset(dataset: unknown[]): ChartsMlDatasetEntry[] {
  return (Array.isArray(dataset) ? dataset : [])
    .map((entry, index) => normalizeMlEntry(entry, index))
    .filter((entry): entry is ChartsMlDatasetEntry => Boolean(entry))
    .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime())
    .slice(-400);
}

export function readChartsMlDataset() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ML_DATA_KEY) || '[]';
    const parsed = safeJsonParse<unknown[]>(raw, []);
    return normalizeChartsMlDataset(parsed);
  } catch {
    return [];
  }
}

function writeChartsMlDataset(dataset: ChartsMlDatasetEntry[]) {
  const normalized = normalizeChartsMlDataset(dataset);
  if (typeof window === 'undefined') return normalized;
  localStorage.setItem(ML_DATA_KEY, JSON.stringify(normalized));
  return normalized;
}

function getLastMlExportId() {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(ML_LAST_EXPORT_KEY) || '';
  } catch {
    return '';
  }
}

function rememberLastMlExportId(id: string) {
  if (typeof window === 'undefined' || !id) return;
  try {
    localStorage.setItem(ML_LAST_EXPORT_KEY, id);
  } catch {
    /* noop */
  }
}

export function ensureChartsMlExportEntry(
  features: ChartsMlFeatures,
  meta?: {
    release?: string | null;
    predictedRiskPct?: number | null;
    linearProbability?: number | null;
    catboostProbability?: number | null;
  }
) {
  const dataset = readChartsMlDataset();
  const currentKey = featureVectorKey(features);
  const lastId = getLastMlExportId();
  const existing = dataset.find(item => item.id === lastId) || dataset[dataset.length - 1];
  if (existing && featureVectorKey(existing.features) === currentKey) {
    rememberLastMlExportId(existing.id);
    return { created: false, entry: existing, dataset };
  }

  const entry: ChartsMlDatasetEntry = {
    id: `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    features,
    label: null,
    labeledAt: null,
    release: meta?.release || null,
    predictedRiskPct: Number.isFinite(Number(meta?.predictedRiskPct)) ? Number(meta?.predictedRiskPct) : null,
    linearProbability: Number.isFinite(Number(meta?.linearProbability)) ? Number(meta?.linearProbability) : null,
    catboostProbability: Number.isFinite(Number(meta?.catboostProbability)) ? Number(meta?.catboostProbability) : null,
  };
  const nextDataset = writeChartsMlDataset([...dataset, entry]);
  rememberLastMlExportId(entry.id);
  return { created: true, entry, dataset: nextDataset };
}

export function labelChartsMlExport(label: 'ok' | 'fail', entryId?: string) {
  const dataset = readChartsMlDataset();
  if (!dataset.length) throw new Error('Нет сохраненной ML-выгрузки');
  const targetId = entryId || getLastMlExportId();
  const targetIndex = targetId ? dataset.findIndex(item => item.id === targetId) : dataset.length - 1;
  const index = targetIndex >= 0 ? targetIndex : dataset.length - 1;
  if (index < 0) throw new Error('Не удалось найти ML-выгрузку');

  dataset[index] = {
    ...dataset[index],
    label,
    labeledAt: new Date().toISOString(),
  };

  const next = writeChartsMlDataset(dataset);
  rememberLastMlExportId(next[index].id);
  return next;
}

type ChartsMlDatasetIoConfig = Pick<ChartsConfig, 'proxyBase' | 'proxyMode' | 'useProxy' | 'signal' | 'mlHelperBase'>;

async function fetchChartsMlDriveText(cfg: ChartsMlDatasetIoConfig, targetUrl: string, init?: RequestInit) {
  if (cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    const response = await proxyFetch(
      {
        base: String(cfg.proxyBase || '').trim(),
        mode: cfg.proxyMode,
        signal: cfg.signal,
      },
      targetUrl,
      init
    );
    const text = await response.text().catch(() => '');
    if (!response.ok && response.status !== 302) {
      throw new Error(`Drive HTTP ${response.status}${text ? ` — ${text.slice(0, 220)}` : ''}`);
    }
    return text;
  }

  const response = await fetch(targetUrl, { ...init, signal: cfg.signal, cache: 'no-store' });
  const text = await response.text().catch(() => '');
  if (!response.ok && response.status !== 302) {
    throw new Error(`Drive HTTP ${response.status}${text ? ` — ${text.slice(0, 220)}` : ''}`);
  }
  return text;
}

async function getChartsMlDriveJsonFile<T>(cfg: ChartsMlDatasetIoConfig, name: string, fallback: T): Promise<T> {
  const raw = await fetchChartsMlDriveText(cfg, `${ML_DRIVE_URL}?op=get&name=${encodeURIComponent(name)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const parsed = safeJsonParse<T>(raw || '', fallback);
  return parsed == null ? fallback : parsed;
}

async function saveChartsMlDriveDataset(cfg: ChartsMlDatasetIoConfig, dataset: ChartsMlDatasetEntry[]) {
  await fetchChartsMlDriveText(cfg, `${ML_DRIVE_URL}?name=${encodeURIComponent(ML_DRIVE_FILE)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(normalizeChartsMlDataset(dataset)),
  });
  return true;
}

export async function ensureChartsMlDatasetLoaded(cfg: ChartsMlDatasetIoConfig) {
  const local = readChartsMlDataset();
  try {
    const remotePayload = await getChartsMlDriveJsonFile<unknown[]>(cfg, ML_DRIVE_FILE, []);
    const merged = writeChartsMlDataset([...(local || []), ...(Array.isArray(remotePayload) ? remotePayload : [])] as ChartsMlDatasetEntry[]);
    return { dataset: merged, remote: true, error: '' };
  } catch (error) {
    return {
      dataset: local,
      remote: false,
      error: (error as Error)?.message || String(error),
    };
  }
}

export async function syncChartsMlDatasetToDrive(cfg: ChartsMlDatasetIoConfig) {
  const dataset = readChartsMlDataset();
  await saveChartsMlDriveDataset(cfg, dataset);
  return dataset;
}

function trainMlModel(dataset: ChartsMlDatasetEntry[]): ChartsLinearModel {
  const labeled = (dataset || []).filter(item => item?.label === 'ok' || item?.label === 'fail');
  const count = labeled.length;
  const minCount = 5;
  if (count < minCount) {
    return {
      trained: false,
      count,
      minCount,
      reason: count > 0
        ? `Нужно минимум ${minCount} размеченных выгрузок. Сейчас: ${count}/${minCount}`
        : `Нужно минимум ${minCount} размеченных выгрузок`,
    };
  }

  const X = labeled.map(item => featureVector(item.features));
  const y = labeled.map(item => item.label === 'fail' ? 1 : 0);
  const n = FEATURE_KEYS.length;
  const mean = new Array(n).fill(0);
  const std = new Array(n).fill(0);

  for (let col = 0; col < n; col += 1) {
    mean[col] = X.reduce((sum, row) => sum + row[col], 0) / count;
    std[col] = Math.sqrt(X.reduce((sum, row) => sum + Math.pow(row[col] - mean[col], 2), 0) / count) || 1;
  }

  const normalized = X.map(row => row.map((value, index) => (value - mean[index]) / std[index]));
  const w = new Array(n + 1).fill(0);
  const learningRate = 0.15;
  const iterations = 400;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const grad = new Array(n + 1).fill(0);
    for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
      const row = normalized[rowIndex];
      let z = w[0];
      for (let col = 0; col < n; col += 1) z += w[col + 1] * row[col];
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[rowIndex];
      grad[0] += err;
      for (let col = 0; col < n; col += 1) grad[col + 1] += err * row[col];
    }
    for (let index = 0; index < n + 1; index += 1) {
      w[index] -= learningRate * (grad[index] / count);
    }
  }

  return { trained: true, count, minCount, mean, std, w };
}

function predictLinearMl(features: ChartsMlFeatures, model: ReturnType<typeof trainMlModel>) {
  if (!model.trained) return null;
  const vector = featureVector(features).map((value, index) => (value - model.mean[index]!) / model.std[index]!);
  let z = model.w[0];
  for (let index = 0; index < vector.length; index += 1) z += model.w[index + 1] * vector[index];
  return 1 / (1 + Math.exp(-z));
}

function getMlDatasetQuality(labeledSamples: number) {
  if (labeledSamples < 10) {
    return {
      level: 'low' as const,
      text: 'Недостаточно данных',
      hint: `Размечено только ${labeledSamples} выгрузок. Риск пока нужно воспринимать как предварительный сигнал.`,
    };
  }
  if (labeledSamples <= 25) {
    return {
      level: 'medium' as const,
      text: 'Ограниченная надёжность',
      hint: `Размечено ${labeledSamples} выгрузок. Модель уже полезна, но чувствительна к шуму и выбросам.`,
    };
  }
  return {
    level: 'high' as const,
    text: 'Надёжная выборка',
    hint: `Размечено ${labeledSamples} выгрузок. Модель можно использовать как уверенный дополнительный сигнал.`,
  };
}

function buildModelAgreement(linearProbability: number | null, catboostProbability: number | null) {
  if (linearProbability == null || catboostProbability == null) {
    return {
      value: null,
      text: 'Согласованность недоступна',
    };
  }
  const deltaPct = Math.abs(catboostProbability - linearProbability) * 100;
  const rounded = round(deltaPct, 1);
  if (rounded <= 8) {
    return { value: rounded, text: `Модели согласованы (${rounded} п.п.)` };
  }
  if (rounded <= 18) {
    return { value: rounded, text: `Модели расходятся умеренно (${rounded} п.п.)` };
  }
  return { value: rounded, text: `Модели расходятся заметно (${rounded} п.п.)` };
}

function buildFeatureDrivers(features: ChartsMlFeatures | null, model: ReturnType<typeof trainMlModel>) {
  if (!features || !model.trained) return [] as ChartsMlPrediction['featureDrivers'];
  return FEATURE_KEYS
    .map((key, index) => {
      const value = Number(features[key] || 0);
      const normalized = (value - model.mean[index]!) / model.std[index]!;
      const contribution = normalized * model.w[index + 1]!;
      return {
        key,
        label: FEATURE_LABELS[key],
        contribution: round(contribution, 3),
        value: round(value, 2),
      };
    })
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 6);
}

export async function refreshChartsMlStateForReport(
  report: ChartsReport,
  cfg: ChartsMlDatasetIoConfig,
  compareMode: 'prev' | 'mean' = 'mean'
) {
  const datasetState = await ensureChartsMlDatasetLoaded(cfg).catch(error => ({
    dataset: readChartsMlDataset(),
    remote: false,
    error: (error as Error)?.message || String(error),
  }));
  const dataset = datasetState.dataset;
  const linearModel = trainMlModel(dataset);
  const linearProbability = report.ml.features ? predictLinearMl(report.ml.features, linearModel) : null;
  const catboostProbability = report.ml.features ? await predictCatboost(report.ml.features).catch(() => null) : null;
  const activeProbability = catboostProbability != null ? catboostProbability : linearProbability;
  const helperHealth = await checkChartsMlHelperHealth(String(cfg.mlHelperBase || '').trim());
  const labeledSamples = dataset.filter(item => item.label === 'ok' || item.label === 'fail').length;
  const datasetQuality = getMlDatasetQuality(labeledSamples);
  const modelAgreement = buildModelAgreement(linearProbability, catboostProbability);
  const featureDrivers = buildFeatureDrivers(report.ml.features, linearModel);
  const next: ChartsReport = {
    ...report,
    ml: {
      ...report.ml,
      dataset,
      helperHealth,
      prediction: {
        ...report.ml.prediction,
        engine: catboostProbability != null ? 'catboost' : linearProbability != null ? 'linear' : 'none',
        activeProbability,
        linearProbability,
        catboostProbability,
        labeledSamples,
        trained: !!linearModel.trained,
        reason: linearModel.trained ? '' : linearModel.reason,
        datasetQuality: datasetQuality.level,
        datasetQualityText: datasetQuality.text,
        datasetQualityHint: datasetQuality.hint,
        modelAgreementPct: modelAgreement.value,
        agreementText: modelAgreement.text,
        featureDrivers,
      },
    },
  };
  const summaryState = rebuildChartsSummaryState(next, compareMode);
  return {
    ...next,
    aiContext: summaryState.aiContext,
    ml: {
      ...next.ml,
      summary: summaryState.mlSummary,
    },
  } as ChartsReport;
}

function normalizeChartsMlHelperBase(value: unknown) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readStoredCatboostVersion() {
  if (typeof window === 'undefined') return null;
  return normalizeModelVersion(window.localStorage.getItem(CATBOOST_TRAINED_AT_STORAGE_KEY));
}

function persistCatboostVersion(version: string | null) {
  if (typeof window === 'undefined' || !version) return;
  window.localStorage.setItem(CATBOOST_TRAINED_AT_STORAGE_KEY, version);
}

function normalizeModelVersion(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function buildVersionedAssetUrl(path: string, version: string | null) {
  const base = resolveLegacyAsset(path);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}v=${encodeURIComponent(version || 'static')}`;
}

function resetCatboostSession(version?: string | null) {
  catboostSessionPromise = null;
  if (version !== undefined) {
    catboostSessionVersion = normalizeModelVersion(version);
  }
}

function updateCatboostSessionVersion(version: unknown) {
  const normalized = normalizeModelVersion(version);
  if (!normalized) return false;
  if (normalized === catboostSessionVersion) return false;
  resetCatboostSession(normalized);
  catboostManifestVersionPromise = Promise.resolve(normalized);
  persistCatboostVersion(normalized);
  return true;
}

function extractTrainedAtFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = normalizeModelVersion((payload as { trainedAt?: unknown; version?: unknown }).trainedAt)
    || normalizeModelVersion((payload as { trainedAt?: unknown; version?: unknown }).version);
  if (direct) return direct;
  const nestedMeta = (payload as { meta?: { trainedAt?: unknown; version?: unknown } }).meta;
  return normalizeModelVersion(nestedMeta?.trainedAt) || normalizeModelVersion(nestedMeta?.version);
}

async function readCatboostManifestVersion() {
  if (catboostManifestVersionPromise) return catboostManifestVersionPromise;
  catboostManifestVersionPromise = (async () => {
    const candidates = ['catboost_release_risk.manifest.json', 'catboost_release_risk.meta.json'];
    for (const filename of candidates) {
      try {
        const response = await fetch(buildVersionedAssetUrl(filename, String(Date.now())), { cache: 'no-store' });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const trainedAt = extractTrainedAtFromPayload(payload);
        if (trainedAt) return trainedAt;
      } catch {
        continue;
      }
    }
    return null;
  })();
  return catboostManifestVersionPromise;
}

async function ensureCatboostSessionVersion() {
  const storedVersion = readStoredCatboostVersion();
  if (storedVersion) {
    updateCatboostSessionVersion(storedVersion);
  }
  const manifestVersion = await readCatboostManifestVersion();
  if (manifestVersion) {
    updateCatboostSessionVersion(manifestVersion);
  }
  return catboostSessionVersion;
}

function getChartsMlHelperBaseCandidates(value: unknown) {
  const bases = new Set<string>();
  const input = normalizeChartsMlHelperBase(value);
  if (input) bases.add(input);
  bases.add(DEFAULT_CHARTS_ML_HELPER_BASE);
  bases.add('http://localhost:8788');
  bases.add('http://127.0.0.1:8789');
  bases.add('http://localhost:8789');
  return Array.from(bases).filter(Boolean);
}

async function fetchHelperHealth(base: string, path: string) {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string })?.error || `Helper HTTP ${response.status}`);
  }
  if (path === '/api/ml/health' && payload && typeof payload === 'object' && 'ok' in payload && !(payload as { ok?: boolean }).ok) {
    throw new Error((payload as { error?: string })?.error || 'Helper health returned not ok');
  }
  if (path === '/health') {
    const looksLikeMlHelper = Boolean(
      payload
      && typeof payload === 'object'
      && (
        (payload as { service?: unknown }).service === 'wb-ml-retrain-helper'
        || typeof (payload as { trainScript?: unknown }).trainScript === 'string'
        || typeof (payload as { bundleExists?: unknown }).bundleExists === 'boolean'
        || (payload as { meta?: { modelType?: unknown } }).meta?.modelType
        || (payload as { commandHints?: unknown }).commandHints
      )
    );
    if (!looksLikeMlHelper) {
      throw new Error('Сервис отвечает на /health, но это не ML-хелпер');
    }
  }
  return payload;
}

function extractProbability(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length >= 2 && Number.isFinite(Number(value[1]))) return Number(value[1]);
    for (const nested of value) {
      const parsed = extractProbability(nested);
      if (parsed != null) return parsed;
    }
  }
  if (value && typeof value === 'object') {
    const directData = (value as { data?: ArrayLike<number> }).data;
    if (directData && directData.length >= 2) {
      const parsed = Number(directData[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

async function getOrtModule() {
  if (!ortModulePromise) {
    ortModulePromise = import('onnxruntime-web').catch(() => null);
  }
  return ortModulePromise;
}

function resolveLegacyAsset(path: string) {
  if (typeof window === 'undefined') return `/legacy/${path}`;
  return new URL(`legacy/${path}`, new URL('.', window.location.href)).toString();
}

async function getCatboostSession() {
  const storedVersion = readStoredCatboostVersion();
  if (storedVersion && storedVersion !== catboostSessionVersion) {
    resetCatboostSession(storedVersion);
  }
  if (catboostSessionPromise) return catboostSessionPromise;
  catboostSessionPromise = (async () => {
    const ort = await getOrtModule();
    if (!ort) return null;
    const version = await ensureCatboostSessionVersion();
    if (ort.env?.wasm) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    }
    try {
      const response = await fetch(buildVersionedAssetUrl('catboost_release_risk.onnx', version), { cache: 'no-store' });
      if (!response.ok) return null;
      const binary = new Uint8Array(await response.arrayBuffer());
      return await ort.InferenceSession.create(binary, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    } catch {
      return null;
    }
  })();
  return catboostSessionPromise;
}

async function predictCatboost(features: ChartsMlFeatures) {
  const ort = await getOrtModule();
  const session = await getCatboostSession();
  if (!ort || !session) return null;
  try {
    const inputName = session.inputNames?.[0] || 'features';
    const outputName = session.outputNames?.find(name => /prob/i.test(String(name))) || session.outputNames?.[1] || session.outputNames?.[0] || 'probability_tensor';
    const tensor = new ort.Tensor('float32', Float32Array.from(featureVector(features)), [1, FEATURE_KEYS.length]);
    const outputs = await session.run({ [inputName]: tensor });
    const probability = extractProbability(outputs?.[outputName]);
    return probability == null ? null : clamp(Number(probability), 0, 1);
  } catch {
    return null;
  }
}

export async function checkChartsMlHelperHealth(baseUrl: string) {
  const candidates = getChartsMlHelperBaseCandidates(baseUrl);
  const errors: string[] = [];
  for (const base of candidates) {
    const paths = ['/api/ml/health', '/health'];
    for (const path of paths) {
      try {
        const payload = await fetchHelperHealth(base, path);
        const trainedAt = extractTrainedAtFromPayload(payload);
        if (trainedAt) {
          updateCatboostSessionVersion(trainedAt);
        }
        return {
          online: true,
          busy: !!(payload as { busy?: boolean })?.busy,
          error: '',
          checkedAt: Date.now(),
          base,
          endpoint: path,
          trainedAt: trainedAt || undefined,
          commandHints: (payload as { commandHints?: Record<string, string> })?.commandHints || undefined,
        } satisfies ChartsMlHelperHealth;
      } catch (error) {
        errors.push(`${base}${path}: ${(error as Error)?.message || String(error)}`);
      }
    }
  }

  return {
    online: false,
    busy: false,
    error: errors[0] || 'ML-хелпер недоступен',
    checkedAt: Date.now(),
  } satisfies ChartsMlHelperHealth;
}

export async function retrainChartsMlViaHelper(baseUrl: string) {
  const candidates = getChartsMlHelperBaseCandidates(baseUrl);
  let lastError: Error | null = null;
  for (const base of candidates) {
    for (const path of ['/api/ml/retrain', '/retrain']) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'retrain' }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error((payload as { error?: string } | null)?.error || `Helper HTTP ${response.status}`);
        }
        if (payload && typeof payload === 'object' && 'ok' in payload && !(payload as { ok?: boolean }).ok) {
          throw new Error((payload as { error?: string }).error || 'ML-хелпер вернул неуспешный ответ');
        }
        catboostManifestVersionPromise = null;
        updateCatboostSessionVersion(extractTrainedAtFromPayload(payload));
        resetCatboostSession(catboostSessionVersion);
        return payload || { ok: true };
      } catch (error) {
        lastError = error as Error;
      }
    }
  }
  throw lastError || new Error('Не задан адрес ML-хелпера');
}

function round(value: number | null | undefined, digits = 2) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(digits)) : 0;
}

function formatSignedValue(value: number | null | undefined, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(digits)}`;
}

function formatSignedPercent(value: number | null | undefined, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(digits)}%`;
}

function metricToneFromSnapshot(snapshot: ChartsAiMetricSnapshot): ChartsMlSummaryTone {
  if (snapshot.delta == null || !Number.isFinite(snapshot.delta) || snapshot.delta === 0) return 'neutral';
  if (snapshot.better === 'up') return snapshot.delta > 0 ? 'ok' : 'bad';
  if (snapshot.better === 'down') return snapshot.delta < 0 ? 'ok' : 'bad';
  return 'neutral';
}

function metricSeverity(snapshot: ChartsAiMetricSnapshot) {
  const pct = Math.abs(Number(snapshot.deltaPct || 0));
  const delta = Math.abs(Number(snapshot.delta || 0));
  return pct * 10 + delta;
}

function formatMetricDelta(snapshot: ChartsAiMetricSnapshot) {
  if (snapshot.delta == null || !Number.isFinite(snapshot.delta)) return 'без базы для сравнения';
  const direction = snapshot.delta > 0 ? 'выше базы' : snapshot.delta < 0 ? 'ниже базы' : 'на уровне базы';
  const absDelta = Math.abs(snapshot.delta);
  if (snapshot.deltaPct != null && Number.isFinite(snapshot.deltaPct)) {
    return direction === 'на уровне базы'
      ? direction
      : `${direction} на ${absDelta.toFixed(1)} · ${Math.abs(snapshot.deltaPct).toFixed(1)}%`;
  }
  return direction === 'на уровне базы' ? direction : `${direction} на ${absDelta.toFixed(1)}`;
}

function formatMetricSummaryLine(snapshot: ChartsAiMetricSnapshot, compareText: string) {
  const deltaText = formatMetricDelta(snapshot);
  return `${snapshot.label}: сейчас ${snapshot.current}, база ${snapshot.base} (${compareText.toLowerCase()}); ${deltaText}. ${snapshot.note}`;
}

function getMetricByLabel(list: ChartsAiMetricSnapshot[], label: string) {
  return list.find(item => item.label === label) || null;
}

function pushUniqueLine(list: string[], text: string) {
  const line = String(text || '').trim();
  if (!line || list.includes(line)) return;
  list.push(line);
}

function formatStreamList(items: Array<{ stream: string; delta: number }>, limit = 3) {
  return items.slice(0, limit).map(item => `${item.stream} (${item.delta > 0 ? '+' : ''}${round(item.delta, 0)})`).join(', ');
}

function summarizeSectionTone(positiveCount: number, negativeCount: number): ChartsMlSummaryTone {
  if (negativeCount >= positiveCount + 2 && negativeCount > 0) return 'bad';
  if (negativeCount > positiveCount && negativeCount > 0) return 'warn';
  if (positiveCount > negativeCount && positiveCount > 0) return 'ok';
  if (positiveCount || negativeCount) return 'warn';
  return 'neutral';
}

function buildTypeDeltaRows(rows: ChartsTaskTypeRow[], platformLabel: string) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const previous = rows[rows.length - 2];
  const current = rows[rows.length - 1];
  const keys = new Set<string>([
    ...Object.keys(previous?.counts || {}),
    ...Object.keys(current?.counts || {}),
  ]);
  return Array.from(keys)
    .map(type => {
      const before = Number(previous?.counts?.[type] || 0);
      const after = Number(current?.counts?.[type] || 0);
      const delta = after - before;
      return { platform: platformLabel, type, before, after, delta };
    })
    .filter(item => item.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

function buildChpTypeDeltaRows(rows: ChartsChpTypeRow[], label: string) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const previous = rows[rows.length - 2];
  const current = rows[rows.length - 1];
  return (['product', 'vlet', 'bug', 'crash'] as const)
    .map(type => {
      const before = Number(previous?.[type] || 0);
      const after = Number(current?.[type] || 0);
      const delta = after - before;
      return { platform: label, type: formatChpTypeLabel(String(type)), before, after, delta };
    })
    .filter(item => item.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

function formatTypeDeltaLine(item: { platform: string; type: string; before: number; after: number; delta: number }) {
  const direction = item.delta > 0 ? 'стало больше' : 'стало меньше';
  return `${item.platform}: ${item.type} — было ${item.before}, стало ${item.after}; ${direction} на ${Math.abs(item.delta)}.`;
}

export function buildChartsMlSummary(report: ChartsReport, compareMode: 'prev' | 'mean' = 'mean'): ChartsMlSummary {
  const compareText = compareMode === 'prev' ? 'к предыдущему релизу' : 'к средней истории';
  const context = report.aiContext;
  const prediction = report.ml.prediction;
  const helperHealth = report.ml.helperHealth;
  const allSnapshots = [
    ...context.keyMetrics.regress,
    ...context.keyMetrics.release,
    ...context.keyMetrics.timings,
  ];
  const negativeMetrics = allSnapshots
    .filter(item => metricToneFromSnapshot(item) === 'bad')
    .sort((left, right) => metricSeverity(right) - metricSeverity(left));
  const positiveMetrics = allSnapshots
    .filter(item => metricToneFromSnapshot(item) === 'ok')
    .sort((left, right) => metricSeverity(right) - metricSeverity(left));

  let statusText = 'Нет обученной модели';
  let statusTone: ChartsMlSummaryTone = 'warn';
  if (prediction.activeProbability != null) {
    if (prediction.activeProbability >= 0.7) {
      statusText = `Регресс (${round(prediction.activeProbability * 100, 1)}%)`;
      statusTone = 'bad';
    } else if (prediction.activeProbability >= 0.4) {
      statusText = `Внимание (${round(prediction.activeProbability * 100, 1)}%)`;
      statusTone = 'warn';
    } else {
      statusText = `OK (${round(prediction.activeProbability * 100, 1)}%)`;
      statusTone = 'ok';
    }
  } else if (prediction.trained) {
    statusText = 'Резервная модель обучена';
    statusTone = 'neutral';
  } else if (prediction.labeledSamples > 0) {
    statusText = `Разметка ${prediction.labeledSamples}/5`;
    statusTone = 'warn';
  }

  const engineLabel = prediction.engine === 'catboost'
    ? 'CatBoost'
    : prediction.engine === 'linear'
      ? 'Линейная модель'
      : 'Нет модели';
  const helperText = helperHealth.online
    ? `ML-хелпер онлайн${helperHealth.base ? ` · ${helperHealth.base}` : ''}`
    : `ML-хелпер офлайн${helperHealth.base ? ` · ${helperHealth.base}` : ''}`;
  const helperTone: ChartsMlSummaryTone = helperHealth.online ? (helperHealth.busy ? 'warn' : 'ok') : 'warn';
  const trainingText = prediction.engine === 'catboost'
    ? `CatBoost активен. Размечено выгрузок: ${prediction.labeledSamples}.`
    : prediction.engine === 'linear'
      ? `Работаем на резервной линейной модели. Размечено выгрузок: ${prediction.labeledSamples}.`
      : prediction.reason || 'Модель ещё не готова.';

  const overview: string[] = [];
  pushUniqueLine(overview, `Диапазон ${formatReleaseShort(context.releaseWindow.from)} → ${formatReleaseShort(context.releaseWindow.to)}, в расчёте ${context.releaseWindow.count} релизов; сравнение ${compareText}.`);
  if (report.anomalies.score > 0) {
    pushUniqueLine(overview, `Аномалии: релиз ${report.anomalies.release.count}, типы ${report.anomalies.type.count}, платформы ${report.anomalies.platform.count}.`);
  }
  if (Number(context.devDowntime.total.currentRaw || 0) > 0) {
    pushUniqueLine(
      overview,
      `DEV downtime в текущем релизе: iOS ${context.devDowntime.ios.current}, Android ${context.devDowntime.android.current}, суммарно ${context.devDowntime.total.current}.`
    );
  }

  const risks: string[] = [];
  negativeMetrics.slice(0, 4).forEach(item => pushUniqueLine(risks, formatMetricSummaryLine(item, compareText)));
  if (report.anomalies.release.list[0]) {
    const item = report.anomalies.release.list[0];
    const changeText = item.last >= item.prev ? 'стало выше базы' : 'стало ниже базы';
    pushUniqueLine(
      risks,
      `Аномалия релиза: ${item.label} — было ${formatSignedValue(item.prev, 1)} → стало ${formatSignedValue(item.last, 1)}; ${changeText} на ${Math.abs(item.deltaPct).toFixed(1)}%.`
    );
  }
  if (context.streams.hb && (context.streams.hb.added.length || context.streams.hb.removed.length)) {
    const changeParts = [
      context.streams.hb.added.length ? `добавились ${formatStreamList(context.streams.hb.added)}` : '',
      context.streams.hb.removed.length ? `просели ${formatStreamList(context.streams.hb.removed)}` : '',
    ].filter(Boolean);
    if (changeParts.length) {
      pushUniqueLine(risks, `HB стримы изменились: ${changeParts.join('; ')}.`);
    }
  }
  if (Number(context.devDowntime.total.currentRaw || 0) > 0) {
    pushUniqueLine(risks, `DEV downtime: iOS ${context.devDowntime.ios.current}, Android ${context.devDowntime.android.current}; дней с простоями ${context.devDowntime.currentDays.total}.`);
  }
  if (!risks.length) {
    pushUniqueLine(risks, 'Критичных отрицательных сигналов по текущим метрикам не найдено.');
  }

  const changes: string[] = [];
  positiveMetrics.slice(0, 4).forEach(item => pushUniqueLine(changes, formatMetricSummaryLine(item, compareText)));
  if (!changes.length) {
    pushUniqueLine(changes, 'Явных положительных отклонений относительно базы не найдено.');
  }

  const recommendations: string[] = [];
  if (prediction.activeProbability != null && prediction.activeProbability >= 0.7) {
    pushUniqueLine(recommendations, 'Перед следующим релизом проверь весь стек негативных дельт из ML summary и не ограничивайся только LLM-выводом.');
  }
  if (negativeMetrics.some(item => /Критичные проверки|Селективные проверки/i.test(item.label))) {
    pushUniqueLine(recommendations, 'Сверь полноту HB/Selective прогонов по стримам: просадка покрытия обычно требует ручной проверки состава тест-плана.');
  }
  if (negativeMetrics.some(item => /Среднее время|Lag|Cutoff|Store|Старт регресса/i.test(item.label))) {
    pushUniqueLine(recommendations, 'Разберите тайминги релиза: cutoff, старт регресса, store и лаг после cutoff. Это прямой сигнал на потерю запаса по времени.');
  }
  if (Number(context.devDowntime.total.currentRaw || 0) > 0) {
    pushUniqueLine(recommendations, 'Разберите DEV downtime по платформам: это отдельный сигнал по устойчивости среды, который может маскировать реальные проблемы таймингов релиза.');
  }
  if (negativeMetrics.some(item => /ЧП/i.test(item.label))) {
    pushUniqueLine(recommendations, 'Проверь релиз на рост ЧП и связанный состав задач: при ухудшении по ЧП стоит отдельно пройти блок release-метрик.');
  }
  if (!helperHealth.online) {
    pushUniqueLine(recommendations, `Подними ML-хелпер${helperHealth.base ? ` на ${helperHealth.base}` : ''}, чтобы переобучение после разметки снова работало из UI.`);
  }
  if (prediction.labeledSamples < 5) {
    pushUniqueLine(recommendations, `Разметь минимум ${5 - prediction.labeledSamples} исторических выгрузок, иначе резервная модель останется слишком слабой.`);
  }
  if (!recommendations.length) {
    pushUniqueLine(recommendations, 'Сохрани текущую выгрузку и размечай релизы после факта, чтобы CatBoost и резервная модель опирались на реальную историю.');
  }

  const manualChecks: string[] = [];
  if (report.anomalies.release.list.length) {
    pushUniqueLine(manualChecks, `Проверь аномалии релиза: ${report.anomalies.release.list.slice(0, 3).map(item => item.label).join(', ')}.`);
  }
  if (report.anomalies.type.list.length) {
    pushUniqueLine(manualChecks, `Проверь аномалии типов: ${report.anomalies.type.list.slice(0, 3).map(item => item.label).join(', ')}.`);
  }
  if (context.streams.selective && (context.streams.selective.added.length || context.streams.selective.removed.length)) {
    const parts = [
      context.streams.selective.added.length ? `рост ${formatStreamList(context.streams.selective.added)}` : '',
      context.streams.selective.removed.length ? `снижение ${formatStreamList(context.streams.selective.removed)}` : '',
    ].filter(Boolean);
    if (parts.length) pushUniqueLine(manualChecks, `Селективные стримы: ${parts.join('; ')}.`);
  }
  if (context.streams.uwu && (context.streams.uwu.added.length || context.streams.uwu.removed.length)) {
    const parts = [
      context.streams.uwu.added.length ? `рост ${formatStreamList(context.streams.uwu.added)}` : '',
      context.streams.uwu.removed.length ? `снижение ${formatStreamList(context.streams.uwu.removed)}` : '',
    ].filter(Boolean);
    if (parts.length) pushUniqueLine(manualChecks, `UwU по стримам: ${parts.join('; ')}.`);
  }
  if (Number(context.devDowntime.total.currentRaw || 0) > 0) {
    pushUniqueLine(manualChecks, `Сверь причины DEV downtime по iOS и Android и их привязку к релизу ${formatReleaseShort(context.releaseWindow.currentRelease)}.`);
  }
  if (!manualChecks.length) {
    pushUniqueLine(manualChecks, 'Ручных проверок сверх обычного baseline сейчас не требуется.');
  }

  const highlightCandidates = [
    getMetricByLabel(allSnapshots, 'Объем регресса'),
    getMetricByLabel(allSnapshots, 'АТ в регрессе'),
    getMetricByLabel(allSnapshots, 'Критичные проверки SWAT + Stream'),
    getMetricByLabel(allSnapshots, 'Среднее время прохождения'),
    getMetricByLabel(allSnapshots, 'ЧП всего'),
    negativeMetrics.find(item => /Lag|Cutoff|Store|Старт регресса/i.test(item.label)) || null,
  ].filter((item): item is ChartsAiMetricSnapshot => Boolean(item));
  const highlights = Array.from(new Map(highlightCandidates.map(item => [item.label, item])).values()).map(item => ({
    label: item.label,
    current: item.current,
    base: item.base,
    delta: formatMetricDelta(item),
    tone: metricToneFromSnapshot(item),
    note: item.note,
  }));

  const regressSnapshots = context.keyMetrics.regress;
  const regressNegative = regressSnapshots.filter(item => metricToneFromSnapshot(item) === 'bad').sort((left, right) => metricSeverity(right) - metricSeverity(left));
  const regressPositive = regressSnapshots.filter(item => metricToneFromSnapshot(item) === 'ok').sort((left, right) => metricSeverity(right) - metricSeverity(left));
  const releaseSnapshots = [...context.keyMetrics.release, ...context.keyMetrics.timings, context.devDowntime.ios, context.devDowntime.android, context.devDowntime.total];
  const releaseNegative = releaseSnapshots.filter(item => metricToneFromSnapshot(item) === 'bad').sort((left, right) => metricSeverity(right) - metricSeverity(left));
  const releasePositive = releaseSnapshots.filter(item => metricToneFromSnapshot(item) === 'ok').sort((left, right) => metricSeverity(right) - metricSeverity(left));
  const taskTypeDeltaRows = [
    ...buildTypeDeltaRows(report.taskTypes.iosRows, 'iOS'),
    ...buildTypeDeltaRows(report.taskTypes.androidRows, 'Android'),
  ];
  const chpTypeDeltaRows = [
    ...buildChpTypeDeltaRows(report.chpTypes.rows, 'ЧП'),
    ...buildChpTypeDeltaRows(report.chpTypes.iosRows, 'ЧП iOS'),
    ...buildChpTypeDeltaRows(report.chpTypes.androidRows, 'ЧП Android'),
  ];
  const chpTypeRisks = chpTypeDeltaRows
    .filter(item => item.delta > 0)
    .slice(0, 4)
    .map(formatTypeDeltaLine);
  const chpTypeImprovements = chpTypeDeltaRows
    .filter(item => item.delta < 0)
    .slice(0, 4)
    .map(formatTypeDeltaLine);
  const typeShiftLines = taskTypeDeltaRows.slice(0, 6).map(formatTypeDeltaLine);
  const streamRiskLines: string[] = [];
  const streamChangeLines: string[] = [];
  [
    { label: 'HB', summary: context.streams.hb },
    { label: 'Selective', summary: context.streams.selective },
    { label: 'UwU', summary: context.streams.uwu },
  ].forEach(item => {
    if (item.summary?.added?.length) {
      pushUniqueLine(streamRiskLines, `${item.label}: выросла нагрузка по стримам ${formatStreamList(item.summary.added)}.`);
    }
    if (item.summary?.removed?.length) {
      pushUniqueLine(streamChangeLines, `${item.label}: нагрузка снизилась по стримам ${formatStreamList(item.summary.removed)}.`);
    }
  });

  const overviewSection: ChartsMlSummarySection = {
    id: 'overview',
    title: 'Общая саммаризация',
    subtitle: 'Сводный ML-взгляд по регрессу, релизу, типам, стримам и аномалиям.',
    tone: statusTone,
    overview,
    risks,
    changes,
    recommendations,
    highlights,
  };

  const regressSection: ChartsMlSummarySection = {
    id: 'regress',
    title: 'Регресс',
    subtitle: 'Объём регресса, покрытие HB/Selective, АТ и скорость прохождения.',
    tone: summarizeSectionTone(regressPositive.length, regressNegative.length),
    overview: [
      `Объём регресса: ${getMetricByLabel(regressSnapshots, 'Объем регресса')?.current || '—'}, АТ в регрессе: ${getMetricByLabel(regressSnapshots, 'АТ в регрессе')?.current || '—'}.`,
      `Критичные проверки: ${getMetricByLabel(regressSnapshots, 'Критичные проверки SWAT + Stream')?.current || '—'}, селективные: ${getMetricByLabel(regressSnapshots, 'Селективные проверки')?.current || '—'}.`,
      `Среднее время прохождения: ${getMetricByLabel(regressSnapshots, 'Среднее время прохождения')?.current || '—'}, на кейс: ${getMetricByLabel(regressSnapshots, 'Среднее время на кейс')?.current || '—'}.`,
    ],
    risks: regressNegative.length
      ? regressNegative.slice(0, 4).map(item => formatMetricSummaryLine(item, compareText))
      : ['По регрессному контуру сильных негативных сигналов не обнаружено.'],
    changes: regressPositive.length
      ? regressPositive.slice(0, 4).map(item => formatMetricSummaryLine(item, compareText))
      : ['По регрессному контуру сильных позитивных отклонений не найдено.'],
    recommendations: [
      negativeMetrics.some(item => /Критичные проверки|Селективные проверки/i.test(item.label))
        ? 'Проверь полноту тест-планов и состав HB/Selective перед следующим прогоном.'
        : 'Сохраняй текущий уровень покрытия регресса и сравнивай его с базой перед стартом следующего релиза.',
      negativeMetrics.some(item => /Среднее время/i.test(item.label))
        ? 'Разберите скорость прохождения: рост времени обычно означает перекос по стримам или по составу прогона.'
        : 'Следите за временем прохождения, чтобы рост объёма не съел окно релиза.',
      ...streamRiskLines.slice(0, 2),
    ].filter(Boolean),
    highlights: highlights.filter(item => /Объем регресса|АТ в регрессе|Критичные проверки SWAT \+ Stream|Среднее время прохождения/i.test(item.label)),
  };

  const releaseSection: ChartsMlSummarySection = {
    id: 'release',
    title: 'Релиз',
    subtitle: 'ЧП, cutoff, старт регресса, Store и DEV downtime.',
    tone: summarizeSectionTone(releasePositive.length, releaseNegative.length),
    overview: [
      `ЧП всего: ${getMetricByLabel(context.keyMetrics.release, 'ЧП всего')?.current || '—'}, iOS: ${getMetricByLabel(context.keyMetrics.release, 'ЧП iOS')?.current || '—'}, Android: ${getMetricByLabel(context.keyMetrics.release, 'ЧП Android')?.current || '—'}.`,
      `Cutoff iOS / Android: ${getMetricByLabel(context.keyMetrics.timings, 'Cutoff iOS')?.current || '—'} / ${getMetricByLabel(context.keyMetrics.timings, 'Cutoff Android')?.current || '—'}.`,
      `Store iOS / Android: ${getMetricByLabel(context.keyMetrics.timings, 'Store iOS')?.current || '—'} / ${getMetricByLabel(context.keyMetrics.timings, 'Store Android')?.current || '—'}. DEV downtime суммарно: ${context.devDowntime.total.current}.`,
    ],
    risks: releaseNegative.length
      ? releaseNegative.slice(0, 5).map(item => formatMetricSummaryLine(item, compareText))
      : ['По релизному контуру нет выраженных негативных отклонений.'],
    changes: releasePositive.length
      ? releasePositive.slice(0, 5).map(item => formatMetricSummaryLine(item, compareText))
      : ['По релизному контуру нет заметных улучшений относительно базы.'],
    recommendations: [
      context.devDowntime.total.currentRaw ? 'Сверь простои DEV с таймингами cutoff, старта регресса и отправки в Store.' : 'Сохраняй контроль по DEV downtime и таймингам релиза.',
      negativeMetrics.some(item => /ЧП/i.test(item.label)) ? 'Проверь состав ЧП и типы задач по платформам: рост багов и crash нужно разбирать отдельно.' : 'Следи за ЧП по платформам и их типам на каждом релизе.',
      negativeMetrics.some(item => /Cutoff|Store|Lag|Старт регресса/i.test(item.label)) ? 'Разберите cutoff, старт регресса и Store как единую цепочку, а не по отдельности.' : 'Сохраняй стабильный тайминг релиза между cutoff, прогоном и публикацией.',
    ].filter(Boolean),
    highlights: highlights.filter(item => /ЧП всего|Cutoff|Store|Lag|Старт регресса/i.test(item.label)),
  };

  const typesSection: ChartsMlSummarySection = {
    id: 'types',
    title: 'Типы и ЧП',
    subtitle: 'Состав задач по платформам и динамика типов ЧП.',
    tone: summarizeSectionTone(chpTypeImprovements.length, chpTypeRisks.length),
    overview: [
      `Топ типов iOS: ${(context.taskTypes.ios?.topTypes || []).slice(0, 3).map(item => `${item.name} (${item.count})`).join(', ') || 'нет данных'}.`,
      `Топ типов Android: ${(context.taskTypes.android?.topTypes || []).slice(0, 3).map(item => `${item.name} (${item.count})`).join(', ') || 'нет данных'}.`,
      `Типы ЧП: ${(context.taskTypes.chpAll?.topTypes || []).slice(0, 4).map(item => `${item.name} (${item.count})`).join(', ') || 'нет данных'}.`,
    ],
    risks: chpTypeRisks.length ? chpTypeRisks : ['Ростов по типам ЧП, которые выделяются на фоне базы, не найдено.'],
    changes: [...typeShiftLines.slice(0, 4), ...chpTypeImprovements.slice(0, 2)].length
      ? [...typeShiftLines.slice(0, 4), ...chpTypeImprovements.slice(0, 2)]
      : ['Сильных сдвигов по структуре задач и ЧП не найдено.'],
    recommendations: [
      taskTypeDeltaRows.length ? 'Проверь, не сместился ли баланс типов задач между iOS и Android относительно прошлого релиза.' : 'Структура задач стабильна, следи за ней от релиза к релизу.',
      chpTypeRisks.length ? 'Если растут bug/crash/product по ЧП, сверяй это с релизными изменениями и проблемными платформами.' : 'Поддерживай текущий баланс типов ЧП без накопления bug/crash в одном контуре.',
    ],
    highlights: highlights.filter(item => /ЧП всего/i.test(item.label)),
  };

  const streamsSection: ChartsMlSummarySection = {
    id: 'streams',
    title: 'Стримы',
    subtitle: 'Лидеры изменений по нагрузке и расклад по внутренним и внешним стримам.',
    tone: summarizeSectionTone(streamChangeLines.length, streamRiskLines.length),
    overview: [
      context.streams.hb?.from && context.streams.hb?.to
        ? `Сравнение стримов: ${formatReleaseShort(context.streams.hb.from)} → ${formatReleaseShort(context.streams.hb.to)}.`
        : 'Для стримового анализа нужен минимум второй релиз в диапазоне.',
      `Внутренние стримы: ${context.streams.internalStreams.length}, внешние: ${context.streams.externalStreams.length}.`,
      context.streams.internalStreams.length
        ? `Ключевые внутренние: ${context.streams.internalStreams.slice(0, 5).join(', ')}.`
        : 'Внутренние стримы не определились.',
    ],
    risks: streamRiskLines.length ? streamRiskLines : ['Резкого роста нагрузки по стримам не найдено.'],
    changes: streamChangeLines.length ? streamChangeLines : ['Резких разгрузок по стримам не найдено.'],
    recommendations: [
      context.streams.hb?.added.length ? `Проверь стримы с ростом HB: ${formatStreamList(context.streams.hb.added)}.` : 'Следи за стримами с критичными проверками от релиза к релизу.',
      context.streams.selective?.added.length ? `Проверь selective-нагрузку по стримам: ${formatStreamList(context.streams.selective.added)}.` : 'Сверяй selective-нагрузку по стримам с их текущим составом задач.',
      context.streams.uwu?.added.length ? `Проверь рост UwU по стримам: ${formatStreamList(context.streams.uwu.added)}.` : 'Следи за UwU-нагрузкой и не допускай перекоса в одном стриме.',
    ],
    highlights: [],
  };

  const sections = {
    overview: overviewSection,
    regress: regressSection,
    release: releaseSection,
    types: typesSection,
    streams: streamsSection,
  } satisfies Record<ChartsMlSummarySectionId, ChartsMlSummarySection>;

  return {
    statusText,
    statusTone,
    engineLabel,
    helperText,
    helperTone,
    trainingText,
    compareText,
    overview,
    risks,
    changes,
    recommendations,
    manualChecks,
    highlights,
    sections,
  };
}

function enrichChartsAiContext(context: ChartsAiContext, report: ChartsReport, summary: ChartsMlSummary): ChartsAiContext {
  const topStreamDeltaRows = report.streamDeltaRows
    .slice()
    .sort((left, right) => {
      const leftScore = Math.max(Math.abs(left.manualDelta), Math.abs(left.autoDelta), Math.abs(left.uwuManualDelta), Math.abs(left.uwuAutoDelta));
      const rightScore = Math.max(Math.abs(right.manualDelta), Math.abs(right.autoDelta), Math.abs(right.uwuManualDelta), Math.abs(right.uwuAutoDelta));
      return rightScore - leftScore;
    })
    .slice(0, 10);
  return {
    ...context,
    mlSummary: {
      statusText: summary.statusText,
      statusTone: summary.statusTone,
      engineLabel: summary.engineLabel,
      helperText: summary.helperText,
      trainingText: summary.trainingText,
      compareText: summary.compareText,
      overview: summary.overview.slice(0, 6),
      risks: summary.risks.slice(0, 6),
      changes: summary.changes.slice(0, 6),
      recommendations: summary.recommendations.slice(0, 6),
      manualChecks: summary.manualChecks.slice(0, 6),
      sections: Object.values(summary.sections).map(section => ({
        id: section.id,
        title: section.title,
        subtitle: section.subtitle,
        tone: section.tone,
        overview: section.overview.slice(0, 5),
        risks: section.risks.slice(0, 5),
        changes: section.changes.slice(0, 5),
        recommendations: section.recommendations.slice(0, 5),
      })),
    },
    displayedTables: {
      streamDeltaRows: topStreamDeltaRows.map(row => ({
        release: row.release,
        stream: row.stream,
        manualDelta: row.manualDelta,
        autoDelta: row.autoDelta,
        uwuManualDelta: row.uwuManualDelta,
        uwuAutoDelta: row.uwuAutoDelta,
      })),
      chpTypesHistory: {
        all: report.chpTypes.rows.slice(-6).map(row => ({ release: row.release, product: row.product, vlet: row.vlet, bug: row.bug, crash: row.crash })),
        ios: report.chpTypes.iosRows.slice(-6).map(row => ({ release: row.release, product: row.product, vlet: row.vlet, bug: row.bug, crash: row.crash })),
        android: report.chpTypes.androidRows.slice(-6).map(row => ({ release: row.release, product: row.product, vlet: row.vlet, bug: row.bug, crash: row.crash })),
      },
      devDowntimeByRelease: {
        ios: report.devDowntime.iosByRelease.slice(-6).map(row => ({ release: row.release, totalMinutes: row.totalMinutes, days: row.days })),
        android: report.devDowntime.androidByRelease.slice(-6).map(row => ({ release: row.release, totalMinutes: row.totalMinutes, days: row.days })),
      },
    },
  };
}

export function rebuildChartsSummaryState(report: ChartsReport, compareMode: 'prev' | 'mean' = 'mean') {
  const aiContext = buildChartsAiSummaryContext(report, compareMode);
  const preparedReport = {
    ...report,
    aiContext,
  } as ChartsReport;
  const mlSummary = buildChartsMlSummary(preparedReport, compareMode);
  return {
    aiContext: enrichChartsAiContext(aiContext, preparedReport, mlSummary),
    mlSummary,
  };
}

function formatReleaseShort(value: string) {
  const raw = String(value || '').trim();
  const parts = raw.split('.');
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1];
  const trimmed = last.replace(/0+$/, '');
  parts[parts.length - 1] = trimmed || '0';
  return parts.join('.');
}

function compareReleaseAsc(left: string, right: string) {
  const a = String(left || '').split('.').map(value => parseInt(value, 10) || 0);
  const b = String(right || '').split('.').map(value => parseInt(value, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function baselineStats(series: number[], mode: 'prev' | 'mean') {
  const values = (Array.isArray(series) ? series : []).map(value => Number(value)).filter(Number.isFinite);
  if (values.length < 2) {
    return { last: values.length ? values[values.length - 1] : null, base: null };
  }
  const last = values[values.length - 1];
  if (mode === 'prev') return { last, base: values[values.length - 2] };
  const history = values.slice(0, -1);
  return {
    last,
    base: history.reduce((sum, value) => sum + value, 0) / history.length,
  };
}

function formatClockMinutes(value: number | null | undefined) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatAiMetricValue(kind: 'count' | 'minutes' | 'clock' | 'percent', value: number | null | undefined, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (kind === 'clock') return formatClockMinutes(num);
  if (kind === 'minutes') return `${num.toFixed(digits)} мин`;
  if (kind === 'percent') return `${num.toFixed(digits)}%`;
  return Math.round(num).toLocaleString('ru-RU');
}

function buildAiMetricSnapshot(label: string, series: number[], kind: 'count' | 'minutes' | 'clock' | 'percent', compareMode: 'prev' | 'mean', digits = 0, better = '', note = ''): ChartsAiMetricSnapshot {
  const values = (Array.isArray(series) ? series : []).map(value => Number(value)).filter(Number.isFinite);
  if (!values.length) {
    return { label, current: '—', currentRaw: null, base: '—', baseRaw: null, delta: null, deltaPct: null, better, note };
  }
  const stat = baselineStats(values, compareMode);
  const delta = stat.base == null ? null : stat.last! - stat.base;
  const deltaPct = stat.base == null || stat.base === 0 ? (stat.last ? 100 : 0) : ((stat.last! - stat.base) / stat.base) * 100;
  return {
    label,
    current: formatAiMetricValue(kind, stat.last, digits),
    currentRaw: stat.last == null ? null : round(stat.last, digits || 2),
    base: stat.base == null ? '—' : formatAiMetricValue(kind, stat.base, digits),
    baseRaw: stat.base == null ? null : round(stat.base, digits || 2),
    delta: delta == null ? null : round(delta, digits || 2),
    deltaPct: delta == null ? null : round(deltaPct, 2),
    better,
    note,
  };
}

function buildAiTopCounts(counts: Record<string, number>, limit = 8) {
  return Object.entries(counts || {})
    .map(([name, count]) => ({ name, count: Number(count || 0) }))
    .filter(item => item.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function buildAiTypeSnapshot(rows: ChartsTaskTypeRow[] | ChartsChpTypeRow[], platform: string, release: string, counts: Record<string, number>): ChartsAiTypeSnapshot | null {
  if (!release) return null;
  return { platform, release, topTypes: buildAiTopCounts(counts, 8) };
}

function buildAiStreamDeltaSnapshot(summary: ChartsStreamInsightSummary | null): ChartsAiStreamDeltaSnapshot | null {
  if (!summary) return null;
  return {
    from: summary.from,
    to: summary.to,
    unit: summary.unitLabel,
    added: summary.added.map(item => ({
      stream: item.stream,
      delta: item.delta,
      before: item.before,
      after: item.after,
      external: item.external,
    })),
    removed: summary.removed.map(item => ({
      stream: item.stream,
      delta: item.delta,
      before: item.before,
      after: item.after,
      external: item.external,
    })),
  };
}

function compressChartsAiContextForPrompt(context: ChartsAiContext) {
  const topAnomalies = {
    release: {
      count: context.anomalies.release.count,
      list: context.anomalies.release.list.slice(0, 4),
    },
    type: {
      count: context.anomalies.type.count,
      list: context.anomalies.type.list.slice(0, 4),
    },
    platform: {
      count: context.anomalies.platform.count,
      list: context.anomalies.platform.list.slice(0, 4),
    },
    score: context.anomalies.score,
  };

  return {
    releaseWindow: context.releaseWindow,
    mlRisk: context.mlRisk,
    keyMetrics: context.keyMetrics,
    anomalies: topAnomalies,
    streams: {
      hb: context.streams.hb,
      selective: context.streams.selective,
      uwu: context.streams.uwu,
      internalStreams: context.streams.internalStreams.slice(0, 10),
      externalStreams: context.streams.externalStreams.slice(0, 10),
    },
    taskTypes: context.taskTypes,
    recentReleases: {
      testCases: context.recentReleases.testCases.slice(-5),
      coverage: context.recentReleases.coverage.slice(-5),
      selective: context.recentReleases.selective.slice(-5),
      avgMinutes: context.recentReleases.avgMinutes.slice(-5),
      chp: context.recentReleases.chp.slice(-5),
      timings: context.recentReleases.timings.slice(-5),
    },
    devDowntime: context.devDowntime,
    mlSummary: context.mlSummary,
    displayedTables: {
      streamDeltaRows: (context.displayedTables?.streamDeltaRows || []).slice(0, 10),
      chpTypesHistory: {
        all: context.displayedTables?.chpTypesHistory.all.slice(-5) || [],
        ios: context.displayedTables?.chpTypesHistory.ios.slice(-5) || [],
        android: context.displayedTables?.chpTypesHistory.android.slice(-5) || [],
      },
      devDowntimeByRelease: {
        ios: context.displayedTables?.devDowntimeByRelease.ios.slice(-5) || [],
        android: context.displayedTables?.devDowntimeByRelease.android.slice(-5) || [],
      },
    },
  };
}

export function buildChartsAiSummaryContext(report: ChartsReport, compareMode: 'prev' | 'mean' = 'mean'): ChartsAiContext {
  const releases = report.releases.slice();
  const currentRelease = releases[releases.length - 1] || '';
  const previousRelease = releases.length > 1 ? releases[releases.length - 2] : '';
  const baseReleases = compareMode === 'prev'
    ? (previousRelease ? [previousRelease] : [])
    : releases.slice(0, -1);

  const tcSeries = buildSeriesFromRows(report.tcRows, row => row.total);
  const autoSeries = buildSeriesFromRows(report.tcRows, row => row.auto);
  const covSwatSeries = buildSeriesFromRows(report.coverageRows, row => row.swatCount);
  const covStreamSeries = buildSeriesFromRows(report.coverageRows, row => row.streamCount);
  const covSeries = buildSeriesFromRows(report.coverageRows, row => row.total);
  const selectiveSeries = buildSeriesFromRows(report.selectiveRows, row => row.total);
  const avgSeries = buildSeriesFromRows(report.avgRows, row => row.totalMs / 60000);
  const avgWeightedSeries = buildSeriesFromRows(report.avgRows, row => row.totalWeighted / 60000);
  const chpSeries = buildSeriesFromRows(report.chpRows, row => row.total);
  const chpIosSeries = buildSeriesFromRows(report.chpRows, row => row.ios);
  const chpAndroidSeries = buildSeriesFromRows(report.chpRows, row => row.android);
  const cutIosSeries = report.timings.map(row => row.iosCutMinutes).filter((value): value is number => Number.isFinite(value as number));
  const cutAndroidSeries = report.timings.map(row => row.androidCutMinutes).filter((value): value is number => Number.isFinite(value as number));
  const regIosSeries = report.timings.map(row => row.iosRegressionMinutes).filter((value): value is number => Number.isFinite(value as number));
  const regAndroidSeries = report.timings.map(row => row.androidRegressionMinutes).filter((value): value is number => Number.isFinite(value as number));
  const storeIosSeries = report.timings.map(row => row.iosStoreMinutes).filter((value): value is number => Number.isFinite(value as number));
  const storeAndroidSeries = report.timings.map(row => row.androidStoreMinutes).filter((value): value is number => Number.isFinite(value as number));
  const lagIosSeries = buildLagSeries(report.timings.map(row => row.iosStoreMinutes), report.timings.map(row => row.iosCutMinutes));
  const lagAndroidSeries = buildLagSeries(report.timings.map(row => row.androidStoreMinutes), report.timings.map(row => row.androidCutMinutes));
  const iosDowntimeSeries = buildSeriesFromRows(report.devDowntime.iosByRelease, row => row.totalMinutes);
  const androidDowntimeSeries = buildSeriesFromRows(report.devDowntime.androidByRelease, row => row.totalMinutes);
  const totalDowntimeSeries = iosDowntimeSeries.map((value, index) => value + (androidDowntimeSeries[index] || 0));
  const currentDowntimeIos = report.devDowntime.iosByRelease[report.devDowntime.iosByRelease.length - 1];
  const currentDowntimeAndroid = report.devDowntime.androidByRelease[report.devDowntime.androidByRelease.length - 1];
  const latestMetric = report.metrics[report.metrics.length - 1];

  const lastIosType = report.taskTypes.iosRows[report.taskTypes.iosRows.length - 1];
  const lastAndroidType = report.taskTypes.androidRows[report.taskTypes.androidRows.length - 1];
  const lastChpType = report.chpTypes.rows[report.chpTypes.rows.length - 1];
  const lastChpTypeIos = report.chpTypes.iosRows[report.chpTypes.iosRows.length - 1];
  const lastChpTypeAndroid = report.chpTypes.androidRows[report.chpTypes.androidRows.length - 1];

  return {
    releaseWindow: {
      from: releases[0] || '',
      to: currentRelease,
      count: releases.length,
      releases,
      currentRelease,
      previousRelease,
      compareMode: compareMode === 'prev' ? 'previous_release' : 'mean_history',
      baseReleases,
    },
    mlRisk: {
      engine: report.ml.prediction.engine,
      regressionProbabilityPct: report.ml.prediction.activeProbability == null ? null : round(report.ml.prediction.activeProbability * 100, 1),
      linearProbabilityPct: report.ml.prediction.linearProbability == null ? null : round(report.ml.prediction.linearProbability * 100, 1),
      catboostProbabilityPct: report.ml.prediction.catboostProbability == null ? null : round(report.ml.prediction.catboostProbability * 100, 1),
      labeledSamples: report.ml.prediction.labeledSamples,
      features: Object.fromEntries(Object.entries(report.ml.features || {}).map(([key, value]) => [key, round(Number(value), 2)])) as Partial<Record<ChartsMlFeatureKey, number>>,
    },
    keyMetrics: {
      regress: [
        buildAiMetricSnapshot('Объем регресса', tcSeries, 'count', compareMode, 0, 'down'),
        buildAiMetricSnapshot('АТ в регрессе', autoSeries, 'count', compareMode, 0, 'up'),
        buildAiMetricSnapshot('Критичные проверки SWAT + Stream', covSeries, 'count', compareMode, 0, 'up'),
        buildAiMetricSnapshot('Селективные проверки', selectiveSeries, 'count', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Среднее время прохождения', avgSeries, 'minutes', compareMode, 2, 'down'),
        buildAiMetricSnapshot('Среднее время на кейс', avgWeightedSeries, 'minutes', compareMode, 2, 'down'),
      ],
      release: [
        buildAiMetricSnapshot('ЧП всего', chpSeries, 'count', compareMode, 0, 'down'),
        buildAiMetricSnapshot('ЧП iOS', chpIosSeries, 'count', compareMode, 0, 'down'),
        buildAiMetricSnapshot('ЧП Android', chpAndroidSeries, 'count', compareMode, 0, 'down'),
      ],
      timings: [
        buildAiMetricSnapshot('Cutoff iOS', cutIosSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Cutoff Android', cutAndroidSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Старт регресса iOS', regIosSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Старт регресса Android', regAndroidSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Store iOS', storeIosSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Store Android', storeAndroidSeries, 'clock', compareMode, 0, 'down'),
        buildAiMetricSnapshot('Lag iOS', lagIosSeries, 'minutes', compareMode, 1, 'down'),
        buildAiMetricSnapshot('Lag Android', lagAndroidSeries, 'minutes', compareMode, 1, 'down'),
      ],
    },
    anomalies: report.anomalies,
    streams: {
      hb: buildAiStreamDeltaSnapshot(report.streamInsights.hb),
      selective: buildAiStreamDeltaSnapshot(report.streamInsights.selective),
      uwu: buildAiStreamDeltaSnapshot(report.streamInsights.uwu),
      internalStreams: report.streamInsights.internalStreams.slice(0, 20),
      externalStreams: report.streamInsights.externalStreams.slice(0, 20),
    },
    taskTypes: {
      ios: buildAiTypeSnapshot(report.taskTypes.iosRows, 'iOS', lastIosType?.release || '', lastIosType?.counts || {}),
      android: buildAiTypeSnapshot(report.taskTypes.androidRows, 'Android', lastAndroidType?.release || '', lastAndroidType?.counts || {}),
      chpAll: buildAiTypeSnapshot(report.chpTypes.rows, 'ЧП', lastChpType?.release || '', lastChpType ? { product: lastChpType.product, vlet: lastChpType.vlet, bug: lastChpType.bug, crash: lastChpType.crash } : {}),
      chpIos: buildAiTypeSnapshot(report.chpTypes.iosRows, 'ЧП iOS', lastChpTypeIos?.release || '', lastChpTypeIos ? { product: lastChpTypeIos.product, vlet: lastChpTypeIos.vlet, bug: lastChpTypeIos.bug, crash: lastChpTypeIos.crash } : {}),
      chpAndroid: buildAiTypeSnapshot(report.chpTypes.androidRows, 'ЧП Android', lastChpTypeAndroid?.release || '', lastChpTypeAndroid ? { product: lastChpTypeAndroid.product, vlet: lastChpTypeAndroid.vlet, bug: lastChpTypeAndroid.bug, crash: lastChpTypeAndroid.crash } : {}),
    },
    recentReleases: {
      testCases: report.tcRows.slice(-4).map(row => ({ release: row.release, manual: row.manual, auto: row.auto, total: row.total })),
      coverage: report.coverageRows.slice(-4).map(row => ({ release: row.release, swat: row.swatCount, stream: row.streamCount, total: row.total })),
      selective: report.selectiveRows.slice(-4).map(row => ({ release: row.release, swat: row.swatCount, stream: row.streamCount, total: row.total })),
      avgMinutes: report.avgRows.slice(-4).map(row => ({ release: row.release, total: round(row.totalMs / 60000, 2), weighted: round(row.totalWeighted / 60000, 2) })),
      chp: report.chpRows.slice(-4).map(row => ({ release: row.release, total: row.total, ios: row.ios, android: row.android })),
      timings: report.timings.slice(-4).map(row => ({
        release: row.release,
        iosCutoff: row.iosCutLabel || '—',
        androidCutoff: row.androidCutLabel || '—',
        iosRegressionStart: row.iosRegressionLabel || '—',
        androidRegressionStart: row.androidRegressionLabel || '—',
        iosStore: row.iosStoreLabel || '—',
        androidStore: row.androidStoreLabel || '—',
        iosLag: row.iosLagMinutes == null ? '—' : `${round(row.iosLagMinutes, 1)} мин`,
        androidLag: row.androidLagMinutes == null ? '—' : `${round(row.androidLagMinutes, 1)} мин`,
      })),
    },
    devDowntime: {
      ios: buildAiMetricSnapshot('DEV downtime iOS', iosDowntimeSeries, 'minutes', compareMode, 1, 'down'),
      android: buildAiMetricSnapshot('DEV downtime Android', androidDowntimeSeries, 'minutes', compareMode, 1, 'down'),
      total: buildAiMetricSnapshot('DEV downtime total', totalDowntimeSeries, 'minutes', compareMode, 1, 'down'),
      currentDays: {
        ios: currentDowntimeIos?.days || 0,
        android: currentDowntimeAndroid?.days || 0,
        total: (currentDowntimeIos?.days || 0) + (currentDowntimeAndroid?.days || 0),
      },
    },
  };
}

export function buildChartsAiSummaryPrompt(context: ChartsAiContext) {
  const compactContext = compressChartsAiContextForPrompt(context);
  return {
    system: [
      'Ты senior release analyst по мобильным релизам.',
      'Анализируй только факты из переданного JSON.',
      'Учитывай все разделы JSON: keyMetrics, anomalies, streams, taskTypes, recentReleases, devDowntime, mlSummary и displayedTables.',
      'Отдельно сверяй выводы с локальной ML-саммаризацией и вероятностью CatBoost/линейной модели. Если локальная саммаризация уже содержит риск, не игнорируй его.',
      'Не придумывай причины, которых нет в данных.',
      'Пиши только на русском, как сильный аналитик и инженер, а не как маркетинговая выжимка.',
      'Не используй markdown-таблицы.',
      'Не пересказывай весь JSON. Сжимай в деловой вывод, но не теряй факты по регрессу, релизу, типам, стримам и downtime.',
      'Структура ответа строго такая:',
      'Короткий вывод',
      '- пункт',
      'Главные риски',
      '- пункт',
      'Что изменилось относительно базы',
      '- пункт',
      'Рекомендации на следующий релиз',
      '- пункт',
      'Что проверить вручную',
      '- пункт',
      'В каждом разделе 2-5 коротких, но содержательных пунктов.',
    ].join('\n'),
    user: [
      `Сделай аналитический вывод по текущему релизу ${context.releaseWindow.currentRelease || '—'}.`,
      'Ниже сжатый агрегированный JSON из вкладки "Графики". Он уже содержит только важные сводки, top anomalies, top deltas и локальную ML-саммаризацию.',
      JSON.stringify(compactContext, null, 2),
    ].join('\n\n'),
  };
}

function buildLocalChartsAiSummaryText(context: ChartsAiContext) {
  const mlSummary = context.mlSummary;
  if (!mlSummary) {
    return [
      'Короткий вывод',
      '- Недостаточно данных для LLM-анализа, используем локальный fallback.',
      '',
      'Главные риски',
      '- Локальная ML-саммаризация не была подготовлена.',
      '',
      'Что изменилось относительно базы',
      '- Нет локального summary для сравнения.',
      '',
      'Рекомендации на следующий релиз',
      '- Проверь, что локальный ML summary сформировался после сбора данных.',
      '',
      'Что проверить вручную',
      '- Сверь текущий релиз с вкладками Регресс, Релиз, Типы и Стримы вручную.',
    ].join('\n');
  }
  return [
    'Короткий вывод',
    ...mlSummary.overview.map(item => `- ${item}`),
    '',
    'Главные риски',
    ...mlSummary.risks.map(item => `- ${item}`),
    '',
    'Что изменилось относительно базы',
    ...mlSummary.changes.map(item => `- ${item}`),
    '',
    'Рекомендации на следующий релиз',
    ...mlSummary.recommendations.map(item => `- ${item}`),
    '',
    'Что проверить вручную',
    ...mlSummary.manualChecks.map(item => `- ${item}`),
  ].join('\n');
}

function shouldBypassProxyForUrl(targetUrl: string) {
  try {
    const url = new URL(targetUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchWithProxyRouting(cfg: ChartsConfig, targetUrl: string, options: RequestInit) {
  const attempts: Array<{ url: string; viaProxy: boolean }> = [];
  if (!shouldBypassProxyForUrl(targetUrl) && cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
    const base = String(cfg.proxyBase || '').trim().replace(/\/+$/, '');
    attempts.push({ url: `${base}/proxy?url=${encodeURIComponent(targetUrl)}`, viaProxy: true });
  }
  attempts.push({ url: targetUrl, viaProxy: false });

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { cache: 'no-store', ...options });
      if (!response.ok) {
        const preview = String(await response.text().catch(() => '') || '').trim().slice(0, 220);
        lastError = new Error(`HTTP ${response.status}${preview ? `: ${preview}` : ''}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError || new Error('Network request failed');
}

function llmContentToText(content: unknown) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof (part as { text?: string }).text === 'string') return String((part as { text?: string }).text);
        if (typeof (part as { content?: string }).content === 'string') return String((part as { content?: string }).content);
      }
      return '';
    }).join('').trim();
  }
  return '';
}

function extractLlmTextFromPayload(payload: unknown) {
  if (typeof (payload as { output_text?: string })?.output_text === 'string' && String((payload as { output_text?: string }).output_text).trim()) {
    return String((payload as { output_text?: string }).output_text).trim();
  }
  const choices = Array.isArray((payload as { choices?: unknown[] })?.choices) ? (payload as { choices: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> }).choices : [];
  for (const choice of choices) {
    const text = llmContentToText(choice?.message?.content) || llmContentToText(choice?.delta?.content);
    if (text) return text;
  }
  return '';
}

function buildChartsAiCacheKey(cfg: ChartsConfig, context: ChartsAiContext) {
  return JSON.stringify({
    base: normalizeGlmBase(cfg.glmBase),
    model: String(cfg.glmModel || 'glm-4'),
    context: compressChartsAiContextForPrompt(context),
  });
}

function extractLlmDeltaFromChunk(payload: unknown) {
  const choices = Array.isArray((payload as { choices?: unknown[] })?.choices)
    ? (payload as { choices: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }).choices
    : [];
  for (const choice of choices) {
    const text = llmContentToText(choice?.delta?.content) || llmContentToText(choice?.message?.content);
    if (text) return text;
  }
  return '';
}

async function readStreamingChartsAiSummary(
  response: Response,
  onToken?: (text: string) => void,
  signal?: AbortSignal
) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let emitted = '';
  let lastEmitTs = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const payload = JSON.parse(data);
        const delta = extractLlmDeltaFromChunk(payload);
        if (!delta) continue;
        text += delta;
        if (onToken) {
          const now = Date.now();
          if (text !== emitted && (now - lastEmitTs >= 90 || text.length - emitted.length >= 48)) {
            emitted = text;
            lastEmitTs = now;
            onToken(text);
          }
        }
      } catch {
        /* noop */
      }
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
  if (onToken && text && text !== emitted) onToken(text);
  return text.trim();
}

export async function requestChartsAiSummary(
  cfg: ChartsConfig,
  context: ChartsAiContext,
  options?: { onToken?: (text: string) => void; signal?: AbortSignal; forceRefresh?: boolean }
) {
  const base = normalizeGlmBase(cfg.glmBase);
  if (!base) throw new Error('LLM Base URL не задан');
  const cacheKey = buildChartsAiCacheKey(cfg, context);
  if (!options?.forceRefresh && CHARTS_AI_SUMMARY_CACHE.has(cacheKey)) {
    const cached = CHARTS_AI_SUMMARY_CACHE.get(cacheKey) || '';
    if (options?.onToken) options.onToken(cached);
    return cached;
  }
  const prompt = buildChartsAiSummaryPrompt(context);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (String(cfg.glmKey || '').trim()) headers.Authorization = `Bearer ${String(cfg.glmKey || '').trim()}`;
  const body = JSON.stringify({
    model: String(cfg.glmModel || 'glm-4'),
    stream: true,
    temperature: 0.2,
    max_tokens: 1400,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  });

  try {
    const response = await fetchWithProxyRouting(cfg, `${base}/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: options?.signal,
    });
    const streamedText = await readStreamingChartsAiSummary(response, options?.onToken, options?.signal);
    if (streamedText) {
      CHARTS_AI_SUMMARY_CACHE.set(cacheKey, streamedText);
      return streamedText;
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
  }

  const fallbackResponse = await fetchWithProxyRouting(cfg, `${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: String(cfg.glmModel || 'glm-4'),
      stream: false,
      temperature: 0.2,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: options?.signal,
  });
  const payload = await fallbackResponse.json().catch(() => ({}));
  const text = extractLlmTextFromPayload(payload);
  if (!text) return buildLocalChartsAiSummaryText(context);
  CHARTS_AI_SUMMARY_CACHE.set(cacheKey, text);
  if (options?.onToken) options.onToken(text);
  return text;
}

export async function collectChartsReport(cfg: ChartsConfig, fromRelease: string, toRelease: string, options?: CollectChartsOptions): Promise<ChartsReport> {
  if (!String(cfg.allureBase || '').trim() || !String(cfg.allureToken || '').trim() || !String(cfg.projectId || '').trim()) {
    throw new Error('Заполни Allure Base URL, Allure Token и Project ID.');
  }

  const releases = buildMajorReleaseRange(fromRelease, toRelease).sort(compareReleaseAsc);
  if (!releases.length) {
    throw new Error('Не удалось построить диапазон релизов. Используй формат вроде 7.5.0000 → 7.5.9000.');
  }

  const tcRows: ChartsTcRow[] = [];
  const coverageRows: ChartsCoverageRow[] = [];
  const selectiveRows: ChartsCoverageRow[] = [];
  const avgRows: ChartsAvgRow[] = [];
  const chpRows: ChartsChpRow[] = [];
  const timings: ChartsTimingRow[] = [];
  const taskTypesIosRows: ChartsTaskTypeRow[] = [];
  const taskTypesAndroidRows: ChartsTaskTypeRow[] = [];
  const taskTypesIosSet = new Set<string>();
  const taskTypesAndroidSet = new Set<string>();
  const chpTypesRows: ChartsChpTypeRow[] = [];
  const chpTypesIosRows: ChartsChpTypeRow[] = [];
  const chpTypesAndroidRows: ChartsChpTypeRow[] = [];
  const releaseMarkersMap = new Map<string, { release: string; fromMs: number; toMs: number; sources: Set<string>; regressionFromMs: number; deployFromMs: number; deployToMs: number }>();
  const tcStreamByRelease: Array<{ release: string; counts: Map<string, { manual: number; auto: number; uwuManual: number; uwuAuto: number }> }> = [];
  const hbStreamByRelease: Array<{ release: string; counts: Map<string, number> }> = [];
  const selStreamByRelease: Array<{ release: string; counts: Map<string, number> }> = [];
  const uwuStreamByRelease: Array<{ release: string; counts: Map<string, number> }> = [];

  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index];
    options?.onProgress?.(index, releases.length);
    log(options, `Сбор релиза ${release}...`);

    const swatInfo = await fetchSwatLogins(release, cfg.signal);
    const swatSet = swatInfo.set;
    const swatPeopleDeclared = Number(swatInfo.total || 0) || 0;

    const launchMap = new Map<number, AllureLaunchLite>();
    const smokeLaunches = await fetchChartLaunchesByKind(cfg, release, 'Smoke');
    const selectiveLaunchesForTotal = await fetchChartLaunchesByKind(cfg, release, 'Selective');
    [...smokeLaunches, ...selectiveLaunchesForTotal].forEach(launch => {
      const id = Number(launch?.id || 0);
      if (id) {
        launchMap.set(id, launch);
        const createdDate = Number(launch?.createdDate || 0);
        if (Number.isFinite(createdDate) && createdDate > 0) {
          collectReleaseMarker(releaseMarkersMap, release, createdDate, 'allure');
        }
      }
    });
    const allLaunchIds = Array.from(launchMap.keys());

    let total = 0;
    let auto = 0;
    if (allLaunchIds.length) {
      const totals = await mapLimit(allLaunchIds, 12, async launchId => {
        const [launchTotal, automatedTotal] = await Promise.all([
          fetchLaunchStatistic(cfg, launchId).catch(() => 0),
          fetchAutomatedTotalCases(cfg, launchId).catch(() => 0),
        ]);
        return { launchTotal, automatedTotal };
      }, cfg.signal);
      totals.forEach(item => {
        total += Number(item?.launchTotal || 0);
        auto += Number(item?.automatedTotal || 0);
      });
    }
    const manual = Math.max(0, total - auto);
    tcRows.push({ release, manual, auto, total });

    const hbAvgLaunches = await fetchHBLaunchesSwatRelease(cfg, release);
    const hbAvgIds = hbAvgLaunches.map(launch => Number(launch?.id || 0)).filter(Boolean);
    const perAvg = await mapLimit(hbAvgIds, 12, async launchId => {
      const memberStats = await fetchMemberStats(cfg, launchId).catch(() => []);
      const byLogin = new Map<string, { cases: number; duration: number }>();
      for (const member of memberStats) {
        const assignee = normalizeLogin(member?.assignee);
        if (!assignee) continue;
        const cases = memberTotalCountSwatRelease(member) + memberRetryCount(member);
        if (cases <= 0) continue;
        const duration = Number(member?.durationSum || 0) || 0;
        const bucket = byLogin.get(assignee) || { cases: 0, duration: 0 };
        bucket.cases += cases;
        bucket.duration += duration;
        byLogin.set(assignee, bucket);
      }
      return byLogin;
    }, cfg.signal);

    const avgByLogin = new Map<string, { cases: number; duration: number }>();
    perAvg.forEach(map => {
      map.forEach((value, login) => {
        const bucket = avgByLogin.get(login) || { cases: 0, duration: 0 };
        bucket.cases += Number(value?.cases || 0);
        bucket.duration += Number(value?.duration || 0);
        avgByLogin.set(login, bucket);
      });
    });

    let swatAvgMsSum = 0;
    let swatAvgCount = 0;
    let streamAvgMsSum = 0;
    let streamAvgCount = 0;
    let totalAvgMsSum = 0;
    let totalAvgCount = 0;
    let swatDurationAll = 0;
    let swatCasesAll = 0;
    let streamDurationAll = 0;
    let streamCasesAll = 0;
    let totalDurationAll = 0;
    let totalCasesAll = 0;

    avgByLogin.forEach((value, login) => {
      const cases = Number(value?.cases || 0);
      if (cases <= 0) return;
      const duration = Number(value?.duration || 0);
      const avgMs = duration / cases;

      totalDurationAll += duration;
      totalCasesAll += cases;
      totalAvgMsSum += avgMs;
      totalAvgCount += 1;

      if (swatSet.has(login)) {
        swatAvgMsSum += avgMs;
        swatAvgCount += 1;
        swatDurationAll += duration;
        swatCasesAll += cases;
      } else {
        streamAvgMsSum += avgMs;
        streamAvgCount += 1;
        streamDurationAll += duration;
        streamCasesAll += cases;
      }
    });

    avgRows.push({
      release,
      swatMs: swatAvgCount ? swatAvgMsSum / swatAvgCount : 0,
      streamMs: streamAvgCount ? streamAvgMsSum / streamAvgCount : 0,
      totalMs: totalAvgCount ? totalAvgMsSum / totalAvgCount : 0,
      swatWeighted: swatCasesAll ? swatDurationAll / swatCasesAll : 0,
      streamWeighted: streamCasesAll ? streamDurationAll / streamCasesAll : 0,
      totalWeighted: totalCasesAll ? totalDurationAll / totalCasesAll : 0,
    });

    const hbLaunches = await fetchHBLaunches(cfg, release);
    const hbIds = hbLaunches.map(launch => Number(launch?.id || 0)).filter(Boolean);
    let hbSwat = 0;
    let hbStream = 0;
    if (hbIds.length) {
      const perHb = await mapLimit(hbIds, 12, async launchId => {
        const memberStats = await fetchMemberStats(cfg, launchId).catch(() => []);
        return {
          agg: swatStreamAgg(memberStats, swatSet),
          people: Array.from(extractSwatAssignees(memberStats, swatSet)),
        };
      }, cfg.signal);

      const hbPeopleSet = new Set<string>();
      perHb.forEach(item => {
        hbSwat += Number(item?.agg?.swatTotal || 0);
        hbStream += Number(item?.agg?.streamTotal || 0);
        (item?.people || []).forEach(person => hbPeopleSet.add(person));
      });

      const hbStreamCounts = new Map<string, number>();
      const hbPerStream = await mapLimit(hbIds, 6, async launchId => {
        const allMap = new Map<string, number>();
        await collectStreamCountsByLaunch(cfg, launchId, allMap, new Map(), new Map(), new Map(), {
          includeAuto: false,
          includeUwu: false,
        });
        return allMap;
      }, cfg.signal);
      hbPerStream.forEach(map => mergeMapCounts(hbStreamCounts, map));
      hbStreamByRelease.push({ release, counts: hbStreamCounts });

      coverageRows.push({
        release,
        swatCount: hbSwat,
        swatPeople: swatPeopleDeclared || hbPeopleSet.size,
        streamCount: hbStream,
        total: hbSwat + hbStream,
      });
    } else {
      hbStreamByRelease.push({ release, counts: new Map() });
      coverageRows.push({ release, swatCount: 0, swatPeople: swatPeopleDeclared, streamCount: 0, total: 0 });
    }

    const selectiveLaunches = await fetchChartLaunchesByKind(cfg, release, 'Selective');
    const selectiveIds = selectiveLaunches.map(launch => Number(launch?.id || 0)).filter(Boolean);
    let selectiveSwat = 0;
    let selectiveStream = 0;
    if (selectiveIds.length) {
      const perSelective = await mapLimit(selectiveIds, 12, async launchId => {
        const memberStats = await fetchMemberStats(cfg, launchId).catch(() => []);
        return {
          agg: swatStreamAgg(memberStats, swatSet),
          people: Array.from(extractSwatAssignees(memberStats, swatSet)),
        };
      }, cfg.signal);
      const selectivePeopleSet = new Set<string>();
      perSelective.forEach(item => {
        selectiveSwat += Number(item?.agg?.swatTotal || 0);
        selectiveStream += Number(item?.agg?.streamTotal || 0);
        (item?.people || []).forEach(person => selectivePeopleSet.add(person));
      });
      selectiveRows.push({
        release,
        swatCount: selectiveSwat,
        swatPeople: swatPeopleDeclared || selectivePeopleSet.size,
        streamCount: selectiveStream,
        total: selectiveSwat + selectiveStream,
      });

      const selectiveStreamCounts = new Map<string, number>();
      const selPerStream = await mapLimit(selectiveIds, 6, async launchId => {
        const allMap = new Map<string, number>();
        await collectStreamCountsByLaunch(cfg, launchId, allMap, new Map(), new Map(), new Map(), {
          includeAuto: false,
          includeUwu: false,
        });
        return allMap;
      }, cfg.signal);
      selPerStream.forEach(map => mergeMapCounts(selectiveStreamCounts, map));
      selStreamByRelease.push({ release, counts: selectiveStreamCounts });
    } else {
      selectiveRows.push({ release, swatCount: 0, swatPeople: swatPeopleDeclared, streamCount: 0, total: 0 });
      selStreamByRelease.push({ release, counts: new Map() });
    }

    if (allLaunchIds.length) {
      const allMap = new Map<string, number>();
      const autoMap = new Map<string, number>();
      const allUwuMap = new Map<string, number>();
      const autoUwuMap = new Map<string, number>();
      const perStream = await mapLimit(allLaunchIds, 6, async launchId => {
        const localAll = new Map<string, number>();
        const localAuto = new Map<string, number>();
        const localAllUwu = new Map<string, number>();
        const localAutoUwu = new Map<string, number>();
        await collectStreamCountsByLaunch(cfg, launchId, localAll, localAuto, localAllUwu, localAutoUwu);
        return { localAll, localAuto, localAllUwu, localAutoUwu };
      }, cfg.signal);

      perStream.forEach(item => {
        mergeMapCounts(allMap, item.localAll);
        mergeMapCounts(autoMap, item.localAuto);
        mergeMapCounts(allUwuMap, item.localAllUwu);
        mergeMapCounts(autoUwuMap, item.localAutoUwu);
      });

      tcStreamByRelease.push({ release, counts: buildCountsByStream(allMap, autoMap, allUwuMap, autoUwuMap) });
      uwuStreamByRelease.push({ release, counts: new Map(allUwuMap) });
    } else {
      tcStreamByRelease.push({ release, counts: new Map() });
      uwuStreamByRelease.push({ release, counts: new Map() });
    }

    const [iosChp, androidChp] = await Promise.all([
      fetchDeployIssueCount(cfg, 'IOS', release).catch(() => 0),
      fetchDeployIssueCount(cfg, 'ANDROID', release).catch(() => 0),
    ]);
    chpRows.push({
      release,
      ios: iosChp,
      android: androidChp,
      total: iosChp + androidChp,
    });

    const [iosTiming, androidTiming, iosRegression, androidRegression] = await Promise.all([
      fetchDeployDates(cfg, 'IOS', release).catch(() => ({ cutoff: null, storeMsLocal: null })),
      fetchDeployDates(cfg, 'ANDROID', release).catch(() => ({ cutoff: null, storeMsLocal: null })),
      fetchRegressionStartPoint(cfg, 'IOS', release).catch(() => null),
      fetchRegressionStartPoint(cfg, 'ANDROID', release).catch(() => null),
    ]);

    const iosCut = yValueFromIsoCut(iosTiming.cutoff);
    const androidCut = yValueFromIsoCut(androidTiming.cutoff);
    const iosStore = yValueFromMsLocalCut(iosTiming.storeMsLocal);
    const androidStore = yValueFromMsLocalCut(androidTiming.storeMsLocal);
    if (iosCut?.msLocal) collectReleaseMarker(releaseMarkersMap, release, iosCut.msLocal, 'deploy');
    if (androidCut?.msLocal) collectReleaseMarker(releaseMarkersMap, release, androidCut.msLocal, 'deploy');
    if (iosStore?.msLocal) collectReleaseMarker(releaseMarkersMap, release, iosStore.msLocal, 'deploy');
    if (androidStore?.msLocal) collectReleaseMarker(releaseMarkersMap, release, androidStore.msLocal, 'deploy');
    if (iosRegression?.msLocal) collectReleaseMarker(releaseMarkersMap, release, iosRegression.msLocal, 'regression');
    if (androidRegression?.msLocal) collectReleaseMarker(releaseMarkersMap, release, androidRegression.msLocal, 'regression');

    timings.push({
      release,
      iosCutLabel: iosCut?.label || '',
      androidCutLabel: androidCut?.label || '',
      iosStoreLabel: iosStore?.label || '',
      androidStoreLabel: androidStore?.label || '',
      iosRegressionLabel: iosRegression?.label || '',
      androidRegressionLabel: androidRegression?.label || '',
      iosCutMinutes: iosCut?.y ?? null,
      androidCutMinutes: androidCut?.y ?? null,
      iosStoreMinutes: iosStore?.y ?? null,
      androidStoreMinutes: androidStore?.y ?? null,
      iosRegressionMinutes: iosRegression?.y ?? null,
      androidRegressionMinutes: androidRegression?.y ?? null,
      iosLagMinutes: iosCut?.y != null && iosStore?.y != null ? iosStore.y - iosCut.y : null,
      androidLagMinutes: androidCut?.y != null && androidStore?.y != null ? androidStore.y - androidCut.y : null,
    });

    const [iosIssues, androidIssues] = await Promise.all([
      fetchDeployIssuesList(cfg, 'IOS', release).catch(() => []),
      fetchDeployIssuesList(cfg, 'ANDROID', release).catch(() => []),
    ]);

    const iosTypesAgg = aggregateIssuesByType(iosIssues);
    const androidTypesAgg = aggregateIssuesByType(androidIssues);
    iosTypesAgg.typeSet.forEach(type => taskTypesIosSet.add(type));
    androidTypesAgg.typeSet.forEach(type => taskTypesAndroidSet.add(type));
    taskTypesIosRows.push({ release, counts: iosTypesAgg.counts, details: iosTypesAgg.details });
    taskTypesAndroidRows.push({ release, counts: androidTypesAgg.counts, details: androidTypesAgg.details });

    const iosChpIssues = uniqueIssuesByKey(iosIssues.filter(item => item?.merged_after_cutoff === true));
    const androidChpIssues = uniqueIssuesByKey(androidIssues.filter(item => item?.merged_after_cutoff === true));
    const allIssues = uniqueIssuesByKey([...iosIssues, ...androidIssues]);
    const metaByKey = await fetchYtIssueMetaBatch(cfg, allIssues, options);

    const releaseChpCounts = computeChpTypesCounts(uniqueIssuesByKey([...iosChpIssues, ...androidChpIssues]), metaByKey);
    const iosReleaseChpCounts = computeChpTypesCounts(iosChpIssues, metaByKey);
    const androidReleaseChpCounts = computeChpTypesCounts(androidChpIssues, metaByKey);
    releaseChpCounts.vlet = computeVletCount(allIssues, metaByKey);
    iosReleaseChpCounts.vlet = computeVletCount(iosIssues, metaByKey);
    androidReleaseChpCounts.vlet = computeVletCount(androidIssues, metaByKey);

    chpTypesRows.push({ release, ...releaseChpCounts });
    chpTypesIosRows.push({ release, ...iosReleaseChpCounts });
    chpTypesAndroidRows.push({ release, ...androidReleaseChpCounts });

    log(options, `✓ ${release}: TC ${total.toLocaleString('ru-RU')}, HB ${hbSwat + hbStream}, ЧП ${iosChp + androidChp}`, 'ok');
    options?.onProgress?.(index + 1, releases.length);
  }

  const releaseMarkers = buildReleaseMarkersList(releaseMarkersMap);
  const [iosDowntimeRowsRaw, androidDowntimeRowsRaw] = await Promise.all([
    fetchWikiDevDowntimeRows(cfg).catch(() => []),
    fetchAndroidDevDowntimeRows(cfg, releaseMarkers).catch(() => []),
  ]);
  const iosDowntimeRows = filterDowntimeRowsByAssignedRelease(applyReleaseMarkersToDowntimeRows(iosDowntimeRowsRaw, releaseMarkers));
  const androidDowntimeRows = androidDowntimeRowsRaw;
  const iosDowntimeByRelease = summarizeDowntimeByRelease(iosDowntimeRows, releases);
  const androidDowntimeByRelease = summarizeDowntimeByRelease(androidDowntimeRows, releases);

  const streamDeltaRows: ChartsStreamDeltaRow[] = [];
  for (let index = 1; index < tcStreamByRelease.length; index += 1) {
    const previous = tcStreamByRelease[index - 1];
    const current = tcStreamByRelease[index];
    const streams = new Set<string>([...previous.counts.keys(), ...current.counts.keys()]);
    streams.forEach(stream => {
      const prev = previous.counts.get(stream) || { manual: 0, auto: 0, uwuManual: 0, uwuAuto: 0 };
      const next = current.counts.get(stream) || { manual: 0, auto: 0, uwuManual: 0, uwuAuto: 0 };
      const manualBefore = Number(prev.manual || 0);
      const manualAfter = Number(next.manual || 0);
      const manualDelta = manualAfter - manualBefore;
      const autoBefore = Number(prev.auto || 0);
      const autoAfter = Number(next.auto || 0);
      const autoDelta = autoAfter - autoBefore;
      const uwuManualBefore = Number(prev.uwuManual || 0);
      const uwuManualAfter = Number(next.uwuManual || 0);
      const uwuManualDelta = uwuManualAfter - uwuManualBefore;
      const uwuAutoBefore = Number(prev.uwuAuto || 0);
      const uwuAutoAfter = Number(next.uwuAuto || 0);
      const uwuAutoDelta = uwuAutoAfter - uwuAutoBefore;
      if (!manualDelta && !autoDelta && !uwuManualDelta && !uwuAutoDelta) return;
      streamDeltaRows.push({
        release: current.release,
        stream: normalizeStreamLabel(stream),
        manualBefore, manualAfter, manualDelta,
        autoBefore, autoAfter, autoDelta,
        uwuManualBefore, uwuManualAfter, uwuManualDelta,
        uwuAutoBefore, uwuAutoAfter, uwuAutoDelta,
      });
    });
  }

  const latestStreamCounts = tcStreamByRelease.length ? tcStreamByRelease[tcStreamByRelease.length - 1].counts : new Map();
  const latestStreamNames = Array.from(latestStreamCounts.keys()).map(normalizeStreamLabel).filter(Boolean).sort((left, right) => left.localeCompare(right));
  const streamInsights = {
    hb: buildLatestStreamDeltaSummary(hbStreamByRelease, 'тест-кейсов'),
    selective: buildLatestStreamDeltaSummary(selStreamByRelease, 'тест-кейсов'),
    uwu: buildLatestStreamDeltaSummary(uwuStreamByRelease, 'ед. УВУ'),
    internalStreams: latestStreamNames.filter(name => !isExternalStreamLabel(name)),
    externalStreams: latestStreamNames.filter(name => isExternalStreamLabel(name)),
  };

  const provisionalReport = {
    releases,
    tcRows,
    coverageRows,
    selectiveRows,
    avgRows,
    chpRows,
    devDowntime: {
      iosRows: iosDowntimeRows,
      androidRows: androidDowntimeRows,
      iosByRelease: iosDowntimeByRelease,
      androidByRelease: androidDowntimeByRelease,
    },
    timings,
    taskTypes: {
      iosTypes: sortTypesByCanon(taskTypesIosSet),
      androidTypes: sortTypesByCanon(taskTypesAndroidSet),
      iosRows: taskTypesIosRows,
      androidRows: taskTypesAndroidRows,
    },
    chpTypes: {
      rows: chpTypesRows,
      iosRows: chpTypesIosRows,
      androidRows: chpTypesAndroidRows,
    },
    streamInsights,
    streamDeltaRows,
  } as Omit<ChartsReport, 'metrics' | 'anomalies' | 'ml' | 'aiContext'>;

  const buildPrefixAnomalies = (size: number) => computeAnomalies({
    tcRows: tcRows.slice(0, size),
    coverageRows: coverageRows.slice(0, size),
    selectiveRows: selectiveRows.slice(0, size),
    avgRows: avgRows.slice(0, size),
    chpRows: chpRows.slice(0, size),
    timings: timings.slice(0, size),
    taskTypes: {
      iosTypes: provisionalReport.taskTypes.iosTypes,
      androidTypes: provisionalReport.taskTypes.androidTypes,
      iosRows: taskTypesIosRows.slice(0, size),
      androidRows: taskTypesAndroidRows.slice(0, size),
    },
    chpTypes: {
      rows: chpTypesRows.slice(0, size),
      iosRows: chpTypesIosRows.slice(0, size),
      androidRows: chpTypesAndroidRows.slice(0, size),
    },
  });

  const perRowFeatures: Array<{ features: ChartsMlFeatures; anomalies: ChartsAnomalies }> = tcRows.map((_row, index) => {
    const size = index + 1;
    const prefixAnomalies = buildPrefixAnomalies(size);
    const tcStats = seriesStats(tcRows.slice(0, size).map(row => row.total));
    const covSwatStats = seriesStats(coverageRows.slice(0, size).map(row => row.swatCount));
    const covStreamStats = seriesStats(coverageRows.slice(0, size).map(row => row.streamCount));
    const selSwatStats = seriesStats(selectiveRows.slice(0, size).map(row => row.swatCount));
    const selStreamStats = seriesStats(selectiveRows.slice(0, size).map(row => row.streamCount));
    const avgTotalStats = seriesStats(avgRows.slice(0, size).map(row => row.totalMs / 60000));
    const chpTotalStats = seriesStats(chpRows.slice(0, size).map(row => row.total));
    const chpIosStats = seriesStats(chpRows.slice(0, size).map(row => row.ios));
    const chpAndroidStats = seriesStats(chpRows.slice(0, size).map(row => row.android));
    return {
      anomalies: prefixAnomalies,
      features: {
        tc_total: round(tcStats.last, 2),
        tc_total_delta: round(tcStats.delta, 2),
        tc_total_delta_pct: round(tcStats.deltaPct, 2),
        tc_volatility: round(tcStats.vol, 2),
        tc_slope_pct: round(tcStats.slopePct, 2),
        cov_swat_delta_pct: round(covSwatStats.deltaPct, 2),
        cov_stream_delta_pct: round(covStreamStats.deltaPct, 2),
        sel_swat_delta_pct: round(selSwatStats.deltaPct, 2),
        sel_stream_delta_pct: round(selStreamStats.deltaPct, 2),
        avg_total_delta: round(avgTotalStats.delta, 2),
        chp_total_delta_pct: round(chpTotalStats.deltaPct, 2),
        chp_ios_delta_pct: round(chpIosStats.deltaPct, 2),
        chp_android_delta_pct: round(chpAndroidStats.deltaPct, 2),
        release_anoms: prefixAnomalies.release.count,
        type_anoms: prefixAnomalies.type.count,
        platform_anoms: prefixAnomalies.platform.count,
        anom_score: prefixAnomalies.score,
      },
    };
  });

  const anomalies = perRowFeatures.length ? perRowFeatures[perRowFeatures.length - 1].anomalies : buildPrefixAnomalies(0);
  const mlFeatures: ChartsMlFeatures | null = perRowFeatures.length ? perRowFeatures[perRowFeatures.length - 1].features : null;

  const mlDatasetState = await ensureChartsMlDatasetLoaded(cfg).catch(error => ({
    dataset: readChartsMlDataset(),
    remote: false,
    error: (error as Error)?.message || String(error),
  }));
  const mlDataset = mlDatasetState.dataset;
  const linearModel = trainMlModel(mlDataset);
  const linearProbabilities = perRowFeatures.map(item => predictLinearMl(item.features, linearModel));
  const catboostProbabilities = perRowFeatures.length
    ? await Promise.all(perRowFeatures.map(item => predictCatboost(item.features).catch(() => null)))
    : [];
  const linearProbability = linearProbabilities.length ? linearProbabilities[linearProbabilities.length - 1] : null;
  const catboostProbability = catboostProbabilities.length ? catboostProbabilities[catboostProbabilities.length - 1] : null;
  const activeProbability = catboostProbability != null ? catboostProbability : linearProbability;
  const helperHealth = await checkChartsMlHelperHealth(String(cfg.mlHelperBase || '').trim());
  const labeledSamples = mlDataset.filter(item => item.label === 'ok' || item.label === 'fail').length;
  const datasetQuality = getMlDatasetQuality(labeledSamples);
  const modelAgreement = buildModelAgreement(linearProbability, catboostProbability);
  const featureDrivers = buildFeatureDrivers(mlFeatures, linearModel);
  const prediction: ChartsMlPrediction = {
    engine: catboostProbability != null ? 'catboost' : linearProbability != null ? 'linear' : 'none',
    activeProbability,
    linearProbability,
    catboostProbability,
    labeledSamples,
    trained: !!linearModel.trained,
    reason: linearModel.trained ? '' : linearModel.reason,
    datasetQuality: datasetQuality.level,
    datasetQualityText: datasetQuality.text,
    datasetQualityHint: datasetQuality.hint,
    modelAgreementPct: modelAgreement.value,
    agreementText: modelAgreement.text,
    featureDrivers,
  };

  const metrics: ChartsMetricRow[] = tcRows.map((row, index) => {
    const avg = avgRows[index];
    const chp = chpRows[index];
    const coverage = coverageRows[index];
    const selective = selectiveRows[index];
    const prev = index > 0 ? tcRows[index - 1] : null;
    const prevChp = index > 0 ? chpRows[index - 1] : null;
    const featureRow = perRowFeatures[index]?.features;
    const anomalyRow = perRowFeatures[index]?.anomalies;
    const riskProbability = catboostProbabilities[index] ?? linearProbabilities[index] ?? null;
    return {
      release: row.release,
      tc_total: row.total,
      tc_manual: row.manual,
      tc_auto: row.auto,
      tc_total_delta: prev ? row.total - prev.total : 0,
      tc_total_delta_pct: featureRow?.tc_total_delta_pct ?? 0,
      tc_volatility: featureRow?.tc_volatility ?? 0,
      tc_slope_pct: featureRow?.tc_slope_pct ?? 0,
      cov_swat: coverage.swatCount,
      cov_stream: coverage.streamCount,
      cov_swat_delta_pct: featureRow?.cov_swat_delta_pct ?? 0,
      cov_stream_delta_pct: featureRow?.cov_stream_delta_pct ?? 0,
      sel_swat: selective.swatCount,
      sel_stream: selective.streamCount,
      sel_swat_delta_pct: featureRow?.sel_swat_delta_pct ?? 0,
      sel_stream_delta_pct: featureRow?.sel_stream_delta_pct ?? 0,
      avg_total: round(avg.totalMs / 60000, 2),
      avg_weighted: round(avg.totalWeighted / 60000, 2),
      avg_total_delta: index > 0 ? round((avg.totalMs - avgRows[index - 1].totalMs) / 60000, 2) : 0,
      chp_total: chp.total,
      chp_ios: chp.ios,
      chp_android: chp.android,
      chp_prod: chpTypesRows[index]?.product || 0,
      chp_bug: chpTypesRows[index]?.bug || 0,
      chp_crash: chpTypesRows[index]?.crash || 0,
      chp_vlet: chpTypesRows[index]?.vlet || 0,
      chp_total_delta: prevChp ? chp.total - prevChp.total : 0,
      chp_total_delta_pct: featureRow?.chp_total_delta_pct ?? 0,
      chp_ios_delta_pct: featureRow?.chp_ios_delta_pct ?? 0,
      chp_android_delta_pct: featureRow?.chp_android_delta_pct ?? 0,
      anom_score: anomalyRow?.score ?? 0,
      release_anoms: anomalyRow?.release.count ?? 0,
      type_anoms: anomalyRow?.type.count ?? 0,
      platform_anoms: anomalyRow?.platform.count ?? 0,
      mlRiskPct: riskProbability == null ? null : round(riskProbability * 100, 1),
    };
  });

  const report = {
    ...provisionalReport,
    metrics,
    anomalies,
    ml: {
      features: mlFeatures,
      dataset: mlDataset,
      prediction,
      helperHealth,
      summary: {
        statusText: 'Нет данных',
        statusTone: 'neutral',
        engineLabel: 'Нет модели',
        helperText: helperHealth.online ? 'ML-хелпер онлайн' : 'ML-хелпер офлайн',
        helperTone: helperHealth.online ? 'ok' : 'warn',
        trainingText: '',
        compareText: options?.compareMode === 'prev' ? 'к предыдущему релизу' : 'к средней истории',
        overview: [],
        risks: [],
        changes: [],
        recommendations: [],
        manualChecks: [],
        highlights: [],
        sections: {
          overview: { id: 'overview', title: 'Общая саммаризация', subtitle: '', tone: 'neutral', overview: [], risks: [], changes: [], recommendations: [], highlights: [] },
          regress: { id: 'regress', title: 'Регресс', subtitle: '', tone: 'neutral', overview: [], risks: [], changes: [], recommendations: [], highlights: [] },
          release: { id: 'release', title: 'Релиз', subtitle: '', tone: 'neutral', overview: [], risks: [], changes: [], recommendations: [], highlights: [] },
          types: { id: 'types', title: 'Типы и ЧП', subtitle: '', tone: 'neutral', overview: [], risks: [], changes: [], recommendations: [], highlights: [] },
          streams: { id: 'streams', title: 'Стримы', subtitle: '', tone: 'neutral', overview: [], risks: [], changes: [], recommendations: [], highlights: [] },
        },
      } as ChartsMlSummary,
    },
    aiContext: {} as ChartsAiContext,
  } satisfies ChartsReport;

  const summaryState = rebuildChartsSummaryState(report, options?.compareMode || 'mean');
  report.aiContext = summaryState.aiContext;
  report.ml.summary = summaryState.mlSummary;
  return report;
}
