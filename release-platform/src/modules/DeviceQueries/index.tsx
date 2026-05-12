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
  Input,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy } from '../../services/proxy';
import {
  BI_DEVICE_QUERY_DEFINITIONS,
  fetchBiDeviceQuery,
  type BiDeviceQueryDefinition,
  type BiDeviceQueryKind,
  type BiDeviceQueryPayload,
  type BiDeviceQueryRow,
} from '../../services/youtrack';

Chart.register(BarController, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const ACTIVE_QUERY_KEY = 'bi_device_queries_active_v1';
const SEARCH_KEY = 'bi_device_queries_search_v1';
const USER_SEARCH_KEY = 'bi_device_queries_user_search_v1';
const MAX_VISIBLE_ROWS = 600;
const TOP_ANALYTICS_LIMIT = 10;
const FOLD_MODEL_COLUMN = 'Нормализованная модель';

type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';

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

interface QueryAnalyticsItem {
  label: string;
  value: number;
  rows: number;
}

interface QueryAnalytics {
  modelColumn: string;
  manufacturerColumn: string;
  platformColumn: string;
  usersColumn: string;
  shareColumn: string;
  topTitle: string;
  totalUsers: number;
  uniqueModels: number;
  uniqueManufacturers: number;
  uniquePlatforms: number;
  topItems: QueryAnalyticsItem[];
  secondaryItems: QueryAnalyticsItem[];
  foldModels: QueryAnalyticsItem[];
  warnings: string[];
}

function readText(key: string, fallback = '') {
  try {
    return String(localStorage.getItem(key) || fallback);
  } catch {
    return fallback;
  }
}

function writeText(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)));
}

function formatValue(value: string | number | null | undefined) {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') {
    if (Math.abs(value) < 1 && value !== 0) return `${(value * 100).toFixed(2)}%`;
    return formatNumber(value);
  }
  return value;
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

function statusBadgeColor(tone: StatusTone): 'gray' | 'green' | 'yellow' | 'red' {
  if (tone === 'ok') return 'green';
  if (tone === 'warn') return 'yellow';
  if (tone === 'error') return 'red';
  return 'gray';
}

function normalizeSearch(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .replace(/[™©®]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value: string) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '')
    .replace('%', '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

const COLUMN_LABELS: Partial<Record<BiDeviceQueryKind, string[]>> = {
  manufacturers: ['Платформа', 'Производитель', 'Пользователи'],
  userDevices: ['Пользователь', 'Платформа', 'Производитель', 'Модель', 'Устройство', 'Дата', 'Пользователи'],
  platformShare: ['Платформа', 'Пользователи', 'Доля'],
  tablets: ['Платформа', 'Производитель', 'Модель', 'Пользователи', 'Доля'],
  ipads: ['Модель', 'Пользователи', 'Доля'],
  foldList: ['Модель', 'Производитель', 'Пользователи', 'Доля'],
  foldCount: ['Платформа', 'FOLD-модель', 'Пользователи', 'Доля'],
  androidManufacturers: ['Платформа', 'Производитель', 'Пользователи'],
};

function colIndex(column: string) {
  const match = String(column || '').match(/^col_(\d+)$/i);
  return match ? Number(match[1]) - 1 : -1;
}

function columnLabel(kind: BiDeviceQueryKind, column: string) {
  if (column === FOLD_MODEL_COLUMN) return FOLD_MODEL_COLUMN;
  const index = colIndex(column);
  if (index >= 0) return COLUMN_LABELS[kind]?.[index] || `Колонка ${index + 1}`;
  return column;
}

function semanticColumns(kind: BiDeviceQueryKind, columns: string[]) {
  return columns.map(column => ({ column, key: normalizeKey(`${column} ${columnLabel(kind, column)}`) }));
}

function findSemanticColumn(kind: BiDeviceQueryKind, columns: string[], includes: string[], fallback = '') {
  const lowered = semanticColumns(kind, columns);
  for (const needle of includes) {
    const found = lowered.find(item => item.key.includes(needle));
    if (found) return found.column;
  }
  return fallback;
}

function findModelColumn(kind: BiDeviceQueryKind, columns: string[]) {
  return findSemanticColumn(kind, columns, ['model', 'модель', 'device', 'устрой', 'release', 'name', 'назван', 'fold'], '');
}

function findManufacturerColumn(kind: BiDeviceQueryKind, columns: string[]) {
  return findSemanticColumn(kind, columns, ['manufacturer', 'vendor', 'brand', 'производ', 'бренд'], '');
}

function findPlatformColumn(kind: BiDeviceQueryKind, columns: string[]) {
  return findSemanticColumn(kind, columns, ['platform', 'платформ', 'os_name'], '');
}

function findUsersColumn(kind: BiDeviceQueryKind, columns: string[]) {
  return findSemanticColumn(kind, columns, ['users', 'user', 'польз', 'count', 'cnt', 'количество', 'value', 'total'], '');
}

function findShareColumn(kind: BiDeviceQueryKind, columns: string[]) {
  return findSemanticColumn(kind, columns, ['share', 'percent', 'процент', 'доля', '%'], '');
}

function rowValue(row: BiDeviceQueryRow, column: string) {
  return column ? row.values[column] : null;
}

function rowText(row: BiDeviceQueryRow, column: string) {
  return normalizeText(rowValue(row, column));
}

function firstNonEmpty(row: BiDeviceQueryRow, columns: string[]) {
  for (const column of columns) {
    const value = rowText(row, column);
    if (value) return value;
  }
  return '';
}

function groupRows(rows: BiDeviceQueryRow[], labelFor: (row: BiDeviceQueryRow) => string, valueFor: (row: BiDeviceQueryRow) => number) {
  const map = new Map<string, QueryAnalyticsItem>();
  rows.forEach(row => {
    const label = normalizeText(labelFor(row)) || '—';
    const current = map.get(label) || { label, value: 0, rows: 0 };
    current.value += valueFor(row);
    current.rows += 1;
    map.set(label, current);
  });
  return [...map.values()].sort((left, right) => right.value - left.value || right.rows - left.rows);
}

function shareToPercent(value: unknown) {
  const numeric = toNumber(value);
  return numeric <= 1 ? numeric * 100 : numeric;
}

function normalizeBrand(value: unknown) {
  const raw = normalizeText(value);
  const key = raw
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\b(co|company|corp|corporation|inc|incorporated|ltd|limited|llc|mobile|mobility|technology|technologies|electronics|communication|communications|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!key) return '';
  if (key.includes('samsung')) return 'Samsung';
  if (key.includes('xiaomi') || key === 'redmi' || key === 'poco') return 'Xiaomi';
  if (key.includes('honor')) return 'HONOR';
  if (key.includes('huawei')) return 'HUAWEI';
  if (key.includes('tecno')) return 'TECNO';
  if (key.includes('infinix')) return 'INFINIX';
  if (key.includes('realme')) return 'realme';
  if (key.includes('oneplus') || key.includes('one plus')) return 'OnePlus';
  if (key.includes('oppo')) return 'OPPO';
  if (key.includes('vivo')) return 'vivo';
  if (key.includes('google') || key.includes('pixel')) return 'Google';
  if (key.includes('nothing')) return 'Nothing';
  if (key.includes('motorola') || key === 'moto') return 'motorola';
  if (key.includes('blackview')) return 'Blackview';
  if (key.includes('itel')) return 'ITEL';
  if (key.includes('apple')) return 'Apple';

  return raw
    .replace(/\b(MOBILE|MOBILITY|LIMITED|LTD|INC|CORP|CORPORATION|COMPANY|TECHNOLOGY|TECHNOLOGIES|ELECTRONICS)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function aggregateRowsByBrand(
  kind: BiDeviceQueryKind,
  rows: BiDeviceQueryRow[],
  columns: string[],
): BiDeviceQueryRow[] {
  if (kind !== 'manufacturers' && kind !== 'androidManufacturers') return rows;

  const platformColumn = findPlatformColumn(kind, columns);
  const manufacturerColumn = findManufacturerColumn(kind, columns);
  const usersColumn = findUsersColumn(kind, columns);
  const shareColumn = findShareColumn(kind, columns);
  if (!manufacturerColumn || !usersColumn) return rows;

  const grouped = new Map<string, BiDeviceQueryRow & { sortValue: number }>();
  rows.forEach(row => {
    const platform = rowText(row, platformColumn);
    const brand = normalizeBrand(rowValue(row, manufacturerColumn));
    if (!brand) return;

    const key = `${platform.toLowerCase()}::${brand.toLowerCase()}`;
    const users = toNumber(rowValue(row, usersColumn));
    const share = shareColumn ? shareToPercent(rowValue(row, shareColumn)) : 0;
    const existing = grouped.get(key);

    if (existing) {
      existing.values[usersColumn] = toNumber(existing.values[usersColumn]) + users;
      if (shareColumn) existing.values[shareColumn] = shareToPercent(existing.values[shareColumn]) + share;
      existing.searchText = `${existing.searchText} ${row.searchText} ${brand}`.toLowerCase();
      existing.sortValue += users || share || 1;
      return;
    }

    grouped.set(key, {
      ...row,
      values: {
        ...row.values,
        ...(platformColumn ? { [platformColumn]: platform } : {}),
        [manufacturerColumn]: brand,
        [usersColumn]: users,
        ...(shareColumn ? { [shareColumn]: share } : {}),
      },
      searchText: `${row.searchText} ${platform} ${brand}`.toLowerCase(),
      sortValue: users || share || 1,
    });
  });

  return [...grouped.values()]
    .sort((left, right) => right.sortValue - left.sortValue)
    .map(({ sortValue, ...row }) => row);
}

function cleanFoldModel(value: string) {
  const text = normalizeText(value)
    .replace(/^[\d.)\]-]+\s*/, '')
    .replace(/["'`]/g, '')
    .replace(/\b(unknown|null|undefined)\b/ig, '')
    .trim();
  if (!text) return '';

  const knownPatterns = [
    /(?:samsung\s+)?galaxy\s+z\s+fold\s*(?:special edition|se|[2-9])?/i,
    /(?:samsung\s+)?galaxy\s+fold\b/i,
    /\bsm-f\d{3}[a-z0-9/.-]*/i,
    /\bpixel\s+fold\b/i,
    /\boneplus\s+open\b/i,
    /\b(?:xiaomi\s+)?mix\s+fold\s*\d*/i,
    /\b(?:honor\s+)?magic\s+v(?:s|2|3)?\b/i,
    /\b(?:huawei\s+)?mate\s+x(?:s|2|3|5)?\b/i,
    /\b(?:oppo\s+)?find\s+n\d?\b/i,
    /\b(?:vivo\s+)?x\s+fold\s*\d*\b/i,
    /\b(?:tecno\s+)?phantom\s+v\s+fold\b/i,
  ];

  for (const pattern of knownPatterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return normalizeText(match[0])
        .replace(/\bsamsung galaxy z fold special edition\b/i, 'Samsung Galaxy Z Fold Special Edition')
        .replace(/\bsamsung galaxy\b/i, 'Samsung Galaxy')
        .replace(/\bgalaxy\b/i, 'Galaxy')
        .replace(/\bpixel\b/i, 'Pixel')
        .replace(/\boneplus\b/i, 'OnePlus')
        .replace(/\bxiaomi\b/i, 'Xiaomi')
        .replace(/\bhonor\b/i, 'Honor')
        .replace(/\bhuawei\b/i, 'Huawei')
        .replace(/\boppo\b/i, 'Oppo')
        .replace(/\bvivo\b/i, 'Vivo')
        .replace(/\btecno\b/i, 'Tecno')
        .replace(/\bsm-f/i, 'SM-F');
    }
  }

  return text
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*-\s*fold.*/i, '')
    .trim();
}

function extractFoldModelsFromText(value: string) {
  const source = normalizeText(value);
  if (!source) return [] as string[];
  const parts = source
    .split(/[\n;,|]+|(?:\s{2,})/g)
    .map(cleanFoldModel)
    .filter(Boolean);
  return Array.from(new Set(parts.length ? parts : [cleanFoldModel(source)].filter(Boolean)));
}

function foldModelsForRow(row: BiDeviceQueryRow, columns: string[], modelColumn: string) {
  const source = modelColumn ? rowText(row, modelColumn) : firstNonEmpty(row, columns);
  const fromModel = extractFoldModelsFromText(source);
  if (fromModel.length) return fromModel;
  return columns.flatMap(column => extractFoldModelsFromText(rowText(row, column)));
}

function queryByKind(kind: string): BiDeviceQueryDefinition {
  return BI_DEVICE_QUERY_DEFINITIONS.find(item => item.kind === kind) || BI_DEVICE_QUERY_DEFINITIONS[0];
}

function rowMatches(row: BiDeviceQueryRow, needles: string[]) {
  if (!needles.length) return true;
  return needles.every(needle => row.searchText.includes(needle));
}

function buildCsv(query: BiDeviceQueryDefinition, columns: string[], rows: BiDeviceQueryRow[]) {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    columns.map(column => escape(columnLabel(query.kind, column))).join(','),
    ...rows.map(row => columns.map(column => escape(row.values[column])).join(',')),
  ].join('\n');
}

function downloadCsv(query: BiDeviceQueryDefinition, columns: string[], rows: BiDeviceQueryRow[]) {
  const csv = buildCsv(query, columns, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bi-device-query-${query.kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildQueryAnalytics(
  query: BiDeviceQueryDefinition,
  payload: BiDeviceQueryPayload | null,
  rows: BiDeviceQueryRow[],
): QueryAnalytics {
  const rawColumns = payload?.columns?.length ? payload.columns : ['value'];
  const columns = query.kind === 'foldList' ? [FOLD_MODEL_COLUMN, ...rawColumns] : rawColumns;
  const modelColumn = findModelColumn(query.kind, columns);
  const manufacturerColumn = findManufacturerColumn(query.kind, columns);
  const platformColumn = findPlatformColumn(query.kind, columns);
  const usersColumn = findUsersColumn(query.kind, columns);
  const shareColumn = findShareColumn(query.kind, columns);
  const valueFor = (row: BiDeviceQueryRow) => {
    const users = usersColumn ? toNumber(rowValue(row, usersColumn)) : 0;
    if (users > 0) return users;
    const share = shareColumn ? shareToPercent(rowValue(row, shareColumn)) : 0;
    return share > 0 ? share : 1;
  };
  const modelLabel = (row: BiDeviceQueryRow) => {
    const manufacturer = rowText(row, manufacturerColumn);
    const model = rowText(row, modelColumn);
    if (!manufacturer) return model || firstNonEmpty(row, columns);
    if (!model) return manufacturer;
    return model.toLowerCase().startsWith(manufacturer.toLowerCase()) ? model : `${manufacturer} ${model}`;
  };
  const manufacturerLabel = (row: BiDeviceQueryRow) => rowText(row, manufacturerColumn) || rowText(row, modelColumn) || firstNonEmpty(row, columns);
  const platformLabel = (row: BiDeviceQueryRow) => rowText(row, platformColumn) || firstNonEmpty(row, columns);

  const modelGroups = groupRows(rows, modelLabel, valueFor);
  const manufacturerGroups = groupRows(rows, manufacturerLabel, valueFor);
  const platformGroups = groupRows(rows, platformLabel, valueFor);
  const foldModels = query.kind === 'foldList'
    ? groupRows(rows, row => foldModelsForRow(row, columns, modelColumn).join(' · ') || modelLabel(row), valueFor)
      .flatMap(item => item.label.split(' · ').map(label => ({ ...item, label })))
      .reduce<QueryAnalyticsItem[]>((acc, item) => {
        const existing = acc.find(entry => entry.label === item.label);
        if (existing) {
          existing.value += item.value;
          existing.rows += item.rows;
        } else {
          acc.push({ ...item });
        }
        return acc;
      }, [])
      .sort((left, right) => right.value - left.value || right.rows - left.rows)
    : [];

  const topByKind: Record<BiDeviceQueryKind, { title: string; items: QueryAnalyticsItem[]; secondary: QueryAnalyticsItem[] }> = {
    manufacturers: { title: 'Топ производителей', items: manufacturerGroups, secondary: modelGroups },
    userDevices: { title: 'Устройства пользователя', items: modelGroups, secondary: platformGroups },
    platformShare: { title: 'Платформы', items: platformGroups, secondary: modelGroups },
    tablets: { title: 'Планшеты по моделям', items: modelGroups, secondary: manufacturerGroups },
    ipads: { title: 'iPad по моделям', items: modelGroups, secondary: manufacturerGroups },
    foldList: { title: 'FOLD модели', items: foldModels.length ? foldModels : modelGroups, secondary: manufacturerGroups },
    foldCount: { title: 'Подсчёт FOLD', items: modelGroups, secondary: manufacturerGroups },
    androidManufacturers: { title: 'Android производители', items: manufacturerGroups, secondary: modelGroups },
  };

  const selected = topByKind[query.kind];
  const warnings: string[] = [];
  const modelRequired = query.kind === 'userDevices' || query.kind === 'tablets' || query.kind === 'ipads' || query.kind === 'foldList';
  if (rows.length && modelRequired && !modelColumn) warnings.push('Колонка модели не определена автоматически.');
  if (rows.length && query.kind !== 'platformShare' && !usersColumn && !shareColumn) warnings.push('Нет явной числовой колонки users/share, график считает строки.');
  if (query.kind === 'foldList' && rows.length && !foldModels.length) warnings.push('FOLD-модели не распознаны, используется исходное значение строки.');

  return {
    modelColumn,
    manufacturerColumn,
    platformColumn,
    usersColumn,
    shareColumn,
    topTitle: selected.title,
    totalUsers: rows.reduce((sum, row) => sum + valueFor(row), 0),
    uniqueModels: modelColumn ? new Set(modelGroups.map(item => item.label).filter(label => label !== '—')).size : 0,
    uniqueManufacturers: new Set(manufacturerGroups.map(item => item.label).filter(label => label !== '—')).size,
    uniquePlatforms: new Set(platformGroups.map(item => item.label).filter(label => label !== '—')).size,
    topItems: selected.items.slice(0, TOP_ANALYTICS_LIMIT),
    secondaryItems: selected.secondary.slice(0, 6),
    foldModels: foldModels.slice(0, TOP_ANALYTICS_LIMIT),
    warnings,
  };
}

function QueryBarChart({
  title,
  items,
  color,
  themeColors,
}: {
  title: string;
  items: QueryAnalyticsItem[];
  color: string;
  themeColors: ChartThemeColors;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !items.length) return;
    chartRef.current?.destroy();

    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map(item => item.label),
        datasets: [{
          label: title,
          data: items.map(item => Number(item.value.toFixed(2))),
          backgroundColor: (context: { chart: Chart }) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return hexToRgba(color, 0.48);
            return createVerticalGradient(ctx, chartArea, color, 0.68, 0.24);
          },
          hoverBackgroundColor: hexToRgba(color, 0.78),
          borderColor: color,
          borderWidth: 1.3,
          borderRadius: 7,
          borderSkipped: false,
          barPercentage: 0.74,
          categoryPercentage: 0.8,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 6, right: 14, bottom: 8, left: 2 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: hexToRgba(themeColors.surface, 0.96),
            titleColor: themeColors.text,
            bodyColor: themeColors.text2,
            borderColor: themeColors.border,
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            titleFont: { family: themeColors.font, size: 12, weight: 700 },
            bodyFont: { family: themeColors.mono, size: 11, weight: 500 },
            callbacks: {
              label: context => {
                const item = items[context.dataIndex];
                return `${formatNumber(Number(context.raw || 0))} · ${formatNumber(item?.rows || 0)} строк`;
              },
            },
          },
        },
        scales: {
          x: {
            border: { color: themeColors.border },
            grid: { color: themeColors.grid },
            ticks: { color: themeColors.text3, font: { size: 10, family: themeColors.mono } },
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
  }, [color, items, themeColors, title]);

  if (!items.length) return <EmptyState text="Недостаточно данных для графика." />;
  const height = Math.min(340, Math.max(220, items.length * 30 + 42));
  return (
    <div style={{ height, maxHeight: 340, minHeight: 220, overflow: 'hidden', position: 'relative' }}>
      <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}

function AnalyticsList({ title, items }: { title: string; items: QueryAnalyticsItem[] }) {
  if (!items.length) return null;
  const max = Math.max(1, ...items.map(item => item.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
      {items.map(item => {
        const pct = Math.max(3, Math.round((item.value / max) * 100));
        return (
          <div key={item.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 86px', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(item.value)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-soft-4)', overflow: 'hidden', marginTop: 4 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #9B5CFF, rgba(34,197,94,.72))', borderRadius: 99 }} />
              </div>
            </div>
            <Badge color="gray">{formatNumber(item.rows)} строк</Badge>
          </div>
        );
      })}
    </div>
  );
}

function queryShortLabel(kind: BiDeviceQueryKind) {
  const labels: Record<BiDeviceQueryKind, string> = {
    manufacturers: 'Производители',
    userDevices: 'Пользователь',
    platformShare: 'Платформы',
    tablets: 'Tablets',
    ipads: 'iPad',
    foldList: 'FOLD список',
    foldCount: 'FOLD count',
    androidManufacturers: 'Android 100%',
  };
  return labels[kind];
}

function QueryButton({
  query,
  active,
  loaded,
  onClick,
}: {
  query: BiDeviceQueryDefinition;
  active: boolean;
  loaded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        whiteSpace: 'nowrap',
        textAlign: 'center',
        border: `1px solid ${active ? 'rgba(155,92,255,.48)' : 'var(--border)'}`,
        background: active ? 'rgba(155,92,255,.12)' : 'var(--surface-soft)',
        color: 'var(--text)',
        borderRadius: 7,
        padding: '0 10px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 800,
      }}
      title={query.description}
    >
      <span>{queryShortLabel(query.kind)}</span>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: loaded ? '#22C55E' : 'var(--text-3)', opacity: loaded ? 1 : 0.45 }} />
    </button>
  );
}

export function DeviceQueries() {
  const { settings } = useSettings();
  const [activeKind, setActiveKind] = useState<BiDeviceQueryKind>(() => queryByKind(readText(ACTIVE_QUERY_KEY)).kind);
  const [search, setSearch] = useState(() => readText(SEARCH_KEY));
  const [userSearch, setUserSearch] = useState(() => readText(USER_SEARCH_KEY));
  const [payloads, setPayloads] = useState<Partial<Record<BiDeviceQueryKind, BiDeviceQueryPayload>>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Выберите BI-запрос и загрузите данные.');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [error, setError] = useState('');
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>(settings.useProxy === false ? 'ok' : 'unknown');

  const activeQuery = useMemo(() => queryByKind(activeKind), [activeKind]);
  const activePayload = payloads[activeKind] || null;

  useEffect(() => writeText(ACTIVE_QUERY_KEY, activeKind), [activeKind]);
  useEffect(() => writeText(SEARCH_KEY, search), [search]);
  useEffect(() => writeText(USER_SEARCH_KEY, userSearch), [userSearch]);

  useEffect(() => {
    let cancelled = false;
    if (settings.useProxy === false) {
      setProxyState('ok');
      return;
    }
    if (!String(settings.proxyBase || '').trim()) {
      setProxyState('error');
      return;
    }
    checkProxy(settings.proxyBase)
      .then(ok => { if (!cancelled) setProxyState(ok ? 'ok' : 'error'); })
      .catch(() => { if (!cancelled) setProxyState('error'); });
    return () => { cancelled = true; };
  }, [settings.proxyBase, settings.useProxy]);

  const loadQuery = useCallback(async (query = activeQuery) => {
    if (!String(settings.biCookie || '').trim()) {
      setStatus('Нужен WB BI Cookie в общих настройках.');
      setStatusTone('error');
      setError('Нужен WB BI Cookie в общих настройках.');
      return;
    }

    setLoading(true);
    setError('');
    setStatus(`Загружаю «${query.title}»...`);
    setStatusTone('neutral');

    try {
      const nextPayload = await fetchBiDeviceQuery({
        base: settings.ytBase,
        token: settings.ytToken,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        biCookie: settings.biCookie,
      }, query, {
        searchValue: query.kind === 'userDevices' ? userSearch : undefined,
      });
      setPayloads(prev => ({ ...prev, [query.kind]: nextPayload }));
      setStatus(`«${query.title}» загружен: ${nextPayload.rows.length} строк.`);
      setStatusTone('ok');
    } catch (rawError) {
      const message = (rawError as Error).message || 'Не удалось загрузить BI-запрос.';
      setError(message);
      setStatus(message);
      setStatusTone('error');
    } finally {
      setLoading(false);
    }
  }, [activeQuery, settings, userSearch]);

  const loadAll = useCallback(async () => {
    for (const query of BI_DEVICE_QUERY_DEFINITIONS) {
      setActiveKind(query.kind);
      await loadQuery(query);
    }
  }, [loadQuery]);

  const filteredRows = useMemo(() => {
    if (!activePayload) return [] as BiDeviceQueryRow[];
    const needles = [
      ...normalizeSearch(search).split(' ').filter(Boolean),
      ...(activeKind === 'userDevices' ? normalizeSearch(userSearch).split(' ').filter(Boolean) : []),
    ];
    return activePayload.rows.filter(row => rowMatches(row, needles));
  }, [activeKind, activePayload, search, userSearch]);

  const columns = activePayload?.columns?.length ? activePayload.columns : ['value'];
  const displayRows = useMemo<BiDeviceQueryRow[]>(() => {
    const brandRows = aggregateRowsByBrand(activeKind, filteredRows, columns);
    if (activeKind !== 'foldList') return brandRows;
    const modelColumn = findModelColumn(activeKind, columns);
    return brandRows.map(row => {
      const models = foldModelsForRow(row, columns, modelColumn);
      return {
        ...row,
        values: {
          [FOLD_MODEL_COLUMN]: models.length ? models.join(', ') : '—',
          ...row.values,
        },
        searchText: `${row.searchText} ${models.join(' ')}`.toLowerCase(),
      };
    });
  }, [activeKind, columns, filteredRows]);
  const visibleRows = displayRows.slice(0, MAX_VISIBLE_ROWS);
  const displayColumns = activeKind === 'foldList' ? [FOLD_MODEL_COLUMN, ...columns] : columns;
  const totalRows = activePayload?.rows.length || 0;
  const loadedCount = Object.keys(payloads).length;
  const chartThemeColors = useMemo(() => getChartThemeColors(), []);
  const analytics = useMemo(
    () => buildQueryAnalytics(activeQuery, activePayload, displayRows),
    [activePayload, activeQuery, displayRows],
  );
  const chartColorByKind: Record<BiDeviceQueryKind, string> = {
    manufacturers: '#9B5CFF',
    userDevices: '#2563EB',
    platformShare: '#22C55E',
    tablets: '#F59E0B',
    ipads: '#8B5CF6',
    foldList: '#EC4899',
    foldCount: '#EF4444',
    androidManufacturers: '#22C55E',
  };
  const chartColor = chartColorByKind[activeKind] || '#9B5CFF';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(34,197,94,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▦</div>
        BI устройства+
      </div>

      <Card>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, .7fr) max-content', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Поиск по текущей таблице</FieldLabel>
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="модель, производитель, платформа, процент..." />
            </div>
            <div>
              <FieldLabel>{activeQuery.searchLabel || 'Поиск пользователя'}</FieldLabel>
              <Input
                value={userSearch}
                onChange={event => setUserSearch(event.target.value)}
                placeholder={activeQuery.searchPlaceholder || 'используется в запросе устройств пользователя'}
                disabled={activeKind !== 'userDevices'}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => void loadAll()} disabled={loading}>
                Все
              </Button>
              <Button variant="primary" onClick={() => void loadQuery()} disabled={loading}>
                {loading ? '...' : 'Загрузить'}
              </Button>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Badge color={statusBadgeColor(statusTone)}>{status}</Badge>
            <Badge color={String(settings.biCookie || '').trim() ? 'blue' : 'red'}>{String(settings.biCookie || '').trim() ? 'bi cookie ready' : 'bi cookie missing'}</Badge>
            <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
              proxy {settings.useProxy === false ? 'off' : proxyState}
            </Badge>
            <Badge color="gray">загружено {loadedCount}/{BI_DEVICE_QUERY_DEFINITIONS.length}</Badge>
            {activePayload && <Badge color="green">{new Date(activePayload.fetchedAt).toLocaleString('ru-RU')}</Badge>}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => activePayload && downloadCsv(activeQuery, displayColumns, displayRows)}
              disabled={!activePayload || !displayRows.length}
              style={{ marginLeft: 'auto' }}
            >
              CSV
            </Button>
          </div>
          <div style={{ marginTop: 12 }}>
            <FieldLabel>Запросы</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BI_DEVICE_QUERY_DEFINITIONS.map(query => (
                <QueryButton
                  key={query.kind}
                  query={query}
                  active={query.kind === activeKind}
                  loaded={Boolean(payloads[query.kind])}
                  onClick={() => setActiveKind(query.kind)}
                />
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{activeQuery.title}</CardTitle>
              <CardHint>
                Показано {formatNumber(visibleRows.length)} из {formatNumber(filteredRows.length)} строк
                {filteredRows.length > MAX_VISIBLE_ROWS ? ` · таблица ограничена ${MAX_VISIBLE_ROWS}` : ''}
              </CardHint>
            </div>
          </CardHeader>
          <CardBody style={{ paddingTop: 8 }}>
            {error && (
              <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,.22)', background: 'rgba(239,68,68,.10)', color: '#F87171', fontSize: 12 }}>
                {error}
              </div>
            )}
            {activePayload && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  {[
                    { label: 'Строк в срезе', value: formatNumber(displayRows.length), color: 'var(--text)' },
                    { label: analytics.usersColumn || analytics.shareColumn ? 'Суммарное значение' : 'Строковый вес', value: formatNumber(analytics.totalUsers), color: chartColor },
                    {
                      label: analytics.modelColumn ? 'Моделей' : analytics.platformColumn ? 'Платформ' : 'Групп',
                      value: formatNumber(analytics.modelColumn ? analytics.uniqueModels : analytics.platformColumn ? analytics.uniquePlatforms : analytics.topItems.length),
                      color: '#F59E0B',
                    },
                    { label: 'Производителей', value: formatNumber(analytics.uniqueManufacturers), color: '#22C55E' },
                  ].map(metric => (
                    <div key={metric.label} style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase' }}>{metric.label}</div>
                      <div style={{ marginTop: 5, fontSize: 22, fontWeight: 800, color: metric.color, fontVariantNumeric: 'tabular-nums' }}>{metric.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(260px, .65fr)', gap: 12, alignItems: 'start' }}>
                  <div style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{analytics.topTitle}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                          {analytics.usersColumn || analytics.shareColumn
                            ? `Значение: ${columnLabel(activeKind, analytics.usersColumn || analytics.shareColumn)}`
                            : 'Нет числовой колонки, используется количество строк'}
                        </div>
                      </div>
                      <Badge color="gray">top {analytics.topItems.length}</Badge>
                    </div>
                    <QueryBarChart title={analytics.topTitle} items={analytics.topItems} color={chartColor} themeColors={chartThemeColors} />
                  </div>

                  <div style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <AnalyticsList
                      title={activeKind === 'platformShare' ? 'Детализация' : analytics.manufacturerColumn ? 'Производители' : 'Второй срез'}
                      items={analytics.secondaryItems}
                    />
                    {activeKind === 'foldList' && (
                      <AnalyticsList title="Распарсенные FOLD модели" items={analytics.foldModels.slice(0, 8)} />
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {analytics.modelColumn && <Badge color="blue">model: {columnLabel(activeKind, analytics.modelColumn)}</Badge>}
                      {analytics.manufacturerColumn && <Badge color="green">brand: {columnLabel(activeKind, analytics.manufacturerColumn)}</Badge>}
                      {analytics.platformColumn && <Badge color="purple">platform: {columnLabel(activeKind, analytics.platformColumn)}</Badge>}
                    </div>
                    {analytics.warnings.map(item => (
                      <div key={item} style={{ border: '1px solid rgba(245,158,11,.22)', background: 'rgba(245,158,11,.08)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-2)', fontSize: 11 }}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {!activePayload ? (
              <EmptyState text="Загрузите выбранный BI-запрос, чтобы увидеть результат." />
            ) : !displayRows.length ? (
              <EmptyState text={totalRows ? 'По текущему поиску строк не найдено.' : 'BI-запрос вернул пустой результат.'} />
            ) : (
              <Table style={{ maxHeight: '58vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }} tableStyle={{ minWidth: Math.max(860, displayColumns.length * 160 + 64) }}>
                <thead>
                  <tr>
                    <Th style={{ width: 52, position: 'sticky', top: 0, zIndex: 2, background: 'var(--card)' }}>#</Th>
                    {displayColumns.map(column => (
                      <Th key={column} style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card)', whiteSpace: 'nowrap' }}>
                        {columnLabel(activeKind, column)}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => (
                    <tr key={`${activeKind}-${rowIndex}`}>
                      <Td style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', width: 52 }}>{rowIndex + 1}</Td>
                      {displayColumns.map(column => (
                        <Td key={`${rowIndex}-${column}`} style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: typeof row.values[column] === 'number' ? 'tabular-nums' : undefined }}>
                          {formatValue(row.values[column])}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
    </div>
  );
}
