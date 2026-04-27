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
  EmptyState,
  FieldLabel,
  Input,
  Modal,
  Progress,
  SegmentControl,
  StatusPill,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy } from '../../services/proxy';
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

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const RELEASE_KEY = 'swat_uwu_release';
const FILTER_KEY = 'swat_uwu_filters';

type ActiveTab = 'people' | 'streams' | 'days';
type DetailTab = 'streams' | 'cases';
type SortKey = 'name' | 'cases' | 'uwu' | 'percent' | 'hours';
type SortScope = 'people' | 'streams' | 'personStreams' | 'streamMembers';
type SortDir = 'asc' | 'desc' | null;

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

function formatUwUZero(value: number) {
  return formatNumber(Number(value || 0));
}

function formatPercent(totalCases: number, uwuPresent: number) {
  if (!totalCases) return '0.0%';
  return `${((uwuPresent / totalCases) * 100).toFixed(1)}%`;
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

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
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

function MetricTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'positive';
}) {
  const color = tone === 'accent'
    ? '#9B5CFF'
    : tone === 'positive'
      ? '#22C55E'
      : 'var(--text)';

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 16,
        border: '1px solid var(--border)',
        background: 'var(--card)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SortableHeader({
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
    <Th style={{ textAlign: align }}>
      <button
        onClick={() => onToggle(scope, sortKey)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          color: isActive ? 'var(--text)' : 'var(--text-3)',
          cursor: 'pointer',
          font: 'inherit',
          textTransform: 'inherit',
          letterSpacing: 'inherit',
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: isActive ? 1 : 0.45 }}>{arrow}</span>
      </button>
    </Th>
  );
}

function DaysFilterCard({
  users,
  selectedLogins,
  search,
  onSearchChange,
  onToggleLogin,
  onSelectAll,
  onClear,
}: {
  users: Array<{ login: string; name: string }>;
  selectedLogins: Set<string>;
  search: string;
  onSearchChange: (value: string) => void;
  onToggleLogin: (login: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const visibleUsers = users.filter(user => !normalizedSearch || user.name.toLowerCase().includes(normalizedSearch) || user.login.includes(normalizedSearch));
  const caption = !users.length
    ? 'Нет сотрудников'
    : selectedLogins.size === 0
      ? 'Не выбрано'
      : selectedLogins.size === users.length
        ? 'Все сотрудники'
        : selectedLogins.size === 1
          ? (users.find(user => selectedLogins.has(user.login))?.name || 'Выбрано: 1')
          : `Выбрано: ${selectedLogins.size}`;

  return (
    <Card style={{ minWidth: 280 }}>
      <CardHeader>
        <div>
          <CardTitle>Фильтр сотрудников</CardTitle>
          <CardHint>{caption}</CardHint>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onSelectAll}>Все</Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Очистить</Button>
        </div>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <FieldLabel>Поиск</FieldLabel>
          <Input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="ФИО или login" />
        </div>
        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 8,
            background: 'var(--surface-soft)',
          }}
        >
          {!visibleUsers.length ? (
            <div style={{ padding: '18px 10px', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
              Совпадений нет
            </div>
          ) : (
            visibleUsers.map(user => (
              <label
                key={user.login}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 8px',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedLogins.has(user.login)}
                  onChange={() => onToggleLogin(user.login)}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.name}
                </span>
              </label>
            ))
          )}
        </div>
      </CardBody>
    </Card>
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
  const { theme, setSettingsOpen } = useApp();

  const [releaseVersion, setReleaseVersion] = useState(() => normalizeUwuReleaseVersion(readText(RELEASE_KEY, '7.5.0000')));
  const [includeHighBlocker, setIncludeHighBlocker] = useState(true);
  const [includeSelective, setIncludeSelective] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('people');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('—');
  const [error, setError] = useState('');
  const [proxyOnline, setProxyOnline] = useState<boolean | null>(null);
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

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const daysExportRef = useRef<HTMLDivElement | null>(null);

  const normalizedRelease = normalizeUwuReleaseVersion(releaseVersion);
  const tokenReady = Boolean(String(settings.allureToken || '').trim());
  const canRun = tokenReady && Boolean(normalizedRelease) && (includeHighBlocker || includeSelective);
  const exportLabel = activeTab === 'days' ? 'Выгрузить PDF' : 'Выгрузить Excel';

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
    if (!settings.useProxy || !String(settings.proxyBase || '').trim()) {
      setProxyOnline(null);
      return;
    }
    checkProxy(settings.proxyBase).then(value => {
      if (!cancelled) setProxyOnline(value);
    }).catch(() => {
      if (!cancelled) setProxyOnline(false);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.proxyBase, settings.useProxy]);

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
        if (query && !row.name.toLowerCase().includes(query) && !row.source.login.includes(query)) return false;
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
        if (query && !row.name.toLowerCase().includes(query)) return false;
        if (min != null && row.uwuSum < min) return false;
        if (max != null && row.uwuSum > max) return false;
        return true;
      });

    return sortItems(rows, sortState.streams);
  }, [filters, report, sortState.streams]);

  const totals = useMemo(() => {
    const source = activeTab === 'people' ? filteredPeople : filteredStreams;
    return source.reduce((acc, row) => {
      acc.totalCases += row.totalCases;
      acc.uwuSum += row.uwuSum;
      acc.uwuPresent += row.uwuPresent;
      acc.durMs += row.durMs;
      return acc;
    }, { totalCases: 0, uwuSum: 0, uwuPresent: 0, durMs: 0 });
  }, [activeTab, filteredPeople, filteredStreams]);

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
    if (!report) return [] as UwuDaySlot[];
    const query = daysSearch.trim().toLowerCase();
    return report.daySlots.map(slot => ({
      ...slot,
      rows: slot.rows.filter(row => selectedDaySet.has(row.login) && (!query || row.name.toLowerCase().includes(query) || row.login.includes(query))),
      events: slot.events.filter(event => selectedDaySet.has(event.login) && (!query || event.name.toLowerCase().includes(query) || event.login.includes(query))),
    }));
  }, [daysSearch, report, selectedDaySet]);

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
      setReport(nextReport);
      setSelectedDayLogins(nextReport.swatMembers.map(member => member.login));
      setDaysSearch('');
      setStatus('Готово. Можно смотреть отчёт и выгружать результат.');
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

  const stop = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus('Сбор остановлен.');
  }, []);

  const resetCurrentFilter = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      [activeTab]: { name: '', uwuMin: '', uwuMax: '' },
      platform: null,
    }));
  }, [activeTab]);

  const updateTabFilter = useCallback((field: 'name' | 'uwuMin' | 'uwuMax', value: string) => {
    if (activeTab === 'days') return;
    setFilters(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        [field]: value,
      },
    }));
  }, [activeTab]);

  const exportWorkbook = useCallback(async (builder: (XLSX: NonNullable<typeof window.XLSX>) => void) => {
    const XLSX = await ensureXlsxLibrary();
    builder(XLSX);
  }, []);

  const exportGlobalExcel = useCallback(async () => {
    if (!report) return;
    await exportWorkbook(XLSX => {
      const workbook = XLSX.utils.book_new();

      const peopleRows: unknown[][] = [['SWAT логин', 'SWAT ФИО', 'Пройдено кейсов', 'Сумма UwU', '% кейсов с UwU', 'Дни']];
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

      const streamRows: unknown[][] = [['Стрим', 'Пройдено кейсов', 'Сумма UwU', '% кейсов с UwU', 'Ч/Ч']];
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
        const rows: unknown[][] = [['SWAT логин', 'SWAT ФИО', 'Стрим', 'Пройдено кейсов', 'Сумма UwU', '% кейсов с UwU', 'Ч/Ч']];
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
      const rows: unknown[][] = [['Стрим', 'SWAT логин', 'SWAT ФИО', 'Пройдено кейсов', 'Сумма UwU', '% кейсов с UwU', 'Ч/Ч']];
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

  const activeFilter = activeTab === 'people' ? filters.people : filters.streams;
  const hasFilter = activeTab !== 'days' && Boolean(activeFilter.name || activeFilter.uwuMin || activeFilter.uwuMax || filters.platform);
  const selectedLaunches = report?.launches || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</div>
        Расчёт uWu
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12 }}>
        <MetricTile label="SWAT сотрудников" value={report ? report.swatMembers.length : '—'} hint="По данным SWAT Google Script" />
        <MetricTile label="Лаунчей" value={report ? report.totals.launchCount : '—'} hint="Smoke / High-Blocker / Selective" />
        <MetricTile label="SWAT кейсов" value={report ? formatNumber(report.totals.swatCaseCount) : '—'} hint="После фильтра по testedBy" tone="accent" />
        <MetricTile label="Стримов" value={report ? report.totals.streamCount : '—'} hint="С ненулевым вкладом SWAT" />
        <MetricTile label="Последний расчёт" value={report ? formatDateTime(report.generatedAt) : '—'} hint={report ? report.releaseVersion : 'Нет актуального отчёта'} tone="positive" />
      </div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 180 }}>
              <FieldLabel>Версия релиза</FieldLabel>
              <Input
                value={releaseVersion}
                onChange={event => setReleaseVersion(event.target.value)}
                onBlur={() => setReleaseVersion(current => normalizeUwuReleaseVersion(current))}
                placeholder="например 7.5.0000"
              />
            </div>
            <div>
              <FieldLabel>Сценарий сбора</FieldLabel>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={includeHighBlocker} onChange={event => setIncludeHighBlocker(event.target.checked)} />
                  <span>High/Blocker</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={includeSelective} onChange={event => setIncludeSelective(event.target.checked)} />
                  <span>Selective</span>
                </label>
              </div>
            </div>
            {running ? (
              <Button variant="danger" onClick={stop}>Остановить сбор</Button>
            ) : (
              <Button variant="primary" onClick={run} disabled={!canRun}>Запустить сбор UwU</Button>
            )}
            <Button variant="secondary" onClick={handleExport} disabled={!report}>{exportLabel}</Button>
            {!tokenReady ? (
              <Button variant="ghost" onClick={() => setSettingsOpen(true)}>Настроить Allure</Button>
            ) : null}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatusPill status={tokenReady ? 'live' : 'warn'}>{tokenReady ? 'Allure token ready' : 'Allure token missing'}</StatusPill>
              <StatusPill status={settings.useProxy ? (proxyOnline ? 'live' : proxyOnline === false ? 'warn' : 'neutral') : 'neutral'}>
                {!settings.useProxy ? 'proxy disabled' : proxyOnline ? 'proxy online' : proxyOnline === false ? 'proxy offline' : 'proxy unknown'}
              </StatusPill>
            </div>
          </div>

          <div>
            <Progress value={progress} max={100} color={error ? 'red' : progress >= 100 ? 'green' : 'accent'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: error ? '#F87171' : 'var(--text-2)' }}>{error || status}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(progress)}%</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Отчёт UwU</CardTitle>
            <CardHint>Клик по сотруднику или стриму открывает детализацию. По дням доступны накопительные графики UwU за пятницу–понедельник.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['people', 'streams', 'days'] as const).map(tab => (
              <Button
                key={tab}
                size="sm"
                variant={activeTab === tab ? 'primary' : 'ghost'}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'people' ? 'По сотрудникам' : tab === 'streams' ? 'По стримам' : 'По дням'}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!report ? (
            <EmptyState icon="∑" text="Пока нет данных. Запусти сбор UwU по нужному релизу." />
          ) : (
            <>
              {activeTab !== 'days' ? (
                <Card style={{ background: 'var(--surface-soft)', borderRadius: 14 }}>
                  <CardBody style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, alignItems: 'end' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <FieldLabel>{activeTab === 'people' ? 'SWAT (ФИО) / login' : 'Стрим'}</FieldLabel>
                      <Input
                        value={activeFilter.name}
                        onChange={event => updateTabFilter('name', event.target.value)}
                        placeholder={activeTab === 'people' ? 'ФИО или login' : 'Название стрима'}
                      />
                    </div>
                    <div>
                      <FieldLabel>UwU от</FieldLabel>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={activeFilter.uwuMin}
                        onChange={event => updateTabFilter('uwuMin', event.target.value)}
                        placeholder="мин."
                      />
                    </div>
                    <div>
                      <FieldLabel>UwU до</FieldLabel>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={activeFilter.uwuMax}
                        onChange={event => updateTabFilter('uwuMax', event.target.value)}
                        placeholder="макс."
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <div>
                        <FieldLabel>Платформа</FieldLabel>
                        <SegmentControl
                          items={[
                            { label: 'Все', value: 'all' },
                            { label: 'Android', value: 'Android' },
                            { label: 'iOS', value: 'iOS' },
                          ]}
                          value={filters.platform || 'all'}
                          onChange={value => setFilters(prev => ({ ...prev, platform: value === 'all' ? null : value as UwuPlatformFilter }))}
                        />
                      </div>
                      {hasFilter ? (
                        <Button size="sm" variant="ghost" onClick={resetCurrentFilter}>Сбросить</Button>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              ) : null}

              {activeTab === 'people' ? (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Badge color="purple">Строк: {filteredPeople.length}</Badge>
                    <Badge color="gray">Кейсов: {formatNumber(totals.totalCases)}</Badge>
                    <Badge color="green">UwU: {formatUwU(totals.uwuSum)}</Badge>
                    <Badge color="gray">% с UwU: {formatPercent(totals.totalCases, totals.uwuPresent)}</Badge>
                  </div>
                  {!filteredPeople.length ? (
                    <EmptyState text="По выбранным фильтрам сотрудников не найдено." />
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <SortableHeader label="SWAT (ФИО)" sortKey="name" scope="people" state={sortState} onToggle={toggleSort} />
                          <SortableHeader label="Пройдено кейсов" sortKey="cases" scope="people" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="Сумма UwU" sortKey="uwu" scope="people" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="% кейсов с UwU" sortKey="percent" scope="people" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="Дни" sortKey="hours" scope="people" state={sortState} onToggle={toggleSort} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPeople.map(row => (
                          <tr key={row.source.login}>
                            <Td mono bold>
                              <button
                                onClick={() => openPersonDetail(row.source.login)}
                                style={{ color: '#8B5CF6', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                              >
                                {row.name}
                              </button>
                            </Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.totalCases)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwU(row.uwuSum)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(row.totalCases, row.uwuPresent)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.daysWorked)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </>
              ) : null}

              {activeTab === 'streams' ? (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Badge color="purple">Строк: {filteredStreams.length}</Badge>
                    <Badge color="gray">Кейсов: {formatNumber(totals.totalCases)}</Badge>
                    <Badge color="green">UwU: {formatUwU(totals.uwuSum)}</Badge>
                    <Badge color="gray">Ч/Ч: {formatHours(totals.durMs)}</Badge>
                  </div>
                  {!filteredStreams.length ? (
                    <EmptyState text="По выбранным фильтрам стримов не найдено." />
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <SortableHeader label="Стрим" sortKey="name" scope="streams" state={sortState} onToggle={toggleSort} />
                          <SortableHeader label="Пройдено кейсов" sortKey="cases" scope="streams" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="Сумма UwU" sortKey="uwu" scope="streams" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="% кейсов с UwU" sortKey="percent" scope="streams" state={sortState} onToggle={toggleSort} align="right" />
                          <SortableHeader label="Ч/Ч" sortKey="hours" scope="streams" state={sortState} onToggle={toggleSort} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStreams.map(row => (
                          <tr key={row.source.stream}>
                            <Td bold>
                              <button
                                onClick={() => openStreamDetail(row.source.stream)}
                                style={{ color: '#8B5CF6', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                              >
                                {row.name}
                              </button>
                            </Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.totalCases)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwU(row.uwuSum)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(row.totalCases, row.uwuPresent)}</Td>
                            <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatHours(row.durMs)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </>
              ) : null}

              {activeTab === 'days' ? (
                <div ref={daysExportRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
                    <DaysFilterCard
                      users={dayUsers}
                      selectedLogins={selectedDaySet}
                      search={daysSearch}
                      onSearchChange={setDaysSearch}
                      onToggleLogin={login => {
                        setSelectedDayLogins(prev => prev.includes(login) ? prev.filter(item => item !== login) : [...prev, login]);
                      }}
                      onSelectAll={() => setSelectedDayLogins(dayUsers.map(user => user.login))}
                      onClear={() => setSelectedDayLogins([])}
                    />
                    <Card style={{ background: 'var(--surface-soft)' }}>
                      <CardBody style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
                        {filteredDaySlots.map(slot => (
                          <div key={slot.key} style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)' }}>
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
                  </div>

                  {filteredDaySlots.map(slot => {
                    const splitIndex = slot.rows.findIndex(row => row.uwu < slot.threshold);
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
                          <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                            <Table>
                              <thead>
                                <tr>
                                  <Th>SWAT (ФИО)</Th>
                                  <Th style={{ textAlign: 'right' }}>Кейсы</Th>
                                  <Th style={{ textAlign: 'right' }}>UwU</Th>
                                  <Th style={{ textAlign: 'right' }}>Часы</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {!slot.rows.length ? (
                                  <tr>
                                    <td colSpan={4} style={{ padding: '14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Нет данных</td>
                                  </tr>
                                ) : slot.rows.map((row, index) => (
                                  <tr key={`${slot.key}-${row.login}`} style={splitIndex >= 0 && index === splitIndex ? { borderTop: '2px dashed #94A3B8' } : undefined}>
                                    <Td mono>{row.name}</Td>
                                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.cases)}</Td>
                                    <Td style={{ textAlign: 'right', color: row.uwu >= slot.threshold ? '#22C55E' : '#EF4444', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                      {formatUwU(row.uwu)}
                                    </Td>
                                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatWorkedHours(row.hours)}</Td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Лаунчи расчёта</CardTitle>
            <CardHint>По ним собирались leaf-результаты и memberstats.</CardHint>
          </div>
          <Badge color="gray">{selectedLaunches.length} launch</Badge>
        </CardHeader>
        {!selectedLaunches.length ? (
          <CardBody>
            <EmptyState icon="□" text="Список лаунчей появится после первого расчёта." />
          </CardBody>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Лаунч</Th>
                  <Th>Стрим</Th>
                  <Th>Платформа</Th>
                  <Th style={{ textAlign: 'right' }}>SWAT кейсы</Th>
                  <Th style={{ textAlign: 'right' }}>UwU</Th>
                  <Th style={{ textAlign: 'right' }}>Allure</Th>
                </tr>
              </thead>
              <tbody>
                {selectedLaunches.map(launch => (
                  <tr key={launch.id}>
                    <Td bold>{launch.name}</Td>
                    <Td>{launch.stream}</Td>
                    <Td>
                      {launch.platform ? (
                        <Badge color={launch.platform === 'Android' ? 'green' : 'blue'}>{launch.platform}</Badge>
                      ) : (
                        <Badge color="gray">—</Badge>
                      )}
                    </Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(launch.swatCaseCount)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwUZero(launch.uwuSum)}</Td>
                    <Td style={{ textAlign: 'right' }}>
                      <a
                        href={`${settings.allureBase.replace(/\/+$/, '')}/launch/${launch.id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#8B5CF6', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                      >
                        Открыть
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

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
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Button size="sm" variant={detailTab === 'streams' ? 'primary' : 'ghost'} onClick={() => setDetailTab('streams')}>По стримам</Button>
                <Button size="sm" variant={detailTab === 'cases' ? 'primary' : 'ghost'} onClick={() => setDetailTab('cases')}>По тест кейсам</Button>
                <Button size="sm" variant="secondary" onClick={() => exportPersonExcel(detailPerson, detailTab)}>
                  Скачать Excel
                </Button>
              </div>
            </div>

            {detailTab === 'streams' ? (
              <Table>
                <thead>
                  <tr>
                    <SortableHeader label="Стрим" sortKey="name" scope="personStreams" state={sortState} onToggle={toggleSort} />
                    <SortableHeader label="Пройдено кейсов" sortKey="cases" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />
                    <SortableHeader label="Сумма UwU" sortKey="uwu" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />
                    <SortableHeader label="% кейсов с UwU" sortKey="percent" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />
                    <SortableHeader label="Ч/Ч" sortKey="hours" scope="personStreams" state={sortState} onToggle={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {!detailPersonStreams.length ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Данных нет</td>
                    </tr>
                  ) : detailPersonStreams.map(row => (
                    <tr key={row.stream}>
                      <Td>{row.stream}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.totalCases)}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwU(row.uwuSum)}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(row.totalCases, row.uwuPresent)}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatHours(row.durMs)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>SWAT (ФИО)</Th>
                    <Th>testCaseId</Th>
                    <Th style={{ textAlign: 'right' }}>UwU</Th>
                  </tr>
                </thead>
                <tbody>
                  {!detailPerson.caseDetails.length ? (
                    <tr>
                      <td colSpan={3} style={{ padding: '14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Кейсов не найдено</td>
                    </tr>
                  ) : detailPerson.caseDetails.map(caseItem => (
                    <tr key={caseItem.testCaseId}>
                      <Td mono>{detailPerson.name}</Td>
                      <Td>
                        <a
                          href={`${settings.allureBase.replace(/\/+$/, '')}/project/${settings.projectId}/test-cases/${caseItem.testCaseId}?treeId=14`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#8B5CF6', textDecoration: 'none' }}
                        >
                          {caseItem.testCaseId}
                        </a>
                      </Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwU(caseItem.uwuNum)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
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

            <Table>
              <thead>
                <tr>
                  <SortableHeader label="SWAT (ФИО)" sortKey="name" scope="streamMembers" state={sortState} onToggle={toggleSort} />
                  <SortableHeader label="Пройдено кейсов" sortKey="cases" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />
                  <SortableHeader label="Сумма UwU" sortKey="uwu" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />
                  <SortableHeader label="% кейсов с UwU" sortKey="percent" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />
                  <SortableHeader label="Ч/Ч" sortKey="hours" scope="streamMembers" state={sortState} onToggle={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {!detailStreamMembers.length ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Данных нет</td>
                  </tr>
                ) : detailStreamMembers.map(row => (
                  <tr key={row.login}>
                    <Td mono>{row.name}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.totalCases)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatUwU(row.uwuSum)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(row.totalCases, row.uwuPresent)}</Td>
                    <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatHours(row.durMs)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
