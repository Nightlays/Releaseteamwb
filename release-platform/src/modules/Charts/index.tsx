import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  LineController,
  BarController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardHint,
  CardTitle,
  Divider,
  EmptyState,
  FieldLabel,
  Input,
  LogView,
  Progress,
  SegmentControl,
  StatusPill,
  Table,
  Td,
  Th,
} from '../../components/ui';
import { GaugeChart } from '../../components/charts/DonutChart';
import { useSettings } from '../../context/SettingsContext';
import { useApp, isDarkTheme, type ThemeMode } from '../../context/AppContext';
import { checkProxy } from '../../services/proxy';
import {
  buildMajorReleaseRange,
  checkChartsMlHelperHealth,
  collectChartsReport,
  ensureChartsMlExportEntry,
  ensureChartsMlDatasetLoaded,
  getChartsMlFeatureLabel,
  labelChartsMlExport,
  refreshChartsMlStateForReport,
  requestChartsAiSummary,
  rebuildChartsSummaryState,
  retrainChartsMlViaHelper,
  syncChartsMlDatasetToDrive,
  type ChartsDowntimeRow,
  type ChartsAiTypeSnapshot,
  type ChartsMetricRow,
  type ChartsReport,
  type ChartsStreamInsightSummary,
  type ChartsTaskTypeRow,
} from '../../services/charts';

Chart.register(LineController, BarController, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

type ChartMode = 'line' | 'bar';
type CompareMode = 'mean' | 'prev';
type LogLevel = 'info' | 'ok' | 'warn' | 'error';

interface ChartPalette {
  text: string;
  textSoft: string;
  grid: string;
  tooltipBg: string;
  tooltipText: string;
  surface: string;
  lineFillAlpha: number;
  barFillAlpha: number;
  barHoverAlpha: number;
}

interface LineDataset {
  label: string;
  data: Array<number | null>;
  color: string;
  dashed?: boolean;
  fill?: boolean;
}

interface BarDataset {
  label: string;
  data: Array<number | null>;
  color: string;
}

interface ChartMarker {
  index: number;
  label: string;
  tone: 'bad' | 'warn';
}

const CUT_TARGET_MIN = 14 * 60;
const CUT_WINDOW_MIN = 10;
const STORE_LATE_MIN = 18 * 60;

function getCutClass(minutes: number | null | undefined): string {
  const v = Number(minutes);
  if (!Number.isFinite(v)) return '';
  return v >= CUT_TARGET_MIN - CUT_WINDOW_MIN && v <= CUT_TARGET_MIN + CUT_WINDOW_MIN ? 'cut-on' : 'cut-late';
}

function isStoreLate(minutes: number | null | undefined): boolean {
  const v = Number(minutes);
  return Number.isFinite(v) && v > STORE_LATE_MIN;
}

function formatReleaseShort(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const parts = raw.split('.');
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1].replace(/0+$/, '');
  parts[parts.length - 1] = last || '0';
  return parts.join('.');
}

function formatMinutesToClock(minutes: number | null | undefined) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '—';
  const total = Math.max(0, Math.round(value));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatMinutesPretty(minutes: number | null | undefined, digits = 1) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} мин`;
}

type ValueLabelMode = 'none' | 'all' | 'last';

function formatMaybeNumber(value: number | null | undefined, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return digits > 0 ? num.toFixed(digits) : Math.round(num).toLocaleString('ru-RU');
}

function formatChangeText(value: number | null | undefined, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Нет данных';
  if (num === 0) return 'Без изменений';
  const abs = digits > 0 ? Math.abs(num).toFixed(digits) : Math.round(Math.abs(num)).toLocaleString('ru-RU');
  return num > 0 ? `Рост на ${abs}` : `Снижение на ${abs}`;
}

function formatCountLabel(value: number | null | undefined) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return Math.round(num).toLocaleString('ru-RU');
}

function formatCountLabelCompact(value: number | null | undefined) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return '';
  if (Math.abs(num) >= 10000) return `${(num / 1000).toFixed(0)}K`;
  if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function formatDeltaBusinessText(value: number | null | undefined, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Нет данных';
  if (num === 0) return 'Без изменений';
  const amount = formatMaybeNumber(Math.abs(num), digits);
  return num > 0 ? `Стало больше на ${amount}` : `Стало меньше на ${amount}`;
}

function formatChangeNarrative(delta: number | null | undefined, deltaPct: number | null | undefined, before?: number | null, after?: number | null) {
  const num = Number(delta);
  if (!Number.isFinite(num)) return 'Нет данных для сравнения.';
  if (num === 0) {
    const hasValues = Number.isFinite(Number(before)) && Number.isFinite(Number(after));
    return hasValues ? `Без изменений: было ${formatMaybeNumber(before, 2)}, стало ${formatMaybeNumber(after, 2)}.` : 'Без изменений.';
  }
  const direction = num > 0 ? 'Стало больше' : 'Стало меньше';
  const changeText = `${direction} на ${formatMaybeNumber(Math.abs(num), 2)}`;
  const pctText = Number.isFinite(Number(deltaPct)) ? ` (${Math.abs(Number(deltaPct)).toFixed(2)}%)` : '';
  const baseText = Number.isFinite(Number(before)) && Number.isFinite(Number(after))
    ? ` Было ${formatMaybeNumber(before, 2)}, стало ${formatMaybeNumber(after, 2)}.`
    : '';
  return `${changeText}${pctText}.${baseText}`;
}

function chpTypeLabel(label: string) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'product') return 'Аналитика';
  if (normalized === 'vlet') return 'Влет';
  if (normalized === 'bug') return 'Баг';
  if (normalized === 'crash') return 'Краш';
  return label;
}

function renderLegendRow(items: Array<{ label: string; color: string }>) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '0 4px 2px' }}>
      {items.map(item => (
        <div key={`legend-${item.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: item.color, boxShadow: `0 0 0 2px ${colorWithAlpha(item.color, 0.14)}` }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function buildReleaseFilterCaption(total: number, selectedCount: number) {
  if (!total) return 'Нет релизов';
  if (!selectedCount || selectedCount >= total) return `Все релизы (${total})`;
  if (selectedCount === 1) return '1 релиз';
  return `${selectedCount} из ${total}`;
}

function filterReportByReleases(source: ChartsReport | null, selected: Set<string> | null) {
  if (!source || !selected || !selected.size) return source;
  const includesRelease = (release: string) => selected.has(release);
  const filteredChpRows = source.chpRows.filter(item => includesRelease(item.release));
  return {
    ...source,
    releases: source.releases.filter(includesRelease),
    metrics: source.metrics.filter(item => includesRelease(item.release)),
    tcRows: source.tcRows.filter(item => includesRelease(item.release)),
    coverageRows: source.coverageRows.filter(item => includesRelease(item.release)),
    selectiveRows: source.selectiveRows.filter(item => includesRelease(item.release)),
    avgRows: source.avgRows.filter(item => includesRelease(item.release)),
    chpRows: filteredChpRows,
    devDowntime: {
      iosRows: source.devDowntime.iosRows.filter(item => includesRelease(item.release)),
      androidRows: source.devDowntime.androidRows.filter(item => includesRelease(item.release)),
      iosByRelease: source.devDowntime.iosByRelease.filter(item => includesRelease(item.release)),
      androidByRelease: source.devDowntime.androidByRelease.filter(item => includesRelease(item.release)),
    },
    timings: source.timings.filter(item => includesRelease(item.release)),
    taskTypes: {
      ...source.taskTypes,
      iosRows: source.taskTypes.iosRows.filter(item => includesRelease(item.release)),
      androidRows: source.taskTypes.androidRows.filter(item => includesRelease(item.release)),
    },
    chpTypes: {
      ...source.chpTypes,
      rows: source.chpTypes.rows.filter(item => includesRelease(item.release)),
      iosRows: source.chpTypes.iosRows.filter(item => includesRelease(item.release)),
      androidRows: source.chpTypes.androidRows.filter(item => includesRelease(item.release)),
    },
    chpQuarterStats: rebuildFilteredChpQuarterStats(
      filteredChpRows,
      source.chpQuarterStats?.issues.filter(issue => includesRelease(issue.release)) || []
    ),
    streamDeltaRows: source.streamDeltaRows.filter(item => includesRelease(item.release)),
  };
}

function rebuildFilteredChpQuarterStats(
  chpRows: ChartsReport['chpRows'],
  issues: NonNullable<ChartsReport['chpQuarterStats']>['issues']
): ChartsReport['chpQuarterStats'] {
  if (!chpRows.length && !issues.length) return null;
  const byQuarter = new Map<string, { total: number; streams: Map<string, { name: string; count: number; external: boolean; substreams: Map<string, number> }> }>();
  issues.forEach(issue => {
    const quarter = issue.quarter || 'Без квартала';
    if (!byQuarter.has(quarter)) {
      byQuarter.set(quarter, { total: 0, streams: new Map() });
    }
    const bucket = byQuarter.get(quarter)!;
    bucket.total += 1;
    const streamName = issue.stream || 'Без стрима';
    if (!bucket.streams.has(streamName)) {
      bucket.streams.set(streamName, { name: streamName, count: 0, external: issue.external, substreams: new Map() });
    }
    const stream = bucket.streams.get(streamName)!;
    stream.count += 1;
    const substream = issue.substream || 'Без сабстрима';
    stream.substreams.set(substream, (stream.substreams.get(substream) || 0) + 1);
  });

  const quarterSortValue = (label: string) => {
    const match = String(label || '').match(/^Q(\d)\s+(\d{4})$/i);
    if (!match) return Number.POSITIVE_INFINITY;
    return Number(match[2]) * 10 + Number(match[1]);
  };

  return {
    average: chpRows.length ? chpRows.reduce((sum, row) => sum + (Number(row.total || 0) || 0), 0) / chpRows.length : 0,
    releases: chpRows.length,
    issues,
    quarters: Array.from(byQuarter.entries())
      .sort((left, right) => quarterSortValue(left[0]) - quarterSortValue(right[0]) || left[0].localeCompare(right[0]))
      .map(([quarter, data]) => ({
        quarter,
        total: data.total,
        streams: Array.from(data.streams.values())
          .map(stream => {
            const topSubstream = Array.from(stream.substreams.entries())
              .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || null;
            return {
              name: stream.name,
              count: stream.count,
              external: stream.external,
              topSubstream: topSubstream ? { name: topSubstream[0], count: topSubstream[1] } : null,
            };
          })
          .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
      })),
  };
}

function formatDowntimeLabel(totalMinutes: number, days: number) {
  if (!totalMinutes) return '0 мин';
  return `${formatMinutesPretty(totalMinutes, 1)} · ${days} дн.`;
}

function exportBlob(filename: string, body: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([body], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
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

function hashColor(label: string) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = ((hash << 5) - hash + label.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 64%, 50%)`;
}

function useChartPalette(theme: ThemeMode): ChartPalette {
  return useMemo(() => {
    const dark = isDarkTheme(theme);
    return ({
    text: dark ? '#CBD5E1' : '#334155',
    textSoft: dark ? '#94A3B8' : '#64748B',
    grid: dark ? 'rgba(148,163,184,.10)' : 'rgba(148,163,184,.12)',
    tooltipBg: dark ? 'rgba(15,23,42,.96)' : 'rgba(255,255,255,.98)',
    tooltipText: dark ? '#F8FAFC' : '#0F172A',
    surface: dark ? '#1C1C26' : '#FFFFFF',
    lineFillAlpha: dark ? 0.10 : 0.08,
    barFillAlpha: dark ? 0.68 : 0.60,
    barHoverAlpha: dark ? 0.82 : 0.74,
  }); }, [theme]);
}

function summaryToneToBadgeColor(tone: string) {
  if (tone === 'ok') return 'green';
  if (tone === 'warn') return 'yellow';
  if (tone === 'bad') return 'red';
  return 'gray';
}

function summaryToneToTextColor(tone: string) {
  if (tone === 'ok') return '#16A34A';
  if (tone === 'warn') return '#D97706';
  if (tone === 'bad') return '#DC2626';
  return 'var(--text-2)';
}

function buildReleaseMarkers(metrics: ChartsMetricRow[]): ChartMarker[] {
  return metrics
    .map((item, index) => {
      const mlRisk = item.mlRiskPct || 0;
      const anomScore = item.anom_score || 0;
      const hasML = mlRisk >= 70;
      const hasSevereAnom = anomScore >= 6;
      const hasAnom = anomScore > 2;
      if (!hasML && !hasAnom) return null;
      const tone: ChartMarker['tone'] = (hasML || hasSevereAnom) ? 'bad' : 'warn';
      // Only show text label for truly severe cases to prevent crowding
      let label = '';
      if (hasML) label = `ML ${Math.round(mlRisk)}%`;
      else if (hasSevereAnom) label = `A:${anomScore}`;
      return { index, label, tone };
    })
    .filter((item): item is ChartMarker => Boolean(item))
    .slice(-8);
}

function withSilentMarkerLabels(markers: ChartMarker[]) {
  return markers.map(marker => ({ ...marker, label: '' }));
}

function mlDatasetQualityColor(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'green';
  if (level === 'medium') return 'yellow';
  return 'red';
}

function mlAgreementColor(value: number | null) {
  if (value == null) return 'gray';
  if (value <= 8) return 'green';
  if (value <= 18) return 'yellow';
  return 'red';
}

function buildMlDatasetQualityState(labeledSamples: number) {
  if (labeledSamples < 10) {
    return {
      datasetQuality: 'low' as const,
      datasetQualityText: 'Недостаточно данных',
      datasetQualityHint: `Размечено только ${labeledSamples} выгрузок. Риск пока нужно воспринимать как предварительный сигнал.`,
    };
  }
  if (labeledSamples <= 25) {
    return {
      datasetQuality: 'medium' as const,
      datasetQualityText: 'Ограниченная надёжность',
      datasetQualityHint: `Размечено ${labeledSamples} выгрузок. Модель уже полезна, но чувствительна к шуму и выбросам.`,
    };
  }
  return {
    datasetQuality: 'high' as const,
    datasetQualityText: 'Надёжная база',
    datasetQualityHint: `Размечено ${labeledSamples} выгрузок. Оценка уже опирается на нормальную историю релизов.`,
  };
}

function markerStrokeColor(palette: ChartPalette, tone: ChartMarker['tone']) {
  return tone === 'bad'
    ? (palette.surface === '#FFFFFF' ? 'rgba(220,38,38,.42)' : 'rgba(248,113,113,.55)')
    : (palette.surface === '#FFFFFF' ? 'rgba(217,119,6,.34)' : 'rgba(251,191,36,.48)');
}

function markerLabelColor(tone: ChartMarker['tone']) {
  return tone === 'bad' ? '#DC2626' : '#D97706';
}

function colorWithAlpha(color: string, alpha: number) {
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

function mlEngineLabel(engine: ChartsReport['ml']['prediction']['engine']) {
  if (engine === 'catboost') return 'CatBoost';
  if (engine === 'linear') return 'Линейная модель';
  return 'Нет модели';
}

function helperStatusLabel(online: boolean) {
  return online ? 'ML-хелпер онлайн' : 'ML-хелпер не в сети';
}

function chartAnimationOptions() {
  return {
    duration: 760,
    easing: 'easeOutQuart' as const,
    delay(context: { type?: string; mode?: string; datasetIndex?: number; dataIndex?: number }) {
      if (context.type !== 'data' || context.mode !== 'default') return 0;
      return ((context.datasetIndex || 0) * 54) + ((context.dataIndex || 0) * 32);
    },
  };
}

function LineChart({
  labels,
  datasets,
  palette,
  height = 180,
  markers = [],
  yTickFormatter,
  tooltipFormatter,
  valueLabelFormatter,
  valueLabelMode = 'all',
  legendDisplay = true,
}: {
  labels: string[];
  datasets: LineDataset[];
  palette: ChartPalette;
  height?: number;
  markers?: ChartMarker[];
  yTickFormatter?: (value: number) => string;
  tooltipFormatter?: (value: number, datasetLabel: string) => string;
  valueLabelFormatter?: (value: number, datasetLabel: string) => string;
  valueLabelMode?: ValueLabelMode;
  legendDisplay?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();
    const markerPlugin = {
      id: `release-markers-line-${markers.map(marker => `${marker.index}:${marker.label}`).join('|')}`,
      afterDatasetsDraw(chart: Chart) {
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        if (!xScale || !yScale) return;
        const { ctx, chartArea } = chart;
        ctx.save();
        if (valueLabelMode !== 'none' && valueLabelFormatter) {
          const FONT_PX = 9;
          const LABEL_H = FONT_PX + 2;
          const PAD = 2;
          ctx.font = `600 ${FONT_PX}px "IBM Plex Sans", system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const labelColor = palette.surface === '#FFFFFF' ? '#1E293B' : '#F8FAFC';

          // Collect candidates with priority (last/first > extrema > rest)
          const candidates: Array<{px: number; py: number; text: string; di: number; pi: number; priority: number}> = [];
          chart.data.datasets.forEach((dataset, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            const rawData = dataset.data as Array<number | null>;
            const pts = Array.isArray(meta.data) ? meta.data : [];
            const indices = valueLabelMode === 'last' ? [pts.length - 1] : pts.map((_, i) => i);
            indices.forEach(pi => {
              if (pi == null || pi < 0) return;
              const pt = pts[pi] as { x?: number; y?: number } | undefined;
              const val = Number(rawData[pi] ?? NaN);
              if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(val)) return;
              const px = Number(pt.x), py = Number(pt.y);
              if (px < chartArea.left || px > chartArea.right || py < chartArea.top || py > chartArea.bottom) return;
              const text = valueLabelFormatter(val, String(dataset.label || ''));
              if (!text) return;
              const isLast = pi === pts.length - 1;
              const isFirst = pi === 0;
              const prev = Number(rawData[pi - 1] ?? NaN);
              const next = Number(rawData[pi + 1] ?? NaN);
              const isPeak = Number.isFinite(prev) && Number.isFinite(next) && val > prev && val > next;
              const isValley = Number.isFinite(prev) && Number.isFinite(next) && val < prev && val < next;
              const priority = (isLast || isFirst) ? 0 : (isPeak || isValley) ? 1 : 2;
              candidates.push({ px, py, text, di, pi, priority });
            });
          });
          candidates.sort((a, b) => a.priority - b.priority || a.di - b.di || a.pi - b.pi);

          // Greedy collision-detection placement
          const placed: Array<{cx: number; bottom: number; w: number}> = [];
          const hasCollision = (cx: number, bottom: number, w: number) => {
            const l = cx - w / 2 - PAD, r = cx + w / 2 + PAD;
            const t = bottom - LABEL_H - PAD, b = bottom + PAD;
            return placed.some(p => {
              const pl = p.cx - p.w / 2 - PAD, pr = p.cx + p.w / 2 + PAD;
              const pt = p.bottom - LABEL_H - PAD, pb = p.bottom + PAD;
              return !(r < pl || l > pr || b < pt || t > pb);
            });
          };

          candidates.forEach(c => {
            const w = ctx.measureText(c.text).width;
            // Try: 12px above, 26px above, 6px below, 40px above
            const tryBottoms = [c.py - 12, c.py - 26, c.py + LABEL_H + 6, c.py - 40];
            for (const bottom of tryBottoms) {
              if (bottom - LABEL_H < chartArea.top - 2 || bottom > chartArea.bottom + 2) continue;
              if (c.px - w / 2 < chartArea.left - 4 || c.px + w / 2 > chartArea.right + 4) continue;
              if (!hasCollision(c.px, bottom, w)) {
                placed.push({ cx: c.px, bottom, w });
                ctx.fillStyle = labelColor;
                ctx.fillText(c.text, c.px, bottom);
                break;
              }
            }
          });
        }
        if (markers.length) {
          ctx.font = '600 10px "IBM Plex Sans", system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const STAGGER = [8, 20, 32, 44];
          markers.forEach((marker, markerIndex) => {
            const x = xScale.getPixelForValue(marker.index);
            if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
            const topOffset = STAGGER[markerIndex % STAGGER.length];
            ctx.strokeStyle = markerStrokeColor(palette, marker.tone);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top + 2);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = markerStrokeColor(palette, marker.tone);
            ctx.beginPath();
            ctx.arc(x, chartArea.top + 6, 3, 0, Math.PI * 2);
            ctx.fill();
            if (String(marker.label || '').trim()) {
              ctx.fillStyle = markerLabelColor(marker.tone);
              ctx.fillText(marker.label, x, chartArea.top - topOffset);
            }
          });
        }
        ctx.restore();
      },
    };
    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map(dataset => ({
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.color,
          backgroundColor: dataset.fill ? colorWithAlpha(dataset.color, palette.lineFillAlpha) : 'transparent',
          fill: !!dataset.fill,
          tension: 0.24,
          cubicInterpolationMode: 'monotone',
          pointRadius: labels.length <= 4 ? 3.5 : 0,
          pointHoverRadius: 5.5,
          pointHitRadius: 18,
          pointBorderWidth: 2,
          pointBackgroundColor: dataset.color,
          pointBorderColor: palette.surface,
          borderWidth: 2.4,
          borderDash: dataset.dashed ? [5, 4] : [],
          borderCapStyle: 'round',
          borderJoinStyle: 'round',
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        normalized: true,
        animation: chartAnimationOptions(),
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: markers.some(m => m.label) ? 58 : markers.length ? 20 : 8, right: 6, bottom: 0, left: 4 } },
        plugins: {
          legend: {
            display: legendDisplay,
            labels: {
              color: palette.text,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 10,
              padding: 14,
              font: { size: 11, family: 'IBM Plex Sans, system-ui', weight: 600 },
            },
          },
          tooltip: {
            backgroundColor: palette.tooltipBg,
            titleColor: palette.tooltipText,
            bodyColor: palette.tooltipText,
            borderColor: colorWithAlpha(palette.grid, 0.9),
            borderWidth: 1,
            padding: 10,
            cornerRadius: 12,
            callbacks: tooltipFormatter ? {
              label(context) {
                return tooltipFormatter(Number(context.parsed.y || 0), String(context.dataset.label || ''));
              },
            } : undefined,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: palette.textSoft,
              maxRotation: 0,
              autoSkip: true,
              font: { size: 10, family: 'IBM Plex Sans, system-ui', weight: 500 },
            },
            border: { color: palette.grid },
          },
          y: {
            grid: { color: palette.grid },
            ticks: {
              color: palette.textSoft,
              font: { size: 10, family: 'IBM Plex Sans, system-ui', weight: 500 },
              callback(value) {
                return yTickFormatter ? yTickFormatter(Number(value)) : String(value);
              },
            },
            border: { color: palette.grid },
          },
        },
      },
      plugins: [markerPlugin],
    });
    return () => chartRef.current?.destroy();
  }, [datasets, labels, legendDisplay, markers, palette, tooltipFormatter, valueLabelFormatter, valueLabelMode, yTickFormatter]);

  return (
    <div style={{ position: 'relative', height }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

function BarChart({
  labels,
  datasets,
  palette,
  height = 180,
  stacked = false,
  markers = [],
  yTickFormatter,
  tooltipFormatter,
  valueLabelFormatter,
  legendDisplay = true,
}: {
  labels: string[];
  datasets: BarDataset[];
  palette: ChartPalette;
  height?: number;
  stacked?: boolean;
  markers?: ChartMarker[];
  yTickFormatter?: (value: number) => string;
  tooltipFormatter?: (value: number, datasetLabel: string) => string;
  valueLabelFormatter?: (value: number, datasetLabel: string) => string;
  legendDisplay?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();
    const markerPlugin = {
      id: `release-markers-bar-${markers.map(marker => `${marker.index}:${marker.label}`).join('|')}`,
      afterDatasetsDraw(chart: Chart) {
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        if (!xScale || !yScale) return;
        const { ctx, chartArea } = chart;
        ctx.save();
        if (valueLabelFormatter) {
          ctx.font = '500 10px "IBM Plex Sans", system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const labelColor = palette.surface === '#FFFFFF' ? '#1E293B' : '#F8FAFC';
          chart.data.datasets.forEach((dataset, datasetIndex) => {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden) return;
            const elements = Array.isArray(meta.data) ? meta.data : [];
            elements.forEach((element, index) => {
              const rawValue = Number((dataset.data as Array<number | null>)[index] ?? NaN);
              const x = Number((element as { x?: number }).x);
              const y = Number((element as { y?: number }).y);
              if (!Number.isFinite(rawValue) || rawValue === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return;
              if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
              const text = valueLabelFormatter(rawValue, String(dataset.label || ''));
              if (!text) return;
              const offset = stacked ? 8 : 10 + (datasetIndex % 3) * 10;
              ctx.fillStyle = labelColor;
              ctx.fillText(text, x, y - offset);
            });
          });
        }
        if (!markers.length) {
          ctx.restore();
          return;
        }
        const STAGGER_BAR = [8, 20, 32, 44];
        ctx.font = '600 10px "IBM Plex Sans", system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        markers.forEach((marker, markerIndex) => {
          const x = xScale.getPixelForValue(marker.index);
          if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
          const topOffset = STAGGER_BAR[markerIndex % STAGGER_BAR.length];
          ctx.strokeStyle = markerStrokeColor(palette, marker.tone);
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top + 2);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = markerStrokeColor(palette, marker.tone);
          ctx.fillRect(x - 1, chartArea.top + 2, 2, 8);
          if (String(marker.label || '').trim()) {
            ctx.fillStyle = markerLabelColor(marker.tone);
            ctx.fillText(marker.label, x, chartArea.top - topOffset);
          }
        });
        ctx.restore();
      },
    };
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map(dataset => ({
          label: dataset.label,
          data: dataset.data,
          backgroundColor: colorWithAlpha(dataset.color, palette.barFillAlpha),
          hoverBackgroundColor: colorWithAlpha(dataset.color, palette.barHoverAlpha),
          borderColor: colorWithAlpha(dataset.color, 0.96),
          borderWidth: 0,
          borderRadius: 10,
          borderSkipped: false,
          maxBarThickness: 38,
          categoryPercentage: stacked ? 0.76 : 0.64,
          barPercentage: stacked ? 0.92 : 0.82,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        normalized: true,
        animation: chartAnimationOptions(),
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: markers.some(m => m.label) ? 58 : markers.length ? 20 : 8, right: 6, bottom: 0, left: 4 } },
        plugins: {
          legend: {
            display: legendDisplay,
            labels: {
              color: palette.text,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 10,
              padding: 14,
              font: { size: 11, family: 'IBM Plex Sans, system-ui', weight: 600 },
            },
          },
          tooltip: {
            backgroundColor: palette.tooltipBg,
            titleColor: palette.tooltipText,
            bodyColor: palette.tooltipText,
            borderColor: colorWithAlpha(palette.grid, 0.9),
            borderWidth: 1,
            padding: 10,
            cornerRadius: 12,
            callbacks: tooltipFormatter ? {
              label(context) {
                return tooltipFormatter(Number(context.parsed.y || 0), String(context.dataset.label || ''));
              },
            } : undefined,
          },
        },
        scales: {
          x: {
            stacked,
            grid: { display: false },
            ticks: {
              color: palette.textSoft,
              maxRotation: 0,
              autoSkip: true,
              font: { size: 10, family: 'IBM Plex Sans, system-ui', weight: 500 },
            },
            border: { color: palette.grid },
          },
          y: {
            stacked,
            beginAtZero: true,
            grid: { color: palette.grid },
            ticks: {
              color: palette.textSoft,
              font: { size: 10, family: 'IBM Plex Sans, system-ui', weight: 500 },
              callback(value) {
                return yTickFormatter ? yTickFormatter(Number(value)) : String(value);
              },
            },
            border: { color: palette.grid },
          },
        },
      },
      plugins: [markerPlugin],
    });
    return () => chartRef.current?.destroy();
  }, [datasets, height, labels, legendDisplay, markers, palette, stacked, tooltipFormatter, valueLabelFormatter, yTickFormatter]);

  return (
    <div style={{ position: 'relative', height }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{hint}</div>}
      </CardBody>
    </Card>
  );
}

function InsightBlock({ title, summary }: { title: string; summary: ChartsStreamInsightSummary | null }) {
  return (
    <Card style={{ minHeight: 220 }}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardHint>{summary ? `${formatReleaseShort(summary.from)} → ${formatReleaseShort(summary.to)}` : 'Недостаточно данных для сравнения'}</CardHint>
        </div>
      </CardHeader>
      <CardBody style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {summary ? (
          <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Рост</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.added.length ? summary.added.map(item => (
                  <div key={`${title}-${item.stream}-plus`} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(239,68,68,.16)', background: 'rgba(239,68,68,.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.stream}</div>
                      <Badge color="red">+{formatMaybeNumber(item.delta)}</Badge>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>
                      было {formatMaybeNumber(item.before)} → стало {formatMaybeNumber(item.after)} {summary.unitLabel}
                    </div>
                  </div>
                )) : <EmptyState text="Резких ростов по стримам нет." />}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Падение</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.removed.length ? summary.removed.map(item => (
                  <div key={`${title}-${item.stream}-minus`} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(34,197,94,.16)', background: 'rgba(34,197,94,.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.stream}</div>
                      <Badge color="green">{formatMaybeNumber(item.delta)}</Badge>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>
                      было {formatMaybeNumber(item.before)} → стало {formatMaybeNumber(item.after)} {summary.unitLabel}
                    </div>
                  </div>
                )) : <EmptyState text="Резких падений по стримам нет." />}
              </div>
            </div>
          </>
        ) : (
          <div style={{ gridColumn: '1 / -1' }}>
            <EmptyState text="Сначала собери хотя бы два релиза." />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SummaryListCard({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: tone === 'neutral' ? 'var(--text-3)' : summaryToneToTextColor(tone) }}>
        {title}
      </div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-2)', lineHeight: 1.55, fontSize: 13 }}>
          {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Нет заметных сигналов.</div>
      )}
    </div>
  );
}

function MlSectionSummaryCard({
  section,
}: {
  section: ChartsReport['ml']['summary']['sections'][keyof ChartsReport['ml']['summary']['sections']];
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{section.title}</CardTitle>
          <CardHint>{section.subtitle}</CardHint>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={summaryToneToBadgeColor(section.tone)}>{section.tone === 'ok' ? 'Стабильно' : section.tone === 'bad' ? 'Риск' : section.tone === 'warn' ? 'Внимание' : 'Нейтрально'}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? 'Развернуть' : 'Свернуть'}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {section.highlights.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {section.highlights.map(item => (
              <div key={`${section.id}-${item.label}`} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: 'var(--surface-soft)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-3)' }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{item.current}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: summaryToneToTextColor(item.tone) }}>{item.delta}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>База: {item.base}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SummaryListCard title="Короткий вывод" items={section.overview} tone={section.tone} />
          <SummaryListCard title="Главные риски" items={section.risks} tone="bad" />
          <SummaryListCard title="Что изменилось" items={section.changes} tone="ok" />
          <SummaryListCard title="Рекомендации ML" items={section.recommendations} tone="warn" />
        </div>
      </CardBody>}
    </Card>
  );
}

function MlFeatureDriversCard({
  drivers,
}: {
  drivers: ChartsReport['ml']['prediction']['featureDrivers'];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Что сильнее всего влияет на риск</CardTitle>
          <CardHint>Прокси-объяснение на базе линейной модели: какие сигналы сильнее толкают риск вверх или вниз.</CardHint>
        </div>
        <Badge color="gray">{drivers.length}</Badge>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {drivers.length ? drivers.map(driver => {
          const width = Math.min(100, Math.max(8, Math.abs(driver.contribution) * 22));
          const positive = driver.contribution >= 0;
          return (
            <div key={`driver-${driver.key}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: 10, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{driver.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Текущее значение: {formatMaybeNumber(driver.value, 2)}</div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden', display: 'flex', justifyContent: positive ? 'flex-start' : 'flex-end' }}>
                <div style={{ width: `${width}%`, background: positive ? 'rgba(220,38,38,.72)' : 'rgba(22,163,74,.72)', borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: positive ? '#DC2626' : '#16A34A', minWidth: 64, textAlign: 'right' }}>
                {positive ? '+' : ''}{driver.contribution.toFixed(2)}
              </div>
            </div>
          );
        }) : <EmptyState text="Пока нет достаточной модели для объяснения факторов риска." />}
      </CardBody>
    </Card>
  );
}

function renderTopTypesTable(snapshot: ChartsAiTypeSnapshot | null) {
  if (!snapshot) return <EmptyState text="Нет данных по типам." />;
  const isChpSnapshot = /^чп/i.test(String(snapshot.platform || '').trim());
  return (
    <Table>
      <thead>
        <tr>
          <Th>Тип</Th>
          <Th>Количество</Th>
        </tr>
      </thead>
      <tbody>
        {snapshot.topTypes.map(item => (
          <tr key={`${snapshot.platform}-${item.name}`}>
            <Td style={{ color: 'var(--text)' }}>{isChpSnapshot ? chpTypeLabel(item.name) : item.name}</Td>
            <Td mono>{item.count.toLocaleString('ru-RU')}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ChpQuarterSummary({ stats }: { stats: ChartsReport['chpQuarterStats'] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>ЧП по диапазону и кварталам</CardTitle>
          <CardHint>Среднее ЧП по выбранным релизам, топ стримов по кварталам и главный сабстрим.</CardHint>
        </div>
        <Badge color="red">{stats?.releases || 0} релизов</Badge>
      </CardHeader>
      <CardBody>
        {!stats || (!stats.releases && !stats.quarters.length) ? (
          <EmptyState text="Недостаточно данных по кварталам ЧП." />
        ) : (
          <div className="charts-quarter-summary">
            <div className="charts-quarter-summary__stat">
              <div>
                <div className="charts-quarter-summary__label">Среднее ЧП за диапазон</div>
                <div className="charts-quarter-summary__hint">{stats.issues.length} задач после cutoff в квартальной раскладке</div>
              </div>
              <div className="charts-quarter-summary__value">{stats.average.toFixed(1)}</div>
            </div>
            <div className="charts-quarter-summary__grid">
              {stats.quarters.length ? stats.quarters.map(quarter => (
                <div className="charts-quarter-card" key={`quarter-${quarter.quarter}`}>
                  <div className="charts-quarter-card__head">
                    <div className="charts-quarter-card__title">{quarter.quarter}</div>
                    <Badge color="red">{quarter.total} ЧП</Badge>
                  </div>
                  {quarter.streams.length ? (
                    <div className="charts-quarter-card__list">
                      {quarter.streams.slice(0, 5).map(stream => (
                        <div className="charts-quarter-stream" key={`${quarter.quarter}-${stream.name}`}>
                          <div className="charts-quarter-stream__top">
                            <span>{stream.name}</span>
                            <strong>{stream.count}</strong>
                          </div>
                          <div className="charts-quarter-stream__meta">
                            <Badge color={stream.external ? 'yellow' : 'gray'}>{stream.external ? 'Внешний' : 'Внутренний'}</Badge>
                            <span>
                              {stream.topSubstream
                                ? `Топ сабстрим: ${stream.topSubstream.name} (${stream.topSubstream.count})`
                                : 'Сабстрим не найден'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="Нет ЧП по стримам за квартал." />
                  )}
                </div>
              )) : (
                <EmptyState text="Нет квартальной детализации по выбранным релизам." />
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function buildCsv(metrics: ChartsMetricRow[]) {
  const header = ['release', 'tc_total', 'tc_manual', 'tc_auto', 'cov_swat', 'cov_stream', 'sel_swat', 'sel_stream', 'avg_total', 'chp_total', 'ml_risk_pct'];
  const rows = metrics.map(item => [
    item.release,
    item.tc_total,
    item.tc_manual,
    item.tc_auto,
    item.cov_swat,
    item.cov_stream,
    item.sel_swat,
    item.sel_stream,
    item.avg_total,
    item.chp_total,
    item.mlRiskPct ?? '',
  ]);
  return [header.join(';'), ...rows.map(row => row.join(';'))].join('\n');
}

function useStatusBools(settings: ReturnType<typeof useSettings>['settings'], proxyOnline: boolean | null, helperOnline: boolean | null) {
  return useMemo(() => ({
    allureReady: Boolean(settings.allureBase && settings.allureToken && settings.projectId),
    deployReady: Boolean(settings.deployLabToken),
    ytReady: Boolean(settings.ytBase && settings.ytToken),
    gitlabReady: Boolean(settings.gitlabToken || settings.gitlabCookie),
    proxyOnline,
    helperOnline,
  }), [helperOnline, proxyOnline, settings.allureBase, settings.allureToken, settings.deployLabToken, settings.gitlabCookie, settings.gitlabToken, settings.projectId, settings.ytBase, settings.ytToken]);
}

export function Charts() {
  const { settings } = useSettings();
  const { theme } = useApp();
  const palette = useChartPalette(theme);
  const rootRef = useRef<HTMLDivElement>(null);

  const [releaseFrom, setReleaseFrom] = useState('7.5.0000');
  const [releaseTo, setReleaseTo] = useState('7.5.9000');
  const [chartMode, setChartMode] = useState<ChartMode>('line');
  const [compareMode, setCompareMode] = useState<CompareMode>('mean');
  const [selectedReleases, setSelectedReleases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [report, setReport] = useState<ChartsReport | null>(null);
  const [proxyOnline, setProxyOnline] = useState<boolean | null>(null);
  const [helperOnline, setHelperOnline] = useState<boolean | null>(null);
  const [aiAutoSummary, setAiAutoSummary] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('wb_charts_ai_auto_summary_v1') === 'true';
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [mlSummaryCollapsed, setMlSummaryCollapsed] = useState(false);
  const [llmSummaryCollapsed, setLlmSummaryCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const status = useStatusBools(settings, proxyOnline, helperOnline);
  const releaseRangePreview = useMemo(() => buildMajorReleaseRange(releaseFrom, releaseTo), [releaseFrom, releaseTo]);
  const selectedReleaseSet = useMemo(() => (selectedReleases.length ? new Set(selectedReleases) : null), [selectedReleases]);
  const filteredReport = useMemo(() => filterReportByReleases(report, selectedReleaseSet), [report, selectedReleaseSet]);
  const displayedReport = useMemo(() => {
    if (!filteredReport) return null;
    const originalCurrentRelease = report?.releases[report.releases.length - 1] || '';
    const filteredCurrentRelease = filteredReport.releases[filteredReport.releases.length - 1] || '';
    const mlPredictionLocked = Boolean(originalCurrentRelease && filteredCurrentRelease && originalCurrentRelease !== filteredCurrentRelease);
    const prepared = mlPredictionLocked ? {
      ...filteredReport,
      ml: {
        ...filteredReport.ml,
        prediction: {
          ...filteredReport.ml.prediction,
          engine: 'none' as const,
          activeProbability: null,
          linearProbability: null,
          catboostProbability: null,
          trained: false,
          reason: 'ML риск пересчитывается только для последнего собранного релиза. Выбранный фильтр показывает другой срез.',
          modelAgreementPct: null,
          agreementText: 'Согласованность недоступна',
          featureDrivers: [],
        },
      },
    } : filteredReport;
    const summaryState = rebuildChartsSummaryState(prepared, compareMode);
    return {
      ...prepared,
      aiContext: summaryState.aiContext,
      ml: {
        ...prepared.ml,
        summary: summaryState.mlSummary,
      },
    } as ChartsReport;
  }, [compareMode, filteredReport, report]);
  const labels = useMemo(() => (displayedReport?.releases || []).map(formatReleaseShort), [displayedReport]);
  const currentMetric = displayedReport?.metrics[displayedReport.metrics.length - 1] || null;
  const displayedMlRiskPct = displayedReport?.ml.prediction.activeProbability == null
    ? null
    : Math.round(displayedReport.ml.prediction.activeProbability * 100);
  const visibleReleaseCount = displayedReport?.releases.length || 0;

  const pushLog = useCallback((text: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-120), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]);
  }, []);

  const buildMlIoConfig = useCallback((helperBase?: string) => ({
    proxyBase: String(settings.proxyBase || '').trim(),
    proxyMode: settings.proxyMode,
    useProxy: settings.useProxy,
    mlHelperBase: String(helperBase || settings.mlHelperBase || '').trim(),
  }), [settings.mlHelperBase, settings.proxyBase, settings.proxyMode, settings.useProxy]);

  useEffect(() => {
    let cancelled = false;
    checkProxy(String(settings.proxyBase || '').trim())
      .then(value => { if (!cancelled) setProxyOnline(value); })
      .catch(() => { if (!cancelled) setProxyOnline(false); });
    return () => { cancelled = true; };
  }, [settings.proxyBase]);

  useEffect(() => {
    let cancelled = false;
    checkChartsMlHelperHealth(String(settings.mlHelperBase || '').trim())
      .then(health => { if (!cancelled) setHelperOnline(health.online); })
      .catch(() => { if (!cancelled) setHelperOnline(false); });
    return () => { cancelled = true; };
  }, [settings.mlHelperBase]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('wb_charts_ai_auto_summary_v1', String(aiAutoSummary));
  }, [aiAutoSummary]);

  useEffect(() => {
    if (!report?.releases?.length) {
      setSelectedReleases([]);
      return;
    }
    setSelectedReleases(prev => prev.filter(item => report.releases.includes(item)));
  }, [report]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    pushLog('Сбор остановлен.', 'warn');
  }, [pushLog]);

  const run = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setAiText('');
    setLogs([]);
    setProgress({ done: 0, total: releaseRangePreview.length });
    pushLog(`Старт сбора графиков по диапазону ${releaseFrom} → ${releaseTo}.`);

    try {
      const result = await collectChartsReport({
        allureBase: settings.allureBase,
        allureToken: settings.allureToken,
        projectId: settings.projectId,
        deployLabToken: settings.deployLabToken,
        ytBase: settings.ytBase,
        ytToken: settings.ytToken,
        wikiToken: settings.wikiToken,
        bandCookies: settings.bandCookies,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        gitlabToken: settings.gitlabToken,
        gitlabCookie: settings.gitlabCookie,
        mlHelperBase: settings.mlHelperBase,
        glmBase: settings.glmBase,
        glmKey: settings.glmKey,
        glmModel: settings.glmModel,
        signal: controller.signal,
      }, releaseFrom, releaseTo, {
        compareMode,
        onLog: (text, level = 'info') => pushLog(text, level),
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (controller.signal.aborted) return;
      setReport(result);
      setSelectedReleases([]);
      setHelperOnline(result.ml.helperHealth.online);
      pushLog(`Сбор завершён: ${result.releases.length} релизов, аномалий ${result.anomalies.score}, ML ${result.ml.prediction.activeProbability == null ? '—' : `${Math.round(result.ml.prediction.activeProbability * 100)}%`}.`, 'ok');
      if (aiAutoSummary && settings.glmBase) {
        setAiLoading(true);
        try {
          setAiText('');
          const text = await requestChartsAiSummary({
            allureBase: settings.allureBase,
            allureToken: settings.allureToken,
            projectId: settings.projectId,
            proxyBase: settings.proxyBase,
            proxyMode: settings.proxyMode,
            useProxy: settings.useProxy,
            glmBase: settings.glmBase,
            glmKey: settings.glmKey,
            glmModel: settings.glmModel,
          }, result.aiContext, {
            signal: controller.signal,
            onToken: partial => {
              if (!controller.signal.aborted) setAiText(partial);
            },
          });
          if (!controller.signal.aborted) {
            setAiText(text);
            pushLog('LLM-сводка сформирована автоматически.', 'ok');
          }
        } catch (generationError) {
          if (!controller.signal.aborted) {
            const message = (generationError as Error)?.message || String(generationError);
            setAiText(`Ошибка: ${message}`);
            pushLog(`LLM-сводка: ${message}`, 'error');
          }
        } finally {
          if (!controller.signal.aborted) setAiLoading(false);
        }
      }
    } catch (runError) {
      if (controller.signal.aborted) return;
      const message = (runError as Error)?.message || String(runError);
      setError(message);
      pushLog(`Ошибка: ${message}`, 'error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [aiAutoSummary, compareMode, pushLog, releaseFrom, releaseRangePreview.length, releaseTo, settings.allureBase, settings.allureToken, settings.bandCookies, settings.deployLabToken, settings.gitlabCookie, settings.gitlabToken, settings.glmBase, settings.glmKey, settings.glmModel, settings.mlHelperBase, settings.projectId, settings.proxyBase, settings.proxyMode, settings.useProxy, settings.wikiToken, settings.ytBase, settings.ytToken]);

  const exportJson = useCallback(() => {
    if (!report) return;
    exportBlob(`charts-${report.releases[0] || 'from'}-${report.releases[report.releases.length - 1] || 'to'}.json`, JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
  }, [report]);

  const exportCsv = useCallback(() => {
    if (!report) return;
    exportBlob(`charts-summary-${report.releases[0] || 'from'}-${report.releases[report.releases.length - 1] || 'to'}.csv`, buildCsv(report.metrics), 'text/csv;charset=utf-8');
  }, [report]);

  const saveMlSnapshot = useCallback(async () => {
    if (!report?.ml.features) return;
    setActionBusy('save');
    try {
      const helperBase = String(report.ml.helperHealth.base || settings.mlHelperBase || '').trim();
      const ioConfig = buildMlIoConfig(helperBase);
      const result = ensureChartsMlExportEntry(report.ml.features, {
        release: report.metrics[report.metrics.length - 1]?.release || null,
        predictedRiskPct: report.ml.prediction.activeProbability == null ? null : Math.round(report.ml.prediction.activeProbability * 1000) / 10,
        linearProbability: report.ml.prediction.linearProbability,
        catboostProbability: report.ml.prediction.catboostProbability,
      });
      try {
        await syncChartsMlDatasetToDrive(ioConfig);
        pushLog('ML-выгрузка синхронизирована с Drive.', 'ok');
      } catch (syncError) {
        pushLog(`ML-выгрузка сохранена локально: ${(syncError as Error)?.message || String(syncError)}`, 'warn');
      }
      const refreshed = await refreshChartsMlStateForReport(
        {
          ...report,
          ml: {
            ...report.ml,
            dataset: result.dataset,
          },
        },
        ioConfig,
        compareMode
      ).catch(() => null);
      if (refreshed) {
        setReport(refreshed);
        setHelperOnline(refreshed.ml.helperHealth.online);
      } else {
        setReport(prev => prev ? { ...prev, ml: { ...prev.ml, dataset: result.dataset } } : prev);
      }
      pushLog(result.created ? 'ML-выгрузка сохранена.' : 'Использована текущая ML-выгрузка.', result.created ? 'ok' : 'info');
    } catch (error) {
      pushLog((error as Error)?.message || String(error), 'error');
    } finally {
      setActionBusy('');
    }
  }, [buildMlIoConfig, compareMode, pushLog, report, settings.mlHelperBase]);

  const labelAndRetrain = useCallback(async (label: 'ok' | 'fail') => {
    if (!report?.ml.features) return;
    const labelTitle = label === 'ok' ? 'OK' : 'Регресс';
    setActionBusy(labelTitle);
    try {
      const helperBase = String(report.ml.helperHealth.base || settings.mlHelperBase || '').trim();
      const ioConfig = buildMlIoConfig(helperBase);
      const ensured = ensureChartsMlExportEntry(report.ml.features, {
        release: report.metrics[report.metrics.length - 1]?.release || null,
        predictedRiskPct: report.ml.prediction.activeProbability == null ? null : Math.round(report.ml.prediction.activeProbability * 1000) / 10,
        linearProbability: report.ml.prediction.linearProbability,
        catboostProbability: report.ml.prediction.catboostProbability,
      });
      const dataset = labelChartsMlExport(label, ensured.entry.id);
      try {
        await syncChartsMlDatasetToDrive(ioConfig);
        pushLog(`ML-разметка "${labelTitle}" синхронизирована с Drive.`, 'ok');
      } catch (syncError) {
        pushLog(`ML-разметка сохранена локально: ${(syncError as Error)?.message || String(syncError)}`, 'warn');
      }
      let helperState = report.ml.helperHealth;
      try {
        await retrainChartsMlViaHelper(helperBase);
        helperState = await checkChartsMlHelperHealth(helperBase);
        pushLog(`ML-хелпер: переобучение после метки "${labelTitle}" завершено.`, 'ok');
      } catch (helperError) {
        pushLog(`ML-хелпер: ${(helperError as Error)?.message || String(helperError)}`, 'warn');
      }
      const refreshed = await refreshChartsMlStateForReport(
        {
          ...report,
          ml: {
            ...report.ml,
            dataset,
            helperHealth: helperState,
          },
        },
        ioConfig,
        compareMode
      ).catch(() => null);
      if (refreshed) {
        setReport(refreshed);
        setHelperOnline(refreshed.ml.helperHealth.online);
      } else {
        setReport(prev => prev ? (() => {
            const labeledSamples = dataset.filter(item => item.label === 'ok' || item.label === 'fail').length;
            const quality = buildMlDatasetQualityState(labeledSamples);
            const next = {
              ...prev,
              ml: {
                ...prev.ml,
                dataset,
                helperHealth: helperState,
                prediction: {
                  ...prev.ml.prediction,
                  labeledSamples,
                  ...quality,
                },
              },
            };
            const summaryState = rebuildChartsSummaryState(next, compareMode);
            return {
              ...next,
              aiContext: summaryState.aiContext,
              ml: {
                ...next.ml,
                summary: summaryState.mlSummary,
              },
            };
          })() : prev);
        setHelperOnline(helperState.online);
      }
      pushLog(`Текущая ML-выгрузка размечена как "${labelTitle}".`, 'ok');
    } catch (actionError) {
      pushLog((actionError as Error)?.message || String(actionError), 'error');
    } finally {
      setActionBusy('');
    }
  }, [buildMlIoConfig, compareMode, pushLog, report, settings.mlHelperBase]);

  const retrainOnly = useCallback(async () => {
    setActionBusy('retrain');
    try {
      const helperBase = String(report?.ml.helperHealth.base || settings.mlHelperBase || '').trim();
      await retrainChartsMlViaHelper(helperBase);
      if (report) {
        const refreshed = await refreshChartsMlStateForReport(report, buildMlIoConfig(helperBase), compareMode);
        setReport(refreshed);
        setHelperOnline(refreshed.ml.helperHealth.online);
      } else {
        const helperState = await checkChartsMlHelperHealth(helperBase);
        setHelperOnline(helperState.online);
      }
      pushLog('CatBoost переобучен вручную.', 'ok');
    } catch (error) {
      pushLog((error as Error)?.message || String(error), 'error');
    } finally {
      setActionBusy('');
    }
  }, [buildMlIoConfig, compareMode, pushLog, report, settings.mlHelperBase]);

  const toggleRelease = useCallback((release: string) => {
    setSelectedReleases(prev => {
      if (!report?.releases?.length) return prev;
      if (!prev.length) {
        return report.releases.filter(item => item !== release);
      }
      if (prev.includes(release)) {
        const next = prev.filter(item => item !== release);
        return next.length === report.releases.length ? [] : next;
      }
      const next = [...prev, release].sort((left, right) => report.releases.indexOf(left) - report.releases.indexOf(right));
      return next.length === report.releases.length ? [] : next;
    });
  }, [report]);

  const resetReleaseFilter = useCallback(() => setSelectedReleases([]), []);

  const exportPdf = useCallback(async ({ chartsOnly = false, includeMl = true } = {}) => {
    if (!rootRef.current) return;
    setExportingPdf(true);
    try {
      const { html2canvas, jsPDF } = await ensurePdfLibraries();
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
      const selectors = chartsOnly
        ? (includeMl ? '[data-export-kind="chart"], [data-export-kind="ml"]' : '[data-export-kind="chart"]')
        : '[data-export-kind]';
      const nodes = Array.from(rootRef.current.querySelectorAll(selectors)).filter((node): node is HTMLElement => node instanceof HTMLElement && node.offsetParent !== null);
      if (!nodes.length) throw new Error('Нет блоков для PDF.');
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

      pdf.save(`charts-${new Date().toISOString().slice(0, 10)}.pdf`);
      pushLog('PDF экспорт собран.', 'ok');
    } catch (error) {
      pushLog((error as Error)?.message || String(error), 'error');
    } finally {
      setExportingPdf(false);
    }
  }, [pushLog]);

  const generateAi = useCallback(async () => {
    if (!displayedReport) return;
    setAiLoading(true);
    setAiText('');
    try {
      const text = await requestChartsAiSummary({
        allureBase: settings.allureBase,
        allureToken: settings.allureToken,
        projectId: settings.projectId,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        glmBase: settings.glmBase,
        glmKey: settings.glmKey,
        glmModel: settings.glmModel,
      }, displayedReport.aiContext, {
        onToken: partial => setAiText(partial),
      });
      setAiText(text);
      pushLog('LLM-сводка сформирована.', 'ok');
    } catch (generationError) {
      const message = (generationError as Error)?.message || String(generationError);
      setAiText(`Ошибка: ${message}`);
      pushLog(`LLM-сводка: ${message}`, 'error');
    } finally {
      setAiLoading(false);
    }
  }, [displayedReport, pushLog, settings.allureBase, settings.allureToken, settings.glmBase, settings.glmKey, settings.glmModel, settings.projectId, settings.proxyBase, settings.proxyMode, settings.useProxy]);

  const renderOverviewTab = () => {
    const source = displayedReport;
    if (!source) return null;
    const mlSummary = source.ml.summary;
    const releaseMarkers = buildReleaseMarkers(source.metrics);
    const riskHistoryDatasets = [
      { label: 'ML риск', data: source.metrics.map(item => item.mlRiskPct), color: '#8B5CF6', fill: chartMode === 'line' },
    ];
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 14 }}>
          <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.overview} /></div>
          <div data-export-kind="ml">
            <Card style={{ height: '100%' }}>
              <CardHeader>
                <div>
                  <CardTitle>Общий ML-риск</CardTitle>
                  <CardHint>{formatReleaseShort(source.releases[source.releases.length - 1] || '—')} · риск, надёжность выборки и ручные проверки.</CardHint>
                </div>
              </CardHeader>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 14, alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <GaugeChart value={displayedMlRiskPct || 0} size={124} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: summaryToneToTextColor(mlSummary.statusTone) }}>
                      {displayedMlRiskPct == null ? 'Нет оценки риска' : displayedMlRiskPct <= 1 ? 'Явных признаков регресса не видно' : `${displayedMlRiskPct}% риска регресса`}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <Badge color={mlDatasetQualityColor(source.ml.prediction.datasetQuality)}>{source.ml.prediction.datasetQualityText}</Badge>
                      <Badge color={mlAgreementColor(source.ml.prediction.modelAgreementPct)}>{source.ml.prediction.agreementText}</Badge>
                      <Badge color="gray">{mlSummary.compareText}</Badge>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55 }}>
                      {source.ml.prediction.datasetQualityHint}
                    </div>
                  </div>
                </div>
                <Divider />
                <SummaryListCard title="Что проверить вручную" items={mlSummary.manualChecks} />
              </CardBody>
            </Card>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 14 }}>
          <div data-export-kind="chart">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>История ML-риска по релизам</CardTitle>
                  <CardHint>Риск по каждому релизу в диапазоне. Маркеры показывают высокий ML-риск и аномальные релизы.</CardHint>
                </div>
                <Badge color={displayedMlRiskPct == null ? 'gray' : displayedMlRiskPct >= 70 ? 'red' : displayedMlRiskPct >= 45 ? 'yellow' : 'green'}>
                  {displayedMlRiskPct == null ? 'нет оценки' : `${displayedMlRiskPct}%`}
                </Badge>
              </CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={riskHistoryDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))} palette={palette} markers={releaseMarkers} yTickFormatter={value => `${Math.round(Number(value))}%`} tooltipFormatter={value => `${Math.round(value)}% риска`} />
                  : <LineChart labels={labels} datasets={riskHistoryDatasets} palette={palette} markers={releaseMarkers} yTickFormatter={value => `${Math.round(Number(value))}%`} tooltipFormatter={value => `${Math.round(value)}% риска`} valueLabelFormatter={value => `${Math.round(value)}%`} valueLabelMode="all" />}
              </CardBody>
            </Card>
          </div>
          <div data-export-kind="ml"><MlFeatureDriversCard drivers={source.ml.prediction.featureDrivers} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.regress} /></div>
          <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.release} /></div>
          <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.types} /></div>
          <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.streams} /></div>
        </div>
      </>
    );
  };

  const renderRegressTab = () => {
    const source = displayedReport;
    if (!source) return null;
    const releaseMarkers = buildReleaseMarkers(source.metrics);
    const tcDatasets = [
      { label: 'Manual', data: source.metrics.map(item => item.tc_manual), color: '#8B5CF6' },
      { label: 'Auto', data: source.metrics.map(item => item.tc_auto), color: '#06B6D4' },
    ];
    const covDatasets = [
      { label: 'HB SWAT', data: source.metrics.map(item => item.cov_swat), color: '#8B5CF6' },
      { label: 'HB Stream', data: source.metrics.map(item => item.cov_stream), color: '#14B8A6' },
    ];
    const selDatasets = [
      { label: 'Selective SWAT', data: source.metrics.map(item => item.sel_swat), color: '#EC4899' },
      { label: 'Selective Stream', data: source.metrics.map(item => item.sel_stream), color: '#22C55E' },
    ];
    const avgDatasets = [
      { label: 'Среднее', data: source.metrics.map(item => item.avg_total), color: '#F97316' },
      { label: 'Взвешенное', data: source.metrics.map(item => item.avg_weighted), color: '#3B82F6', dashed: true },
    ];

    const renderPrimary = (
      datasets: LineDataset[] | BarDataset[],
      stacked = false,
      yTickFormatter?: (value: number) => string,
      tooltipFormatter?: (value: number, datasetLabel: string) => string,
      valueLabelFormatter?: (value: number, datasetLabel: string) => string,
      valueLabelMode: ValueLabelMode = 'all'
    ) => {
      if (chartMode === 'bar') {
        return <BarChart labels={labels} datasets={datasets as BarDataset[]} palette={palette} markers={[]} stacked={stacked} yTickFormatter={yTickFormatter} tooltipFormatter={tooltipFormatter} valueLabelFormatter={valueLabelFormatter} height={240} />;
      }
      return (
        <LineChart
          labels={labels}
          datasets={datasets as LineDataset[]}
          palette={palette}
          markers={[]}
          yTickFormatter={yTickFormatter}
          tooltipFormatter={tooltipFormatter}
          valueLabelFormatter={valueLabelFormatter}
          valueLabelMode={valueLabelMode}
          height={240}
        />
      );
    };

    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Card>
            <CardHeader><CardTitle>Объём регресса</CardTitle><CardHint>Manual и Auto по релизам в текущей выборке.</CardHint></CardHeader>
            <CardBody>{renderPrimary(tcDatasets, true, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <div className="charts-data-table-wrap">
              <table className="charts-data-table">
                <thead><tr><th>Релиз</th><th>Ручные</th><th>Авто</th><th>Всего</th></tr></thead>
                <tbody>{source.tcRows.map(row => (
                  <tr key={`tc-${row.release}`}>
                    <td>{formatReleaseShort(row.release)}</td>
                    <td>{row.manual.toLocaleString('ru-RU')}</td>
                    <td>{row.auto.toLocaleString('ru-RU')}</td>
                    <td>{row.total.toLocaleString('ru-RU')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>High / Blocker: SWAT vs Stream</CardTitle><CardHint>Сравнение критичных проверок SWAT и stream-команд.</CardHint></CardHeader>
            <CardBody>{renderPrimary(covDatasets, false, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <div className="charts-data-table-wrap">
              <table className="charts-data-table">
                <thead><tr><th>Номер релиза</th><th>SWAT</th><th>SWAT (сотр.)</th><th>STREAM</th><th>Всего</th><th>Покрытие</th></tr></thead>
                <tbody>{source.coverageRows.map(row => {
                  const sum = (row.swatCount || 0) + (row.streamCount || 0);
                  const swPct = sum ? Math.round((row.swatCount / sum) * 1000) / 10 : 0;
                  const stPct = sum ? Math.round((row.streamCount / sum) * 1000) / 10 : 0;
                  return (
                    <tr key={`cov-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td>{row.swatCount}</td>
                      <td>{Number(row.swatPeople || 0)}</td>
                      <td>{row.streamCount}</td>
                      <td>{sum}</td>
                      <td style={{ textAlign: 'left' }}>SWAT {swPct}% · STREAM {stPct}%</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Selective: SWAT vs Stream</CardTitle><CardHint>Объём selective-проверок по двум контурам.</CardHint></CardHeader>
            <CardBody>{renderPrimary(selDatasets, false, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <div className="charts-data-table-wrap">
              <table className="charts-data-table">
                <thead><tr><th>Номер релиза</th><th>SWAT</th><th>SWAT (сотр.)</th><th>STREAM</th><th>Всего</th><th>Покрытие</th></tr></thead>
                <tbody>{source.selectiveRows.map(row => {
                  const sum = (row.swatCount || 0) + (row.streamCount || 0);
                  const swPct = sum ? Math.round((row.swatCount / sum) * 1000) / 10 : 0;
                  const stPct = sum ? Math.round((row.streamCount / sum) * 1000) / 10 : 0;
                  return (
                    <tr key={`sel-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td>{row.swatCount}</td>
                      <td>{Number(row.swatPeople || 0)}</td>
                      <td>{row.streamCount}</td>
                      <td>{sum}</td>
                      <td style={{ textAlign: 'left' }}>SWAT {swPct}% · STREAM {stPct}%</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Среднее время прохождения</CardTitle><CardHint>Среднее время на кейс: SWAT, STREAM и общее.</CardHint></CardHeader>
            <CardBody>{renderPrimary(avgDatasets, false, value => formatMinutesToClock(value), value => `${formatMinutesPretty(value, 2)} · ${value.toFixed(2)} мин`, value => formatMinutesToClock(value))}</CardBody>
            <div className="charts-data-table-wrap">
              <table className="charts-data-table">
                <thead><tr><th>Номер релиза</th><th>SWAT</th><th>STREAM</th><th>Общее</th></tr></thead>
                <tbody>{source.avgRows.map(row => (
                  <tr key={`avg-${row.release}`}>
                    <td>{formatReleaseShort(row.release)}</td>
                    <td>{formatMinutesToClock(row.swatMs / 60000)}</td>
                    <td>{formatMinutesToClock(row.streamMs / 60000)}</td>
                    <td>{formatMinutesToClock(row.totalMs / 60000)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </div>
      </>
    );
  };

  const renderReleaseTab = () => {
    const source = displayedReport;
    if (!source) return null;
    const releaseMarkers = buildReleaseMarkers(source.metrics);
    const quietReleaseMarkers = withSilentMarkerLabels(releaseMarkers);
    const chpDatasets = [
      { label: 'Всего', data: source.metrics.map(item => item.chp_total), color: '#EF4444', fill: chartMode === 'line' },
      { label: 'iOS', data: source.metrics.map(item => item.chp_ios), color: '#8B5CF6' },
      { label: 'Android', data: source.metrics.map(item => item.chp_android), color: '#22C55E' },
    ];
    const buildChpTypeDatasets = (rows: ChartsReport['chpTypes']['rows']) => ([
      { label: 'Аналитика', data: rows.map(row => row.product), color: '#F59E0B' },
      { label: 'Влет', data: rows.map(row => row.vlet), color: '#06B6D4' },
      { label: 'Баг', data: rows.map(row => row.bug), color: '#EF4444' },
      { label: 'Краш', data: rows.map(row => row.crash), color: '#8B5CF6' },
    ]);
    const chpTypeDatasets = buildChpTypeDatasets(source.chpTypes.rows);
    const chpTypeIosDatasets = buildChpTypeDatasets(source.chpTypes.iosRows);
    const chpTypeAndroidDatasets = buildChpTypeDatasets(source.chpTypes.androidRows);
    const cutStoreDatasets: LineDataset[] = [
      { label: 'iOS Cutoff', data: source.timings.map(row => row.iosCutMinutes), color: '#8B5CF6' },
      { label: 'Android Cutoff', data: source.timings.map(row => row.androidCutMinutes), color: '#22C55E' },
      { label: 'iOS Store', data: source.timings.map(row => row.iosStoreMinutes), color: '#3B82F6', dashed: true },
      { label: 'Android Store', data: source.timings.map(row => row.androidStoreMinutes), color: '#F97316', dashed: true },
    ];
    const regressionDatasets: LineDataset[] = [
      { label: 'Старт iOS', data: source.timings.map(row => row.iosRegressionMinutes), color: '#8B5CF6' },
      { label: 'Старт Android', data: source.timings.map(row => row.androidRegressionMinutes), color: '#22C55E' },
      { label: 'Lag iOS', data: source.timings.map(row => row.iosLagMinutes), color: '#3B82F6', dashed: true },
      { label: 'Lag Android', data: source.timings.map(row => row.androidLagMinutes), color: '#F97316', dashed: true },
    ];
    const iosDowntimeDatasets: LineDataset[] = [
      { label: 'iOS DEV downtime', data: source.devDowntime.iosByRelease.map(row => row.totalMinutes), color: '#8B5CF6', fill: chartMode === 'line' },
    ];
    const androidDowntimeDatasets: LineDataset[] = [
      { label: 'Android DEV downtime', data: source.devDowntime.androidByRelease.map(row => row.totalMinutes), color: '#22C55E', fill: chartMode === 'line' },
    ];
    const renderChpTypeCard = (title: string, datasets: BarDataset[] | LineDataset[]) => (
      <div data-export-kind="chart">
        <Card>
          <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
          <CardBody>
            {renderLegendRow((datasets as Array<{ label: string; color: string }>).map(item => ({ label: item.label, color: item.color })))}
            {chartMode === 'bar'
              ? <BarChart labels={labels} datasets={datasets as BarDataset[]} palette={palette} markers={quietReleaseMarkers} stacked yTickFormatter={value => Number(value).toLocaleString('ru-RU')} legendDisplay={false} height={220} valueLabelFormatter={value => formatCountLabelCompact(value)} />
              : <LineChart
                  labels={labels}
                  datasets={(datasets as LineDataset[]).map(item => ({ ...item, fill: false }))}
                  palette={palette}
                  markers={quietReleaseMarkers}
                  yTickFormatter={value => Number(value).toLocaleString('ru-RU')}
                  tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${formatCountLabel(value)}`}
                  valueLabelFormatter={value => formatCountLabelCompact(value)}
                  valueLabelMode="all"
                  legendDisplay={false}
                  height={220}
                />}
          </CardBody>
        </Card>
      </div>
    );
    const renderDowntimeTable = (title: string, rows: ChartsDowntimeRow[], color: 'purple' | 'green') => (
      <div data-export-kind="data">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardHint>{rows.length ? `${rows.length} строк с привязкой к релизу` : 'Простоев в диапазоне нет'}</CardHint>
            </div>
            <Badge color={color}>{rows.length}</Badge>
          </CardHeader>
          <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Релиз</Th>
                  <Th>Дата</Th>
                  <Th>Минут</Th>
                  <Th>Интервалы</Th>
                  <Th>{title.includes('Android') ? 'Сломал / Починил' : 'Домен / Owners'}</Th>
                  <Th>Комментарий</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row, index) => (
                  <tr key={`${title}-${row.release}-${row.rawDate}-${index}`}>
                    <Td mono>{row.releaseShort || '—'}</Td>
                    <Td mono>{row.rawDate}</Td>
                    <Td mono>{formatDowntimeLabel(row.totalMinutes, 1)}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{row.intervalText || '—'}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{title.includes('Android') ? `${row.brokenText || '—'}\n${row.fixedText || ''}`.trim() : `${row.domainText || '—'}\n${row.ownersText || ''}`.trim()}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{row.commentText || (row.warnings?.length ? row.warnings.join('\n') : '—')}</Td>
                  </tr>
                )) : (
                  <tr><Td colSpan={6}><EmptyState text="Нет привязанных простоев в выбранном диапазоне." /></Td></tr>
                )}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    );
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 14 }}>
          <div data-export-kind="chart">
            <Card>
              <CardHeader><CardTitle>ЧП по релизам</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={chpDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => Number(value).toLocaleString('ru-RU')} valueLabelFormatter={value => formatCountLabelCompact(value)} height={240} />
                  : <LineChart labels={labels} datasets={chpDatasets} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => Number(value).toLocaleString('ru-RU')} tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${formatCountLabel(value)}`} valueLabelFormatter={value => formatCountLabelCompact(value)} valueLabelMode="all" height={240} />}
              </CardBody>
              <div className="charts-data-table-wrap">
                <table className="charts-data-table">
                  <thead><tr><th>Номер релиза</th><th>iOS</th><th>Android</th><th>Всего</th></tr></thead>
                  <tbody>{source.chpRows.map(row => (
                    <tr key={`chp-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td>{row.ios}</td>
                      <td>{row.android}</td>
                      <td>{row.total}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          </div>
          {renderChpTypeCard('ЧП типы · всё', chpTypeDatasets)}
        </div>
        <div data-export-kind="ml">
          <ChpQuarterSummary stats={source.chpQuarterStats} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {renderChpTypeCard('ЧП типы · iOS', chpTypeIosDatasets)}
          {renderChpTypeCard('ЧП типы · Android', chpTypeAndroidDatasets)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="chart">
            <Card>
              <CardHeader><CardTitle>Cutoff и Store</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart
                      labels={labels}
                      datasets={cutStoreDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatMinutesToClock}
                      tooltipFormatter={value => formatMinutesToClock(value)}
                      valueLabelFormatter={value => formatMinutesToClock(value)}
                      height={260}
                    />
                  : <LineChart
                      labels={labels}
                      datasets={cutStoreDatasets}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatMinutesToClock}
                      tooltipFormatter={value => formatMinutesToClock(value)}
                      valueLabelFormatter={value => formatMinutesToClock(value)}
                      valueLabelMode="all"
                      height={260}
                    />}
              </CardBody>
              <div className="charts-data-table-wrap">
                <table className="charts-data-table">
                  <thead><tr><th>Номер релиза</th><th>iOS Cutoff</th><th>iOS Store</th><th>Android Cutoff</th><th>Android Store</th></tr></thead>
                  <tbody>{source.timings.map(row => (
                    <tr key={`cut-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td className={getCutClass(row.iosCutMinutes)}>{row.iosCutLabel || '—'}</td>
                      <td className={isStoreLate(row.iosStoreMinutes) ? 'cut-store-late' : ''}>{row.iosStoreLabel || '—'}</td>
                      <td className={getCutClass(row.androidCutMinutes)}>{row.androidCutLabel || '—'}</td>
                      <td className={isStoreLate(row.androidStoreMinutes) ? 'cut-store-late' : ''}>{row.androidStoreLabel || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          </div>
          <div data-export-kind="chart">
            <Card>
              <CardHeader><CardTitle>Старт регресса и Lag</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart
                      labels={labels}
                      datasets={regressionDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatMinutesToClock}
                      tooltipFormatter={value => formatMinutesToClock(value)}
                      valueLabelFormatter={value => formatMinutesToClock(value)}
                      height={260}
                    />
                  : <LineChart
                      labels={labels}
                      datasets={regressionDatasets}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatMinutesToClock}
                      tooltipFormatter={value => formatMinutesToClock(value)}
                      valueLabelFormatter={value => formatMinutesToClock(value)}
                      valueLabelMode="all"
                      height={260}
                    />}
              </CardBody>
              <div className="charts-data-table-wrap">
                <table className="charts-data-table">
                  <thead><tr><th>Релиз</th><th>Время старта iOS</th><th>Время старта Android</th></tr></thead>
                  <tbody>{source.timings.map(row => (
                    <tr key={`reg-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td>{row.iosRegressionLabel || '—'}</td>
                      <td>{row.androidRegressionLabel || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="chart">
            <Card>
              <CardHeader><CardTitle>DEV downtime · iOS</CardTitle><Badge color="purple">{source.devDowntime.iosRows.length}</Badge></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={iosDowntimeDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesPretty(value, 1)} valueLabelFormatter={value => formatMinutesPretty(value, 1)} height={220} />
                  : <LineChart labels={labels} datasets={iosDowntimeDatasets} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesPretty(value, 1)} tooltipFormatter={value => formatMinutesPretty(value, 1)} valueLabelFormatter={value => formatMinutesPretty(value, 1)} valueLabelMode="all" height={220} />}
              </CardBody>
            </Card>
          </div>
          <div data-export-kind="chart">
            <Card>
              <CardHeader><CardTitle>DEV downtime · Android</CardTitle><Badge color="green">{source.devDowntime.androidRows.length}</Badge></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={androidDowntimeDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesPretty(value, 1)} valueLabelFormatter={value => formatMinutesPretty(value, 1)} height={220} />
                  : <LineChart labels={labels} datasets={androidDowntimeDatasets} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesPretty(value, 1)} tooltipFormatter={value => formatMinutesPretty(value, 1)} valueLabelFormatter={value => formatMinutesPretty(value, 1)} valueLabelMode="all" height={220} />}
              </CardBody>
            </Card>
          </div>
        </div>
        <div data-export-kind="data">
          <Card>
            <CardHeader><CardTitle>Тайминг по релизам</CardTitle></CardHeader>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Релиз</Th>
                    <Th>iOS Cutoff</Th>
                    <Th>Android Cutoff</Th>
                    <Th>iOS Store</Th>
                    <Th>Android Store</Th>
                    <Th>iOS Старт</Th>
                    <Th>Android Старт</Th>
                    <Th>Lag iOS</Th>
                    <Th>Lag Android</Th>
                  </tr>
                </thead>
                <tbody>
                  {source.timings.map(row => (
                    <tr key={`timing-${row.release}`}>
                      <Td mono bold>{row.release}</Td>
                      <Td mono>{row.iosCutLabel || '—'}</Td>
                      <Td mono>{row.androidCutLabel || '—'}</Td>
                      <Td mono>{row.iosStoreLabel || '—'}</Td>
                      <Td mono>{row.androidStoreLabel || '—'}</Td>
                      <Td mono>{row.iosRegressionLabel || '—'}</Td>
                      <Td mono>{row.androidRegressionLabel || '—'}</Td>
                      <Td mono>{row.iosLagMinutes == null ? '—' : formatMinutesPretty(row.iosLagMinutes, 1)}</Td>
                      <Td mono>{row.androidLagMinutes == null ? '—' : formatMinutesPretty(row.androidLagMinutes, 1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {renderDowntimeTable('Простой DEV · iOS wiki', source.devDowntime.iosRows, 'purple')}
          {renderDowntimeTable('Простой DEV · Android Band', source.devDowntime.androidRows, 'green')}
        </div>
      </>
    );
  };

  const renderTypesChart = (title: string, rows: ChartsTaskTypeRow[], typeNames: string[], markers: ChartMarker[]) => (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardBody>
        {typeNames.length ? (
          (() => {
            const legendItems = typeNames.slice(0, 10).map(type => ({ label: type, color: hashColor(type) }));
            return (
              <>
                {renderLegendRow(legendItems)}
                {chartMode === 'bar' ? (
                  <BarChart
                    labels={labels}
                    datasets={legendItems.map(item => ({
                      label: item.label,
                      data: rows.map(row => Number(row.counts[item.label] || 0)),
                      color: item.color,
                    }))}
                    palette={palette}
                    markers={withSilentMarkerLabels(markers)}
                    stacked
                    yTickFormatter={value => Number(value).toLocaleString('ru-RU')}
                    legendDisplay={false}
                    height={220}
                  />
                ) : (
                  <LineChart
                    labels={labels}
                    datasets={legendItems.map(item => ({
                      label: item.label,
                      data: rows.map(row => Number(row.counts[item.label] || 0)),
                      color: item.color,
                      fill: false,
                    }))}
                    palette={palette}
                    markers={withSilentMarkerLabels(markers)}
                    yTickFormatter={value => Number(value).toLocaleString('ru-RU')}
                    tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${Number(value).toLocaleString('ru-RU')}`}
                    valueLabelMode="none"
                    legendDisplay={false}
                    height={220}
                  />
                )}
              </>
            );
          })()
        ) : <EmptyState text="Нет данных по типам." />}
      </CardBody>
    </Card>
  );

  const renderTypesTab = () => {
    const source = displayedReport;
    if (!source) return null;
    const releaseMarkers = buildReleaseMarkers(source.metrics);
    const lastIos = source.taskTypes.iosRows[source.taskTypes.iosRows.length - 1];
    const lastAndroid = source.taskTypes.androidRows[source.taskTypes.androidRows.length - 1];
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="chart">{renderTypesChart('Типы задач iOS', source.taskTypes.iosRows, source.taskTypes.iosTypes, releaseMarkers)}</div>
          <div data-export-kind="chart">{renderTypesChart('Типы задач Android', source.taskTypes.androidRows, source.taskTypes.androidTypes, releaseMarkers)}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div data-export-kind="data"><Card>
            <CardHeader><CardTitle>iOS</CardTitle><Badge color="purple">{formatReleaseShort(lastIos?.release || '—')}</Badge></CardHeader>
            <CardBody>{renderTopTypesTable(source.aiContext.taskTypes.ios)}</CardBody>
          </Card></div>
          <div data-export-kind="data"><Card>
            <CardHeader><CardTitle>Android</CardTitle><Badge color="green">{formatReleaseShort(lastAndroid?.release || '—')}</Badge></CardHeader>
            <CardBody>{renderTopTypesTable(source.aiContext.taskTypes.android)}</CardBody>
          </Card></div>
          <div data-export-kind="data"><Card>
            <CardHeader><CardTitle>ЧП типы · всё</CardTitle><Badge color="red">{source.chpTypes.rows[source.chpTypes.rows.length - 1]?.release || '—'}</Badge></CardHeader>
            <CardBody>{renderTopTypesTable(source.aiContext.taskTypes.chpAll)}</CardBody>
          </Card></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="data"><Card>
            <CardHeader><CardTitle>ЧП типы · iOS</CardTitle><Badge color="purple">{source.chpTypes.iosRows[source.chpTypes.iosRows.length - 1]?.release || '—'}</Badge></CardHeader>
            <CardBody>{renderTopTypesTable(source.aiContext.taskTypes.chpIos)}</CardBody>
          </Card></div>
          <div data-export-kind="data"><Card>
            <CardHeader><CardTitle>ЧП типы · Android</CardTitle><Badge color="green">{source.chpTypes.androidRows[source.chpTypes.androidRows.length - 1]?.release || '—'}</Badge></CardHeader>
            <CardBody>{renderTopTypesTable(source.aiContext.taskTypes.chpAndroid)}</CardBody>
          </Card></div>
        </div>
      </>
    );
  };

  function renderStreamDeltaCell(before: number, delta: number, digits = 0) {
    const after = before + delta;
    if (!delta) return <span style={{ color: 'var(--text-3)' }}>{formatMaybeNumber(after, digits)}</span>;
    const isMore = delta > 0;
    const color = isMore ? '#DC2626' : '#16A34A';
    const arrow = isMore ? '↑' : '↓';
    const sign = isMore ? '+' : '';
    const abs = formatMaybeNumber(Math.abs(delta), digits);
    return (
      <span>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMaybeNumber(after, digits)} </span>
        <span style={{ color, fontWeight: 600 }}>({arrow}{sign}{abs})</span>
      </span>
    );
  }

  const renderStreamsTab = () => {
    const source = displayedReport || report;
    if (!source) return null;
    const filteredRows = source.streamDeltaRows;
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div data-export-kind="data">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Внутренние стримы</CardTitle>
                  <CardHint>Текущий релиз: список стримов без внешних доменов.</CardHint>
                </div>
                <Badge color="gray">{source.streamInsights.internalStreams.length}</Badge>
              </CardHeader>
              <CardBody style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {source.streamInsights.internalStreams.length ? source.streamInsights.internalStreams.map(stream => (
                  <Badge key={`internal-${stream}`} color="gray">{stream}</Badge>
                )) : <EmptyState text="Внутренние стримы не найдены." />}
              </CardBody>
            </Card>
          </div>
          <div data-export-kind="data">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Внешние стримы</CardTitle>
                  <CardHint>Финтех, банк, payments, travel и прочие внешние домены.</CardHint>
                </div>
                <Badge color="gray">{source.streamInsights.externalStreams.length}</Badge>
              </CardHeader>
              <CardBody style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {source.streamInsights.externalStreams.length ? source.streamInsights.externalStreams.map(stream => (
                  <Badge key={`external-${stream}`} color="yellow">{stream}</Badge>
                )) : <EmptyState text="Внешние стримы не найдены." />}
              </CardBody>
            </Card>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div data-export-kind="chart"><InsightBlock title="HB стримы" summary={source.streamInsights.hb} /></div>
          <div data-export-kind="chart"><InsightBlock title="Selective стримы" summary={source.streamInsights.selective} /></div>
          <div data-export-kind="chart"><InsightBlock title="UwU по стримам" summary={source.streamInsights.uwu} /></div>
        </div>
        <div data-export-kind="data"><Card>
          <CardHeader>
            <div>
              <CardTitle>Дельта по стримам</CardTitle>
              <CardHint>Изменения между соседними релизами: ручные кейсы, авто-кейсы и UwU. Карточки выше показывают последний шаг в диапазоне.</CardHint>
            </div>
          </CardHeader>
          <div style={{ overflowX: 'auto', maxHeight: 760, overflowY: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Релиз</Th>
                  <Th>Стрим</Th>
                  <Th>Ручные кейсы</Th>
                  <Th>Авто-кейсы</Th>
                  <Th>UwU (ручные)</Th>
                  <Th>UwU (авто)</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length ? filteredRows.map(row => (
                  <tr key={`${row.release}-${row.stream}`}>
                    <Td mono>{row.release}</Td>
                    <Td>{row.stream}</Td>
                    <Td>{renderStreamDeltaCell(row.manualBefore, row.manualDelta)}</Td>
                    <Td>{renderStreamDeltaCell(row.autoBefore, row.autoDelta)}</Td>
                    <Td>{renderStreamDeltaCell(row.uwuManualBefore, row.uwuManualDelta, 1)}</Td>
                    <Td>{renderStreamDeltaCell(row.uwuAutoBefore, row.uwuAutoDelta, 1)}</Td>
                  </tr>
                )) : (
                  <tr><Td colSpan={6}><EmptyState text="Нет изменений по стримам." /></Td></tr>
                )}
              </tbody>
            </Table>
          </div>
        </Card></div>
      </>
    );
  };

  const renderAiTab = () => {
    const source = displayedReport || report;
    if (!source) return null;
    const currentMlRisk = source.ml.prediction.activeProbability == null ? null : Math.round(source.ml.prediction.activeProbability * 100);
    const mlSummary = source.ml.summary;
    const releaseMarkers = buildReleaseMarkers(source.metrics);
    const riskHistoryDatasets = [
      { label: 'ML риск', data: source.metrics.map(item => item.mlRiskPct), color: '#8B5CF6', fill: chartMode === 'line' },
    ];
    const softCardBg = theme === 'dark' ? 'rgba(148,163,184,.06)' : 'rgba(148,163,184,.08)';
    const renderSummaryBlock = (title: string, items: string[], tone: 'ok' | 'warn' | 'bad' | 'neutral' = 'neutral') => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: softCardBg }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px', color: tone === 'neutral' ? 'var(--text-3)' : summaryToneToTextColor(tone) }}>
          {title}
        </div>
        {items.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-2)', lineHeight: 1.55, fontSize: 13 }}>
            {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
          </ul>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Нет заметных сигналов.</div>
        )}
      </div>
    );
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 14 }}>
          <div data-export-kind="ml"><Card>
            <CardHeader>
              <div>
                <CardTitle>ML-сводка</CardTitle>
                <CardHint>Локальная сводка строится из собранных метрик, базы сравнения и аномалий, как в legacy-подходе.</CardHint>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMlSummaryCollapsed(value => !value)}>
                {mlSummaryCollapsed ? 'Развернуть' : 'Свернуть'}
              </Button>
            </CardHeader>
            {!mlSummaryCollapsed && <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Badge color="gray">{mlSummary.compareText}</Badge>
                <Badge color="gray">{source.ml.prediction.labeledSamples} размечено</Badge>
              </div>
              {mlSummary.highlights.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  {mlSummary.highlights.map(item => (
                    <div key={`ml-highlight-${item.label}`} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: softCardBg, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)' }}>{item.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{item.current}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: summaryToneToTextColor(item.tone) }}>{item.delta}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>База: {item.base}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {renderSummaryBlock('Общий вывод', mlSummary.overview, mlSummary.statusTone)}
                {renderSummaryBlock('Главные риски', mlSummary.risks, 'bad')}
                {renderSummaryBlock('Что изменилось', mlSummary.changes, 'ok')}
                {renderSummaryBlock('Рекомендации', mlSummary.recommendations, 'warn')}
              </div>
              {renderSummaryBlock('Что проверить вручную', mlSummary.manualChecks)}
            </CardBody>}
          </Card></div>
          <div data-export-kind="ml"><Card>
            <CardHeader>
              <div>
                <CardTitle>Риск ML</CardTitle>
                <CardHint>{source.metrics[source.metrics.length - 1]?.release || '—'} · качество датасета, переобучение и признаки модели.</CardHint>
              </div>
              <Badge color={source.ml.prediction.engine === 'catboost' ? 'green' : source.ml.prediction.engine === 'linear' ? 'yellow' : 'gray'}>
                {mlEngineLabel(source.ml.prediction.engine)}
              </Badge>
            </CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 14, alignItems: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <GaugeChart value={currentMlRisk ?? 0} size={140} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: currentMlRisk == null ? 'var(--text-3)' : currentMlRisk <= 35 ? '#16A34A' : currentMlRisk <= 65 ? '#D97706' : '#DC2626' }}>
                    {currentMlRisk == null
                      ? 'Нет оценки'
                      : currentMlRisk <= 1
                        ? 'Явного сигнала регресса не видно'
                        : `${currentMlRisk}% вероятности регресса`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    Линейная модель: {source.ml.prediction.linearProbability == null ? '—' : `${Math.round(source.ml.prediction.linearProbability * 100)}%`} · CatBoost: {source.ml.prediction.catboostProbability == null ? '—' : `${Math.round(source.ml.prediction.catboostProbability * 100)}%`}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Badge color={mlDatasetQualityColor(source.ml.prediction.datasetQuality)}>{source.ml.prediction.datasetQualityText}</Badge>
                    <Badge color={mlAgreementColor(source.ml.prediction.modelAgreementPct)}>{source.ml.prediction.agreementText}</Badge>
                    <Badge color="gray">{source.ml.prediction.labeledSamples} размечено</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55 }}>
                    {currentMlRisk != null && currentMlRisk <= 1
                      ? 'Это не гарантия отсутствия проблем: модель просто не видит явного негативного паттерна в текущем наборе метрик.'
                      : source.ml.prediction.datasetQualityHint}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Button variant="secondary" size="sm" onClick={saveMlSnapshot}>Сохранить выгрузку</Button>
                    <Button variant="ghost" size="sm" onClick={retrainOnly} disabled={Boolean(actionBusy)}>
                      {actionBusy === 'retrain' ? '...' : 'Переобучить CatBoost'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => labelAndRetrain('ok')} disabled={Boolean(actionBusy)}>
                      {actionBusy === 'OK' ? '...' : 'OK + переобучить'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => labelAndRetrain('fail')} disabled={Boolean(actionBusy)}>
                      {actionBusy === 'Регресс' ? '...' : 'Регресс + переобучить'}
                    </Button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <StatusPill status={source.ml.helperHealth.online ? 'live' : 'warn'}>
                      {helperStatusLabel(source.ml.helperHealth.online)}
                    </StatusPill>
                    {source.ml.helperHealth.base && <Badge color="gray">{source.ml.helperHealth.base}</Badge>}
                    {!source.ml.prediction.trained && <Badge color="yellow">{source.ml.prediction.reason}</Badge>}
                  </div>
                </div>
              </div>
              {!source.ml.helperHealth.online && source.ml.helperHealth.error && (
                <div style={{ fontSize: 12, color: '#D97706', lineHeight: 1.55 }}>
                  {source.ml.helperHealth.error}
                </div>
              )}
              <Divider />
              <div data-export-kind="chart">
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={riskHistoryDatasets.map(item => ({ label: item.label, data: item.data, color: item.color }))} palette={palette} markers={releaseMarkers} yTickFormatter={value => `${Math.round(Number(value))}%`} tooltipFormatter={value => `${Math.round(value)}% риска`} />
                  : <LineChart labels={labels} datasets={riskHistoryDatasets} palette={palette} markers={releaseMarkers} yTickFormatter={value => `${Math.round(Number(value))}%`} tooltipFormatter={value => `${Math.round(value)}% риска`} valueLabelFormatter={value => `${Math.round(value)}%`} />}
              </div>
              <Divider />
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text-3)' }}>ML-признаки</div>
              <div style={{ overflowX: 'auto', maxHeight: 320 }}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Параметр</Th>
                      <Th>Значение</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(source.ml.features || {}).map(([key, value]) => (
                      <tr key={`feature-${key}`}>
                        <Td style={{ color: 'var(--text-2)' }}>{getChartsMlFeatureLabel(key)}</Td>
                        <Td mono>{formatMaybeNumber(value, 2)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </CardBody>
          </Card></div>
        </div>
        <div data-export-kind="ml"><MlFeatureDriversCard drivers={source.ml.prediction.featureDrivers} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div data-export-kind="ml"><Card>
            <CardHeader><CardTitle>Аномалии релиза</CardTitle><Badge color={source.anomalies.release.count ? 'red' : 'green'}>{source.anomalies.release.count}</Badge></CardHeader>
            <CardBody>
              {source.anomalies.release.list.length ? source.anomalies.release.list.map(item => (
                <div key={`an-rel-${item.label}`} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatChangeNarrative(item.delta, item.deltaPct, item.prev, item.last)}
                  </div>
                </div>
              )) : <EmptyState text="Аномалий не найдено." />}
            </CardBody>
          </Card></div>
          <div data-export-kind="ml"><Card>
            <CardHeader><CardTitle>Аномалии типов</CardTitle><Badge color={source.anomalies.type.count ? 'yellow' : 'green'}>{source.anomalies.type.count}</Badge></CardHeader>
            <CardBody>
              {source.anomalies.type.list.length ? source.anomalies.type.list.map(item => (
                <div key={`an-type-${item.label}`} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatChangeNarrative(item.delta, item.deltaPct)}
                  </div>
                </div>
              )) : <EmptyState text="Аномалий не найдено." />}
            </CardBody>
          </Card></div>
          <div data-export-kind="ml"><Card>
            <CardHeader><CardTitle>Аномалии платформ</CardTitle><Badge color={source.anomalies.platform.count ? 'yellow' : 'green'}>{source.anomalies.platform.count}</Badge></CardHeader>
            <CardBody>
              {source.anomalies.platform.list.length ? source.anomalies.platform.list.map(item => (
                <div key={`an-plat-${item.label}`} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatChangeNarrative(item.delta, item.deltaPct)}
                  </div>
                </div>
              )) : <EmptyState text="Аномалий не найдено." />}
            </CardBody>
          </Card></div>
        </div>
      </>
    );
  };

  return (
    <div ref={rootRef} className="charts-shell">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(155,92,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◈</div>
            Графики
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
            Реальные метрики регресса, релизных таймингов, ЧП, стримов и ML/AI анализа.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" size="sm" onClick={exportJson} disabled={!report}>Экспорт JSON</Button>
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!report}>Экспорт CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf()} disabled={!report || exportingPdf}>{exportingPdf ? 'PDF...' : 'PDF всё'}</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf({ chartsOnly: true, includeMl: true })} disabled={!report || exportingPdf}>PDF графики + ML</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf({ chartsOnly: true, includeMl: false })} disabled={!report || exportingPdf}>PDF графики</Button>
        </div>
      </div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <FieldLabel>Версия от</FieldLabel>
              <Input value={releaseFrom} onChange={event => setReleaseFrom(event.target.value)} style={{ width: 150 }} placeholder="7.5.0000" />
            </div>
            <div>
              <FieldLabel>Версия до</FieldLabel>
              <Input value={releaseTo} onChange={event => setReleaseTo(event.target.value)} style={{ width: 150 }} placeholder="7.5.9000" />
            </div>
            <div>
              <FieldLabel>Сравнение базы</FieldLabel>
              <SegmentControl
                items={[{ label: 'Среднее', value: 'mean' }, { label: 'Предыдущий', value: 'prev' }]}
                value={compareMode}
                onChange={value => setCompareMode(value as CompareMode)}
              />
            </div>
            <div>
              <FieldLabel>Тип графика</FieldLabel>
              <SegmentControl
                items={[{ label: 'Линии', value: 'line' }, { label: 'Столбцы', value: 'bar' }]}
                value={chartMode}
                onChange={value => setChartMode(value as ChartMode)}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22, fontSize: 13, color: 'var(--text-2)' }}>
              <input type="checkbox" checked={aiAutoSummary} onChange={event => setAiAutoSummary(event.target.checked)} />
              AI после сбора
            </label>
            <Button variant="primary" onClick={run} disabled={loading}>
              {loading ? 'Сбор...' : 'Собрать графики'}
            </Button>
            <Button variant="danger" onClick={stop} disabled={!loading}>Остановить</Button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Badge color={status.proxyOnline === true ? 'green' : status.proxyOnline === false ? 'red' : 'gray'}>Proxy {status.proxyOnline === true ? 'онлайн' : status.proxyOnline === false ? 'офлайн' : '—'}</Badge>
            <Badge color={status.allureReady ? 'green' : 'red'}>Allure {status.allureReady ? 'ready' : 'missing'}</Badge>
            <Badge color={status.deployReady ? 'green' : 'gray'}>DeployLab {status.deployReady ? 'ready' : 'optional'}</Badge>
            <Badge color={status.ytReady ? 'green' : 'gray'}>YouTrack {status.ytReady ? 'ready' : 'optional'}</Badge>
            <Badge color={status.gitlabReady ? 'green' : 'gray'}>GitLab {status.gitlabReady ? 'ready' : 'optional'}</Badge>
            <Badge color={status.helperOnline === true ? 'green' : status.helperOnline === false ? 'yellow' : 'gray'}>ML-хелпер {status.helperOnline === true ? 'онлайн' : status.helperOnline === false ? 'офлайн' : '—'}</Badge>
            <Badge color="gray">{releaseRangePreview.length} релизов в диапазоне</Badge>
          </div>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)' }}>
                <span>Сбор данных</span>
                <span>{progress.done}/{progress.total || releaseRangePreview.length || 0}</span>
              </div>
              <Progress value={progress.done} max={progress.total || releaseRangePreview.length || 1} color="accent" />
            </div>
          )}
        </CardBody>
      </Card>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.16)', color: '#DC2626', borderRadius: 12, padding: '12px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!report ? (
        <Card><EmptyState text="Собери данные по диапазону релизов, чтобы построить графики и AI/ML анализ." /></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
            <div data-export-kind="data"><SummaryMetric label="Диапазон" value={`${formatReleaseShort(report.releases[0])} → ${formatReleaseShort(report.releases[report.releases.length - 1])}`} hint={`${visibleReleaseCount || report.releases.length} релизов в выборке`} /></div>
            <div data-export-kind="data"><SummaryMetric label="Текущий релиз" value={formatReleaseShort(currentMetric?.release || '—')} hint={`База: ${formatReleaseShort(displayedReport?.aiContext.releaseWindow.previousRelease || '—')}`} /></div>
            <div data-export-kind="data"><SummaryMetric label="Аномалии" value={report.anomalies.score} hint={`релиз ${report.anomalies.release.count} · типы ${report.anomalies.type.count} · платформы ${report.anomalies.platform.count}`} color={report.anomalies.score >= 5 ? '#DC2626' : report.anomalies.score >= 3 ? '#D97706' : undefined} /></div>
            <div data-export-kind="data"><SummaryMetric label="ML риск" value={displayedMlRiskPct == null ? '—' : `${displayedMlRiskPct}%`} hint="оценка по текущему срезу" color={displayedMlRiskPct == null ? undefined : displayedMlRiskPct >= 70 ? '#DC2626' : displayedMlRiskPct >= 45 ? '#D97706' : '#16A34A'} /></div>
          </div>

          <div data-export-kind="data">
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Глобальный фильтр релизов</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Применяется ко всем графикам, таблицам и дельтам по стримам на этом экране.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge color="gray">{buildReleaseFilterCaption(report.releases.length, selectedReleases.length || report.releases.length)}</Badge>
                  <Button variant="ghost" size="sm" onClick={resetReleaseFilter} disabled={!selectedReleases.length}>Сбросить</Button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {report.releases.map(release => {
                  const active = !selectedReleases.length || selectedReleases.includes(release);
                  return (
                    <button
                      key={`release-pill-${release}`}
                      type="button"
                      onClick={() => toggleRelease(release)}
                      style={{
                        borderRadius: 999,
                        border: `1px solid ${active ? 'rgba(155,92,255,.28)' : 'var(--border)'}`,
                        background: active ? 'rgba(155,92,255,.10)' : 'transparent',
                        color: active ? 'var(--text)' : 'var(--text-3)',
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {formatReleaseShort(release)}
                    </button>
                  );
                })}
              </div>
              </CardBody>
            </Card>
          </div>

          <div className="charts-tab-content">
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Режим сравнения: {compareMode === 'mean' ? 'историческое среднее' : 'предыдущий релиз'}
            </div>

            {/* LLM-сводка — вверху, до всех графиков */}
            <div data-export-kind="ml"><Card>
              <CardHeader>
                <div>
                  <CardTitle>LLM-сводка</CardTitle>
                  <CardHint>LLM получает структурированный контекст из метрик, таймингов, стримов, типов, downtime и локальной ML-сводки.</CardHint>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button variant="ghost" size="sm" onClick={() => setLlmSummaryCollapsed(v => !v)}>
                    {llmSummaryCollapsed ? 'Развернуть' : 'Свернуть'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={generateAi} disabled={aiLoading || !report}>
                    {aiLoading ? 'Генерация...' : 'Сформировать'}
                  </Button>
                </div>
              </CardHeader>
              {!llmSummaryCollapsed && <CardBody>
                {aiText ? (
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.72, fontSize: 13, color: 'var(--text-2)' }}>{aiText}</div>
                ) : (
                  <EmptyState text="LLM-сводка ещё не сформирована. Нажми «Сформировать» или включи «AI после сбора»." />
                )}
              </CardBody>}
            </Card></div>

            {renderRegressTab()}
            {renderReleaseTab()}
            {renderTypesTab()}
            {renderStreamsTab()}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>AI и ML сводка</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                  Отдельный аналитический слой: локальная ML-сводка, LLM-вывод, аномалии и признаки модели.
                </div>
              </div>
              {renderAiTab()}
            </div>
          </div>

          {logs.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Лог сбора</CardTitle></CardHeader>
              <CardBody><LogView lines={logs} /></CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
