import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CanonicalTable,
  ColumnFilterDropdown,
  ColumnVisibilityDropdown,
  type CanonicalTableColumn,
  Input,
  LogView,
  Progress,
  SegmentControl,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import {
  collectQuarterReleaseAnalysis,
  compareRelease,
  platformLabel,
  type LogLevel,
  type PlatformKey,
  type QuarterAnalysisRow,
} from '../../services/releasePages';
import { loadQuarterAnalysisRows, saveQuarterAnalysisRows } from '../../services/releaseQuarterSupabase';
import type { Role } from '../../types';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const QUARTER_MONTHS: Record<number, number[]> = {
  1: [0, 1, 2],
  2: [3, 4, 5],
  3: [6, 7, 8],
  4: [9, 10, 11],
};
const SHOW_RELEASE_ANALYSIS_FLOATING_LOGS = true;
const MAJOR_RELEASE_STORAGE_KEY = 'rp_release_quarter_major_release';
const MAJOR_RELEASE_RANGE_TO_STORAGE_KEY = 'rp_release_quarter_major_release_to';
const COLUMN_VISIBILITY_STORAGE_KEY = 'rp_release_quarter_visible_columns';
const COLUMN_WIDTHS_STORAGE_KEY = 'rp_release_quarter_column_widths';
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_YEAR_VALUE = String(CURRENT_YEAR);
const RELEASE_ANALYSIS_COLUMN_OPTIONS = [
  { id: 'version', label: 'Версия' },
  { id: 'stream', label: 'Стрим' },
  { id: 'substream', label: 'Сабстрим' },
  { id: 'primaryTask', label: 'Локомотивная задача' },
  { id: 'secondaryTasks', label: 'Вторичные задачи' },
  { id: 'buildTime', label: 'Время сборки' },
  { id: 'previousRolloutPercent', label: '% раскатки предыдущей версии' },
  { id: 'plannedHotfixDate', label: 'План дата отправки ХФ' },
  { id: 'branchCutTime', label: 'Время отведения ХФ' },
  { id: 'actualSendTime', label: 'Фактическая дата отправки' },
  { id: 'onePercentDate', label: 'Дата раскатки на 1%' },
  { id: 'hotfixReason', label: 'Причина ХФ' },
  { id: 'hotfixDetails', label: 'Детали ХФ' },
];
const DEFAULT_VISIBLE_COLUMN_IDS = RELEASE_ANALYSIS_COLUMN_OPTIONS.map(column => column.id);

interface ReleaseQuarterAnalysisProps {
  role?: Role;
}

type ColumnFilterKey = 'version' | 'stream' | 'substream';
type ColumnFilters = Record<ColumnFilterKey, string[]>;
type AnalysisTab = 'table' | 'charts';

interface ChartDatum {
  label: string;
  value: number;
}

function dash(value: unknown) {
  const text = String(value || '').trim();
  return text || '-';
}

function readStoredRelease(key: string, fallback: string) {
  try {
    return String(localStorage.getItem(key) || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

function sanitizeVisibleColumnIds(value: string[]) {
  const selected = new Set(value);
  return DEFAULT_VISIBLE_COLUMN_IDS.filter(id => selected.has(id));
}

function readStoredVisibleColumnIds() {
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMN_IDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMN_IDS;
    return sanitizeVisibleColumnIds(parsed.map(String));
  } catch {
    return DEFAULT_VISIBLE_COLUMN_IDS;
  }
}

function ToolbarIcon({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </span>
  );
}

function AndroidIcon() {
  return (
    <ToolbarIcon>
      <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true">
        <path d="M5.2 6.8h7.6v5.7a1.4 1.4 0 0 1-1.4 1.4H6.6a1.4 1.4 0 0 1-1.4-1.4V6.8Z" fill="currentColor" opacity=".92" />
        <path d="M5 5.8c.45-1.55 1.95-2.7 4-2.7s3.55 1.15 4 2.7H5Z" fill="currentColor" />
        <path d="M4.2 7.4v4.5M13.8 7.4v4.5M7.3 13.8v1.9M10.7 13.8v1.9M6.7 1.9l1 1.6M11.3 1.9l-1 1.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="7.4" cy="4.9" r=".45" fill="var(--card)" />
        <circle cx="10.6" cy="4.9" r=".45" fill="var(--card)" />
      </svg>
    </ToolbarIcon>
  );
}

function IosIcon() {
  return (
    <ToolbarIcon>
      <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true">
        <path d="M12.15 9.35c-.02-1.8 1.47-2.68 1.54-2.72-.85-1.22-2.15-1.39-2.6-1.41-1.1-.11-2.16.65-2.72.65-.57 0-1.43-.63-2.36-.61-1.2.02-2.32.7-2.94 1.78-1.27 2.2-.32 5.43.9 7.2.6.87 1.32 1.84 2.26 1.8.9-.04 1.25-.58 2.35-.58 1.09 0 1.4.58 2.35.56.98-.02 1.59-.87 2.18-1.75.7-1 1-1.98 1.01-2.03-.02-.01-1.95-.75-1.97-2.89Z" fill="currentColor" />
        <path d="M10.37 4.05c.5-.6.84-1.44.74-2.27-.72.03-1.6.48-2.12 1.08-.47.54-.88 1.41-.77 2.23.8.06 1.64-.41 2.15-1.04Z" fill="currentColor" />
      </svg>
    </ToolbarIcon>
  );
}

function TableIcon() {
  return (
    <ToolbarIcon>
      <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true">
        <rect x="2.6" y="3" width="12.8" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.45" />
        <path d="M2.8 7h12.4M7 3.3v11.4M11 3.3v11.4" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    </ToolbarIcon>
  );
}

function ChartsIcon() {
  return (
    <ToolbarIcon>
      <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true">
        <path d="M3 14.7h12.3" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
        <rect x="4" y="9.2" width="2.2" height="4.2" rx=".6" fill="currentColor" />
        <rect x="8" y="6.8" width="2.2" height="6.6" rx=".6" fill="currentColor" opacity=".82" />
        <rect x="12" y="4" width="2.2" height="9.4" rx=".6" fill="currentColor" opacity=".68" />
        <path d="M4.1 7.2 7.2 5.1l2.5 1.4 4-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </ToolbarIcon>
  );
}

function HotfixIcon() {
  return (
    <ToolbarIcon>
      <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true">
        <path d="M9 2.3v2M9 13.7v2M15.7 9h-2M4.3 9h-2M13.75 4.25 12.35 5.65M5.65 12.35 4.25 13.75M13.75 13.75 12.35 12.35M5.65 5.65 4.25 4.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="m7.7 9 1 1 1.8-2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </ToolbarIcon>
  );
}

function SegmentLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
      {icon}
      <span data-segment-indicator-target="true" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </span>
  );
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function AnimatedCounter({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);

  useEffect(() => {
    const from = displayValueRef.current;
    if (from === value) {
      displayValueRef.current = value;
      setDisplayValue(value);
      return undefined;
    }

    const start = performance.now();
    const duration = 420;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(progress);
      const nextValue = from + (value - from) * eased;
      displayValueRef.current = nextValue;
      setDisplayValue(Math.round(nextValue));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        displayValueRef.current = value;
        setDisplayValue(value);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      textAlign: 'center',
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums',
      animation: 'hotfix-count-pop .22s ease',
    }}>
      {displayValue}
    </span>
  );
}

function YearDropdown({
  years,
  value,
  onChange,
  buttonStyle,
  activeStyle,
}: {
  years: number[];
  value: string;
  onChange: (value: string) => void;
  buttonStyle: React.CSSProperties;
  activeStyle: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 76 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selectedYear = years.includes(Number(value)) ? value : '';

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(76, rect.width);
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 260));
    setPosition({ left, top, width });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  return (
    <span style={{ display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={event => {
          event.preventDefault();
          updatePosition();
          setOpen(prev => !prev);
        }}
        style={{
          ...buttonStyle,
          minWidth: 64,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          fontFamily: 'inherit',
          ...(selectedYear ? activeStyle : {}),
        }}
      >
        <span>{selectedYear || 'Год'}</span>
        <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1, opacity: 0.82 }}>v</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            zIndex: 880,
            width: position.width,
            maxHeight: 260,
            overflow: 'auto',
            padding: 6,
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.28)',
          }}
        >
          {years.map(item => {
            const selected = selectedYear === String(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                  onChange(String(item));
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  minHeight: 30,
                  padding: '0 9px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: selected ? 'linear-gradient(135deg,#8B5CF6,#CB11AB)' : 'transparent',
                  color: selected ? '#fff' : 'var(--text-2)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 850,
                  textAlign: 'left',
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function issueCell(issue: QuarterAnalysisRow['primaryTask']) {
  if (!issue) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
      <a href={issue.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--mono)' }}>
        {issue.key}
      </a>
      <span style={{
        color: 'var(--text-2)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {issue.summary || '-'}
      </span>
      {issue.locomotive.any.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {issue.locomotive.any.join(', ')}
        </span>
      )}
    </div>
  );
}

function issueText(issue: QuarterAnalysisRow['primaryTask']) {
  if (!issue) return '-';
  return [
    issue.key,
    issue.summary,
    issue.locomotive.any.length ? issue.locomotive.any.join(', ') : '',
  ].filter(Boolean).join('\n');
}

function secondaryTasksText(row: QuarterAnalysisRow) {
  return row.secondaryTasks.length ? row.secondaryTasks.map(issueText).join('\n\n') : '-';
}

function secondaryTasksPreview(row: QuarterAnalysisRow) {
  if (row.secondaryTasks.length <= 1) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {row.secondaryTasks.map(issue => <div key={issue.key}>{issueCell(issue)}</div>)}
    </div>
  );
}

function secondaryTasksCell(row: QuarterAnalysisRow) {
  if (!row.secondaryTasks.length) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  const issue = row.secondaryTasks[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, lineHeight: 1.35, whiteSpace: 'normal' }}>
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--mono)' }}
      >
        {issue.key}
      </a>
      <span style={{
        color: 'var(--text-2)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {issue.summary || '-'}
      </span>
    </div>
  );
}

function taskCount(row: QuarterAnalysisRow) {
  return row.secondaryTasks.length + (row.primaryTask ? 1 : 0);
}

function releaseQuarterRowHeight(row: QuarterAnalysisRow) {
  const primary = row.primaryTask;
  if (!primary?.locomotive.any.length) return 74;
  const summary = primary.summary.trim();
  const needsSecondSummaryLine = summary.includes('\n') || summary.length > 42;
  return needsSecondSummaryLine ? 92 : 74;
}

function columnFilterValue(row: QuarterAnalysisRow, key: ColumnFilterKey) {
  if (key === 'version') return row.version;
  if (key === 'stream') return dash(row.stream);
  return dash(row.substream);
}

function splitColumnFilterValues(row: QuarterAnalysisRow, key: ColumnFilterKey) {
  if (key === 'version') {
    const version = row.version.trim();
    return version && version !== '-' ? [version] : [];
  }
  return columnFilterValue(row, key)
    .split(/[,;\n]+/u)
    .map(item => item.trim())
    .filter(item => item && item !== '-');
}

function uniqueColumnValues(rows: QuarterAnalysisRow[], key: ColumnFilterKey) {
  return Array.from(new Set(rows.flatMap(row => splitColumnFilterValues(row, key)))).sort((left, right) => (
    key === 'version' ? compareRelease(left, right) : left.localeCompare(right, 'ru')
  ));
}

function emptyColumnFilters(): ColumnFilters {
  return { version: [], stream: [], substream: [] };
}

function matchesColumnFilters(row: QuarterAnalysisRow, filters: ColumnFilters) {
  return (Object.keys(filters) as ColumnFilterKey[]).every(key => {
    const selected = filters[key];
    if (!selected.length) return true;
    const rowValues = splitColumnFilterValues(row, key);
    return selected.some(value => rowValues.includes(value));
  });
}

function versionText(row: QuarterAnalysisRow) {
  return `${row.version}\nЗадач: ${taskCount(row)}`;
}

function quarterRowKey(row: QuarterAnalysisRow) {
  return `${row.platform}:${row.version}`;
}

function sortQuarterRows(rows: QuarterAnalysisRow[]) {
  return [...rows].sort((left, right) => left.platform.localeCompare(right.platform) || compareRelease(left.version, right.version));
}

function mergeCollectedRowsTop(collectedRows: QuarterAnalysisRow[], currentRows: QuarterAnalysisRow[]) {
  const collectedKeys = new Set(collectedRows.map(quarterRowKey));
  return [
    ...sortQuarterRows(collectedRows),
    ...sortQuarterRows(currentRows.filter(row => !collectedKeys.has(quarterRowKey(row)))),
  ];
}

function branchCutDateParts(row: QuarterAnalysisRow) {
  const match = String(row.branchCutTime || '').match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  const parsed = Number(match[3]);
  const year = parsed < 100 ? 2000 + parsed : parsed;
  if (!Number.isFinite(year) || month < 0 || month > 11) return null;
  return { month, year, quarter: Math.floor(month / 3) + 1 };
}

function defaultYearForRows(rows: QuarterAnalysisRow[], platform: PlatformKey) {
  const years = new Set(rows
    .filter(row => row.platform === platform)
    .map(row => branchCutDateParts(row)?.year)
    .filter((value): value is number => value != null));
  if (!years.size) return 'all';
  return years.has(CURRENT_YEAR) ? CURRENT_YEAR_VALUE : 'all';
}

function meaningfulChartText(value: unknown) {
  const text = String(value || '').trim();
  if (!text || text === '-' || /^tbd\b/i.test(text)) return '';
  return text;
}

function splitChartValues(value: unknown) {
  return String(value || '')
    .split(/[,;\n]+/u)
    .map(item => meaningfulChartText(item))
    .filter(Boolean);
}

function incrementCounter(counter: Map<string, number>, key: string, amount = 1) {
  counter.set(key, (counter.get(key) || 0) + amount);
}

function counterToChartData(counter: Map<string, number>) {
  return Array.from(counter, ([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'ru'));
}

function rowIssues(row: QuarterAnalysisRow) {
  return [row.primaryTask, ...row.secondaryTasks].filter((issue): issue is NonNullable<QuarterAnalysisRow['primaryTask']> => Boolean(issue));
}

function buildStreamChartData(rows: QuarterAnalysisRow[]) {
  const counter = new Map<string, number>();
  rows.forEach(row => {
    rowIssues(row).forEach(issue => {
      const values = splitChartValues(issue.stream);
      if (values.length) values.forEach(value => incrementCounter(counter, value));
      else splitChartValues(row.stream).forEach(value => incrementCounter(counter, value));
    });
  });
  return counterToChartData(counter);
}

function buildLocomotiveTypeChartData(rows: QuarterAnalysisRow[]) {
  const counter = new Map<string, number>();
  rows.forEach(row => {
    const locomotive = row.primaryTask?.locomotive;
    if (!locomotive) return;
    const labels: string[] = [];
    if (locomotive.business.length) labels.push('Бизнес');
    if (locomotive.product.length) labels.push('Продукт');
    if (locomotive.technical.length) labels.push('Технический');
    labels.forEach(label => incrementCounter(counter, label));
  });
  return counterToChartData(counter);
}

function buildReasonChartData(rows: QuarterAnalysisRow[]) {
  const counter = new Map<string, number>();
  rows.forEach(row => {
    const reason = meaningfulChartText(row.hotfixReason);
    if (reason) incrementCounter(counter, reason);
  });
  return counterToChartData(counter);
}

function quarterLabel(quarter: number) {
  return `Q${quarter}`;
}

function buildQuarterMonthChartData(rows: QuarterAnalysisRow[], quarter: number) {
  const months = QUARTER_MONTHS[quarter] || [];
  const counter = new Map(months.map(monthIndex => [monthIndex, 0]));
  rows.forEach(row => {
    const branchCutDate = branchCutDateParts(row);
    if (!branchCutDate || !counter.has(branchCutDate.month)) return;
    counter.set(branchCutDate.month, (counter.get(branchCutDate.month) || 0) + 1);
  });
  return months.map(monthIndex => ({
    label: MONTHS_SHORT[monthIndex],
    value: counter.get(monthIndex) || 0,
  }));
}

function truncateChartLabel(value: string, length = 22) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function chartTickValues(maxValue: number, targetSteps = 4) {
  const max = Math.max(1, Math.ceil(maxValue));
  if (max <= targetSteps + 1) {
    return Array.from({ length: max + 1 }, (_, index) => index);
  }
  const step = Math.max(1, Math.ceil(max / targetSteps));
  const ticks: number[] = [];
  for (let tick = 0; tick < max; tick += step) ticks.push(tick);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return Array.from(new Set(ticks));
}

function useAnimatedChartData(data: ChartDatum[], duration = 620, keepLeavingLabels = false) {
  const [animatedData, setAnimatedData] = useState<ChartDatum[]>(data);
  const animatedDataRef = useRef<ChartDatum[]>(data);
  const frameRef = useRef(0);
  const dataKey = useMemo(() => data.map(item => `${item.label}:${item.value}`).join('|'), [data]);

  useEffect(() => {
    window.cancelAnimationFrame(frameRef.current);
    const currentData = animatedDataRef.current;
    const targetLabels = new Set(data.map(item => item.label));
    const leavingData = keepLeavingLabels
      ? currentData
        .filter(item => !targetLabels.has(item.label) && item.value > 0.01)
        .map(item => ({ ...item, value: 0 }))
      : [];
    const targetData = [...data.map(item => ({ ...item })), ...leavingData];

    if (!targetData.length) {
      animatedDataRef.current = [];
      setAnimatedData([]);
      return undefined;
    }

    const fromValues = new Map(currentData.map(item => [item.label, item.value]));
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(progress);
      const nextData = targetData.map(item => {
        const from = fromValues.get(item.label) ?? 0;
        return {
          ...item,
          value: from + (item.value - from) * eased,
        };
      });
      animatedDataRef.current = nextData;
      setAnimatedData(nextData);

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const settledData = data.map(item => ({ ...item }));
      animatedDataRef.current = settledData;
      setAnimatedData(settledData);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [dataKey, duration, keepLeavingLabels]);

  return animatedData;
}

function exportCsv(rows: QuarterAnalysisRow[], platform: PlatformKey, rangeLabel: string) {
  const headers = [
    'Платформа',
    'Версия',
    'Стрим',
    'Сабстрим',
    'Локомотивная задача',
    'Вторичные задачи',
    'Время сборки',
    '% раскатки предыдущей версии',
    'Плановая дата отправки хф',
    'Время отведения хотфикса',
    'Фактическая дата отправки',
    'Дата раскатки на 1%',
    'Причина хф',
    'Детали хф',
  ];
  const lines = [headers, ...rows.map(row => [
    platformLabel(row.platform),
    row.version,
    row.stream,
    row.substream,
    row.primaryTask ? `${row.primaryTask.key} ${row.primaryTask.summary}` : '',
    row.secondaryTasks.map(issue => `${issue.key} ${issue.summary}`).join('\n'),
    row.buildTime,
    row.previousRolloutPercent,
    row.plannedHotfixDate,
    row.branchCutTime,
    row.actualSendTime,
    row.onePercentDate,
    row.hotfixReason,
    row.hotfixDetails,
  ])];
  const csv = lines.map(line => line.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `release-quarter-${platform}-${rangeLabel}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function exportPdf(rows: QuarterAnalysisRow[], platform: PlatformKey, rangeLabel: string) {
  const popup = window.open('', '_blank');
  if (!popup) return;

  const headers = [
    'Платформа',
    'Версия',
    'Стрим',
    'Сабстрим',
    'Локомотивная задача',
    'Вторичные задачи',
    'Время сборки',
    '% раскатки предыдущей версии',
    'План дата отправки ХФ',
    'Время отведения ХФ',
    'Фактическая дата отправки',
    'Дата раскатки на 1%',
    'Причина ХФ',
    'Детали ХФ',
  ];
  const bodyRows = rows.map(row => [
    platformLabel(row.platform),
    row.version,
    row.stream,
    row.substream,
    row.primaryTask ? `${row.primaryTask.key} ${row.primaryTask.summary}` : '-',
    row.secondaryTasks.length ? row.secondaryTasks.map(issue => `${issue.key} ${issue.summary}`).join('\n') : '-',
    row.buildTime,
    row.previousRolloutPercent,
    row.plannedHotfixDate,
    row.branchCutTime,
    row.actualSendTime,
    row.onePercentDate,
    row.hotfixReason,
    row.hotfixDetails,
  ]);
  const title = `Анализ релизов за квартал · ${platformLabel(platform)} · ${rangeLabel}`;

  popup.document.write(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; }
    h1 { margin: 0 0 10px; font-size: 18px; }
    .meta { margin: 0 0 14px; font-size: 11px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
    th { background: #f1f5f9; text-align: center; font-weight: 700; }
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Строк: ${rows.length} · сформировано ${new Date().toLocaleString('ru-RU')}</div>
  <table>
    <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>${bodyRows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
  <script>
    window.addEventListener('load', () => {
      window.focus();
      setTimeout(() => window.print(), 200);
    });
  </script>
</body>
</html>`);
  popup.document.close();
}

interface QuarterChartBlock {
  quarter: number;
  hotfixCount: number;
  taskCount: number;
  monthlyCounts: ChartDatum[];
  streams: ChartDatum[];
  locomotiveTypes: ChartDatum[];
  reasons: ChartDatum[];
}

function DashboardChartCard({
  title,
  count,
  countColor = 'rgba(168,85,247,.12)',
  countText = 'var(--accent)',
  children,
  style,
}: {
  title: string;
  count?: React.ReactNode;
  countColor?: string;
  countText?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const countNode = typeof count === 'number' ? <AnimatedCounter value={count} /> : count;
  return (
    <div style={{
      minWidth: 0,
      border: '1px solid var(--border-hi)',
      borderRadius: 8,
      background: 'var(--card)',
      boxShadow: '0 6px 18px rgba(15,23,42,.055)',
      padding: '11px 11px',
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <span style={{ minWidth: 0, fontSize: 11, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0 }}>{title}</span>
        {count != null && (
          <span style={{
            minWidth: 42,
            height: 24,
            padding: '0 8px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
            background: countColor,
            color: countText,
            fontSize: 12,
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {countNode}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function DashboardEmptyChart({ minHeight = 170 }: { minHeight?: number }) {
  return (
    <div style={{
      minHeight,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px dashed var(--border-hi)',
      borderRadius: 8,
      color: 'var(--text-3)',
      fontSize: 12,
      fontWeight: 700,
    }}>
      Нет данных
    </div>
  );
}

function StreamIcon({ label, index }: { label: string; index: number }) {
  const lower = label.toLowerCase();
  const kind =
    /vibes|вайб|love|серд/u.test(lower) ? 'heart' :
    /кт|code|dev|тех/u.test(lower) ? 'code' :
    /рекомен/u.test(lower) ? 'star' :
    /release|релиз/u.test(lower) ? 'rocket' :
    /поиск|каталог|search/u.test(lower) ? 'search' :
    /чат|chat/u.test(lower) ? 'chat' :
    /b2b|б2б|business/u.test(lower) ? 'briefcase' :
    /кор|cart|корз/u.test(lower) ? 'crown' :
    (['crown', 'heart', 'code', 'star', 'rocket', 'search', 'chat', 'briefcase'] as const)[index % 8];
  const common = { stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const icon = {
    crown: <path {...common} d="M4 7.5 6.3 5l2.1 3.1L11.7 5 14 7.5l-1 4.5H5L4 7.5Z M5.5 14h7" />,
    heart: <path {...common} d="M9 13.5s-5-3.2-5-6.3A2.5 2.5 0 0 1 8.3 5.5L9 6.2l.7-.7A2.5 2.5 0 0 1 14 7.2c0 3.1-5 6.3-5 6.3Z" />,
    code: <path {...common} d="m7 5-3 4 3 4M11 5l3 4-3 4M9.8 4.8 8.2 13.2" />,
    star: <path {...common} d="m9 4.2 1.35 2.9 3.15.38-2.32 2.14.62 3.1L9 11.15l-2.8 1.57.62-3.1L4.5 7.48l3.15-.38L9 4.2Z" />,
    rocket: <path {...common} d="M9.5 12.7 6.3 9.5C7.1 6 9 4 13 3.5c-.5 4-2.5 5.9-6 6.7M5.8 10.2 4.5 13.5l3.3-1.3M10.9 5.7h.01" />,
    search: <path {...common} d="M8.2 12a3.8 3.8 0 1 1 0-7.6 3.8 3.8 0 0 1 0 7.6ZM11.1 11.1 14 14" />,
    chat: <path {...common} d="M4 5.8A2 2 0 0 1 6 3.8h6a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H8.2L5 14v-2.8A2 2 0 0 1 4 9.5V5.8Z" />,
    briefcase: <path {...common} d="M5 6.5h8A1.5 1.5 0 0 1 14.5 8v4A1.5 1.5 0 0 1 13 13.5H5A1.5 1.5 0 0 1 3.5 12V8A1.5 1.5 0 0 1 5 6.5ZM7.3 6.3V5.5a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v.8" />,
  }[kind];

  return (
    <span style={{
      width: 23,
      height: 23,
      borderRadius: 6,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--accent)',
      background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
      border: '1px solid color-mix(in srgb, var(--accent) 14%, transparent)',
      flexShrink: 0,
    }}>
      <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">{icon}</svg>
    </span>
  );
}

function StreamDashboardChart({ data }: { data: ChartDatum[] }) {
  const animatedData = useAnimatedChartData(data, 620, true);
  const [tooltip, setTooltip] = useState<{ text: string; left: number; top: number } | null>(null);
  const max = Math.max(1, ...data.map(item => item.value), ...animatedData.map(item => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const ticks = chartTickValues(max, 5);
  return (
    <>
      <DashboardChartCard title="Задачи по стримам" count={total} style={{ height: 286, overflow: 'hidden' }}>
        {!data.length && !animatedData.length ? <DashboardEmptyChart /> : (
          <div style={{ display: 'flex', flexDirection: 'column', height: 222, minHeight: 0, paddingTop: 2 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflow: 'auto', paddingRight: 3 }}>
              {animatedData.map((item, index) => {
                const barWidth = Math.max(0, (item.value / max) * 100);
                return (
                  <div key={item.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(74px, 96px) minmax(46px,1fr) 22px', gap: 7, alignItems: 'center', animation: 'release-row-in .32s ease both' }}>
                    <div
                      onMouseEnter={event => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setTooltip({ text: item.label, left: rect.left + rect.width / 2, top: rect.top - 8 });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}
                    >
                      <StreamIcon label={item.label} index={index} />
                      <span title={item.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12, fontWeight: 620 }}>
                        {truncateChartLabel(item.label, 16)}
                      </span>
                    </div>
                    <div style={{ position: 'relative', height: 12 }}>
                      <div style={{ position: 'absolute', inset: '3px 0', borderRadius: 3, background: 'var(--surface-soft-4)' }} />
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 3,
                        height: 6,
                        width: `${barWidth}%`,
                        borderRadius: 3,
                        background: 'var(--accent)',
                        boxShadow: 'none',
                        transformOrigin: 'left center',
                        animation: 'release-bar-grow .46s cubic-bezier(.2,.8,.2,1) both',
                        transition: 'width .08s linear',
                      }} />
                    </div>
                    <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.max(0, Math.round(item.value))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(74px, 96px) 1fr 22px', gap: 7, alignItems: 'center', paddingTop: 8, flexShrink: 0 }}>
              <span />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)', fontSize: 10, fontWeight: 650 }}>
                {ticks.map(tick => <span key={tick}>{tick}</span>)}
              </div>
              <span />
            </div>
          </div>
        )}
      </DashboardChartCard>
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.left,
          top: tooltip.top,
          transform: 'translate(-50%, -100%)',
          zIndex: 1800,
          maxWidth: 280,
          padding: '7px 9px',
          borderRadius: 7,
          border: '1px solid var(--border-hi)',
          background: 'var(--card)',
          color: 'var(--text)',
          boxShadow: '0 14px 32px rgba(15,23,42,.18)',
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.35,
          pointerEvents: 'none',
          whiteSpace: 'normal',
        }}>
          {tooltip.text}
        </div>
      )}
    </>
  );
}

const LOCOMOTIVE_COLORS: Record<string, string> = {
  'Технический': '#7C3AED',
  'Продукт': '#2EA8D8',
  'Бизнес': '#36A852',
};

function locomotiveDonutLayout(quarterCount: number) {
  const count = Math.min(4, Math.max(1, quarterCount || 1)) as 1 | 2 | 3 | 4;
  const layouts = {
    1: { cardHeight: 352, svgHeight: 180, maxWidth: 260, radius: 82, trackStroke: 46, segmentStroke: 42, centerRadius: 60, totalFont: 34, labelFont: 14, valueFont: 18, legendMaxHeight: 92 },
    2: { cardHeight: 326, svgHeight: 158, maxWidth: 230, radius: 72, trackStroke: 44, segmentStroke: 40, centerRadius: 52, totalFont: 31, labelFont: 13.5, valueFont: 17, legendMaxHeight: 84 },
    3: { cardHeight: 306, svgHeight: 140, maxWidth: 206, radius: 64, trackStroke: 42, segmentStroke: 38, centerRadius: 46, totalFont: 28, labelFont: 13, valueFont: 16, legendMaxHeight: 78 },
    4: { cardHeight: 286, svgHeight: 124, maxWidth: 184, radius: 58, trackStroke: 40, segmentStroke: 36, centerRadius: 42, totalFont: 26, labelFont: 13, valueFont: 15, legendMaxHeight: 74 },
  };
  return layouts[count];
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function donutArcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function LocomotiveDonutChart({ data, quarterCount }: { data: ChartDatum[]; quarterCount: number }) {
  const animatedData = useAnimatedChartData(data, 620, true);
  const layout = locomotiveDonutLayout(quarterCount);
  const order = ['Технический', 'Продукт', 'Бизнес'];
  const prepared = order
    .map(label => ({ label, value: animatedData.find(item => item.label === label)?.value || 0, color: LOCOMOTIVE_COLORS[label] }))
    .filter(item => item.value > 0.01);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const animatedTotal = prepared.reduce((sum, item) => sum + item.value, 0);
  const radius = layout.radius;
  let angleOffset = -Math.PI / 2;

  return (
    <DashboardChartCard title="Типы локомотивов" count={total} countColor="rgba(14,165,233,.10)" countText="#2EA8D8" style={{ height: layout.cardHeight, overflow: 'hidden' }}>
      {!data.length && !prepared.length ? <DashboardEmptyChart /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: quarterCount <= 2 ? 10 : 8, alignItems: 'center', minHeight: 0 }}>
          <svg viewBox="0 0 220 220" width="100%" height={layout.svgHeight} role="img" style={{ display: 'block', maxWidth: layout.maxWidth, justifySelf: 'center', transition: 'height .26s ease, max-width .26s ease' }}>
            <circle cx="110" cy="110" r={radius} fill="none" stroke="var(--surface-soft-4)" strokeWidth={layout.trackStroke} />
            {prepared.map(item => {
              const startAngle = angleOffset;
              const endAngle = startAngle + (animatedTotal > 0 ? (item.value / animatedTotal) * Math.PI * 2 : 0);
              angleOffset = endAngle;
              const isFullCircle = endAngle - startAngle >= Math.PI * 2 - 0.001;
              const element = (
                isFullCircle ? (
                  <circle
                    key={item.label}
                    cx="110"
                    cy="110"
                    r={radius}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={layout.segmentStroke}
                    strokeLinecap="butt"
                    style={{
                      transformOrigin: '110px 110px',
                      animation: 'release-donut-in .48s cubic-bezier(.2,.8,.2,1) both',
                    }}
                  />
                ) : (
                <path
                  key={item.label}
                  d={donutArcPath(110, 110, radius, startAngle, endAngle)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={layout.segmentStroke}
                  strokeLinecap="butt"
                  style={{
                    transformOrigin: '110px 110px',
                    animation: 'release-donut-in .48s cubic-bezier(.2,.8,.2,1) both',
                    transition: 'd .08s linear',
                  }}
                />
                )
              );
              return element;
            })}
            <circle cx="110" cy="110" r={layout.centerRadius} fill="var(--card)" />
            <text x="110" y="105" textAnchor="middle" fill="var(--text-2)" fontSize={layout.labelFont} fontWeight="620">Всего</text>
            <text x="110" y="132" textAnchor="middle" fill="var(--text)" fontSize={layout.totalFont} fontWeight="820">{Math.round(animatedTotal)}</text>
            {prepared.map((item, itemIndex) => {
              const before = prepared.slice(0, itemIndex).reduce((sum, current) => sum + current.value, 0);
              const middle = animatedTotal > 0 ? ((before + item.value / 2) / animatedTotal) * Math.PI * 2 - Math.PI / 2 : -Math.PI / 2;
              const x = 110 + Math.cos(middle) * radius;
              const y = 110 + Math.sin(middle) * radius;
              return (
                <text key={`${item.label}-value`} x={x} y={y + 5} textAnchor="middle" fill="#fff" fontSize={layout.valueFont} fontWeight="800" style={{ animation: 'release-value-pop .24s ease both' }}>
                  {Math.max(0, Math.round(item.value))}
                </text>
              );
            })}
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, maxHeight: layout.legendMaxHeight, overflow: 'auto', paddingRight: 2 }}>
            {prepared.map(item => (
              <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '13px minmax(0, 1fr) auto', gap: 7, alignItems: 'center', minWidth: 0, animation: 'release-row-in .32s ease both' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color, boxShadow: 'none' }} />
                <span title={item.label} style={{ color: 'var(--text-2)', fontSize: 12, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.max(0, Math.round(item.value))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardChartCard>
  );
}

function ReasonDashboardChart({ data }: { data: ChartDatum[] }) {
  const animatedData = useAnimatedChartData(data, 620, true);
  const max = Math.max(1, ...data.map(item => item.value), ...animatedData.map(item => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const ticks = chartTickValues(max, 2);
  return (
    <DashboardChartCard title="Причины ХФ" count={total} countColor="rgba(50,199,79,.10)" countText="#22C55E" style={{ gridColumn: '1 / -1', height: 176, overflow: 'hidden' }}>
      {!data.length && !animatedData.length ? <DashboardEmptyChart minHeight={90} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 116, overflow: 'auto', paddingRight: 3 }}>
          {animatedData.map(item => {
            const barWidth = Math.max(0, (item.value / max) * 100);
            return (
              <div key={item.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(42px, 70px) minmax(54px, 1fr) 24px', gap: 8, alignItems: 'center', animation: 'release-row-in .32s ease both' }}>
                <span title={item.label} style={{ color: 'var(--text)', fontSize: 13, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {truncateChartLabel(item.label, 14)}
                </span>
                <div style={{ position: 'relative', height: 16 }}>
                  <div style={{ position: 'absolute', inset: '5px 0', borderRadius: 3, background: 'var(--surface-soft-4)' }} />
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 5,
                    height: 6,
                    width: `${barWidth}%`,
                    borderRadius: 3,
                    background: '#36A852',
                    boxShadow: 'none',
                    transformOrigin: 'left center',
                    animation: 'release-bar-grow .46s cubic-bezier(.2,.8,.2,1) both',
                    transition: 'width .08s linear',
                  }} />
                </div>
                <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.max(0, Math.round(item.value))}
                </span>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(42px, 70px) minmax(54px, 1fr) 24px', gap: 8, alignItems: 'center' }}>
            <span />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)', fontSize: 11, fontWeight: 650 }}>
              {ticks.map(tick => <span key={tick}>{tick}</span>)}
            </div>
            <span />
          </div>
        </div>
      )}
    </DashboardChartCard>
  );
}

function MonthDashboardChart({ data, axisScopeKey }: { data: ChartDatum[]; axisScopeKey: string }) {
  const animatedData = useAnimatedChartData(data);
  const axisScopeRef = useRef(axisScopeKey);
  const stableMaxRef = useRef(1);
  const gradientIdRef = useRef('');
  if (!gradientIdRef.current) {
    gradientIdRef.current = `monthArea-${Math.random().toString(36).slice(2)}`;
  }
  const width = 360;
  const height = 206;
  const pad = { left: 38, right: 16, top: 32, bottom: 34 };
  const liveMaxValue = Math.max(1, ...data.map(item => item.value), ...animatedData.map(item => item.value));
  if (axisScopeRef.current !== axisScopeKey) {
    axisScopeRef.current = axisScopeKey;
    stableMaxRef.current = liveMaxValue;
  } else if (liveMaxValue > stableMaxRef.current) {
    stableMaxRef.current = liveMaxValue;
  }
  const maxValue = stableMaxRef.current;
  const max = Math.max(3, Math.ceil((maxValue * 1.25) / 3) * 3);
  const yTicks = chartTickValues(max, 4);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const yFor = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const xFor = (index: number) => animatedData.length <= 1 ? pad.left + plotWidth / 2 : pad.left + (plotWidth / (animatedData.length - 1)) * index;
  const points = animatedData.map((item, index) => ({ x: xFor(index), y: yFor(item.value), ...item }));
  const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
  const areaPoints = points.length
    ? `${pad.left},${pad.top + plotHeight} ${linePoints} ${width - pad.right},${pad.top + plotHeight}`
    : '';
  const gradientId = gradientIdRef.current;

  return (
    <DashboardChartCard title="Количество ХФ по месяцам" style={{ gridColumn: '1 / -1', height: 246, paddingBottom: 10, overflow: 'hidden' }}>
      {!data.length ? <DashboardEmptyChart minHeight={170} /> : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ display: 'block', width: '100%', minWidth: 0, height: 188 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".14" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map(tick => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray={tick === 0 ? undefined : '4 5'} />
                <text x={pad.left - 10} y={y + 4} textAnchor="end" fill="var(--text-3)" fontSize="10" fontWeight="650">
                  {tick}
                </text>
              </g>
            );
          })}
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotHeight} stroke="var(--border-hi)" strokeWidth="1.2" />
          <line x1={pad.left} y1={pad.top + plotHeight} x2={width - pad.right} y2={pad.top + plotHeight} stroke="var(--text-3)" strokeOpacity=".48" strokeWidth="1.2" />
          <text x={13} y={pad.top + plotHeight / 2} transform={`rotate(-90 13 ${pad.top + plotHeight / 2})`} textAnchor="middle" fill="var(--text-3)" fontSize="9" fontWeight="800" letterSpacing="1">
            кол-во
          </text>
          {areaPoints && <polygon points={areaPoints} fill={`url(#${gradientId})`} style={{ animation: 'release-area-in .46s ease both' }} />}
          <polyline points={linePoints} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" style={{ animation: 'release-line-in .46s cubic-bezier(.2,.8,.2,1) both' }} />
          {points.map(point => (
            <g key={point.label} style={{ animation: 'release-value-pop .34s ease both' }}>
              <text x={point.x} y={height - 12} textAnchor="middle" fill="var(--text-2)" fontSize="10.5" fontWeight="760">
                {point.label}
              </text>
              <circle cx={point.x} cy={point.y} r="7.5" fill="var(--accent)" opacity=".10" />
              <circle cx={point.x} cy={point.y} r="4.8" fill="var(--card)" stroke="var(--accent)" strokeWidth="2.2" />
              <text x={point.x} y={Math.max(15, point.y - 12)} textAnchor="middle" fill="var(--accent)" fontSize="12" fontWeight="850">
                {Math.max(0, Math.round(point.value))}
              </text>
            </g>
          ))}
        </svg>
      )}
    </DashboardChartCard>
  );
}

function DashboardBadgeIcon({ type }: { type: 'hotfix' | 'task' }) {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
      {type === 'hotfix' ? (
        <path d="m10.2 1.8-5.6 7h4L7.8 16l5.8-8.5H9.5l.7-5.7Z" fill="currentColor" />
      ) : (
        <>
          <rect x="3.4" y="3.4" width="11.2" height="11.2" rx="2.2" fill="currentColor" opacity=".18" />
          <path d="m6.3 9 1.8 1.8 3.7-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function QuarterChartsView({ blocks, scopeKey }: { blocks: QuarterChartBlock[]; scopeKey: string }) {
  const visibleBlocks = blocks.filter(block => block.hotfixCount > 0);
  const quarterMinWidth = visibleBlocks.length >= 4 ? '230px' : visibleBlocks.length === 3 ? '280px' : '320px';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${quarterMinWidth}, 1fr))`,
      gap: 12,
      padding: '0 8px 12px',
      alignItems: 'start',
    }}>
      {visibleBlocks.map(block => (
        <section
          key={block.quarter}
          style={{
            minWidth: 0,
            animation: 'release-chart-in .38s cubic-bezier(.2,.8,.2,1) both',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 2px 10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 28, lineHeight: 1, fontWeight: 850, color: 'var(--text)', letterSpacing: 0 }}>{quarterLabel(block.quarter)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                height: 28,
                padding: '0 9px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 7,
                border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                color: 'var(--accent)',
                fontSize: 12,
                fontWeight: 800,
                boxShadow: 'none',
              }}>
                <DashboardBadgeIcon type="hotfix" />
                ХФ: <AnimatedCounter value={block.hotfixCount} />
              </span>
              <span style={{
                height: 28,
                padding: '0 9px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 7,
                border: '1px solid rgba(14,165,233,.22)',
                background: 'rgba(14,165,233,.08)',
                color: '#147AC4',
                fontSize: 12,
                fontWeight: 800,
                boxShadow: 'none',
              }}>
                <DashboardBadgeIcon type="task" />
                Задач: <AnimatedCounter value={block.taskCount} />
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            <MonthDashboardChart data={block.monthlyCounts} axisScopeKey={`${scopeKey}:${block.quarter}`} />
            <StreamDashboardChart data={block.streams} />
            <LocomotiveDonutChart data={block.locomotiveTypes} quarterCount={visibleBlocks.length} />
            <ReasonDashboardChart data={block.reasons} />
          </div>
        </section>
      ))}
      {!visibleBlocks.length && (
        <div style={{
          gridColumn: '1 / -1',
          minHeight: 180,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1.5px dashed var(--border-hi)',
          borderRadius: 12,
          color: 'var(--text-3)',
          background: 'var(--card)',
          fontSize: 13,
          fontWeight: 700,
        }}>
          Нет данных по кварталам
        </div>
      )}
    </div>
  );
}

export function ReleaseQuarterAnalysis({ role = 'viewer' }: ReleaseQuarterAnalysisProps) {
  const { settings } = useSettings();
  const canSaveRows = role !== 'viewer';
  const [releaseFrom, setReleaseFrom] = useState(() => readStoredRelease(MAJOR_RELEASE_STORAGE_KEY, '7.5.6000'));
  const [releaseTo, setReleaseTo] = useState(() => readStoredRelease(MAJOR_RELEASE_RANGE_TO_STORAGE_KEY, releaseFrom));
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [activeTab, setActiveTab] = useState<AnalysisTab>('table');
  const [year, setYear] = useState(CURRENT_YEAR_VALUE);
  const [quarter, setQuarter] = useState('all');
  const [selectedMonths, setSelectedMonths] = useState<number[] | null>(null);
  const [rows, setRows] = useState<QuarterAnalysisRow[]>([]);
  const [pendingRows, setPendingRows] = useState<QuarterAnalysisRow[]>([]);
  const [freshRowKeys, setFreshRowKeys] = useState<Set<string>>(() => new Set());
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(() => emptyColumnFilters());
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => readStoredVisibleColumnIds());
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ok' | 'warn' | 'error'>('neutral');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [logPanelSize, setLogPanelSize] = useState({ width: 430, height: 330 });
  const abortRef = useRef<AbortController | null>(null);
  const monthScopeRef = useRef('');

  const log = useCallback((message: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-249), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${message}`, level }]);
  }, []);

  const resetCollectedDraft = useCallback(() => {
    setPendingRows([]);
    setFreshRowKeys(new Set());
    setColumnFilters(emptyColumnFilters());
  }, []);

  const updateRelease = useCallback((value: string) => {
    setReleaseFrom(value);
    if (!rangeEnabled) setReleaseTo(value);
    resetCollectedDraft();
  }, [rangeEnabled, resetCollectedDraft]);

  const updateReleaseTo = useCallback((value: string) => {
    setReleaseTo(value);
    resetCollectedDraft();
  }, [resetCollectedDraft]);

  const updateRangeEnabled = useCallback((value: boolean) => {
    setRangeEnabled(value);
    if (!value) setReleaseTo(releaseFrom);
    resetCollectedDraft();
  }, [releaseFrom, resetCollectedDraft]);

  useEffect(() => {
    try {
      localStorage.setItem(MAJOR_RELEASE_STORAGE_KEY, releaseFrom.trim());
    } catch {
      /* ignore */
    }
  }, [releaseFrom]);

  useEffect(() => {
    try {
      localStorage.setItem(MAJOR_RELEASE_RANGE_TO_STORAGE_KEY, releaseTo.trim());
    } catch {
      /* ignore */
    }
  }, [releaseTo]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(visibleColumnIds));
    } catch {
      /* ignore */
    }
  }, [visibleColumnIds]);

  useEffect(() => {
    let alive = true;
    setLoadingSaved(true);
    loadQuarterAnalysisRows()
      .then(savedRows => {
        if (!alive) return;
        setRows(savedRows);
        setYear(defaultYearForRows(savedRows, 'android'));
        setQuarter('all');
        setSelectedMonths(null);
      })
      .catch(error => {
        if (!alive) return;
        const message = (error as Error).message || 'Не удалось загрузить данные из Supabase.';
        setStatus(message);
        setStatusTone('error');
        log(message, 'error');
      })
      .finally(() => {
        if (alive) setLoadingSaved(false);
      });
    return () => {
      alive = false;
    };
  }, [log]);

  const baseFilteredRows = useMemo(() => rows.filter(row => {
    if (row.platform !== platform) return false;
    const branchCutDate = branchCutDateParts(row);
    if (year !== 'all' && branchCutDate?.year !== Number(year)) return false;
    if (quarter !== 'all' && branchCutDate?.quarter !== Number(quarter)) return false;
    if (selectedMonths != null && !selectedMonths.includes(branchCutDate?.month ?? -1)) return false;
    return true;
  }), [platform, quarter, rows, selectedMonths, year]);

  const chartSourceRows = useMemo(() => rows.filter(row => {
    if (row.platform !== platform) return false;
    const branchCutDate = branchCutDateParts(row);
    if (year !== 'all' && branchCutDate?.year !== Number(year)) return false;
    if (quarter !== 'all' && branchCutDate?.quarter !== Number(quarter)) return false;
    if (selectedMonths != null && !selectedMonths.includes(branchCutDate?.month ?? -1)) return false;
    return true;
  }), [platform, quarter, rows, selectedMonths, year]);

  const columnFilterValues = useMemo(() => ({
    version: uniqueColumnValues(baseFilteredRows, 'version'),
    stream: uniqueColumnValues(baseFilteredRows, 'stream'),
    substream: uniqueColumnValues(baseFilteredRows, 'substream'),
  }), [baseFilteredRows]);

  const visibleRows = useMemo(() => (
    baseFilteredRows.filter(row => matchesColumnFilters(row, columnFilters))
  ), [baseFilteredRows, columnFilters]);

  const setColumnFilter = useCallback((key: ColumnFilterKey, value: string[]) => {
    setColumnFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateVisibleColumnIds = useCallback((value: string[]) => {
    setVisibleColumnIds(sanitizeVisibleColumnIds(value));
  }, []);

  const availableYears = useMemo(() => {
    const set = new Set(rows
      .filter(row => row.platform === platform)
      .map(row => branchCutDateParts(row)?.year)
      .filter((value): value is number => value != null));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, rows]);

  useEffect(() => {
    if (!availableYears.length) return;
    if (year === 'all' || availableYears.includes(Number(year))) return;
    setYear(availableYears.includes(CURRENT_YEAR) ? CURRENT_YEAR_VALUE : 'all');
    setSelectedMonths(null);
  }, [availableYears, year]);

  const availableQuarters = useMemo(() => {
    const set = new Set(rows
      .filter(row => row.platform === platform)
      .map(row => branchCutDateParts(row))
      .filter((value): value is NonNullable<ReturnType<typeof branchCutDateParts>> => (
        value != null && (year === 'all' || value.year === Number(year))
      ))
      .map(value => value.quarter));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, rows, year]);

  useEffect(() => {
    if (quarter === 'all' || availableQuarters.includes(Number(quarter))) return;
    setQuarter('all');
    setSelectedMonths(null);
  }, [availableQuarters, quarter]);

  const availableMonths = useMemo(() => {
    if (quarter === 'all') return [];
    const set = new Set(rows
      .filter(row => {
        if (row.platform !== platform) return false;
        const branchCutDate = branchCutDateParts(row);
        return branchCutDate != null
          && (year === 'all' || branchCutDate.year === Number(year))
          && (quarter === 'all' || branchCutDate.quarter === Number(quarter));
      })
      .map(row => branchCutDateParts(row)?.month)
      .filter((value): value is number => value != null));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, quarter, rows, year]);

  const monthScopeKey = useMemo(() => (
    `${platform}:${year}:${quarter}:${availableMonths.join(',')}`
  ), [availableMonths, platform, quarter, year]);

  useEffect(() => {
    if (!availableMonths.length) {
      monthScopeRef.current = monthScopeKey;
      setSelectedMonths(null);
      return;
    }
    if (monthScopeRef.current !== monthScopeKey) {
      monthScopeRef.current = monthScopeKey;
      setSelectedMonths(availableMonths);
      return;
    }
    setSelectedMonths(prev => (
      prev == null ? availableMonths : prev.filter(item => availableMonths.includes(item))
    ));
  }, [availableMonths, monthScopeKey]);

  const selectedMonthSet = useMemo(() => new Set(selectedMonths ?? availableMonths), [availableMonths, selectedMonths]);

  const toggleSelectedMonth = useCallback((monthIndex: number) => {
    setSelectedMonths(prev => {
      const current = prev ?? availableMonths;
      if (current.includes(monthIndex)) return current.filter(item => item !== monthIndex);
      return [...current, monthIndex].sort((left, right) => left - right);
    });
  }, [availableMonths]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLogPanelOpen(false);
    setPendingRows([]);
    setFreshRowKeys(new Set());
    setLogs([]);
    setProgress(0);
    setStatus('Собираю хотфиксы и задачи...');
    setStatusTone('neutral');
    try {
      const releaseEnd = rangeEnabled ? releaseTo : releaseFrom;
      const result = await collectQuarterReleaseAnalysis(
        { settings, signal: controller.signal, onLog: log, onProgress: setProgress },
        releaseFrom,
        releaseEnd
      );
      setRows(prev => mergeCollectedRowsTop(result, prev));
      setPendingRows(result);
      setFreshRowKeys(new Set(result.map(quarterRowKey)));
      setColumnFilters(emptyColumnFilters());
      setYear(defaultYearForRows(result, platform));
      setQuarter('all');
      setSelectedMonths(null);
      setStatus(result.length ? `Готово: ${result.length} строк. Можно записать.` : 'Готово: хотфиксы не найдены.');
      setStatusTone(result.length ? 'ok' : 'warn');
      setProgress(100);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setStatus((error as Error).message || 'Не удалось собрать данные.');
      setStatusTone('error');
      log((error as Error).message || 'Не удалось собрать данные.', 'error');
      setProgress(0);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, [log, rangeEnabled, releaseFrom, releaseTo, settings]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus('Сбор остановлен.');
    setStatusTone('warn');
  }, []);

  const saveRows = useCallback(async () => {
    if (!canSaveRows || !pendingRows.length || saving) return;
    setSaving(true);
    setStatus('Записываю найденные релизы в Supabase...');
    setStatusTone('neutral');
    try {
      const result = await saveQuarterAnalysisRows(pendingRows, releaseFrom, rangeEnabled ? releaseTo : releaseFrom);
      setStatus(`Записано в БД: Android ${result.android}, iOS ${result.ios}.`);
      setStatusTone(result.total ? 'ok' : 'warn');
      log(`Supabase: записано Android ${result.android}, iOS ${result.ios}`, result.total ? 'ok' : 'warn');
      setPendingRows([]);
    } catch (error) {
      const message = (error as Error).message || 'Не удалось записать данные в Supabase.';
      setStatus(message);
      setStatusTone('error');
      log(message, 'error');
    } finally {
      setSaving(false);
    }
  }, [canSaveRows, log, pendingRows, rangeEnabled, releaseFrom, releaseTo, saving]);

  const startLogPanelResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = logPanelSize.width;
    const startHeight = logPanelSize.height;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const maxWidth = Math.max(320, window.innerWidth - 36);
      const maxHeight = Math.max(220, window.innerHeight - 36);
      setLogPanelSize({
        width: Math.min(maxWidth, Math.max(320, startWidth + startX - moveEvent.clientX)),
        height: Math.min(maxHeight, Math.max(220, startHeight + startY - moveEvent.clientY)),
      });
    };

    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [logPanelSize.height, logPanelSize.width]);

  const progressColor = statusTone === 'ok' ? 'green' : statusTone === 'warn' ? 'yellow' : statusTone === 'error' ? 'red' : 'accent';
  const activeReleaseTo = rangeEnabled ? releaseTo : releaseFrom;
  const csvRangeLabel = `${releaseFrom || 'release'}${rangeEnabled ? `-${activeReleaseTo || 'release'}` : ''}`.replace(/\s+/g, '');
  const canRunCollection = Boolean(releaseFrom.trim()) && (!rangeEnabled || Boolean(releaseTo.trim()));
  const showRunStatus = Boolean(status) || progress > 0 || busy || saving;
  const timingHeaderStyle = useMemo<React.CSSProperties>(() => ({ whiteSpace: 'nowrap' }), []);
  const activeControlStyle = useMemo<React.CSSProperties>(() => ({
    background: 'transparent',
    color: 'var(--accent)',
    boxShadow: 'none',
  }), []);
  const selectedChipStyle = useMemo<React.CSSProperties>(() => ({
    background: 'transparent',
    color: 'var(--accent)',
    borderColor: 'rgba(168,85,247,.46)',
    boxShadow: 'none',
    fontWeight: 660,
  }), []);
  const yearActiveStyle = useMemo<React.CSSProperties>(() => ({
    background: 'transparent',
    color: 'var(--accent)',
    borderColor: 'rgba(168,85,247,.46)',
    boxShadow: 'none',
  }), []);
  const toolbarSegmentStyle = useMemo<React.CSSProperties>(() => ({
    height: 36,
    padding: 0,
    alignItems: 'center',
    borderRadius: 9,
    background: 'var(--card)',
    border: '1.5px solid var(--border-hi)',
    overflow: 'hidden',
    gap: 0,
  }), []);
  const toolbarButtonStyle = useMemo<React.CSSProperties>(() => ({
    height: 34,
    minHeight: 34,
    minWidth: 92,
    padding: '0 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
  }), []);
  const periodSegmentStyle = useMemo<React.CSSProperties>(() => ({
    height: 36,
    padding: 0,
    alignItems: 'center',
    borderRadius: 9,
    background: 'var(--card)',
    border: '1.5px solid var(--border-hi)',
    overflow: 'hidden',
    gap: 0,
  }), []);
  const periodButtonStyle = useMemo<React.CSSProperties>(() => ({
    height: 34,
    minHeight: 34,
    minWidth: 54,
    padding: '0 10px',
    borderRadius: 0,
    border: 0,
    background: 'transparent',
    fontSize: 11,
    fontWeight: 700,
    boxSizing: 'border-box',
  }), []);
  const monthButtonStyle = useMemo<React.CSSProperties>(() => ({
    height: 34,
    minHeight: 34,
    minWidth: 74,
    padding: '0 10px',
    borderRadius: 8,
    border: '1.5px solid var(--border-hi)',
    background: 'var(--card)',
    color: 'var(--text-2)',
    fontSize: 11,
    fontWeight: 650,
    boxSizing: 'border-box',
  }), []);
  const yearSelectStyle = useMemo<React.CSSProperties>(() => ({
    width: 64,
    height: 34,
    padding: '0 8px',
    borderRadius: 8,
    border: '1.5px solid var(--border-hi)',
    background: 'transparent',
    color: 'var(--text-2)',
    fontSize: 11,
    fontWeight: 700,
    boxSizing: 'border-box',
  }), []);
  const toolbarEyeStyle = useMemo<React.CSSProperties>(() => ({
    width: 36,
    height: 36,
    borderRadius: 9,
    background: 'var(--card)',
  }), []);
  const visibleHotfixCount = visibleRows.length;
  const hotfixBadgeStyle = useMemo<React.CSSProperties>(() => ({
    width: 128,
    height: 36,
    minWidth: 128,
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(168,85,247,.13)',
    borderColor: 'rgba(168,85,247,.22)',
    color: 'var(--accent)',
    boxSizing: 'border-box',
    fontVariantNumeric: 'tabular-nums',
  }), []);
  const quarterChartBlocks = useMemo<QuarterChartBlock[]>(() => (
    [1, 2, 3, 4].map(quarterNumber => {
      const quarterRows = chartSourceRows.filter(row => branchCutDateParts(row)?.quarter === quarterNumber);
      return {
        quarter: quarterNumber,
        hotfixCount: quarterRows.length,
        taskCount: quarterRows.reduce((sum, row) => sum + taskCount(row), 0),
        monthlyCounts: buildQuarterMonthChartData(quarterRows, quarterNumber),
        streams: buildStreamChartData(quarterRows),
        locomotiveTypes: buildLocomotiveTypeChartData(quarterRows),
        reasons: buildReasonChartData(quarterRows),
      };
    })
  ), [chartSourceRows]);
  const allTableColumns = useMemo<Array<CanonicalTableColumn<QuarterAnalysisRow>>>(() => [
    {
      id: 'version',
      group: 'Задачи',
      title: (
        <ColumnFilterDropdown
          label="Версия"
          values={columnFilterValues.version}
          selectedValues={columnFilters.version}
          onChange={value => setColumnFilter('version', value)}
        />
      ),
      width: 96,
      sticky: 'left',
      align: 'center',
      headerStyle: { paddingLeft: 4, paddingRight: 4 },
      previewTitle: () => 'Версия',
      text: versionText,
      lineClamp: 3,
      cellStyle: { paddingLeft: 6, paddingRight: 6 },
      render: row => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%', textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 650, color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.version}</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Задач: {taskCount(row)}</span>
        </div>
      ),
    },
    {
      id: 'stream',
      group: 'Задачи',
      title: (
        <ColumnFilterDropdown
          label="Стрим"
          values={columnFilterValues.stream}
          selectedValues={columnFilters.stream}
          onChange={value => setColumnFilter('stream', value)}
        />
      ),
      width: 140,
      previewTitle: () => 'Стрим',
      text: row => dash(row.stream),
      lineClamp: 3,
    },
    {
      id: 'substream',
      group: 'Задачи',
      title: (
        <ColumnFilterDropdown
          label="Сабстрим"
          values={columnFilterValues.substream}
          selectedValues={columnFilters.substream}
          onChange={value => setColumnFilter('substream', value)}
        />
      ),
      width: 150,
      previewTitle: () => 'Сабстрим',
      text: row => dash(row.substream),
      lineClamp: 3,
    },
    {
      id: 'primaryTask',
      group: 'Задачи',
      title: 'Локомотивная задача',
      width: 280,
      render: row => issueCell(row.primaryTask),
      preview: row => row.primaryTask ? issueCell(row.primaryTask) : null,
      text: row => issueText(row.primaryTask),
      lineClamp: 4,
      disablePreview: true,
    },
    {
      id: 'secondaryTasks',
      group: 'Задачи',
      title: 'Вторичные задачи',
      width: 340,
      render: secondaryTasksCell,
      text: secondaryTasksText,
      preview: secondaryTasksPreview,
      previewTrigger: 'button',
      lineClamp: 3,
      showOverflowMarker: false,
    },
    { id: 'buildTime', group: 'Тайминги', title: 'Время сборки', width: 150, text: row => dash(row.buildTime), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'previousRolloutPercent', group: 'Тайминги', title: '% раскатки предыдущей версии', width: 240, text: row => dash(row.previousRolloutPercent), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'plannedHotfixDate', group: 'Тайминги', title: 'План дата отправки ХФ', width: 205, text: row => dash(row.plannedHotfixDate), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'branchCutTime', group: 'Тайминги', title: 'Время отведения ХФ', width: 180, text: row => dash(row.branchCutTime), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'actualSendTime', group: 'Тайминги', title: 'Фактическая дата отправки', width: 205, text: row => dash(row.actualSendTime), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'onePercentDate', group: 'Тайминги', title: 'Дата раскатки на 1%', width: 175, text: row => dash(row.onePercentDate), lineClamp: 2, headerStyle: timingHeaderStyle },
    { id: 'hotfixReason', group: 'Хотфикс', title: 'Причина ХФ', width: 260, text: row => dash(row.hotfixReason), lineClamp: 3 },
    { id: 'hotfixDetails', group: 'Хотфикс', title: 'Детали ХФ', width: 260, text: row => dash(row.hotfixDetails), lineClamp: 3 },
  ], [columnFilterValues, columnFilters, setColumnFilter, timingHeaderStyle]);

  const visibleTableColumns = useMemo(() => {
    const visible = new Set(visibleColumnIds);
    return allTableColumns.filter(column => visible.has(column.id));
  }, [allTableColumns, visibleColumnIds]);

  const visibleTableMinWidth = useMemo(() => {
    if (!visibleTableColumns.length) return 720;
    const width = visibleTableColumns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 140), 0);
    return Math.max(720, width + 24);
  }, [visibleTableColumns]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Релиз:</span>
              <Input
                value={releaseFrom}
                onChange={event => updateRelease(event.target.value)}
                placeholder="7.5.6000"
                style={{ width: 112, height: 34, padding: '6px 10px', minWidth: 0 }}
              />
              <label
                title="Собирать несколько мажорных релизов"
                style={{
                  height: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '0 9px',
                  borderRadius: 8,
                  border: `1.5px solid ${rangeEnabled ? 'rgba(168,85,247,.46)' : 'var(--border-hi)'}`,
                  background: 'var(--card)',
                  color: rangeEnabled ? 'var(--accent)' : 'var(--text-2)',
                  fontSize: 11,
                  fontWeight: 650,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={rangeEnabled}
                  onChange={event => updateRangeEnabled(event.target.checked)}
                  style={{ margin: 0, accentColor: 'var(--accent)' }}
                />
                <span>Диапазон</span>
              </label>
              {rangeEnabled && (
                <>
                  <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--text-3)' }}>по</span>
                  <Input
                    value={releaseTo}
                    onChange={event => updateReleaseTo(event.target.value)}
                    placeholder="7.6.0000"
                    style={{ width: 112, height: 34, padding: '6px 10px', minWidth: 0 }}
                  />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busy ? (
                <Button variant="danger" onClick={stop}>Остановить</Button>
              ) : (
                <Button variant="primary" disabled={loadingSaved || pendingRows.length > 0 || !canRunCollection} onClick={() => void run()}>Собрать</Button>
              )}
              {canSaveRows && (
                <Button
                  variant="secondary"
                  disabled={!pendingRows.length || busy || saving || loadingSaved}
                  onClick={() => void saveRows()}
                  style={{
                    borderColor: pendingRows.length ? 'rgba(34,197,94,.32)' : undefined,
                    color: pendingRows.length ? '#4ADE80' : undefined,
                  }}
                >
                  {saving ? 'Записываю...' : 'Записать'}
                </Button>
              )}
              <Button variant="secondary" disabled={!visibleRows.length || loadingSaved} onClick={() => exportCsv(visibleRows, platform, csvRangeLabel)}>CSV</Button>
              <Button variant="secondary" disabled={!visibleRows.length || loadingSaved} onClick={() => exportPdf(visibleRows, platform, csvRangeLabel)}>PDF</Button>
            </div>
          </div>
          {showRunStatus && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: statusTone === 'error' ? '#F87171' : statusTone === 'warn' ? '#FCD34D' : statusTone === 'ok' ? '#4ADE80' : 'var(--text-2)' }}>{status}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{progress}%</span>
              </div>
              <Progress value={progress} color={progressColor} height={7} />
            </div>
          )}
        </CardBody>
      </Card>

      <Card style={{
        borderRadius: 10,
        border: '1.5px solid var(--border-hi)',
        boxShadow: '0 8px 22px rgba(15,23,42,.06)',
        overflow: 'visible',
      }}>
        <CardBody style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'start',
          gap: 12,
          minHeight: 84,
          padding: '12px 16px',
          overflow: 'visible',
        }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 220, flex: '0 1 240px', paddingRight: 12, borderRight: '1.5px solid var(--border-hi)', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text)', letterSpacing: 0 }}>Платформа</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'nowrap' }}>
              <SegmentControl
                items={[
                  { label: <SegmentLabel icon={<AndroidIcon />}>Android</SegmentLabel>, value: 'android' },
                  { label: <SegmentLabel icon={<IosIcon />}>iOS</SegmentLabel>, value: 'ios' },
                ]}
                value={platform}
                onChange={value => {
                  const nextPlatform = value as PlatformKey;
                  setPlatform(nextPlatform);
                  setYear(defaultYearForRows(rows, nextPlatform));
                  setQuarter('all');
                  setSelectedMonths(null);
                }}
                style={toolbarSegmentStyle}
                buttonStyle={toolbarButtonStyle}
                activeButtonStyle={activeControlStyle}
                activeMode="underline"
              />
              <ColumnVisibilityDropdown
                columns={RELEASE_ANALYSIS_COLUMN_OPTIONS}
                visibleColumnIds={visibleColumnIds}
                onChange={updateVisibleColumnIds}
                buttonStyle={toolbarEyeStyle}
              />
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 310, flex: '1 1 340px', paddingRight: 12, borderRight: '1.5px solid var(--border-hi)', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text)', letterSpacing: 0 }}>Режим</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'nowrap' }}>
              <SegmentControl
                items={[
                  { label: <SegmentLabel icon={<TableIcon />}>Таблица</SegmentLabel>, value: 'table' },
                  { label: <SegmentLabel icon={<ChartsIcon />}>Графики</SegmentLabel>, value: 'charts' },
                ]}
                value={activeTab}
                onChange={value => setActiveTab(value as AnalysisTab)}
                style={toolbarSegmentStyle}
                buttonStyle={toolbarButtonStyle}
                activeButtonStyle={activeControlStyle}
                activeMode="underline"
              />
              <Badge color={visibleHotfixCount ? 'purple' : 'gray'} style={hotfixBadgeStyle}>
                <HotfixIcon />
                Хотфиксы: <AnimatedCounter value={visibleHotfixCount} />
              </Badge>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 420, flex: '999 1 520px', paddingRight: 12, borderRight: '1.5px solid var(--border-hi)', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text)', letterSpacing: 0 }}>Период</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap', overflow: 'visible' }}>
              <SegmentControl
                items={[
                  { label: 'Все', value: 'all' },
                  ...[1, 2, 3, 4].map(index => {
                    const disabled = !availableQuarters.includes(index);
                    return {
                      label: `Q${index}`,
                      value: String(index),
                      disabled,
                      title: disabled ? `Не найдено хотфиксов для квартала Q${index}` : undefined,
                    };
                  }),
                ]}
                value={quarter}
                onChange={value => {
                  setQuarter(value);
                  setSelectedMonths(null);
                }}
                style={periodSegmentStyle}
                buttonStyle={periodButtonStyle}
                activeButtonStyle={activeControlStyle}
                activeMode="underline"
                showSeparators={false}
              />
              {availableMonths.length > 0 && (
                <div
                  key={`${platform}:${year}:${quarter}:${availableMonths.join(',')}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'nowrap',
                    gap: 7,
                    flexShrink: 0,
                    animation: 'release-months-in .22s ease both',
                  }}
                >
                  {availableMonths.map(index => {
                    const selected = selectedMonthSet.has(index);
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleSelectedMonth(index)}
                        style={{
                          ...monthButtonStyle,
                          ...(selected ? selectedChipStyle : {}),
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'color .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease',
                        }}
                      >
                        {MONTHS[index]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {availableYears.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 112, flex: '0 0 112px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text)', letterSpacing: 0 }}>Год</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <button
                  type="button"
                  onClick={() => {
                    setYear('all');
                    setSelectedMonths(null);
                  }}
                  style={{
                    ...monthButtonStyle,
                    minWidth: 54,
                    ...(year === 'all' ? yearActiveStyle : {}),
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Все
                </button>
                <YearDropdown
                  years={availableYears}
                  value={year}
                  buttonStyle={yearSelectStyle}
                  activeStyle={yearActiveStyle}
                  onChange={value => {
                    setYear(value);
                    setSelectedMonths(null);
                  }}
                />
              </div>
            </section>
          )}
        </CardBody>
        {activeTab === 'table' ? (
          <CanonicalTable
            rows={visibleRows}
            columns={visibleTableColumns}
            getRowKey={quarterRowKey}
            isRowHighlighted={row => freshRowKeys.has(quarterRowKey(row))}
            rowHeight={releaseQuarterRowHeight}
            maxHeight="72vh"
            minWidth={visibleTableMinWidth}
            overscanRight={18}
            loading={loadingSaved}
            loadingText="Загружаю сохраненные релизы..."
            emptyText="Данных по выбранному фильтру нет."
            emptyColumnsText="Не выбрано ни одной колонки"
            columnResizeStorageKey={COLUMN_WIDTHS_STORAGE_KEY}
          />
        ) : (
          <QuarterChartsView
            blocks={quarterChartBlocks}
            scopeKey={`${platform}:${year}:${quarter}`}
          />
        )}
      </Card>
      {SHOW_RELEASE_ANALYSIS_FLOATING_LOGS && logs.length > 0 && !logPanelOpen && (
        <button
          type="button"
          onClick={() => setLogPanelOpen(true)}
          title="Открыть лог сбора"
          aria-label="Открыть лог сбора"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 520,
            width: 46,
            height: 46,
            borderRadius: 12,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            color: 'var(--text)',
            boxShadow: '0 14px 42px rgba(0,0,0,.24)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 900,
          }}
        >
          ≡
          <span
            style={{
              position: 'absolute',
              top: -7,
              right: -7,
              minWidth: 20,
              height: 20,
              padding: '0 5px',
              borderRadius: 999,
              background: busy ? '#A855F7' : statusTone === 'error' ? '#EF4444' : '#64748B',
              color: '#fff',
              fontSize: 10,
              lineHeight: '20px',
              fontWeight: 800,
              border: '2px solid var(--card)',
            }}
          >
            {logs.length}
          </span>
        </button>
      )}
      {SHOW_RELEASE_ANALYSIS_FLOATING_LOGS && logs.length > 0 && logPanelOpen && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 520,
            width: logPanelSize.width,
            height: logPanelSize.height,
            minWidth: 320,
            minHeight: 220,
            maxWidth: 'calc(100vw - 36px)',
            maxHeight: 'calc(100vh - 36px)',
            border: '1.5px solid var(--border-hi)',
            borderRadius: 12,
            background: 'var(--card)',
            boxShadow: '0 20px 70px rgba(0,0,0,.30)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <button
            type="button"
            onMouseDown={startLogPanelResize}
            title="Изменить размер"
            aria-label="Изменить размер лога"
            style={{
              position: 'absolute',
              left: -1,
              top: -1,
              zIndex: 2,
              width: 18,
              height: 18,
              border: '1px solid var(--border-hi)',
              borderRadius: '12px 0 8px 0',
              background: 'var(--surface-soft-2)',
              cursor: 'nwse-resize',
              padding: 0,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--card-hi)' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>Лог сбора</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge color={busy ? 'purple' : statusTone === 'error' ? 'red' : statusTone === 'warn' ? 'yellow' : 'gray'}>{logs.length}</Badge>
              <button
                type="button"
                onClick={() => setLogPanelOpen(false)}
                title="Скрыть лог"
                aria-label="Скрыть лог"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  border: '1px solid var(--border-hi)',
                  background: 'var(--surface-soft)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 15,
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </div>
          </div>
          <div style={{ padding: 10, flex: 1, minHeight: 0 }}>
            <LogView lines={logs} maxHeight="100%" style={{ height: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}
    </div>
  );
}
