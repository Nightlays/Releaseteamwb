import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  LineController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
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
  CanonicalRunLine,
  CanonicalTable,
  CanonicalValueSelect,
  type CanonicalTableColumn,
  EmptyState,
  FieldLabel,
  Input,
  Modal,
  SegmentControl,
} from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
import {
  aggregateUwuStats,
  fetchUwuReport,
  normalizeUwuReleaseVersion,
  type UwuDaySlot,
  type UwuPersonRow,
  type UwuPlatformFilter,
  type UwuReport,
  type UwuStreamRow,
} from '../../services/uvu';
import {
  loadAvailableUwuReleaseReportsFromSupabase,
  loadUwuReleaseReportFromSupabase,
  saveUwuReleaseReportToSupabase,
} from '../../services/releaseStatsSupabase';

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const RELEASE_KEY = 'swat_uwu_release';
const FILTER_KEY = 'swat_uwu_filters';
const EMPTY_DAY_SLOTS: UwuDaySlot[] = [
  { key: 'fri', title: 'Пятница', weekday: 5, threshold: 200, dayKey: null, label: 'Пятница', rows: [], events: [] },
  { key: 'sat', title: 'Суббота', weekday: 6, threshold: 650, dayKey: null, label: 'Суббота', rows: [], events: [] },
  { key: 'sun', title: 'Воскресенье', weekday: 0, threshold: 650, dayKey: null, label: 'Воскресенье', rows: [], events: [] },
  { key: 'mon', title: 'Понедельник', weekday: 1, threshold: 650, dayKey: null, label: 'Понедельник', rows: [], events: [] },
];

type ActiveTab = 'people' | 'days';
type DetailTab = 'streams' | 'cases';
type SortKey = 'name' | 'cases' | 'uwu' | 'percent' | 'hours';
type SortScope = 'people' | 'streams' | 'personStreams' | 'streamMembers';
type SortDir = 'asc' | 'desc' | null;
type UvuCaseViewRow = UwuPersonRow['caseDetails'][number];
type UvuDayViewRow = UwuDaySlot['rows'][number];
type UvuDayDisplayRow = UvuDayViewRow & { thresholdCut?: boolean };

interface FilterValues {
  people: { name: string; uwuMin: string; uwuMax: string };
  streams: { name: string; uwuMin: string; uwuMax: string };
  platform: UwuPlatformFilter;
}

interface SortStateValue {
  key: SortKey | null;
  dir: SortDir;
}

interface PersonViewRow {
  source: UwuPersonRow;
  name: string;
  totalCases: number;
  uwuSum: number;
  uwuPresent: number;
  percent: number;
  durMs: number;
  daysWorked: number;
}

interface StreamViewRow {
  source: UwuStreamRow;
  name: string;
  totalCases: number;
  uwuSum: number;
  uwuPresent: number;
  percent: number;
  durMs: number;
}

interface PersonStreamViewRow {
  stream: string;
  totalCases: number;
  uwuSum: number;
  uwuPresent: number;
  percent: number;
  durMs: number;
}

interface StreamMemberViewRow {
  login: string;
  name: string;
  targetStream: string;
  totalCases: number;
  uwuSum: number;
  uwuPresent: number;
  percent: number;
  durMs: number;
}

interface DetailStatePerson {
  type: 'person';
  login: string;
}

interface DetailStateStream {
  type: 'stream';
  stream: string;
}

type DetailState = DetailStatePerson | DetailStateStream | null;

interface ChartThemeColors {
  text: string;
  text2: string;
  text3: string;
  grid: string;
  border: string;
}

declare global {
  interface Window {
    html2canvas?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    jspdf?: {
      jsPDF?: new (options?: Record<string, unknown>) => {
        internal: { pageSize: { getWidth(): number; getHeight(): number } };
        addPage: () => void;
        addImage: (data: string, format: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string) => void;
        save: (name: string) => void;
      };
    };
    XLSX?: {
      utils: {
        book_new: () => unknown;
        aoa_to_sheet: (rows: unknown[][]) => unknown;
        book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
      };
      write: (book: unknown, options: Record<string, unknown>) => ArrayBuffer;
    };
  }
}

function readText(key: string, fallback = '') {
  try {
    return String(localStorage.getItem(key) || fallback);
  } catch {
    return fallback;
  }
}

function readFilters(): FilterValues {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null') as Partial<FilterValues> | null;
    return {
      people: {
        name: String(raw?.people?.name || ''),
        uwuMin: String(raw?.people?.uwuMin || ''),
        uwuMax: String(raw?.people?.uwuMax || ''),
      },
      streams: {
        name: String(raw?.streams?.name || ''),
        uwuMin: String(raw?.streams?.uwuMin || ''),
        uwuMax: String(raw?.streams?.uwuMax || ''),
      },
      platform: raw?.platform === 'Android' || raw?.platform === 'iOS' ? raw.platform : null,
    };
  } catch {
    return {
      people: { name: '', uwuMin: '', uwuMax: '' },
      streams: { name: '', uwuMin: '', uwuMax: '' },
      platform: null,
    };
  }
}

function persistFilters(filters: FilterValues) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
}

function formatUwU(value: number) {
  const numeric = Number(value || 0);
  return numeric ? formatNumber(numeric) : '—';
}

function formatPercent(totalCases: number, uwuPresent: number) {
  if (!totalCases) return '0.0%';
  return `${((uwuPresent / totalCases) * 100).toFixed(1)}%`;
}

function percentValue(totalCases: number, uwuPresent: number) {
  if (!totalCases) return 0;
  return (uwuPresent / totalCases) * 100;
}

function formatHours(durationMs: number) {
  const totalMinutes = Math.round(Number(durationMs || 0) / 60000);
  if (!totalMinutes) return '—';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}.${String(minutes).padStart(2, '0')}`;
}

function formatWorkedHours(value: number | null) {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function normalizeDaysSearchQuery(value: string) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .replace(/ё/gi, 'е')
    .toLowerCase();
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getChartThemeColors() {
  return {
    text: readCssVar('--text', '#EEEAF8'),
    text2: readCssVar('--text-2', '#9D96B4'),
    text3: readCssVar('--text-3', '#5F5878'),
    grid: readCssVar('--chart-grid', 'rgba(255,255,255,.05)'),
    border: readCssVar('--border', 'rgba(255,255,255,.08)'),
  } satisfies ChartThemeColors;
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
  if (!window.html2canvas) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  }
  if (!window.jspdf?.jsPDF) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    throw new Error('PDF библиотеки не загрузились.');
  }
  return {
    html2canvas: window.html2canvas,
    jsPDF: window.jspdf.jsPDF,
  };
}

async function ensureXlsxLibrary() {
  if (!window.XLSX) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }
  if (!window.XLSX) {
    throw new Error('XLSX библиотека не загрузилась.');
  }
  return window.XLSX;
}

function overlap(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function placeLabelRect(
  occupied: Array<{ left: number; top: number; right: number; bottom: number }>,
  preferredX: number,
  preferredY: number,
  width: number,
  height: number,
  minTop: number,
) {
  let x = preferredX;
  let y = preferredY;
  let rect = { left: x - width / 2, top: y - height, right: x + width / 2, bottom: y };
  let attempts = 0;

  while (occupied.some(item => overlap(rect, item)) && attempts < 12) {
    y -= height + 4;
    rect = { left: x - width / 2, top: y - height, right: x + width / 2, bottom: y };
    if (rect.top < minTop) {
      x += attempts % 2 === 0 ? 14 : -14;
      y = preferredY + 8 + attempts * 2;
      rect = { left: x - width / 2, top: y - height, right: x + width / 2, bottom: y };
    }
    attempts += 1;
  }

  occupied.push(rect);
  return {
    x,
    y,
  };
}

function sortItems<T extends { name: string; totalCases: number; uwuSum: number; uwuPresent: number; durMs?: number; daysWorked?: number }>(
  items: T[],
  sortState: SortStateValue,
) {
  if (!sortState.key || !sortState.dir) return items;
  const dir = sortState.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sortState.key === 'name') {
      return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) * dir;
    }
    let left = 0;
    let right = 0;
    if (sortState.key === 'cases') {
      left = a.totalCases;
      right = b.totalCases;
    } else if (sortState.key === 'uwu') {
      left = a.uwuSum;
      right = b.uwuSum;
    } else if (sortState.key === 'percent') {
      left = a.totalCases ? (a.uwuPresent / a.totalCases) * 100 : 0;
      right = b.totalCases ? (b.uwuPresent / b.totalCases) * 100 : 0;
    } else if (sortState.key === 'hours') {
      if (typeof a.daysWorked === 'number' || typeof b.daysWorked === 'number') {
        left = Number(a.daysWorked || 0);
        right = Number(b.daysWorked || 0);
      } else {
        left = Number(a.durMs || 0);
        right = Number(b.durMs || 0);
      }
    }
    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) * dir;
  });
}

function toggleSortValue(current: SortStateValue, key: SortKey): SortStateValue {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  if (current.dir === 'desc') return { key: null, dir: null };
  return { key, dir: 'asc' };
}

function SortableColumnTitle({
  label,
  sortKey,
  scope,
  state,
  onToggle,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  scope: SortScope;
  state: Record<SortScope, SortStateValue>;
  onToggle: (scope: SortScope, key: SortKey) => void;
  align?: React.CSSProperties['textAlign'];
}) {
  const active = state[scope];
  const isActive = active.key === sortKey && active.dir;
  const arrow = active.key !== sortKey || !active.dir ? '↕' : active.dir === 'asc' ? '↑' : '↓';

  return (
    <button
      onClick={() => onToggle(scope, sortKey)}
      style={{
        display: 'inline-flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        gap: 6,
        border: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        color: isActive ? 'var(--text)' : 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        textTransform: 'inherit',
        letterSpacing: 'inherit',
        textAlign: align,
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: isActive ? 1 : 0.45 }}>{arrow}</span>
    </button>
  );
}

function LinkCellButton({
  children,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: React.CSSProperties['textAlign'];
}) {
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        width: '100%',
        border: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        color: '#8B5CF6',
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: 700,
        textAlign: align,
        textDecoration: 'none',
      }}
    >
      {children}
    </button>
  );
}

const numberCellStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text)',
  fontWeight: 650,
};

function UwuMeterCell({ value, max, valueColor = 'var(--text)' }: { value: number; max: number; valueColor?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (Number(value || 0) / max) * 100)) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, minWidth: 0 }}>
      <span style={{ color: valueColor, fontVariantNumeric: 'tabular-nums', fontWeight: 750 }}>{formatUwU(value)}</span>
      <span
        aria-hidden="true"
        style={{
          width: 'min(76px, 100%)',
          height: 4,
          borderRadius: 99,
          background: 'color-mix(in srgb, var(--accent) 13%, var(--surface-soft))',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            borderRadius: 99,
            background: 'linear-gradient(90deg,var(--accent),var(--accent-2))',
            opacity: pct > 0 ? 1 : 0,
          }}
        />
      </span>
    </div>
  );
}

function PercentBadge({ totalCases, uwuPresent }: { totalCases: number; uwuPresent: number }) {
  const value = percentValue(totalCases, uwuPresent);
  const tone = value >= 70 ? 'green' : value >= 40 ? 'yellow' : 'orange';
  const palette = tone === 'green'
    ? { color: '#166534', bg: 'rgba(34,197,94,.13)', border: 'rgba(34,197,94,.26)' }
    : tone === 'yellow'
      ? { color: '#854D0E', bg: 'rgba(234,179,8,.15)', border: 'rgba(234,179,8,.28)' }
      : { color: '#9A3412', bg: 'rgba(249,115,22,.14)', border: 'rgba(249,115,22,.28)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 58,
        padding: '3px 8px',
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontSize: 11,
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
      }}
    >
      {formatPercent(totalCases, uwuPresent)}
    </span>
  );
}

function DayTimelineChart({
  slot,
  selectedLogins,
  themeKey,
}: {
  slot: UwuDaySlot;
  selectedLogins: Set<string>;
  themeKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const colors = useMemo(() => getChartThemeColors(), [themeKey]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const filteredEvents = slot.events.filter(event => selectedLogins.has(event.login));
    if (!filteredEvents.length) return;

    const grouped = new Map<string, typeof filteredEvents>();
    filteredEvents.forEach(event => {
      const existing = grouped.get(event.login) || [];
      existing.push(event);
      grouped.set(event.login, existing);
    });
    grouped.forEach(events => events.sort((a, b) => a.hourFloat - b.hourFloat));

    const hours = Array.from({ length: 13 }, (_, index) => 10 + index);
    const hourLabels = hours.map(hour => `${String(hour).padStart(2, '0')}:00`);
    const palette = ['#9B5CFF', '#2563EB', '#22C55E', '#F97316', '#DB2777', '#0EA5E9', '#EAB308', '#6366F1', '#14B8A6', '#EF4444'];

    const datasets: Array<Record<string, unknown>> = Array.from(grouped.entries())
      .sort((a, b) => {
        const nameA = a[1][0]?.name || a[0];
        const nameB = b[1][0]?.name || b[0];
        return nameA.localeCompare(nameB, 'ru', { sensitivity: 'base' });
      })
      .map(([login, events], index) => {
        let cursor = 0;
        let cumulative = 0;
        return {
          label: events[0]?.name || login,
          data: hourLabels.map((label, pointIndex) => {
            const hour = hours[pointIndex];
            const previous = cumulative;
            while (cursor < events.length && Number(events[cursor].hourFloat || 0) <= hour) {
              cumulative += Number(events[cursor].uwuNum || 0);
              cursor += 1;
            }
            return {
              x: label,
              y: cumulative,
              delta: cumulative - previous,
              login,
            };
          }),
          borderColor: palette[index % palette.length],
          backgroundColor: palette[index % palette.length],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
        };
      });

    datasets.push({
      label: `Порог ${slot.threshold}`,
      data: hourLabels.map(label => ({ x: label, y: slot.threshold, delta: 0, login: '__threshold__' })),
      borderColor: '#64748B',
      backgroundColor: '#64748B',
      borderWidth: 2,
      borderDash: [6, 6],
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: hourLabels,
        datasets: datasets as never,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items: Array<{ label?: string }>) {
                return `${slot.label} · ${items[0]?.label || ''}`;
              },
              label(context: { raw: unknown; dataset: { label?: string } }) {
                if ((context.raw as { login?: string })?.login === '__threshold__') {
                  return `Порог: ${slot.threshold}`;
                }
                const raw = context.raw as { y?: number; delta?: number; login?: string };
                const row = slot.rows.find(item => item.login === raw.login);
                const deltaText = `${Number(raw.delta || 0) >= 0 ? '+' : ''}${formatUwU(Number(raw.delta || 0))}`;
                return `${context.dataset.label}: ${formatUwU(Number(raw.y || 0))} (Δ ${deltaText}, ч ${formatWorkedHours(row?.hours ?? null)})`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: colors.grid },
            ticks: { color: colors.text2, font: { family: 'var(--mono)', size: 11 } },
            border: { color: colors.border },
            title: { display: true, text: 'Время МСК', color: colors.text3 },
          },
          y: {
            beginAtZero: true,
            grid: { color: colors.grid },
            ticks: { color: colors.text2, font: { family: 'var(--mono)', size: 11 } },
            border: { color: colors.border },
            title: { display: true, text: 'Количество UwU', color: colors.text3 },
          },
        },
      } as never,
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [slot, selectedLogins, colors, themeKey]);

  if (!slot.events.filter(event => selectedLogins.has(event.login)).length) {
    return <EmptyState icon="∿" text="Нет событий для выбранных сотрудников." />;
  }

  return (
    <div style={{ height: 260 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export function Uvu() {
  const { settings } = useSettings();
  const { theme } = useApp();

  const [releaseVersion, setReleaseVersion] = useState(() => normalizeUwuReleaseVersion(readText(RELEASE_KEY, '7.5.0000')));
  const [includeHighBlocker, setIncludeHighBlocker] = useState(true);
  const [includeSelective, setIncludeSelective] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('people');
  const [running, setRunning] = useState(false);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbReleases, setDbReleases] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('—');
  const [error, setError] = useState('');
  const [report, setReport] = useState<UwuReport | null>(null);
  const [filters, setFilters] = useState<FilterValues>(readFilters);
  const [sortState, setSortState] = useState<Record<SortScope, SortStateValue>>({
    people: { key: null, dir: null },
    streams: { key: null, dir: null },
    personStreams: { key: null, dir: null },
    streamMembers: { key: null, dir: null },
  });
  const [detail, setDetail] = useState<DetailState>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('streams');
  const [daysSearch, setDaysSearch] = useState('');
  const [selectedDayLogins, setSelectedDayLogins] = useState<string[]>([]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterValues>({
    people: { name: '', uwuMin: '', uwuMax: '' },
    streams: { name: '', uwuMin: '', uwuMax: '' },
    platform: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const daysExportRef = useRef<HTMLDivElement | null>(null);
  const daysFilterInitializedRef = useRef(false);
  const defaultDbReleaseProjectRef = useRef('');

  const normalizedRelease = normalizeUwuReleaseVersion(releaseVersion);
  const tokenReady = Boolean(String(settings.allureToken || '').trim());
  const canRun = tokenReady && Boolean(normalizedRelease) && (includeHighBlocker || includeSelective) && !dbBusy;
  const canLoadFromDb = Boolean(normalizedRelease) && !running && !dbBusy;
  const exportLabel = activeTab === 'days' ? 'Выгрузить PDF' : 'Выгрузить Excel';
  const showRunStatus = running || dbBusy || progress > 0 || Boolean(error) || status !== '—' || !tokenReady;
  const runStatusText = error || (!tokenReady ? 'Allure token не настроен.' : status);

  useEffect(() => {
    try {
      localStorage.setItem(RELEASE_KEY, normalizedRelease);
    } catch {
      /* ignore */
    }
  }, [normalizedRelease]);

  useEffect(() => {
    persistFilters(filters);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    loadAvailableUwuReleaseReportsFromSupabase(settings.projectId)
      .then(releases => {
        if (!cancelled) setDbReleases(releases);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings.projectId]);

  const dbReleaseOptions = useMemo(() => (
    [...dbReleases].sort((left, right) => right.localeCompare(left, 'ru', { numeric: true, sensitivity: 'base' }))
  ), [dbReleases]);

  const dayUsers = useMemo(() => {
    if (!report) return [];
    return report.swatMembers.map(member => ({ login: member.login, name: member.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [report]);

  const selectedDaySet = useMemo(() => new Set(selectedDayLogins), [selectedDayLogins]);

  const filteredPeople = useMemo(() => {
    if (!report) return [] as PersonViewRow[];
    const filter = filters.people;
    const min = filter.uwuMin.trim() ? Number(filter.uwuMin) : null;
    const max = filter.uwuMax.trim() ? Number(filter.uwuMax) : null;
    const query = filter.name.trim().toLowerCase();

    const rows = report.people
      .map(source => {
        const aggregate = aggregateUwuStats(source.stats, filters.platform);
        return {
          source,
          name: source.name,
          totalCases: aggregate.totalCases,
          uwuSum: aggregate.uwuSum,
          uwuPresent: aggregate.uwuPresent,
          percent: aggregate.totalCases ? (aggregate.uwuPresent / aggregate.totalCases) * 100 : 0,
          durMs: aggregate.durTotalMs,
          daysWorked: source.daysWorked,
        } satisfies PersonViewRow;
      })
      .filter(row => row.totalCases > 0 || row.uwuSum > 0 || row.uwuPresent > 0 || row.durMs > 0)
      .filter(row => {
        if (query && row.source.login.toLowerCase() !== query && row.name.toLowerCase() !== query) return false;
        if (min != null && row.uwuSum < min) return false;
        if (max != null && row.uwuSum > max) return false;
        return true;
      });

    return sortItems(rows, sortState.people);
  }, [filters, report, sortState.people]);

  const filteredStreams = useMemo(() => {
    if (!report) return [] as StreamViewRow[];
    const filter = filters.streams;
    const min = filter.uwuMin.trim() ? Number(filter.uwuMin) : null;
    const max = filter.uwuMax.trim() ? Number(filter.uwuMax) : null;
    const query = filter.name.trim().toLowerCase();

    const rows = report.streams
      .map(source => {
        const aggregate = aggregateUwuStats(source.stats, filters.platform);
        return {
          source,
          name: source.stream,
          totalCases: aggregate.totalCases,
          uwuSum: aggregate.uwuSum,
          uwuPresent: aggregate.uwuPresent,
          percent: aggregate.totalCases ? (aggregate.uwuPresent / aggregate.totalCases) * 100 : 0,
          durMs: aggregate.durTotalMs,
        } satisfies StreamViewRow;
      })
      .filter(row => row.totalCases > 0 || row.uwuSum > 0 || row.uwuPresent > 0 || row.durMs > 0)
      .filter(row => {
        if (query && row.name.toLowerCase() !== query) return false;
        if (min != null && row.uwuSum < min) return false;
        if (max != null && row.uwuSum > max) return false;
        return true;
      });

    return sortItems(rows, sortState.streams);
  }, [filters, report, sortState.streams]);

  const detailPerson = useMemo(() => {
    if (!report || detail?.type !== 'person') return null;
    return report.people.find(person => person.login === detail.login) || null;
  }, [detail, report]);

  const detailStream = useMemo(() => {
    if (!report || detail?.type !== 'stream') return null;
    return report.streams.find(stream => stream.stream === detail.stream) || null;
  }, [detail, report]);

  const detailPersonStreams = useMemo(() => {
    if (!detailPerson) return [] as PersonStreamViewRow[];
    return sortItems(
      detailPerson.streams
        .map(entry => {
          const aggregate = aggregateUwuStats(entry.stats, filters.platform);
          return {
            stream: entry.stream,
            name: entry.stream,
            totalCases: aggregate.totalCases,
            uwuSum: aggregate.uwuSum,
            uwuPresent: aggregate.uwuPresent,
            percent: aggregate.totalCases ? (aggregate.uwuPresent / aggregate.totalCases) * 100 : 0,
            durMs: aggregate.durTotalMs,
          } satisfies PersonStreamViewRow & { name: string };
        })
        .filter(entry => entry.totalCases > 0 || entry.uwuSum > 0 || entry.uwuPresent > 0 || entry.durMs > 0),
      sortState.personStreams,
    );
  }, [detailPerson, filters.platform, sortState.personStreams]);

  const detailStreamMembers = useMemo(() => {
    if (!detailStream) return [] as StreamMemberViewRow[];
    return sortItems(
      detailStream.members
        .map(member => {
          const aggregate = aggregateUwuStats(member.stats, filters.platform);
          return {
            login: member.login,
            name: member.name,
            targetStream: member.targetStream,
            totalCases: aggregate.totalCases,
            uwuSum: aggregate.uwuSum,
            uwuPresent: aggregate.uwuPresent,
            percent: aggregate.totalCases ? (aggregate.uwuPresent / aggregate.totalCases) * 100 : 0,
            durMs: aggregate.durTotalMs,
          } satisfies StreamMemberViewRow;
        })
        .filter(entry => entry.totalCases > 0 || entry.uwuSum > 0 || entry.uwuPresent > 0 || entry.durMs > 0),
      sortState.streamMembers,
    );
  }, [detailStream, filters.platform, sortState.streamMembers]);

  const filteredDaySlots = useMemo(() => {
    if (!report) return EMPTY_DAY_SLOTS;
    return report.daySlots.map(slot => ({
      ...slot,
      rows: slot.rows.filter(row => selectedDaySet.has(row.login)),
      events: slot.events.filter(event => selectedDaySet.has(event.login)),
    }));
  }, [report, selectedDaySet]);

  const peopleFilterNameOptions = useMemo(() => {
    if (!report) return [] as string[];
    return Array.from(new Set(report.people.map(row => row.name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }));
  }, [report]);

  const streamFilterNameOptions = useMemo(() => {
    if (!report) return [] as string[];
    return Array.from(new Set(report.streams.map(row => row.stream).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }));
  }, [report]);

  const visibleDayUsers = useMemo(() => {
    const normalizedSearch = normalizeDaysSearchQuery(daysSearch);
    if (!normalizedSearch) return dayUsers;
    const searchParts = normalizedSearch.split(' ').filter(Boolean);
    return dayUsers.filter(user => {
      const displayName = normalizeDaysSearchQuery(user.name || user.login);
      return searchParts.every(part => displayName.includes(part));
    });
  }, [dayUsers, daysSearch]);

  const toggleSort = useCallback((scope: SortScope, key: SortKey) => {
    setSortState(prev => ({ ...prev, [scope]: toggleSortValue(prev[scope], key) }));
  }, []);

  const openPersonDetail = useCallback((login: string) => {
    setDetail({ type: 'person', login });
    setDetailTab('streams');
  }, []);

  const openStreamDetail = useCallback((stream: string) => {
    setDetail({ type: 'stream', stream });
  }, []);

  const applyReport = useCallback((nextReport: UwuReport) => {
    setReport(nextReport);
    const nextDayLogins = nextReport.swatMembers.map(member => member.login);
    setSelectedDayLogins(prev => {
      if (!daysFilterInitializedRef.current) {
        if (nextDayLogins.length > 0) daysFilterInitializedRef.current = true;
        return nextDayLogins;
      }
      const allowed = new Set(nextDayLogins);
      return prev.filter(login => allowed.has(login));
    });
  }, []);

  const run = useCallback(async () => {
    if (!canRun || running) return;
    const controller = new AbortController();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);
    setError('');
    setStatus('Подготовка…');

    try {
      const nextReport = await fetchUwuReport(
        {
          base: settings.allureBase,
          token: settings.allureToken,
          projectId: settings.projectId,
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
        },
        {
          releaseVersion: normalizedRelease,
          includeHighBlocker,
          includeSelective,
          signal: controller.signal,
          onProgress(nextProgress, nextStatus) {
            if (runId !== runIdRef.current) return;
            setProgress(nextProgress);
            setStatus(nextStatus);
          },
        },
      );

      if (runId !== runIdRef.current) return;
      applyReport(nextReport);
      setStatus('Расчёт готов. Записываю уникальный срез релиза в БД…');
      try {
        await saveUwuReleaseReportToSupabase(settings.projectId, nextReport);
        if (runId === runIdRef.current) {
          setDbReleases(prev => Array.from(new Set([...prev, nextReport.releaseVersion])));
          setStatus('Готово. Срез релиза записан в БД.');
        }
      } catch (storageError) {
        if (runId === runIdRef.current) {
          setStatus(`Готово, но БД не записалась: ${(storageError as Error).message || 'ошибка Supabase'}`);
        }
      }
      setProgress(100);
    } catch (rawError) {
      if (runId !== runIdRef.current) return;
      const err = rawError as Error;
      if (err?.name === 'AbortError' || String(err?.message || '').includes('aborted') || String(err).includes('AbortError')) {
        setStatus('Сбор остановлен.');
      } else {
        setError(err?.message || 'Не удалось собрать UwU отчёт.');
        setStatus('Ошибка расчёта.');
        setProgress(0);
      }
    } finally {
      if (runId === runIdRef.current) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  }, [
    applyReport,
    canRun,
    includeHighBlocker,
    includeSelective,
    normalizedRelease,
    running,
    settings.allureBase,
    settings.allureToken,
    settings.projectId,
    settings.proxyBase,
    settings.proxyMode,
    settings.useProxy,
  ]);

  const loadFromDb = useCallback(async (targetRelease = normalizedRelease) => {
    const cleanRelease = normalizeUwuReleaseVersion(targetRelease);
    if (!cleanRelease || running || dbBusy) return;
    setDbBusy(true);
    setError('');
    setProgress(0);
    setStatus('Читаю сохранённый uWu-срез из БД…');
    try {
      const cachedReport = await loadUwuReleaseReportFromSupabase(settings.projectId, cleanRelease);
      if (!cachedReport) {
        setStatus('В БД нет сохранённого uWu-среза для этого релиза.');
        return;
      }
      setReleaseVersion(cachedReport.releaseVersion);
      applyReport(cachedReport);
      setProgress(100);
      setStatus(`БД: uWu-срез ${cachedReport.releaseVersion} загружен.`);
    } catch (rawError) {
      const message = (rawError as Error).message || 'Не удалось загрузить uWu-срез из БД.';
      setError(message);
      setStatus('Ошибка чтения БД.');
      setProgress(0);
    } finally {
      setDbBusy(false);
    }
  }, [applyReport, dbBusy, normalizedRelease, running, settings.projectId]);

  useEffect(() => {
    const latestRelease = dbReleaseOptions[0];
    if (!latestRelease || running || dbBusy) return;

    const projectKey = String(settings.projectId || '').trim() || '7';
    if (defaultDbReleaseProjectRef.current === projectKey) return;
    defaultDbReleaseProjectRef.current = projectKey;

    setReleaseVersion(latestRelease);
    void loadFromDb(latestRelease);
  }, [dbBusy, dbReleaseOptions, loadFromDb, running, settings.projectId]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus('Сбор остановлен.');
  }, []);

  const resetCurrentFilter = useCallback(() => {
    if (activeTab === 'days') {
      setDaysSearch('');
      setSelectedDayLogins(dayUsers.map(user => user.login));
      return;
    }
    setFilters({
      people: { name: '', uwuMin: '', uwuMax: '' },
      streams: { name: '', uwuMin: '', uwuMax: '' },
      platform: null,
    });
  }, [activeTab, dayUsers]);

  const openFilterModal = useCallback(() => {
    if (activeTab !== 'days') {
      setFilterDraft({
        people: { ...filters.people },
        streams: { ...filters.streams },
        platform: filters.platform,
      });
    }
    setFilterModalOpen(true);
  }, [activeTab, filters]);

  const saveFilterModal = useCallback(() => {
    if (activeTab === 'days') {
      setFilterModalOpen(false);
      return;
    }
    setFilters({
      people: {
        name: filterDraft.people.name.trim(),
        uwuMin: filterDraft.people.uwuMin.trim(),
        uwuMax: filterDraft.people.uwuMax.trim(),
      },
      streams: {
        name: filterDraft.streams.name.trim(),
        uwuMin: filterDraft.streams.uwuMin.trim(),
        uwuMax: filterDraft.streams.uwuMax.trim(),
      },
      platform: filterDraft.platform,
    });
    setFilterModalOpen(false);
  }, [activeTab, filterDraft]);

  const resetFilterModal = useCallback(() => {
    resetCurrentFilter();
    setFilterDraft({
      people: { name: '', uwuMin: '', uwuMax: '' },
      streams: { name: '', uwuMin: '', uwuMax: '' },
      platform: null,
    });
    setFilterModalOpen(false);
  }, [resetCurrentFilter]);

  const exportWorkbook = useCallback(async (builder: (XLSX: NonNullable<typeof window.XLSX>) => void) => {
    const XLSX = await ensureXlsxLibrary();
    builder(XLSX);
  }, []);

  const exportGlobalExcel = useCallback(async () => {
    if (!report) return;
    await exportWorkbook(XLSX => {
      const workbook = XLSX.utils.book_new();

      const peopleRows: unknown[][] = [['SWAT логин', 'SWAT ФИО', 'Кейсов', 'UwU', '% с UwU', 'Дни']];
      filteredPeople.forEach(row => {
        peopleRows.push([
          row.source.login,
          row.name,
          row.totalCases,
          row.uwuSum,
          Number(row.percent.toFixed(2)),
          row.daysWorked,
        ]);
      });
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(peopleRows), 'По сотрудникам');

      const streamRows: unknown[][] = [['Стрим', 'Кейсов', 'UwU', '% с UwU', 'Ч/Ч']];
      filteredStreams.forEach(row => {
        streamRows.push([
          row.name,
          row.totalCases,
          row.uwuSum,
          Number(row.percent.toFixed(2)),
          formatHours(row.durMs),
        ]);
      });
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(streamRows), 'По стримам');

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SWAT_UwU_${normalizedRelease.replace(/[^\w.-]+/g, '_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }, [exportWorkbook, filteredPeople, filteredStreams, normalizedRelease, report]);

  const exportPersonExcel = useCallback(async (person: UwuPersonRow, tab: DetailTab) => {
    await exportWorkbook(XLSX => {
      const workbook = XLSX.utils.book_new();
      if (tab === 'streams') {
        const rows: unknown[][] = [['SWAT логин', 'SWAT ФИО', 'Стрим', 'Кейсов', 'UwU', '% с UwU', 'Ч/Ч']];
        detailPersonStreams.forEach(row => {
          rows.push([
            person.login,
            person.name,
            row.stream,
            row.totalCases,
            row.uwuSum,
            Number(row.percent.toFixed(2)),
            formatHours(row.durMs),
          ]);
        });
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Стримы SWAT');
      } else {
        const rows: unknown[][] = [['SWAT логин', 'SWAT ФИО', 'testCaseId', 'UwU']];
        person.caseDetails.forEach(detailRow => {
          rows.push([person.login, person.name, detailRow.testCaseId, detailRow.uwuNum]);
        });
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Кейсы SWAT');
      }

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SWAT_${person.login.replace(/[^\w.-]+/g, '_')}_${tab}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }, [detailPersonStreams, exportWorkbook]);

  const exportStreamExcel = useCallback(async (stream: UwuStreamRow) => {
    await exportWorkbook(XLSX => {
      const workbook = XLSX.utils.book_new();
      const rows: unknown[][] = [['Стрим', 'SWAT логин', 'SWAT ФИО', 'Кейсов', 'UwU', '% с UwU', 'Ч/Ч']];
      detailStreamMembers.forEach(row => {
        rows.push([
          stream.stream,
          row.login,
          row.name,
          row.totalCases,
          row.uwuSum,
          Number(row.percent.toFixed(2)),
          formatHours(row.durMs),
        ]);
      });
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SWAT по стриму');

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SWAT_stream_${stream.stream.replace(/[^\w.-]+/g, '_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }, [detailStreamMembers, exportWorkbook]);

  const exportDaysPdf = useCallback(async () => {
    const node = daysExportRef.current;
    if (!node) return;
    const { html2canvas, jsPDF } = await ensurePdfLibraries();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });

    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: 1.6,
      useCORS: true,
      windowWidth: Math.max(node.scrollWidth, node.clientWidth),
      windowHeight: Math.max(node.scrollHeight, node.clientHeight),
    });

    const image = canvas.toDataURL('image/png');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageHeight = (canvas.height * pageWidth) / canvas.width;

    let heightLeft = imageHeight;
    let position = 0;
    pdf.addImage(image, 'PNG', 0, position, pageWidth, imageHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imageHeight;
      pdf.addPage();
      pdf.addImage(image, 'PNG', 0, position, pageWidth, imageHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`SWAT_UwU_days_${normalizedRelease.replace(/[^\w.-]+/g, '_')}.pdf`);
  }, [normalizedRelease]);

  const handleExport = useCallback(async () => {
    if (!report) return;
    if (activeTab === 'days') {
      await exportDaysPdf();
      return;
    }
    await exportGlobalExcel();
  }, [activeTab, exportDaysPdf, exportGlobalExcel, report]);

  const hasSummaryFilter = Boolean(
    filters.people.name || filters.people.uwuMin || filters.people.uwuMax ||
    filters.streams.name || filters.streams.uwuMin || filters.streams.uwuMax ||
    filters.platform,
  );
  const hasDaysFilter = Boolean(daysSearch.trim()) || (dayUsers.length > 0 && selectedDayLogins.length !== dayUsers.length);
  const hasFilter = activeTab === 'days' ? hasDaysFilter : hasSummaryFilter;
  const dayFilterCaption = !dayUsers.length
    ? 'Нет сотрудников'
    : selectedDayLogins.length === 0
      ? 'Не выбрано'
      : selectedDayLogins.length === dayUsers.length
        ? 'Все сотрудники'
        : selectedDayLogins.length === 1
          ? (dayUsers.find(user => selectedDaySet.has(user.login))?.name || 'Выбрано: 1')
          : `Выбрано: ${selectedDayLogins.length}`;
  const peopleMaxUwu = useMemo(() => Math.max(0, ...filteredPeople.map(row => row.uwuSum)), [filteredPeople]);
  const streamMaxUwu = useMemo(() => Math.max(0, ...filteredStreams.map(row => row.uwuSum)), [filteredStreams]);
  const detailPersonStreamMaxUwu = useMemo(() => Math.max(0, ...detailPersonStreams.map(row => row.uwuSum)), [detailPersonStreams]);
  const detailStreamMemberMaxUwu = useMemo(() => Math.max(0, ...detailStreamMembers.map(row => row.uwuSum)), [detailStreamMembers]);
  const detailPersonCaseMaxUwu = useMemo(() => Math.max(0, ...(detailPerson?.caseDetails || []).map(row => row.uwuNum)), [detailPerson?.caseDetails]);

  const peopleColumns = useMemo<CanonicalTableColumn<PersonViewRow>[]>(() => [
    {
      id: 'name',
      title: <SortableColumnTitle label="SWAT (ФИО)" sortKey="name" scope="people" state={sortState} onToggle={toggleSort} />,
      width: '34%',
      sticky: 'left',
      render: row => <LinkCellButton onClick={() => openPersonDetail(row.source.login)}>{row.name}</LinkCellButton>,
      text: row => `${row.name} ${row.source.login}`,
      lineClamp: 2,
    },
    {
      id: 'cases',
      title: <SortableColumnTitle label="Кейсов" sortKey="cases" scope="people" state={sortState} onToggle={toggleSort} align="center" />,
      width: '16%',
      align: 'center',
      headerStyle: { textAlign: 'center' },
      render: row => formatNumber(row.totalCases),
      text: row => String(row.totalCases),
      cellStyle: numberCellStyle,
    },
    {
      id: 'uwu',
      title: <SortableColumnTitle label="UwU" sortKey="uwu" scope="people" state={sortState} onToggle={toggleSort} align="right" />,
      width: '18%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <UwuMeterCell value={row.uwuSum} max={peopleMaxUwu} />,
      text: row => String(row.uwuSum),
      cellStyle: numberCellStyle,
    },
    {
      id: 'percent',
      title: <SortableColumnTitle label="% с UwU" sortKey="percent" scope="people" state={sortState} onToggle={toggleSort} align="right" />,
      width: '20%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <PercentBadge totalCases={row.totalCases} uwuPresent={row.uwuPresent} />,
      text: row => formatPercent(row.totalCases, row.uwuPresent),
      cellStyle: numberCellStyle,
    },
    {
      id: 'days',
      title: <SortableColumnTitle label="Дни" sortKey="hours" scope="people" state={sortState} onToggle={toggleSort} align="right" />,
      width: '12%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => formatNumber(row.daysWorked),
      text: row => String(row.daysWorked),
      cellStyle: numberCellStyle,
    },
  ], [openPersonDetail, peopleMaxUwu, sortState, toggleSort]);

  const streamColumns = useMemo<CanonicalTableColumn<StreamViewRow>[]>(() => [
    {
      id: 'stream',
      title: <SortableColumnTitle label="Стрим" sortKey="name" scope="streams" state={sortState} onToggle={toggleSort} />,
      width: '34%',
      sticky: 'left',
      render: row => <LinkCellButton onClick={() => openStreamDetail(row.source.stream)}>{row.name}</LinkCellButton>,
      text: row => row.name,
      lineClamp: 2,
    },
    {
      id: 'cases',
      title: <SortableColumnTitle label="Кейсов" sortKey="cases" scope="streams" state={sortState} onToggle={toggleSort} align="center" />,
      width: '16%',
      align: 'center',
      headerStyle: { textAlign: 'center' },
      render: row => formatNumber(row.totalCases),
      text: row => String(row.totalCases),
      cellStyle: numberCellStyle,
    },
    {
      id: 'uwu',
      title: <SortableColumnTitle label="UwU" sortKey="uwu" scope="streams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '18%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <UwuMeterCell value={row.uwuSum} max={streamMaxUwu} />,
      text: row => String(row.uwuSum),
      cellStyle: numberCellStyle,
    },
    {
      id: 'percent',
      title: <SortableColumnTitle label="% с UwU" sortKey="percent" scope="streams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '20%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <PercentBadge totalCases={row.totalCases} uwuPresent={row.uwuPresent} />,
      text: row => formatPercent(row.totalCases, row.uwuPresent),
      cellStyle: numberCellStyle,
    },
    {
      id: 'hours',
      title: <SortableColumnTitle label="Ч/Ч" sortKey="hours" scope="streams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '12%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => formatHours(row.durMs),
      text: row => formatHours(row.durMs),
      cellStyle: numberCellStyle,
    },
  ], [openStreamDetail, sortState, streamMaxUwu, toggleSort]);

  const personStreamColumns = useMemo<CanonicalTableColumn<PersonStreamViewRow>[]>(() => [
    {
      id: 'stream',
      title: <SortableColumnTitle label="Стрим" sortKey="name" scope="personStreams" state={sortState} onToggle={toggleSort} />,
      width: '34%',
      sticky: 'left',
      render: row => <LinkCellButton onClick={() => openStreamDetail(row.stream)}>{row.stream}</LinkCellButton>,
      text: row => row.stream,
      lineClamp: 2,
    },
    {
      id: 'cases',
      title: <SortableColumnTitle label="Кейсов" sortKey="cases" scope="personStreams" state={sortState} onToggle={toggleSort} align="center" />,
      width: '16%',
      align: 'center',
      headerStyle: { textAlign: 'center' },
      render: row => formatNumber(row.totalCases),
      text: row => String(row.totalCases),
      cellStyle: numberCellStyle,
    },
    {
      id: 'uwu',
      title: <SortableColumnTitle label="UwU" sortKey="uwu" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '18%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <UwuMeterCell value={row.uwuSum} max={detailPersonStreamMaxUwu} />,
      text: row => String(row.uwuSum),
      cellStyle: numberCellStyle,
    },
    {
      id: 'percent',
      title: <SortableColumnTitle label="% с UwU" sortKey="percent" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '20%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <PercentBadge totalCases={row.totalCases} uwuPresent={row.uwuPresent} />,
      text: row => formatPercent(row.totalCases, row.uwuPresent),
      cellStyle: numberCellStyle,
    },
    {
      id: 'hours',
      title: <SortableColumnTitle label="Ч/Ч" sortKey="hours" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />,
      width: '14%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => formatHours(row.durMs),
      text: row => formatHours(row.durMs),
      cellStyle: numberCellStyle,
    },
  ], [detailPersonStreamMaxUwu, openStreamDetail, sortState, toggleSort]);

  const streamMemberColumns = useMemo<CanonicalTableColumn<StreamMemberViewRow>[]>(() => [
    {
      id: 'name',
      title: <SortableColumnTitle label="SWAT (ФИО)" sortKey="name" scope="streamMembers" state={sortState} onToggle={toggleSort} />,
      width: '34%',
      sticky: 'left',
      render: row => <LinkCellButton onClick={() => openPersonDetail(row.login)}>{row.name}</LinkCellButton>,
      text: row => `${row.name} ${row.login}`,
      lineClamp: 2,
    },
    {
      id: 'cases',
      title: <SortableColumnTitle label="Кейсов" sortKey="cases" scope="streamMembers" state={sortState} onToggle={toggleSort} align="center" />,
      width: '16%',
      align: 'center',
      headerStyle: { textAlign: 'center' },
      render: row => formatNumber(row.totalCases),
      text: row => String(row.totalCases),
      cellStyle: numberCellStyle,
    },
    {
      id: 'uwu',
      title: <SortableColumnTitle label="UwU" sortKey="uwu" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />,
      width: '18%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <UwuMeterCell value={row.uwuSum} max={detailStreamMemberMaxUwu} />,
      text: row => String(row.uwuSum),
      cellStyle: numberCellStyle,
    },
    {
      id: 'percent',
      title: <SortableColumnTitle label="% с UwU" sortKey="percent" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />,
      width: '20%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <PercentBadge totalCases={row.totalCases} uwuPresent={row.uwuPresent} />,
      text: row => formatPercent(row.totalCases, row.uwuPresent),
      cellStyle: numberCellStyle,
    },
    {
      id: 'hours',
      title: <SortableColumnTitle label="Ч/Ч" sortKey="hours" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />,
      width: '14%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => formatHours(row.durMs),
      text: row => formatHours(row.durMs),
      cellStyle: numberCellStyle,
    },
  ], [detailStreamMemberMaxUwu, openPersonDetail, sortState, toggleSort]);

  const personCaseColumns = useMemo<CanonicalTableColumn<UvuCaseViewRow>[]>(() => [
    {
      id: 'name',
      title: 'SWAT (ФИО)',
      width: '44%',
      sticky: 'left',
      render: () => <span style={{ color: '#8B5CF6', fontWeight: 700 }}>{detailPerson?.name || '—'}</span>,
      text: () => detailPerson?.name || '',
      lineClamp: 2,
    },
    {
      id: 'testCaseId',
      title: 'testCaseId',
      width: '36%',
      align: 'center',
      headerStyle: { textAlign: 'center' },
      render: row => (
        <a
          href={`${settings.allureBase.replace(/\/+$/, '')}/project/${settings.projectId}/test-cases/${row.testCaseId}?treeId=14`}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#8B5CF6', textDecoration: 'none', fontWeight: 700 }}
        >
          {row.testCaseId}
        </a>
      ),
      text: row => String(row.testCaseId),
    },
    {
      id: 'uwu',
      title: 'UwU',
      width: '20%',
      align: 'right',
      headerStyle: { textAlign: 'right' },
      render: row => <UwuMeterCell value={row.uwuNum} max={detailPersonCaseMaxUwu} />,
      text: row => String(row.uwuNum),
      cellStyle: numberCellStyle,
    },
  ], [detailPerson?.name, detailPersonCaseMaxUwu, settings.allureBase, settings.projectId]);

  const getDayColumns = useCallback((slot: UwuDaySlot): CanonicalTableColumn<UvuDayDisplayRow>[] => {
    const maxDayUwu = Math.max(slot.threshold, ...slot.rows.map(row => row.uwu));
    return [
      {
        id: 'name',
        title: 'SWAT (ФИО)',
        width: '50%',
        sticky: 'left',
        render: row => row.name,
        text: row => `${row.name} ${row.login}`,
        lineClamp: 2,
        cellStyle: row => row.thresholdCut ? { borderTop: '2px dashed #94A3B8' } : {},
      },
      {
        id: 'cases',
        title: 'Кейсы',
        width: '22%',
        align: 'center',
        headerStyle: { textAlign: 'center' },
        render: row => formatNumber(row.cases),
        text: row => String(row.cases),
        cellStyle: row => ({ ...numberCellStyle, ...(row.thresholdCut ? { borderTop: '2px dashed #94A3B8' } : {}) }),
      },
      {
        id: 'uwu',
        title: 'UwU',
        width: '28%',
        align: 'right',
        headerStyle: { textAlign: 'right' },
        render: row => <UwuMeterCell value={row.uwu} max={maxDayUwu} valueColor={row.uwu >= slot.threshold ? '#16A34A' : '#DC2626'} />,
        text: row => String(row.uwu),
        cellStyle: row => ({
          ...numberCellStyle,
          ...(row.thresholdCut ? { borderTop: '2px dashed #94A3B8' } : {}),
        }),
      },
    ];
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CanonicalRunLine
        controls={(
          <>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Релиз:</span>
            <Input
              value={releaseVersion}
              onChange={event => setReleaseVersion(event.target.value)}
              onBlur={() => setReleaseVersion(current => normalizeUwuReleaseVersion(current))}
              placeholder="7.5.0000"
              style={{ width: 118, height: 34, padding: '6px 10px', minWidth: 0 }}
            />
            {dbReleaseOptions.length > 0 && (
              <>
                <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Из БД:</span>
                <CanonicalValueSelect
                  value=""
                  options={dbReleaseOptions}
                  onChange={value => {
                    if (!value) return;
                    setReleaseVersion(value);
                    void loadFromDb(value);
                  }}
                  placeholder={dbBusy ? 'Загрузка...' : 'Выбрать релиз'}
                  searchPlaceholder="Поиск релиза"
                  emptyText="Релизы не найдены"
                  clearLabel="Не выбирать"
                  disabled={running || dbBusy}
                  style={{ width: 154, height: 34, padding: '6px 10px', minWidth: 0 }}
                />
              </>
            )}
            <label
              title="Собирать High/Blocker"
              style={{
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 9px',
                borderRadius: 8,
                border: `1.5px solid ${includeHighBlocker ? 'rgba(168,85,247,.46)' : 'var(--border-hi)'}`,
                background: 'var(--card)',
                color: includeHighBlocker ? 'var(--accent)' : 'var(--text-2)',
                fontSize: 11,
                fontWeight: 650,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={includeHighBlocker}
                onChange={event => setIncludeHighBlocker(event.target.checked)}
                style={{ margin: 0, accentColor: 'var(--accent)' }}
              />
              <span>High/Blocker</span>
            </label>
            <label
              title="Собирать Selective"
              style={{
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 9px',
                borderRadius: 8,
                border: `1.5px solid ${includeSelective ? 'rgba(168,85,247,.46)' : 'var(--border-hi)'}`,
                background: 'var(--card)',
                color: includeSelective ? 'var(--accent)' : 'var(--text-2)',
                fontSize: 11,
                fontWeight: 650,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={includeSelective}
                onChange={event => setIncludeSelective(event.target.checked)}
                style={{ margin: 0, accentColor: 'var(--accent)' }}
              />
              <span>Selective</span>
            </label>
          </>
        )}
        actions={running ? (
          <Button variant="danger" onClick={stop}>Остановить</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void loadFromDb()} disabled={!canLoadFromDb}>
              {dbBusy ? 'БД...' : 'БД загрузить'}
            </Button>
            <Button variant="primary" onClick={run} disabled={!canRun}>Собрать</Button>
          </>
        )}
        showStatus={showRunStatus}
        status={runStatusText}
        statusTone={error ? 'error' : !tokenReady ? 'warn' : progress >= 100 ? 'ok' : 'neutral'}
        progress={progress}
        progressColor={error ? 'red' : progress >= 100 ? 'green' : 'accent'}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Итоги</CardTitle>
            <CardHint>Клик по сотруднику или стриму открывает детализацию. По дням доступны накопительные графики UwU за пятницу–понедельник.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <SegmentControl
              items={[
                { label: 'Итоги', value: 'people' },
                { label: 'По дням', value: 'days' },
              ]}
              value={activeTab}
              onChange={value => {
                setFilterModalOpen(false);
                setActiveTab(value as ActiveTab);
              }}
              activeMode="underline"
              style={{ height: 32, background: 'transparent', borderColor: 'var(--border-hi)', flexShrink: 0 }}
              buttonStyle={{ height: 24, fontSize: 11, padding: '3px 10px' }}
            />
            <div style={{ width: 188, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, flexShrink: 0 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={openFilterModal}
              >
                Фильтр
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={resetCurrentFilter}
                disabled={!hasFilter}
                style={{ visibility: hasFilter ? 'visible' : 'hidden', pointerEvents: hasFilter ? undefined : 'none' }}
              >
                Сбросить
              </Button>
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  flexShrink: 0,
                  borderRadius: 999,
                  background: '#22C55E',
                  boxShadow: '0 0 0 3px rgba(34,197,94,.12)',
                  opacity: hasFilter ? 1 : 0,
                  transition: 'opacity .18s ease',
                }}
              />
            </div>
            <Button size="sm" variant="secondary" onClick={handleExport} disabled={!report} style={{ width: 112 }}>{exportLabel}</Button>
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activeTab !== 'days' ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr)',
                    gap: 14,
                    alignItems: 'stretch',
                  }}
                >
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>По сотрудникам</div>
                      <Badge color="gray">{filteredPeople.length}</Badge>
                    </div>
                    <CanonicalTable
                      rows={filteredPeople}
                      columns={peopleColumns}
                      getRowKey={row => row.source.login}
                      emptyText={report ? 'По выбранным фильтрам сотрудников не найдено.' : 'Пока нет данных. Запусти сбор UwU по нужному релизу.'}
                      rowHeight={52}
                      maxHeight="58vh"
                      minHeight="58vh"
                      minWidth="100%"
                      overscanRight={0}
                      hideHorizontalOverflow
                      variant="clean"
                      columnResizeStorageKey="swat_uwu_people_clean_table_widths"
                      loading={running && !report}
                      loadingText="Собираю данные uWu..."
                    />
                  </div>

                  <div aria-hidden="true" style={{ width: 1, minHeight: 420, background: 'var(--border-hi)' }} />

                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>По стримам</div>
                      <Badge color="gray">{filteredStreams.length}</Badge>
                    </div>
                    <CanonicalTable
                      rows={filteredStreams}
                      columns={streamColumns}
                      getRowKey={row => row.source.stream}
                      emptyText={report ? 'По выбранным фильтрам стримов не найдено.' : 'Пока нет данных. Запусти сбор UwU по нужному релизу.'}
                      rowHeight={52}
                      maxHeight="58vh"
                      minHeight="58vh"
                      minWidth="100%"
                      overscanRight={0}
                      hideHorizontalOverflow
                      variant="clean"
                      columnResizeStorageKey="swat_uwu_streams_clean_table_widths"
                      loading={running && !report}
                      loadingText="Собираю данные uWu..."
                    />
                  </div>
                </div>
              ) : null}

              {activeTab === 'days' ? (
                <div ref={daysExportRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Card style={{ background: 'var(--surface-soft)' }}>
                    <CardBody style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
                      {filteredDaySlots.map(slot => (
                        <div key={slot.key} style={{ padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{slot.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Порог {slot.threshold}</div>
                          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                            {formatUwU(slot.rows.reduce((sum, row) => sum + row.uwu, 0))}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                            Сотрудников: {slot.rows.length}
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {filteredDaySlots.map(slot => {
                    const splitIndex = slot.rows.findIndex(row => row.uwu < slot.threshold);
                    const dayRows = slot.rows.map((row, index) => ({
                      ...row,
                      thresholdCut: splitIndex >= 0 && index === splitIndex,
                    }));
                    return (
                      <Card key={slot.key}>
                        <CardHeader>
                          <div>
                            <CardTitle>{slot.label}</CardTitle>
                            <CardHint>{slot.dayKey ? `Порог ${slot.threshold} UwU` : 'За этот день данных нет'}</CardHint>
                          </div>
                        </CardHeader>
                        <CardBody style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 16 }}>
                          <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, minHeight: 280 }}>
                            <DayTimelineChart slot={slot} selectedLogins={selectedDaySet} themeKey={theme} />
                          </div>
                          <CanonicalTable
                            rows={dayRows}
                            columns={getDayColumns(slot)}
                            getRowKey={row => `${slot.key}-${row.login}`}
                            emptyText="Нет данных"
                            rowHeight={44}
                            maxHeight={280}
                            minHeight={280}
                            minWidth="100%"
                            overscanRight={0}
                            hideHorizontalOverflow
                            variant="clean"
                            columnResizeStorageKey={`swat_uwu_day_${slot.key}_clean_table_widths`}
                            loading={running && !report}
                            loadingText="Собираю данные uWu..."
                          />
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              ) : null}
        </CardBody>
      </Card>

      <Modal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        title={activeTab === 'days' ? 'Фильтр сотрудников' : 'Фильтр сводки'}
        width={activeTab === 'days' ? 520 : 760}
      >
        {activeTab === 'days' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Badge color="gray">{dayFilterCaption}</Badge>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDayLogins(dayUsers.map(user => user.login))}>Все</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDayLogins([])}>Очистить</Button>
              </div>
            </div>

            <div>
              <FieldLabel>Поиск</FieldLabel>
              <Input
                value={daysSearch}
                onChange={event => setDaysSearch(event.target.value)}
                placeholder="ФИО или login"
              />
            </div>

            <div
              style={{
                maxHeight: 320,
                minHeight: 320,
                overflowY: 'auto',
                border: '1px solid var(--border-hi)',
                borderRadius: 8,
                padding: 8,
                background: 'var(--surface-soft)',
              }}
            >
              {dayUsers.length ? (
                <>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--text)',
                    }}
                  >
                    <span>Все</span>
                    <input
                      type="checkbox"
                      checked={selectedDayLogins.length === dayUsers.length}
                      onChange={event => setSelectedDayLogins(event.target.checked ? dayUsers.map(user => user.login) : [])}
                    />
                  </label>
                  <div style={{ height: 1, background: 'var(--border)', margin: '2px 0 6px' }} />
                  {!visibleDayUsers.length ? (
                    <div style={{ padding: '18px 10px', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                      Совпадений нет
                    </div>
                  ) : (
                    visibleDayUsers.map(user => (
                      <label
                        key={user.login}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '7px 10px',
                          borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {user.name}
                        </span>
                        <input
                          type="checkbox"
                          checked={selectedDaySet.has(user.login)}
                          onChange={() => {
                            setSelectedDayLogins(prev => prev.includes(user.login)
                              ? prev.filter(item => item !== user.login)
                              : [...prev, user.login]);
                          }}
                        />
                      </label>
                    ))
                  )}
                </>
              ) : (
                <div style={{ padding: '18px 10px', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                  Нет сотрудников
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
              <Button type="button" size="sm" variant="ghost" onClick={resetFilterModal}>Сбросить</Button>
              <Button type="button" variant="primary" onClick={() => setFilterModalOpen(false)}>Закрыть</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>По сотрудникам</div>
                <div>
                  <FieldLabel>SWAT (ФИО)</FieldLabel>
                  <CanonicalValueSelect
                    value={filterDraft.people.name}
                    options={peopleFilterNameOptions}
                    onChange={value => setFilterDraft(prev => ({ ...prev, people: { ...prev.people, name: value } }))}
                    placeholder="Все сотрудники"
                    searchPlaceholder="Поиск сотрудника"
                    emptyText="Сотрудники не найдены"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                  <div>
                    <FieldLabel>UwU от</FieldLabel>
                    <Input
                      type="number"
                      step="1"
                      inputMode="numeric"
                      value={filterDraft.people.uwuMin}
                      onChange={event => setFilterDraft(prev => ({ ...prev, people: { ...prev.people, uwuMin: event.target.value } }))}
                      placeholder="мин."
                    />
                  </div>
                  <div>
                    <FieldLabel>UwU до</FieldLabel>
                    <Input
                      type="number"
                      step="1"
                      inputMode="numeric"
                      value={filterDraft.people.uwuMax}
                      onChange={event => setFilterDraft(prev => ({ ...prev, people: { ...prev.people, uwuMax: event.target.value } }))}
                      placeholder="макс."
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>По стримам</div>
                <div>
                  <FieldLabel>Стрим</FieldLabel>
                  <CanonicalValueSelect
                    value={filterDraft.streams.name}
                    options={streamFilterNameOptions}
                    onChange={value => setFilterDraft(prev => ({ ...prev, streams: { ...prev.streams, name: value } }))}
                    placeholder="Все стримы"
                    searchPlaceholder="Поиск стрима"
                    emptyText="Стримы не найдены"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                  <div>
                    <FieldLabel>UwU от</FieldLabel>
                    <Input
                      type="number"
                      step="1"
                      inputMode="numeric"
                      value={filterDraft.streams.uwuMin}
                      onChange={event => setFilterDraft(prev => ({ ...prev, streams: { ...prev.streams, uwuMin: event.target.value } }))}
                      placeholder="мин."
                    />
                  </div>
                  <div>
                    <FieldLabel>UwU до</FieldLabel>
                    <Input
                      type="number"
                      step="1"
                      inputMode="numeric"
                      value={filterDraft.streams.uwuMax}
                      onChange={event => setFilterDraft(prev => ({ ...prev, streams: { ...prev.streams, uwuMax: event.target.value } }))}
                      placeholder="макс."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>Платформа</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
                <Button
                  type="button"
                  variant={filterDraft.platform === 'Android' ? 'primary' : 'ghost'}
                  onClick={() => setFilterDraft(prev => ({ ...prev, platform: prev.platform === 'Android' ? null : 'Android' }))}
                >
                  Android
                </Button>
                <Button
                  type="button"
                  variant={filterDraft.platform === 'iOS' ? 'primary' : 'ghost'}
                  onClick={() => setFilterDraft(prev => ({ ...prev, platform: prev.platform === 'iOS' ? null : 'iOS' }))}
                >
                  iOS
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
              <Button type="button" size="sm" variant="ghost" onClick={resetFilterModal}>Сбросить</Button>
              <Button type="button" variant="primary" onClick={saveFilterModal}>Сохранить</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={
          detail?.type === 'person'
            ? `Детали по SWAT: ${detailPerson?.name || detail.login}`
            : `Детали по стриму: ${detail?.type === 'stream' ? detail.stream : ''}`
        }
        width={1040}
      >
        {detail?.type === 'person' && detailPerson ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge color="purple">{detailPerson.login}</Badge>
              <Badge color="gray">Целевой стрим: {detailPerson.targetStream || '—'}</Badge>
              <Badge color="gray">Дней: {detailPerson.daysWorked}</Badge>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <SegmentControl
                  items={[
                    { label: 'По стримам', value: 'streams' },
                    { label: 'По тест кейсам', value: 'cases' },
                  ]}
                  value={detailTab}
                  onChange={value => setDetailTab(value as DetailTab)}
                  activeMode="underline"
                  style={{ height: 32, background: 'transparent', borderColor: 'var(--border-hi)' }}
                  buttonStyle={{ height: 24, fontSize: 11, padding: '3px 10px' }}
                />
                <Button size="sm" variant="secondary" onClick={() => exportPersonExcel(detailPerson, detailTab)}>
                  Скачать Excel
                </Button>
              </div>
            </div>

            {detailTab === 'streams' ? (
              <CanonicalTable
                key={`person-streams-${detailPerson.login}`}
                rows={detailPersonStreams}
                columns={personStreamColumns}
                getRowKey={row => row.stream}
                emptyText="Данных нет"
                rowHeight={50}
                minHeight={380}
                maxHeight={380}
                minWidth="100%"
                overscanRight={0}
                hideHorizontalOverflow
                variant="clean"
                columnResizeStorageKey="swat_uwu_detail_person_streams_clean_table_widths"
              />
            ) : (
              <CanonicalTable
                key={`person-cases-${detailPerson.login}`}
                rows={detailPerson.caseDetails}
                columns={personCaseColumns}
                getRowKey={row => row.testCaseId}
                emptyText="Кейсов не найдено"
                rowHeight={50}
                minHeight={380}
                maxHeight={380}
                minWidth="100%"
                overscanRight={0}
                hideHorizontalOverflow
                variant="clean"
                columnResizeStorageKey="swat_uwu_detail_person_cases_clean_table_widths"
              />
            )}
          </div>
        ) : null}

        {detail?.type === 'stream' && detailStream ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge color="purple">{detailStream.stream}</Badge>
              <Badge color="gray">Ч/Ч: {formatHours(aggregateUwuStats(detailStream.stats, filters.platform).durTotalMs)}</Badge>
              <Button size="sm" variant="secondary" style={{ marginLeft: 'auto' }} onClick={() => exportStreamExcel(detailStream)}>
                Скачать Excel
              </Button>
            </div>

            <CanonicalTable
              key={`stream-members-${detailStream.stream}`}
              rows={detailStreamMembers}
              columns={streamMemberColumns}
              getRowKey={row => row.login}
              emptyText="Данных нет"
              rowHeight={50}
              minHeight={380}
              maxHeight={380}
              minWidth="100%"
              overscanRight={0}
              hideHorizontalOverflow
              variant="clean"
              columnResizeStorageKey="swat_uwu_detail_stream_members_clean_table_widths"
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
