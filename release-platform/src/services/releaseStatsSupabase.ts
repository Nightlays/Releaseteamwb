import type { SwatReleaseReport } from './swat';
import type { UwuReport } from './uvu';

const SUPABASE_URL = 'https://hjlnudkbdhovoaxglkmq.supabase.co';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5FDmZ6-2PIyW3qo6IeYuAg_p20zTP_M';

interface ReportPayloadRecord {
  release?: unknown;
  report_payload?: unknown;
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
  throw new Error(`Supabase release stats ${operation}: HTTP ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 240)}` : ''}`);
}

function projectKey(projectId: string) {
  return String(projectId || '').trim() || '7';
}

function releaseKey(release: string) {
  return String(release || '').trim();
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function uwuReportFromPayload(value: unknown): UwuReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<UwuReport>;
  return typeof report.releaseVersion === 'string' && Array.isArray(report.people) && Array.isArray(report.streams)
    ? report as UwuReport
    : null;
}

function swatReportFromPayload(value: unknown): SwatReleaseReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<SwatReleaseReport>;
  return typeof report.release === 'string' && Array.isArray(report.employees) && Array.isArray(report.launches)
    ? report as SwatReleaseReport
    : null;
}

function totalUwuFromReport(report: UwuReport | SwatReleaseReport) {
  if ('people' in report) {
    return (report.people || []).reduce((sum, row) => sum + numberValue(row.stats?.uwuSum), 0);
  }
  return (report.employees || []).reduce((sum, row) => sum + numberValue(row.uwuSum), 0);
}

function uwuReportRow(projectId: string, report: UwuReport) {
  const totalUwuPresent = (report.people || []).reduce((sum, row) => sum + numberValue(row.stats?.uwuPresent), 0);
  const totalDurationMs = (report.people || []).reduce((sum, row) => sum + numberValue(row.stats?.durTotalMs), 0);
  return {
    project_id: projectKey(projectId),
    release: releaseKey(report.releaseVersion),
    source: 'uvu',
    collected_at: report.generatedAt || new Date().toISOString(),
    include_high_blocker: Boolean(report.includeHighBlocker),
    include_selective: Boolean(report.includeSelective),
    launch_count: numberValue(report.totals?.launchCount),
    leaf_count: numberValue(report.totals?.leafCount),
    swat_case_count: numberValue(report.totals?.swatCaseCount),
    people_count: numberValue(report.totals?.peopleCount),
    stream_count: numberValue(report.totals?.streamCount),
    total_uwu: totalUwuFromReport(report),
    total_uwu_present: totalUwuPresent,
    total_duration_ms: totalDurationMs,
    report_payload: report,
  };
}

function swatReportRow(projectId: string, report: SwatReleaseReport) {
  const totalWorkedHours = (report.employees || []).reduce((sum, row) => sum + numberValue(row.workedHoursTotal), 0);
  return {
    project_id: projectKey(projectId),
    release: releaseKey(report.release),
    source: 'swat_release',
    collected_at: new Date().toISOString(),
    swat_count: numberValue(report.swatCount),
    launches_count: numberValue(report.launchesCount),
    total_cases: numberValue(report.totalCases),
    total_cases_android: numberValue(report.totalCasesAndroid),
    total_cases_ios: numberValue(report.totalCasesIos),
    total_uwu: totalUwuFromReport(report),
    total_worked_hours: totalWorkedHours,
    overall_avg_mmss: report.overallAvgMMSS || null,
    report_payload: report,
  };
}

async function loadReportPayload(table: string, projectId: string, release: string) {
  const cleanRelease = releaseKey(release);
  if (!cleanRelease) return null;
  const query = new URLSearchParams({
    select: 'release,report_payload',
    project_id: `eq.${projectKey(projectId)}`,
    release: `eq.${cleanRelease}`,
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_REST_URL}/${table}?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, `select ${table}`);
  const payload = await response.json();
  const record = Array.isArray(payload) ? payload[0] as ReportPayloadRecord | undefined : undefined;
  return record?.report_payload ?? null;
}

async function loadAvailableReleases(table: string, projectId: string, limit = 120) {
  const query = new URLSearchParams({
    select: 'release',
    project_id: `eq.${projectKey(projectId)}`,
    order: 'release.asc',
    limit: String(limit),
  });
  const response = await fetch(`${SUPABASE_REST_URL}/${table}?${query}`, {
    method: 'GET',
    headers: headers(),
  });
  await assertOk(response, `select ${table} releases`);
  const payload = await response.json();
  return Array.from(new Set((Array.isArray(payload) ? payload : [])
    .map(record => releaseKey((record as ReportPayloadRecord)?.release as string))
    .filter(Boolean)));
}

export async function saveUwuReleaseReportToSupabase(projectId: string, report: UwuReport) {
  if (!releaseKey(report.releaseVersion)) return false;
  const response = await fetch(`${SUPABASE_REST_URL}/uvu_release_reports?on_conflict=project_id,release`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(uwuReportRow(projectId, report)),
  });
  await assertOk(response, 'upsert uvu_release_reports');
  return true;
}

export async function loadUwuReleaseReportFromSupabase(projectId: string, release: string) {
  const payload = await loadReportPayload('uvu_release_reports', projectId, release);
  return uwuReportFromPayload(payload);
}

export async function loadAvailableUwuReleaseReportsFromSupabase(projectId: string, limit?: number) {
  return loadAvailableReleases('uvu_release_reports', projectId, limit);
}

export async function saveSwatReleaseReportToSupabase(projectId: string, report: SwatReleaseReport) {
  if (!releaseKey(report.release)) return false;
  const response = await fetch(`${SUPABASE_REST_URL}/swat_release_reports?on_conflict=project_id,release`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(swatReportRow(projectId, report)),
  });
  await assertOk(response, 'upsert swat_release_reports');
  return true;
}

export async function loadSwatReleaseReportFromSupabase(projectId: string, release: string) {
  const payload = await loadReportPayload('swat_release_reports', projectId, release);
  return swatReportFromPayload(payload);
}

export async function loadAvailableSwatReleaseReportsFromSupabase(projectId: string, limit?: number) {
  return loadAvailableReleases('swat_release_reports', projectId, limit);
}
