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
  Input,
  Select,
  SegmentControl,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useApp, type ThemeMode } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy, proxyFetch } from '../../services/proxy';
import { fetchBiUsersSnapshot, type BiUserRecord } from '../../services/youtrack';

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

const SETTINGS_KEY = 'bi_users_calc_settings_v1';
const HISTORY_KEY = 'bi_users_history';
const CACHE_KEY = 'wb_local_cache';
const HISTORY_LIMIT = 50;
const SNAP_LIMIT = 20;
const SNAP_DEFAULT = 4;
const CHART_SNAP_MAX = 4;
const SUMMARY_TOP_LIMIT = 20;
const DRIVE = {
  url: 'https://script.google.com/macros/s/AKfycby1MNW_-mbMh8ukBs94kOc0KXM43yZae7gmCgSLoK9a4Tx3F0JY4lMdQHoWhxyJ1j1XYQ/exec',
  historyFile: 'bi_users_history.json',
  cacheFile: 'wb_local_cache.json',
};
const INTERVAL_OPTIONS = ['today', 'yesterday', 'last_2_days', 'last_7_days', 'last_30_days'] as const;
const BAR_COLORS = ['#6f1d7a', '#2e7d32', '#1565c0', '#ef6c00'];

type SnapshotPlatform = 'iOS' | 'Android';
type ViewMode = 'full' | 'top8' | 'selected';
type OrderDirection = 'desc' | 'asc';
type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';

interface BiSnapshot {
  time: string;
  records: BiUserRecord[];
}

interface ModuleSettings {
  platforms: SnapshotPlatform[];
  interval: string;
  snapFrom: string;
  snapTo: string;
  selectedSnapshotTimes: string[];
  selectedReleases: string[];
  chartShowIos: boolean;
  chartShowAndroid: boolean;
  viewMode: ViewMode;
  showCount: string;
  orderDirection: OrderDirection;
  sumPlat: 'all' | 'iOS' | 'Android';
  sumRel: string;
  summarySort: OrderDirection;
}

interface DeltaChartModel {
  shortLabels: string[];
  fullLabels: string[];
  datasets: Array<{ label: string; data: number[]; color: string }>;
  latestValues: number[];
  deltas: number[];
  metaDates: string[];
}

interface TrendChartModel {
  labels: string[];
  ios: number[];
  android: number[];
  total: number[];
}

interface SummaryRecord extends BiUserRecord {}

interface GrowthRow {
  plat: 'ios' | 'android';
  key: string;
  t: number;
  t1: number;
  t2: number;
  t3: number;
  d: number;
  dp: number | null;
}

interface ChartThemeColors {
  text: string;
  text2: string;
  text3: string;
  grid: string;
  border: string;
  surface: string;
  labelStrong: string;
  font: string;
  mono: string;
  green: string;
  red: string;
}

const DEFAULT_MODULE_SETTINGS: ModuleSettings = {
  platforms: ['iOS', 'Android'],
  interval: 'last_2_days',
  snapFrom: '',
  snapTo: '',
  selectedSnapshotTimes: [],
  selectedReleases: [],
  chartShowIos: true,
  chartShowAndroid: true,
  viewMode: 'full',
  showCount: '10',
  orderDirection: 'desc',
  sumPlat: 'all',
  sumRel: '',
  summarySort: 'desc',
};

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getChartThemeColors(theme: ThemeMode): ChartThemeColors {
  return {
    text: readCssVar('--text', '#EEEAF8'),
    text2: readCssVar('--text-2', '#9D96B4'),
    text3: readCssVar('--text-3', '#5F5878'),
    grid: readCssVar('--chart-grid', 'rgba(255,255,255,.05)'),
    border: readCssVar('--border', 'rgba(255,255,255,.07)'),
    surface: readCssVar('--surface', '#111118'),
    labelStrong: theme === 'light' || theme === 'sepia' ? '#000000' : '#FFFFFF',
    font: readCssVar('--font', 'Inter, system-ui, -apple-system, sans-serif'),
    mono: readCssVar('--mono', 'IBM Plex Mono, SFMono-Regular, Consolas, monospace'),
    green: readCssVar('--green', '#22C55E'),
    red: readCssVar('--red', '#EF4444'),
  };
}

interface LabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(a: LabelRect, b: LabelRect) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

function placeLabelRect(
  ctx: CanvasRenderingContext2D,
  text: string,
  baseX: number,
  baseY: number,
  chartArea: { left: number; right: number; top: number; bottom: number },
  occupied: LabelRect[],
  options?: {
    align?: CanvasTextAlign;
    stepY?: number;
    minTop?: number;
    marginX?: number;
  },
) {
  const align = options?.align || 'center';
  const marginX = options?.marginX ?? 4;
  const stepY = options?.stepY ?? 16;
  const minTop = options?.minTop ?? (chartArea.top + 4);
  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = 14;
  let x = baseX;
  let y = baseY;

  const rectFor = (rx: number, ry: number): LabelRect => {
    const left = align === 'left' ? rx : align === 'right' ? rx - width : rx - width / 2;
    return {
      left: Math.max(chartArea.left + marginX, left),
      top: ry - height,
      right: Math.min(chartArea.right - marginX, Math.max(chartArea.left + marginX, left) + width),
      bottom: ry + 2,
    };
  };

  let rect = rectFor(x, y);
  let attempts = 0;

  while (occupied.some(item => overlaps(rect, item)) && attempts < 12) {
    y -= stepY;
    if (y - height < minTop) {
      y = minTop + height + attempts * 2;
      x += align === 'center' ? (attempts % 2 === 0 ? 10 : -10) : 0;
    }
    rect = rectFor(x, y);
    attempts += 1;
  }

  occupied.push(rect);
  return {
    x: align === 'left' ? rect.left : align === 'right' ? rect.right : (rect.left + rect.right) / 2,
    y: rect.bottom - 2,
    align,
  };
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

  return {
    html2canvas: runtime.html2canvas,
    jsPDF: runtime.jspdf.jsPDF,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
}

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function formatSigned(value: number) {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatSignedPercent(value: number | null) {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function MetricTile({
  label,
  value,
  meta,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
}) {
  const toneColor = tone === 'positive'
    ? '#22C55E'
    : tone === 'negative'
      ? '#EF4444'
      : tone === 'accent'
        ? '#9B5CFF'
        : 'var(--text)';

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface-soft)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 92,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor, lineHeight: 1.1 }}>{value}</div>
      {meta ? <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>{meta}</div> : null}
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
  actions,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 16,
        background: 'var(--surface-soft)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          {hint ? <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface-soft)' }}>
      {children}
    </div>
  );
}

function stripedRowStyle(index: number): React.CSSProperties {
  return index % 2 === 1 ? { background: 'var(--surface-soft-2)' } : {};
}

function shortVersion(version: string) {
  const parts = String(version || '').split('.');
  if (parts.length < 3) return version;
  const major = parts[0];
  const minor = parts[1];
  const patchDigits = (parts[2].match(/\d+/) || ['0'])[0];
  const th = patchDigits[0] || '0';
  const un = patchDigits[3] || '';
  return `${major}${minor}${th}${un && un !== '0' ? un : ''}`;
}

function normalizeReleaseName(raw: string) {
  let value = String(raw || '').trim();
  const inParens = value.match(/\(([^)]+)\)/);
  if (inParens && inParens[1]) value = inParens[1].trim();
  return value
    .replace(/[™©®]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

function parseVersionSemver(raw: string) {
  const normalized = normalizeReleaseName(raw);
  const match = normalized.match(/^(\d+(?:\.\d+){1,3})(?:-([\w.\-]+))?$/);
  const core = match ? match[1] : normalized;
  const tag = match?.[2] ? match[2].toLowerCase() : '';
  const nums = core.split('.').map(part => parseInt((part.match(/\d+/) || ['0'])[0], 10) || 0);
  while (nums.length < 4) nums.push(0);
  return { tag, nums };
}

function cmpSemver(a: string, b: string) {
  const left = parseVersionSemver(a);
  const right = parseVersionSemver(b);
  const size = Math.max(left.nums.length, right.nums.length);
  for (let index = 0; index < size; index += 1) {
    const delta = (left.nums[index] || 0) - (right.nums[index] || 0);
    if (delta !== 0) return delta;
  }
  if (left.tag !== right.tag) {
    if (!left.tag && right.tag) return 1;
    if (left.tag && !right.tag) return -1;
    return left.tag.localeCompare(right.tag, 'ru', { numeric: true, sensitivity: 'base' });
  }
  return 0;
}

function isDummyNine(raw: string) {
  const parsed = parseVersionSemver(raw);
  return parsed.nums[0] === 9 && parsed.nums[1] === 9 && parsed.nums[2] === 9999;
}

function readJwtState() {
  try {
    return localStorage.getItem('bi_key_jwt') ? 'есть' : '—';
  } catch {
    return '—';
  }
}

function normalizeModuleSettings(input: unknown): ModuleSettings {
  const value = (input && typeof input === 'object') ? input as Partial<ModuleSettings> : {};
  const platforms = Array.isArray(value.platforms)
    ? value.platforms.filter((item): item is SnapshotPlatform => item === 'iOS' || item === 'Android')
    : DEFAULT_MODULE_SETTINGS.platforms;

  return {
    platforms: platforms.length ? platforms : DEFAULT_MODULE_SETTINGS.platforms,
    interval: typeof value.interval === 'string' && value.interval ? value.interval : DEFAULT_MODULE_SETTINGS.interval,
    snapFrom: typeof value.snapFrom === 'string' ? value.snapFrom : DEFAULT_MODULE_SETTINGS.snapFrom,
    snapTo: typeof value.snapTo === 'string' ? value.snapTo : DEFAULT_MODULE_SETTINGS.snapTo,
    selectedSnapshotTimes: Array.isArray(value.selectedSnapshotTimes) ? value.selectedSnapshotTimes.map(item => String(item || '')).filter(Boolean) : [],
    selectedReleases: Array.isArray(value.selectedReleases) ? value.selectedReleases.map(item => String(item || '')).filter(Boolean) : [],
    chartShowIos: value.chartShowIos !== false,
    chartShowAndroid: value.chartShowAndroid !== false,
    viewMode: value.viewMode === 'top8' || value.viewMode === 'selected' ? value.viewMode : DEFAULT_MODULE_SETTINGS.viewMode,
    showCount: typeof value.showCount === 'string' && value.showCount ? value.showCount : DEFAULT_MODULE_SETTINGS.showCount,
    orderDirection: value.orderDirection === 'asc' ? 'asc' : 'desc',
    sumPlat: value.sumPlat === 'iOS' || value.sumPlat === 'Android' ? value.sumPlat : 'all',
    sumRel: typeof value.sumRel === 'string' ? value.sumRel : DEFAULT_MODULE_SETTINGS.sumRel,
    summarySort: value.summarySort === 'asc' ? 'asc' : 'desc',
  };
}

function readModuleSettings() {
  try {
    return normalizeModuleSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
  } catch {
    return DEFAULT_MODULE_SETTINGS;
  }
}

function writeModuleSettings(settings: ModuleSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function normalizeSnapshot(input: unknown): BiSnapshot | null {
  const value = input as { time?: unknown; records?: unknown[] };
  const time = String(value?.time || '').trim();
  if (!time || Number.isNaN(Date.parse(time))) return null;
  const records = Array.isArray(value?.records)
    ? value.records.map(record => {
        const item = record as Partial<BiUserRecord>;
        const platform = item.platform === 'iOS' || item.platform === 'Android' ? item.platform : null;
        if (!platform) return null;
        return {
          platform,
          release: String(item.release || '').trim(),
          users: Number(item.users || 0),
          share: item.share == null ? null : Number(item.share),
        } satisfies BiUserRecord;
      }).filter(Boolean) as BiUserRecord[]
    : [];
  return { time, records };
}

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeSnapshot)
      .filter((item): item is BiSnapshot => Boolean(item))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  } catch {
    return [];
  }
}

function writeHistory(history: BiSnapshot[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    /* ignore */
  }
}

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeCache(items: SummaryRecord[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function normalizeSnapshotsFromDrive(raw: unknown): BiSnapshot[] {
  const source = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
  const items = Array.isArray(source) ? source : source ? [source] : [];
  return items
    .map(normalizeSnapshot)
    .filter((item): item is BiSnapshot => Boolean(item));
}

function mergeHistory(localHistory: BiSnapshot[], driveHistory: BiSnapshot[]) {
  const byTime = new Map<string, BiSnapshot>();
  [...localHistory, ...driveHistory].forEach(snapshot => {
    byTime.set(snapshot.time, snapshot);
  });
  return [...byTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-HISTORY_LIMIT);
}

function persistSnapshot(history: BiSnapshot[], snapshot: BiSnapshot) {
  const next = [...history, snapshot].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-HISTORY_LIMIT);
  writeHistory(next);
  return next;
}

function filterHistoryByDate(history: BiSnapshot[], from: string, to: string) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  return history.filter(snapshot => {
    const time = new Date(snapshot.time);
    if (fromDate && time < fromDate) return false;
    if (toDate && time > toDate) return false;
    return true;
  });
}

function chooseSnapshots(history: BiSnapshot[], settings: ModuleSettings) {
  const filtered = filterHistoryByDate(history, settings.snapFrom, settings.snapTo);
  if (settings.selectedSnapshotTimes.length) {
    const selectedSet = new Set(settings.selectedSnapshotTimes);
    return filtered
      .filter(snapshot => selectedSet.has(snapshot.time))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
      .slice(-SNAP_LIMIT);
  }
  return filtered.slice(-SNAP_DEFAULT);
}

function aggregateSnapshotByRelease(snapshot: BiSnapshot, platforms: Set<string>) {
  const map = new Map<string, number>();
  snapshot.records.forEach(record => {
    const platform = String(record.platform || '').toLowerCase();
    if (platforms.size && !platforms.has(platform)) return;
    map.set(record.release, (map.get(record.release) || 0) + Number(record.users || 0));
  });
  return map;
}

function aggregateSnapshotByReleaseNormalized(snapshot: BiSnapshot, platforms: Set<string>) {
  const map = new Map<string, number>();
  snapshot.records.forEach(record => {
    const platform = String(record.platform || '').toLowerCase();
    if (platforms.size && !platforms.has(platform)) return;
    const key = normalizeReleaseName(record.release);
    map.set(key, (map.get(key) || 0) + Number(record.users || 0));
  });
  return map;
}

function calcTrend(history: BiSnapshot[]) {
  const labels: string[] = [];
  const ios: number[] = [];
  const android: number[] = [];
  const total: number[] = [];
  const dates = history.map(snapshot => new Date(snapshot.time));
  const min = dates[0];
  const max = dates[dates.length - 1];
  const spanDays = min && max ? ((max.getTime() - min.getTime()) / 86400000) : 0;
  const formatter = new Intl.DateTimeFormat('ru-RU', spanDays >= 1
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  history.forEach(snapshot => {
    const date = new Date(snapshot.time);
    if (Number.isNaN(date.getTime())) return;
    let iosTotal = 0;
    let androidTotal = 0;
    snapshot.records.forEach(record => {
      if (record.platform === 'iOS') iosTotal += Number(record.users || 0);
      if (record.platform === 'Android') androidTotal += Number(record.users || 0);
    });
    labels.push(formatter.format(date));
    ios.push(iosTotal);
    android.push(androidTotal);
    total.push(iosTotal + androidTotal);
  });

  return { labels, ios, android, total };
}

function classifyAndroidRelease(release: string) {
  const value = String(release || '').toLowerCase();
  if (value.includes('rustore')) return 'rustore';
  if (value.includes('huawei')) return 'huawei';
  return 'google';
}

function getPlatformsForFetch(settings: ModuleSettings) {
  return settings.platforms;
}

function getPlatformsForCharts(settings: ModuleSettings) {
  const set = new Set<string>();
  if (settings.chartShowIos && settings.platforms.includes('iOS')) set.add('ios');
  if (settings.chartShowAndroid && settings.platforms.includes('Android')) set.add('android');
  return set;
}

function getReleaseOrdering(maps: Map<string, number>[], latestMap: Map<string, number>, orderDirection: OrderDirection) {
  const score = new Map<string, number>();
  const totalSum = new Map<string, number>();
  const names = new Set<string>();

  maps.forEach(map => {
    map.forEach((value, key) => {
      names.add(key);
      totalSum.set(key, (totalSum.get(key) || 0) + value);
    });
  });

  latestMap.forEach((value, key) => {
    names.add(key);
    score.set(key, value || (totalSum.get(key) || 0));
  });

  names.forEach(key => {
    if (!score.has(key)) score.set(key, totalSum.get(key) || 0);
  });

  const dir = orderDirection === 'asc' ? 1 : -1;
  return [...names].sort((left, right) => {
    const delta = (score.get(left) || 0) - (score.get(right) || 0);
    if (delta !== 0) return dir * delta;
    return dir * left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' });
  });
}

function chooseReleases(
  maps: Map<string, number>[],
  latestMap: Map<string, number>,
  settings: ModuleSettings,
) {
  const ranking = getReleaseOrdering(maps, latestMap, settings.orderDirection);
  const selected = new Set(settings.selectedReleases);
  const limit = parseInt(settings.showCount, 10) || 10;
  let releases = ranking.slice();

  if (settings.viewMode === 'selected') {
    releases = selected.size ? ranking.filter(item => selected.has(item)) : [];
  } else if (settings.viewMode === 'top8') {
    releases = ranking.slice(0, 8);
  } else {
    releases = ranking.slice(0, limit);
    if (selected.size) {
      releases = releases.filter(item => selected.has(item));
    }
  }

  if (!releases.length) {
    const fallback = maps.find(map => map.size) || new Map<string, number>();
    releases = getReleaseOrdering([fallback], fallback, settings.orderDirection).slice(0, 8);
  }

  return releases;
}

function computeDeltaChartModel(history: BiSnapshot[], settings: ModuleSettings): DeltaChartModel | null {
  const lastFour = history.slice(-CHART_SNAP_MAX);
  if (!lastFour.length) return null;

  const platforms = getPlatformsForCharts(settings);
  const maps = lastFour.map(snapshot => aggregateSnapshotByRelease(snapshot, platforms));
  const latestMap = maps[maps.length - 1] || new Map<string, number>();
  const releases = chooseReleases(maps, latestMap, settings);
  if (!releases.length) return null;

  const metaDates = lastFour.map(snapshot => formatDateTime(snapshot.time));
  const datasets = maps.map((map, index) => ({
    label: index === maps.length - 1 ? `Текущий (${metaDates[index]})` : `t-${maps.length - 1 - index} (${metaDates[index]})`,
    data: releases.map(release => Number(map.get(release) || 0)),
    color: BAR_COLORS[index % BAR_COLORS.length],
  }));

  const previousMap = maps.length > 1 ? maps[maps.length - 2] : new Map<string, number>();
  return {
    shortLabels: releases.map(shortVersion),
    fullLabels: releases,
    datasets,
    latestValues: releases.map(release => Number(latestMap.get(release) || 0)),
    deltas: releases.map(release => Number(latestMap.get(release) || 0) - Number(previousMap.get(release) || 0)),
    metaDates,
  };
}

function computeTrendChartModel(history: BiSnapshot[]) {
  return calcTrend(history);
}

function toSummaryRecords(snapshot: BiSnapshot | null): SummaryRecord[] {
  if (!snapshot) return [];
  return snapshot.records.map(record => ({
    platform: record.platform,
    release: record.release,
    users: Number(record.users || 0),
    share: record.share == null ? null : Number(record.share),
  }));
}

function filterSummaryRows(rows: SummaryRecord[], settings: ModuleSettings) {
  const mask = String(settings.sumRel || '').trim().toLowerCase();
  let next = rows.slice();
  if (settings.sumPlat !== 'all') {
    next = next.filter(row => row.platform === settings.sumPlat);
  }
  if (mask) {
    next = next.filter(row => String(row.release || '').toLowerCase().includes(mask));
  }

  next.sort((left, right) => right.users - left.users);
  next = next.slice(0, SUMMARY_TOP_LIMIT);
  if (settings.summarySort === 'asc') {
    next.sort((left, right) => left.users - right.users);
  }
  return next;
}

function computeAndroidSummary(rows: SummaryRecord[]) {
  const androidRows = rows.filter(row => row.platform === 'Android');
  const total = androidRows.reduce((sum, row) => sum + Number(row.users || 0), 0);
  const counts = { rustore: 0, huawei: 0, google: 0 };

  androidRows.forEach(row => {
    const category = classifyAndroidRelease(row.release);
    counts[category] += Number(row.users || 0);
  });

  return [
    { label: 'Всего Android', users: total, share: total > 0 ? 100 : 0 },
    { label: 'RuStore', users: counts.rustore, share: total > 0 ? (counts.rustore / total) * 100 : 0 },
    { label: 'Huawei', users: counts.huawei, share: total > 0 ? (counts.huawei / total) * 100 : 0 },
    { label: 'Google', users: counts.google, share: total > 0 ? (counts.google / total) * 100 : 0 },
  ];
}

function getTopReleasesByPlatformFromSummary(rows: SummaryRecord[]) {
  const acc = { ios: new Map<string, number>(), android: new Map<string, number>() };
  rows.forEach(row => {
    const platform = row.platform === 'iOS' ? 'ios' : 'android';
    const key = normalizeReleaseName(row.release);
    if (!/^\d+(?:\.\d+){2,3}(?:-[\w.\-]+)?$/.test(key)) return;
    if (isDummyNine(key)) return;
    acc[platform].set(key, (acc[platform].get(key) || 0) + Number(row.users || 0));
  });
  return {
    ios: [...acc.ios.entries()].sort((left, right) => right[1] - left[1] || -cmpSemver(left[0], right[0])).slice(0, 4).map(([key]) => key),
    android: [...acc.android.entries()].sort((left, right) => right[1] - left[1] || -cmpSemver(left[0], right[0])).slice(0, 4).map(([key]) => key),
  };
}

function computeGrowth(history: BiSnapshot[], filteredRows: SummaryRecord[], settings: ModuleSettings) {
  const snapshots = chooseSnapshots(history, settings);
  const mapsAll = snapshots.map(snapshot => aggregateSnapshotByReleaseNormalized(snapshot, getPlatformsForCharts(settings)));
  const mapsIos = snapshots.map(snapshot => aggregateSnapshotByReleaseNormalized(snapshot, new Set(['ios'])));
  const mapsAndroid = snapshots.map(snapshot => aggregateSnapshotByReleaseNormalized(snapshot, new Set(['android'])));
  const topByPlatform = getTopReleasesByPlatformFromSummary(filteredRows);
  const platformFilter = String(settings.sumPlat || 'all').toLowerCase();
  const platformOrder = platformFilter === 'all' ? ['ios', 'android'] : [platformFilter];

  const rows: GrowthRow[] = [];
  platformOrder.forEach(platform => {
    const maps = platform === 'ios' ? mapsIos : platform === 'android' ? mapsAndroid : mapsAll;
    const latest = maps[maps.length - 1] || new Map<string, number>();
    let names = platform === 'ios' ? topByPlatform.ios : topByPlatform.android;
    if (!names.length) {
      names = [...latest.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([key]) => key);
    }

    names.forEach(key => {
      const current = Number(maps[maps.length - 1]?.get(key) || 0);
      const prev1 = Number(maps[maps.length - 2]?.get(key) || 0);
      const prev2 = Number(maps[maps.length - 3]?.get(key) || 0);
      const prev3 = Number(maps[maps.length - 4]?.get(key) || 0);
      const delta = current - prev1;
      const deltaPct = prev1 > 0 ? (delta / prev1) * 100 : (current > 0 ? 100 : null);
      rows.push({
        plat: platform === 'ios' ? 'ios' : 'android',
        key,
        t: current,
        t1: prev1,
        t2: prev2,
        t3: prev3,
        d: delta,
        dp: deltaPct == null ? null : Number(deltaPct.toFixed(2)),
      });
    });
  });

  const sumMap = (map: Map<string, number>) => {
    let total = 0;
    map.forEach(value => { total += Number(value || 0); });
    return total;
  };

  const latest = mapsAll[mapsAll.length - 1] || new Map<string, number>();
  const prev = mapsAll.length > 1 ? mapsAll[mapsAll.length - 2] : new Map<string, number>();
  const latestIos = mapsIos[mapsIos.length - 1] || new Map<string, number>();
  const prevIos = mapsIos.length > 1 ? mapsIos[mapsIos.length - 2] : new Map<string, number>();
  const latestAndroid = mapsAndroid[mapsAndroid.length - 1] || new Map<string, number>();
  const prevAndroid = mapsAndroid.length > 1 ? mapsAndroid[mapsAndroid.length - 2] : new Map<string, number>();

  const totalCurrent = sumMap(latest);
  const totalPrev = sumMap(prev);
  const totalDelta = totalCurrent - totalPrev;
  const totalPct = totalPrev > 0 ? (totalDelta / totalPrev) * 100 : (totalCurrent > 0 ? 100 : null);

  const iosCurrent = sumMap(latestIos);
  const iosPrev = sumMap(prevIos);
  const iosDelta = iosCurrent - iosPrev;
  const iosPct = iosPrev > 0 ? (iosDelta / iosPrev) * 100 : (iosCurrent > 0 ? 100 : null);

  const androidCurrent = sumMap(latestAndroid);
  const androidPrev = sumMap(prevAndroid);
  const androidDelta = androidCurrent - androidPrev;
  const androidPct = androidPrev > 0 ? (androidDelta / androidPrev) * 100 : (androidCurrent > 0 ? 100 : null);

  const latestSorted = [...latest.entries()].sort((left, right) => right[1] - left[1]);
  const top1Share = totalCurrent > 0 ? ((latestSorted[0]?.[1] || 0) / totalCurrent) * 100 : 0;
  const top4Share = totalCurrent > 0
    ? (latestSorted.slice(0, 4).reduce((sum, [, value]) => sum + Number(value || 0), 0) / totalCurrent) * 100
    : 0;

  return {
    rows: rows.sort((left, right) => left.plat.localeCompare(right.plat, 'ru') || right.t - left.t),
    meta: snapshots.map(snapshot => formatDateTime(snapshot.time)).join(' → '),
    kpis: {
      totalCurrent,
      totalDelta,
      totalPct: totalPct == null ? null : Number(totalPct.toFixed(2)),
      iosCurrent,
      iosDelta,
      iosPct: iosPct == null ? null : Number(iosPct.toFixed(2)),
      androidCurrent,
      androidDelta,
      androidPct: androidPct == null ? null : Number(androidPct.toFixed(2)),
      top1Share: Number(top1Share.toFixed(2)),
      top4Share: Number(top4Share.toFixed(2)),
    },
  };
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

async function driveFetch(settings: ReturnType<typeof buildRuntimeSettings>, rawUrl: string, init?: RequestInit) {
  const headers = {
    Accept: 'application/json',
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };

  if (settings.useProxy !== false && String(settings.proxyBase || '').trim()) {
    return proxyFetch(
      {
        base: String(settings.proxyBase || '').trim(),
        mode: 'prefix',
      },
      rawUrl,
      {
        ...init,
        headers,
      },
    );
  }

  return fetch(rawUrl, {
    ...init,
    headers,
  });
}

function buildDriveGetUrl(name: string) {
  return `${DRIVE.url}?op=get&name=${encodeURIComponent(name)}`;
}

function buildDriveSaveUrl(name: string) {
  return `${DRIVE.url}?name=${encodeURIComponent(name)}`;
}

function buildRuntimeSettings(settings: {
  proxyBase: string;
  useProxy: boolean;
}) {
  return {
    proxyBase: settings.proxyBase,
    useProxy: settings.useProxy,
  };
}

function createBarOverlayPlugin(values: number[], deltas: number[], colors: ChartThemeColors) {
  return {
    id: 'biUsersBarOverlay',
    afterDatasetsDraw(chart: Chart) {
      const latestMeta = chart.getDatasetMeta(chart.data.datasets.length - 1);
      if (!latestMeta?.data?.length) return;
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const occupied: LabelRect[] = [];
      ctx.save();
      ctx.font = `500 11px ${colors.mono}`;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';

      for (let index = 0; index < latestMeta.data.length; index += 1) {
        const points = chart.data.datasets.map((_, datasetIndex) => chart.getDatasetMeta(datasetIndex)?.data?.[index]).filter(Boolean) as Array<{ x: number; y: number }>;
        if (!points.length) continue;

        const top = Math.min(...points.map(point => point.y));
        const x = points[points.length - 1].x;
        const value = Number(values[index] || 0);
        const valueY = Math.max(chartArea.top + 20, top - 8);
        const valueLabel = formatNumber(value);
        const valuePlacement = placeLabelRect(ctx, valueLabel, x, valueY, chartArea, occupied, {
          align: 'center',
          stepY: 16,
          minTop: chartArea.top + 4,
        });
        ctx.fillStyle = colors.labelStrong;
        ctx.textAlign = valuePlacement.align;
        ctx.fillText(valueLabel, valuePlacement.x, valuePlacement.y);

        const delta = Number(deltas[index] || 0);
        if (delta !== 0) {
          const deltaLabel = `${delta > 0 ? '+' : ''}${formatNumber(delta)}`;
          const deltaY = Math.max(chartArea.top + 4, top - 24);
          const deltaPlacement = placeLabelRect(ctx, deltaLabel, x, deltaY, chartArea, occupied, {
            align: 'center',
            stepY: 16,
            minTop: chartArea.top + 4,
          });
          ctx.fillStyle = delta > 0 ? colors.green : colors.red;
          ctx.textAlign = deltaPlacement.align;
          ctx.fillText(deltaLabel, deltaPlacement.x, deltaPlacement.y);
        }
      }
      ctx.restore();
    },
  };
}

function createLineLabelsPlugin(colors: ChartThemeColors) {
  return {
    id: 'biUsersLineLabels',
    afterDatasetsDraw(chart: Chart) {
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const occupied: LabelRect[] = [];
      ctx.save();
      ctx.textBaseline = 'bottom';
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (!chart.isDatasetVisible(datasetIndex)) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta?.data?.length) return;
        const label = String(dataset.label || '').toLowerCase();
        const offset = label.includes('итого') ? 32 : label.includes('android') ? 20 : 10;
        ctx.font = `500 11px ${colors.mono}`;
        meta.data.forEach((point, index) => {
          const value = Number(dataset.data[index] || 0);
          const safeY = Math.max(chartArea.top + 16, point.y - offset);
          let x = point.x;
          let align: CanvasTextAlign = 'center';
          if (point.x - chartArea.left < 72) {
            align = 'left';
            x = point.x + 10;
          } else if (chartArea.right - point.x < 72) {
            align = 'right';
            x = point.x - 10;
          }
          const labelText = formatNumber(value);
          const placement = placeLabelRect(ctx, labelText, x, safeY, chartArea, occupied, {
            align,
            stepY: 18,
            minTop: chartArea.top + 4,
          });
          ctx.fillStyle = colors.labelStrong;
          ctx.textAlign = placement.align;
          ctx.fillText(labelText, placement.x, placement.y);
        });
      });
      ctx.restore();
    },
  };
}

function DeltaChart({
  model,
  themeColors,
}: {
  model: DeltaChartModel | null;
  themeColors: ChartThemeColors;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !model) {
      chartRef.current?.destroy();
      return;
    }

    chartRef.current?.destroy();
    const max = Math.max(0, ...model.datasets.flatMap(dataset => dataset.data));
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: model.shortLabels,
        datasets: model.datasets.map(dataset => ({
          label: dataset.label,
          data: dataset.data,
          backgroundColor: `${dataset.color}22`,
          borderColor: dataset.color,
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.9,
          categoryPercentage: 0.6,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 38, bottom: 20, left: 10, right: 10 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: themeColors.text2,
              font: { size: 12, family: themeColors.font },
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              title: items => model.fullLabels[items[0]?.dataIndex || 0] || '',
              label: context => `${context.dataset.label}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: themeColors.text2,
              autoSkip: model.shortLabels.length > 10,
              maxTicksLimit: 12,
              minRotation: model.shortLabels.length > 12 ? 28 : 0,
              maxRotation: model.shortLabels.length > 12 ? 28 : 0,
              font: { size: 11, family: themeColors.mono },
            },
            grid: { display: false },
            border: { color: themeColors.border },
          },
          y: {
            beginAtZero: true,
            suggestedMax: max > 0 ? Math.ceil(max * 1.25) : undefined,
            ticks: {
              color: themeColors.text2,
              font: { size: 11, family: themeColors.mono },
              callback: value => formatNumber(Number(value || 0)),
            },
            grid: { color: themeColors.grid },
            border: { color: themeColors.border },
          },
        },
      },
      plugins: [createBarOverlayPlugin(model.latestValues, model.deltas, themeColors)],
    });

    return () => chartRef.current?.destroy();
  }, [model, themeColors]);

  return <canvas ref={ref} style={{ display: 'block', height: 320 }} />;
}

function TrendChart({
  model,
  settings,
  themeColors,
}: {
  model: TrendChartModel;
  settings: ModuleSettings;
  themeColors: ChartThemeColors;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !model.labels.length) {
      chartRef.current?.destroy();
      return;
    }

    chartRef.current?.destroy();
    const datasets = [];
    if (settings.chartShowIos && settings.platforms.includes('iOS')) {
      datasets.push({ label: 'iOS', data: model.ios, borderColor: '#9B5CFF', backgroundColor: 'rgba(155,92,255,.12)' });
    }
    if (settings.chartShowAndroid && settings.platforms.includes('Android')) {
      datasets.push({ label: 'Android', data: model.android, borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,.12)' });
    }
    datasets.push({ label: 'Итого', data: model.total, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.12)' });

    const max = Math.max(0, ...datasets.flatMap(dataset => dataset.data));

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: model.labels,
        datasets: datasets.map(dataset => ({
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.borderColor,
          backgroundColor: dataset.backgroundColor,
          tension: 0.3,
          borderWidth: dataset.label === 'Итого' ? 2.5 : 1.8,
          pointRadius: dataset.label === 'Итого' ? 4 : 3,
          pointHoverRadius: dataset.label === 'Итого' ? 5 : 4,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 44, bottom: 18, left: 24, right: 18 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: themeColors.text2,
              font: { size: 12, family: themeColors.font },
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: themeColors.text2,
              autoSkip: model.labels.length > 8,
              maxTicksLimit: 8,
              minRotation: model.labels.length > 8 ? 18 : 0,
              maxRotation: model.labels.length > 8 ? 18 : 0,
              font: { size: 10, family: themeColors.mono },
            },
            grid: { display: false },
            border: { color: themeColors.border },
          },
          y: {
            beginAtZero: true,
            suggestedMax: max > 0 ? Math.ceil(max * 1.08) : undefined,
            ticks: {
              color: themeColors.text2,
              font: { size: 11, family: themeColors.mono },
              callback: value => formatNumber(Number(value || 0)),
            },
            grid: { color: themeColors.grid },
            border: { color: themeColors.border },
          },
        },
      },
      plugins: [createLineLabelsPlugin(themeColors)],
    });

    return () => chartRef.current?.destroy();
  }, [model, settings, themeColors]);

  return <canvas ref={ref} style={{ display: 'block', height: 320 }} />;
}

function releaseSelectionCaption(total: number, selected: number) {
  if (!total) return 'Нет релизов';
  if (!selected) return 'Выберите релизы';
  if (selected === total) return 'Все';
  return `Выбрано: ${selected}`;
}

export function BiUsers() {
  const { settings } = useSettings();
  const { theme } = useApp();
  const [moduleSettings, setModuleSettings] = useState<ModuleSettings>(readModuleSettings);
  const [history, setHistory] = useState<BiSnapshot[]>(readHistory);
  const [running, setRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [status, setStatus] = useState('idle');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>(settings.useProxy === false ? 'ok' : 'unknown');
  const [driveState, setDriveState] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [jwtState, setJwtState] = useState(readJwtState);
  const [cacheCount, setCacheCount] = useState(() => readCache().length);
  const summaryCardRef = useRef<HTMLDivElement>(null);
  const androidSummaryRef = useRef<HTMLDivElement>(null);
  const growthCardRef = useRef<HTMLDivElement>(null);
  const chartsCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    writeModuleSettings(moduleSettings);
  }, [moduleSettings]);

  const updateSettings = useCallback((patch: Partial<ModuleSettings>) => {
    setModuleSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const runtimeSettings = useMemo(() => buildRuntimeSettings(settings), [settings]);
  const chartThemeColors = useMemo(() => getChartThemeColors(theme), [theme]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await driveFetch(runtimeSettings, buildDriveGetUrl(DRIVE.historyFile), { method: 'GET' });
        const text = await response.text();
        if (!response.ok) throw new Error(`Drive history HTTP ${response.status}`);
        const merged = mergeHistory(readHistory(), normalizeSnapshotsFromDrive(text));
        if (!cancelled) {
          writeHistory(merged);
          setHistory(merged);
          setDriveState('ok');
        }
      } catch {
        if (!cancelled) {
          setDriveState('error');
        }
      }

      setCacheCount(readCache().length);
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

  const filteredHistory = useMemo(
    () => filterHistoryByDate(history, moduleSettings.snapFrom, moduleSettings.snapTo),
    [history, moduleSettings.snapFrom, moduleSettings.snapTo],
  );

  const snapshotOptions = useMemo(
    () => [...filteredHistory].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, SNAP_LIMIT),
    [filteredHistory],
  );

  const chosenSnapshots = useMemo(
    () => chooseSnapshots(history, moduleSettings),
    [history, moduleSettings],
  );

  const currentSnapshot = chosenSnapshots[chosenSnapshots.length - 1] || null;
  const previousSnapshot = chosenSnapshots.length > 1 ? chosenSnapshots[chosenSnapshots.length - 2] : null;
  const summaryRaw = useMemo(() => toSummaryRecords(currentSnapshot), [currentSnapshot]);
  const filteredRows = useMemo(() => filterSummaryRows(summaryRaw, moduleSettings), [summaryRaw, moduleSettings]);
  const androidSummary = useMemo(() => computeAndroidSummary(summaryRaw), [summaryRaw]);
  const deltaChartModel = useMemo(() => computeDeltaChartModel(chosenSnapshots, moduleSettings), [chosenSnapshots, moduleSettings]);
  const trendChartModel = useMemo(() => computeTrendChartModel(chosenSnapshots), [chosenSnapshots]);
  const growth = useMemo(() => computeGrowth(history, filteredRows, moduleSettings), [filteredRows, history, moduleSettings]);
  const currentTotals = useMemo(() => {
    let ios = 0;
    let android = 0;
    summaryRaw.forEach(row => {
      const users = Number(row.users || 0);
      if (row.platform === 'iOS') ios += users;
      if (row.platform === 'Android') android += users;
    });
    return {
      ios,
      android,
      total: ios + android,
    };
  }, [summaryRaw]);
  const previousTotals = useMemo(() => {
    if (!previousSnapshot) return { ios: 0, android: 0, total: 0 };
    let ios = 0;
    let android = 0;
    previousSnapshot.records.forEach(row => {
      const users = Number(row.users || 0);
      if (row.platform === 'iOS') ios += users;
      if (row.platform === 'Android') android += users;
    });
    return {
      ios,
      android,
      total: ios + android,
    };
  }, [previousSnapshot]);
  const summaryUsersTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + Number(row.users || 0), 0),
    [filteredRows],
  );
  const visiblePlatformsLabel = useMemo(() => {
    const labels = [];
    if (moduleSettings.chartShowIos && moduleSettings.platforms.includes('iOS')) labels.push('iOS');
    if (moduleSettings.chartShowAndroid && moduleSettings.platforms.includes('Android')) labels.push('Android');
    return labels.length ? labels.join(' + ') : 'пусто';
  }, [moduleSettings.chartShowAndroid, moduleSettings.chartShowIos, moduleSettings.platforms]);

  const chartPlatforms = getPlatformsForCharts(moduleSettings);
  const releasesForSelection = useMemo(() => {
    const maps = chosenSnapshots.slice(-CHART_SNAP_MAX).map(snapshot => aggregateSnapshotByRelease(snapshot, chartPlatforms));
    const latestMap = maps[maps.length - 1] || new Map<string, number>();
    return getReleaseOrdering(maps, latestMap, moduleSettings.orderDirection);
  }, [chosenSnapshots, chartPlatforms, moduleSettings.orderDirection]);

  useEffect(() => {
    const allowed = new Set(snapshotOptions.map(snapshot => snapshot.time));
    if (moduleSettings.selectedSnapshotTimes.every(item => allowed.has(item))) return;
    updateSettings({ selectedSnapshotTimes: moduleSettings.selectedSnapshotTimes.filter(item => allowed.has(item)) });
  }, [moduleSettings.selectedSnapshotTimes, snapshotOptions, updateSettings]);

  useEffect(() => {
    const allowed = new Set(releasesForSelection);
    if (moduleSettings.selectedReleases.every(item => allowed.has(item))) return;
    updateSettings({ selectedReleases: moduleSettings.selectedReleases.filter(item => allowed.has(item)) });
  }, [moduleSettings.selectedReleases, releasesForSelection, updateSettings]);

  const handleRunAll = useCallback(async () => {
    if (!String(settings.biCookie || '').trim()) {
      setStatus('Нужен WB BI Cookie в общих настройках.');
      setStatusTone('error');
      return;
    }

    setRunning(true);
    setStatus('Идёт загрузка BI-данных и обновление истории.');
    setStatusTone('neutral');

    try {
      const payload = await fetchBiUsersSnapshot(
        {
          base: settings.ytBase,
          token: settings.ytToken,
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
          biCookie: settings.biCookie,
        },
        {
          platforms: getPlatformsForFetch(moduleSettings),
          interval: moduleSettings.interval,
        },
      );

      const snapshot: BiSnapshot = {
        time: payload.fetchedAt,
        records: payload.records,
      };

      const nextHistory = persistSnapshot(readHistory(), snapshot);
      writeCache(payload.records);
      setHistory(nextHistory);
      setCacheCount(readCache().length);
      setJwtState(readJwtState());
      setStatus(`Снэпшот обновлён: ${formatDateTime(payload.fetchedAt)}. Записей: ${payload.records.length}.`);
      setStatusTone('ok');

      try {
        await driveFetch(runtimeSettings, buildDriveSaveUrl(DRIVE.historyFile), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextHistory),
        });
        await driveFetch(runtimeSettings, buildDriveSaveUrl(DRIVE.cacheFile), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload.records),
        });
        setDriveState('ok');
      } catch (error) {
        setDriveState('error');
        setStatus('Снэпшот обновлён локально, но Google Drive не синхронизирован.');
        setStatusTone('warn');
      }
    } catch (error) {
      const message = (error as Error).message || 'Не удалось получить BI-данные.';
      setStatus(message);
      setStatusTone('error');
    } finally {
      setRunning(false);
    }
  }, [moduleSettings, runtimeSettings, settings.biCookie, settings.proxyBase, settings.proxyMode, settings.useProxy, settings.ytBase, settings.ytToken]);

  const handleSaveSettings = useCallback(() => {
    writeModuleSettings(moduleSettings);
    setStatus('Настройки модуля сохранены локально.');
    setStatusTone('ok');
  }, [moduleSettings]);

  const handleSummaryCsv = useCallback(() => {
    const rows = [
      ['platform', 'release', 'users', 'share'],
      ...filteredRows.map(row => [row.platform, row.release, String(Math.round(row.users)), row.share == null ? '' : Number(row.share).toFixed(2)]),
    ];
    downloadCsv(rows, 'bi_summary_top20.csv');
  }, [filteredRows]);

  const handleGrowthCsv = useCallback(() => {
    const rows = [
      ['platform', 'version', 'slice_1', 'slice_2', 'slice_3', 'slice_4', 'delta', 'delta_pct'],
      ...growth.rows.map(row => [
        row.plat === 'ios' ? 'iOS' : 'Android',
        row.key,
        String(row.t),
        String(row.t1),
        String(row.t2),
        String(row.t3),
        String(row.d),
        row.dp == null ? '' : row.dp.toFixed(2),
      ]),
    ];
    downloadCsv(rows, 'bi_growth_top4.csv');
  }, [growth.rows]);

  const handlePdfExport = useCallback(async () => {
    setExportingPdf(true);
    try {
      const { html2canvas, jsPDF } = await ensurePdfLibraries();
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
      const nodes = [chartsCardRef.current, summaryCardRef.current, androidSummaryRef.current, growthCardRef.current].filter(Boolean) as HTMLElement[];
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const canvas = await html2canvas(node, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
        });

        const image = canvas.toDataURL('image/jpeg', 0.98);
        const ratio = canvas.height / canvas.width;
        let width = pageWidth - margin * 2;
        let height = width * ratio;
        if (height > pageHeight - margin * 2) {
          height = pageHeight - margin * 2;
          width = height / ratio;
        }

        if (index > 0) pdf.addPage();
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.addImage(image, 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, 'FAST');
      }

      pdf.save(`wb-bi-users-full-${new Date().toISOString().slice(0, 10)}.pdf`);
      setStatus('PDF собран из графиков и таблиц текущего экрана.');
      setStatusTone('ok');
    } catch (error) {
      setStatus((error as Error).message || 'Не удалось собрать PDF.');
      setStatusTone('error');
    } finally {
      setExportingPdf(false);
    }
  }, []);

  const currentSnapshotLabel = currentSnapshot ? formatDateTime(currentSnapshot.time) : '—';
  const previousSnapshotLabel = previousSnapshot ? formatDateTime(previousSnapshot.time) : '—';
  const releaseSearchLabel = releaseSelectionCaption(releasesForSelection.length, moduleSettings.selectedReleases.length);
  const summarySortColor = moduleSettings.summarySort === 'asc' ? 'blue' : 'green';
  const statusColor = statusTone === 'ok' ? 'green' : statusTone === 'warn' ? 'yellow' : statusTone === 'error' ? 'red' : 'gray';
  const totalDelta = currentTotals.total - previousTotals.total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◎</div>
        Пользователи по версиям
      </div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <FieldLabel>Платформы для запроса</FieldLabel>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['iOS', 'Android'] as SnapshotPlatform[]).map(platform => {
                  const active = moduleSettings.platforms.includes(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? moduleSettings.platforms.filter(item => item !== platform)
                          : [...moduleSettings.platforms, platform];
                        updateSettings({ platforms: next.length ? next : [platform] });
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: active ? 'var(--card-hi)' : 'var(--surface-soft)',
                        color: active ? 'var(--text)' : 'var(--text-2)',
                        fontWeight: 600,
                      }}
                    >
                      {platform}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <FieldLabel>Интервал WB BI</FieldLabel>
              <Select value={moduleSettings.interval} onChange={event => updateSettings({ interval: event.target.value })}>
                {INTERVAL_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>

            <div>
              <FieldLabel>Снэпшоты: от</FieldLabel>
              <Input type="datetime-local" value={moduleSettings.snapFrom} onChange={event => updateSettings({ snapFrom: event.target.value })} />
            </div>

            <div>
              <FieldLabel>Снэпшоты: до</FieldLabel>
              <Input type="datetime-local" value={moduleSettings.snapTo} onChange={event => updateSettings({ snapTo: event.target.value })} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Panel
              title="Снэпшоты для анализа"
              hint="Выбранные срезы используются в графиках, сравнении релизов и аналитике прироста."
              actions={(
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button variant="ghost" size="sm" onClick={() => updateSettings({ selectedSnapshotTimes: snapshotOptions.slice(0, SNAP_DEFAULT).map(snapshot => snapshot.time) })}>Последние 4</Button>
                  <Button variant="ghost" size="sm" onClick={() => updateSettings({ selectedSnapshotTimes: snapshotOptions.map(snapshot => snapshot.time).slice(0, SNAP_LIMIT) })}>Последние 20</Button>
                  <Button variant="ghost" size="sm" onClick={() => updateSettings({ selectedSnapshotTimes: [] })}>Сброс</Button>
                </div>
              )}
            >
              <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface-soft-2)', maxHeight: 220, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {!snapshotOptions.length && <EmptyState text="Нет снэпшотов в выбранном диапазоне." />}
                {snapshotOptions.map(snapshot => {
                  const checked = moduleSettings.selectedSnapshotTimes.includes(snapshot.time);
                  return (
                    <label
                      key={snapshot.time}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: checked ? 'var(--card-hi)' : 'transparent',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{formatDateTime(snapshot.time)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{snapshot.records.length} записей</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={event => {
                          const next = event.target.checked
                            ? [...moduleSettings.selectedSnapshotTimes, snapshot.time]
                            : moduleSettings.selectedSnapshotTimes.filter(item => item !== snapshot.time);
                          updateSettings({ selectedSnapshotTimes: next.slice(-SNAP_LIMIT) });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="Запуск и состояние"
              hint="Поток загружает BI-данные, обновляет локальную историю и синхронизирует её с Google Drive, если он доступен."
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={handleSaveSettings}>Сохранить настройки</Button>
                <Button variant="ghost" onClick={handleSummaryCsv} disabled={!filteredRows.length}>Экспорт CSV</Button>
                <Button variant="ghost" onClick={handlePdfExport} disabled={exportingPdf}>{exportingPdf ? 'PDF...' : 'Экспорт PDF'}</Button>
                <Button variant="primary" onClick={() => void handleRunAll()} disabled={running}>{running ? 'Загрузка...' : 'Запустить полный поток'}</Button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge color={statusColor}>{status}</Badge>
                <Badge color={String(settings.biCookie || '').trim() ? 'green' : 'red'}>BI cookie {String(settings.biCookie || '').trim() ? 'ready' : 'missing'}</Badge>
                <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
                  proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
                </Badge>
                <Badge color={driveState === 'ok' ? 'green' : driveState === 'error' ? 'red' : 'gray'}>drive {driveState}</Badge>
                <Badge color={jwtState === 'есть' ? 'green' : 'gray'}>key_jwt {jwtState}</Badge>
                <Badge color="gray">текущий {currentSnapshotLabel}</Badge>
                <Badge color="gray">предыдущий {previousSnapshotLabel}</Badge>
                <Badge color="gray">кэш {cacheCount}</Badge>
              </div>
            </Panel>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <MetricTile
              label="Текущая аудитория"
              value={formatNumber(currentTotals.total)}
              meta={`${formatNumber(currentTotals.ios)} iOS / ${formatNumber(currentTotals.android)} Android`}
              tone="accent"
            />
            <MetricTile
              label="Δ к предыдущему срезу"
              value={formatSigned(totalDelta)}
              meta={previousSnapshot ? `было ${formatNumber(previousTotals.total)}` : 'Предыдущий снэпшот ещё не выбран'}
              tone={totalDelta >= 0 ? 'positive' : 'negative'}
            />
            <MetricTile
              label="Снэпшоты в работе"
              value={String(chosenSnapshots.length)}
              meta={chosenSnapshots.length ? `${currentSnapshotLabel}${previousSnapshot ? ` vs ${previousSnapshotLabel}` : ''}` : 'Выбери срезы для сравнения'}
            />
            <MetricTile
              label="Релизы в текущем срезе"
              value={String(summaryRaw.length)}
              meta={`В графиках сейчас видны ${visiblePlatformsLabel}`}
            />
          </div>
        </CardBody>
      </Card>

      <div ref={chartsCardRef}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Графики</CardTitle>
              <CardHint>Пользователи по релизам по выбранным снэпшотам и тренд суммарной аудитории.</CardHint>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="gray">{releaseSearchLabel}</Badge>
              <Badge color="gray">режим {moduleSettings.viewMode}</Badge>
            </div>
          </CardHeader>
          <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <MetricTile label="Срезы на графиках" value={String(chosenSnapshots.length)} meta={deltaChartModel ? deltaChartModel.metaDates.join(' → ') : 'Недостаточно истории'} />
              <MetricTile label="Релизы в списке" value={String(releasesForSelection.length)} meta={moduleSettings.viewMode === 'selected' ? `Выбрано вручную: ${moduleSettings.selectedReleases.length}` : `Режим: ${moduleSettings.viewMode}`} />
              <MetricTile label="Видимые платформы" value={visiblePlatformsLabel} meta="Можно отключить отдельные линии и столбцы ниже" />
              <MetricTile label="Текущий top" value={moduleSettings.viewMode === 'top8' ? '8' : moduleSettings.showCount} meta={releaseSearchLabel} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <Panel title="Как показывать релизы" hint="Здесь настраивается объём графика и платформы, которые войдут в сравнение.">
                <div>
                  <FieldLabel>Режим показа релизов</FieldLabel>
                  <SegmentControl
                    items={[
                      { label: 'Полный', value: 'full' },
                      { label: 'Топ-8', value: 'top8' },
                      { label: 'Выбранные', value: 'selected' },
                    ]}
                    value={moduleSettings.viewMode}
                    onChange={value => updateSettings({ viewMode: value as ViewMode })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <FieldLabel>Показывать релизов</FieldLabel>
                    <Select value={moduleSettings.showCount} onChange={event => updateSettings({ showCount: event.target.value })}>
                      {['5', '10', '15', '20'].map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>Порядок</FieldLabel>
                    <Select value={moduleSettings.orderDirection} onChange={event => updateSettings({ orderDirection: event.target.value as OrderDirection })}>
                      <option value="desc">desc</option>
                      <option value="asc">asc</option>
                    </Select>
                  </div>
                </div>

                <div>
                  <FieldLabel>Платформы на графиках</FieldLabel>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text-2)' }}>
                      <input type="checkbox" checked={moduleSettings.chartShowIos} onChange={event => updateSettings({ chartShowIos: event.target.checked })} />
                      iOS
                    </label>
                    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text-2)' }}>
                      <input type="checkbox" checked={moduleSettings.chartShowAndroid} onChange={event => updateSettings({ chartShowAndroid: event.target.checked })} />
                      Android
                    </label>
                  </div>
                </div>
              </Panel>

              <Panel title="Какие релизы попадут на график" hint="В режиме «Выбранные» график строится только по отмеченным версиям.">
                <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface-soft-2)', maxHeight: 240, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {!releasesForSelection.length && <EmptyState text="Нет релизов в выбранных снэпшотах." />}
                  {releasesForSelection.map(release => {
                    const checked = moduleSettings.selectedReleases.includes(release);
                    return (
                      <label
                        key={release}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: checked ? 'var(--card-hi)' : 'transparent',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{release}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>short: {shortVersion(release)}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => {
                            const next = event.target.checked
                              ? [...moduleSettings.selectedReleases, release]
                              : moduleSettings.selectedReleases.filter(item => item !== release);
                            updateSettings({ selectedReleases: next });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Пользователи по релизам</CardTitle>
                    <CardHint>Основной график сравнения: текущий срез против предыдущих. Полная версия релиза остаётся в тултипе.</CardHint>
                  </div>
                  <Badge color="gray">{deltaChartModel ? deltaChartModel.metaDates.join(' → ') : 'Нет данных'}</Badge>
                </CardHeader>
                <CardBody style={{ height: 400 }}>
                  {deltaChartModel ? <DeltaChart model={deltaChartModel} themeColors={chartThemeColors} /> : <EmptyState text="Недостаточно данных для графика релизов." />}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Тренд суммарных пользователей по платформам</CardTitle>
                    <CardHint>Показывает общий объём аудитории по платформам на каждом сохранённом снэпшоте.</CardHint>
                  </div>
                  <Badge color="gray">{chosenSnapshots.length} снэпшотов</Badge>
                </CardHeader>
                <CardBody style={{ height: 400 }}>
                  {trendChartModel.labels.length ? <TrendChart model={trendChartModel} settings={moduleSettings} themeColors={chartThemeColors} /> : <EmptyState text="Нет истории для тренда." />}
                </CardBody>
              </Card>
            </div>
          </CardBody>
        </Card>
      </div>

      <div ref={summaryCardRef}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Сводная таблица по релизам</CardTitle>
              <CardHint>Топ-20 по пользователям с фильтром по платформе и релизу.</CardHint>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="gray">top {SUMMARY_TOP_LIMIT}</Badge>
              <Badge color={summarySortColor}>sort {moduleSettings.summarySort}</Badge>
            </div>
          </CardHeader>
          <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <MetricTile label="Строк после фильтра" value={String(filteredRows.length)} meta={moduleSettings.sumPlat === 'all' ? 'Все платформы' : moduleSettings.sumPlat} />
              <MetricTile label="Пользователи в таблице" value={formatNumber(summaryUsersTotal)} meta="Сумма по top-20 после фильтрации" />
              <MetricTile label="Фильтр релиза" value={moduleSettings.sumRel || '—'} meta="Можно искать по полному номеру или по части версии" />
              <MetricTile label="Сортировка" value={moduleSettings.summarySort === 'desc' ? 'По убыванию' : 'По возрастанию'} meta="Таблица всегда ограничена 20 строками" />
            </div>

            {!filteredRows.length ? (
              <EmptyState text="Нет данных для сводной таблицы." />
            ) : (
              <TableShell>
                <div
                  style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface-soft)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                    alignItems: 'end',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <FieldLabel>Платформа</FieldLabel>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Все', value: 'all' as const, color: 'gray' as const },
                        { label: 'iOS', value: 'iOS' as const, color: 'purple' as const },
                        { label: 'Android', value: 'Android' as const, color: 'green' as const },
                      ].map(option => {
                        const active = moduleSettings.sumPlat === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => updateSettings({ sumPlat: option.value })}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 999,
                              border: '1px solid var(--border)',
                              background: active ? 'var(--card-hi)' : 'var(--surface)',
                              color: active ? 'var(--text)' : 'var(--text-2)',
                              fontWeight: 700,
                              fontSize: 12,
                              boxShadow: active ? 'var(--sh-sm)' : 'none',
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {option.label}
                              {active ? <span style={{ fontSize: 11, color: 'var(--text-3)' }}>●</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <FieldLabel>Фильтр по релизу</FieldLabel>
                    <Input value={moduleSettings.sumRel} onChange={event => updateSettings({ sumRel: event.target.value })} placeholder="например 7.3.6001 или 7.3." />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <FieldLabel>Сортировка</FieldLabel>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateSettings({ summarySort: 'desc' })}
                        style={moduleSettings.summarySort === 'desc' ? { background: 'var(--card-hi)', color: 'var(--text)' } : undefined}
                      >
                        По убыванию
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateSettings({ summarySort: 'asc' })}
                        style={moduleSettings.summarySort === 'asc' ? { background: 'var(--card-hi)', color: 'var(--text)' } : undefined}
                      >
                        По возрастанию
                      </Button>
                    </div>
                  </div>
                </div>

                <Table style={{ borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <Th>Платформа</Th>
                      <Th>Релиз</Th>
                      <Th style={{ textAlign: 'right' }}>Пользователи</Th>
                      <Th style={{ textAlign: 'right' }}>%</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={`${row.platform}:${row.release}`} style={stripedRowStyle(index)}>
                        <Td>
                          <Badge color={row.platform === 'iOS' ? 'purple' : 'green'}>{row.platform}</Badge>
                        </Td>
                        <Td mono bold>{row.release}</Td>
                        <Td mono style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 700 }}>{formatNumber(row.users)}</Td>
                        <Td mono style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.share == null ? '—' : `${Number(row.share).toFixed(2)}%`}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableShell>
            )}
          </CardBody>
        </Card>
      </div>

      <div ref={androidSummaryRef}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Android — распределение пользователей по типу сборки</CardTitle>
              <CardHint>Доля от общего числа Android в текущем выбранном снэпшоте.</CardHint>
            </div>
          </CardHeader>
          <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <MetricTile label="Android всего" value={formatNumber(androidSummary[0]?.users || 0)} meta="База для расчёта долей по магазинам" />
              <MetricTile label="Google" value={formatNumber(androidSummary.find(row => row.label === 'Google')?.users || 0)} meta={formatSignedPercent(androidSummary.find(row => row.label === 'Google')?.share ?? null).replace('+', '')} />
              <MetricTile label="RuStore" value={formatNumber(androidSummary.find(row => row.label === 'RuStore')?.users || 0)} meta={formatSignedPercent(androidSummary.find(row => row.label === 'RuStore')?.share ?? null).replace('+', '')} />
              <MetricTile label="Huawei" value={formatNumber(androidSummary.find(row => row.label === 'Huawei')?.users || 0)} meta={formatSignedPercent(androidSummary.find(row => row.label === 'Huawei')?.share ?? null).replace('+', '')} />
            </div>

            <TableShell>
              <Table style={{ borderRadius: 0 }}>
                <thead>
                  <tr>
                    <Th>Категория</Th>
                    <Th style={{ textAlign: 'right' }}>Пользователи</Th>
                    <Th style={{ textAlign: 'right' }}>% от Android</Th>
                  </tr>
                </thead>
                <tbody>
                  {!summaryRaw.filter(row => row.platform === 'Android').length ? (
                    <tr>
                      <td colSpan={3} style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)' }}>Нет данных</td>
                    </tr>
                  ) : (
                    androidSummary.map((row, index) => (
                      <tr key={row.label} style={stripedRowStyle(index)}>
                        <Td bold={row.label === 'Всего Android'}>{row.label}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{formatNumber(row.users)}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.share.toFixed(2)}%</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableShell>
          </CardBody>
        </Card>
      </div>

      <div ref={growthCardRef}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Аналитика версий</CardTitle>
              <CardHint>Прирост/убывание по топ-4 версиям на основе текущей сводной таблицы и выбранных снэпшотов.</CardHint>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" size="sm" onClick={handleGrowthCsv} disabled={!growth.rows.length}>Экспорт CSV (аналитика)</Button>
              <Badge color="gray">Снэпшоты {growth.meta || '—'}</Badge>
            </div>
          </CardHeader>
          <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <MetricTile label="Итого пользователей" value={formatNumber(growth.kpis.totalCurrent)} meta="Сумма по последнему выбранному срезу" tone="accent" />
              <MetricTile label="Δ к прошлому срезу" value={formatSigned(growth.kpis.totalDelta)} meta={formatSignedPercent(growth.kpis.totalPct)} tone={growth.kpis.totalDelta >= 0 ? 'positive' : 'negative'} />
              <MetricTile label="iOS" value={formatNumber(growth.kpis.iosCurrent)} meta={`${formatSigned(growth.kpis.iosDelta)} / ${formatSignedPercent(growth.kpis.iosPct)}`} tone={growth.kpis.iosDelta >= 0 ? 'positive' : 'negative'} />
              <MetricTile label="Android" value={formatNumber(growth.kpis.androidCurrent)} meta={`${formatSigned(growth.kpis.androidDelta)} / ${formatSignedPercent(growth.kpis.androidPct)}`} tone={growth.kpis.androidDelta >= 0 ? 'positive' : 'negative'} />
              <MetricTile label="Top-1 доля" value={`${growth.kpis.top1Share.toFixed(2)}%`} meta="Самая крупная версия в общем объёме" />
              <MetricTile label="Top-4 доля" value={`${growth.kpis.top4Share.toFixed(2)}%`} meta="Насколько аудитория сосредоточена в 4 главных версиях" />
            </div>

            {!growth.rows.length ? (
              <EmptyState text="Недостаточно данных для growth-аналитики." />
            ) : (
              <TableShell>
                <Table style={{ borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <Th>Платформа</Th>
                      <Th>Версия</Th>
                      <Th style={{ textAlign: 'right' }}>Срез-1</Th>
                      <Th style={{ textAlign: 'right' }}>Срез-2</Th>
                      <Th style={{ textAlign: 'right' }}>Срез-3</Th>
                      <Th style={{ textAlign: 'right' }}>Срез-4</Th>
                      <Th style={{ textAlign: 'right' }}>Δ</Th>
                      <Th style={{ textAlign: 'right' }}>Δ%</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {growth.rows.map((row, index) => (
                      <tr key={`${row.plat}:${row.key}`} style={stripedRowStyle(index)}>
                        <Td>
                          <Badge color={row.plat === 'ios' ? 'purple' : 'green'}>{row.plat === 'ios' ? 'iOS' : 'Android'}</Badge>
                        </Td>
                        <Td mono bold>{row.key}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.t)}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.t1)}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.t2)}</Td>
                        <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.t3)}</Td>
                        <Td style={{ textAlign: 'right', color: row.d >= 0 ? '#22C55E' : '#EF4444', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatSigned(row.d)}</Td>
                        <Td style={{ textAlign: 'right', color: (row.dp || 0) >= 0 ? '#22C55E' : '#EF4444', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatSignedPercent(row.dp)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableShell>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
