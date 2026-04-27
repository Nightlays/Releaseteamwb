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
import { fetchBiDevices, type BiDeviceOsRow, type BiDeviceRow } from '../../services/youtrack';

Chart.register(BarController, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const HISTORY_KEY = 'bi_devices_history';
const HISTORY_LIMIT = 12;
const HISTORY_COMPARE_LIMIT = 4;
const SNAPSHOT_MAX_PER_PLATFORM = 300;
const TOP_COUNT_OPTIONS = [
  { label: 'Top 5', value: '5' },
  { label: 'Top 10', value: '10' },
];
const INTERVAL_OPTIONS = [
  { label: 'today', value: 'today' },
  { label: 'yesterday', value: 'yesterday' },
  { label: 'last_2_days', value: 'last_2_days' },
  { label: 'last_7_days', value: 'last_7_days' },
  { label: 'last_30_days', value: 'last_30_days' },
];

type SnapshotPlatform = 'Android' | 'iOS';

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
  };
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
  };
}

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeSnapshot)
      .filter((item): item is DeviceSnapshot => Boolean(item))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  } catch {
    return [];
  }
}

function writeHistory(history: DeviceSnapshot[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    /* ignore storage errors */
  }
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

function persistSnapshot(rows: BiDeviceRow[], totals: Record<'android' | 'ios', number>, fetchedAt: string) {
  const history = readHistory();
  const snapshot: DeviceSnapshot = {
    time: fetchedAt,
    totals: {
      Android: totals.android,
      iOS: totals.ios,
    },
    records: compactRows(rows),
  };

  history.push(snapshot);
  writeHistory(history);
  return history.slice(-HISTORY_LIMIT);
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-soft-4)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
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
          backgroundColor: `${color}BB`,
          borderColor: color,
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
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
              font: { size: 10 },
              callback: value => `${value}%`,
            },
          },
          y: {
            border: { color: themeColors.border },
            grid: { display: false },
            ticks: { color: themeColors.text2, font: { size: 11 } },
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
          ctx.fillStyle = themeColors.text;
          ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
          ctx.textBaseline = 'middle';

          meta.data.forEach((element, index) => {
            const row = rows[index];
            if (!row) return;
            const point = element.getProps(['x', 'y'], true);
            const label = formatNumber(Number(row.users || 0));
            const safeX = Math.min(point.x + 8, area.right - 6);
            ctx.textAlign = safeX >= area.right - 24 ? 'right' : 'left';
            ctx.fillText(label, safeX, point.y);
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
          backgroundColor: `${palette[index % palette.length]}BB`,
          borderColor: palette[index % palette.length],
          borderWidth: index === maps.length - 1 ? 1.6 : 1,
          borderRadius: 6,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: themeColors.text2,
              font: { size: 11 },
            },
          },
          tooltip: {
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
              font: { size: 10 },
              callback: (_, index) => wrapChartLabel(labels[index] || ''),
            },
          },
          y: {
            beginAtZero: true,
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: {
              color: themeColors.text3,
              font: { size: 10 },
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
  const mainExportRef = useRef<HTMLDivElement | null>(null);
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [focusPlatform, setFocusPlatform] = useState<'android' | 'ios'>('android');
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [topCount, setTopCount] = useState('10');
  const [interval, setInterval] = useState('last_2_days');
  const [rows, setRows] = useState<DeviceViewRow[]>(initialState.rows);
  const [osRows, setOsRows] = useState<BiDeviceOsRow[]>([]);
  const [history, setHistory] = useState<DeviceSnapshot[]>(initialState.history);
  const [totals, setTotals] = useState<Record<'android' | 'ios', number>>(initialState.totals);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(initialState.lastLoadedAt);
  const [previousSnapshotAt, setPreviousSnapshotAt] = useState(initialState.previousSnapshotAt);
  const didAutoLoadRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

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

      const history = persistSnapshot(payload.rows, payload.totals, payload.fetchedAt);
      const previous = history.length > 1 ? history[history.length - 2] : null;

      setRows(applyDeltas(payload.rows, previous));
      setOsRows(payload.osRows);
      setHistory(history);
      setTotals(payload.totals);
      setLastLoadedAt(payload.fetchedAt);
      setPreviousSnapshotAt(previous?.time || '');
    } catch (loadError) {
      setError((loadError as Error).message || 'Не удалось загрузить BI данные.');
    } finally {
      setLoading(false);
    }
  }, [interval, settings]);

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
    () => history.slice(-HISTORY_COMPARE_LIMIT),
    [history]
  );
  const historyPlatform = focusPlatform === 'android' ? 'Android' : 'iOS';
  const hasRows = rows.length > 0;
  const chartThemeColors = useMemo(() => getChartThemeColors(), [theme]);

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
              <Select value={interval} onChange={event => setInterval(event.target.value)} style={{ width: 180 }}>
                {INTERVAL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
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
                onChange={value => setFocusPlatform(value as 'android' | 'ios')}
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
                onChange={value => setView(value as 'table' | 'chart')}
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
              <Badge color={settings.useProxy ? 'green' : 'red'}>{settings.useProxy ? 'proxy on' : 'proxy off'}</Badge>
              <Badge color={settings.biCookie ? 'blue' : 'red'}>{settings.biCookie ? 'bi cookie ready' : 'bi cookie missing'}</Badge>
              <Button variant="ghost" size="sm" onClick={() => void exportPdf()} disabled={!hasRows || exportingPdf}>
                {exportingPdf ? 'PDF...' : 'Экспорт PDF'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => exportCsv(rows)} disabled={!hasRows}>Экспорт CSV</Button>
            </div>
          </div>
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
