import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart, BarController, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
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
  SegmentControl,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
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
import { fetchBiDevices, type BiDeviceOsRow, type BiDeviceRow } from '../../services/youtrack';

Chart.register(BarController, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const SETTINGS_KEY = 'bi_devices_settings_v1';
const HISTORY_KEY = 'bi_devices_history';
const HISTORY_FILE = 'bi_devices_history.json';
const HISTORY_LIMIT = 12;
const HISTORY_COMPARE_LIMIT = 4;
const SNAPSHOT_MAX_PER_PLATFORM = 300;
const TOP_COUNT_OPTIONS = [
  { label: 'Top 5', value: '5' },
  { label: 'Top 10', value: '10' },
];

type SnapshotPlatform = 'Android' | 'iOS';
type FocusPlatform = 'android' | 'ios';
type ViewMode = 'table' | 'chart';
type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';

interface DeviceModuleSettings {
  interval: BiInterval;
  focusPlatform: FocusPlatform;
  view: ViewMode;
  topCount: string;
  selectedSnapshotTimes: string[];
}

interface SnapshotRecord {
  platform: SnapshotPlatform;
  manufacturer: string;
  release: string;
  users: number;
  total: number;
  share: number | null;
}

interface DeviceSnapshot {
  time: string;
  totals: Record<string, number>;
  records: SnapshotRecord[];
  osRecords?: BiDeviceOsRow[];
}

interface DeviceViewRow extends BiDeviceRow {
  delta: number;
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
}

const DEFAULT_MODULE_SETTINGS: DeviceModuleSettings = {
  interval: 'last_2_days',
  focusPlatform: 'android',
  view: 'table',
  topCount: '10',
  selectedSnapshotTimes: [],
};

function normalizeModuleSettings(input: unknown): DeviceModuleSettings {
  const value = (input && typeof input === 'object') ? input as Partial<DeviceModuleSettings> : {};
  const focusPlatform = value.focusPlatform === 'ios' ? 'ios' : DEFAULT_MODULE_SETTINGS.focusPlatform;
  const view = value.view === 'chart' ? 'chart' : DEFAULT_MODULE_SETTINGS.view;
  const topCount = value.topCount === '5' ? '5' : DEFAULT_MODULE_SETTINGS.topCount;
  return {
    interval: normalizeBiInterval(value.interval, DEFAULT_MODULE_SETTINGS.interval),
    focusPlatform,
    view,
    topCount,
    selectedSnapshotTimes: Array.isArray(value.selectedSnapshotTimes)
      ? value.selectedSnapshotTimes.map(item => String(item || '')).filter(Boolean)
      : [],
  };
}

function readModuleSettings() {
  return normalizeModuleSettings(readJsonStorage<unknown>(SETTINGS_KEY, null));
}

function writeModuleSettings(settings: DeviceModuleSettings) {
  writeJsonStorage(SETTINGS_KEY, settings);
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
  return new Intl.NumberFormat('ru-RU').format(Math.round(value || 0));
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
    labelStrong: readCssVar('--text', '#FFFFFF'),
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

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawChartPillLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  color: string,
  themeColors: ChartThemeColors,
) {
  const padX = 7;
  const width = ctx.measureText(text).width + padX * 2;
  const height = 19;
  const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
  const top = y - height / 2;

  ctx.save();
  roundedRectPath(ctx, left, top, width, height, 7);
  ctx.fillStyle = hexToRgba(color, 0.13);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.34);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = themeColors.labelStrong;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, top + height / 2 + 0.5);
  ctx.restore();
}

function shareToPercent(value: number | null | undefined) {
  const numeric = Number(value || 0);
  return numeric <= 1 ? numeric * 100 : numeric;
}

function formatShare(value: number | null | undefined) {
  return `${shareToPercent(value).toFixed(2)}%`;
}

function normalizeText(value: string) {
  return String(value || '')
    .replace(/[™©®]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deviceLabel(row: {
  manufacturer?: string;
  model?: string;
  release?: string;
}) {
  const manufacturer = normalizeText(row.manufacturer || '');
  const model = normalizeText(row.model || row.release || '');
  if (!model) return manufacturer;
  if (!manufacturer) return model;
  return model.toLowerCase().startsWith(manufacturer.toLowerCase()) ? model : `${manufacturer} ${model}`;
}

function deviceKey(row: {
  platform: string;
  manufacturer?: string;
  model?: string;
  release?: string;
}) {
  const platform = String(row.platform || '').toLowerCase();
  const manufacturer = normalizeText(row.manufacturer || '').toLowerCase();
  const model = normalizeText(row.model || row.release || '').toLowerCase();
  return `${platform}::${manufacturer}::${model}`;
}

function normalizeSnapshot(input: unknown): DeviceSnapshot | null {
  const value = input as { time?: unknown; totals?: unknown; records?: unknown[] };
  const time = String(value?.time || '').trim();
  if (!time || Number.isNaN(Date.parse(time))) return null;

  const totalsRaw = (value?.totals && typeof value.totals === 'object') ? value.totals as Record<string, unknown> : {};
  const records = Array.isArray(value?.records) ? value.records.map(record => {
    const item = record as Record<string, unknown>;
    const platform = String(item.platform || '').trim();
    if (platform !== 'Android' && platform !== 'iOS') return null;

    return {
      platform,
      manufacturer: String(item.manufacturer || '').trim(),
      release: String(item.release || item.model || '').trim(),
      users: Number(item.users || 0),
      total: Number(item.total || 0),
      share: item.share == null ? null : Number(item.share),
    } satisfies SnapshotRecord;
  }).filter(Boolean) as SnapshotRecord[] : [];

  return {
    time,
    totals: Object.entries(totalsRaw).reduce<Record<string, number>>((acc, [key, entry]) => {
      acc[key] = Number(entry || 0);
      return acc;
    }, {}),
    records,
    osRecords: Array.isArray((value as { osRecords?: unknown[] }).osRecords)
      ? (value as { osRecords: unknown[] }).osRecords.map(row => {
          const item = row as Partial<BiDeviceOsRow>;
          const platform = item.platform === 'android' || item.platform === 'ios' ? item.platform : null;
          if (!platform) return null;
          return {
            platform,
            os: String(item.os || '').trim(),
            users: Number(item.users || 0),
            total: Number(item.total || 0),
            share: Number(item.share == null ? 0 : item.share),
          } satisfies BiDeviceOsRow;
        }).filter(Boolean) as BiDeviceOsRow[]
      : [],
  };
}

function readHistory() {
  return readBiSnapshotHistory(HISTORY_KEY, normalizeSnapshot);
}

function writeHistory(history: DeviceSnapshot[]) {
  writeJsonStorage(HISTORY_KEY, history.slice(-HISTORY_LIMIT));
}

function compactRows(rows: BiDeviceRow[]): SnapshotRecord[] {
  const grouped = new Map<SnapshotPlatform, SnapshotRecord[]>();

  rows.forEach(row => {
    const platform: SnapshotPlatform = row.platform === 'ios' ? 'iOS' : 'Android';
    const list = grouped.get(platform) || [];
    list.push({
      platform,
      manufacturer: row.manufacturer,
      release: row.model,
      users: row.users,
      total: row.total,
      share: row.share,
    });
    grouped.set(platform, list);
  });

  return [...grouped.entries()].flatMap(([platform, records]) =>
    records
      .sort((a, b) => b.users - a.users)
      .slice(0, SNAPSHOT_MAX_PER_PLATFORM)
      .map(record => ({ ...record, platform }))
  );
}

function persistSnapshot(rows: BiDeviceRow[], osRows: BiDeviceOsRow[], totals: Record<'android' | 'ios', number>, fetchedAt: string) {
  const history = readHistory();
  const snapshot: DeviceSnapshot = {
    time: fetchedAt,
    totals: {
      Android: totals.android,
      iOS: totals.ios,
    },
    records: compactRows(rows),
    osRecords: osRows.slice(0, 80),
  };

  return appendBiSnapshot(HISTORY_KEY, history, snapshot, HISTORY_LIMIT);
}

function rowsFromSnapshot(snapshot: DeviceSnapshot | null): BiDeviceRow[] {
  if (!snapshot) return [];
  return snapshot.records.map(record => ({
    platform: record.platform === 'iOS' ? 'ios' : 'android',
    manufacturer: record.manufacturer,
    model: record.release,
    users: Number(record.users || 0),
    total: Number(record.total || 0),
    share: Number(record.share || 0),
  }));
}

function osRowsFromSnapshot(snapshot: DeviceSnapshot | null): BiDeviceOsRow[] {
  return snapshot?.osRecords?.slice() || [];
}

function applyDeltas(rows: BiDeviceRow[], previousSnapshot: DeviceSnapshot | null): DeviceViewRow[] {
  const previousMap = new Map<string, number>();

  if (previousSnapshot) {
    previousSnapshot.records.forEach(record => {
      previousMap.set(deviceKey(record), Number(record.users || 0));
    });
  }

  return rows.map(row => {
    const previousUsers = previousMap.get(deviceKey(row)) || 0;
    const delta = previousUsers > 0
      ? Number((((row.users - previousUsers) / previousUsers) * 100).toFixed(1))
      : 0;

    return {
      ...row,
      delta,
    };
  });
}

function HorizontalBar({ value, max, color }: { value: number; max: number; color: string }) {
  const safeMax = Math.max(1, max);
  const pct = Math.round((value / safeMax) * 100);
  const track = `linear-gradient(90deg, ${hexToRgba(color, 0.16)}, var(--surface-soft-4))`;
  const fill = `linear-gradient(90deg, ${hexToRgba(color, 0.88)}, ${hexToRgba(color, 0.48)})`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ flex: 1, height: 8, background: track, borderRadius: 99, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--surface-soft-4)' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            minWidth: pct > 0 ? 4 : 0,
            background: fill,
            borderRadius: 99,
            boxShadow: `0 0 14px ${hexToRgba(color, 0.22)}`,
          }}
        />
      </div>
      <span style={{ minWidth: 54, textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(2)}%
      </span>
    </div>
  );
}

function DeviceTable({ rows, color }: { rows: DeviceViewRow[]; color: string }) {
  const maxShare = Math.max(1, ...rows.map(row => shareToPercent(row.share)));

  return (
    <Table>
      <thead>
        <tr>
          <Th style={{ width: 28 }}>#</Th>
          <Th>Производитель</Th>
          <Th>Модель</Th>
          <Th style={{ textAlign: 'right' }}>Users</Th>
          <Th style={{ width: 210 }}>Доля</Th>
          <Th style={{ textAlign: 'right' }}>Δ</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const sharePct = shareToPercent(row.share);
          return (
            <tr key={`${row.platform}:${row.manufacturer}:${row.model}`}>
              <Td style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Td>
              <Td>{row.manufacturer || '—'}</Td>
              <Td bold>{row.model}</Td>
              <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
              <Td><HorizontalBar value={sharePct} max={maxShare} color={color} /></Td>
              <Td style={{ textAlign: 'right', color: row.delta > 0 ? '#22C55E' : row.delta < 0 ? '#EF4444' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                {row.delta > 0 ? '+' : ''}{row.delta.toFixed(1)}%
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function OsVersionChart({ rows, color, themeColors }: { rows: BiDeviceOsRow[]; color: string; themeColors: ChartThemeColors }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || rows.length === 0) return;
    chartRef.current?.destroy();

    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(row => row.os),
        datasets: [{
          label: 'Доля %',
          data: rows.map(row => Number(shareToPercent(row.share).toFixed(2))),
          backgroundColor: (context: { chart: Chart }) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.48);
            return createVerticalGradient(ctx, chartArea, color, 0.62, 0.22);
          },
          hoverBackgroundColor: (context: { chart: Chart }) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.68);
            return createVerticalGradient(ctx, chartArea, color, 0.82, 0.34);
          },
          borderColor: color,
          hoverBorderColor: color,
          borderWidth: 1.4,
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.74,
          categoryPercentage: 0.78,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 8, right: 74, bottom: 10, left: 6 } },
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
            cornerRadius: 10,
            callbacks: {
              label: context => {
                const row = rows[context.dataIndex];
                return `${context.raw}% · ${formatNumber(Number(row?.users || 0))} users`;
              },
            },
          },
        },
        scales: {
          x: {
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: {
              color: themeColors.text3,
              font: { size: 10, family: themeColors.mono },
              callback: value => `${value}%`,
            },
          },
          y: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: { color: themeColors.text2, font: { size: 11, family: themeColors.font, weight: 600 } },
          },
        },
      },
      plugins: [{
        id: 'os-users-labels',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const meta = chart.getDatasetMeta(0);
          const area = chart.chartArea;

          ctx.save();
          ctx.font = `600 11px ${themeColors.mono}`;
          ctx.textBaseline = 'middle';

          meta.data.forEach((element, index) => {
            const row = rows[index];
            if (!row) return;
            const point = element.getProps(['x', 'y'], true);
            const label = formatNumber(Number(row.users || 0));
            const safeX = Math.min(point.x + 10, area.right - 6);
            const align: CanvasTextAlign = safeX >= area.right - 44 ? 'right' : 'left';
            drawChartPillLabel(ctx, label, align === 'right' ? area.right - 4 : safeX, point.y, align, color, themeColors);
          });

          ctx.restore();
        },
      }],
    });

    return () => chartRef.current?.destroy();
  }, [color, rows, themeColors]);

  return <canvas ref={ref} style={{ display: 'block', height: Math.max(160, rows.length * 32 + 30) }} />;
}

function getOsTotal(rows: BiDeviceOsRow[]) {
  const maxTotal = rows.reduce((max, row) => Math.max(max, Number(row.total || 0)), 0);
  if (maxTotal > 0) return maxTotal;
  return rows.reduce((sum, row) => sum + Number(row.users || 0), 0);
}

function exportCsv(rows: DeviceViewRow[]) {
  if (!rows.length) return;

  const header = ['platform', 'manufacturer', 'model', 'users', 'share_pct', 'delta_pct'];
  const lines = rows.map(row => [
    row.platform,
    `"${String(row.manufacturer || '').replace(/"/g, '""')}"`,
    `"${String(row.model || '').replace(/"/g, '""')}"`,
    row.users,
    shareToPercent(row.share).toFixed(2),
    row.delta.toFixed(1),
  ].join(','));

  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bi-devices-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function buildInitialState() {
  const history = readHistory();
  const latest = history.length ? history[history.length - 1] : null;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const rows = rowsFromSnapshot(latest);
  const withDeltas = applyDeltas(rows, previous);

  return {
    history,
    rows: withDeltas,
    osRows: osRowsFromSnapshot(latest),
    lastLoadedAt: latest?.time || '',
    previousSnapshotAt: previous?.time || '',
    totals: {
      android: Number(latest?.totals?.Android || 0),
      ios: Number(latest?.totals?.iOS || 0),
    } as Record<'android' | 'ios', number>,
  };
}

function snapshotDeviceTotals(snapshot: DeviceSnapshot, platform: SnapshotPlatform) {
  const map = new Map<string, number>();
  (snapshot.records || []).forEach(record => {
    if (record.platform !== platform) return;
    const label = deviceLabel(record);
    if (!label) return;
    map.set(label, (map.get(label) || 0) + Number(record.users || 0));
  });
  return map;
}

function wrapChartLabel(label: string, maxLen = 14) {
  const text = normalizeText(label);
  if (!text) return ['—'];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  const push = () => {
    if (line) lines.push(line);
    line = '';
  };

  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLen) {
      line = next;
      return;
    }
    if (line) push();
    if (word.length <= maxLen) {
      line = word;
      return;
    }
    const chunks = word.match(new RegExp(`.{1,${maxLen}}`, 'g')) || [word];
    chunks.forEach((chunk, index) => {
      if (index === chunks.length - 1) line = chunk;
      else lines.push(chunk);
    });
  });

  push();
  return lines.length ? lines : [text];
}

function formatSnapshotLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function chooseDeviceSnapshots(history: DeviceSnapshot[], selectedTimes: string[]) {
  const selected = new Set(selectedTimes);
  if (selected.size) {
    return history.filter(snapshot => selected.has(snapshot.time)).slice(-HISTORY_COMPARE_LIMIT);
  }
  return history.slice(-HISTORY_COMPARE_LIMIT);
}

function statusBadgeColor(tone: StatusTone): 'gray' | 'green' | 'yellow' | 'red' {
  if (tone === 'ok') return 'green';
  if (tone === 'warn') return 'yellow';
  if (tone === 'error') return 'red';
  return 'gray';
}

function platformLabel(platform: FocusPlatform) {
  return platform === 'android' ? 'Android' : 'iOS';
}

function bestOsLabel(rows: BiDeviceOsRow[], platform: FocusPlatform) {
  const match = rows
    .filter(row => row.platform === platform)
    .sort((left, right) => Number(right.users || 0) - Number(left.users || 0))[0];
  return match?.os || '—';
}

interface RecommendedDevice {
  platform: FocusPlatform;
  device: string;
  users: number;
  share: number;
  os: string;
  reason: string;
}

function buildRecommendedDevices(
  androidRows: DeviceViewRow[],
  iosRows: DeviceViewRow[],
  osRows: BiDeviceOsRow[],
): RecommendedDevice[] {
  const result: RecommendedDevice[] = [];
  const seen = new Set<string>();
  const add = (platform: FocusPlatform, row: DeviceViewRow | undefined, reason: string) => {
    if (!row) return;
    const key = `${platform}:${deviceKey(row)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      platform,
      device: deviceLabel(row),
      users: row.users,
      share: shareToPercent(row.share),
      os: bestOsLabel(osRows, platform),
      reason,
    });
  };

  androidRows.slice(0, 3).forEach(row => add('android', row, 'Top Android audience'));
  iosRows.slice(0, 3).forEach(row => add('ios', row, 'Top iOS audience'));
  add('android', androidRows.filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta)[0], 'Fast-growing Android');
  add('ios', iosRows.filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta)[0], 'Fast-growing iOS');

  return result.slice(0, 8);
}

function HistoryDevicesChart({
  snapshots,
  platform,
  topCount,
  themeColors,
}: {
  snapshots: DeviceSnapshot[];
  platform: SnapshotPlatform;
  topCount: number;
  themeColors: ChartThemeColors;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [chartWidth, setChartWidth] = useState(760);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || snapshots.length === 0) return;

    const palette = ['#22C55E', '#2563EB', '#F59E0B', '#8B5CF6'];
    const maps = snapshots.map(snapshot => snapshotDeviceTotals(snapshot, platform));
    const latestMap = maps[maps.length - 1] || new Map<string, number>();
    const labels = [...latestMap.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, topCount)
      .map(([label]) => label);

    if (!labels.length) {
      chartRef.current?.destroy();
      return;
    }

    setChartWidth(Math.max(760, labels.length * 120));
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: maps.map((map, index) => ({
          label: formatSnapshotLabel(snapshots[index].time),
          data: labels.map(label => map.get(label) || 0),
          backgroundColor: (context: { chart: Chart }) => {
            const base = palette[index % palette.length];
            const latest = index === maps.length - 1;
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(base, latest ? 0.58 : 0.34);
            return createVerticalGradient(ctx, chartArea, base, latest ? 0.72 : 0.46, latest ? 0.2 : 0.1);
          },
          hoverBackgroundColor: (context: { chart: Chart }) => {
            const base = palette[index % palette.length];
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(base, 0.72);
            return createVerticalGradient(ctx, chartArea, base, 0.86, 0.24);
          },
          borderColor: palette[index % palette.length],
          hoverBorderColor: palette[index % palette.length],
          borderWidth: index === maps.length - 1 ? 1.8 : 1,
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.82,
          categoryPercentage: 0.68,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 12, right: 14, bottom: 8, left: 8 } },
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
            cornerRadius: 10,
            callbacks: {
              title: items => labels[items[0]?.dataIndex || 0] || '',
              label: context => `${context.dataset.label}: ${formatNumber(Number(context.raw || 0))}`,
            },
          },
        },
        scales: {
          x: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: {
              color: themeColors.text2,
              font: { size: 10, family: themeColors.font, weight: 600 },
              callback: (_, index) => wrapChartLabel(labels[index] || ''),
            },
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
  }, [platform, snapshots, topCount, themeColors]);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}>
      <div style={{ minWidth: chartWidth, height: 340 }}>
        <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}

export function Devices() {
  const { settings } = useSettings();
  const { theme } = useApp();
  const initialState = useMemo(buildInitialState, []);
  const storedSettings = useMemo(readModuleSettings, []);
  const mainExportRef = useRef<HTMLDivElement | null>(null);
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [focusPlatform, setFocusPlatform] = useState<FocusPlatform>(storedSettings.focusPlatform);
  const [view, setView] = useState<ViewMode>(storedSettings.view);
  const [topCount, setTopCount] = useState(storedSettings.topCount);
  const [interval, setInterval] = useState<BiInterval>(storedSettings.interval);
  const [selectedSnapshotTimes, setSelectedSnapshotTimes] = useState<string[]>(storedSettings.selectedSnapshotTimes);
  const [rows, setRows] = useState<DeviceViewRow[]>(initialState.rows);
  const [osRows, setOsRows] = useState<BiDeviceOsRow[]>(initialState.osRows);
  const [history, setHistory] = useState<DeviceSnapshot[]>(initialState.history);
  const [totals, setTotals] = useState<Record<'android' | 'ios', number>>(initialState.totals);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(initialState.history.length ? 'История загружена локально.' : 'Нажмите «Обновить», чтобы загрузить BI данные.');
  const [statusTone, setStatusTone] = useState<StatusTone>(initialState.history.length ? 'ok' : 'neutral');
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>(settings.useProxy === false ? 'ok' : 'unknown');
  const [driveState, setDriveState] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [lastLoadedAt, setLastLoadedAt] = useState(initialState.lastLoadedAt);
  const [previousSnapshotAt, setPreviousSnapshotAt] = useState(initialState.previousSnapshotAt);
  const didAutoLoadRef = useRef(false);

  useEffect(() => {
    writeModuleSettings({ interval, focusPlatform, view, topCount, selectedSnapshotTimes });
  }, [focusPlatform, interval, selectedSnapshotTimes, topCount, view]);

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
        if (!response.ok) throw new Error(`Drive devices history HTTP ${response.status}`);
        const merged = mergeBiSnapshots(readHistory(), normalizeBiSnapshotsPayload(text, normalizeSnapshot), HISTORY_LIMIT);
        if (!cancelled) {
          writeHistory(merged);
          setHistory(merged);
          setDriveState('ok');
          if (merged.length) {
            setStatus(`История устройств синхронизирована: ${merged.length} снэпшотов.`);
            setStatusTone('ok');
          }
        }
      } catch {
        if (!cancelled) {
          setDriveState('error');
        }
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
    () => history.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, HISTORY_LIMIT),
    [history],
  );
  const chosenSnapshots = useMemo(
    () => chooseDeviceSnapshots(history, selectedSnapshotTimes),
    [history, selectedSnapshotTimes],
  );
  const currentSnapshot = chosenSnapshots[chosenSnapshots.length - 1] || null;
  const previousSnapshot = chosenSnapshots.length > 1 ? chosenSnapshots[chosenSnapshots.length - 2] : null;

  useEffect(() => {
    const allowed = new Set(snapshotOptions.map(snapshot => snapshot.time));
    if (selectedSnapshotTimes.every(item => allowed.has(item))) return;
    setSelectedSnapshotTimes(prev => prev.filter(item => allowed.has(item)));
  }, [selectedSnapshotTimes, snapshotOptions]);

  useEffect(() => {
    const currentRows = rowsFromSnapshot(currentSnapshot);
    setRows(applyDeltas(currentRows, previousSnapshot));
    setOsRows(osRowsFromSnapshot(currentSnapshot));
    setTotals({
      android: Number(currentSnapshot?.totals?.Android || 0),
      ios: Number(currentSnapshot?.totals?.iOS || 0),
    });
    setLastLoadedAt(currentSnapshot?.time || '');
    setPreviousSnapshotAt(previousSnapshot?.time || '');
  }, [currentSnapshot, previousSnapshot]);

  const load = useCallback(async () => {
    if (!String(settings.biCookie || '').trim()) {
      setStatus('Нужен WB BI Cookie в общих настройках.');
      setStatusTone('error');
      setError('Нужен WB BI Cookie в общих настройках.');
      return;
    }

    setLoading(true);
    setError('');
    setStatus('Загружаю устройства и OS из WB BI.');
    setStatusTone('neutral');

    try {
      const payload = await fetchBiDevices({
        base: settings.ytBase,
        token: settings.ytToken,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        biCookie: settings.biCookie,
      }, {
        interval,
      });

      const nextHistory = persistSnapshot(payload.rows, payload.osRows, payload.totals, payload.fetchedAt);

      setSelectedSnapshotTimes([]);
      setHistory(nextHistory);
      setStatus(`Снэпшот устройств обновлён: ${formatSnapshotLabel(payload.fetchedAt)}. Устройств: ${payload.rows.length}, OS: ${payload.osRows.length}.`);
      setStatusTone('ok');

      try {
        await biDriveFetch(runtimeSettings, buildBiDriveSaveUrl(HISTORY_FILE), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextHistory),
        });
        setDriveState('ok');
      } catch {
        setDriveState('error');
        setStatus('Снэпшот устройств обновлён локально, но Drive не синхронизирован.');
        setStatusTone('warn');
      }
    } catch (loadError) {
      const message = (loadError as Error).message || 'Не удалось загрузить BI данные.';
      setError(message);
      setStatus(message);
      setStatusTone('error');
    } finally {
      setLoading(false);
    }
  }, [interval, runtimeSettings, settings]);

  useEffect(() => {
    if (didAutoLoadRef.current) return;
    if (!settings.useProxy || !String(settings.proxyBase || '').trim() || !String(settings.biCookie || '').trim()) return;
    didAutoLoadRef.current = true;
    void load();
  }, [load, settings.biCookie, settings.proxyBase, settings.useProxy]);

  const androidRows = useMemo(() => rows.filter(row => row.platform === 'android'), [rows]);
  const iosRows = useMemo(() => rows.filter(row => row.platform === 'ios'), [rows]);
  const topLimit = Number(topCount || 10) || 10;
  const androidTopRows = useMemo(() => androidRows.slice(0, topLimit), [androidRows, topLimit]);
  const iosTopRows = useMemo(() => iosRows.slice(0, topLimit), [iosRows, topLimit]);
  const androidOsRows = useMemo(() => osRows.filter(row => row.platform === 'android'), [osRows]);
  const iosOsRows = useMemo(() => osRows.filter(row => row.platform === 'ios'), [osRows]);
  const androidOsTotal = useMemo(() => getOsTotal(androidOsRows), [androidOsRows]);
  const iosOsTotal = useMemo(() => getOsTotal(iosOsRows), [iosOsRows]);
  const focusRows = focusPlatform === 'android' ? androidRows : iosRows;
  const focusTopRows = focusPlatform === 'android' ? androidTopRows : iosTopRows;
  const focusTotal = totals[focusPlatform] || focusRows.reduce((sum, row) => sum + row.users, 0);
  const top3Share = focusRows.slice(0, 3).reduce((sum, row) => sum + shareToPercent(row.share), 0);
  const avgDelta = focusRows.length
    ? Number((focusRows.reduce((sum, row) => sum + row.delta, 0) / focusRows.length).toFixed(1))
    : 0;
  const growing = focusRows.filter(row => row.delta > 0).length;
  const historySnapshots = useMemo(
    () => chosenSnapshots.length ? chosenSnapshots : history.slice(-HISTORY_COMPARE_LIMIT),
    [chosenSnapshots, history]
  );
  const historyPlatform = focusPlatform === 'android' ? 'Android' : 'iOS';
  const hasRows = rows.length > 0;
  const chartThemeColors = useMemo(() => getChartThemeColors(), [theme]);
  const recommendedDevices = useMemo(
    () => buildRecommendedDevices(androidRows, iosRows, osRows),
    [androidRows, iosRows, osRows],
  );
  const dataWarnings = useMemo(() => {
    const out: string[] = [];
    if (!String(settings.biCookie || '').trim()) out.push('BI cookie не задан.');
    if (settings.useProxy !== false && proxyState === 'error') out.push('Proxy недоступен, BI-запросы не пройдут.');
    if (hasRows && !androidRows.length) out.push('В текущем срезе нет Android устройств.');
    if (hasRows && !iosRows.length) out.push('В текущем срезе нет iOS устройств.');
    if (hasRows && focusRows.length && top3Share > 70) out.push(`Top-3 ${platformLabel(focusPlatform)} занимает ${top3Share.toFixed(1)}% аудитории.`);
    return out;
  }, [androidRows.length, focusPlatform, focusRows.length, hasRows, iosRows.length, proxyState, settings.biCookie, settings.useProxy, top3Share]);

  const exportPdf = useCallback(async () => {
    if (!hasRows) return;
    const mainNode = mainExportRef.current;
    const historyNode = historyExportRef.current;
    if (!mainNode) {
      setError('Не удалось собрать секции для PDF.');
      return;
    }

    setExportingPdf(true);
    try {
      const { html2canvas, jsPDF } = await ensurePdfLibraries();
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxWidth = pageWidth - margin * 2;
      let pageIndex = 0;

      const capture = async (node: HTMLElement) => {
        const canvas = await html2canvas(node, {
          backgroundColor: chartThemeColors.surface,
          scale: 2,
          useCORS: true,
          logging: false,
        });
        return {
          ratio: canvas.height / canvas.width,
          data: canvas.toDataURL('image/jpeg', 0.96),
        };
      };

      const addPage = (image: { ratio: number; data: string }) => {
        if (pageIndex > 0) pdf.addPage();
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        const maxHeight = pageHeight - margin * 2;
        let width = maxWidth;
        let height = image.ratio * width;
        if (height > maxHeight) {
          height = maxHeight;
          width = height / image.ratio;
        }

        const x = Math.max(margin, (pageWidth - width) / 2);
        const y = Math.max(margin, (pageHeight - height) / 2);
        pdf.addImage(image.data, 'JPEG', x, y, width, height, undefined, 'FAST');
        pageIndex += 1;
      };

      addPage(await capture(mainNode));
      if (historyNode) {
        addPage(await capture(historyNode));
      }

      pdf.save(`wb-bi-devices-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (pdfError) {
      setError((pdfError as Error).message || 'Не удалось собрать PDF.');
    } finally {
      setExportingPdf(false);
    }
  }, [chartThemeColors.surface, hasRows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▣</div>
        Популярные устройства
      </div>

      <Card>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <FieldLabel>Интервал BI</FieldLabel>
              <Select value={interval} onChange={event => setInterval(normalizeBiInterval(event.target.value))} style={{ width: 180 }}>
                {BI_INTERVAL_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>

            <div>
              <FieldLabel>Фокус платформы</FieldLabel>
              <SegmentControl
                items={[
                  { label: 'Android', value: 'android' },
                  { label: 'iOS', value: 'ios' },
                ]}
                value={focusPlatform}
                onChange={value => setFocusPlatform(value as FocusPlatform)}
              />
            </div>

            <div>
              <FieldLabel>Режим</FieldLabel>
              <SegmentControl
                items={[
                  { label: 'Таблица', value: 'table' },
                  { label: 'OS chart', value: 'chart' },
                ]}
                value={view}
                onChange={value => setView(value as ViewMode)}
              />
            </div>

            <div>
              <FieldLabel>Срез устройств</FieldLabel>
              <SegmentControl
                items={TOP_COUNT_OPTIONS}
                value={topCount}
                onChange={setTopCount}
              />
            </div>

            <Button variant="primary" onClick={load} disabled={loading}>
              {loading ? '...' : '⟳ Обновить'}
            </Button>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color={statusBadgeColor(statusTone)}>{status}</Badge>
              <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
                proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
              </Badge>
              <Badge color={driveState === 'ok' ? 'green' : driveState === 'error' ? 'red' : 'gray'}>drive {driveState}</Badge>
              <Badge color={settings.biCookie ? 'blue' : 'red'}>{settings.biCookie ? 'bi cookie ready' : 'bi cookie missing'}</Badge>
              <Button variant="ghost" size="sm" onClick={() => void exportPdf()} disabled={!hasRows || exportingPdf}>
                {exportingPdf ? 'PDF...' : 'Экспорт PDF'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => exportCsv(rows)} disabled={!hasRows}>Экспорт CSV</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Снэпшоты для сравнения</CardTitle>
            <CardHint>Выбранные срезы управляют таблицами, delta и графиком истории устройств.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedSnapshotTimes(snapshotOptions.slice(0, HISTORY_COMPARE_LIMIT).map(snapshot => snapshot.time))}>
              Последние {HISTORY_COMPARE_LIMIT}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedSnapshotTimes([])}>Сброс</Button>
          </div>
        </CardHeader>
        <CardBody style={{ paddingTop: 8 }}>
          {!snapshotOptions.length ? (
            <EmptyState text="История устройств пока пуста." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
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
                      <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--text-3)' }}>{snapshot.records.length} устройств · {(snapshot.osRecords || []).length} OS</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => {
                        const next = event.target.checked
                          ? [...selectedSnapshotTimes, snapshot.time]
                          : selectedSnapshotTimes.filter(item => item !== snapshot.time);
                        setSelectedSnapshotTimes(next.slice(-HISTORY_COMPARE_LIMIT));
                      }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {[
          { label: 'Устройств в выборке', value: focusRows.length, color: 'var(--text)' },
          { label: 'Пользователей в базе', value: formatNumber(focusTotal), color: focusPlatform === 'android' ? '#22C55E' : '#9B5CFF' },
          { label: 'Топ-3 доля', value: `${top3Share.toFixed(1)}%`, color: '#F59E0B' },
          { label: 'Ср. изменение', value: `${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(1)}% · ${growing} растут`, color: avgDelta >= 0 ? '#22C55E' : '#EF4444' },
        ].map(metric => (
          <Card key={metric.label}>
            <CardBody>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{metric.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: metric.color, fontVariantNumeric: 'tabular-nums' }}>{metric.value}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Контекст данных</CardTitle>
            <CardHint>Те же BI datasource’ы, что и в legacy странице: устройства и версии ОС, плюс локальная история `bi_devices_history`.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Badge color="gray">current: {lastLoadedAt ? new Date(lastLoadedAt).toLocaleString('ru-RU') : '—'}</Badge>
            <Badge color="gray">prev: {previousSnapshotAt ? new Date(previousSnapshotAt).toLocaleString('ru-RU') : '—'}</Badge>
          </div>
        </CardHeader>
        <CardBody style={{ paddingTop: 8, color: 'var(--text-2)', fontSize: 12, lineHeight: 1.7 }}>
          `Δ` считается по изменению users относительно предыдущего сохранённого снапшота. Если данных в истории нет, модуль показывает реальный текущий BI с нулевым delta и сразу сохраняет его для следующего сравнения.
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
              <CardHint>Сигналы, которые стоит проверить перед использованием отчёта для выбора тестовых устройств.</CardHint>
            </div>
            <Badge color="yellow">{dataWarnings.length}</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dataWarnings.map(item => (
                <div key={item} style={{ padding: '9px 11px', borderRadius: 10, border: '1px solid rgba(245,158,11,.22)', background: 'rgba(245,158,11,.08)', color: 'var(--text-2)', fontSize: 12 }}>
                  {item}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {!hasRows ? (
        <Card>
          <EmptyState text="Нажмите «Обновить», чтобы загрузить устройства из WB BI." />
        </Card>
      ) : view === 'table' ? (
        <div ref={mainExportRef} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Android — топ устройства</CardTitle>
                <CardHint>Показываем top {topLimit} из {androidRows.length} моделей</CardHint>
              </div>
              <Badge color="green">Android</Badge>
            </CardHeader>
            <DeviceTable rows={androidTopRows} color="#22C55E" />
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>iOS — топ устройства</CardTitle>
                <CardHint>Показываем top {topLimit} из {iosRows.length} моделей</CardHint>
              </div>
              <Badge color="purple">iOS</Badge>
            </CardHeader>
            <DeviceTable rows={iosTopRows} color="#9B5CFF" />
          </Card>
        </div>
      ) : (
        <div ref={mainExportRef} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Android — версии OS</CardTitle>
                <CardHint>{androidOsRows.length} версий ОС · {formatNumber(androidOsTotal)} пользователей · datasource `16888`</CardHint>
              </div>
              <Badge color="green">Android {formatNumber(androidOsTotal)}</Badge>
            </CardHeader>
            <div style={{ padding: '14px 16px' }}>
              {androidOsRows.length ? <OsVersionChart rows={androidOsRows} color="#22C55E" themeColors={chartThemeColors} /> : <EmptyState text="Нет Android OS данных" />}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>iOS — версии OS</CardTitle>
                <CardHint>{iosOsRows.length} версий ОС · {formatNumber(iosOsTotal)} пользователей · datasource `16888`</CardHint>
              </div>
              <Badge color="purple">iOS {formatNumber(iosOsTotal)}</Badge>
            </CardHeader>
            <div style={{ padding: '14px 16px' }}>
              {iosOsRows.length ? <OsVersionChart rows={iosOsRows} color="#9B5CFF" themeColors={chartThemeColors} /> : <EmptyState text="Нет iOS OS данных" />}
            </div>
          </Card>
        </div>
      )}

      {hasRows && recommendedDevices.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Рекомендованный набор для регрессии</CardTitle>
              <CardHint>Автоподбор из top audience и быстрорастущих устройств. OS hint берётся из текущего BI OS-среза.</CardHint>
            </div>
            <Badge color="blue">{recommendedDevices.length} устройств</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 10 }}>
            <Table>
              <thead>
                <tr>
                  <Th>Платформа</Th>
                  <Th>Устройство</Th>
                  <Th>OS hint</Th>
                  <Th>Причина</Th>
                  <Th style={{ textAlign: 'right' }}>Users</Th>
                  <Th style={{ textAlign: 'right' }}>Доля</Th>
                </tr>
              </thead>
              <tbody>
                {recommendedDevices.map(row => (
                  <tr key={`${row.platform}:${row.device}:${row.reason}`}>
                    <Td><Badge color={row.platform === 'android' ? 'green' : 'purple'}>{platformLabel(row.platform)}</Badge></Td>
                    <Td bold>{row.device}</Td>
                    <Td mono>{row.os}</Td>
                    <Td>{row.reason}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.users)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.share.toFixed(2)}%</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {hasRows && (
        <div ref={historyExportRef}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>История популярных устройств</CardTitle>
              <CardHint>
                Сравнение top {topLimit} {historyPlatform} по последним {Math.min(historySnapshots.length, HISTORY_COMPARE_LIMIT)} снепшотам из `bi_devices_history`.
              </CardHint>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Badge color={focusPlatform === 'android' ? 'green' : 'purple'}>{historyPlatform}</Badge>
              <Badge color="gray">current top: {focusTopRows.length}</Badge>
            </div>
          </CardHeader>
          <CardBody style={{ paddingTop: 10 }}>
            {historySnapshots.length > 0 ? (
              <>
                <div
                  style={{
                    borderRadius: 14,
                    border: '1px solid var(--surface-soft-4)',
                    background: 'var(--surface-soft)',
                    padding: 12,
                  }}
                >
                  <HistoryDevicesChart
                    snapshots={historySnapshots}
                    platform={historyPlatform}
                    topCount={topLimit}
                    themeColors={chartThemeColors}
                  />
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 8,
                  }}
                >
                  {historySnapshots.map(snapshot => (
                    <div
                      key={snapshot.time}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid var(--surface-soft-4)',
                        background: 'var(--surface-soft)',
                      }}
                    >
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', marginBottom: 4 }}>
                        Снепшот
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {formatSnapshotLabel(snapshot.time)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState text="История снепшотов пока не накоплена." />
            )}
          </CardBody>
        </Card>
        </div>
      )}
    </div>
  );
}
