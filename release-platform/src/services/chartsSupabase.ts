import type {
  ChartsMlDatasetEntry,
  ChartsMlFeatures,
  ChartsReleaseSnapshotPayload,
  ChartsReport,
} from './charts';

const SUPABASE_URL = 'https://hjlnudkbdhovoaxglkmq.supabase.co';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5FDmZ6-2PIyW3qo6IeYuAg_p20zTP_M';

type CompareMode = 'mean' | 'prev';

interface ChartsReportRecord {
  id?: unknown;
  report_payload?: unknown;
}

interface ChartsReleaseSnapshotRecord {
  release?: unknown;
  snapshot_payload?: unknown;
}

function headers(prefer?: string) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function assertOk(response: Response, operation: string) {
  if (response.ok) return;
  const body = await response.text().catch(() => '');
  throw new Error(`Supabase charts ${operation}: HTTP ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 240)}` : ''}`);
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function probability(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function riskPctFromProbability(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric * 10000) / 100)) : null;
}

function reportFromPayload(value: unknown): ChartsReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<ChartsReport>;
  return Array.isArray(report.releases) && Array.isArray(report.metrics) ? report as ChartsReport : null;
}

function releaseSnapshotFromPayload(value: unknown): ChartsReleaseSnapshotPayload | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<ChartsReleaseSnapshotPayload>;
  return snapshot.schemaVersion === 1 && typeof snapshot.release === 'string' ? snapshot as ChartsReleaseSnapshotPayload : null;
}

function latestByRelease<T extends { release: string }>(rows: T[] | undefined, release: string): T | null {
  if (!Array.isArray(rows) || !release) return null;
  return rows.find(row => row.release === release) || rows[rows.length - 1] || null;
}

function sumDowntimeMinutes(rows: Array<{ release: string; totalMinutes: number }> | undefined, release: string) {
  const row = latestByRelease(rows, release);
  return numberValue(row?.totalMinutes);
}

function reportRow(report: ChartsReport, projectId: string, releaseFrom: string, releaseTo: string, compareMode: CompareMode) {
  const releases = report.releases || [];
  const currentRelease = releases[releases.length - 1] || '';
  const previousRelease = releases[releases.length - 2] || '';
  const currentMetric = latestByRelease(report.metrics, currentRelease);
  const currentCoverage = latestByRelease(report.coverageRows, currentRelease);
  const currentSelective = latestByRelease(report.selectiveRows, currentRelease);
  const currentAvg = latestByRelease(report.avgRows, currentRelease);
  const currentChp = latestByRelease(report.chpRows, currentRelease);
  const iosDowntime = sumDowntimeMinutes(report.devDowntime?.iosByRelease, currentRelease);
  const androidDowntime = sumDowntimeMinutes(report.devDowntime?.androidByRelease, currentRelease);
  const activeProbability = report.ml?.prediction?.activeProbability;

  return {
    project_id: String(projectId || '').trim() || '7',
    release_from: releaseFrom,
    release_to: releaseTo,
    compare_mode: compareMode,
    source: 'charts',
    collected_at: new Date().toISOString(),

    releases,
    release_count: releases.length,
    current_release: currentRelease || null,
    previous_release: previousRelease || null,
    base_releases: report.aiContext?.releaseWindow?.baseReleases || [],

    tc_total: numberValue(currentMetric?.tc_total),
    tc_manual: numberValue(currentMetric?.tc_manual),
    tc_auto: numberValue(currentMetric?.tc_auto),
    coverage_total: numberValue(currentCoverage?.total),
    coverage_swat_count: numberValue(currentCoverage?.swatCount),
    coverage_stream_count: numberValue(currentCoverage?.streamCount),
    selective_total: numberValue(currentSelective?.total),
    selective_swat_count: numberValue(currentSelective?.swatCount),
    selective_stream_count: numberValue(currentSelective?.streamCount),
    avg_total_ms: probability(currentAvg?.totalMs),
    avg_weighted_ms: probability(currentAvg?.totalWeighted),
    chp_ios: numberValue(currentChp?.ios),
    chp_android: numberValue(currentChp?.android),
    chp_total: numberValue(currentChp?.total),
    dev_downtime_ios_minutes: iosDowntime,
    dev_downtime_android_minutes: androidDowntime,
    dev_downtime_total_minutes: iosDowntime + androidDowntime,

    ml_engine: report.ml?.prediction?.engine || null,
    ml_risk_pct: riskPctFromProbability(activeProbability),
    ml_linear_probability: probability(report.ml?.prediction?.linearProbability),
    ml_catboost_probability: probability(report.ml?.prediction?.catboostProbability),
    ml_labeled_samples: numberValue(report.ml?.prediction?.labeledSamples),
    ml_dataset_quality: report.ml?.prediction?.datasetQuality || null,
    ml_helper_online: typeof report.ml?.helperHealth?.online === 'boolean' ? report.ml.helperHealth.online : null,
    ml_helper_busy: typeof report.ml?.helperHealth?.busy === 'boolean' ? report.ml.helperHealth.busy : null,

    anomaly_score: numberValue(report.anomalies?.score),
    anomaly_release_count: numberValue(report.anomalies?.release?.count),
    anomaly_type_count: numberValue(report.anomalies?.type?.count),
    anomaly_platform_count: numberValue(report.anomalies?.platform?.count),

    metrics_payload: report.metrics || [],
    tc_rows_payload: report.tcRows || [],
    coverage_rows_payload: report.coverageRows || [],
    selective_rows_payload: report.selectiveRows || [],
    avg_rows_payload: report.avgRows || [],
    chp_rows_payload: report.chpRows || [],
    dev_downtime_payload: report.devDowntime || {},
    timings_payload: report.timings || [],
    task_types_payload: report.taskTypes || {},
    chp_types_payload: report.chpTypes || {},
    chp_quarter_stats_payload: report.chpQuarterStats || null,
    stream_insights_payload: report.streamInsights || {},
    stream_delta_rows_payload: report.streamDeltaRows || [],
    anomalies_payload: report.anomalies || {},
    ml_payload: report.ml || {},
    ai_context_payload: report.aiContext || {},
    report_payload: report,
  };
}

function metricRows(reportId: string, report: ChartsReport, projectId: string) {
  return (report.metrics || []).map((metric, index) => ({
    report_id: reportId,
    project_id: String(projectId || '').trim() || '7',
    release: metric.release,
    release_index: index,
    tc_total: numberValue(metric.tc_total),
    tc_manual: numberValue(metric.tc_manual),
    tc_auto: numberValue(metric.tc_auto),
    tc_total_delta: numberValue(metric.tc_total_delta),
    tc_total_delta_pct: numberValue(metric.tc_total_delta_pct),
    tc_volatility: numberValue(metric.tc_volatility),
    tc_slope_pct: numberValue(metric.tc_slope_pct),
    cov_swat: numberValue(metric.cov_swat),
    cov_stream: numberValue(metric.cov_stream),
    cov_swat_delta_pct: numberValue(metric.cov_swat_delta_pct),
    cov_stream_delta_pct: numberValue(metric.cov_stream_delta_pct),
    sel_swat: numberValue(metric.sel_swat),
    sel_stream: numberValue(metric.sel_stream),
    sel_swat_delta_pct: numberValue(metric.sel_swat_delta_pct),
    sel_stream_delta_pct: numberValue(metric.sel_stream_delta_pct),
    avg_total_delta: numberValue(metric.avg_total_delta),
    avg_total: numberValue(metric.avg_total),
    avg_weighted: numberValue(metric.avg_weighted),
    chp_total: numberValue(metric.chp_total),
    chp_prod: numberValue(metric.chp_prod),
    chp_bug: numberValue(metric.chp_bug),
    chp_crash: numberValue(metric.chp_crash),
    chp_vlet: numberValue(metric.chp_vlet),
    chp_total_delta: numberValue(metric.chp_total_delta),
    chp_ios: numberValue(metric.chp_ios),
    chp_android: numberValue(metric.chp_android),
    chp_ios_delta_pct: numberValue(metric.chp_ios_delta_pct),
    chp_android_delta_pct: numberValue(metric.chp_android_delta_pct),
    anom_score: numberValue(metric.anom_score),
    release_anoms: numberValue(metric.release_anoms),
    type_anoms: numberValue(metric.type_anoms),
    platform_anoms: numberValue(metric.platform_anoms),
    ml_risk_pct: probability(metric.mlRiskPct),
    row_payload: metric,
  }));
}

function featureValue(features: ChartsMlFeatures | null | undefined, key: keyof ChartsMlFeatures) {
  return numberValue(features?.[key]);
}

function mlDatasetRow(entry: ChartsMlDatasetEntry, projectId: string) {
  const features = entry.features || {} as ChartsMlFeatures;
  return {
    id: entry.id,
    project_id: String(projectId || '').trim() || '7',
    release: entry.release || null,
    export_at: entry.time || new Date().toISOString(),
    label: entry.label || null,
    labeled_at: entry.labeledAt || null,
    predicted_risk_pct: probability(entry.predictedRiskPct),
    linear_probability: probability(entry.linearProbability),
    catboost_probability: probability(entry.catboostProbability),
    tc_total: featureValue(features, 'tc_total'),
    tc_total_delta: featureValue(features, 'tc_total_delta'),
    tc_total_delta_pct: featureValue(features, 'tc_total_delta_pct'),
    tc_volatility: featureValue(features, 'tc_volatility'),
    tc_slope_pct: featureValue(features, 'tc_slope_pct'),
    cov_swat_delta_pct: featureValue(features, 'cov_swat_delta_pct'),
    cov_stream_delta_pct: featureValue(features, 'cov_stream_delta_pct'),
    sel_swat_delta_pct: featureValue(features, 'sel_swat_delta_pct'),
    sel_stream_delta_pct: featureValue(features, 'sel_stream_delta_pct'),
    avg_total_delta: featureValue(features, 'avg_total_delta'),
    chp_total_delta_pct: featureValue(features, 'chp_total_delta_pct'),
    chp_ios_delta_pct: featureValue(features, 'chp_ios_delta_pct'),
    chp_android_delta_pct: featureValue(features, 'chp_android_delta_pct'),
    release_anoms: featureValue(features, 'release_anoms'),
    type_anoms: featureValue(features, 'type_anoms'),
    platform_anoms: featureValue(features, 'platform_anoms'),
    anom_score: featureValue(features, 'anom_score'),
    features,
    row_payload: entry,
  };
}

function releaseSnapshotRow(projectId: string, snapshot: ChartsReleaseSnapshotPayload) {
  return {
    project_id: String(projectId || '').trim() || '7',
    release: snapshot.release,
    source: 'charts',
    collected_at: snapshot.collectedAt || new Date().toISOString(),
    tc_row_payload: snapshot.tcRow || {},
    coverage_row_payload: snapshot.coverageRow || {},
    selective_row_payload: snapshot.selectiveRow || {},
    avg_row_payload: snapshot.avgRow || {},
    chp_row_payload: snapshot.chpRow || {},
    timing_payload: snapshot.timing || {},
    task_types_ios_payload: snapshot.taskTypesIosRow || {},
    task_types_android_payload: snapshot.taskTypesAndroidRow || {},
    chp_types_payload: snapshot.chpTypesRow || {},
    chp_types_ios_payload: snapshot.chpTypesIosRow || {},
    chp_types_android_payload: snapshot.chpTypesAndroidRow || {},
    chp_quarter_issues_payload: snapshot.chpQuarterIssues || [],
    release_markers_payload: snapshot.releaseMarkers || [],
    tc_stream_counts_payload: snapshot.tcStreamCounts || [],
    hb_stream_counts_payload: snapshot.hbStreamCounts || [],
    selective_stream_counts_payload: snapshot.selectiveStreamCounts || [],
    uwu_stream_counts_payload: snapshot.uwuStreamCounts || [],
    snapshot_payload: snapshot,
  };
}

export async function saveChartsMlDatasetToSupabase(dataset: ChartsMlDatasetEntry[], projectId: string) {
  const payload = (dataset || []).filter(entry => entry?.id && entry.features).map(entry => mlDatasetRow(entry, projectId));
  if (!payload.length) return 0;
  const response = await fetch(`${SUPABASE_REST_URL}/charts_ml_dataset?on_conflict=id`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(payload),
  });
  await assertOk(response, 'upsert ml dataset');
  return payload.length;
}

export async function saveChartsReleaseSnapshotToSupabase(projectId: string, snapshot: ChartsReleaseSnapshotPayload) {
  if (!snapshot?.release) return false;
  const response = await fetch(`${SUPABASE_REST_URL}/charts_release_snapshots?on_conflict=project_id,release`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(releaseSnapshotRow(projectId, snapshot)),
  });
  await assertOk(response, 'upsert release snapshot');
  return true;
}

export async function loadChartsReleaseSnapshotsFromSupabase(projectId: string, releases: string[]) {
  const normalizedReleases = Array.from(new Set((releases || []).map(item => String(item || '').trim()).filter(Boolean)));
  if (!normalizedReleases.length) return [];
  const query = new URLSearchParams({
    select: 'release,snapshot_payload',
    project_id: `eq.${String(projectId || '').trim() || '7'}`,
  });
  query.set('or', `(${normalizedReleases.map(item => `release.eq.${item}`).join(',')})`);
  const response = await fetch(`${SUPABASE_REST_URL}/charts_release_snapshots?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select release snapshots');
  const payload = await response.json();
  return (Array.isArray(payload) ? payload as ChartsReleaseSnapshotRecord[] : [])
    .map(record => releaseSnapshotFromPayload(record.snapshot_payload))
    .filter((item): item is ChartsReleaseSnapshotPayload => Boolean(item));
}

export async function loadAvailableChartsReleaseSnapshotsFromSupabase(projectId: string, limit = 120) {
  const query = new URLSearchParams({
    select: 'release',
    project_id: `eq.${String(projectId || '').trim() || '7'}`,
    order: 'release.asc',
    limit: String(limit),
  });
  const response = await fetch(`${SUPABASE_REST_URL}/charts_release_snapshots?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select release snapshot list');
  const payload = await response.json();
  return Array.from(new Set((Array.isArray(payload) ? payload : [])
    .map(record => String((record as ChartsReleaseSnapshotRecord)?.release || '').trim())
    .filter(Boolean)));
}

function releaseSnapshotsFromReport(report: ChartsReport, existingSnapshots: ChartsReleaseSnapshotPayload[] = []) {
  const existingByRelease = new Map(existingSnapshots.map(snapshot => [snapshot.release, snapshot]));
  const chpIssues = report.chpQuarterStats?.issues || [];
  return (report.releases || []).map(release => {
    const existing = existingByRelease.get(release);
    return {
      schemaVersion: 1,
      release,
      collectedAt: new Date().toISOString(),
      tcRow: latestByRelease(report.tcRows, release) || { release, manual: 0, auto: 0, total: 0 },
      coverageRow: latestByRelease(report.coverageRows, release) || { release, swatCount: 0, swatPeople: 0, streamCount: 0, total: 0 },
      selectiveRow: latestByRelease(report.selectiveRows, release) || { release, swatCount: 0, swatPeople: 0, streamCount: 0, total: 0 },
      avgRow: latestByRelease(report.avgRows, release) || {
        release,
        swatMs: 0,
        streamMs: 0,
        totalMs: 0,
        swatWeighted: 0,
        streamWeighted: 0,
        totalWeighted: 0,
      },
      chpRow: latestByRelease(report.chpRows, release) || { release, ios: 0, android: 0, total: 0 },
      timing: latestByRelease(report.timings, release) || {
        release,
        iosCutLabel: '',
        androidCutLabel: '',
        iosStoreLabel: '',
        androidStoreLabel: '',
        iosRegressionLabel: '',
        androidRegressionLabel: '',
        iosCutMinutes: null,
        androidCutMinutes: null,
        iosStoreMinutes: null,
        androidStoreMinutes: null,
        iosRegressionMinutes: null,
        androidRegressionMinutes: null,
        iosLagMinutes: null,
        androidLagMinutes: null,
      },
      taskTypesIosRow: latestByRelease(report.taskTypes.iosRows, release) || { release, counts: {}, details: {} },
      taskTypesAndroidRow: latestByRelease(report.taskTypes.androidRows, release) || { release, counts: {}, details: {} },
      chpTypesRow: latestByRelease(report.chpTypes.rows, release) || { release, product: 0, vlet: 0, bug: 0, crash: 0 },
      chpTypesIosRow: latestByRelease(report.chpTypes.iosRows, release) || { release, product: 0, vlet: 0, bug: 0, crash: 0 },
      chpTypesAndroidRow: latestByRelease(report.chpTypes.androidRows, release) || { release, product: 0, vlet: 0, bug: 0, crash: 0 },
      chpQuarterIssues: chpIssues.filter(issue => issue.release === release),
      releaseMarkers: existing?.releaseMarkers || [],
      tcStreamCounts: existing?.tcStreamCounts || [],
      hbStreamCounts: existing?.hbStreamCounts || [],
      selectiveStreamCounts: existing?.selectiveStreamCounts || [],
      uwuStreamCounts: existing?.uwuStreamCounts || [],
    } satisfies ChartsReleaseSnapshotPayload;
  });
}

export async function saveChartsReportToSupabase(input: {
  report: ChartsReport;
  projectId: string;
  releaseFrom: string;
  releaseTo: string;
  compareMode: CompareMode;
}) {
  const reportResponse = await fetch(`${SUPABASE_REST_URL}/charts_reports`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(reportRow(input.report, input.projectId, input.releaseFrom, input.releaseTo, input.compareMode)),
  });
  await assertOk(reportResponse, 'insert report');
  const reportPayload = await reportResponse.json().catch(() => []);
  const inserted = Array.isArray(reportPayload) ? reportPayload[0] as ChartsReportRecord | undefined : undefined;
  const reportId = inserted?.id ? String(inserted.id) : '';
  if (!reportId) throw new Error('Supabase charts insert report: empty id');

  const metricsPayload = metricRows(reportId, input.report, input.projectId);
  if (metricsPayload.length) {
    const metricsResponse = await fetch(`${SUPABASE_REST_URL}/charts_release_metrics`, {
      method: 'POST',
      headers: headers('return=minimal'),
      body: JSON.stringify(metricsPayload),
    });
    await assertOk(metricsResponse, 'insert release metrics');
  }

  const mlSaved = await saveChartsMlDatasetToSupabase(input.report.ml?.dataset || [], input.projectId).catch(() => 0);
  const existingSnapshots = await loadChartsReleaseSnapshotsFromSupabase(input.projectId, input.report.releases || []).catch(() => []);
  const releaseSnapshots = releaseSnapshotsFromReport(input.report, existingSnapshots);
  let releaseSnapshotSaved = 0;
  for (const snapshot of releaseSnapshots) {
    const saved = await saveChartsReleaseSnapshotToSupabase(input.projectId, snapshot);
    if (saved) releaseSnapshotSaved += 1;
  }
  return {
    id: reportId,
    metrics: metricsPayload.length,
    ml: mlSaved,
    releaseSnapshots: releaseSnapshotSaved,
  };
}

export async function loadLatestChartsReportFromSupabase(input: {
  projectId: string;
  releaseFrom: string;
  releaseTo: string;
  compareMode: CompareMode;
}) {
  const query = new URLSearchParams({
    select: 'id,report_payload',
    project_id: `eq.${String(input.projectId || '').trim() || '7'}`,
    release_from: `eq.${input.releaseFrom}`,
    release_to: `eq.${input.releaseTo}`,
    compare_mode: `eq.${input.compareMode}`,
    order: 'collected_at.desc',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_REST_URL}/charts_reports?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, 'select latest report');
  const payload = await response.json();
  const record = Array.isArray(payload) ? payload[0] as ChartsReportRecord | undefined : undefined;
  if (!record) return null;
  const report = reportFromPayload(record.report_payload);
  return report ? { id: record.id ? String(record.id) : null, report } : null;
}
