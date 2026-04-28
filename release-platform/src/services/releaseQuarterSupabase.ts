import { compareRelease, type PlatformKey, type QuarterAnalysisRow, type ReleaseIssueMeta } from './releasePages';

const SUPABASE_URL = 'https://hjlnudkbdhovoaxglkmq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5FDmZ6-2PIyW3qo6IeYuAg_p20zTP_M';

type QuarterTableName = 'release_quarter_android' | 'release_quarter_ios';

function tableName(platform: PlatformKey): QuarterTableName {
  return platform === 'ios' ? 'release_quarter_ios' : 'release_quarter_android';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = '-') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function textOrEmpty(value: unknown) {
  return String(value ?? '').trim();
}

function shortDateText(value: unknown) {
  return text(value).replace(/\b(\d{1,2})\.(\d{1,2})\.(19|20)(\d{2})\b/g, (_match, day: string, month: string, _century: string, year: string) => (
    `${day.padStart(2, '0')}.${month.padStart(2, '0')}.${year}`
  ));
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function locomotivePayload(value: unknown): ReleaseIssueMeta['locomotive'] {
  const record = asRecord(value);
  return {
    business: stringArray(record.business),
    product: stringArray(record.product),
    technical: stringArray(record.technical),
    any: stringArray(record.any),
  };
}

function issueFromPayload(value: unknown, fallback?: {
  key?: unknown;
  summary?: unknown;
  url?: unknown;
  stream?: unknown;
  substream?: unknown;
  hotfixReason?: unknown;
  hotfixDetails?: unknown;
}) {
  const record = asRecord(value);
  const key = textOrEmpty(record.key ?? fallback?.key);
  if (!key) return null;
  return {
    key,
    summary: textOrEmpty(record.summary ?? fallback?.summary),
    stream: text(record.stream ?? fallback?.stream),
    substream: text(record.substream ?? fallback?.substream),
    description: textOrEmpty(record.description),
    tags: stringArray(record.tags),
    url: textOrEmpty(record.url ?? fallback?.url),
    hotfixReason: text(record.hotfixReason ?? fallback?.hotfixReason),
    hotfixDetails: text(record.hotfixDetails ?? fallback?.hotfixDetails),
    locomotive: locomotivePayload(record.locomotive),
  } satisfies ReleaseIssueMeta;
}

function issuePayload(issue: QuarterAnalysisRow['primaryTask']) {
  if (!issue) return null;
  return {
    key: issue.key,
    summary: issue.summary,
    stream: issue.stream,
    substream: issue.substream,
    url: issue.url,
    tags: issue.tags,
    locomotive: issue.locomotive,
    hotfixReason: issue.hotfixReason,
    hotfixDetails: issue.hotfixDetails,
  };
}

interface SupabaseQuarterRecord {
  version?: unknown;
  month?: unknown;
  stream?: unknown;
  substream?: unknown;
  primary_task_key?: unknown;
  primary_task_summary?: unknown;
  primary_task_url?: unknown;
  secondary_tasks?: unknown;
  build_time?: unknown;
  previous_rollout_percent?: unknown;
  planned_hotfix_date?: unknown;
  branch_cut_time?: unknown;
  actual_send_time?: unknown;
  one_percent_date?: unknown;
  hotfix_reason?: unknown;
  hotfix_details?: unknown;
  source_count?: unknown;
  row_payload?: unknown;
}

function rowFromRecord(record: SupabaseQuarterRecord, platform: PlatformKey): QuarterAnalysisRow | null {
  const payload = asRecord(record.row_payload);
  const version = textOrEmpty(payload.version ?? record.version);
  if (!version) return null;
  const primaryTask = issueFromPayload(payload.primaryTask, {
    key: record.primary_task_key,
    summary: record.primary_task_summary,
    url: record.primary_task_url,
    stream: payload.stream ?? record.stream,
    substream: payload.substream ?? record.substream,
    hotfixReason: payload.hotfixReason ?? record.hotfix_reason,
    hotfixDetails: payload.hotfixDetails ?? record.hotfix_details,
  });
  const secondarySource = Array.isArray(payload.secondaryTasks) ? payload.secondaryTasks : record.secondary_tasks;
  const secondaryTasks = Array.isArray(secondarySource)
    ? secondarySource.map(item => issueFromPayload(item)).filter(Boolean) as ReleaseIssueMeta[]
    : [];
  return {
    platform,
    version,
    month: numberOrNull(payload.month ?? record.month),
    stream: text(payload.stream ?? record.stream),
    substream: text(payload.substream ?? record.substream),
    hotfixReason: text(payload.hotfixReason ?? record.hotfix_reason),
    hotfixDetails: text(payload.hotfixDetails ?? record.hotfix_details),
    primaryTask,
    secondaryTasks,
    buildTime: shortDateText(payload.buildTime ?? record.build_time),
    previousRolloutPercent: shortDateText(payload.previousRolloutPercent ?? record.previous_rollout_percent),
    plannedHotfixDate: shortDateText(payload.plannedHotfixDate ?? record.planned_hotfix_date),
    branchCutTime: shortDateText(payload.branchCutTime ?? record.branch_cut_time),
    actualSendTime: shortDateText(payload.actualSendTime ?? record.actual_send_time),
    enteredReviewTime: shortDateText(payload.enteredReviewTime),
    onePercentDate: shortDateText(payload.onePercentDate ?? record.one_percent_date),
    sourceCount: Number(record.source_count ?? payload.sourceCount ?? 0) || 0,
  };
}

function normalizeRowDates(row: QuarterAnalysisRow): QuarterAnalysisRow {
  return {
    ...row,
    buildTime: shortDateText(row.buildTime),
    previousRolloutPercent: shortDateText(row.previousRolloutPercent),
    plannedHotfixDate: shortDateText(row.plannedHotfixDate),
    branchCutTime: shortDateText(row.branchCutTime),
    actualSendTime: shortDateText(row.actualSendTime),
    enteredReviewTime: shortDateText(row.enteredReviewTime),
    onePercentDate: shortDateText(row.onePercentDate),
  };
}

function rowPayload(row: QuarterAnalysisRow, releaseFrom: string, releaseTo: string) {
  const normalized = normalizeRowDates(row);
  return {
    version: normalized.version,
    release_from: releaseFrom,
    release_to: releaseTo,
    month: normalized.month,
    stream: normalized.stream,
    substream: normalized.substream,
    primary_task_key: normalized.primaryTask?.key || null,
    primary_task_summary: normalized.primaryTask?.summary || null,
    primary_task_url: normalized.primaryTask?.url || null,
    secondary_tasks: normalized.secondaryTasks.map(issuePayload).filter(Boolean),
    build_time: normalized.buildTime,
    previous_rollout_percent: normalized.previousRolloutPercent,
    planned_hotfix_date: normalized.plannedHotfixDate,
    branch_cut_time: normalized.branchCutTime,
    actual_send_time: normalized.actualSendTime,
    one_percent_date: normalized.onePercentDate,
    hotfix_reason: normalized.hotfixReason,
    hotfix_details: normalized.hotfixDetails,
    source_count: normalized.sourceCount,
    row_payload: {
      ...normalized,
      primaryTask: issuePayload(normalized.primaryTask),
      secondaryTasks: normalized.secondaryTasks.map(issuePayload).filter(Boolean),
    },
  };
}

async function supabaseUpsert(table: QuarterTableName, payload: unknown[]) {
  if (!payload.length) return 0;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=version`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 240)}` : ''}`);
  }
  return payload.length;
}

async function supabaseSelect(table: QuarterTableName) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 240)}` : ''}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload as SupabaseQuarterRecord[] : [];
}

export async function loadQuarterAnalysisRows() {
  const chunks = await Promise.all((['android', 'ios'] as PlatformKey[]).map(async platform => (
    (await supabaseSelect(tableName(platform)))
      .map(record => rowFromRecord(record, platform))
      .filter(Boolean) as QuarterAnalysisRow[]
  )));
  return chunks
    .flat()
    .sort((left, right) => left.platform.localeCompare(right.platform) || compareRelease(left.version, right.version));
}

export async function saveQuarterAnalysisRows(rows: QuarterAnalysisRow[], releaseFrom: string, releaseTo: string) {
  const byPlatform: Record<PlatformKey, QuarterAnalysisRow[]> = {
    android: rows.filter(row => row.platform === 'android'),
    ios: rows.filter(row => row.platform === 'ios'),
  };

  const [android, ios] = await Promise.all((['android', 'ios'] as PlatformKey[]).map(async platform => {
    const payload = byPlatform[platform].map(row => rowPayload(row, releaseFrom, releaseTo));
    return [platform, await supabaseUpsert(tableName(platform), payload)] as const;
  }));

  return {
    android: android[1],
    ios: ios[1],
    total: android[1] + ios[1],
  };
}
