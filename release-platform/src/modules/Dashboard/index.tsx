import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  ArcElement,
  BarController,
  CategoryScale,
  DoughnutController,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  BarElement,
  Filler,
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
  InfoRow,
  Input,
  Progress,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import {
  DASHBOARD_ORDER,
  fetchDashboardAggregate,
  fetchReadinessSummary,
  readCachedDashboardAggregate,
  readCachedDashboardReadiness,
  writeCachedDashboardReadiness,
  type DashboardAggregateResult,
  type DashboardAlertEntry,
  type DashboardGroupCounts,
  type DashboardGroupLabel,
  type DashboardUwuCounts,
  type ReadinessLaunchSummary,
} from '../../services/allure';
import {
  buildDashboardPrediction,
  type DashboardHistoryPoint,
  type DashboardPrediction,
} from '../../services/releasePrediction';
import type { AllureLaunchResult } from '../../types';
import { useApp, isDarkTheme, type ThemeMode } from '../../context/AppContext';

Chart.register(DoughnutController, ArcElement, BarController, LineController, LineElement, PointElement, CategoryScale, LinearScale, BarElement, Filler, Tooltip, Legend);

const DASHBOARD_SNAPSHOT_KEY = 'rp_dashboard_last_v1';
const DASHBOARD_HISTORY_KEY = 'rp_dashboard_history_v1';
const MOSCOW_UTC_OFFSET_MS = 3 * 3_600_000;

interface DashboardChartPalette {
  text: string;
  textSoft: string;
  grid: string;
  border: string;
  surface: string;
  greenFill: string;
  yellowFill: string;
  blueFill: string;
  purpleFill: string;
}

function createEmptyAgg(): Record<DashboardGroupLabel, DashboardGroupCounts> {
  return Object.fromEntries(
    DASHBOARD_ORDER.map(label => [label, { total: 0, finished: 0, remaining_total: 0, remaining: 0, in_progress: 0, manual_finished: 0 }])
  ) as Record<DashboardGroupLabel, DashboardGroupCounts>;
}

function createEmptyUwuAgg(): Record<DashboardGroupLabel, DashboardUwuCounts> {
  return Object.fromEntries(
    DASHBOARD_ORDER.map(label => [label, { total: 0, done: 0, left: 0 }])
  ) as Record<DashboardGroupLabel, DashboardUwuCounts>;
}

function sanitizeHistoryPoint(raw: unknown): DashboardHistoryPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<DashboardHistoryPoint>;
  const version = String(value.version || '').trim();
  const updatedAt = Number(value.updatedAt || 0);
  if (!version || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;

  return {
    version,
    updatedAt,
    total: Number(value.total || 0),
    finished: Number(value.finished || 0),
    manualFinished: Number(value.manualFinished || 0),
    manualTimedFinished: Number(value.manualTimedFinished || 0),
    manualWindowStartTs: value.manualWindowStartTs == null ? null : Number(value.manualWindowStartTs || 0),
    manualWindowStopTs: value.manualWindowStopTs == null ? null : Number(value.manualWindowStopTs || 0),
    remaining: Number(value.remaining || 0),
    launches: Number(value.launches || 0),
    assigned: Number(value.assigned || 0),
    inProgress: Number(value.inProgress || 0),
    readinessAndroid: Number(value.readinessAndroid || 0),
    readinessIos: Number(value.readinessIos || 0),
    criticalTotal: Number(value.criticalTotal || 0),
    criticalFinished: Number(value.criticalFinished || 0),
    selectiveTotal: Number(value.selectiveTotal || 0),
    selectiveFinished: Number(value.selectiveFinished || 0),
    emptyAlerts: Number(value.emptyAlerts || 0),
    noPassedAlerts: Number(value.noPassedAlerts || 0),
    uwuTotal: Number(value.uwuTotal || 0),
    uwuLeft: Number(value.uwuLeft || 0),
    activePeopleCount: Number(value.activePeopleCount || 0),
    activePeopleLogins: Array.isArray(value.activePeopleLogins) ? value.activePeopleLogins.map(item => String(item || '').trim()).filter(Boolean) : [],
  };
}

function readAllHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASHBOARD_HISTORY_KEY) || '[]') as unknown[];
    return (Array.isArray(raw) ? raw : [])
      .map(sanitizeHistoryPoint)
      .filter((item): item is DashboardHistoryPoint => Boolean(item));
  } catch {
    return [];
  }
}

function readSnapshot(version: string) {
  try {
    const raw = sanitizeHistoryPoint(JSON.parse(localStorage.getItem(DASHBOARD_SNAPSHOT_KEY) || 'null'));
    if (!raw || raw.version !== version) return null;
    return raw;
  } catch {
    return null;
  }
}

function readHistory(version: string) {
  return readAllHistory()
    .filter(item => item.version === version)
    .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0))
    .slice(-24);
}

function writeSnapshot(snapshot: DashboardHistoryPoint) {
  try {
    localStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify(snapshot));
    const nextAll = [...readAllHistory(), snapshot]
      .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0))
      .slice(-120);
    localStorage.setItem(DASHBOARD_HISTORY_KEY, JSON.stringify(nextAll));
    return nextAll
      .filter(item => item.version === snapshot.version)
      .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0))
      .slice(-24);
  } catch {
    return [snapshot];
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value || 0));
}

function formatPercent(value: number, fractionDigits = 1) {
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(value) ? value : 0)}%`;
}

function formatDelta(current: number, previous?: number | null) {
  if (previous == null) return 'нет прошлого среза';
  const delta = current - previous;
  if (delta === 0) return '= без изменений';
  return `${delta > 0 ? '▲ +' : '▼ '}${formatNumber(Math.abs(delta))}`;
}

function formatRelativeTime(ts?: number | null) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ч назад`;
  return `${Math.round(diff / 86_400_000)} д назад`;
}

function formatDateTime(ts?: number | null) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

function formatDateTimeMsk(ts?: number | null) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(ts);
}

function parseMoscowDateTimeLocal(value: string) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  const [, year, month, day, hour, minute] = match;
  const utcTs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0
  );
  return utcTs - MOSCOW_UTC_OFFSET_MS;
}

function formatLaunchStatus(status?: string | null) {
  const value = String(status || '').trim().toUpperCase();
  if (!value) return '—';
  if (value === 'RUNNING') return 'в работе';
  if (value === 'FINISHED') return 'завершён';
  if (value === 'FAILED') return 'ошибка';
  return value.toLowerCase();
}

function dashboardColorWithAlpha(color: string, alpha: number) {
  const value = String(color || '').trim();
  if (!value) return color;
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const normalized = hex.length === 3
      ? hex.split('').map(char => `${char}${char}`).join('')
      : hex.length === 6
        ? hex
        : '';
    if (normalized) {
      const int = Number.parseInt(normalized, 16);
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (/^rgb\(/i.test(value)) return value.replace(/^rgb\((.+)\)$/i, `rgba($1, ${alpha})`);
  if (/^hsl\(/i.test(value)) return value.replace(/^hsl\((.+)\)$/i, `hsla($1, ${alpha})`);
  return value;
}

function useDashboardChartPalette(theme: ThemeMode): DashboardChartPalette {
  return useMemo(() => {
    const dark = isDarkTheme(theme);
    return {
      text: dark ? '#EAE5F6' : '#1E293B',
      textSoft: dark ? '#9D96B4' : '#64748B',
      grid: dark ? 'rgba(255,255,255,.09)' : 'rgba(148,163,184,.12)',
      border: dark ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.08)',
      surface: dark ? '#1C1C26' : '#FFFFFF',
      greenFill: dark ? 'rgba(34,197,94,.78)' : 'rgba(34,197,94,.72)',
      yellowFill: dark ? 'rgba(245,158,11,.76)' : 'rgba(245,158,11,.68)',
      blueFill: dark ? 'rgba(59,130,246,.74)' : 'rgba(59,130,246,.66)',
      purpleFill: dark ? 'rgba(155,92,255,.72)' : 'rgba(155,92,255,.64)',
    };
  }, [theme]);
}

function formatRate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} / ч`;
}

function compactRegressionStream(stream: string, fullName: string) {
  const raw = String(stream || '').trim() || String(fullName || '').match(/\[([^\]]+)\]/)?.[1] || '';
  const cleaned = raw
    .replace(/^stream\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Без стрима';
}

function compactRegressionLaunchName(launch: AllureLaunchResult) {
  const stream = compactRegressionStream(launch.stream, launch.name);
  const kind =
    launch.type === 'high_blocker'
      ? 'High/Blocker'
      : launch.type === 'selective'
        ? 'Selective'
        : launch.type === 'regression'
          ? 'Regression'
          : 'Run';
  return `${stream} · ${kind}`;
}

function compactLabel(label: DashboardGroupLabel) {
  return label
    .replace('[iOS]', 'iOS')
    .replace('[Android]', 'Android')
    .replace('[High/Blocker]', 'Critical')
    .replace('[Selective]', 'Selective');
}

function buildHistorySnapshot(
  version: string,
  launchesCount: number,
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>,
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>,
  readiness: ReadinessLaunchSummary[],
  alerts: DashboardAlertEntry[],
  updatedAt: number,
  activePeopleCount = 0,
  activePeopleLogins: string[] = [],
  manualTimedFinished = 0,
  manualWindowStartTs: number | null = null,
  manualWindowStopTs: number | null = null,
): DashboardHistoryPoint {
  const criticalLabels = DASHBOARD_ORDER.filter(label => label.includes('[High/Blocker]'));
  const selectiveLabels = DASHBOARD_ORDER.filter(label => label.includes('[Selective]'));
  const total = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.total || 0), 0);
  const finished = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.finished || 0), 0);
  const manualFinished = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.manual_finished || 0), 0);
  const remaining = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.remaining_total || 0), 0);
  const assigned = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.remaining || 0), 0);
  const inProgress = DASHBOARD_ORDER.reduce((sum, label) => sum + Number(agg[label]?.in_progress || 0), 0);
  const criticalTotal = criticalLabels.reduce((sum, label) => sum + Number(agg[label]?.total || 0), 0);
  const criticalFinished = criticalLabels.reduce((sum, label) => sum + Number(agg[label]?.finished || 0), 0);
  const selectiveTotal = selectiveLabels.reduce((sum, label) => sum + Number(agg[label]?.total || 0), 0);
  const selectiveFinished = selectiveLabels.reduce((sum, label) => sum + Number(agg[label]?.finished || 0), 0);
  const uwuTotal = criticalLabels.reduce((sum, label) => sum + Number(uwu[label]?.total || 0), 0);
  const uwuLeft = criticalLabels.reduce((sum, label) => sum + Number(uwu[label]?.left || 0), 0);

  return {
    version,
    updatedAt,
    total,
    finished,
    manualFinished,
    manualTimedFinished,
    manualWindowStartTs,
    manualWindowStopTs,
    remaining,
    launches: launchesCount,
    assigned,
    inProgress,
    readinessAndroid: readiness.find(item => item.platform === 'android')?.pct || 0,
    readinessIos: readiness.find(item => item.platform === 'ios')?.pct || 0,
    criticalTotal,
    criticalFinished,
    selectiveTotal,
    selectiveFinished,
    emptyAlerts: alerts.filter(item => item.total === 0).length,
    noPassedAlerts: alerts.filter(item => item.total > 0 && item.finished === 0).length,
    uwuTotal,
    uwuLeft,
    activePeopleCount,
    activePeopleLogins,
  };
}

function MetricCard({
  label,
  value,
  delta,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  delta?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 18,
      padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? 'var(--text)', margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {delta && <div style={{ fontSize: 11, fontWeight: 600, color: delta.startsWith('▲') ? '#22C55E' : delta.startsWith('▼') ? '#EF4444' : 'var(--text-3)' }}>{delta}</div>}
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SummaryBarChart({ agg }: { agg: Record<DashboardGroupLabel, DashboardGroupCounts> }) {
  const { theme } = useApp();
  const palette = useDashboardChartPalette(theme);
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();

    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: DASHBOARD_ORDER.map(compactLabel),
        datasets: [
          {
            label: 'Пройдено',
            data: DASHBOARD_ORDER.map(label => Number(agg[label]?.finished || 0)),
            backgroundColor: palette.greenFill,
            borderColor: '#22C55E',
            borderWidth: 1.2,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
            categoryPercentage: 0.68,
            barPercentage: 0.84,
          },
          {
            label: 'Осталось',
            data: DASHBOARD_ORDER.map(label => Number(agg[label]?.remaining_total || 0)),
            backgroundColor: palette.yellowFill,
            borderColor: '#F59E0B',
            borderWidth: 1.2,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
            categoryPercentage: 0.68,
            barPercentage: 0.84,
          },
          {
            label: 'Назначено',
            data: DASHBOARD_ORDER.map(label => Number(agg[label]?.remaining || 0)),
            backgroundColor: palette.blueFill,
            borderColor: '#3B82F6',
            borderWidth: 1.2,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
            categoryPercentage: 0.68,
            barPercentage: 0.84,
          },
          {
            label: 'В работе',
            data: DASHBOARD_ORDER.map(label => Number(agg[label]?.in_progress || 0)),
            backgroundColor: palette.purpleFill,
            borderColor: '#9B5CFF',
            borderWidth: 1.2,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
            categoryPercentage: 0.68,
            barPercentage: 0.84,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 760,
          easing: 'easeOutCubic',
          delay(context) {
            if (context.type !== 'data' || context.mode !== 'default') return 0;
            return ((context.datasetIndex || 0) * 70) + ((context.dataIndex || 0) * 40);
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: palette.textSoft,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 14,
              font: { size: 11, family: 'IBM Plex Sans, system-ui', weight: 600 },
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: isDarkTheme(theme) ? 'rgba(15,23,42,.96)' : 'rgba(255,255,255,.98)',
            titleColor: isDarkTheme(theme) ? '#F8FAFC' : '#0F172A',
            bodyColor: isDarkTheme(theme) ? '#F8FAFC' : '#0F172A',
            borderColor: dashboardColorWithAlpha(palette.grid, 0.95),
            borderWidth: 1,
            padding: 10,
            cornerRadius: 12,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: palette.textSoft, font: { size: 11, family: 'IBM Plex Sans, system-ui', weight: 500 } },
            border: { color: palette.grid },
          },
          y: {
            beginAtZero: true,
            grid: { color: palette.grid },
            ticks: { color: palette.textSoft, font: { size: 11, family: 'IBM Plex Sans, system-ui', weight: 500 } },
            border: { color: palette.grid },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [agg, palette, theme]);

  return <canvas ref={ref} style={{ display: 'block', height: 280 }} />;
}

function GroupDonut({ row }: { row: DashboardGroupCounts }) {
  const { theme } = useApp();
  const palette = useDashboardChartPalette(theme);
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const finished = Number(row.finished || 0);
  const left = Number(row.remaining_total || 0);
  const total = Math.max(0, finished + left);
  const pct = total > 0 ? (finished / total) * 100 : 0;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();

    chartRef.current = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: total > 0 ? [finished, left] : [1, 0],
          backgroundColor: [palette.greenFill, palette.yellowFill],
          borderColor: [palette.surface, palette.surface],
          borderWidth: 3,
          spacing: 3,
          hoverOffset: 2,
        }],
      },
      options: {
        cutout: '68%',
        responsive: false,
        animation: {
          duration: 620,
          easing: 'easeOutCubic',
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDarkTheme(theme) ? 'rgba(15,23,42,.96)' : 'rgba(255,255,255,.98)',
            titleColor: isDarkTheme(theme) ? '#F8FAFC' : '#0F172A',
            bodyColor: isDarkTheme(theme) ? '#F8FAFC' : '#0F172A',
            borderColor: dashboardColorWithAlpha(palette.grid, 0.95),
            borderWidth: 1,
            padding: 10,
            cornerRadius: 12,
            callbacks: {
              label: context => {
                const value = Number(context.raw || 0);
                const localPct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return `${context.dataIndex === 0 ? 'Пройдено' : 'Осталось'}: ${formatNumber(value)} (${localPct}%)`;
              },
            },
          },
        },
      },
      plugins: [{
        id: 'groupCenter',
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          const x = (chartArea.left + chartArea.right) / 2;
          const y = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = palette.text;
          ctx.font = '700 18px Inter, system-ui';
          ctx.fillText(formatPercent(pct), x, y - 2);
          ctx.fillStyle = palette.textSoft;
          ctx.font = '600 10px Inter, system-ui';
          ctx.fillText('готово', x, y + 16);
          ctx.restore();
        },
      }],
    });

    return () => chartRef.current?.destroy();
  }, [finished, left, pct, total, palette, theme]);

  return <canvas ref={ref} width={132} height={132} style={{ display: 'block' }} />;
}

function GroupCard({
  label,
  row,
  uwu,
}: {
  label: DashboardGroupLabel;
  row: DashboardGroupCounts;
  uwu: DashboardUwuCounts;
}) {
  const hasUwu = label.includes('[High/Blocker]');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{compactLabel(label)}</CardTitle>
          <CardHint>{hasUwu ? 'Реальный exact-count + UwU по leaf/testcase overview' : 'Selective без UwU, как в legacy dashboard'}</CardHint>
        </div>
        <Badge color={row.total > 0 && row.finished / Math.max(1, row.total) >= 0.9 ? 'green' : row.total > 0 ? 'yellow' : 'gray'}>
          {formatPercent(row.total > 0 ? (row.finished / Math.max(1, row.total)) * 100 : 0)}
        </Badge>
      </CardHeader>
      <CardBody style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <GroupDonut row={row} />
        </div>
        <div>
          <InfoRow label="Всего" value={formatNumber(row.total)} />
          <InfoRow label="Пройдено" value={<span style={{ color: '#22C55E' }}>{formatNumber(row.finished)}</span>} />
          <InfoRow label="Осталось" value={<span style={{ color: '#F59E0B' }}>{formatNumber(row.remaining_total)}</span>} />
          <InfoRow label="Назначено / Не назначено" value={`${formatNumber(row.remaining)} / ${formatNumber(row.in_progress)}`} />
          {hasUwu && (
            <>
              <InfoRow label="UwU всего" value={formatNumber(uwu.total)} />
              <InfoRow
                label="UwU пройдено / осталось"
                value={
                  <span>
                    <span style={{ color: '#22C55E' }}>{formatNumber(uwu.done)}</span>
                    {' / '}
                    <span style={{ color: '#F59E0B' }}>{formatNumber(uwu.left)}</span>
                  </span>
                }
              />
              {uwu.total > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                    <span>UwU прогресс</span>
                    <span>{formatPercent((uwu.done / Math.max(1, uwu.total)) * 100)}</span>
                  </div>
                  <Progress value={(uwu.done / Math.max(1, uwu.total)) * 100} height={5} color={uwu.left === 0 ? 'green' : uwu.done / Math.max(1, uwu.total) >= 0.7 ? 'yellow' : 'red'} />
                </div>
              )}
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function GroupsPanel({
  agg,
  uwu,
}: {
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
  uwu: Record<DashboardGroupLabel, DashboardUwuCounts>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {DASHBOARD_ORDER.map(label => (
        <GroupCard key={label} label={label} row={agg[label]} uwu={uwu[label]} />
      ))}
    </div>
  );
}

function ReleaseCard({ item }: { item: ReadinessLaunchSummary }) {
  const label = item.platform === 'android' ? 'Android' : 'iOS';
  const badgeColor = item.pct >= 90 ? 'green' : item.pct >= 70 ? 'yellow' : 'red';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Готовность {label}</CardTitle>
          <CardHint>{item.name || 'Готовностный launch не найден'}</CardHint>
        </div>
        <Badge color={badgeColor as 'green' | 'yellow' | 'red'}>{item.pct}%</Badge>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Progress value={item.pct} height={6} color={item.pct >= 90 ? 'green' : item.pct >= 70 ? 'yellow' : 'red'} />
        <InfoRow label="Всего / Пройдено" value={`${formatNumber(item.total)} / ${formatNumber(item.finished)}`} />
        <InfoRow label="Launch" value={item.id ? `#${item.id}` : '—'} />
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#C4B5FD', textDecoration: 'none' }}>
            Открыть готовностный launch →
          </a>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Ссылка недоступна</span>
        )}
      </CardBody>
    </Card>
  );
}

function AlertsPanel({ alerts, baseUrl }: { alerts: DashboardAlertEntry[]; baseUrl: string }) {
  const [showAll, setShowAll] = useState(false);
  const empty = alerts.filter(alert => alert.total === 0);
  const noPassed = alerts.filter(alert => alert.total > 0 && alert.finished === 0);
  const problematic = [...empty, ...noPassed];
  const ok = alerts.filter(alert => alert.total > 0 && alert.finished > 0);
  const sorted = [...problematic, ...ok];
  const visible = showAll ? sorted : sorted.slice(0, 10);
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Аллерты по launch</CardTitle>
          <CardHint>Пустые launch и launch без пройденных кейсов.</CardHint>
        </div>
        <Badge color={problematic.length ? 'red' : 'green'}>
          {problematic.length} проблемных
        </Badge>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, maxHeight: showAll ? 640 : 420, overflowY: 'auto' }}>
        {!sorted.length && <EmptyState text="Пока проблемных launch не найдено." />}
        {visible.map(alert => {
          const color = alert.total === 0 ? '#F59E0B' : alert.finished === 0 ? '#EF4444' : 'var(--text-3)';
          const text = alert.total === 0 ? 'без кейсов' : alert.finished === 0 ? 'нет пройденных' : 'ok';
          const href = cleanBase ? `${cleanBase}/launch/${alert.id}` : '#';
          const pct = alert.total > 0 ? Math.round((alert.finished / alert.total) * 100) : 0;
          return (
            <div key={alert.id} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--surface-soft-4)', background: 'var(--surface-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none', flex: 1 }}
                >
                  #{alert.id} · {alert.name || 'без названия'}
                </a>
                <span style={{ fontSize: 11, color }}>{text}</span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress value={pct} height={4} color={alert.finished === 0 ? 'red' : pct >= 90 ? 'green' : 'yellow'} style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(alert.finished)} / {formatNumber(alert.total)} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
        {sorted.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAll(prev => !prev)}
            style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#C4B5FD', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
          >
            {showAll ? '↑ Скрыть' : `↓ Показать все ${sorted.length}`}
          </button>
        )}
      </CardBody>
    </Card>
  );
}

function PredictionCard({
  prediction,
  alerts,
  historyPoints,
  uwuLeft,
  customDeadline,
}: {
  prediction: DashboardPrediction | null;
  alerts: { empty: number; noPassed: number };
  historyPoints: number;
  uwuLeft: number;
  customDeadline: string;
}) {
  const badgeColor =
    prediction?.status === 'done' || prediction?.status === 'on_track'
      ? 'green'
      : prediction?.status === 'at_risk'
        ? 'yellow'
        : 'red';

  const badgeLabel =
    prediction?.status === 'done'
      ? 'готово'
      : prediction?.status === 'on_track'
        ? 'в графике'
        : prediction?.status === 'at_risk'
          ? 'есть риск'
          : 'срыв';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Прогноз{customDeadline ? ' (дедлайн вручную)' : ' до вторника 14:00'}</CardTitle>
          <CardHint>ETA ручного прохождения + CatBoost + исторические прогоны по N людям.</CardHint>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {prediction && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                👥 {prediction.peopleCount} чел.
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {prediction.peopleCountSource === 'allure' ? 'из Allure' : prediction.peopleCountSource === 'history' ? 'по истории' : 'по умолчанию'}
              </span>
            </div>
          )}
          <Badge color={badgeColor as 'green' | 'yellow' | 'red'}>
            {prediction ? badgeLabel : 'ожидание'}
          </Badge>
        </div>
      </CardHeader>
      <CardBody style={{ paddingTop: 10 }}>
        {!prediction ? (
          <EmptyState text="Собери dashboard, чтобы посчитать темп и риск прохождения." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <InfoRow
              label="ML риск срыва"
              value={
                <span style={{ color: prediction.risk >= 0.65 ? '#EF4444' : prediction.risk >= 0.4 ? '#F59E0B' : '#22C55E' }}>
                  {Math.round(prediction.risk * 100)}%
                </span>
              }
            />
            <InfoRow label="Ориентировочное окончание ХБ" value={prediction.etaTs ? formatDateTimeMsk(prediction.etaTs) : 'недостаточно истории'} />
            <InfoRow label="Дедлайн" value={formatDateTimeMsk(prediction.deadlineTs)} />
            <InfoRow
              label="Наблюдаемый / прогнозный ручной темп"
              value={`${formatRate(prediction.observedVelocityPerHour)} / ${formatRate(prediction.forecastVelocityPerHour)}`}
            />
            <InfoRow label="Нужный ручной темп ХБ" value={formatRate(prediction.requiredPerHour)} />
            <InfoRow
              label="Остаток ХБ к дедлайну"
              value={
                <span style={{ color: prediction.projectedCriticalRemainingByDeadline > 0 ? '#F59E0B' : '#22C55E' }}>
                  {formatNumber(prediction.projectedCriticalRemainingByDeadline)}
                </span>
              }
            />
            <InfoRow
              label="Остаток Selective к дедлайну"
              value={
                <span style={{ color: prediction.projectedSelectiveRemainingByDeadline > 0 ? '#64748B' : '#22C55E' }}>
                  {formatNumber(prediction.projectedSelectiveRemainingByDeadline)}
                </span>
              }
            />
            <InfoRow label="UwU в хвосте" value={formatNumber(uwuLeft)} />
            <InfoRow label="Пустые / без passed" value={`${alerts.empty} / ${alerts.noPassed}`} />
            <InfoRow label="История срезов / уверенность" value={`${historyPoints} / ${Math.round(prediction.confidence * 100)}%`} />
            <InfoRow label="Движок" value={prediction.engine === 'catboost+operational' ? 'CatBoost + операционные сигналы' : 'Операционный fallback'} />

            {prediction.historicalBaseline.runCount > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <InfoRow
                  label={`Исторический темп (${prediction.historicalBaseline.runCount} прог.)`}
                  value={
                    prediction.historicalVelocityPerHour != null
                      ? <span style={{ color: 'var(--accent)' }}>{formatRate(prediction.historicalVelocityPerHour)}</span>
                      : '—'
                  }
                />
                <InfoRow
                  label={`Темп/чел. (медиана)`}
                  value={
                    prediction.historicalBaseline.medianVpP != null
                      ? `${prediction.historicalBaseline.medianVpP.toFixed(1)} / ч`
                      : '—'
                  }
                />
                {prediction.requiredPeopleForDeadline != null && prediction.requiredPeopleForDeadline > prediction.peopleCount && (
                  <InfoRow
                    label="Нужно людей к дедлайну"
                    value={
                      <span style={{ color: '#F59E0B', fontWeight: 700 }}>
                        ≥ {prediction.requiredPeopleForDeadline} чел.
                        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> (сейчас {prediction.peopleCount})</span>
                      </span>
                    }
                  />
                )}
                {prediction.requiredPeopleForDeadline != null && prediction.requiredPeopleForDeadline <= prediction.peopleCount && (
                  <InfoRow
                    label="Нужно людей к дедлайну"
                    value={<span style={{ color: '#22C55E', fontWeight: 700 }}>достаточно ({prediction.peopleCount} чел.)</span>}
                  />
                )}
              </>
            )}
            {prediction.historicalBaseline.runCount === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
                Исторических прогонов пока нет. После завершения первого регресса система начнёт накапливать статистику темпа по команде.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
              {prediction.reasons.map(reason => (
                <div key={reason} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                  {reason}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RecentRuns({
  launches,
  baseUrl,
}: {
  launches: AllureLaunchResult[];
  baseUrl: string;
}) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  const rows = launches
    .filter(launch => launch.type === 'high_blocker' || launch.type === 'selective' || launch.type === 'regression')
    .sort((left, right) => Number(right.createdDate || 0) - Number(left.createdDate || 0));

  return (
    <div style={{ maxHeight: 420, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
      <Table style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <Th style={{ width: '42%' }}>Лаунч регресса</Th>
            <Th style={{ width: 112 }}>Платформа</Th>
            <Th style={{ width: '26%' }}>Сколько пройдено</Th>
            <Th style={{ width: 110 }}>Статус</Th>
            <Th style={{ width: 120 }}>Создан</Th>
            <Th style={{ width: 92, textAlign: 'right' }}>Allure</Th>
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)', fontSize: 12 }}>
                Сначала собери dashboard по версии.
              </td>
            </tr>
          )}
          {rows.map(launch => {
            const href = cleanBase ? `${cleanBase}/launch/${launch.id}` : '#';
            const progressColor = launch.pct >= 90 ? 'green' : launch.pct >= 70 ? 'yellow' : 'red';
            return (
              <tr key={launch.id}>
                <Td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--text)',
                        fontSize: 13,
                        fontWeight: 700,
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={launch.name}
                    >
                      {compactRegressionLaunchName(launch)}
                    </a>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 22,
                          padding: '0 10px',
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-soft)',
                          color: 'var(--text-2)',
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{launch.id}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={launch.name}
                      >
                        {launch.name}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td>
                  <Badge color={launch.platform === 'android' ? 'green' : launch.platform === 'ios' ? 'blue' : 'gray'}>
                    {launch.platform === 'android' ? 'Android' : launch.platform === 'ios' ? 'iOS' : launch.platform}
                  </Badge>
                </Td>
                <Td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Progress value={launch.pct} height={6} color={progressColor} style={{ flex: 1 }} />
                      <span style={{ minWidth: 38, textAlign: 'right', fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {launch.pct}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatNumber(launch.finished)} / {formatNumber(launch.total)} пройдено
                    </div>
                  </div>
                </Td>
                <Td style={{ fontSize: 12, color: 'var(--text-2)' }}>{formatLaunchStatus(launch.status)}</Td>
                <Td mono style={{ fontSize: 11, color: 'var(--text-2)' }}>{formatRelativeTime(launch.createdDate)}</Td>
                <Td style={{ textAlign: 'right' }}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 600, color: '#C4B5FD', textDecoration: 'none' }}
                  >
                    Открыть
                  </a>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function makeBurndownLabel(ts: number, allTs: number[]): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const span = allTs.length > 1 ? allTs[allTs.length - 1] - allTs[0] : 0;
  if (span > 20 * 3_600_000) {
    const dd = d.getDate().toString().padStart(2, '0');
    const mo = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${dd}.${mo} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function BurndownChart({ history, deadlineTs }: { history: DashboardHistoryPoint[]; deadlineTs: number | null }) {
  const { theme } = useApp();
  const palette = useDashboardChartPalette(theme);
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const cleanHistory = useMemo(() => {
    const baseHistory = (() => {
      if (history.length >= 2) return history;
      const single = history[0];
      if (!single || single.manualFinished <= 0) return history;
      const originTs = Number(single.manualWindowStartTs || 0);
      if (!originTs || originTs >= single.updatedAt) return history;
      return [
        { ...single, updatedAt: originTs, manualFinished: 0, finished: 0 },
        single,
      ];
    })();
    if (baseHistory.length < 2) return baseHistory;
    const result: DashboardHistoryPoint[] = [baseHistory[0]];
    for (let i = 1; i < baseHistory.length; i++) {
      const prev = result[result.length - 1];
      const cur = baseHistory[i];
      const prevMax = Math.max(prev.manualFinished, 1);
      if (cur.manualFinished < prevMax * 0.2 && prevMax > 500) continue;
      result.push(cur);
    }
    return result;
  }, [history]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();

    if (cleanHistory.length < 2) {
      chartRef.current = null;
      return;
    }

    const allTs = cleanHistory.map(p => p.updatedAt);
    const labels = cleanHistory.map(p => makeBurndownLabel(p.updatedAt, allTs));
    const finishedData = cleanHistory.map(p => p.manualFinished);
    const totalRef = cleanHistory[cleanHistory.length - 1]?.total || 0;

    const forecastLabels = [...labels];
    // Начинаем прогноз с последней реальной точки чтобы не было разрыва на графике
    const forecastData: (number | null)[] = cleanHistory.map(() => null);
    forecastData[cleanHistory.length - 1] = cleanHistory[cleanHistory.length - 1].manualFinished;

    if (deadlineTs && cleanHistory.length >= 2) {
      const last = cleanHistory[cleanHistory.length - 1];
      // Берём пары с интервалом >= 1ч (тот же фильтр что в releasePrediction)
      let totalDelta = 0;
      let totalHours = 0;
      for (let i = 1; i < cleanHistory.length; i++) {
        const dtH = (cleanHistory[i].updatedAt - cleanHistory[i - 1].updatedAt) / 3_600_000;
        if (dtH >= 1.0) {
          totalDelta += Math.max(0, cleanHistory[i].manualFinished - cleanHistory[i - 1].manualFinished);
          totalHours += dtH;
        }
      }
      const velocity = totalHours > 0 ? totalDelta / totalHours : 0;
      const hoursLeft = (deadlineTs - last.updatedAt) / 3_600_000;
      if (velocity > 0 && hoursLeft > 0 && hoursLeft < 200) {
        const steps = Math.min(Math.ceil(hoursLeft), 10);
        const allForecastTs = [last.updatedAt];
        for (let i = 1; i <= steps; i++) {
          allForecastTs.push(last.updatedAt + i * (hoursLeft / steps) * 3_600_000);
        }
        const spanTs = [...allTs, ...allForecastTs];
        for (let i = 1; i <= steps; i++) {
          const ts = allForecastTs[i];
          forecastLabels.push(makeBurndownLabel(ts, spanTs));
          forecastData.push(Math.min(totalRef, Math.round(last.manualFinished + velocity * (hoursLeft / steps) * i)));
        }
      }
    }

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: forecastLabels,
        datasets: [
          {
            label: 'Пройдено',
            data: finishedData,
            borderColor: '#22C55E',
            backgroundColor: 'rgba(34,197,94,.10)',
            borderWidth: 2.5,
            fill: true,
            cubicInterpolationMode: 'monotone',
            tension: 0,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#22C55E',
            pointBorderColor: palette.surface,
            pointBorderWidth: 2,
          },
          {
            label: 'Прогноз',
            data: forecastData,
            borderColor: '#C4B5FD',
            backgroundColor: 'rgba(196,181,253,.06)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            fill: false,
            cubicInterpolationMode: 'monotone',
            tension: 0,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#C4B5FD',
            pointBorderColor: palette.surface,
            pointBorderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: palette.textSoft, usePointStyle: true, pointStyle: 'circle', font: { size: 11 }, padding: 14 },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: theme === 'dark' ? 'rgba(15,23,42,.96)' : 'rgba(255,255,255,.98)',
            titleColor: theme === 'dark' ? '#F8FAFC' : '#0F172A',
            bodyColor: theme === 'dark' ? '#CBD5E1' : '#475569',
            borderColor: palette.border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex;
                if (idx == null || idx >= cleanHistory.length) return items[0]?.label ?? '';
                const ts = cleanHistory[idx]?.updatedAt;
                if (!ts) return items[0]?.label ?? '';
                return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts);
              },
              label: (ctx) => {
                const v = Number(ctx.raw ?? 0);
                const total = cleanHistory[cleanHistory.length - 1]?.total || 0;
                const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                if (ctx.datasetIndex === 0) return `  Пройдено: ${v.toLocaleString('ru-RU')} (${pct}%)`;
                return `  Прогноз: ${v.toLocaleString('ru-RU')} (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: palette.textSoft, font: { size: 10 }, maxRotation: 30, maxTicksLimit: 10 },
            border: { color: palette.grid },
          },
          y: {
            beginAtZero: true,
            min: 0,
            grid: { color: palette.grid },
            ticks: {
              color: palette.textSoft,
              font: { size: 10 },
              callback: (val) => Number(val).toLocaleString('ru-RU'),
            },
            border: { color: palette.grid },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [cleanHistory, deadlineTs, palette, theme]);

  if (cleanHistory.length < 2) {
    return <EmptyState text="Нужно минимум 2 среза для отображения burndown-графика." />;
  }

  const droppedCount = history.length - cleanHistory.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ position: 'relative', height: 240 }}>
        <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </div>
      {droppedCount > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>
          * {droppedCount} аномальных среза скрыты (сброс данных)
        </div>
      )}
    </div>
  );
}

function BlockerBanner({ agg }: { agg: Record<DashboardGroupLabel, DashboardGroupCounts> }) {
  const criticalLabels = DASHBOARD_ORDER.filter(label => label.includes('[High/Blocker]'));
  const criticalTotal = criticalLabels.reduce((sum, label) => sum + Number(agg[label]?.total || 0), 0);
  const criticalFinished = criticalLabels.reduce((sum, label) => sum + Number(agg[label]?.finished || 0), 0);
  const criticalRemaining = Math.max(0, criticalTotal - criticalFinished);
  const pct = criticalTotal > 0 ? Math.round((criticalFinished / criticalTotal) * 100) : 100;

  if (criticalRemaining === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)' }}>
        <span style={{ fontSize: 18 }}>✓</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#22C55E' }}>Все High/Blocker пройдены</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Пройдено {formatNumber(criticalFinished)} из {formatNumber(criticalTotal)}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚠</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>
            Критический путь не закрыт — осталось {formatNumber(criticalRemaining)} High/Blocker
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            Пройдено {formatNumber(criticalFinished)} из {formatNumber(criticalTotal)} ({pct}%)
          </div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#F87171', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>
      <Progress value={pct} height={6} color="red" />
    </div>
  );
}

function ReadinessComparison({
  readiness,
  agg,
}: {
  readiness: ReadinessLaunchSummary[];
  agg: Record<DashboardGroupLabel, DashboardGroupCounts>;
}) {
  const android = readiness.find(item => item.platform === 'android');
  const ios = readiness.find(item => item.platform === 'ios');

  const androidLabels = DASHBOARD_ORDER.filter(l => l.includes('[Android]'));
  const iosLabels = DASHBOARD_ORDER.filter(l => l.includes('[iOS]'));

  const aggAndroid = {
    total: androidLabels.reduce((s, l) => s + (agg[l]?.total || 0), 0),
    finished: androidLabels.reduce((s, l) => s + (agg[l]?.finished || 0), 0),
    remaining: androidLabels.reduce((s, l) => s + (agg[l]?.remaining_total || 0), 0),
    inProgress: androidLabels.reduce((s, l) => s + (agg[l]?.in_progress || 0), 0),
    assigned: androidLabels.reduce((s, l) => s + (agg[l]?.remaining || 0), 0),
    criticalTotal: DASHBOARD_ORDER.filter(l => l.includes('[Android]') && l.includes('[High/Blocker]')).reduce((s, l) => s + (agg[l]?.total || 0), 0),
    criticalFinished: DASHBOARD_ORDER.filter(l => l.includes('[Android]') && l.includes('[High/Blocker]')).reduce((s, l) => s + (agg[l]?.finished || 0), 0),
    selectiveTotal: DASHBOARD_ORDER.filter(l => l.includes('[Android]') && l.includes('[Selective]')).reduce((s, l) => s + (agg[l]?.total || 0), 0),
    selectiveFinished: DASHBOARD_ORDER.filter(l => l.includes('[Android]') && l.includes('[Selective]')).reduce((s, l) => s + (agg[l]?.finished || 0), 0),
  };
  const aggIos = {
    total: iosLabels.reduce((s, l) => s + (agg[l]?.total || 0), 0),
    finished: iosLabels.reduce((s, l) => s + (agg[l]?.finished || 0), 0),
    remaining: iosLabels.reduce((s, l) => s + (agg[l]?.remaining_total || 0), 0),
    inProgress: iosLabels.reduce((s, l) => s + (agg[l]?.in_progress || 0), 0),
    assigned: iosLabels.reduce((s, l) => s + (agg[l]?.remaining || 0), 0),
    criticalTotal: DASHBOARD_ORDER.filter(l => l.includes('[iOS]') && l.includes('[High/Blocker]')).reduce((s, l) => s + (agg[l]?.total || 0), 0),
    criticalFinished: DASHBOARD_ORDER.filter(l => l.includes('[iOS]') && l.includes('[High/Blocker]')).reduce((s, l) => s + (agg[l]?.finished || 0), 0),
    selectiveTotal: DASHBOARD_ORDER.filter(l => l.includes('[iOS]') && l.includes('[Selective]')).reduce((s, l) => s + (agg[l]?.total || 0), 0),
    selectiveFinished: DASHBOARD_ORDER.filter(l => l.includes('[iOS]') && l.includes('[Selective]')).reduce((s, l) => s + (agg[l]?.finished || 0), 0),
  };

  const hasData = aggAndroid.total > 0 || aggIos.total > 0;

  if (!hasData) {
    return (
      <Card>
        <CardHeader><div><CardTitle>Сравнение платформ</CardTitle><CardHint>Android vs iOS — детальная разбивка по группам.</CardHint></div></CardHeader>
        <CardBody><EmptyState text="Нет данных. Сначала собери dashboard." /></CardBody>
      </Card>
    );
  }

  const platforms: { label: string; ready: ReadinessLaunchSummary | undefined; agg: typeof aggAndroid }[] = [
    { label: 'Android', ready: android, agg: aggAndroid },
    { label: 'iOS', ready: ios, agg: aggIos },
  ];

  const rows: { label: string; getValue: (p: typeof platforms[0]) => { value: string; color?: string } }[] = [
    {
      label: 'Готовностный launch',
      getValue: p => {
        const pct = p.ready?.pct ?? 0;
        return { value: p.ready ? `${pct}%` : 'нет', color: pct >= 90 ? '#22C55E' : pct >= 70 ? '#F59E0B' : '#EF4444' };
      },
    },
    {
      label: 'Всего кейсов (memberstats)',
      getValue: p => ({ value: formatNumber(p.agg.total) }),
    },
    {
      label: 'Пройдено',
      getValue: p => ({
        value: `${formatNumber(p.agg.finished)} (${p.agg.total > 0 ? Math.round(p.agg.finished / p.agg.total * 100) : 0}%)`,
        color: '#22C55E',
      }),
    },
    {
      label: 'Осталось',
      getValue: p => ({
        value: formatNumber(p.agg.remaining),
        color: p.agg.remaining > 0 ? '#F59E0B' : '#22C55E',
      }),
    },
    {
      label: 'В работе / назначено',
      getValue: p => ({ value: `${formatNumber(p.agg.inProgress)} / ${formatNumber(p.agg.assigned)}` }),
    },
    {
      label: 'High/Blocker пройдено',
      getValue: p => ({
        value: `${formatNumber(p.agg.criticalFinished)} / ${formatNumber(p.agg.criticalTotal)}`,
        color: p.agg.criticalFinished >= p.agg.criticalTotal && p.agg.criticalTotal > 0 ? '#22C55E' : '#F59E0B',
      }),
    },
    {
      label: 'Selective пройдено',
      getValue: p => ({
        value: `${formatNumber(p.agg.selectiveFinished)} / ${formatNumber(p.agg.selectiveTotal)}`,
        color: 'var(--text)',
      }),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Сравнение платформ</CardTitle>
          <CardHint>Android vs iOS — готовность, прогресс по группам и критический путь.</CardHint>
        </div>
      </CardHeader>
      <CardBody style={{ paddingTop: 10 }}>
        {/* Platform summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          {platforms.map(p => {
            const pct = p.agg.total > 0 ? Math.round(p.agg.finished / p.agg.total * 100) : 0;
            const readyPct = p.ready?.pct ?? 0;
            const statusColor = pct >= 90 ? '#22C55E' : pct >= 70 ? '#F59E0B' : '#EF4444';
            return (
              <div key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.label}</div>
                    {p.ready && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{p.ready.name || 'Готовностный launch'}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: statusColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
                    {p.ready && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>launch: {readyPct}%</div>}
                  </div>
                </div>
                <Progress value={pct} height={7} color={pct >= 90 ? 'green' : pct >= 70 ? 'yellow' : 'red'} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Пройдено', value: formatNumber(p.agg.finished), color: '#22C55E' },
                    { label: 'Осталось', value: formatNumber(p.agg.remaining), color: '#F59E0B' },
                    { label: 'Всего', value: formatNumber(p.agg.total), color: 'var(--text-2)' },
                  ].map(stat => (
                    <div key={stat.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--surface-soft)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
                {/* Critical path mini indicator */}
                {p.agg.criticalTotal > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)' }}>
                      <span>High/Blocker</span>
                      <span style={{ color: p.agg.criticalFinished >= p.agg.criticalTotal ? '#22C55E' : '#F59E0B' }}>
                        {formatNumber(p.agg.criticalFinished)} / {formatNumber(p.agg.criticalTotal)}
                        {' '}({Math.round(p.agg.criticalFinished / p.agg.criticalTotal * 100)}%)
                      </span>
                    </div>
                    <Progress
                      value={Math.round(p.agg.criticalFinished / p.agg.criticalTotal * 100)}
                      height={4}
                      color={p.agg.criticalFinished >= p.agg.criticalTotal ? 'green' : 'yellow'}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Detail table */}
        <Table>
          <thead>
            <tr>
              <Th>Показатель</Th>
              <Th>Android</Th>
              <Th>iOS</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label}>
                <Td style={{ fontSize: 12, color: 'var(--text-2)' }}>{row.label}</Td>
                {platforms.map(p => {
                  const cell = row.getValue(p);
                  return (
                    <Td key={p.label} style={{ fontSize: 12, color: cell.color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                      {cell.value}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}

function HistoryTable({ history }: { history: DashboardHistoryPoint[] }) {
  if (!history.length) {
    return (
      <Card>
        <CardHeader><div><CardTitle>История срезов</CardTitle><CardHint>Срезы сохраняются автоматически при каждом сборе dashboard.</CardHint></div></CardHeader>
        <CardBody><EmptyState text="Ещё нет сохранённых срезов по этой версии." /></CardBody>
      </Card>
    );
  }

  const sorted = [...history].reverse();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>История срезов</CardTitle>
          <CardHint>Срезы сохраняются автоматически при каждом сборе dashboard.</CardHint>
        </div>
        <Badge color="blue">{history.length} срезов</Badge>
      </CardHeader>
      <CardBody style={{ paddingTop: 8, overflowX: 'auto' }}>
        <Table style={{ tableLayout: 'fixed', minWidth: 720 }}>
          <thead>
            <tr>
              <Th style={{ width: 130 }}>Время</Th>
              <Th style={{ width: 80 }}>Всего</Th>
              <Th style={{ width: 90 }}>Пройдено</Th>
              <Th style={{ width: 85 }}>%</Th>
              <Th style={{ width: 85 }}>Осталось</Th>
              <Th style={{ width: 90 }}>HighBlock</Th>
              <Th style={{ width: 90 }}>Selective</Th>
              <Th style={{ width: 80 }}>Лаунчи</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((point, idx) => {
              const prev = sorted[idx + 1];
              const pct = point.total > 0 ? Math.round((point.finished / point.total) * 100) : 0;
              const deltaPct = prev && prev.total > 0 ? pct - Math.round((prev.finished / prev.total) * 100) : null;
              return (
                <tr key={point.updatedAt}>
                  <Td mono style={{ fontSize: 11 }}>{formatDateTime(point.updatedAt)}</Td>
                  <Td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.total)}</Td>
                  <Td style={{ fontSize: 12, color: '#22C55E', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.finished)}</Td>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Progress value={pct} height={4} color={pct >= 90 ? 'green' : pct >= 70 ? 'yellow' : 'red'} style={{ width: 44 }} />
                      <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>
                        {pct}%
                        {deltaPct != null && deltaPct !== 0 && (
                          <span style={{ marginLeft: 4, color: deltaPct > 0 ? '#22C55E' : '#EF4444', fontSize: 10 }}>
                            {deltaPct > 0 ? `+${deltaPct}` : deltaPct}
                          </span>
                        )}
                      </span>
                    </div>
                  </Td>
                  <Td style={{ fontSize: 12, color: '#F59E0B', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.remaining)}</Td>
                  <Td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.criticalFinished)} / {formatNumber(point.criticalTotal)}</Td>
                  <Td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.selectiveFinished)} / {formatNumber(point.selectiveTotal)}</Td>
                  <Td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(point.launches)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}

export function Dashboard() {
  const { settings } = useSettings();
  const [version, setVersion] = useState('7.3.5420');
  const [launches, setLaunches] = useState<AllureLaunchResult[]>([]);
  const [agg, setAgg] = useState<Record<DashboardGroupLabel, DashboardGroupCounts>>(createEmptyAgg);
  const [uwu, setUwu] = useState<Record<DashboardGroupLabel, DashboardUwuCounts>>(createEmptyUwuAgg);
  const [readiness, setReadiness] = useState<ReadinessLaunchSummary[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlertEntry[]>([]);
  const [history, setHistory] = useState<DashboardHistoryPoint[]>(() => readHistory('7.3.5420'));
  const [prediction, setPrediction] = useState<DashboardPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedPct, setLoadedPct] = useState(0);
  const [displayPct, setDisplayPct] = useState(0);
  const [loadingStep, setLoadingStep] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const loadStartRef = useRef(0);
  const [error, setError] = useState('');
  const [previousSnapshot, setPreviousSnapshot] = useState<DashboardHistoryPoint | null>(() => readSnapshot('7.3.5420'));
  const [showBlockerBanner, setShowBlockerBanner] = useState(false);
  const [customDeadline, setCustomDeadline] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(600);
  const abortRef = useRef<AbortController | null>(null);
  const didAutoLoadRef = useRef(false);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const summary = useMemo(() => {
    return DASHBOARD_ORDER.reduce((acc, label) => {
      const row = agg[label];
      acc.total += Number(row.total || 0);
      acc.finished += Number(row.finished || 0);
      acc.remaining += Number(row.remaining_total || 0);
      acc.assigned += Number(row.remaining || 0);
      acc.inProgress += Number(row.in_progress || 0);
      return acc;
    }, {
      total: 0,
      finished: 0,
      remaining: 0,
      assigned: 0,
      inProgress: 0,
    });
  }, [agg]);

  const load = useCallback(async () => {
    if (!settings.allureBase || !settings.projectId || !settings.allureToken) {
      setError('Заполни Allure Base, Project ID и API токен в настройках.');
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setLoadedPct(5);
    setDisplayPct(0);
    setLoadingStep('Инициализация запроса…');
    setError('');

    try {
      const cfg = {
        base: settings.allureBase,
        token: settings.allureToken,
        projectId: settings.projectId,
        signal: abortRef.current.signal,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
      };

      setLoadingStep('Читаем предыдущий срез…');
      const prev = readSnapshot(version);
      setPreviousSnapshot(prev);
      setLoadedPct(12);

       const cachedDashboard = readCachedDashboardAggregate(version);
       const cachedReadiness = readCachedDashboardReadiness(version);
       const customDeadlineTs = customDeadline ? parseMoscowDateTimeLocal(customDeadline) : undefined;

       if (cachedDashboard) {
         setLaunches(cachedDashboard.launches);
         setAgg(cachedDashboard.agg);
         setUwu(cachedDashboard.uwu);
         setAlerts(cachedDashboard.alerts);
         if (cachedReadiness.length) {
           setReadiness(cachedReadiness);
         }
         setLoadedPct(18);
         setLoadingStep('Показываем кэшированный срез, обновляем данные…');

         if (cachedReadiness.length) {
           void buildDashboardPrediction({
             version,
             agg: cachedDashboard.agg,
             uwu: cachedDashboard.uwu,
             readiness: cachedReadiness,
             alerts: cachedDashboard.alerts,
             history: readHistory(version),
             nowTs: Date.now(),
             customDeadlineTs: customDeadlineTs && Number.isFinite(customDeadlineTs) ? customDeadlineTs : undefined,
             activePeopleCount: cachedDashboard.activePeopleCount,
             activePeopleLogins: cachedDashboard.activePeopleLogins,
             manualTimedFinished: cachedDashboard.manualTimedFinished,
             manualWindowStartTs: cachedDashboard.manualWindowStartTs,
             manualWindowStopTs: cachedDashboard.manualWindowStopTs,
             gasConfig: { gasUrl: settings.gasUrl, proxyBase: settings.proxyBase, useProxy: settings.useProxy },
             launchCreatedTs: cachedDashboard.launchCreatedTs ?? undefined,
           }).then(nextPrediction => {
             setPrediction(nextPrediction);
           }).catch(() => {
             /* ignore stale cached prediction failures */
           });
         }
       } else {
         setPrediction(null);
       }

      setLoadingStep('Загружаем данные Allure (статусы, memberstats)…');
      const [dashboardData, readinessData] = await Promise.all([
        fetchDashboardAggregate(cfg, version).then(data => {
          setLoadedPct(62);
          setLoadingStep('Загружаем готовностный launch…');
          return data;
        }),
        fetchReadinessSummary(cfg, version),
      ]) as [DashboardAggregateResult, ReadinessLaunchSummary[]];

      setLoadedPct(76);
      setLoadingStep('Обрабатываем агрегат…');
      setLaunches(dashboardData.launches);
      setAgg(dashboardData.agg);
      setUwu(dashboardData.uwu);
      setAlerts(dashboardData.alerts);
      setReadiness(readinessData);
      writeCachedDashboardReadiness(version, readinessData);

      setLoadedPct(84);
      setLoadingStep('Сохраняем срез в историю…');
      const snapshotTs = Date.now();
      const nextSnapshot = buildHistorySnapshot(
        version,
        dashboardData.launches.length,
        dashboardData.agg,
        dashboardData.uwu,
        readinessData,
        dashboardData.alerts,
        snapshotTs,
        dashboardData.activePeopleCount,
        dashboardData.activePeopleLogins,
        dashboardData.manualTimedFinished,
        dashboardData.manualWindowStartTs,
        dashboardData.manualWindowStopTs,
      );
      const nextHistory = writeSnapshot(nextSnapshot);
      setHistory(nextHistory);
      setLoadedPct(90);

      setLoadingStep('Считаем ML-прогноз (CatBoost)…');

      try {
        const nextPrediction = await buildDashboardPrediction({
          version,
          agg: dashboardData.agg,
          uwu: dashboardData.uwu,
          readiness: readinessData,
          alerts: dashboardData.alerts,
          history: nextHistory,
          nowTs: snapshotTs,
          customDeadlineTs: customDeadlineTs && Number.isFinite(customDeadlineTs) ? customDeadlineTs : undefined,
          activePeopleCount: dashboardData.activePeopleCount,
          activePeopleLogins: dashboardData.activePeopleLogins,
          manualTimedFinished: dashboardData.manualTimedFinished,
          manualWindowStartTs: dashboardData.manualWindowStartTs,
          manualWindowStopTs: dashboardData.manualWindowStopTs,
          gasConfig: { gasUrl: settings.gasUrl, proxyBase: settings.proxyBase, useProxy: settings.useProxy },
          launchCreatedTs: dashboardData.launchCreatedTs ?? undefined,
        });
        setPrediction(nextPrediction);
      } catch {
        setPrediction(null);
      }

      setLoadedPct(100);
      setLoadingStep('Готово');
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') {
        setError((loadError as Error).message || 'Не удалось собрать dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }, [settings, version, customDeadline]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setHistory(readHistory(version));
    setPreviousSnapshot(readSnapshot(version));
  }, [version]);

  useEffect(() => {
    if (didAutoLoadRef.current) return;
    if (!settings.allureBase || !settings.projectId || !settings.allureToken) return;
    didAutoLoadRef.current = true;
    void loadRef.current();
  }, [settings.allureBase, settings.allureToken, settings.projectId]);

  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
    if (!autoRefresh) { setAutoRefreshCountdown(600); return; }
    setAutoRefreshCountdown(600);
    autoRefreshTimerRef.current = setInterval(() => {
      setAutoRefreshCountdown(prev => {
        if (prev <= 1) { void loadRef.current(); return 600; }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, [autoRefresh]);

  const loadedPctRef = useRef(loadedPct);
  useEffect(() => { loadedPctRef.current = loadedPct; }, [loadedPct]);

  useEffect(() => {
    if (!loading) {
      setDisplayPct(100);
      return;
    }
    setDisplayPct(0);
    const tick = setInterval(() => {
      setDisplayPct(prev => {
        const real = loadedPctRef.current;
        if (prev < real) {
          // Быстро догоняем реальное значение
          const diff = real - prev;
          return Math.min(real, prev + Math.max(diff * 0.25, 2));
        }
        // Медленный бесконечный дрип — никогда не останавливаемся, не доходим до 95
        // 0.01% каждые 80мс = ~0.75%/мин, на 10 минут добавит ~7.5%
        return Math.min(94, prev + 0.01);
      });
    }, 80);
    return () => clearInterval(tick);
  }, [loading]);

  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    loadStartRef.current = Date.now();
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - loadStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [loading]);

  const emptyAlerts = alerts.filter(item => item.total === 0).length;
  const noPassedAlerts = alerts.filter(item => item.total > 0 && item.finished === 0).length;
  const uwuSummary = useMemo(() => {
    return DASHBOARD_ORDER
      .filter(label => label.includes('[High/Blocker]'))
      .reduce((acc, label) => {
        acc.total += Number(uwu[label]?.total || 0);
        acc.done += Number(uwu[label]?.done || 0);
        acc.left += Number(uwu[label]?.left || 0);
        return acc;
      }, { total: 0, done: 0, left: 0 });
  }, [uwu]);

  const overallPct = summary.total > 0 ? Math.round((summary.finished / summary.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.3px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⬡</div>
            Dashboard
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Реальная агрегация по Allure stats/memberstats и readiness launch для версии {version}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <FieldLabel>Версия релиза</FieldLabel>
            <Input value={version} onChange={event => setVersion(event.target.value)} placeholder="7.3.5420" style={{ width: 150 }} />
          </div>
          <div>
            <FieldLabel>Дедлайн (вручную, МСК)</FieldLabel>
            <Input
              type="datetime-local"
              value={customDeadline}
              onChange={event => setCustomDeadline(event.target.value)}
              style={{ width: 200 }}
            />
          </div>
          <Button variant="primary" onClick={load} disabled={loading}>
            {loading ? `${Math.round(displayPct)}% — ${elapsed}с` : '⟳ Собрать dashboard'}
          </Button>
        </div>
      </div>

      {/* C1: Loading progress */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Progress bar block */}
          <div style={{ padding: '16px 18px', borderRadius: 16, border: '1px solid var(--border)', background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '3px solid transparent',
                  borderTopColor: '#9B5CFF',
                  borderRightColor: '#9B5CFF',
                  animation: 'spin 0.9s linear infinite',
                  flexShrink: 0,
                }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Сбор данных…</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{loadingStep}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#9B5CFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {Math.round(displayPct)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {elapsed < 60 ? `${elapsed} с` : `${Math.floor(elapsed / 60)} мин ${elapsed % 60} с`}
                </div>
              </div>
            </div>
            <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${displayPct}%`,
                borderRadius: 999,
                background: 'linear-gradient(90deg, #7C3AED, #9B5CFF, #C4B5FD)',
                transition: 'width 0.08s linear',
              }} />
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%', width: '60%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }} />
            </div>
            {/* Steps */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {[
                { label: 'Снепшот', from: 0, to: 15 },
                { label: 'Allure API', from: 15, to: 62 },
                { label: 'Readiness', from: 62, to: 76 },
                { label: 'История', from: 76, to: 90 },
                { label: 'ML', from: 90, to: 100 },
              ].map(step => {
                const done = loadedPct > step.to;
                const active = loadedPct >= step.from && loadedPct <= step.to && !done;
                return (
                  <div key={step.label} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                    borderRadius: 999,
                    border: `1px solid ${done ? 'rgba(34,197,94,.3)' : active ? 'rgba(155,92,255,.4)' : 'var(--border)'}`,
                    background: done ? 'rgba(34,197,94,.08)' : active ? 'rgba(155,92,255,.1)' : 'transparent',
                    fontSize: 11, fontWeight: 600,
                    color: done ? '#22C55E' : active ? '#C4B5FD' : 'var(--text-3)',
                    transition: 'all .3s',
                  }}>
                    {done ? '✓' : active ? '·' : '○'}
                    {step.label}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Skeleton cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[0, 1, 2, 3].map(idx => (
              <div key={idx} style={{
                height: 88, borderRadius: 18,
                background: `linear-gradient(90deg, var(--surface-soft) 25%, var(--border) 50%, var(--surface-soft) 75%)`,
                backgroundSize: '200% 100%',
                animation: `shimmer 1.6s ease-in-out infinite`,
                animationDelay: `${idx * 0.15}s`,
                border: '1px solid var(--border)',
              }} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#F87171' }}>
          {error}
        </div>
      )}

      {/* B1: Auto-refresh toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#9B5CFF', cursor: 'pointer' }}
          />
          Авто-обновление (10 мин)
          {autoRefresh && (
            <span style={{ fontSize: 11, color: '#C4B5FD', fontVariantNumeric: 'tabular-nums' }}>
              · через {Math.floor(autoRefreshCountdown / 60)}:{String(autoRefreshCountdown % 60).padStart(2, '0')}
            </span>
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showBlockerBanner}
            onChange={e => setShowBlockerBanner(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#EF4444', cursor: 'pointer' }}
          />
          Показать баннер критического пути
        </label>
      </div>

      {/* A2: Critical blocker banner — shown only if checkbox active */}
      {showBlockerBanner && summary.total > 0 && <BlockerBanner agg={agg} />}

      {/* Metric cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <MetricCard label="Всего кейсов" value={formatNumber(summary.total)} delta={formatDelta(summary.total, previousSnapshot?.total)} sub="Σ по Critical + Selective" />
          <MetricCard
            label="Пройдено"
            value={
              summary.total > 0
                ? `${formatNumber(summary.finished)} · ${overallPct}%`
                : formatNumber(summary.finished)
            }
            delta={formatDelta(summary.finished, previousSnapshot?.finished)}
            color="#22C55E"
            sub="exact launch statistic"
          />
          <MetricCard label="Осталось" value={formatNumber(summary.remaining)} delta={formatDelta(summary.remaining, previousSnapshot?.remaining)} color="#F59E0B" sub={`назначено ${formatNumber(summary.assigned)} · в работе ${formatNumber(summary.inProgress)}`} />
          <MetricCard label="Лаунчи" value={formatNumber(launches.length)} delta={formatDelta(launches.length, previousSnapshot?.launches)} color="#9B5CFF" sub={`прошлый срез: ${formatRelativeTime(previousSnapshot?.updatedAt)}`} />
        </div>
      )}

      {/* Overall progress bar */}
      {!loading && summary.total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)' }}>
            <span>Общий прогресс</span>
            <span style={{ fontWeight: 700, color: overallPct >= 90 ? '#22C55E' : overallPct >= 70 ? '#F59E0B' : '#EF4444' }}>
              {formatNumber(summary.finished)} / {formatNumber(summary.total)} — {overallPct}%
            </span>
          </div>
          <Progress value={overallPct} height={8} color={overallPct >= 90 ? 'green' : overallPct >= 70 ? 'yellow' : 'red'} />
        </div>
      )}

      {/* A1: Burndown chart */}
      {history.length >= 1 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Burndown / прогресс по времени</CardTitle>
              <CardHint>Фактическое прохождение + линейный прогноз до дедлайна.</CardHint>
            </div>
            <Badge color="blue">{history.length} срезов</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            <BurndownChart history={history} deadlineTs={prediction?.deadlineTs ?? null} />
          </CardBody>
        </Card>
      )}

      {/* Bar chart + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 12 }}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Сводный барчарт</CardTitle>
              <CardHint>Exact status + memberstats по `[platform][kind]`.</CardHint>
            </div>
            <Badge color="blue">{DASHBOARD_ORDER.length} группы</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            <SummaryBarChart agg={agg} />
          </CardBody>
        </Card>

        <AlertsPanel alerts={alerts} baseUrl={settings.allureBase} />
      </div>

      {/* Groups + Prediction */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Детализация по 4 группам</CardTitle>
              <CardHint>Бублики, реальные counts и UwU там, где считается в legacy.</CardHint>
            </div>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            <GroupsPanel agg={agg} uwu={uwu} />
          </CardBody>
        </Card>

        <PredictionCard
          prediction={prediction}
          alerts={{ empty: emptyAlerts, noPassed: noPassedAlerts }}
          historyPoints={history.length}
          uwuLeft={uwuSummary.left}
          customDeadline={customDeadline}
        />
      </div>

      {/* Release readiness cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ReleaseCard item={readiness.find(item => item.platform === 'android') || { platform: 'android', id: null, name: '', total: 0, finished: 0, pct: 0, url: null }} />
        <ReleaseCard item={readiness.find(item => item.platform === 'ios') || { platform: 'ios', id: null, name: '', total: 0, finished: 0, pct: 0, url: null }} />
      </div>

      {/* Recent runs */}
      <Card>
        <CardHeader style={{ paddingBottom: 12 }}>
          <div>
            <CardTitle>Лаунчи регресса</CardTitle>
            <CardHint>Stream + тип High/Blocker или Selective, с прогрессом и переходом в Allure.</CardHint>
          </div>
        </CardHeader>
        {launches.length ? (
          <RecentRuns launches={launches} baseUrl={settings.allureBase} />
        ) : (
          <EmptyState text="Собери dashboard, чтобы увидеть релевантные launch." />
        )}
      </Card>

      {/* B3: Platform readiness comparison — bottom */}
      <ReadinessComparison readiness={readiness} agg={agg} />

      {/* C3: History snapshots table — bottom */}
      <HistoryTable history={history} />

    </div>
  );
}
