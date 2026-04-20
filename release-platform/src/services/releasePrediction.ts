import {
  DASHBOARD_ORDER,
  type DashboardAlertEntry,
  type DashboardGroupCounts,
  type DashboardGroupLabel,
  type DashboardUwuCounts,
  type ReadinessLaunchSummary,
} from './allure';
import {
  computeRegressionBaseline,
  forecastVelocityWithPeople,
  loadRegressionRuns,
  requiredPeopleForVelocity,
  saveRegressionRun,
  buildRegressionRunId,
  buildDailyPeopleDistribution,
  expectedPeopleCountForToday,
  type GasConfig,
  type RegressionBaseline,
  type RegressionRunRecord,
} from './regressionHistory';
const ML_FEATURE_KEYS = [
  'tc_total',
  'tc_total_delta',
  'tc_total_delta_pct',
  'tc_volatility',
  'tc_slope_pct',
  'cov_swat_delta_pct',
  'cov_stream_delta_pct',
  'sel_swat_delta_pct',
  'sel_stream_delta_pct',
  'avg_total_delta',
  'chp_total_delta_pct',
  'chp_ios_delta_pct',
  'chp_android_delta_pct',
  'release_anoms',
  'type_anoms',
  'platform_anoms',
  'anom_score',
] as const;

type MlFeatureKey = typeof ML_FEATURE_KEYS[number];
type MlFeatureMap = Record<MlFeatureKey, number>;

export interface DashboardHistoryPoint {
  version: string;
  updatedAt: number;
  total: number;
  finished: number;
  manualFinished: number;
  remaining: number;
  launches: number;
  assigned: number;
  inProgress: number;
  readinessAndroid: number;
  readinessIos: number;
  criticalTotal: number;
  criticalFinished: number;
  selectiveTotal: number;
  selectiveFinished: number;
  emptyAlerts: number;
  noPassedAlerts: number;
  uwuTotal: number;
  uwuLeft: number;
  activePeopleCount: number;
  activePeopleLogins: string[];
}

export interface DashboardPredictionInput {
  version: string;
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>;
  readiness: ReadinessLaunchSummary[];
  alerts: DashboardAlertEntry[];
  history: DashboardHistoryPoint[];
  nowTs?: number;
  customDeadlineTs?: number;
  peopleCount?: number;
  activePeopleCount?: number;
  activePeopleLogins?: string[];
  gasConfig?: GasConfig;
  launchCreatedTs?: number | null;
}

export interface DashboardPrediction {
  deadlineTs: number;
  etaTs: number | null;
  status: 'done' | 'on_track' | 'at_risk' | 'off_track';
  engine: 'catboost+operational' | 'operational';
  risk: number;
  mlRisk: number | null;
  heuristicRisk: number;
  confidence: number;
  observedVelocityPerHour: number | null;
  forecastVelocityPerHour: number | null;
  requiredPerHour: number | null;
  projectedRemainingByDeadline: number;
  projectedFinishedByDeadline: number;
  projectedCriticalRemainingByDeadline: number;
  projectedSelectiveRemainingByDeadline: number;
  leadHours: number | null;
  features: MlFeatureMap;
  reasons: string[];
  // People-aware forecast
  peopleCount: number;
  peopleCountSource: 'allure' | 'history' | 'default';
  historicalBaseline: RegressionBaseline;
  historicalVelocityPerHour: number | null;
  requiredPeopleForDeadline: number | null;
}

let ortModulePromise: Promise<typeof import('onnxruntime-web') | null> | null = null;
let catboostSessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;
let catboostManifestVersionPromise: Promise<string | null> | null = null;
let catboostSessionVersion: string | null = null;
const CATBOOST_TRAINED_AT_STORAGE_KEY = 'wb_graphs_catboost_trained_at_v1';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const MOSCOW_UTC_OFFSET_MS = 3 * 3_600_000;

function getMoscowHour(ts: number) {
  return new Date(Number(ts || 0) + MOSCOW_UTC_OFFSET_MS).getUTCHours();
}

function isBusinessSnapshotHour(ts: number) {
  const hour = getMoscowHour(ts);
  return hour >= 10 && hour < 22;
}

function getGroup(agg: Record<DashboardGroupLabel, DashboardGroupCounts>, label: DashboardGroupLabel) {
  return agg[label] || { total: 0, finished: 0, remaining_total: 0, remaining: 0, in_progress: 0, manual_finished: 0 };
}

function getUwuGroup(uwu: Record<DashboardGroupLabel, DashboardUwuCounts>, label: DashboardGroupLabel) {
  return uwu[label] || { total: 0, done: 0, left: 0 };
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function std(values: number[]) {
  if (!values.length) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length);
}

function weightedMean(values: number[]) {
  if (!values.length) return 0;
  const totalWeight = values.reduce((sum, _value, index) => sum + index + 1, 0);
  if (!totalWeight) return 0;
  return values.reduce((sum, value, index) => sum + value * (index + 1), 0) / totalWeight;
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

function extractTrainedAtFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = normalizeModelVersion((payload as { trainedAt?: unknown; version?: unknown }).trainedAt)
    || normalizeModelVersion((payload as { trainedAt?: unknown; version?: unknown }).version);
  if (direct) return direct;
  const nestedMeta = (payload as { meta?: { trainedAt?: unknown; version?: unknown } }).meta;
  return normalizeModelVersion(nestedMeta?.trainedAt) || normalizeModelVersion(nestedMeta?.version);
}

function updateCatboostSessionVersion(version: unknown) {
  const normalized = normalizeModelVersion(version);
  if (!normalized) return false;
  if (normalized === catboostSessionVersion) return false;
  catboostSessionVersion = normalized;
  catboostSessionPromise = null;
  catboostManifestVersionPromise = Promise.resolve(normalized);
  persistCatboostVersion(normalized);
  return true;
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

function pctDelta(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function buildSeriesStats(series: number[]) {
  const values = (Array.isArray(series) ? series : []).map(value => Number(value) || 0);
  const last = values.length ? values[values.length - 1] : 0;
  const prev = values.length > 1 ? values[values.length - 2] : 0;
  const delta = last - prev;
  const deltaPct = pctDelta(last, prev);
  const volatility = std(values);
  const slopePct = values.length > 1 ? pctDelta(last, values[0]) : 0;

  return {
    last,
    prev,
    delta,
    deltaPct,
    volatility,
    slopePct,
  };
}

function createCurrentHistoryPoint(input: DashboardPredictionInput, nowTs: number): DashboardHistoryPoint {
  const criticalLabels = DASHBOARD_ORDER.filter(label => label.includes('[High/Blocker]'));
  const selectiveLabels = DASHBOARD_ORDER.filter(label => label.includes('[Selective]'));
  const readinessAndroid = input.readiness.find(item => item.platform === 'android')?.pct || 0;
  const readinessIos = input.readiness.find(item => item.platform === 'ios')?.pct || 0;
  const emptyAlerts = input.alerts.filter(item => item.total === 0).length;
  const noPassedAlerts = input.alerts.filter(item => item.total > 0 && item.finished === 0).length;

  const total = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).total || 0), 0);
  const finished = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).finished || 0), 0);
  const manualFinished = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).manual_finished || 0), 0);
  const remaining = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).remaining_total || 0), 0);
  const assigned = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).remaining || 0), 0);
  const inProgress = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(getGroup(input.agg, label).in_progress || 0), 0);
  const criticalTotal = criticalLabels.reduce((sum, label) => sum + Number(getGroup(input.agg, label).total || 0), 0);
  const criticalFinished = criticalLabels.reduce((sum, label) => sum + Number(getGroup(input.agg, label).finished || 0), 0);
  const selectiveTotal = selectiveLabels.reduce((sum, label) => sum + Number(getGroup(input.agg, label).total || 0), 0);
  const selectiveFinished = selectiveLabels.reduce((sum, label) => sum + Number(getGroup(input.agg, label).finished || 0), 0);
  const uwuTotal = criticalLabels.reduce((sum, label) => sum + Number(getUwuGroup(input.uwu, label).total || 0), 0);
  const uwuLeft = criticalLabels.reduce((sum, label) => sum + Number(getUwuGroup(input.uwu, label).left || 0), 0);

  return {
    version: input.version,
    updatedAt: nowTs,
    total,
    finished,
    manualFinished,
    remaining,
    launches: input.alerts.length,
    assigned,
    inProgress,
    readinessAndroid,
    readinessIos,
    criticalTotal,
    criticalFinished,
    selectiveTotal,
    selectiveFinished,
    emptyAlerts,
    noPassedAlerts,
    uwuTotal,
    uwuLeft,
    activePeopleCount: Number(input.activePeopleCount || 0),
    activePeopleLogins: Array.isArray(input.activePeopleLogins) ? input.activePeopleLogins : [],
  };
}

function normalizeHistory(input: DashboardPredictionInput, current: DashboardHistoryPoint) {
  const history = (Array.isArray(input.history) ? input.history : [])
    .filter(item => item && item.version === input.version && isBusinessSnapshotHour(Number(item.updatedAt || 0)))
    .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0));
  const last = history[history.length - 1];
  if (!last) {
    return isBusinessSnapshotHour(current.updatedAt) ? [current] : [];
  }

  const sameShape =
    last.total === current.total &&
    last.finished === current.finished &&
    last.manualFinished === current.manualFinished &&
    last.remaining === current.remaining &&
    last.uwuLeft === current.uwuLeft &&
    last.emptyAlerts === current.emptyAlerts &&
    last.noPassedAlerts === current.noPassedAlerts;

  if (sameShape) {
    return history;
  }

  if (!isBusinessSnapshotHour(current.updatedAt)) {
    return history;
  }

  return [...history, current].sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0));
}

function getNextTuesdayDeadline(nowTs: number) {
  const deadline = new Date(nowTs);
  const currentDay = deadline.getDay();
  let offset = (2 - currentDay + 7) % 7;
  deadline.setHours(14, 0, 0, 0);

  if (offset === 0 && deadline.getTime() <= nowTs) {
    offset = 7;
  }

  deadline.setDate(deadline.getDate() + offset);
  deadline.setHours(14, 0, 0, 0);
  return deadline.getTime();
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
    catboostSessionVersion = storedVersion;
    catboostSessionPromise = null;
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

async function predictMlRisk(features: MlFeatureMap) {
  const ort = await getOrtModule();
  const session = await getCatboostSession();
  if (!ort || !session) return null;

  try {
    const inputName = session.inputNames?.[0] || 'features';
    const outputName = session.outputNames?.find(name => /prob/i.test(String(name))) || session.outputNames?.[1] || session.outputNames?.[0] || 'probability_tensor';
    const vector = ML_FEATURE_KEYS.map(key => Number(features[key] || 0));
    const tensor = new ort.Tensor('float32', Float32Array.from(vector), [1, ML_FEATURE_KEYS.length]);
    const outputs = await session.run({ [inputName]: tensor });
    const prob = extractProbability(outputs?.[outputName]);
    return prob == null ? null : clamp(Number(prob), 0, 1);
  } catch {
    return null;
  }
}

function buildForecastVelocity(
  current: DashboardHistoryPoint,
  recentRates: number[],
  observedVelocityPerHour: number | null,
  requiredPerHour: number | null
) {
  if (observedVelocityPerHour == null || observedVelocityPerHour <= 0.01) {
    return {
      forecastVelocityPerHour: null,
      readinessMin: Math.min(current.readinessAndroid || 0, current.readinessIos || 0),
      readinessGap: Math.abs(current.readinessAndroid - current.readinessIos),
      uwuLeftShare: current.uwuTotal > 0 ? current.uwuLeft / current.uwuTotal : 0,
      volatilityIndex: 1,
      forecastPenalty: 0,
    };
  }

  const recentWindow = recentRates.slice(-6);
  const stableMedian = median(recentWindow);
  const recentStd = std(recentWindow);
  const readinessMin = Math.min(current.readinessAndroid || 0, current.readinessIos || 0);
  const readinessGap = Math.abs(current.readinessAndroid - current.readinessIos);
  const uwuLeftShare = current.uwuTotal > 0 ? current.uwuLeft / current.uwuTotal : 0;
  const criticalCompletion = current.criticalTotal > 0 ? current.criticalFinished / current.criticalTotal : 1;
  const selectiveCompletion = current.selectiveTotal > 0 ? current.selectiveFinished / current.selectiveTotal : 1;

  const baseVelocity = observedVelocityPerHour * 0.68 + stableMedian * 0.32;
  const volatilityIndex = clamp(recentStd / Math.max(observedVelocityPerHour, 1), 0, 2.2);
  const volatilityPenalty = clamp(1 - volatilityIndex * 0.18, 0.68, 1);
  const readinessPenalty = clamp(
    1 -
      Math.max(0, 88 - readinessMin) / 170 -
      Math.max(0, readinessGap - 8) / 220,
    0.72,
    1.02
  );
  const alertPenalty = clamp(
    1 - Math.min(0.22, current.emptyAlerts * 0.018 + current.noPassedAlerts * 0.035),
    0.72,
    1
  );
  const uwuPenalty = clamp(1 - Math.min(0.16, uwuLeftShare * 0.28), 0.78, 1);
  const completionPenalty = clamp(
    1 -
      Math.max(0, 0.82 - criticalCompletion) * 0.32 -
      Math.max(0, 0.68 - selectiveCompletion) * 0.12,
    0.8,
    1
  );

  const recentLast = recentWindow[recentWindow.length - 1] || observedVelocityPerHour;
  const trendBoost =
    recentLast > observedVelocityPerHour && readinessMin >= 92 && current.noPassedAlerts === 0
      ? clamp(1 + Math.min(0.06, (recentLast / Math.max(observedVelocityPerHour, 0.1) - 1) * 0.14), 1, 1.06)
      : 1;

  let forecastPenalty = volatilityPenalty * readinessPenalty * alertPenalty * uwuPenalty * completionPenalty * trendBoost;
  if (requiredPerHour != null && requiredPerHour > 0 && observedVelocityPerHour < requiredPerHour) {
    forecastPenalty *= clamp(1 - Math.min(0.08, (requiredPerHour / Math.max(observedVelocityPerHour, 0.1) - 1) * 0.05), 0.88, 1);
  }

  forecastPenalty = clamp(forecastPenalty, 0.42, 1.06);

  return {
    forecastVelocityPerHour: Math.max(0.01, baseVelocity * forecastPenalty),
    readinessMin,
    readinessGap,
    uwuLeftShare,
    volatilityIndex,
    forecastPenalty,
  };
}

function buildFeatureMap(
  input: DashboardPredictionInput,
  history: DashboardHistoryPoint[],
  observedVelocityPerHour: number | null,
  forecastVelocityPerHour: number | null,
  requiredPerHour: number | null
): MlFeatureMap {
  const current = history[history.length - 1] || createCurrentHistoryPoint(input, input.nowTs || Date.now());
  const criticalRemaining = Math.max(0, current.criticalTotal - current.criticalFinished);
  const totalStats = buildSeriesStats(history.map(item => item.total));
  const criticalStats = buildSeriesStats(history.map(item => item.criticalFinished));
  const selectiveStats = buildSeriesStats(history.map(item => item.selectiveFinished));
  const readinessAvgStats = buildSeriesStats(history.map(item => (item.readinessAndroid + item.readinessIos) / 2));
  const perSnapshotFinishedDelta = history.slice(1).map((item, index) => {
    return Math.max(0, Number(item.manualFinished || 0) - Number(history[index].manualFinished || 0));
  });
  const criticalIos = getGroup(input.agg, '[iOS][High/Blocker]');
  const criticalAndroid = getGroup(input.agg, '[Android][High/Blocker]');
  const criticalIosPct = criticalIos.total > 0 ? (criticalIos.finished / criticalIos.total) * 100 : 0;
  const criticalAndroidPct = criticalAndroid.total > 0 ? (criticalAndroid.finished / criticalAndroid.total) * 100 : 0;
  const readinessGap = Math.abs(current.readinessAndroid - current.readinessIos);
  const uwuLeftShare = current.uwuTotal > 0 ? current.uwuLeft / current.uwuTotal : 0;

  const releaseAnoms = [
    Math.abs(totalStats.deltaPct) >= 5,
    totalStats.volatility >= Math.max(20, totalStats.last * 0.02),
    current.emptyAlerts > 0,
    current.noPassedAlerts > 0,
    criticalRemaining > 0 && forecastVelocityPerHour != null && requiredPerHour != null && forecastVelocityPerHour < requiredPerHour,
  ].filter(Boolean).length;

  const typeAnoms = [
    current.readinessAndroid < 90,
    current.readinessIos < 90,
    uwuLeftShare >= 0.12,
    criticalStats.delta < 0,
    selectiveStats.delta < 0,
  ].filter(Boolean).length;

  const platformAnoms = [
    readinessGap >= 12,
    Math.abs(criticalAndroidPct - criticalIosPct) >= 12,
    current.readinessAndroid < 80 || current.readinessIos < 80,
  ].filter(Boolean).length;

  return {
    tc_total: totalStats.last,
    tc_total_delta: totalStats.delta,
    tc_total_delta_pct: totalStats.deltaPct,
    tc_volatility: totalStats.volatility,
    tc_slope_pct: totalStats.slopePct,
    cov_swat_delta_pct: criticalStats.deltaPct,
    cov_stream_delta_pct: readinessAvgStats.deltaPct,
    sel_swat_delta_pct: selectiveStats.deltaPct,
    sel_stream_delta_pct: buildSeriesStats(history.map(item => item.assigned)).deltaPct,
    avg_total_delta: mean(perSnapshotFinishedDelta),
    chp_total_delta_pct: 0,
    chp_ios_delta_pct: 0,
    chp_android_delta_pct: 0,
    release_anoms: releaseAnoms,
    type_anoms: typeAnoms,
    platform_anoms: platformAnoms,
    anom_score: releaseAnoms + typeAnoms + platformAnoms,
  };
}

function buildHeuristicRisk(
  current: DashboardHistoryPoint,
  features: MlFeatureMap,
  observedVelocityPerHour: number | null,
  forecastVelocityPerHour: number | null,
  requiredPerHour: number | null,
  deadlineHoursLeft: number,
  forecastPenalty: number
) {
  const criticalRemaining = Math.max(0, current.criticalTotal - current.criticalFinished);
  if (criticalRemaining <= 0) return 0.02;
  if (deadlineHoursLeft <= 0) return 0.99;

  const readinessMin = Math.min(current.readinessAndroid || 0, current.readinessIos || 0);
  const readinessGap = Math.abs(current.readinessAndroid - current.readinessIos);
  const uwuLeftShare = current.uwuTotal > 0 ? current.uwuLeft / current.uwuTotal : 0;

  let risk = 0.14;

  if (forecastVelocityPerHour == null || forecastVelocityPerHour <= 0.01) {
    risk += 0.52;
  } else if (requiredPerHour != null && requiredPerHour > 0) {
    const rateRatio = requiredPerHour / forecastVelocityPerHour;
    if (rateRatio > 1) {
      risk += clamp((rateRatio - 1) * 0.38, 0, 0.5);
    } else {
      risk -= clamp((1 - rateRatio) * 0.08, 0, 0.08);
    }
  }

  if (
    observedVelocityPerHour != null &&
    forecastVelocityPerHour != null &&
    forecastVelocityPerHour < observedVelocityPerHour * 0.92
  ) {
    risk += clamp((1 - forecastPenalty) * 0.14, 0, 0.14);
  }

  risk += Math.min(0.18, current.emptyAlerts * 0.025 + current.noPassedAlerts * 0.05);
  risk += Math.min(0.12, Math.max(0, 90 - readinessMin) / 100);
  risk += Math.min(0.08, readinessGap / 100);
  risk += Math.min(0.1, uwuLeftShare * 0.1);
  if (features.tc_total_delta_pct >= 5) risk += 0.05;
  if (features.tc_volatility >= Math.max(20, current.total * 0.02)) risk += 0.05;
  if (features.anom_score >= 3) risk += 0.04;

  return clamp(risk, 0.02, 0.98);
}

function buildReasons(
  current: DashboardHistoryPoint,
  observedVelocityPerHour: number | null,
  forecastVelocityPerHour: number | null,
  requiredPerHour: number | null,
  projectedCriticalRemainingByDeadline: number,
  projectedSelectiveRemainingByDeadline: number,
  mlRisk: number | null,
  etaTs: number | null,
  deadlineTs: number
) {
  const reasons: string[] = [];
  const criticalRemaining = Math.max(0, current.criticalTotal - current.criticalFinished);
  const uwuLeftShare = current.uwuTotal > 0 ? (current.uwuLeft / current.uwuTotal) * 100 : 0;

  if (criticalRemaining <= 0) {
    reasons.push('High / Blocker уже закрыты, поэтому дедлайн по критичным проверкам выглядит подтверждённым.');
    return reasons;
  }

  if (forecastVelocityPerHour == null || forecastVelocityPerHour <= 0.01) {
    reasons.push('Истории недостаточно для стабильного ручного темпа, поэтому прогноз опирается на текущие сигналы и остаток ручных проверок.');
  } else if (
    observedVelocityPerHour != null &&
    forecastVelocityPerHour < observedVelocityPerHour * 0.93
  ) {
    reasons.push(
      `Наблюдаемый ручной темп около ${observedVelocityPerHour.toFixed(1)} кейса/ч, но прогнозный снижен до ${forecastVelocityPerHour.toFixed(1)} кейса/ч из-за операционных сигналов.`
    );
  } else if (requiredPerHour != null && requiredPerHour > forecastVelocityPerHour) {
    reasons.push(`Прогнозный ручной темп ниже нужного: около ${forecastVelocityPerHour.toFixed(1)} кейса/ч против требуемых ${requiredPerHour.toFixed(1)} кейса/ч.`);
  } else if (requiredPerHour != null) {
    reasons.push(`Прогнозный ручной темп выглядит достаточным: около ${forecastVelocityPerHour.toFixed(1)} кейса/ч при требуемых ${requiredPerHour.toFixed(1)} кейса/ч.`);
  }

  if (projectedCriticalRemainingByDeadline > 0) {
    reasons.push(`Если ручной темп не ускорится, к дедлайну останется около ${Math.round(projectedCriticalRemainingByDeadline).toLocaleString('ru-RU')} High / Blocker кейсов.`);
  } else {
    reasons.push('По текущему ручному темпу High / Blocker укладываются в окно до дедлайна.');
  }

  if (projectedSelectiveRemainingByDeadline > 0) {
    reasons.push(`Selective могут остаться в хвосте: около ${Math.round(projectedSelectiveRemainingByDeadline).toLocaleString('ru-RU')} кейсов после дедлайна по HB.`);
  }

  if (etaTs != null && etaTs > deadlineTs) {
    reasons.push('Ориентировочное окончание выходит за дедлайн, поэтому прогноз автоматически усиливает риск срыва.');
  }

  if (current.noPassedAlerts > 0 || current.emptyAlerts > 0) {
    reasons.push(`Есть проблемные launch: пустых ${current.emptyAlerts}, без passed ${current.noPassedAlerts}.`);
  }

  if (uwuLeftShare >= 12) {
    reasons.push(`В хвосте остаётся заметный UwU-объём: ${Math.round(uwuLeftShare)}% от критичных проверок.`);
  }

  if (mlRisk != null) {
    reasons.push(`CatBoost даёт риск срыва около ${Math.round(mlRisk * 100)}%, но итоговый вывод дополнительно проверяется ETA и текущими алертами.`);
  }

  return reasons.slice(0, 4);
}

export async function buildDashboardPrediction(input: DashboardPredictionInput): Promise<DashboardPrediction> {
  const nowTs = Number(input.nowTs || Date.now());
  const current = createCurrentHistoryPoint(input, nowTs);
  const history = normalizeHistory(input, current);
  const deadlineTs = input.customDeadlineTs || getNextTuesdayDeadline(nowTs);
  const hoursToDeadline = Math.max(0, (deadlineTs - nowTs) / 3_600_000);
  // Темп для ETA считаем только по ручному прохождению и только по дневным срезам:
  // ночные значения 22:00–10:00 по МСК не должны искажать картину.
  // Минимальный интервал 1 ч: более короткие срезы дают аномальный темп из-за шума API.
  const totalTests = Math.max(
    current.criticalTotal + current.selectiveTotal,
    current.total || 1
  );
  const maxPlausibleRate = totalTests / 6; // физически нельзя пройти всё быстрее, чем за 6 ч

  // When there are few history snapshots, inject a synthetic zero-point at launch creation
  // so we can calculate velocity from (completedCases / timeSinceLaunch).
  const effectiveHistory = (() => {
    const launchTs = Number(input.launchCreatedTs || 0);
    if (history.length >= 2 || !launchTs) return history;
    const dtFromLaunch = (nowTs - launchTs) / 3_600_000;
    // Only use if launch started ≥1h ago and has meaningful completed cases
    if (dtFromLaunch < 1.0 || current.manualFinished < 1) return history;
    const syntheticZero: DashboardHistoryPoint = {
      ...current,
      updatedAt: launchTs,
      finished: 0,
      manualFinished: 0,
      remaining: current.total,
      inProgress: 0,
    };
    return [syntheticZero, ...history];
  })();

  const recentRates = effectiveHistory.slice(1).map((point, index) => {
    const prev = effectiveHistory[index];
    const dtHours = (Number(point.updatedAt || 0) - Number(prev.updatedAt || 0)) / 3_600_000;
    if (!Number.isFinite(dtHours) || dtHours < 1.0) return null;
    const delta = Math.max(0, Number(point.manualFinished || 0) - Number(prev.manualFinished || 0));
    const rate = delta / dtHours;
    return rate > maxPlausibleRate ? null : rate;
  }).filter((rate): rate is number => rate !== null && Number.isFinite(rate));

  const observedVelocityPerHour = recentRates.length ? weightedMean(recentRates.slice(-6)) : null;
  const criticalRemaining = Math.max(0, current.criticalTotal - current.criticalFinished);
  const selectiveRemaining = Math.max(0, current.selectiveTotal - current.selectiveFinished);
  const requiredPerHour = criticalRemaining > 0 && hoursToDeadline > 0 ? criticalRemaining / hoursToDeadline : 0;
  const {
    forecastVelocityPerHour,
    volatilityIndex,
    forecastPenalty,
  } = buildForecastVelocity(current, recentRates, observedVelocityPerHour, requiredPerHour);
  const manualCapacityByDeadline = Math.max(0, Number(forecastVelocityPerHour || 0)) * hoursToDeadline;
  const criticalDoneGain = Math.min(criticalRemaining, manualCapacityByDeadline);
  const projectedCriticalFinishedByDeadline = Math.min(current.criticalTotal, current.criticalFinished + criticalDoneGain);
  const projectedCriticalRemainingByDeadline = Math.max(0, current.criticalTotal - projectedCriticalFinishedByDeadline);
  const selectiveCapacity = Math.max(0, manualCapacityByDeadline - criticalDoneGain);
  const selectiveDoneGain = Math.min(selectiveRemaining, selectiveCapacity);
  const projectedSelectiveFinishedByDeadline = Math.min(current.selectiveTotal, current.selectiveFinished + selectiveDoneGain);
  const projectedSelectiveRemainingByDeadline = Math.max(0, current.selectiveTotal - projectedSelectiveFinishedByDeadline);
  const projectedFinishedByDeadline = projectedCriticalFinishedByDeadline + projectedSelectiveFinishedByDeadline;
  const projectedRemainingByDeadline = projectedCriticalRemainingByDeadline + projectedSelectiveRemainingByDeadline;
  const etaTs = criticalRemaining <= 0
    ? nowTs
    : (forecastVelocityPerHour && forecastVelocityPerHour > 0.01
        ? nowTs + (criticalRemaining / forecastVelocityPerHour) * 3_600_000
        : null);
  const leadHours = etaTs == null ? null : (deadlineTs - etaTs) / 3_600_000;
  const featureHistory = history.length ? history : [current];
  const features = buildFeatureMap(input, featureHistory, observedVelocityPerHour, forecastVelocityPerHour, requiredPerHour);
  const heuristicRisk = buildHeuristicRisk(
    current,
    features,
    observedVelocityPerHour,
    forecastVelocityPerHour,
    requiredPerHour,
    hoursToDeadline,
    forecastPenalty
  );
  const mlRisk = await predictMlRisk(features);
  const risk = mlRisk == null
    ? heuristicRisk
    : clamp(mlRisk * 0.68 + heuristicRisk * 0.32, 0.02, 0.98);
  const confidence = clamp(
    0.34 +
      Math.min(0.2, Math.max(0, history.length - 1) * 0.06) +
      (observedVelocityPerHour != null ? 0.1 : 0) +
      (mlRisk != null ? 0.16 : 0) +
      Math.max(0, 0.14 - volatilityIndex * 0.08),
    0.3,
    0.92
  );

  // ── People-aware historical forecast ──────────────────────────────────────
  const gasConfig: GasConfig = input.gasConfig ?? { gasUrl: '' };
  const allRuns = await loadRegressionRuns(gasConfig);
  const historicalBaseline = computeRegressionBaseline(allRuns);

  // Auto-detect people count: Allure memberstats → weekday historical median → 1
  const fromAllure = current.activePeopleCount > 0 ? current.activePeopleCount : null;
  const fromHistory = fromAllure == null ? (expectedPeopleCountForToday(historicalBaseline) ?? null) : null;
  const peopleCount = Math.max(1, Math.round(fromAllure ?? fromHistory ?? 1));
  const peopleCountSource: DashboardPrediction['peopleCountSource'] =
    fromAllure != null ? 'allure' : fromHistory != null ? 'history' : 'default';

  const historicalVelocityPerHour = forecastVelocityWithPeople(historicalBaseline, peopleCount);

  // Blend observed (current run) with historical: observed wins when we have ≥3 rate samples,
  // historical anchors early in the run or when observed is missing.
  const blendedForecastVelocity = (() => {
    if (historicalVelocityPerHour == null) return forecastVelocityPerHour;
    if (forecastVelocityPerHour == null) return historicalVelocityPerHour;
    const observedWeight = Math.min(0.75, recentRates.length * 0.15);
    return forecastVelocityPerHour * observedWeight + historicalVelocityPerHour * (1 - observedWeight);
  })();

  const effectiveForecast = blendedForecastVelocity ?? forecastVelocityPerHour;
  const requiredPeopleForDeadline = requiredPerHour != null && requiredPerHour > 0
    ? requiredPeopleForVelocity(historicalBaseline, requiredPerHour)
    : null;

  // ── Auto-record completed runs ─────────────────────────────────────────────
  // Use raw (unfiltered) history so night-time completions aren't blocked by the
  // business-hours filter that normalizeHistory applies for velocity calculations.
  const rawVersionHistory = (Array.isArray(input.history) ? input.history : [])
    .filter((h): h is DashboardHistoryPoint => !!(h && h.version === input.version))
    .sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));

  if (criticalRemaining <= 0 && current.criticalTotal > 0 && rawVersionHistory.length >= 1) {
    const runStart = rawVersionHistory[0];
    const startTs = Number(runStart.updatedAt || 0);
    const durationHours = (nowTs - startTs) / 3_600_000;
    // Stable ID based on startTs so repeated refreshes don't create duplicates
    const alreadyRecorded = allRuns.some(r => r.version === input.version && r.startTs === startTs);
    if (durationHours >= 0.5 && !alreadyRecorded) {
      const dailyPeopleDistribution = buildDailyPeopleDistribution(
        [...rawVersionHistory, current].map(h => ({
          updatedAt: h.updatedAt,
          activePeopleCount: h.activePeopleCount,
          activePeopleLogins: h.activePeopleLogins,
        }))
      );
      const rec: RegressionRunRecord = {
        id: buildRegressionRunId(input.version, 'all', startTs),
        version: input.version,
        platform: 'all',
        startTs,
        endTs: nowTs,
        totalCases: current.criticalTotal,
        finishedCases: current.criticalFinished,
        durationHours,
        peopleCount,
        velocityPerHour: current.criticalTotal / durationHours,
        velocityPerPersonPerHour: current.criticalTotal / durationHours / peopleCount,
        dailyPeopleDistribution,
      };
      await saveRegressionRun(gasConfig, rec);
    }
  }

  let status: DashboardPrediction['status'] = 'at_risk';
  if (criticalRemaining <= 0) {
    status = 'done';
  } else if (etaTs == null || hoursToDeadline <= 0 || projectedCriticalRemainingByDeadline > 0 || risk >= 0.65) {
    status = 'off_track';
  } else if (risk < 0.4 && leadHours != null && leadHours >= 0) {
    status = 'on_track';
  }

  return {
    deadlineTs,
    etaTs: criticalRemaining <= 0
      ? nowTs
      : (effectiveForecast && effectiveForecast > 0.01
          ? nowTs + (criticalRemaining / effectiveForecast) * 3_600_000
          : etaTs),
    status,
    engine: mlRisk == null ? 'operational' : 'catboost+operational',
    risk,
    mlRisk,
    heuristicRisk,
    confidence,
    observedVelocityPerHour,
    forecastVelocityPerHour: effectiveForecast,
    requiredPerHour,
    projectedRemainingByDeadline,
    projectedFinishedByDeadline,
    projectedCriticalRemainingByDeadline,
    projectedSelectiveRemainingByDeadline,
    leadHours,
    features,
    reasons: buildReasons(
      current,
      observedVelocityPerHour,
      effectiveForecast,
      requiredPerHour,
      projectedCriticalRemainingByDeadline,
      projectedSelectiveRemainingByDeadline,
      mlRisk,
      etaTs,
      deadlineTs
    ),
    peopleCount,
    peopleCountSource,
    historicalBaseline,
    historicalVelocityPerHour,
    requiredPeopleForDeadline,
  };
}
