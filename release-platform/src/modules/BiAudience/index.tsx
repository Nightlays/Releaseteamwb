import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardHint,
  CardTitle,
  EmptyState,
  FieldLabel,
  Select,
  SegmentControl,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useApp } from '../../context/AppContext';
import {
  BI_INTERVAL_OPTIONS,
  type BiInterval,
  appendBiSnapshot,
  biDriveFetch,
  buildBiDriveGetUrl,
  buildBiDriveSaveUrl,
  mergeBiSnapshots,
  normalizeBiInterval,
  normalizeBiSnapshotsPayload,
  readBiSnapshotHistory,
  readJsonStorage,
  writeJsonStorage,
} from '../../services/bi';
import { checkProxy } from '../../services/proxy';
import {
  BI_AUDIENCE_COMPOSITE_SOURCE,
  fetchBiAudienceComposite,
  type BiAudienceCrossRow,
  type BiDeviceOsRow,
  type BiDeviceRow,
  type BiUserRecord,
} from '../../services/youtrack';

Chart.register(
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const SETTINGS_KEY = 'bi_audience_composite_settings_v1';
const HISTORY_KEY = 'bi_audience_composite_history';
const HISTORY_FILE = 'bi_audience_composite_history.json';
const HISTORY_LIMIT = 20;
const SNAPSHOT_COMPARE_LIMIT = 4;

type FocusPlatform = 'all' | 'android' | 'ios';
type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';

interface AudienceSettings {
  interval: BiInterval;
  focusPlatform: FocusPlatform;
  topCount: string;
  selectedSnapshotTimes: string[];
}

interface AudienceSnapshot {
  time: string;
  rows: BiAudienceCrossRow[];
  totals: Record<'android' | 'ios', number>;
  dataSourceId: number;
  interval: BiInterval;
  userRecords?: BiUserRecord[];
  deviceRows?: BiDeviceRow[];
  osRows?: BiDeviceOsRow[];
}

interface ReleaseSummaryRow {
  platform: 'android' | 'ios';
  release: string;
  users: number;
  share: number;
  devices: number;
  osVersions: number;
  topDevice: string;
  topOs: string;
}

interface ChartThemeColors {
  text: string;
  text2: string;
  text3: string;
  grid: string;
  border: string;
  surface: string;
  font: string;
  mono: string;
}

interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

const DEFAULT_SETTINGS: AudienceSettings = {
  interval: 'last_2_days',
  focusPlatform: 'all',
  topCount: '20',
  selectedSnapshotTimes: [],
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
}

function shareToPercent(value: number | null | undefined) {
  const numeric = Number(value || 0);
  return numeric <= 1 ? numeric * 100 : numeric;
}

function formatShare(value: number | null | undefined) {
  return `${shareToPercent(value).toFixed(2)}%`;
}

function formatSnapshotLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function platformLabel(platform: FocusPlatform | 'android' | 'ios') {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  return 'Все';
}

function platformBadgeColor(platform: FocusPlatform | 'android' | 'ios'): 'gray' | 'green' | 'purple' {
  if (platform === 'android') return 'green';
  if (platform === 'ios') return 'purple';
  return 'gray';
}

function statusBadgeColor(tone: StatusTone): 'gray' | 'green' | 'yellow' | 'red' {
  if (tone === 'ok') return 'green';
  if (tone === 'warn') return 'yellow';
  if (tone === 'error') return 'red';
  return 'gray';
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getChartThemeColors(): ChartThemeColors {
  return {
    text: readCssVar('--text', '#EEEAF8'),
    text2: readCssVar('--text-2', '#9D96B4'),
    text3: readCssVar('--text-3', '#5F5878'),
    grid: readCssVar('--chart-grid', 'rgba(255,255,255,.05)'),
    border: readCssVar('--border', 'rgba(255,255,255,.07)'),
    surface: readCssVar('--surface', '#111118'),
    font: readCssVar('--font', 'Inter, system-ui, -apple-system, sans-serif'),
    mono: readCssVar('--mono', 'IBM Plex Mono, SFMono-Regular, Consolas, monospace'),
  };
}

function hexToRgba(color: string, alpha: number) {
  const value = String(color || '').trim();
  const match = value.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return value;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${alpha})`;
}

function createVerticalGradient(ctx: CanvasRenderingContext2D, area: { top: number; bottom: number }, color: string, topAlpha: number, bottomAlpha: number) {
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, hexToRgba(color, topAlpha));
  gradient.addColorStop(1, hexToRgba(color, bottomAlpha));
  return gradient;
}

function normalizeSettings(input: unknown): AudienceSettings {
  const value = (input && typeof input === 'object') ? input as Partial<AudienceSettings> : {};
  return {
    interval: normalizeBiInterval(value.interval, DEFAULT_SETTINGS.interval),
    focusPlatform: value.focusPlatform === 'android' || value.focusPlatform === 'ios' ? value.focusPlatform : DEFAULT_SETTINGS.focusPlatform,
    topCount: value.topCount === '10' || value.topCount === '30' ? value.topCount : DEFAULT_SETTINGS.topCount,
    selectedSnapshotTimes: Array.isArray(value.selectedSnapshotTimes)
      ? value.selectedSnapshotTimes.map(item => String(item || '')).filter(Boolean)
      : [],
  };
}

function readModuleSettings() {
  return normalizeSettings(readJsonStorage<unknown>(SETTINGS_KEY, null));
}

function writeModuleSettings(settings: AudienceSettings) {
  writeJsonStorage(SETTINGS_KEY, settings);
}

function normalizeCrossRow(input: unknown): BiAudienceCrossRow | null {
  const value = input as Partial<BiAudienceCrossRow>;
  const platform = value.platform === 'android' || value.platform === 'ios' ? value.platform : null;
  if (!platform) return null;
  const release = String(value.release || '').trim();
  const model = String(value.model || '').trim();
  const users = Number(value.users || 0);
  if (!release || !model || !users) return null;
  return {
    platform,
    release,
    manufacturer: String(value.manufacturer || '').trim(),
    model,
    os: String(value.os || '').trim(),
    users,
    total: Number(value.total || 0),
    share: Number(value.share || 0),
  };
}

function normalizeUserRecord(input: unknown): BiUserRecord | null {
  const value = input as Partial<BiUserRecord>;
  const platform = value.platform === 'Android' || value.platform === 'iOS' ? value.platform : null;
  if (!platform) return null;
  const release = String(value.release || '').trim();
  if (!release) return null;
  return {
    platform,
    release,
    users: Number(value.users || 0),
    share: value.share == null ? null : Number(value.share),
  };
}

function normalizeDeviceRow(input: unknown): BiDeviceRow | null {
  const value = input as Partial<BiDeviceRow>;
  const platform = value.platform === 'android' || value.platform === 'ios' ? value.platform : null;
  if (!platform) return null;
  const model = String(value.model || '').trim();
  if (!model) return null;
  return {
    platform,
    manufacturer: String(value.manufacturer || '').trim(),
    model,
    users: Number(value.users || 0),
    total: Number(value.total || 0),
    share: Number(value.share || 0),
  };
}

function normalizeOsRow(input: unknown): BiDeviceOsRow | null {
  const value = input as Partial<BiDeviceOsRow>;
  const platform = value.platform === 'android' || value.platform === 'ios' ? value.platform : null;
  if (!platform) return null;
  const os = String(value.os || '').trim();
  if (!os) return null;
  return {
    platform,
    os,
    users: Number(value.users || 0),
    total: Number(value.total || 0),
    share: Number(value.share || 0),
  };
}

function normalizeSnapshot(input: unknown): AudienceSnapshot | null {
  const value = input as Partial<AudienceSnapshot>;
  const time = String(value?.time || '').trim();
  if (!time || Number.isNaN(Date.parse(time))) return null;
  const rows = Array.isArray(value.rows)
    ? value.rows.map(normalizeCrossRow).filter((row): row is BiAudienceCrossRow => Boolean(row))
    : [];
  return {
    time,
    rows,
    totals: {
      android: Number(value.totals?.android || 0),
      ios: Number(value.totals?.ios || 0),
    },
    dataSourceId: Number(value.dataSourceId || 0),
    interval: normalizeBiInterval(value.interval, DEFAULT_SETTINGS.interval),
    userRecords: Array.isArray(value.userRecords)
      ? value.userRecords.map(normalizeUserRecord).filter((row): row is BiUserRecord => Boolean(row))
      : [],
    deviceRows: Array.isArray(value.deviceRows)
      ? value.deviceRows.map(normalizeDeviceRow).filter((row): row is BiDeviceRow => Boolean(row))
      : [],
    osRows: Array.isArray(value.osRows)
      ? value.osRows.map(normalizeOsRow).filter((row): row is BiDeviceOsRow => Boolean(row))
      : [],
  };
}

function readHistory() {
  return readBiSnapshotHistory(HISTORY_KEY, normalizeSnapshot);
}

function writeHistory(history: AudienceSnapshot[]) {
  writeJsonStorage(HISTORY_KEY, history.slice(-HISTORY_LIMIT));
}

function chooseSnapshots(history: AudienceSnapshot[], selectedTimes: string[]) {
  const selected = new Set(selectedTimes);
  if (selected.size) {
    return history.filter(snapshot => selected.has(snapshot.time)).slice(-SNAPSHOT_COMPARE_LIMIT);
  }
  return history.slice(-2);
}

function deviceLabel(row: Pick<BiAudienceCrossRow, 'manufacturer' | 'model'>) {
  const manufacturer = String(row.manufacturer || '').trim();
  const model = String(row.model || '').trim();
  if (!manufacturer) return model || '—';
  if (!model) return manufacturer;
  return model.toLowerCase().startsWith(manufacturer.toLowerCase()) ? model : `${manufacturer} ${model}`;
}

function rowKey(row: BiAudienceCrossRow) {
  return [
    row.platform,
    row.release,
    row.manufacturer,
    row.model,
    row.os,
  ].map(item => String(item || '').toLowerCase()).join('::');
}

function sourcePlatform(platform: FocusPlatform | 'android' | 'ios') {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  return 'all';
}

function filterRows(rows: BiAudienceCrossRow[], settings: AudienceSettings, selectedVersions: string[] = []) {
  const versionSet = selectedVersions.length ? new Set(selectedVersions) : null;
  return rows
    .filter(row => settings.focusPlatform === 'all' || row.platform === settings.focusPlatform)
    .filter(row => !versionSet || versionSet.has(row.release))
    .sort((left, right) => right.users - left.users);
}

function filterUserRecords(rows: BiUserRecord[], settings: AudienceSettings, selectedVersions: string[] = []) {
  const platform = sourcePlatform(settings.focusPlatform);
  const versionSet = selectedVersions.length ? new Set(selectedVersions) : null;
  return rows
    .filter(row => platform === 'all' || row.platform === platform)
    .filter(row => !versionSet || versionSet.has(row.release))
    .sort((left, right) => right.users - left.users);
}

function filterDeviceRows(rows: BiDeviceRow[], settings: AudienceSettings) {
  return rows
    .filter(row => settings.focusPlatform === 'all' || row.platform === settings.focusPlatform)
    .sort((left, right) => right.users - left.users);
}

function filterOsRows(rows: BiDeviceOsRow[], settings: AudienceSettings) {
  return rows
    .filter(row => settings.focusPlatform === 'all' || row.platform === settings.focusPlatform)
    .sort((left, right) => right.users - left.users);
}

function buildReleaseSummary(rows: BiAudienceCrossRow[], totals: Record<'android' | 'ios', number>): ReleaseSummaryRow[] {
  const grouped = new Map<string, {
    platform: 'android' | 'ios';
    release: string;
    users: number;
    devices: Set<string>;
    osVersions: Set<string>;
    topRow: BiAudienceCrossRow | null;
  }>();

  rows.forEach(row => {
    const key = `${row.platform}:${row.release}`;
    const current = grouped.get(key) || {
      platform: row.platform,
      release: row.release,
      users: 0,
      devices: new Set<string>(),
      osVersions: new Set<string>(),
      topRow: null,
    };
    current.users += Number(row.users || 0);
    current.devices.add(deviceLabel(row));
    if (row.os) current.osVersions.add(row.os);
    if (!current.topRow || row.users > current.topRow.users) current.topRow = row;
    grouped.set(key, current);
  });

  return [...grouped.values()]
    .map(row => ({
      platform: row.platform,
      release: row.release,
      users: row.users,
      share: totals[row.platform] > 0 ? (row.users / totals[row.platform]) * 100 : 0,
      devices: row.devices.size,
      osVersions: row.osVersions.size,
      topDevice: row.topRow ? deviceLabel(row.topRow) : '—',
      topOs: row.topRow?.os || '—',
    }))
    .sort((left, right) => right.users - left.users);
}

function buildExactReleaseSummary(
  userRows: BiUserRecord[],
  matrixRows: BiAudienceCrossRow[],
  totals: Record<'android' | 'ios', number>,
): ReleaseSummaryRow[] {
  const hints = buildReleaseSummary(matrixRows, totals);
  const hintMap = new Map(hints.map(row => [`${row.platform}:${row.release}`, row]));
  return userRows.map(row => {
    const platform: 'android' | 'ios' = row.platform === 'iOS' ? 'ios' : 'android';
    const hint = hintMap.get(`${platform}:${row.release}`);
    const users = Number(row.users || 0);
    return {
      platform,
      release: row.release,
      users,
      share: row.share == null ? (totals[platform] > 0 ? (users / totals[platform]) * 100 : 0) : shareToPercent(row.share),
      devices: hint?.devices || 0,
      osVersions: hint?.osVersions || 0,
      topDevice: hint?.topDevice || '—',
      topOs: hint?.topOs || '—',
    };
  }).sort((left, right) => right.users - left.users);
}

function buildRegressionRows(rows: BiAudienceCrossRow[], limit: number) {
  const result: BiAudienceCrossRow[] = [];
  const seen = new Set<string>();
  const add = (row: BiAudienceCrossRow | undefined) => {
    if (!row) return;
    const key = rowKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  };

  (['android', 'ios'] as const).forEach(platform => {
    const platformRows = rows.filter(row => row.platform === platform).sort((left, right) => right.users - left.users);
    platformRows.slice(0, 4).forEach(add);
    buildReleaseSummary(platformRows, {
      android: platform === 'android' ? platformRows.reduce((sum, row) => sum + row.users, 0) : 0,
      ios: platform === 'ios' ? platformRows.reduce((sum, row) => sum + row.users, 0) : 0,
    }).slice(0, 4).forEach(summary => {
      add(platformRows.find(row => row.release === summary.release && deviceLabel(row) === summary.topDevice));
    });
  });

  return result.slice(0, limit);
}

function sumBy<T>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => number) {
  const map = new Map<string, number>();
  rows.forEach(row => {
    const key = keyOf(row) || '—';
    map.set(key, (map.get(key) || 0) + Number(valueOf(row) || 0));
  });
  return map;
}

function mapToChartData(map: Map<string, number>, limit: number, colors: string[] = []) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value], index) => ({
      label,
      value,
      color: colors[index % Math.max(1, colors.length)],
    }));
}

function classifyAndroidStore(release: string) {
  const value = String(release || '').toLowerCase();
  if (value.includes('rustore')) return 'RuStore';
  if (value.includes('huawei')) return 'Huawei';
  return 'Google Play / основная';
}

function classifyReleaseCohort(release: string) {
  const value = String(release || '').trim().toLowerCase();
  if (/^9\.9\.9999|99\.9999/.test(value)) return 'Технические версии';
  if (value.includes('hotfix') || value.includes('-hf')) return 'Хотфиксы';
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match) {
    const build = Number(match[3] || 0);
    if (build > 0 && build % 1000 !== 0) return 'Хотфиксы';
    return 'Основные релизы';
  }
  return 'Прочие версии';
}

function buildAndroidStoreData(rows: BiAudienceCrossRow[]) {
  return mapToChartData(
    sumBy(
      rows.filter(row => row.platform === 'android'),
      row => classifyAndroidStore(row.release),
      row => row.users,
    ),
    6,
    ['#22C55E', '#F59E0B', '#3B82F6', '#8B5CF6'],
  );
}

function buildReleaseCohortData(rows: BiAudienceCrossRow[]) {
  return mapToChartData(
    sumBy(rows, row => classifyReleaseCohort(row.release), row => row.users),
    6,
    ['#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#64748B'],
  );
}

function buildHistoryTrend(history: AudienceSnapshot[]) {
  return history.slice(-8).map(snapshot => ({
    label: formatSnapshotLabel(snapshot.time),
    android: Number(snapshot.totals.android || 0),
    ios: Number(snapshot.totals.ios || 0),
    total: Number(snapshot.totals.android || 0) + Number(snapshot.totals.ios || 0),
  }));
}

function topShare(rows: BiAudienceCrossRow[], count: number) {
  const total = rows.reduce((sum, row) => sum + Number(row.users || 0), 0);
  if (!total) return 0;
  const top = rows.slice().sort((left, right) => right.users - left.users).slice(0, count);
  return (top.reduce((sum, row) => sum + Number(row.users || 0), 0) / total) * 100;
}

function buildDeltaRows(
  current: Map<string, number>,
  previous: Map<string, number>,
  limit: number,
) {
  const labels = new Set([...current.keys(), ...previous.keys()]);
  return [...labels].map(label => {
    const now = Number(current.get(label) || 0);
    const prev = Number(previous.get(label) || 0);
    const delta = now - prev;
    const deltaPct = prev > 0 ? (delta / prev) * 100 : (now > 0 ? 100 : null);
    return { label, now, prev, delta, deltaPct };
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)).slice(0, limit);
}

function formatSigned(value: number) {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatSignedPercent(value: number | null) {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function buildDataWarnings(options: {
  hasCookie: boolean;
  proxyError: boolean;
  rows: BiAudienceCrossRow[];
  totals: Record<'android' | 'ios', number>;
  previousTotals: Record<'android' | 'ios', number> | null;
  top5Concentration: number;
}) {
  const warnings: string[] = [];
  if (!options.hasCookie) warnings.push('BI cookie не задан в общих настройках.');
  if (options.proxyError) warnings.push('Proxy недоступен, BI-запросы могут не пройти.');
  if (!options.rows.length) warnings.push('Текущий составной срез пустой.');
  if (!options.totals.android) warnings.push('В текущем срезе нет Android аудитории.');
  if (!options.totals.ios) warnings.push('В текущем срезе нет iOS аудитории.');
  if (options.top5Concentration > 70) warnings.push(`Top-5 комбинаций занимает ${options.top5Concentration.toFixed(1)}% расчетной матрицы.`);
  if (options.previousTotals) {
    const currentTotal = options.totals.android + options.totals.ios;
    const previousTotal = options.previousTotals.android + options.previousTotals.ios;
    if (previousTotal > 0) {
      const deltaPct = ((currentTotal - previousTotal) / previousTotal) * 100;
      if (deltaPct <= -10) warnings.push(`Общая аудитория просела на ${deltaPct.toFixed(1)}% к предыдущему снэпшоту.`);
      if (deltaPct >= 15) warnings.push(`Общая аудитория выросла на ${deltaPct.toFixed(1)}%, стоит проверить интервал BI.`);
    }
  }
  return warnings;
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.ready === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.ready = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePdfLibraries() {
  const runtime = window as unknown as {
    html2canvas?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    jspdf?: { jsPDF?: new (options?: Record<string, unknown>) => {
      internal: { pageSize: { getWidth(): number; getHeight(): number } };
      addPage: () => void;
      setFillColor: (r: number, g: number, b: number) => void;
      rect: (x: number, y: number, w: number, h: number, mode: string) => void;
      addImage: (data: string, format: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string) => void;
      save: (name: string) => void;
    } };
  };

  if (!runtime.html2canvas) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  }
  if (!runtime.jspdf?.jsPDF) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }
  if (!runtime.html2canvas || !runtime.jspdf?.jsPDF) {
    throw new Error('PDF библиотеки не загрузились.');
  }
  return { html2canvas: runtime.html2canvas, jsPDF: runtime.jspdf.jsPDF };
}

function MetricTile({ label, value, color = 'var(--text)', sub }: { label: string; value: React.ReactNode; color?: string; sub?: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{sub}</div> : null}
      </CardBody>
    </Card>
  );
}

function InsightTile({ label, value, meta, color = 'var(--text)' }: { label: string; value: React.ReactNode; meta?: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardBody>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1.25 }}>{value}</div>
        {meta ? <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>{meta}</div> : null}
      </CardBody>
    </Card>
  );
}

function ShareBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, shareToPercent(value)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 99, overflow: 'hidden', background: 'var(--surface-soft-4)' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            minWidth: pct > 0 ? 4 : 0,
            borderRadius: 99,
            background: color,
            boxShadow: `0 0 14px ${color}55`,
          }}
        />
      </div>
      <span style={{ minWidth: 58, textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
        {pct.toFixed(2)}%
      </span>
    </div>
  );
}

function HorizontalBarChart({
  data,
  themeColors,
  height = 280,
  valueLabel = 'Users',
}: {
  data: ChartDatum[];
  themeColors: ChartThemeColors;
  height?: number;
  valueLabel?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data.length) {
      chartRef.current?.destroy();
      return;
    }

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(item => item.label),
        datasets: [{
          label: valueLabel,
          data: data.map(item => item.value),
          backgroundColor: (context: { chart: Chart; dataIndex: number }) => {
            const color = data[context.dataIndex]?.color || '#3B82F6';
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.54);
            return createVerticalGradient(ctx, chartArea, color, 0.72, 0.24);
          },
          hoverBackgroundColor: (context: { chart: Chart; dataIndex: number }) => {
            const color = data[context.dataIndex]?.color || '#3B82F6';
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.72);
            return createVerticalGradient(ctx, chartArea, color, 0.9, 0.34);
          },
          borderColor: data.map(item => item.color || '#3B82F6'),
          borderWidth: 1.4,
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.72,
          categoryPercentage: 0.78,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 8, right: 16, bottom: 8, left: 6 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: hexToRgba(themeColors.surface, 0.96),
            titleColor: themeColors.text,
            bodyColor: themeColors.text2,
            borderColor: themeColors.border,
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            titleFont: { family: themeColors.font, size: 12, weight: 700 },
            bodyFont: { family: themeColors.mono, size: 11, weight: 500 },
            callbacks: {
              label: context => `${valueLabel}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: {
              color: themeColors.text3,
              font: { size: 10, family: themeColors.mono },
              callback: value => formatNumber(Number(value || 0)),
            },
          },
          y: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: { color: themeColors.text2, font: { size: 11, family: themeColors.font, weight: 600 } },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [data, themeColors, valueLabel]);

  return <canvas ref={ref} style={{ display: 'block', height }} />;
}

function VerticalBarChart({
  data,
  themeColors,
  height = 260,
  valueLabel = 'Users',
}: {
  data: ChartDatum[];
  themeColors: ChartThemeColors;
  height?: number;
  valueLabel?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data.length) {
      chartRef.current?.destroy();
      return;
    }

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(item => item.label),
        datasets: [{
          label: valueLabel,
          data: data.map(item => item.value),
          backgroundColor: (context: { chart: Chart; dataIndex: number }) => {
            const color = data[context.dataIndex]?.color || '#3B82F6';
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.5);
            return createVerticalGradient(ctx, chartArea, color, 0.72, 0.18);
          },
          borderColor: data.map(item => item.color || '#3B82F6'),
          borderWidth: 1.4,
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.78,
          categoryPercentage: 0.64,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 12, right: 12, bottom: 8, left: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: hexToRgba(themeColors.surface, 0.96),
            titleColor: themeColors.text,
            bodyColor: themeColors.text2,
            borderColor: themeColors.border,
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            titleFont: { family: themeColors.font, size: 12, weight: 700 },
            bodyFont: { family: themeColors.mono, size: 11, weight: 500 },
            callbacks: {
              label: context => `${valueLabel}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: { color: themeColors.text2, font: { size: 11, family: themeColors.font, weight: 600 } },
          },
          y: {
            beginAtZero: true,
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: {
              color: themeColors.text3,
              font: { size: 10, family: themeColors.mono },
              callback: value => formatNumber(Number(value || 0)),
            },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [data, themeColors, valueLabel]);

  return <canvas ref={ref} style={{ display: 'block', height }} />;
}

function HistoryTrendChart({ rows, themeColors }: { rows: Array<{ label: string; android: number; ios: number; total: number }>; themeColors: ChartThemeColors }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || rows.length < 2) {
      chartRef.current?.destroy();
      return;
    }

    const datasets = [
      { label: 'Итого', data: rows.map(row => row.total), color: '#3B82F6', width: 2.8 },
      { label: 'Android', data: rows.map(row => row.android), color: '#22C55E', width: 2 },
      { label: 'iOS', data: rows.map(row => row.ios), color: '#9B5CFF', width: 2 },
    ];

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: rows.map(row => row.label),
        datasets: datasets.map(dataset => ({
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.color,
          backgroundColor: (context: { chart: Chart }) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(dataset.color, 0.14);
            return createVerticalGradient(ctx, chartArea, dataset.color, dataset.label === 'Итого' ? 0.2 : 0.12, 0.01);
          },
          fill: true,
          tension: 0.34,
          borderWidth: dataset.width,
          pointRadius: dataset.label === 'Итого' ? 4 : 3,
          pointHoverRadius: dataset.label === 'Итого' ? 5 : 4,
          pointBackgroundColor: themeColors.surface,
          pointBorderColor: dataset.color,
          pointBorderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 16, right: 12, bottom: 8, left: 8 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: themeColors.text2,
              font: { size: 11, family: themeColors.font, weight: 600 },
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: hexToRgba(themeColors.surface, 0.96),
            titleColor: themeColors.text,
            bodyColor: themeColors.text2,
            borderColor: themeColors.border,
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            usePointStyle: true,
            titleFont: { family: themeColors.font, size: 12, weight: 700 },
            bodyFont: { family: themeColors.mono, size: 11, weight: 500 },
            callbacks: {
              label: context => `${context.dataset.label}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: { color: themeColors.text2, font: { size: 10, family: themeColors.mono } },
          },
          y: {
            beginAtZero: true,
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: {
              color: themeColors.text3,
              font: { size: 10, family: themeColors.mono },
              callback: value => formatNumber(Number(value || 0)),
            },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [rows, themeColors]);

  return <canvas ref={ref} style={{ display: 'block', height: 280 }} />;
}

interface VersionOption {
  release: string;
  users: number;
}

type VersionSortMode = 'popularity' | 'name';

function VersionFilterSelect({
  options,
  selected,
  onChange,
}: {
  options: VersionOption[];
  selected: string[];
  onChange: (versions: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<VersionSortMode>('popularity');
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? options.filter(o => o.release.toLowerCase().includes(needle)) : options;
    if (sortMode === 'name') return [...filtered].sort((a, b) => a.release.localeCompare(b.release, 'ru-RU', { numeric: true }));
    return filtered;
  }, [options, query, sortMode]);

  const updatePanelStyle = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(280, Math.min(380, rect.width));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow > 200 ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(360, window.innerHeight - 80) - 6);
    setPanelStyle({ position: 'fixed', left, top, width, zIndex: 850 });
  }, []);

  useEffect(() => {
    if (!open) { setQuery(''); return undefined; }
    updatePanelStyle();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', updatePanelStyle);
    document.addEventListener('scroll', updatePanelStyle, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', updatePanelStyle);
      document.removeEventListener('scroll', updatePanelStyle, true);
    };
  }, [open, updatePanelStyle]);

  const buttonLabel = selected.length === 0
    ? 'Все версии'
    : selected.length === 1
    ? selected[0]
    : `${selected.length} версий`;

  const sortBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 9px',
    borderRadius: 7,
    border: `1px solid ${active ? 'rgba(59,130,246,.5)' : 'var(--border)'}`,
    background: active ? 'rgba(59,130,246,.14)' : 'transparent',
    color: active ? '#60A5FA' : 'var(--text-3)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { updatePanelStyle(); setOpen(o => !o); }}
        style={{
          height: 36,
          minWidth: 180,
          maxWidth: 260,
          padding: '0 10px 0 12px',
          borderRadius: 10,
          border: `1px solid ${selected.length ? 'rgba(59,130,246,.5)' : 'var(--border)'}`,
          background: selected.length ? 'rgba(59,130,246,.1)' : 'var(--surface-soft)',
          color: selected.length ? '#60A5FA' : 'var(--text-2)',
          fontSize: 13,
          fontWeight: selected.length ? 700 : 400,
          fontFamily: selected.length === 1 ? 'var(--mono)' : 'inherit',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>{buttonLabel}</span>
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" style={{ flexShrink: 0, opacity: .55, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            ...panelStyle,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 12,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.38)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск версии..."
              style={{
                width: '100%',
                height: 32,
                padding: '0 10px',
                borderRadius: 8,
                border: '1px solid var(--border-hi)',
                background: 'var(--surface-soft-2)',
                color: 'var(--text)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
            <button style={sortBtnStyle(sortMode === 'popularity')} onClick={() => setSortMode('popularity')}>По популярности</button>
            <button style={sortBtnStyle(sortMode === 'name')} onClick={() => setSortMode('name')}>По имени</button>
            <div style={{ flex: 1 }} />
            {filteredOptions.length > 0 && query.trim() && (
              <button
                style={{ ...sortBtnStyle(false), color: 'var(--text-2)' }}
                onClick={() => {
                  const toAdd = filteredOptions.map(o => o.release).filter(r => !selectedSet.has(r));
                  onChange([...selected, ...toAdd]);
                }}
              >
                Выбрать найденные
              </button>
            )}
            <button
              style={{ ...sortBtnStyle(false), color: selected.length ? 'var(--text-2)' : 'var(--text-3)', opacity: selected.length ? 1 : .45 }}
              disabled={!selected.length}
              onClick={() => onChange([])}
            >
              Сбросить
            </button>
          </div>

          <div style={{ overflow: 'auto', flex: 1, padding: '4px 6px 6px' }}>
            {filteredOptions.length === 0 && (
              <div style={{ padding: '12px 8px', color: 'var(--text-3)', fontSize: 12 }}>Версий не найдено</div>
            )}
            {filteredOptions.map(option => {
              const isSelected = selectedSet.has(option.release);
              return (
                <label
                  key={option.release}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 30,
                    padding: '5px 8px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(59,130,246,.08)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onChange(isSelected
                      ? selected.filter(v => v !== option.release)
                      : [...selected, option.release],
                    )}
                    style={{ width: 14, height: 14, flexShrink: 0, accentColor: 'var(--accent, #3B82F6)' }}
                  />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: isSelected ? 700 : 400, color: isSelected ? '#60A5FA' : 'var(--text-2)', flex: 1 }}>
                    {option.release}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatNumber(option.users)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function BiAudience() {
  const { settings } = useSettings();
  const { theme } = useApp();
  const storedSettings = useMemo(readModuleSettings, []);
  const [interval, setInterval] = useState<BiInterval>(storedSettings.interval);
  const [focusPlatform, setFocusPlatform] = useState<FocusPlatform>(storedSettings.focusPlatform);
  const [topCount, setTopCount] = useState(storedSettings.topCount);
  const [selectedSnapshotTimes, setSelectedSnapshotTimes] = useState<string[]>(storedSettings.selectedSnapshotTimes);
  const [history, setHistory] = useState<AudienceSnapshot[]>(() => readHistory());
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [status, setStatus] = useState('Нажмите «Обновить», чтобы загрузить BI аудиторию.');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>(settings.useProxy === false ? 'ok' : 'unknown');
  const [driveState, setDriveState] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [error, setError] = useState('');
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    writeModuleSettings({
      interval,
      focusPlatform,
      topCount,
      selectedSnapshotTimes,
    });
  }, [focusPlatform, interval, selectedSnapshotTimes, topCount]);

  const runtimeSettings = useMemo(() => ({
    proxyBase: settings.proxyBase,
    proxyMode: settings.proxyMode,
    useProxy: settings.useProxy,
  }), [settings.proxyBase, settings.proxyMode, settings.useProxy]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const response = await biDriveFetch(runtimeSettings, buildBiDriveGetUrl(HISTORY_FILE), { method: 'GET' });
        const text = await response.text();
        if (!response.ok) throw new Error(`Drive audience history HTTP ${response.status}`);
        const merged = mergeBiSnapshots(readHistory(), normalizeBiSnapshotsPayload(text, normalizeSnapshot), HISTORY_LIMIT);
        if (!cancelled) {
          writeHistory(merged);
          setHistory(merged);
          setDriveState('ok');
          if (merged.length) {
            setStatus(`История BI аудитории синхронизирована: ${merged.length} снэпшотов.`);
            setStatusTone('ok');
          }
        }
      } catch {
        if (!cancelled) setDriveState('error');
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [runtimeSettings]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (settings.useProxy === false) {
        setProxyState('ok');
        return;
      }
      if (!String(settings.proxyBase || '').trim()) {
        setProxyState('error');
        return;
      }
      try {
        const ok = await checkProxy(settings.proxyBase);
        if (!cancelled) setProxyState(ok ? 'ok' : 'error');
      } catch {
        if (!cancelled) setProxyState('error');
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [settings.proxyBase, settings.useProxy]);

  const snapshotOptions = useMemo(
    () => history.slice().sort((left, right) => Date.parse(right.time) - Date.parse(left.time)).slice(0, HISTORY_LIMIT),
    [history],
  );
  const chosenSnapshots = useMemo(
    () => chooseSnapshots(history, selectedSnapshotTimes),
    [history, selectedSnapshotTimes],
  );
  const currentSnapshot = chosenSnapshots[chosenSnapshots.length - 1] || null;
  const previousSnapshot = chosenSnapshots.length > 1 ? chosenSnapshots[chosenSnapshots.length - 2] : null;

  useEffect(() => {
    const allowed = new Set(snapshotOptions.map(snapshot => snapshot.time));
    if (selectedSnapshotTimes.every(item => allowed.has(item))) return;
    setSelectedSnapshotTimes(prev => prev.filter(item => allowed.has(item)));
  }, [selectedSnapshotTimes, snapshotOptions]);

  const currentRows = currentSnapshot?.rows || [];
  const moduleSettings = useMemo(() => ({
    interval,
    focusPlatform,
    topCount,
    selectedSnapshotTimes,
  }), [focusPlatform, interval, selectedSnapshotTimes, topCount]);
  const filteredRows = useMemo(() => filterRows(currentRows, moduleSettings, selectedVersions), [currentRows, moduleSettings, selectedVersions]);
  const limit = Number(topCount || 20) || 20;
  const topRows = filteredRows.slice(0, limit);
  const totals = currentSnapshot?.totals || { android: 0, ios: 0 };
  const previousTotals = previousSnapshot?.totals || null;
  const totalUsers = totals.android + totals.ios;
  const exactUserRows = useMemo(() => filterUserRecords(currentSnapshot?.userRecords || [], moduleSettings, selectedVersions), [currentSnapshot, moduleSettings, selectedVersions]);
  const exactDeviceRows = useMemo(() => filterDeviceRows(currentSnapshot?.deviceRows || [], moduleSettings), [currentSnapshot, moduleSettings]);
  const exactOsRows = useMemo(() => filterOsRows(currentSnapshot?.osRows || [], moduleSettings), [currentSnapshot, moduleSettings]);
  const releaseSummary = useMemo(
    () => (exactUserRows.length ? buildExactReleaseSummary(exactUserRows, filteredRows, totals) : buildReleaseSummary(filteredRows, totals)).slice(0, limit),
    [exactUserRows, filteredRows, limit, totals],
  );
  const regressionRows = useMemo(() => buildRegressionRows(filteredRows, 10), [filteredRows]);
  const uniqueReleases = new Set(filteredRows.map(row => `${row.platform}:${row.release}`)).size;
  const uniqueDevices = new Set(filteredRows.map(row => `${row.platform}:${deviceLabel(row)}`)).size;
  const uniqueOs = new Set(filteredRows.map(row => `${row.platform}:${row.os}`)).size;

  const versionOptions = useMemo((): VersionOption[] => {
    const platform = sourcePlatform(focusPlatform);
    const userRecs = currentSnapshot?.userRecords || [];
    if (userRecs.length) {
      const byRelease = new Map<string, number>();
      userRecs
        .filter(r => platform === 'all' || r.platform === platform)
        .forEach(r => byRelease.set(r.release, (byRelease.get(r.release) || 0) + r.users));
      return [...byRelease.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([release, users]) => ({ release, users }));
    }
    const byRelease = new Map<string, number>();
    (currentSnapshot?.rows || [])
      .filter(r => focusPlatform === 'all' || r.platform === focusPlatform)
      .forEach(r => byRelease.set(r.release, (byRelease.get(r.release) || 0) + r.users));
    return [...byRelease.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([release, users]) => ({ release, users }));
  }, [currentSnapshot, focusPlatform]);

  useEffect(() => {
    if (!selectedVersions.length) return;
    const allowed = new Set(versionOptions.map(o => o.release));
    if (selectedVersions.every(v => allowed.has(v))) return;
    setSelectedVersions(prev => prev.filter(v => allowed.has(v)));
  }, [selectedVersions, versionOptions]);

  const chartThemeColors = useMemo(() => getChartThemeColors(), [theme]);
  const platformChartData = useMemo(() => {
    if (focusPlatform === 'android') return [{ label: 'Android', value: totals.android, color: '#22C55E' }];
    if (focusPlatform === 'ios') return [{ label: 'iOS', value: totals.ios, color: '#9B5CFF' }];
    return [
      { label: 'Android', value: totals.android, color: '#22C55E' },
      { label: 'iOS', value: totals.ios, color: '#9B5CFF' },
    ];
  }, [focusPlatform, totals]);
  const releaseChartData = useMemo(() => releaseSummary.slice(0, 10).map(row => ({
    label: `${platformLabel(row.platform)} ${row.release}`,
    value: row.users,
    color: row.platform === 'android' ? '#22C55E' : '#9B5CFF',
  })), [releaseSummary]);
  const deviceChartData = useMemo(() => mapToChartData(
    exactDeviceRows.length && !selectedVersions.length
      ? sumBy(exactDeviceRows, row => `${platformLabel(row.platform)} · ${deviceLabel(row)}`, row => row.users)
      : sumBy(filteredRows, row => `${platformLabel(row.platform)} · ${deviceLabel(row)}`, row => row.users),
    10,
    ['#22C55E', '#9B5CFF', '#3B82F6', '#F59E0B', '#8B5CF6'],
  ), [exactDeviceRows, filteredRows, selectedVersions]);
  const osChartData = useMemo(() => mapToChartData(
    exactOsRows.length && !selectedVersions.length
      ? sumBy(exactOsRows, row => `${platformLabel(row.platform)} · ${row.os || '—'}`, row => row.users)
      : sumBy(filteredRows, row => `${platformLabel(row.platform)} · ${row.os || '—'}`, row => row.users),
    10,
    ['#3B82F6', '#22C55E', '#9B5CFF', '#F59E0B', '#06B6D4'],
  ), [exactOsRows, filteredRows, selectedVersions]);
  const androidBuildData = useMemo(() => {
    if (exactUserRows.length) {
      return mapToChartData(
        sumBy(exactUserRows.filter(row => row.platform === 'Android'), row => classifyAndroidStore(row.release), row => row.users),
        6,
        ['#22C55E', '#F59E0B', '#3B82F6', '#8B5CF6'],
      );
    }
    return buildAndroidStoreData(filteredRows);
  }, [exactUserRows, filteredRows]);
  const releaseCohortData = useMemo(() => buildReleaseCohortData(filteredRows), [filteredRows]);
  const historyTrend = useMemo(() => buildHistoryTrend(history), [history]);
  const topRelease = releaseSummary[0] || null;
  const topDevice = deviceChartData[0] || null;
  const topOs = osChartData[0] || null;
  const top5Concentration = topShare(filteredRows, 5);
  const androidRows = filteredRows.filter(row => row.platform === 'android');
  const androidUsers = androidRows.reduce((sum, row) => sum + Number(row.users || 0), 0);
  const androidBuildLeader = androidBuildData[0] || null;
  const exactAndroidUsers = exactUserRows.filter(row => row.platform === 'Android').reduce((sum, row) => sum + Number(row.users || 0), 0);
  const androidBuildTotal = exactAndroidUsers || androidUsers;
  const comboDeltaRows = useMemo(() => buildDeltaRows(
    sumBy(filteredRows, row => `${platformLabel(row.platform)} · ${row.release} · ${deviceLabel(row)} · ${row.os || '—'}`, row => row.users),
    sumBy(filterRows(previousSnapshot?.rows || [], moduleSettings, selectedVersions), row => `${platformLabel(row.platform)} · ${row.release} · ${deviceLabel(row)} · ${row.os || '—'}`, row => row.users),
    12,
  ), [filteredRows, moduleSettings, previousSnapshot, selectedVersions]);
  const releaseDeltaRows = useMemo(() => buildDeltaRows(
    sumBy(exactUserRows, row => `${row.platform} · ${row.release}`, row => row.users),
    sumBy(filterUserRecords(previousSnapshot?.userRecords || [], moduleSettings, selectedVersions), row => `${row.platform} · ${row.release}`, row => row.users),
    12,
  ), [exactUserRows, moduleSettings, previousSnapshot, selectedVersions]);
  const deviceDeltaRows = useMemo(() => buildDeltaRows(
    sumBy(exactDeviceRows, row => `${platformLabel(row.platform)} · ${deviceLabel(row)}`, row => row.users),
    sumBy(filterDeviceRows(previousSnapshot?.deviceRows || [], moduleSettings), row => `${platformLabel(row.platform)} · ${deviceLabel(row)}`, row => row.users),
    12,
  ), [exactDeviceRows, moduleSettings, previousSnapshot]);
  const totalDelta = previousTotals ? totalUsers - (previousTotals.android + previousTotals.ios) : 0;
  const totalDeltaPct = previousTotals && previousTotals.android + previousTotals.ios > 0
    ? (totalDelta / (previousTotals.android + previousTotals.ios)) * 100
    : null;
  const dataWarnings = useMemo(() => buildDataWarnings({
    hasCookie: Boolean(settings.biCookie),
    proxyError: settings.useProxy !== false && proxyState === 'error',
    rows: currentRows,
    totals,
    previousTotals,
    top5Concentration,
  }), [currentRows, previousTotals, proxyState, settings.biCookie, settings.useProxy, top5Concentration, totals]);
  const hasRows = currentRows.length > 0;

  const load = useCallback(async () => {
    if (!String(settings.biCookie || '').trim()) {
      setError('Нужен WB BI Cookie в общих настройках.');
      setStatus('Нужен WB BI Cookie в общих настройках.');
      setStatusTone('error');
      return;
    }

    setLoading(true);
    setError('');
    setStatus('Загружаю BI версии, устройства и OS.');
    setStatusTone('neutral');

    try {
      const payload = await fetchBiAudienceComposite({
        base: settings.ytBase,
        token: settings.ytToken,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        biCookie: settings.biCookie,
      }, {
        interval,
      });

      const snapshot: AudienceSnapshot = {
        time: payload.fetchedAt,
        rows: payload.rows,
        totals: payload.totals,
        dataSourceId: 0,
        interval,
        userRecords: payload.userRecords || [],
        deviceRows: payload.deviceRows || [],
        osRows: payload.osRows || [],
      };
      const nextHistory = appendBiSnapshot(HISTORY_KEY, history, snapshot, HISTORY_LIMIT);
      setHistory(nextHistory);
      setSelectedSnapshotTimes([]);
      setStatus(`Срез обновлён: ${formatSnapshotLabel(payload.fetchedAt)} · ${payload.rows.length} строк.`);
      setStatusTone(payload.rows.length ? 'ok' : 'warn');

      try {
        await biDriveFetch(runtimeSettings, buildBiDriveSaveUrl(HISTORY_FILE), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextHistory),
        });
        setDriveState('ok');
      } catch {
        setDriveState('error');
        setStatus('Срез обновлён локально, но Drive не синхронизирован.');
        setStatusTone('warn');
      }
    } catch (loadError) {
      const message = (loadError as Error).message || 'Не удалось загрузить BI срез.';
      setError(message);
      setStatus(message);
      setStatusTone('error');
    } finally {
      setLoading(false);
    }
  }, [history, interval, runtimeSettings, settings]);

  const handleSummaryCsv = useCallback(() => {
    downloadCsv([
      ['platform', 'release', 'users', 'share_pct', 'top_device', 'top_os'],
      ...releaseSummary.map(row => [
        platformLabel(row.platform),
        row.release,
        String(row.users),
        row.share.toFixed(2),
        row.topDevice,
        row.topOs,
      ]),
    ], 'bi-audience-releases.csv');
  }, [releaseSummary]);

  const handleRegressionCsv = useCallback(() => {
    downloadCsv([
      ['platform', 'release', 'device', 'os', 'users', 'share_pct'],
      ...regressionRows.map(row => [
        platformLabel(row.platform),
        row.release,
        deviceLabel(row),
        row.os || '',
        String(row.users),
        formatShare(row.share || (row.total ? row.users / row.total : 0)),
      ]),
    ], 'bi-audience-regression.csv');
  }, [regressionRows]);

  const handleDeltaCsv = useCallback(() => {
    downloadCsv([
      ['type', 'label', 'current', 'previous', 'delta', 'delta_pct'],
      ...releaseDeltaRows.map(row => ['release', row.label, String(row.now), String(row.prev), String(row.delta), formatSignedPercent(row.deltaPct)]),
      ...deviceDeltaRows.map(row => ['device', row.label, String(row.now), String(row.prev), String(row.delta), formatSignedPercent(row.deltaPct)]),
      ...comboDeltaRows.map(row => ['combo', row.label, String(row.now), String(row.prev), String(row.delta), formatSignedPercent(row.deltaPct)]),
    ], 'bi-audience-delta.csv');
  }, [comboDeltaRows, deviceDeltaRows, releaseDeltaRows]);

  const handlePdfExport = useCallback(async () => {
    const node = exportRef.current;
    if (!node) {
      setError('Не удалось найти блок для PDF.');
      return;
    }
    setExportingPdf(true);
    try {
      const { html2canvas, jsPDF } = await ensurePdfLibraries();
      const canvas = await html2canvas(node, {
        backgroundColor: chartThemeColors.surface,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      let width = maxWidth;
      let height = (canvas.height / canvas.width) * width;
      if (height > maxHeight) {
        height = maxHeight;
        width = height / (canvas.height / canvas.width);
      }
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', (pageWidth - width) / 2, margin, width, height, undefined, 'FAST');
      pdf.save(`wb-bi-audience-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (pdfError) {
      setError((pdfError as Error).message || 'Не удалось собрать PDF.');
    } finally {
      setExportingPdf(false);
    }
  }, [chartThemeColors.surface]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(59,130,246,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◎</div>
        BI аудитория
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Составной BI источник</CardTitle>
            <CardHint>Используем уже зашитые datasource: пользователи по версиям, популярные устройства и версии OS. Матрица расчетная, потому что текущие источники не дают настоящего user-level пересечения.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Badge color={statusBadgeColor(statusTone)}>{status}</Badge>
            <Badge color={driveState === 'ok' ? 'green' : driveState === 'error' ? 'red' : 'gray'}>drive {driveState}</Badge>
            <Badge color={settings.biCookie ? 'blue' : 'red'}>{settings.biCookie ? 'bi cookie ready' : 'bi cookie missing'}</Badge>
          </div>
        </CardHeader>
        <CardBody style={{ paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <FieldLabel>Interval</FieldLabel>
              <Select value={interval} onChange={event => setInterval(normalizeBiInterval(event.target.value))} style={{ width: 180 }}>
                {BI_INTERVAL_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </Select>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="blue">versions: {BI_AUDIENCE_COMPOSITE_SOURCE.usersDataSourceId}</Badge>
              <Badge color="green">devices: {BI_AUDIENCE_COMPOSITE_SOURCE.devicesDataSourceId}</Badge>
              <Badge color="purple">os: {BI_AUDIENCE_COMPOSITE_SOURCE.osDataSourceId}</Badge>
            </div>
            <Button variant="primary" onClick={() => void load()} disabled={loading}>
              {loading ? '...' : '⟳ Обновить'}
            </Button>
            <Button variant="ghost" onClick={handleSummaryCsv} disabled={!releaseSummary.length}>CSV версии</Button>
            <Button variant="ghost" onClick={handleDeltaCsv} disabled={!previousSnapshot}>CSV delta</Button>
            <Button variant="ghost" onClick={handleRegressionCsv} disabled={!regressionRows.length}>CSV регрессия</Button>
            <Button variant="ghost" onClick={() => void handlePdfExport()} disabled={!hasRows || exportingPdf}>{exportingPdf ? 'PDF...' : 'PDF'}</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <FieldLabel>Платформа</FieldLabel>
              <SegmentControl
                items={[
                  { label: 'Все', value: 'all' },
                  { label: 'Android', value: 'android' },
                  { label: 'iOS', value: 'ios' },
                ]}
                value={focusPlatform}
                onChange={value => setFocusPlatform(value as FocusPlatform)}
              />
            </div>
            <div>
              <FieldLabel>Версии</FieldLabel>
              <VersionFilterSelect
                options={versionOptions}
                selected={selectedVersions}
                onChange={setSelectedVersions}
              />
            </div>
            <div>
              <FieldLabel>Top</FieldLabel>
              <SegmentControl
                items={[
                  { label: '10', value: '10' },
                  { label: '20', value: '20' },
                  { label: '30', value: '30' },
                ]}
                value={topCount}
                onChange={setTopCount}
              />
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="gray">current: {currentSnapshot ? formatSnapshotLabel(currentSnapshot.time) : '—'}</Badge>
              <Badge color="gray">prev: {previousSnapshot ? formatSnapshotLabel(previousSnapshot.time) : '—'}</Badge>
              <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
                proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
              </Badge>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Снэпшоты для сравнения</CardTitle>
            <CardHint>Выбранные срезы управляют текущим состоянием, предыдущим срезом и delta-аналитикой.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedSnapshotTimes(snapshotOptions.slice(0, SNAPSHOT_COMPARE_LIMIT).map(snapshot => snapshot.time))}>
              Последние {SNAPSHOT_COMPARE_LIMIT}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedSnapshotTimes([])}>Сброс</Button>
          </div>
        </CardHeader>
        <CardBody style={{ paddingTop: 8 }}>
          {!snapshotOptions.length ? (
            <EmptyState text="История BI аудитории пока пуста." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
              {snapshotOptions.map(snapshot => {
                const checked = selectedSnapshotTimes.includes(snapshot.time);
                return (
                  <label
                    key={snapshot.time}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--surface-soft-4)',
                      background: checked ? 'var(--card-hi)' : 'var(--surface-soft)',
                    }}
                  >
                    <span>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{formatSnapshotLabel(snapshot.time)}</span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--text-3)' }}>{snapshot.rows.length} комбинаций · {snapshot.interval}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => {
                        const next = event.target.checked
                          ? [...selectedSnapshotTimes, snapshot.time]
                          : selectedSnapshotTimes.filter(item => item !== snapshot.time);
                        setSelectedSnapshotTimes(next.slice(-SNAPSHOT_COMPARE_LIMIT));
                      }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#F87171' }}>
          {error}
        </div>
      )}

      {dataWarnings.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Контроль качества данных</CardTitle>
              <CardHint>Сигналы, которые стоит проверить перед использованием отчёта.</CardHint>
            </div>
            <Badge color="yellow">{dataWarnings.length}</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
              {dataWarnings.map(item => (
                <div key={item} style={{ padding: '9px 11px', borderRadius: 10, border: '1px solid rgba(245,158,11,.22)', background: 'rgba(245,158,11,.08)', color: 'var(--text-2)', fontSize: 12, lineHeight: 1.45 }}>
                  {item}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {!hasRows ? (
        <Card>
          <EmptyState text="Нажмите «Обновить», чтобы загрузить версии, устройства и OS из зашитых BI datasource." />
        </Card>
      ) : (
        <div ref={exportRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <MetricTile
              label="Всего пользователей"
              value={formatNumber(totalUsers)}
              color="#3B82F6"
              sub={
                <span style={{ display: 'flex', gap: 12 }}>
                  <span><span style={{ color: '#22C55E', fontWeight: 700 }}>Android</span>{' '}{formatNumber(totals.android)}</span>
                  <span><span style={{ color: '#9B5CFF', fontWeight: 700 }}>iOS</span>{' '}{formatNumber(totals.ios)}</span>
                </span>
              }
            />
            <MetricTile label="Δ к предыдущему" value={previousSnapshot ? formatSigned(totalDelta) : '—'} color={totalDelta >= 0 ? '#22C55E' : '#EF4444'}
              sub={previousTotals ? (
                <span style={{ display: 'flex', gap: 12 }}>
                  <span><span style={{ color: '#22C55E', fontWeight: 700 }}>A</span>{' '}{formatSigned(totals.android - previousTotals.android)}</span>
                  <span><span style={{ color: '#9B5CFF', fontWeight: 700 }}>i</span>{' '}{formatSigned(totals.ios - previousTotals.ios)}</span>
                </span>
              ) : undefined}
            />
            <MetricTile label="Версий в срезе" value={formatNumber(uniqueReleases)} />
            <MetricTile label="Устройств" value={formatNumber(uniqueDevices)} color="#22C55E" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <InsightTile
              label="Top версия"
              value={topRelease ? topRelease.release : '—'}
              meta={topRelease ? `${platformLabel(topRelease.platform)} · ${formatNumber(topRelease.users)} users · ${topRelease.share.toFixed(2)}%` : 'Нет данных'}
              color={topRelease?.platform === 'android' ? '#22C55E' : '#9B5CFF'}
            />
            <InsightTile
              label="Top устройство"
              value={topDevice?.label || '—'}
              meta={topDevice ? `${formatNumber(topDevice.value)} расчетных users` : 'Нет данных'}
              color="#22C55E"
            />
            <InsightTile
              label="Top OS"
              value={topOs?.label || '—'}
              meta={topOs ? `${formatNumber(topOs.value)} расчетных users` : 'Нет данных'}
              color="#3B82F6"
            />
            <InsightTile
              label="Концентрация top-5"
              value={`${top5Concentration.toFixed(1)}%`}
              meta="Доля пяти крупнейших расчетных комбинаций"
              color={top5Concentration > 60 ? '#F59E0B' : '#22C55E'}
            />
            <InsightTile
              label="Δ %"
              value={previousSnapshot ? formatSignedPercent(totalDeltaPct) : '—'}
              meta="Изменение общей аудитории к предыдущему срезу"
              color={totalDelta >= 0 ? '#22C55E' : '#EF4444'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Платформы</CardTitle>
                  <CardHint>Суммарная аудитория Android и iOS из datasource устройств/OS.</CardHint>
                </div>
                <Badge color="blue">{formatNumber(totalUsers)}</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                <VerticalBarChart data={platformChartData} themeColors={chartThemeColors} height={240} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Динамика снэпшотов</CardTitle>
                  <CardHint>История последних сохранённых составных BI срезов.</CardHint>
                </div>
                <Badge color="gray">{historyTrend.length} срезов</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                {historyTrend.length > 1 ? <HistoryTrendChart rows={historyTrend} themeColors={chartThemeColors} /> : <EmptyState text="Нужно минимум два снэпшота для графика динамики." />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Top версий</CardTitle>
                  <CardHint>Самые массовые версии с учётом выбранной платформы и фильтра.</CardHint>
                </div>
                <Badge color="blue">{releaseChartData.length}</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                <HorizontalBarChart data={releaseChartData} themeColors={chartThemeColors} height={Math.max(240, releaseChartData.length * 31 + 36)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Top устройств</CardTitle>
                  <CardHint>Популярные устройства в расчетных комбинациях.</CardHint>
                </div>
                <Badge color="green">{deviceChartData.length}</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                <HorizontalBarChart data={deviceChartData} themeColors={chartThemeColors} height={Math.max(240, deviceChartData.length * 31 + 36)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Top OS</CardTitle>
                  <CardHint>Версии операционных систем из datasource OS.</CardHint>
                </div>
                <Badge color="purple">{osChartData.length}</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                <HorizontalBarChart data={osChartData} themeColors={chartThemeColors} height={Math.max(240, osChartData.length * 31 + 36)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Android — тип сборки</CardTitle>
                  <CardHint>Распределение пользователей Android по каналу сборки из имени версии: RuStore, Huawei, Google Play/base.</CardHint>
                </div>
                <Badge color="green">{formatNumber(androidUsers)}</Badge>
              </CardHeader>
              <CardBody style={{ paddingTop: 8 }}>
                {androidBuildData.length ? <VerticalBarChart data={androidBuildData} themeColors={chartThemeColors} height={240} /> : <EmptyState text="Нет Android данных для разреза по типу сборки." />}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Дополнительные разрезы</CardTitle>
                <CardHint>Группы версий и типы Android-сборок помогают понять, какие сценарии должны попасть в регрессию.</CardHint>
              </div>
              <Badge color="gray">analytics</Badge>
            </CardHeader>
            <CardBody style={{ paddingTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Группы версий</div>
                  <div style={{ height: 260, minHeight: 260, maxHeight: 260 }}>
                    <HorizontalBarChart data={releaseCohortData} themeColors={chartThemeColors} height={260} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Android — тип сборки</div>
                  <Table style={{ borderRadius: 12, border: '1px solid var(--border)' }}>
                    <thead>
                      <tr>
                        <Th>Тип</Th>
                        <Th style={{ textAlign: 'right' }}>Users</Th>
                        <Th style={{ width: 220 }}>Доля</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {androidBuildData.map(row => (
                        <tr key={row.label}>
                          <Td bold>{row.label}</Td>
                          <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.value)}</Td>
                          <Td><ShareBar value={androidUsers ? row.value / androidUsers : 0} color={row.color || '#22C55E'} /></Td>
                        </tr>
                      ))}
                      {!androidBuildData.length && (
                        <tr>
                          <Td colSpan={3}>Нет Android данных.</Td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    Лидер: <b style={{ color: 'var(--text)' }}>{androidBuildLeader?.label || '—'}</b>
                    {androidBuildLeader ? ` · ${formatNumber(androidBuildLeader.value)} расчетных users` : ''}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top расчетных комбинаций</CardTitle>
                <CardHint>Версия × устройство × OS построены из независимых BI распределений, чтобы быстро выбрать репрезентативные проверки.</CardHint>
              </div>
              <Badge color={platformBadgeColor(focusPlatform)}>{platformLabel(focusPlatform)}</Badge>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Платформа</Th>
                  <Th>Версия</Th>
                  <Th>Устройство</Th>
                  <Th>OS</Th>
                  <Th style={{ textAlign: 'right' }}>Users</Th>
                  <Th style={{ width: 220 }}>Доля</Th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((row, index) => (
                  <tr key={`${rowKey(row)}:${index}`}>
                    <Td mono>{index + 1}</Td>
                    <Td><Badge color={platformBadgeColor(row.platform)}>{platformLabel(row.platform)}</Badge></Td>
                    <Td mono bold>{row.release}</Td>
                    <Td bold>{deviceLabel(row)}</Td>
                    <Td mono>{row.os || '—'}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                    <Td><ShareBar value={row.share || (row.total ? row.users / row.total : 0)} color={row.platform === 'android' ? '#22C55E' : '#9B5CFF'} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Delta / growth</CardTitle>
                <CardHint>Изменения относительно предыдущего выбранного снэпшота: версии, устройства и расчетные комбинации.</CardHint>
              </div>
              <Badge color={previousSnapshot ? 'blue' : 'gray'}>{previousSnapshot ? `${formatSnapshotLabel(previousSnapshot.time)} → ${formatSnapshotLabel(currentSnapshot?.time || '')}` : 'нет сравнения'}</Badge>
            </CardHeader>
            <CardBody style={{ paddingTop: 8 }}>
              {!previousSnapshot ? (
                <EmptyState text="Выберите минимум два снэпшота для delta-аналитики." />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                  {[
                    { title: 'Версии', rows: releaseDeltaRows },
                    { title: 'Устройства', rows: deviceDeltaRows },
                    { title: 'Комбинации', rows: comboDeltaRows },
                  ].map(section => (
                    <div key={section.title} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                        {section.title}
                      </div>
                      <Table style={{ borderRadius: 0 }}>
                        <thead>
                          <tr>
                            <Th>{section.title === 'Комбинации' ? 'Сценарий' : 'Значение'}</Th>
                            <Th style={{ textAlign: 'right' }}>Δ</Th>
                            <Th style={{ textAlign: 'right' }}>%</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.slice(0, 6).map(row => (
                            <tr key={`${section.title}:${row.label}`}>
                              <Td style={{ maxWidth: 220, whiteSpace: 'normal', lineHeight: 1.35 }}>{row.label}</Td>
                              <Td style={{ textAlign: 'right', color: row.delta >= 0 ? '#22C55E' : '#EF4444', fontVariantNumeric: 'tabular-nums' }}>{formatSigned(row.delta)}</Td>
                              <Td style={{ textAlign: 'right', color: row.delta >= 0 ? '#22C55E' : '#EF4444', fontVariantNumeric: 'tabular-nums' }}>{formatSignedPercent(row.deltaPct)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Точная таблица версий</CardTitle>
                <CardHint>Для каждой версии показываем наиболее вероятные device и OS hints из текущих популярных устройств.</CardHint>
              </div>
              <Badge color="blue">{releaseSummary.length} версий</Badge>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>Платформа</Th>
                  <Th>Версия</Th>
                  <Th>Top device</Th>
                  <Th>Top OS</Th>
                  <Th style={{ textAlign: 'right' }}>Устройств</Th>
                  <Th style={{ textAlign: 'right' }}>OS</Th>
                  <Th style={{ textAlign: 'right' }}>Users</Th>
                  <Th style={{ width: 190 }}>Доля платформы</Th>
                </tr>
              </thead>
              <tbody>
                {releaseSummary.map(row => (
                  <tr key={`${row.platform}:${row.release}`}>
                    <Td><Badge color={platformBadgeColor(row.platform)}>{platformLabel(row.platform)}</Badge></Td>
                    <Td mono bold>{row.release}</Td>
                    <Td>{row.topDevice}</Td>
                    <Td mono>{row.topOs}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.devices)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.osVersions)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                    <Td><ShareBar value={row.share} color={row.platform === 'android' ? '#22C55E' : '#9B5CFF'} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Точные устройства</CardTitle>
                  <CardHint>Исходные строки datasource {BI_AUDIENCE_COMPOSITE_SOURCE.devicesDataSourceId}, без расчетной матрицы.</CardHint>
                </div>
                <Badge color="green">{exactDeviceRows.length}</Badge>
              </CardHeader>
              <Table>
                <thead>
                  <tr>
                    <Th>Платформа</Th>
                    <Th>Устройство</Th>
                    <Th style={{ textAlign: 'right' }}>Users</Th>
                    <Th style={{ width: 180 }}>Доля</Th>
                  </tr>
                </thead>
                <tbody>
                  {exactDeviceRows.slice(0, limit).map(row => (
                    <tr key={`${row.platform}:${row.manufacturer}:${row.model}`}>
                      <Td><Badge color={platformBadgeColor(row.platform)}>{platformLabel(row.platform)}</Badge></Td>
                      <Td bold>{deviceLabel(row)}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                      <Td><ShareBar value={row.share} color={row.platform === 'android' ? '#22C55E' : '#9B5CFF'} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Точные OS</CardTitle>
                  <CardHint>Исходные строки datasource {BI_AUDIENCE_COMPOSITE_SOURCE.osDataSourceId}.</CardHint>
                </div>
                <Badge color="purple">{exactOsRows.length}</Badge>
              </CardHeader>
              <Table>
                <thead>
                  <tr>
                    <Th>Платформа</Th>
                    <Th>OS</Th>
                    <Th style={{ textAlign: 'right' }}>Users</Th>
                    <Th style={{ width: 180 }}>Доля</Th>
                  </tr>
                </thead>
                <tbody>
                  {exactOsRows.slice(0, limit).map(row => (
                    <tr key={`${row.platform}:${row.os}`}>
                      <Td><Badge color={platformBadgeColor(row.platform)}>{platformLabel(row.platform)}</Badge></Td>
                      <Td mono bold>{row.os}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                      <Td><ShareBar value={row.share} color={row.platform === 'android' ? '#22C55E' : '#9B5CFF'} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Матрица для регрессии</CardTitle>
                <CardHint>Набор строится из самых массовых расчетных комбинаций: версия, устройство и OS берутся из существующих BI datasource.</CardHint>
              </div>
              <Badge color="blue">{regressionRows.length} комбинаций</Badge>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>Платформа</Th>
                  <Th>Версия</Th>
                  <Th>Устройство</Th>
                  <Th>OS</Th>
                  <Th style={{ textAlign: 'right' }}>Users</Th>
                  <Th style={{ textAlign: 'right' }}>Доля</Th>
                </tr>
              </thead>
              <tbody>
                {regressionRows.map(row => (
                  <tr key={`reg:${rowKey(row)}`}>
                    <Td><Badge color={platformBadgeColor(row.platform)}>{platformLabel(row.platform)}</Badge></Td>
                    <Td mono bold>{row.release}</Td>
                    <Td>{deviceLabel(row)}</Td>
                    <Td mono>{row.os || '—'}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatShare(row.share || (row.total ? row.users / row.total : 0))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
