import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  CategoryScale,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
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
  LogView,
  Modal,
  Progress,
  SegmentControl,
  StatusPill,
  Td,
  Th,
} from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy } from '../../services/proxy';
import {
  buildSwatReleaseReport,
  ddmm,
  formatUwU,
  ruDowShort,
  type SwatChartRow,
  type SwatChartStreamRow,
  type SwatEmployeeRow,
  type SwatPlatformModel,
  type SwatReleaseReport,
} from '../../services/swat';

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const RELEASE_KEY = 'swat_release_react_v2';
const TAB_KEY = 'swat_release_tab_v2';

type TabValue = 'emp' | 'plat' | 'cases' | 'streams';
type ProxyState = 'unknown' | 'ok' | 'error';
type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';
type LogLevel = 'info' | 'ok' | 'warn' | 'error';
type SortDirection = 1 | -1;
type EmployeeSortKey = 'name' | 'target' | 'uwu' | 'uwuph' | 'iosh' | 'andh' | 'iosc' | 'andc' | 'avg';

interface ChartThemeColors {
  text: string;
  text2: string;
  text3: string;
  grid: string;
  border: string;
}

interface PathModalState {
  title: string;
  subtitle: string;
  body: string;
}

interface LineSeries {
  label: string;
  data: number[];
}

declare global {
  interface Window {
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

function readStoredText(key: string, fallback = '') {
  try {
    return String(localStorage.getItem(key) || fallback);
  } catch {
    return fallback;
  }
}

function readStoredTab(): TabValue {
  try {
    const raw = String(localStorage.getItem(TAB_KEY) || 'emp');
    return raw === 'plat' || raw === 'cases' || raw === 'streams' ? raw : 'emp';
  } catch {
    return 'emp';
  }
}

function formatTimeStamp() {
  return new Date().toLocaleTimeString('ru-RU');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getChartThemeColors(): ChartThemeColors {
  return {
    text: readCssVar('--text', '#EEEAF8'),
    text2: readCssVar('--text-2', '#9D96B4'),
    text3: readCssVar('--text-3', '#5F5878'),
    grid: readCssVar('--chart-grid', 'rgba(255,255,255,.05)'),
    border: readCssVar('--border', 'rgba(255,255,255,.08)'),
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

async function ensureXlsxLibrary() {
  if (!window.XLSX) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }
  if (!window.XLSX) {
    throw new Error('XLSX библиотека не загрузилась.');
  }
  return window.XLSX;
}

function colorForIndex(index: number) {
  const hue = (index * 47) % 360;
  return `hsl(${hue} 64% 50%)`;
}

function cellDivider(strength: 'soft' | 'group' = 'soft'): React.CSSProperties {
  return {
    borderRight: strength === 'group'
      ? '1px solid rgba(139,92,246,.16)'
      : '1px solid var(--border-subtle)',
  };
}

function headerDivider(strength: 'soft' | 'group' = 'soft'): React.CSSProperties {
  return {
    borderRight: strength === 'group'
      ? '1px solid rgba(139,92,246,.18)'
      : '1px solid var(--border)',
  };
}

function employeePlatformBadgeColor(platform: SwatEmployeeRow['platform']) {
  if (platform === 'android') return 'green';
  if (platform === 'ios') return 'blue';
  if (platform === 'both') return 'purple';
  return 'gray';
}

function employeePlatformLabel(platform: SwatEmployeeRow['platform']) {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  if (platform === 'both') return 'Android + iOS';
  return '—';
}

function progressColor(tone: StatusTone) {
  if (tone === 'ok') return 'green' as const;
  if (tone === 'warn') return 'yellow' as const;
  if (tone === 'error') return 'red' as const;
  return 'accent' as const;
}

function sortIndicator(active: boolean, dir: SortDirection) {
  if (!active) return '↕';
  return dir === 1 ? '▲' : '▼';
}

function sortEmployees(rows: SwatEmployeeRow[], key: EmployeeSortKey, dir: SortDirection) {
  const sign = dir;
  return [...rows].sort((left, right) => {
    let a: number | string | null = null;
    let b: number | string | null = null;

    if (key === 'name') {
      a = String(left.fullName || left.login || '').toLowerCase();
      b = String(right.fullName || right.login || '').toLowerCase();
    } else if (key === 'target') {
      a = String(left.targetStream || '').toLowerCase();
      b = String(right.targetStream || '').toLowerCase();
    } else if (key === 'uwu') {
      a = Number(left.uwuSum || 0);
      b = Number(right.uwuSum || 0);
    } else if (key === 'uwuph') {
      a = left.uwuPerHour == null ? null : Number(left.uwuPerHour);
      b = right.uwuPerHour == null ? null : Number(right.uwuPerHour);
    } else if (key === 'iosh') {
      a = Number(left.iosMinutes || 0);
      b = Number(right.iosMinutes || 0);
    } else if (key === 'andh') {
      a = Number(left.androidMinutes || 0);
      b = Number(right.androidMinutes || 0);
    } else if (key === 'iosc') {
      a = Number(left.iosCases || 0);
      b = Number(right.iosCases || 0);
    } else if (key === 'andc') {
      a = Number(left.androidCases || 0);
      b = Number(right.androidCases || 0);
    } else if (key === 'avg') {
      a = Number(left.avgMsPerCase || 0);
      b = Number(right.avgMsPerCase || 0);
    }

    if ((typeof a === 'number' || a == null) && (typeof b === 'number' || b == null)) {
      const aMissing = !(typeof a === 'number' && Number.isFinite(a));
      const bMissing = !(typeof b === 'number' && Number.isFinite(b));
      if (aMissing && bMissing) {
        return String(left.fullName || left.login).localeCompare(String(right.fullName || right.login), 'ru');
      }
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (a === b) {
        return String(left.fullName || left.login).localeCompare(String(right.fullName || right.login), 'ru');
      }
      const aValue = Number(a);
      const bValue = Number(b);
      return (aValue < bValue ? -1 : 1) * sign;
    }

    const cmp = String(a || '').localeCompare(String(b || ''), 'ru');
    if (cmp !== 0) return cmp * sign;
    return String(left.fullName || left.login).localeCompare(String(right.fullName || right.login), 'ru');
  });
}

function FilterCard({
  users,
  search,
  selectedLogins,
  onSearchChange,
  onToggle,
  onSelectAll,
  onClear,
}: {
  users: SwatReleaseReport['users'];
  search: string;
  selectedLogins: Set<string>;
  onSearchChange: (value: string) => void;
  onToggle: (login: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const query = search.trim().toLowerCase();
  const visibleUsers = users.filter(user => !query || user.fullName.toLowerCase().includes(query) || user.login.includes(query));
  const caption = !users.length
    ? 'Нет сотрудников'
    : selectedLogins.size === 0
      ? 'Не выбрано'
      : selectedLogins.size === users.length
        ? 'Все сотрудники'
        : selectedLogins.size === 1
          ? (users.find(user => selectedLogins.has(user.login))?.fullName || 'Выбрано: 1')
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
            maxHeight: 260,
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
          ) : visibleUsers.map(user => {
            const checked = selectedLogins.has(user.login);
            return (
              <label
                key={user.login}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: checked ? 'var(--card)' : 'transparent',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.fullName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                    {user.login}
                  </div>
                </div>
                <input type="checkbox" checked={checked} onChange={() => onToggle(user.login)} />
              </label>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onToggle,
  align = 'left',
  style,
}: {
  label: string;
  sortKey: EmployeeSortKey;
  activeKey: EmployeeSortKey;
  direction: SortDirection;
  onToggle: (key: EmployeeSortKey) => void;
  align?: React.CSSProperties['textAlign'];
  style?: React.CSSProperties;
}) {
  const active = activeKey === sortKey;
  return (
    <Th style={{ textAlign: align, ...style }}>
      <button
        onClick={() => onToggle(sortKey)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          color: active ? 'var(--text)' : 'var(--text-3)',
          cursor: 'pointer',
          font: 'inherit',
          textTransform: 'inherit',
          letterSpacing: 'inherit',
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: active ? 1 : 0.45 }}>{sortIndicator(active, direction)}</span>
      </button>
    </Th>
  );
}

function MetricCard({
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

function CasesLineChart({
  title,
  subtitle,
  days,
  series,
  colors,
  showLegend = false,
  legendAlign = 'start',
  height = 320,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  days: string[];
  series: LineSeries[];
  colors: ChartThemeColors;
  showLegend?: boolean;
  legendAlign?: 'start' | 'center' | 'end';
  height?: number;
  emptyText: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<'line'> | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !days.length || !series.length) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: days.map(day => `${ruDowShort(day)} ${ddmm(day)}`),
        datasets: series.map((item, index) => {
          const color = colorForIndex(index);
          return {
            label: item.label,
            data: item.data,
            borderColor: color,
            backgroundColor: color,
            pointBackgroundColor: color,
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 1,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            fill: false,
            tension: 0.25,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: showLegend,
            position: 'top',
            align: legendAlign,
            labels: {
              color: colors.text2,
              boxWidth: 14,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: 'line',
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            itemSort: (left, right) => Number(right.parsed?.y || 0) - Number(left.parsed?.y || 0),
            callbacks: {
              title(items) {
                const index = items?.[0]?.dataIndex ?? 0;
                return `${ruDowShort(days[index] || '')} ${ddmm(days[index] || '')}`;
              },
              footer(items) {
                const total = (items || []).reduce((sum, item) => sum + Number(item.parsed?.y || 0), 0);
                return `Итого за день: ${formatNumber(total)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: colors.text2,
              maxRotation: 0,
              autoSkip: true,
            },
            grid: { color: colors.grid },
            border: { color: colors.border },
          },
          y: {
            beginAtZero: true,
            grace: '12%',
            ticks: {
              color: colors.text2,
              callback: value => formatNumber(Number(value || 0)),
            },
            grid: { color: colors.grid },
            border: { color: colors.border },
          },
        },
      },
    });

    chartRef.current?.destroy();
    chartRef.current = chart;
    return () => chart.destroy();
  }, [colors, days, legendAlign, series, showLegend]);

  if (!series.length) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle ? <CardHint>{subtitle}</CardHint> : null}
          </div>
        </CardHeader>
        <CardBody>
          <EmptyState icon="∿" text={emptyText} />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle ? <CardHint>{subtitle}</CardHint> : null}
        </div>
      </CardHeader>
      <CardBody>
        <div style={{ height }}>
          <canvas ref={canvasRef} />
        </div>
      </CardBody>
    </Card>
  );
}

function EmployeeTable({
  rows,
  days,
  sortKey,
  sortDir,
  onToggleSort,
  onOpenPath,
}: {
  rows: SwatEmployeeRow[];
  days: string[];
  sortKey: EmployeeSortKey;
  sortDir: SortDirection;
  onToggleSort: (key: EmployeeSortKey) => void;
  onOpenPath: (row: SwatEmployeeRow) => void;
}) {
  const fixedBudget = Math.max(56, Math.min(72, 84 - days.length * 2.6));
  const baseWidths = {
    name: 12,
    target: 10,
    path: 18,
    uwu: 4.5,
    uwuph: 5,
    iosh: 5.5,
    andh: 6,
    iosc: 5.5,
    andc: 6.5,
    avg: 5.5,
  };
  const baseTotal = Object.values(baseWidths).reduce((sum, value) => sum + value, 0);
  const scale = fixedBudget / baseTotal;
  const colWidths = {
    name: `${(baseWidths.name * scale).toFixed(2)}%`,
    target: `${(baseWidths.target * scale).toFixed(2)}%`,
    path: `${(baseWidths.path * scale).toFixed(2)}%`,
    uwu: `${(baseWidths.uwu * scale).toFixed(2)}%`,
    uwuph: `${(baseWidths.uwuph * scale).toFixed(2)}%`,
    iosh: `${(baseWidths.iosh * scale).toFixed(2)}%`,
    andh: `${(baseWidths.andh * scale).toFixed(2)}%`,
    iosc: `${(baseWidths.iosc * scale).toFixed(2)}%`,
    andc: `${(baseWidths.andc * scale).toFixed(2)}%`,
    avg: `${(baseWidths.avg * scale).toFixed(2)}%`,
    day: `${((100 - fixedBudget) / Math.max(days.length, 1)).toFixed(2)}%`,
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: 16, border: '1px solid var(--border)', background: 'var(--card)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: colWidths.name }} />
          <col style={{ width: colWidths.target }} />
          <col style={{ width: colWidths.path }} />
          <col style={{ width: colWidths.uwu }} />
          <col style={{ width: colWidths.uwuph }} />
          <col style={{ width: colWidths.iosh }} />
          <col style={{ width: colWidths.andh }} />
          <col style={{ width: colWidths.iosc }} />
          <col style={{ width: colWidths.andc }} />
          <col style={{ width: colWidths.avg }} />
          {days.map(day => (
            <col key={day} style={{ width: colWidths.day }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <SortableHeader label="SWAT" sortKey="name" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} style={headerDivider()} />
            <SortableHeader label="Целевой стрим" sortKey="target" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} style={headerDivider()} />
            <Th style={headerDivider('group')}>Проходил</Th>
            <SortableHeader label="uWu" sortKey="uwu" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="uWu/Ч" sortKey="uwuph" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="iOS (ч/м)" sortKey="iosh" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="Android (ч/м)" sortKey="andh" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="Кейсы iOS" sortKey="iosc" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="Кейсы Android" sortKey="andc" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider()} />
            <SortableHeader label="Среднее кейс" sortKey="avg" activeKey={sortKey} direction={sortDir} onToggle={onToggleSort} align="right" style={headerDivider('group')} />
            {days.map((day, index) => (
              <Th
                key={day}
                style={{
                  textAlign: 'center',
                  paddingInline: 6,
                  ...(index === days.length - 1 ? {} : headerDivider()),
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{ruDowShort(day)}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{ddmm(day)}</span>
                </div>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.login}>
              <Td bold style={cellDivider()}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ lineHeight: 1.35, wordBreak: 'break-word' }}>{row.fullName}</span>
                    <Badge color={employeePlatformBadgeColor(row.platform)}>{employeePlatformLabel(row.platform)}</Badge>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)' }}>{row.login}</span>
                </div>
              </Td>
              <Td style={cellDivider()}>
                <span
                  title={row.targetStream || '—'}
                  style={{
                    color: 'var(--text-2)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                >
                  {row.targetStream || '—'}
                </span>
              </Td>
              <Td style={cellDivider('group')}>
                <button
                  onClick={() => onOpenPath(row)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    margin: 0,
                    color: 'var(--text-2)',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    whiteSpace: 'normal',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                    font: 'inherit',
                  }}
                  title={row.allStreamsText || '—'}
                >
                  {row.allStreamsText || '—'}
                </button>
              </Td>
              <Td mono bold style={{ textAlign: 'right', ...cellDivider() }}>{row.uwuText}</Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider() }}>
                <span title={row.uwuPerHour == null ? 'Нет часов из worked_days' : `${row.uwuText} / ${row.workedHoursTotal}ч`}>
                  {row.uwuPerHourText}
                </span>
              </Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider() }}>{row.iosHoursText}</Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider() }}>{row.androidHoursText}</Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider() }}>{formatNumber(row.iosCases)}</Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider() }}>{formatNumber(row.androidCases)}</Td>
              <Td mono style={{ textAlign: 'right', ...cellDivider('group') }}>{row.avgText}</Td>
              {row.days.map((cell, index) => (
                <td
                  key={`${row.login}:${cell.day}`}
                  title={cell.title}
                  style={{
                    padding: '8px 6px',
                    fontSize: 10.5,
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: cell.worked ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.05)',
                    color: cell.worked ? 'var(--text)' : 'var(--text-3)',
                    fontWeight: cell.worked ? 600 : 400,
                    lineHeight: 1.25,
                    ...(index === days.length - 1 ? {} : cellDivider()),
                  }}
                >
                  {cell.text || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlatformTable({ model }: { model: SwatPlatformModel }) {
  const days = model.days;
  const totalAndroidCases = days.reduce((sum, day) => sum + Number(model.amountByDay[day]?.Android || 0), 0);
  const totalIosCases = days.reduce((sum, day) => sum + Number(model.amountByDay[day]?.iOS || 0), 0);
  const totalAllAvg = days.reduce((sum, day) => sum + Number(model.avgByDay[day]?.All || 0), 0);
  const fixedBudget = Math.max(42, Math.min(56, 68 - days.length * 2.2));
  const dayWidth = `${((100 - fixedBudget) / Math.max(days.length, 1)).toFixed(2)}%`;

  const rows = [
    {
      label: 'Android',
      values: days.map(day => ({
        value: formatNumber(model.amountByDay[day]?.Android || 0),
        title: `Кейсов: ${formatNumber(model.amountByDay[day]?.Android || 0)}\nСотрудников: ${formatNumber(model.workersByDay[day]?.Android || 0)}`,
      })),
      totalA: '',
      totalI: '',
    },
    {
      label: 'iOS',
      values: days.map(day => ({
        value: formatNumber(model.amountByDay[day]?.iOS || 0),
        title: `Кейсов: ${formatNumber(model.amountByDay[day]?.iOS || 0)}\nСотрудников: ${formatNumber(model.workersByDay[day]?.iOS || 0)}`,
      })),
      totalA: '',
      totalI: '',
    },
    {
      label: 'Общее',
      values: days.map(day => ({
        value: formatNumber(model.amountByDay[day]?.All || 0),
        title: `Кейсов: ${formatNumber(model.amountByDay[day]?.All || 0)}\nСотрудников: ${formatNumber(model.workersByDay[day]?.All || 0)}`,
      })),
      totalA: '',
      totalI: '',
    },
    {
      label: 'Среднее на свата Android',
      values: days.map(day => ({
        value: Number(model.avgByDay[day]?.Android || 0).toFixed(2),
        title: `Среднее: ${Number(model.avgByDay[day]?.Android || 0).toFixed(2)}\nСотрудников: ${formatNumber(model.workersByDay[day]?.Android || 0)}`,
      })),
      totalA: Number(model.releaseAvgA || 0).toFixed(2),
      totalI: '',
    },
    {
      label: 'Среднее на свата iOS',
      values: days.map(day => ({
        value: Number(model.avgByDay[day]?.iOS || 0).toFixed(2),
        title: `Среднее: ${Number(model.avgByDay[day]?.iOS || 0).toFixed(2)}\nСотрудников: ${formatNumber(model.workersByDay[day]?.iOS || 0)}`,
      })),
      totalA: '',
      totalI: Number(model.releaseAvgI || 0).toFixed(2),
    },
    {
      label: 'Среднее общее',
      values: days.map(day => ({
        value: Number(model.avgByDay[day]?.All || 0).toFixed(2),
        title: `Среднее: ${Number(model.avgByDay[day]?.All || 0).toFixed(2)}`,
      })),
      totalA: '',
      totalI: '',
    },
    {
      label: 'Среднее за релиз',
      values: days.map((day, index) => ({
        value: index === 0 ? Number(model.releaseAvgAll || 0).toFixed(2) : '',
        title: index === 0
          ? `Среднее за релиз: ${Number(model.releaseAvgAll || 0).toFixed(2)}\nФормула: ${totalAllAvg.toFixed(2)} / ${days.length || 0}`
          : '',
      })),
      totalA: '',
      totalI: '',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard label="Android за релиз" value={formatNumber(totalAndroidCases)} hint={`SWAT уникальных: ${formatNumber(model.uniqueWorkersA)}`} />
        <MetricCard label="iOS за релиз" value={formatNumber(totalIosCases)} hint={`SWAT уникальных: ${formatNumber(model.uniqueWorkersI)}`} />
        <MetricCard label="Среднее Android" value={Number(model.releaseAvgA || 0).toFixed(2)} hint="Кейсов на SWAT" tone="accent" />
        <MetricCard label="Среднее iOS" value={Number(model.releaseAvgI || 0).toFixed(2)} hint="Кейсов на SWAT" tone="accent" />
        <MetricCard label="Среднее общее" value={Number(model.releaseAvgAll || 0).toFixed(2)} hint="(Android/SWAT) + (iOS/SWAT)" tone="positive" />
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 16, border: '1px solid var(--border)', background: 'var(--card)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: `${(fixedBudget * 0.46).toFixed(2)}%` }} />
            {days.map(day => (
              <col key={day} style={{ width: dayWidth }} />
            ))}
            <col style={{ width: `${(fixedBudget * 0.27).toFixed(2)}%` }} />
            <col style={{ width: `${(fixedBudget * 0.27).toFixed(2)}%` }} />
          </colgroup>
          <thead>
            <tr>
              <Th style={headerDivider('group')}>Платформа / метрика</Th>
              {days.map((day, index) => (
                <Th
                key={day}
                style={{
                  textAlign: 'center',
                  paddingInline: 6,
                  ...(index === days.length - 1 ? headerDivider('group') : headerDivider()),
                }}
              >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{ruDowShort(day)}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      {ddmm(day)} ({formatNumber(model.swatCountByDay[day] || 0)})
                    </span>
                  </div>
                </Th>
              ))}
              <Th style={{ textAlign: 'center', ...headerDivider() }}>Android общее</Th>
              <Th style={{ textAlign: 'center' }}>iOS общее</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label}>
                <Td bold style={cellDivider('group')}>{row.label}</Td>
                {row.values.map((value, index) => (
                  <Td
                    key={`${row.label}:${days[index]}`}
                    mono
                    style={{
                      textAlign: 'center',
                      ...(index === days.length - 1 ? cellDivider('group') : cellDivider()),
                    }}
                  >
                    <span title={value.title}>
                      {value.value || '—'}
                    </span>
                  </Td>
                ))}
                <Td mono style={{ textAlign: 'center', ...cellDivider() }}>{row.totalA || '—'}</Td>
                <Td mono style={{ textAlign: 'center' }}>{row.totalI || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LaunchTable({ launches }: { launches: SwatReleaseReport['launches'] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Лаунчи расчёта</CardTitle>
          <CardHint>По ним собирались memberstats, leaf и timeline.</CardHint>
        </div>
        <Badge color="gray">{launches.length} launch</Badge>
      </CardHeader>
      <CardBody style={{ paddingTop: 0 }}>
        <div style={{ maxHeight: 320, overflowY: 'auto', borderRadius: 14, border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <Th style={headerDivider()}>Лаунч</Th>
                <Th style={headerDivider()}>Стрим</Th>
                <Th style={headerDivider()}>Платформа</Th>
                <Th>Allure</Th>
              </tr>
            </thead>
            <tbody>
              {launches.map(launch => (
                <tr key={launch.id}>
                  <Td bold style={cellDivider()}>{launch.name}</Td>
                  <Td style={cellDivider()}>{launch.stream || '—'}</Td>
                  <Td style={cellDivider()}>
                    <Badge color={launch.platform === 'Android' ? 'green' : launch.platform === 'iOS' ? 'blue' : 'gray'}>
                      {launch.platform}
                    </Badge>
                  </Td>
                  <Td>
                    <a href={launch.url} target="_blank" rel="noreferrer" style={{ color: '#8B5CF6', fontWeight: 600 }}>
                      Открыть
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

export function SwatRelease() {
  const { settings } = useSettings();
  const { setSettingsOpen, theme } = useApp();

  const [release, setRelease] = useState(() => readStoredText(RELEASE_KEY, ''));
  const [tab, setTab] = useState<TabValue>(() => readStoredTab());
  const [proxyState, setProxyState] = useState<ProxyState>('unknown');
  const [status, setStatus] = useState('Укажи релиз и запусти сбор SWAT.');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SwatReleaseReport | null>(null);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [sortKey, setSortKey] = useState<EmployeeSortKey>('name');
  const [sortDir, setSortDir] = useState<SortDirection>(1);
  const [filterSearch, setFilterSearch] = useState('');
  const [selectedLogins, setSelectedLogins] = useState<string[]>([]);
  const [pathModal, setPathModal] = useState<PathModalState | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(RELEASE_KEY, release);
    } catch {
      /* ignore */
    }
  }, [release]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    if (!settings.useProxy || !String(settings.proxyBase || '').trim()) {
      setProxyState('unknown');
      return;
    }
    checkProxy(settings.proxyBase).then(value => {
      if (!cancelled) setProxyState(value ? 'ok' : 'error');
    }).catch(() => {
      if (!cancelled) setProxyState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [settings.proxyBase, settings.useProxy]);

  const addLog = useCallback((text: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-299), { text: `[${formatTimeStamp()}] ${text}`, level }]);
  }, []);

  const tokenReady = Boolean(String(settings.allureToken || '').trim());
  const themeColors = useMemo(() => getChartThemeColors(), [theme]);

  const sortedEmployees = useMemo(() => {
    return report ? sortEmployees(report.employees, sortKey, sortDir) : [];
  }, [report, sortDir, sortKey]);

  const selectedLoginSet = useMemo(() => new Set(selectedLogins), [selectedLogins]);

  const filteredUsers = useMemo(() => report?.users || [], [report]);

  const filteredAndroidRows = useMemo(() => {
    if (!report) return [] as SwatChartRow[];
    return report.chartRowsAndroid.filter(row => selectedLoginSet.has(row.login) && row.total > 0);
  }, [report, selectedLoginSet]);

  const filteredIosRows = useMemo(() => {
    if (!report) return [] as SwatChartRow[];
    return report.chartRowsIos.filter(row => selectedLoginSet.has(row.login) && row.total > 0);
  }, [report, selectedLoginSet]);

  const filteredStreamRows = useMemo(() => {
    if (!report) return [] as SwatChartStreamRow[];
    return report.chartRowsStreams.filter(row => selectedLoginSet.has(row.login) && row.streams.some(stream => stream.total > 0));
  }, [report, selectedLoginSet]);

  const totalUwu = useMemo(() => {
    return sortedEmployees.reduce((sum, row) => sum + Number(row.uwuSum || 0), 0);
  }, [sortedEmployees]);

  const totalWorkedHours = useMemo(() => {
    return sortedEmployees.reduce((sum, row) => sum + Number(row.workedHoursTotal || 0), 0);
  }, [sortedEmployees]);

  const handleProxyCheck = useCallback(async () => {
    if (!settings.useProxy) {
      setProxyState('unknown');
      setStatus('Proxy отключен в настройках.');
      setStatusTone('warn');
      return;
    }

    setStatus('Проверяю proxy...');
    setStatusTone('neutral');
    try {
      const ok = await checkProxy(settings.proxyBase);
      setProxyState(ok ? 'ok' : 'error');
      setStatus(ok ? 'Proxy доступен.' : 'Proxy недоступен.');
      setStatusTone(ok ? 'ok' : 'error');
    } catch {
      setProxyState('error');
      setStatus('Proxy недоступен.');
      setStatusTone('error');
    }
  }, [settings.proxyBase, settings.useProxy]);

  const run = useCallback(async () => {
    const cleanRelease = String(release || '').trim();
    if (!cleanRelease) {
      setStatus('Укажи версию релиза.');
      setStatusTone('error');
      return;
    }
    if (!tokenReady) {
      setStatus('Заполни Allure Api-Token в настройках.');
      setStatusTone('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current = controller;

    setRunning(true);
    setReport(null);
    setLogs([]);
    setProgress(0);
    setSelectedLogins([]);
    setStatus(`Запускаю SWAT релиз для ${cleanRelease}.`);
    setStatusTone('neutral');

    try {
      const nextReport = await buildSwatReleaseReport(
        {
          base: settings.allureBase,
          token: settings.allureToken,
          projectId: settings.projectId,
          signal: controller.signal,
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
        },
        cleanRelease,
        {
          onLog(text, level) {
            if (runId !== runIdRef.current) return;
            addLog(text, level || 'info');
          },
          onProgress(value) {
            if (runId !== runIdRef.current) return;
            setProgress(value);
          },
        },
      );

      if (runId !== runIdRef.current) return;
      setReport(nextReport);
      setSelectedLogins(nextReport.users.map(user => user.login));
      setStatus(`Готово: SWAT ${nextReport.swatCount}, запусков ${nextReport.launchesCount}.`);
      setStatusTone('ok');
      setProgress(100);
    } catch (rawError) {
      if (runId !== runIdRef.current) return;
      const error = rawError as Error;
      if (error?.name === 'AbortError') return;
      const message = error?.message || 'Не удалось собрать SWAT релиз.';
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      addLog(message, 'error');
    } finally {
      if (runId === runIdRef.current) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  }, [
    addLog,
    release,
    settings.allureBase,
    settings.allureToken,
    settings.projectId,
    settings.proxyBase,
    settings.proxyMode,
    settings.useProxy,
    tokenReady,
  ]);

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    runIdRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus('Сбор остановлен.');
    setStatusTone('warn');
    setProgress(0);
    addLog('Сбор остановлен пользователем.', 'warn');
  }, [addLog]);

  const toggleSort = useCallback((key: EmployeeSortKey) => {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === 1 ? -1 : 1));
        return prevKey;
      }
      setSortDir(1);
      return key;
    });
  }, []);

  const toggleLogin = useCallback((login: string) => {
    setSelectedLogins(prev => prev.includes(login) ? prev.filter(item => item !== login) : [...prev, login]);
  }, []);

  const selectAllUsers = useCallback(() => {
    setSelectedLogins((report?.users || []).map(user => user.login));
  }, [report]);

  const clearUsers = useCallback(() => {
    setSelectedLogins([]);
  }, []);

  const openPath = useCallback((row: SwatEmployeeRow) => {
    setPathModal({
      title: 'Проходил',
      subtitle: `${row.fullName} (${row.login})`,
      body: row.allStreamsHover || row.allStreamsText || '—',
    });
  }, []);

  const exportExcel = useCallback(async () => {
    if (!report) return;
    const XLSX = await ensureXlsxLibrary();
    const workbook = XLSX.utils.book_new();
    const rows: unknown[][] = [
      [`Общее среднее на 1 кейс: ${report.overallAvgMMSS}`],
      [],
      [
        'SWAT',
        'uWu',
        'uWu/Ч',
        'Целевой стрим',
        'Проходил',
        'iOS (ч/м)',
        'Android (ч/м)',
        'Кейсы iOS',
        'Кейсы Android',
        'Среднее кейс',
        ...report.days.map(day => `${ruDowShort(day)} ${ddmm(day)}`),
      ],
    ];

    sortedEmployees.forEach(row => {
      rows.push([
        row.fullName,
        row.uwuText,
        row.uwuPerHourText,
        row.targetStream || '—',
        row.allStreamsText || '—',
        row.iosHoursText,
        row.androidHoursText,
        row.iosCases,
        row.androidCases,
        row.avgText,
        ...row.days.map(day => day.text || ''),
      ]);
    });

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, 'SWAT');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SWAT_${report.release.replace(/[^\w.-]+/g, '_')}_employees.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [report, sortedEmployees]);

  const tabItems = useMemo(() => ([
    { value: 'emp', label: 'Детали по сотруднику' },
    { value: 'plat', label: 'Детали по платформам' },
    { value: 'cases', label: 'Кейсы по дням' },
    { value: 'streams', label: 'Кейсы по дням (стримы)' },
  ]), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◆</div>
        SWAT Релиз
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard label="SWAT сотрудников" value={report ? formatNumber(report.swatCount) : '—'} />
        <MetricCard label="Запусков" value={report ? formatNumber(report.launchesCount) : '—'} />
        <MetricCard label="Кейсов всего" value={report ? formatNumber(report.totalCases) : '—'} hint={report ? `Android ${formatNumber(report.totalCasesAndroid)} · iOS ${formatNumber(report.totalCasesIos)}` : undefined} />
        <MetricCard label="Общее среднее" value={report?.overallAvgMMSS || '—'} hint="На 1 кейс" tone="accent" />
        <MetricCard label="Сумма uWu" value={report ? formatUwU(totalUwu) : '—'} hint={report ? `${formatNumber(totalWorkedHours)}ч из worked_days` : undefined} tone="positive" />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Параметры запуска</CardTitle>
            <CardHint>Берём SWAT / worked_days из Apps Script, а расчёт строим по High/Blocker launch в Allure.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusPill status={tokenReady ? 'live' : 'warn'}>{tokenReady ? 'Allure token ready' : 'Allure token missing'}</StatusPill>
            <StatusPill status={settings.useProxy ? (proxyState === 'ok' ? 'live' : proxyState === 'error' ? 'warn' : 'neutral') : 'neutral'}>
              {settings.useProxy ? (proxyState === 'ok' ? 'Proxy online' : proxyState === 'error' ? 'Proxy offline' : 'Proxy unknown') : 'Proxy off'}
            </StatusPill>
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <FieldLabel>Версия релиза</FieldLabel>
              <Input
                value={release}
                onChange={event => setRelease(event.target.value)}
                placeholder="Напр. 7.5.0000"
                style={{ width: 180 }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void run();
                  }
                }}
              />
            </div>

            <Button variant="primary" onClick={() => void run()} disabled={running}>
              {running ? 'Сбор...' : 'Запустить сбор'}
            </Button>
            <Button variant="danger" onClick={stop} disabled={!running}>
              Остановить
            </Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
              Настройки
            </Button>
            <Button variant="ghost" onClick={() => void handleProxyCheck()} disabled={!settings.useProxy}>
              Проверить proxy
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 12, color: statusTone === 'error' ? '#F87171' : statusTone === 'ok' ? '#4ADE80' : statusTone === 'warn' ? '#FCD34D' : 'var(--text-2)' }}>
                {status}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} color={progressColor(statusTone)} height={7} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>SWAT Dashboard</CardTitle>
            <CardHint>Сотрудники, платформы, кейсы по дням и срез по стримам на одном отчёте.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {report ? <Badge color="purple">SWAT {report.swatCount}</Badge> : null}
            {report ? <Badge color="gray">Запусков {report.launchesCount}</Badge> : null}
            {report ? <Badge color="gray">Кейсов {formatNumber(report.totalCases)}</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => void exportExcel()} disabled={!report}>
              Выгрузить Excel
            </Button>
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SegmentControl items={tabItems} value={tab} onChange={value => setTab(value as TabValue)} />

          {!report ? (
            <EmptyState icon="◆" text={running ? 'Сбор данных SWAT...' : 'Запусти расчёт, чтобы построить SWAT отчёт.'} />
          ) : (
            <>
              {tab === 'emp' ? (
                <EmployeeTable
                  rows={sortedEmployees}
                  days={report.days}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggleSort={toggleSort}
                  onOpenPath={openPath}
                />
              ) : null}

              {tab === 'plat' ? <PlatformTable model={report.platformModel} /> : null}

              {tab === 'cases' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                  <FilterCard
                    users={filteredUsers}
                    search={filterSearch}
                    selectedLogins={selectedLoginSet}
                    onSearchChange={setFilterSearch}
                    onToggle={toggleLogin}
                    onSelectAll={selectAllUsers}
                    onClear={clearUsers}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <CasesLineChart
                      title="Android"
                      subtitle="Кейсы сотрудников по дням"
                      days={report.days}
                      series={filteredAndroidRows.map(row => ({ label: row.fullName, data: row.dayCounts }))}
                      colors={themeColors}
                      emptyText="Нет выбранных сотрудников с Android кейсами."
                    />
                    <CasesLineChart
                      title="iOS"
                      subtitle="Кейсы сотрудников по дням"
                      days={report.days}
                      series={filteredIosRows.map(row => ({ label: row.fullName, data: row.dayCounts }))}
                      colors={themeColors}
                      emptyText="Нет выбранных сотрудников с iOS кейсами."
                    />
                  </div>
                </div>
              ) : null}

              {tab === 'streams' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                  <FilterCard
                    users={filteredUsers}
                    search={filterSearch}
                    selectedLogins={selectedLoginSet}
                    onSearchChange={setFilterSearch}
                    onToggle={toggleLogin}
                    onSelectAll={selectAllUsers}
                    onClear={clearUsers}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {!filteredStreamRows.length ? (
                      <Card>
                        <CardBody>
                          <EmptyState icon="∿" text="Для выбранных сотрудников нет кейсов по стримам." />
                        </CardBody>
                      </Card>
                    ) : filteredStreamRows.map(row => (
                      <CasesLineChart
                        key={row.login}
                        title={row.fullName}
                        subtitle={row.login}
                        days={report.days}
                        series={row.streams.map(stream => ({ label: stream.stream, data: stream.dayCounts }))}
                        colors={themeColors}
                        showLegend
                        legendAlign="end"
                        height={280}
                        emptyText="Нет данных по стримам."
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <LaunchTable launches={report.launches} />
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Лог</CardTitle>
            <CardHint>Пошаговый прогресс сбора и диагностика запросов.</CardHint>
          </div>
        </CardHeader>
        <CardBody>
          <LogView lines={logs} maxHeight={220} />
        </CardBody>
      </Card>

      <Modal open={Boolean(pathModal)} onClose={() => setPathModal(null)} title={pathModal?.title || 'Проходил'} width={720}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pathModal?.subtitle ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
              {pathModal.subtitle}
            </div>
          ) : null}
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--text-2)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '12px 14px',
              maxHeight: '55vh',
              overflowY: 'auto',
            }}
          >
            {pathModal?.body || '—'}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              onClick={async () => {
                if (!pathModal?.body) return;
                await navigator.clipboard.writeText(pathModal.body);
              }}
            >
              Копировать
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
