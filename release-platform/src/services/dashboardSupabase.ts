import type {
  DashboardAlertEntry,
  DashboardGroupCounts,
  DashboardGroupLabel,
  DashboardUwuCounts,
  ReadinessLaunchSummary,
} from './allure';
import type { DashboardHistoryPoint, DashboardPrediction } from './releasePrediction';
import type { AllureLaunchResult } from '../types';

import { STORAGE_REST_URL, storageHeaders } from './storageRest';

const DASHBOARD_TABLE = 'dashboard_snapshots';

interface DashboardSnapshotRecord {
  id?: unknown;
  version?: unknown;
  snapshot_at?: unknown;
  history_point?: unknown;
  aggregate_payload?: unknown;
  uwu_payload?: unknown;
  readiness_payload?: unknown;
  launches_payload?: unknown;
  alerts_payload?: unknown;
  prediction_payload?: unknown;
}

export interface DashboardSnapshotInput {
  projectId: string;
  version: string;
  snapshot: DashboardHistoryPoint;
  previousSnapshot?: DashboardHistoryPoint | null;
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>;
  readiness: ReadinessLaunchSummary[];
  launches: AllureLaunchResult[];
  alerts: DashboardAlertEntry[];
  prediction: DashboardPrediction | null;
  source?: string;
}

export interface DashboardStoredSnapshot {
  id: string | null;
  version: string;
  snapshotAt: number;
  historyPoint: DashboardHistoryPoint;
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>;
  readiness: ReadinessLaunchSummary[];
  launches: AllureLaunchResult[];
  alerts: DashboardAlertEntry[];
  prediction: DashboardPrediction | null;
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function ratioPct(done: number, total: number) {
  return total > 0 ? clampPct((done / total) * 100) : 0;
}

function isoFromTs(ts?: number | null) {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeHistoryPoint(raw: unknown): DashboardHistoryPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<DashboardHistoryPoint>;
  const version = String(value.version || '').trim();
  const updatedAt = numberValue(value.updatedAt);
  if (!version || updatedAt <= 0) return null;

  return {
    version,
    updatedAt,
    total: numberValue(value.total),
    finished: numberValue(value.finished),
    manualFinished: numberValue(value.manualFinished),
    manualTimedFinished: numberValue(value.manualTimedFinished),
    manualWindowStartTs: value.manualWindowStartTs == null ? null : numberValue(value.manualWindowStartTs),
    manualWindowStopTs: value.manualWindowStopTs == null ? null : numberValue(value.manualWindowStopTs),
    remaining: numberValue(value.remaining),
    launches: numberValue(value.launches),
    assigned: numberValue(value.assigned),
    inProgress: numberValue(value.inProgress),
    readinessAndroid: numberValue(value.readinessAndroid),
    readinessIos: numberValue(value.readinessIos),
    criticalTotal: numberValue(value.criticalTotal),
    criticalFinished: numberValue(value.criticalFinished),
    selectiveTotal: numberValue(value.selectiveTotal),
    selectiveFinished: numberValue(value.selectiveFinished),
    emptyAlerts: numberValue(value.emptyAlerts),
    noPassedAlerts: numberValue(value.noPassedAlerts),
    uwuTotal: numberValue(value.uwuTotal),
    uwuLeft: numberValue(value.uwuLeft),
    activePeopleCount: numberValue(value.activePeopleCount),
    activePeopleLogins: asArray(value.activePeopleLogins).map(item => String(item || '').trim()).filter(Boolean),
  };
}

function pointFromRecord(record: DashboardSnapshotRecord): DashboardHistoryPoint | null {
  const point = sanitizeHistoryPoint(record.history_point);
  if (point) return point;
  const version = String(record.version || '').trim();
  const snapshotAt = Date.parse(String(record.snapshot_at || ''));
  if (!version || !Number.isFinite(snapshotAt)) return null;
  return sanitizeHistoryPoint({ version, updatedAt: snapshotAt });
}

function storedSnapshotFromRecord(record: DashboardSnapshotRecord): DashboardStoredSnapshot | null {
  const historyPoint = pointFromRecord(record);
  if (!historyPoint) return null;
  const snapshotAt = Date.parse(String(record.snapshot_at || ''));
  return {
    id: record.id ? String(record.id) : null,
    version: String(record.version || historyPoint.version || '').trim(),
    snapshotAt: Number.isFinite(snapshotAt) ? snapshotAt : historyPoint.updatedAt,
    historyPoint,
    agg: asRecord(record.aggregate_payload) as Record<DashboardGroupLabel, DashboardGroupCounts>,
    uwu: asRecord(record.uwu_payload) as Record<DashboardGroupLabel, DashboardUwuCounts>,
    readiness: asArray(record.readiness_payload) as ReadinessLaunchSummary[],
    launches: asArray(record.launches_payload) as AllureLaunchResult[],
    alerts: asArray(record.alerts_payload) as DashboardAlertEntry[],
    prediction: Object.keys(asRecord(record.prediction_payload)).length
      ? record.prediction_payload as unknown as DashboardPrediction
      : null,
  };
}

function sortHistory(points: DashboardHistoryPoint[], limit: number) {
  const unique = new Map<string, DashboardHistoryPoint>();
  points.forEach(point => {
    unique.set(`${point.version}:${point.updatedAt}`, point);
  });
  return [...unique.values()]
    .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0))
    .slice(-limit);
}

function buildTrackingPayload(snapshot: DashboardHistoryPoint, previous?: DashboardHistoryPoint | null) {
  const totalDelta = previous ? snapshot.total - previous.total : null;
  const finishedDelta = previous ? snapshot.finished - previous.finished : null;
  const remainingDelta = previous ? snapshot.remaining - previous.remaining : null;
  const manualDelta = previous ? snapshot.manualFinished - previous.manualFinished : null;
  const elapsedHours = previous && snapshot.updatedAt > previous.updatedAt
    ? (snapshot.updatedAt - previous.updatedAt) / 3_600_000
    : null;
  const manualVelocityPerHour = elapsedHours && elapsedHours > 0 && manualDelta != null
    ? Math.max(0, manualDelta) / elapsedHours
    : null;

  return {
    previousUpdatedAt: previous?.updatedAt ?? null,
    totalDelta,
    finishedDelta,
    remainingDelta,
    manualDelta,
    elapsedHours,
    manualVelocityPerHour,
    completionPct: ratioPct(snapshot.finished, snapshot.total),
    manualCompletionPct: ratioPct(snapshot.manualFinished, snapshot.total),
    criticalCompletionPct: ratioPct(snapshot.criticalFinished, snapshot.criticalTotal),
    selectiveCompletionPct: ratioPct(snapshot.selectiveFinished, snapshot.selectiveTotal),
    readinessMinPct: clampPct(Math.min(snapshot.readinessAndroid || 0, snapshot.readinessIos || 0)),
    readinessGapPct: clampPct(Math.abs((snapshot.readinessAndroid || 0) - (snapshot.readinessIos || 0))),
    alerts: {
      empty: snapshot.emptyAlerts,
      noPassed: snapshot.noPassedAlerts,
    },
    uwu: {
      total: snapshot.uwuTotal,
      left: snapshot.uwuLeft,
    },
  };
}

function buildEnrichmentPayload(input: DashboardSnapshotInput) {
  const tracking = buildTrackingPayload(input.snapshot, input.previousSnapshot);
  return {
    generatedAt: new Date().toISOString(),
    source: input.source || 'dashboard',
    tracking,
    prediction: input.prediction
      ? {
          status: input.prediction.status,
          risk: input.prediction.risk,
          confidence: input.prediction.confidence,
          etaTs: input.prediction.etaTs,
          deadlineTs: input.prediction.deadlineTs,
          peopleCount: input.prediction.peopleCount,
          peopleCountSource: input.prediction.peopleCountSource,
          engine: input.prediction.engine,
        }
      : null,
  };
}

function snapshotRow(input: DashboardSnapshotInput) {
  const { snapshot, prediction } = input;
  const tracking = buildTrackingPayload(snapshot, input.previousSnapshot);
  const enrichment = buildEnrichmentPayload(input);

  return {
    project_id: String(input.projectId || '').trim() || '7',
    version: input.version,
    snapshot_at: isoFromTs(snapshot.updatedAt),
    source: input.source || 'dashboard',

    total_cases: snapshot.total,
    finished_cases: snapshot.finished,
    manual_finished_cases: snapshot.manualFinished,
    manual_timed_finished_cases: snapshot.manualTimedFinished,
    remaining_cases: snapshot.remaining,
    assigned_cases: snapshot.assigned,
    in_progress_cases: snapshot.inProgress,
    launches_count: snapshot.launches,
    active_people_count: snapshot.activePeopleCount,
    active_people_logins: snapshot.activePeopleLogins,

    readiness_android: clampPct(snapshot.readinessAndroid),
    readiness_ios: clampPct(snapshot.readinessIos),
    critical_total: snapshot.criticalTotal,
    critical_finished: snapshot.criticalFinished,
    selective_total: snapshot.selectiveTotal,
    selective_finished: snapshot.selectiveFinished,
    uwu_total: snapshot.uwuTotal,
    uwu_left: snapshot.uwuLeft,
    empty_alerts: snapshot.emptyAlerts,
    no_passed_alerts: snapshot.noPassedAlerts,

    completion_pct: tracking.completionPct,
    manual_completion_pct: tracking.manualCompletionPct,
    critical_completion_pct: tracking.criticalCompletionPct,
    selective_completion_pct: tracking.selectiveCompletionPct,
    readiness_min_pct: tracking.readinessMinPct,
    readiness_gap_pct: tracking.readinessGapPct,

    prediction_status: prediction?.status ?? null,
    prediction_risk: prediction?.risk ?? null,
    prediction_confidence: prediction?.confidence ?? null,
    eta_at: isoFromTs(prediction?.etaTs ?? null),
    deadline_at: isoFromTs(prediction?.deadlineTs ?? null),

    history_point: snapshot,
    aggregate_payload: input.agg,
    uwu_payload: input.uwu,
    readiness_payload: input.readiness,
    launches_payload: input.launches,
    alerts_payload: input.alerts,
    prediction_payload: prediction || {},
    enrichment_payload: enrichment,
    tracking_payload: tracking,
  };
}

const headers = storageHeaders;

async function assertOk(response: Response, operation: string) {
  if (response.ok) return;
  const body = await response.text().catch(() => '');
  throw new Error(`Supabase dashboard ${operation}: HTTP ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 240)}` : ''}`);
}

export async function loadDashboardSnapshotHistory(version: string, projectId: string, limit = 48) {
  const query = new URLSearchParams({
    select: 'id,version,snapshot_at,history_point',
    version: `eq.${version}`,
    project_id: `eq.${String(projectId || '').trim() || '7'}`,
    order: 'snapshot_at.desc',
    limit: String(Math.max(1, Math.min(240, limit))),
  });
  const response = await fetch(`${STORAGE_REST_URL}/${DASHBOARD_TABLE}?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select history');
  const payload = await response.json();
  return sortHistory(
    (Array.isArray(payload) ? payload : [])
      .map(pointFromRecord)
      .filter((item): item is DashboardHistoryPoint => Boolean(item)),
    limit,
  );
}

export async function loadLatestDashboardSnapshot(version: string, projectId: string) {
  const query = new URLSearchParams({
    select: [
      'id',
      'version',
      'snapshot_at',
      'history_point',
      'aggregate_payload',
      'uwu_payload',
      'readiness_payload',
      'launches_payload',
      'alerts_payload',
      'prediction_payload',
    ].join(','),
    version: `eq.${version}`,
    project_id: `eq.${String(projectId || '').trim() || '7'}`,
    order: 'snapshot_at.desc',
    limit: '1',
  });
  const response = await fetch(`${STORAGE_REST_URL}/${DASHBOARD_TABLE}?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select latest snapshot');
  const payload = await response.json();
  const record = Array.isArray(payload) ? payload[0] as DashboardSnapshotRecord | undefined : undefined;
  return record ? storedSnapshotFromRecord(record) : null;
}

export async function saveDashboardSnapshot(input: DashboardSnapshotInput) {
  const response = await fetch(`${STORAGE_REST_URL}/${DASHBOARD_TABLE}`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(snapshotRow(input)),
  });
  await assertOk(response, 'insert snapshot');
  const payload = await response.json().catch(() => []);
  const inserted = Array.isArray(payload) ? payload[0] as DashboardSnapshotRecord | undefined : undefined;
  const history = await loadDashboardSnapshotHistory(input.version, input.projectId, 48).catch(() => []);
  return {
    id: inserted?.id ? String(inserted.id) : null,
    history: history.length ? history : sortHistory([input.snapshot], 48),
  };
}

export async function loadAvailableDashboardVersions(projectId: string, limit = 120) {
  const query = new URLSearchParams({
    select: 'version',
    project_id: `eq.${String(projectId || '').trim() || '7'}`,
    order: 'snapshot_at.desc',
    limit: String(Math.max(1, Math.min(240, limit))),
  });
  const response = await fetch(`${STORAGE_REST_URL}/${DASHBOARD_TABLE}?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select versions');
  const payload = await response.json();
  return Array.from(new Set(
    (Array.isArray(payload) ? payload : [])
      .map(record => String((record as DashboardSnapshotRecord).version || '').trim())
      .filter(Boolean),
  ));
}
