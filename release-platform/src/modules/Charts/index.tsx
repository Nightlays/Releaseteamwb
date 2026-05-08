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
  rebuildChartsReportForReleases,
  rebuildChartsReportFromReleaseSnapshots,
  requestChartsAiSummary,
  rebuildChartsSummaryState,
  retrainChartsMlViaHelper,
  syncChartsMlDatasetToDrive,
  type ChartsDowntimeRow,
  type ChartsAiTypeSnapshot,
  type ChartsMetricRow,
  type ChartsReleaseSnapshotPayload,
  type ChartsReport,
  type ChartsStreamDeltaRow,
  type ChartsStreamInsightSummary,
  type ChartsTaskTypeRow,
} from '../../services/charts';
import {
  loadAvailableChartsReleaseSnapshotsFromSupabase,
  loadChartsReleaseSnapshotsFromSupabase,
  loadLatestChartsReportFromSupabase,
  saveChartsMlDatasetToSupabase,
  saveChartsReportToSupabase,
} from '../../services/chartsSupabase';

Chart.register(LineController, BarController, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

type ChartMode = 'line' | 'bar';
type CompareMode = 'mean' | 'prev';
type LogLevel = 'info' | 'ok' | 'warn' | 'error';
type ChartsDesignMockVariant = 'business' | 'compact' | 'legacy';
type ChartsDesignValueMode = 'absolute' | 'prevDelta' | 'meanDelta';

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

function isExternalMockStreamLabel(label: string) {
  const normalized = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return ['финтех', 'банк', 'payments', 'платежи', 'travel', 'тревел', 'wb club', 'вб клуб']
    .some(value => normalized === value || normalized.includes(value));
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

function compareReleaseLabels(left: string, right: string) {
  const leftParts = String(left || '').split('.').map(part => Number(part));
  const rightParts = String(right || '').split('.').map(part => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a - b;
  }
  return String(left || '').localeCompare(String(right || ''));
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
  const topQuarter = stats?.quarters.slice().sort((left, right) => right.total - left.total)[0] || null;
  const topStream = stats?.quarters
    .flatMap(quarter => quarter.streams.map(stream => ({ ...stream, quarter: quarter.quarter })))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))[0] || null;
  return (
    <Card className="charts-quarter-card-shell">
      <CardHeader>
        <div>
          <CardTitle>ЧП по диапазону и кварталам</CardTitle>
          <CardHint>Среднее по релизам, квартальный максимум и основные стримы после cutoff.</CardHint>
        </div>
        <Badge color="red">{stats?.releases || 0} релизов</Badge>
      </CardHeader>
      <CardBody>
        {!stats || (!stats.releases && !stats.quarters.length) ? (
          <EmptyState text="Недостаточно данных по кварталам ЧП." />
        ) : (
          <div className="charts-quarter-summary">
            <div className="charts-quarter-summary__stats">
              <div className="charts-quarter-summary__stat">
                <span>Среднее</span>
                <strong>{stats.average.toFixed(1)}</strong>
                <small>ЧП на релиз</small>
              </div>
              <div className="charts-quarter-summary__stat">
                <span>Всего</span>
                <strong>{stats.issues.length}</strong>
                <small>задач после cutoff</small>
              </div>
              <div className="charts-quarter-summary__stat">
                <span>Пик квартала</span>
                <strong>{topQuarter ? topQuarter.quarter : '—'}</strong>
                <small>{topQuarter ? `${topQuarter.total} ЧП` : 'нет данных'}</small>
              </div>
              <div className="charts-quarter-summary__stat charts-quarter-summary__stat--wide">
                <span>Топ стрим</span>
                <strong>{topStream?.name || '—'}</strong>
                <small>{topStream ? `${topStream.count} ЧП · ${topStream.quarter}` : 'нет данных'}</small>
              </div>
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
                          <div className="charts-quarter-stream__name">{stream.name}</div>
                          <div className="charts-quarter-stream__meta">
                            <Badge color={stream.external ? 'yellow' : 'gray'}>{stream.external ? 'Внешний' : 'Внутренний'}</Badge>
                            <span>
                              {stream.topSubstream
                                ? `${stream.topSubstream.name} (${stream.topSubstream.count})`
                                : 'Сабстрим не найден'}
                            </span>
                          </div>
                          <strong>{stream.count}</strong>
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

function ChpTypesInlineTable({ rows }: { rows: ChartsReport['chpTypes']['rows'] }) {
  return (
    <div className="charts-data-table-wrap">
      <table className="charts-data-table">
        <thead>
          <tr>
            <th>Релиз</th>
            <th>Аналитика</th>
            <th>Влет</th>
            <th>Баг</th>
            <th>Краш</th>
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const total = Number(row.product || 0) + Number(row.vlet || 0) + Number(row.bug || 0) + Number(row.crash || 0);
            return (
              <tr key={`chp-types-inline-${row.release}`}>
                <td>{formatReleaseShort(row.release)}</td>
                <td>{row.product}</td>
                <td>{row.vlet}</td>
                <td>{row.bug}</td>
                <td>{row.crash}</td>
                <td>{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskTypesInlineTable({ rows, typeNames }: { rows: ChartsTaskTypeRow[]; typeNames: string[] }) {
  const visibleTypes = typeNames.slice(0, 10);
  const countTypeByScope = (row: ChartsTaskTypeRow, type: string, external: boolean) => {
    const details = row.details?.[type] || [];
    if (!details.length) return external ? 0 : Number(row.counts[type] || 0);
    return details.filter(item => isExternalMockStreamLabel(item.stream) === external).length;
  };
  return (
    <div className="charts-data-table-wrap">
      <table className="charts-data-table">
        <thead>
          <tr>
            <th>Релиз</th>
            {visibleTypes.map(type => <th key={`task-type-head-${type}`}>{type}</th>)}
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const total = visibleTypes.reduce((sum, type) => sum + Number(row.counts[type] || 0), 0);
            return (
              <tr key={`task-types-inline-${row.release}`}>
                <td>{formatReleaseShort(row.release)}</td>
                {visibleTypes.map(type => {
                  const internal = countTypeByScope(row, type, false);
                  const external = countTypeByScope(row, type, true);
                  return (
                    <td key={`task-type-${row.release}-${type}`}>
                      <div className="charts-task-type-scope">
                        <span>Внутр.: <strong>{internal}</strong></span>
                        <span>Внешние: <strong>{external}</strong></span>
                      </div>
                    </td>
                  );
                })}
                <td>{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DowntimeByReleaseInlineTable({ rows }: { rows: ChartsReport['devDowntime']['iosByRelease'] }) {
  return (
    <div className="charts-data-table-wrap">
      <table className="charts-data-table">
        <thead>
          <tr>
            <th>Релиз</th>
            <th>Минут</th>
            <th>Дней</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`downtime-inline-${row.release}`}>
              <td>{formatReleaseShort(row.release)}</td>
              <td>{formatMinutesPretty(row.totalMinutes, 1)}</td>
              <td>{row.days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MockChartSpec {
  key: string;
  title: string;
  hint: string;
  section: 'regress' | 'quality' | 'timing' | 'incidents' | 'downtime' | 'types';
  badge: string;
  badgeColor: React.ComponentProps<typeof Badge>['color'];
  chartType?: 'line' | 'bar';
  stacked?: boolean;
  datasets: Array<LineDataset & BarDataset>;
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}

const MOCK_RELEASE_LABELS = ['7.5.100', '7.5.200', '7.5.300', '7.5.400', '7.5.500', '7.5.600'];

function mockTaskScopeCell(internal: number, external: number) {
  return (
    <div className="charts-task-type-scope">
      <span>Внутр.: <strong>{internal}</strong></span>
      <span>Внешние: <strong>{external}</strong></span>
    </div>
  );
}

const MOCK_CHARTS: MockChartSpec[] = [
  {
    key: 'tc',
    title: 'Объём регресса',
    hint: 'Manual и Auto в динамике по релизам.',
    section: 'regress',
    badge: '+6% к базе',
    badgeColor: 'yellow',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Manual', data: [1280, 1325, 1410, 1375, 1488, 1512], color: '#8B5CF6' },
      { label: 'Auto', data: [8420, 8560, 8740, 8815, 9020, 9180], color: '#06B6D4' },
    ],
    columns: ['Релиз', 'Manual', 'Auto', 'Всего'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => {
      const manual = [1280, 1325, 1410, 1375, 1488, 1512][index];
      const auto = [8420, 8560, 8740, 8815, 9020, 9180][index];
      return [release, manual.toLocaleString('ru-RU'), auto.toLocaleString('ru-RU'), (manual + auto).toLocaleString('ru-RU')];
    }),
  },
  {
    key: 'hb',
    title: 'High / Blocker: SWAT vs Stream',
    hint: 'Критичные проверки между SWAT и stream-командами.',
    section: 'quality',
    badge: 'SWAT 41%',
    badgeColor: 'blue',
    datasets: [
      { label: 'HB SWAT', data: [184, 196, 203, 214, 222, 236], color: '#8B5CF6' },
      { label: 'HB Stream', data: [246, 260, 268, 276, 292, 301], color: '#14B8A6' },
    ],
    columns: ['Релиз', 'SWAT', 'Stream', 'Покрытие'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [184, 196, 203, 214, 222, 236][index], [246, 260, 268, 276, 292, 301][index], `${[42, 43, 43, 44, 43, 44][index]}% / ${[58, 57, 57, 56, 57, 56][index]}%`]),
  },
  {
    key: 'selective',
    title: 'Selective: SWAT vs Stream',
    hint: 'Объём selective-проверок и баланс ответственности.',
    section: 'quality',
    badge: 'норма',
    badgeColor: 'green',
    datasets: [
      { label: 'Selective SWAT', data: [92, 88, 96, 104, 101, 109], color: '#EC4899' },
      { label: 'Selective Stream', data: [178, 184, 181, 190, 198, 203], color: '#22C55E' },
    ],
    columns: ['Релиз', 'SWAT', 'Stream', 'Всего'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [92, 88, 96, 104, 101, 109][index], [178, 184, 181, 190, 198, 203][index], [270, 272, 277, 294, 299, 312][index]]),
  },
  {
    key: 'avg',
    title: 'Среднее время прохождения',
    hint: 'Средняя длительность одного кейса.',
    section: 'quality',
    badge: '+0.4 мин',
    badgeColor: 'yellow',
    datasets: [
      { label: 'Среднее', data: [6.8, 6.6, 7.1, 7.4, 7.2, 7.6], color: '#F97316' },
      { label: 'Взвешенное', data: [6.1, 6.0, 6.3, 6.7, 6.5, 6.9], color: '#3B82F6' },
    ],
    columns: ['Релиз', 'SWAT', 'Stream', 'Общее'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, `${[5.8, 5.6, 6.0, 6.4, 6.2, 6.5][index]} мин`, `${[7.2, 7.0, 7.6, 7.9, 7.8, 8.1][index]} мин`, `${[6.8, 6.6, 7.1, 7.4, 7.2, 7.6][index]} мин`]),
  },
  {
    key: 'chp',
    title: 'ЧП по релизам',
    hint: 'Количество задач после cutoff по платформам.',
    section: 'incidents',
    badge: '3 риска',
    badgeColor: 'red',
    chartType: 'bar',
    datasets: [
      { label: 'iOS', data: [4, 5, 3, 6, 7, 5], color: '#8B5CF6' },
      { label: 'Android', data: [3, 4, 5, 4, 6, 7], color: '#22C55E' },
    ],
    columns: ['Релиз', 'iOS', 'Android', 'Всего'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [4, 5, 3, 6, 7, 5][index], [3, 4, 5, 4, 6, 7][index], [7, 9, 8, 10, 13, 12][index]]),
  },
  {
    key: 'chp-all',
    title: 'ЧП типы · всё',
    hint: 'Структура причин ЧП по релизам.',
    section: 'incidents',
    badge: 'краши +2',
    badgeColor: 'red',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Аналитика', data: [2, 3, 2, 4, 3, 4], color: '#3B82F6' },
      { label: 'Влет', data: [1, 2, 1, 2, 3, 2], color: '#F59E0B' },
      { label: 'Баг', data: [3, 2, 4, 3, 5, 4], color: '#EF4444' },
      { label: 'Краш', data: [1, 2, 1, 1, 2, 2], color: '#A855F7' },
    ],
    columns: ['Релиз', 'Аналитика', 'Влет', 'Баг', 'Краш'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [2, 3, 2, 4, 3, 4][index], [1, 2, 1, 2, 3, 2][index], [3, 2, 4, 3, 5, 4][index], [1, 2, 1, 1, 2, 2][index]]),
  },
  {
    key: 'chp-ios',
    title: 'ЧП типы · iOS',
    hint: 'Причины ЧП только по iOS.',
    section: 'incidents',
    badge: 'стабильно',
    badgeColor: 'green',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Аналитика', data: [1, 2, 1, 2, 1, 2], color: '#3B82F6' },
      { label: 'Влет', data: [1, 1, 0, 1, 2, 1], color: '#F59E0B' },
      { label: 'Баг', data: [2, 1, 2, 2, 3, 2], color: '#EF4444' },
      { label: 'Краш', data: [0, 1, 0, 1, 1, 0], color: '#A855F7' },
    ],
    columns: ['Релиз', 'Аналитика', 'Влет', 'Баг', 'Краш'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [1, 2, 1, 2, 1, 2][index], [1, 1, 0, 1, 2, 1][index], [2, 1, 2, 2, 3, 2][index], [0, 1, 0, 1, 1, 0][index]]),
  },
  {
    key: 'chp-android',
    title: 'ЧП типы · Android',
    hint: 'Причины ЧП только по Android.',
    section: 'incidents',
    badge: 'баги +1',
    badgeColor: 'yellow',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Аналитика', data: [1, 1, 1, 2, 2, 2], color: '#3B82F6' },
      { label: 'Влет', data: [0, 1, 1, 1, 1, 1], color: '#F59E0B' },
      { label: 'Баг', data: [1, 1, 2, 1, 2, 2], color: '#EF4444' },
      { label: 'Краш', data: [1, 1, 1, 0, 1, 2], color: '#A855F7' },
    ],
    columns: ['Релиз', 'Аналитика', 'Влет', 'Баг', 'Краш'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [1, 1, 1, 2, 2, 2][index], [0, 1, 1, 1, 1, 1][index], [1, 1, 2, 1, 2, 2][index], [1, 1, 1, 0, 1, 2][index]]),
  },
  {
    key: 'cut-store',
    title: 'Cutoff и Store',
    hint: 'Факт cutoff и store относительно целевого окна.',
    section: 'timing',
    badge: '1 late',
    badgeColor: 'red',
    datasets: [
      { label: 'iOS Cutoff', data: [835, 842, 838, 855, 846, 852], color: '#8B5CF6' },
      { label: 'iOS Store', data: [1040, 1055, 1036, 1088, 1064, 1072], color: '#06B6D4' },
      { label: 'Android Cutoff', data: [828, 836, 840, 848, 850, 858], color: '#22C55E' },
      { label: 'Android Store', data: [1028, 1042, 1045, 1060, 1085, 1078], color: '#F97316' },
    ],
    columns: ['Релиз', 'iOS Cutoff', 'iOS Store', 'Android Cutoff', 'Android Store'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, ['13:55', '14:02', '13:58', '14:15', '14:06', '14:12'][index], ['17:20', '17:35', '17:16', '18:08', '17:44', '17:52'][index], ['13:48', '13:56', '14:00', '14:08', '14:10', '14:18'][index], ['17:08', '17:22', '17:25', '17:40', '18:05', '17:58'][index]]),
  },
  {
    key: 'downtime-ios',
    title: 'DEV downtime · iOS',
    hint: 'Минуты простоя DEV окружения iOS.',
    section: 'downtime',
    badge: '104 мин',
    badgeColor: 'purple',
    datasets: [
      { label: 'iOS DEV downtime', data: [42, 66, 38, 91, 104, 58], color: '#8B5CF6' },
    ],
    columns: ['Релиз', 'Минут', 'Дней'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [42, 66, 38, 91, 104, 58][index], [1, 2, 1, 2, 3, 1][index]]),
  },
  {
    key: 'downtime-android',
    title: 'DEV downtime · Android',
    hint: 'Минуты простоя DEV окружения Android.',
    section: 'downtime',
    badge: 'ниже базы',
    badgeColor: 'green',
    datasets: [
      { label: 'Android DEV downtime', data: [58, 72, 64, 80, 74, 61], color: '#22C55E' },
    ],
    columns: ['Релиз', 'Минут', 'Дней'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, [58, 72, 64, 80, 74, 61][index], [2, 2, 2, 2, 2, 1][index]]),
  },
  {
    key: 'regression-start',
    title: 'Старт регресса и Lag',
    hint: 'Сдвиг старта регресса по платформам.',
    section: 'timing',
    badge: 'lag 22 мин',
    badgeColor: 'yellow',
    datasets: [
      { label: 'iOS старт', data: [1110, 1125, 1130, 1148, 1138, 1152], color: '#8B5CF6' },
      { label: 'Android старт', data: [1098, 1110, 1118, 1126, 1131, 1140], color: '#22C55E' },
    ],
    columns: ['Релиз', 'iOS старт', 'Android старт', 'Lag'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [release, ['18:30', '18:45', '18:50', '19:08', '18:58', '19:12'][index], ['18:18', '18:30', '18:38', '18:46', '18:51', '19:00'][index], `${[12, 15, 12, 22, 7, 12][index]} мин`]),
  },
  {
    key: 'types-ios',
    title: 'Типы задач iOS',
    hint: 'Распределение типов задач в iOS релизах.',
    section: 'types',
    badge: 'топ: Bug',
    badgeColor: 'purple',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Bug', data: [18, 22, 20, 25, 24, 27], color: '#EF4444' },
      { label: 'Task', data: [30, 28, 32, 31, 34, 33], color: '#3B82F6' },
      { label: 'Improvement', data: [12, 14, 13, 15, 16, 18], color: '#22C55E' },
    ],
    columns: ['Релиз', 'Bug', 'Task', 'Improvement'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [
      release,
      mockTaskScopeCell([10, 12, 11, 15, 14, 16][index], [8, 10, 9, 10, 10, 11][index]),
      mockTaskScopeCell([18, 17, 20, 19, 21, 22][index], [12, 11, 12, 12, 13, 11][index]),
      mockTaskScopeCell([7, 8, 8, 9, 10, 11][index], [5, 6, 5, 6, 6, 7][index]),
    ]),
  },
  {
    key: 'types-android',
    title: 'Типы задач Android',
    hint: 'Распределение типов задач в Android релизах.',
    section: 'types',
    badge: 'топ: Task',
    badgeColor: 'green',
    chartType: 'bar',
    stacked: true,
    datasets: [
      { label: 'Bug', data: [21, 19, 23, 22, 25, 26], color: '#EF4444' },
      { label: 'Task', data: [34, 36, 35, 38, 37, 39], color: '#3B82F6' },
      { label: 'Improvement', data: [10, 12, 11, 14, 13, 15], color: '#22C55E' },
    ],
    columns: ['Релиз', 'Bug', 'Task', 'Improvement'],
    rows: MOCK_RELEASE_LABELS.map((release, index) => [
      release,
      mockTaskScopeCell([11, 10, 12, 12, 13, 14][index], [10, 9, 11, 10, 12, 12][index]),
      mockTaskScopeCell([20, 21, 22, 23, 22, 24][index], [14, 15, 13, 15, 15, 15][index]),
      mockTaskScopeCell([6, 7, 7, 8, 8, 9][index], [4, 5, 4, 6, 5, 6][index]),
    ]),
  },
];

const MOCK_SECTION_META = {
  regress: { title: '1. Объём регресса', hint: 'Сколько работы вошло в релиз и как меняется автоматизация.' },
  quality: { title: '2. Покрытие качества', hint: 'Критичные проверки, selective и скорость прохождения.' },
  timing: { title: '3. Релизные тайминги', hint: 'Cutoff, store и старт регресса относительно целевых окон.' },
  incidents: { title: '4. Инциденты и ЧП', hint: 'Количество ЧП и структура причин по платформам.' },
  downtime: { title: '5. DEV downtime', hint: 'Простои окружений, влияющие на готовность релиза.' },
  types: { title: '6. Типы задач', hint: 'Состав задач по платформам и изменение структуры.' },
} satisfies Record<MockChartSpec['section'], { title: string; hint: string }>;

function transformMockSeries(data: Array<number | null>, mode: ChartsDesignValueMode) {
  if (mode === 'absolute') return data;
  const numeric = data.map(value => Number(value));
  const finiteValues = numeric.filter(Number.isFinite);
  const mean = finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : 0;
  return numeric.map((value, index) => {
    if (!Number.isFinite(value)) return null;
    if (mode === 'prevDelta') {
      if (index === 0) return 0;
      const prev = numeric[index - 1];
      return Number.isFinite(prev) ? value - prev : null;
    }
    return value - mean;
  });
}

function formatMockChartValue(value: number | null | undefined, mode: ChartsDesignValueMode) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const formatted = formatCountLabelCompact(Math.abs(num));
  if (mode === 'absolute') return formatted;
  if (num === 0) return '0';
  return `${num > 0 ? '+' : '-'}${formatted}`;
}

function getMockValueModeHint(mode: ChartsDesignValueMode) {
  if (mode === 'prevDelta') return 'Показана дельта к предыдущему релизу.';
  if (mode === 'meanDelta') return 'Показано отклонение от среднего по диапазону.';
  return 'Показаны абсолютные значения.';
}

function buildMockLlmInsight(spec: MockChartSpec, mode: ChartsDesignValueMode) {
  const modeText = getMockValueModeHint(mode);
  if (spec.key === 'tc') return `${modeText} LLM видит управляемый рост объёма: Auto растёт быстрее Manual, поэтому риск не в размере регресса, а в нагрузке на отдельные стримы.`;
  if (spec.key.includes('downtime')) return `${modeText} LLM рекомендует смотреть не только минуты, но и повторяемость простоев: единичный пик менее критичен, чем серия коротких сбоев перед cutoff.`;
  if (spec.key.includes('chp')) return `${modeText} LLM отмечает рост поздних задач после cutoff; нужна ручная проверка причин Bug и Crash по владельцам.`;
  if (spec.key === 'cut-store' || spec.key === 'regression-start') return `${modeText} LLM считает тайминги главным операционным риском: store и старт регресса должны иметь владельца и SLA-подтверждение.`;
  return `${modeText} LLM выделяет изменение тренда и предлагает сверить последний релиз с базой перед релизным решением.`;
}

function MockDataTable({ columns, rows, compact = false }: { columns: string[]; rows: Array<Array<React.ReactNode>>; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shouldLimit = compact && rows.length > 5 && !expanded;
  const visibleRows = shouldLimit ? rows.slice(0, 5) : rows;
  return (
    <>
      <div className="charts-data-table-wrap" style={{ maxHeight: compact && !expanded ? 174 : 250 }}>
        <table className="charts-data-table">
          <thead>
            <tr>{columns.map(column => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={`mock-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => <td key={`mock-cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compact && rows.length > 5 && (
        <div className="charts-design-table-more">
          <button type="button" onClick={() => setExpanded(value => !value)}>
            {expanded ? 'Скрыть строки' : `Показать все ${rows.length}`}
          </button>
        </div>
      )}
    </>
  );
}

function MockChartCard({ spec, palette, compact = false, forceLine = false, valueMode = 'absolute', showLlmInsight = false, sideMetrics }: { spec: MockChartSpec; palette: ChartPalette; compact?: boolean; forceLine?: boolean; valueMode?: ChartsDesignValueMode; showLlmInsight?: boolean; sideMetrics?: React.ReactNode }) {
  const [insightOpen, setInsightOpen] = useState(false);
  const height = compact ? 150 : 210;
  const useBarChart = spec.chartType === 'bar' && !forceLine;
  const displayDatasets = spec.datasets.map(dataset => ({
    ...dataset,
    data: transformMockSeries(dataset.data, valueMode),
  }));
  return (
    <Card className="charts-design-card">
      <CardHeader>
        <div>
          <CardTitle>{spec.title}</CardTitle>
          <CardHint>{spec.hint}</CardHint>
        </div>
        <Badge color={spec.badgeColor}>{spec.badge}</Badge>
      </CardHeader>
      <CardBody style={{ display: 'grid', gridTemplateColumns: sideMetrics ? 'minmax(0, 1fr) 150px' : 'minmax(0, 1fr)', gap: 12, alignItems: 'stretch' }}>
        {useBarChart ? (
          <BarChart
            labels={MOCK_RELEASE_LABELS}
            datasets={displayDatasets}
            palette={palette}
            stacked={spec.stacked}
            height={height}
            yTickFormatter={value => formatMockChartValue(value, valueMode)}
            valueLabelFormatter={value => formatMockChartValue(value, valueMode)}
          />
        ) : (
          <LineChart
            labels={MOCK_RELEASE_LABELS}
            datasets={displayDatasets}
            palette={palette}
            height={height}
            yTickFormatter={value => formatMockChartValue(value, valueMode)}
            tooltipFormatter={(value, label) => `${label}: ${formatMockChartValue(value, valueMode)}`}
            valueLabelFormatter={value => formatMockChartValue(value, valueMode)}
            valueLabelMode={compact ? 'last' : 'all'}
          />
        )}
        {sideMetrics}
      </CardBody>
      {showLlmInsight && (
        <div className="charts-design-llm-insight">
          <button type="button" onClick={() => setInsightOpen(value => !value)}>
            <span>LLM-инсайт по графику</span>
            <strong>{insightOpen ? 'Скрыть' : 'Показать'}</strong>
          </button>
          {insightOpen && <div>{buildMockLlmInsight(spec, valueMode)}</div>}
        </div>
      )}
      <MockDataTable columns={spec.columns} rows={spec.rows} compact={compact || showLlmInsight} />
    </Card>
  );
}

function MockStreamDeltaCard() {
  const rows = [
    ['7.5.200', 'Payments', '+18', '+96', '+114', 'рост автотестов после расширения smoke'],
    ['7.5.200', 'Catalog', '-12', '+42', '+30', 'ручные кейсы перенесены в automation backlog'],
    ['7.5.300', 'Checkout', '+34', '+118', '+152', 'новые проверки корзины и оплаты'],
    ['7.5.400', 'Search', '-8', '+73', '+65', 'стабильный рост AT без расширения manual'],
    ['7.5.500', 'Profile', '+41', '+86', '+127', 'добавлены проверки авторизации'],
    ['7.5.600', 'Delivery', '+24', '+112', '+136', 'рост из-за новых сценариев слотов'],
  ];
  return (
    <Card className="charts-design-card">
      <CardHeader>
        <div>
          <CardTitle>Дельта тест-кейсов по стримам</CardTitle>
          <CardHint>Статистика изменения manual и auto от релиза к релизу. Блок должен стоять под объёмом регресса.</CardHint>
        </div>
        <Badge color="cyan">release-to-release</Badge>
      </CardHeader>
      <CardBody>
        <div className="charts-design-stream-delta-summary">
          <div>
            <span>Топ рост Manual</span>
            <strong>Profile +41</strong>
            <small>ручные проверки авторизации</small>
          </div>
          <div>
            <span>Топ рост AT</span>
            <strong>Checkout +118</strong>
            <small>корзина и оплата</small>
          </div>
          <div>
            <span>Подозрительное изменение</span>
            <strong>Catalog -12 / +42</strong>
            <small>часть manual ушла в automation</small>
          </div>
        </div>
      </CardBody>
      <MockDataTable
        columns={['Релиз', 'Stream', 'Manual Δ', 'AT Δ', 'Всего Δ', 'Комментарий']}
        rows={rows.map(row => [
          row[0],
          row[1],
          <span className={String(row[2]).startsWith('+') ? 'delta-pos' : 'delta-neg'}>{row[2]}</span>,
          <span className={String(row[3]).startsWith('+') ? 'delta-pos' : 'delta-neg'}>{row[3]}</span>,
          <span className={String(row[4]).startsWith('+') ? 'delta-pos' : 'delta-neg'}>{row[4]}</span>,
          row[5],
        ])}
      />
    </Card>
  );
}

function MockKpiCard({ label, value, hint, color }: { label: string; value: string; hint: string; color?: string }) {
  return (
    <Card className="charts-design-kpi">
      <CardBody>
        <div className="charts-design-kpi__label">{label}</div>
        <div className="charts-design-kpi__value" style={{ color }}>{value}</div>
        <div className="charts-design-kpi__hint">{hint}</div>
      </CardBody>
    </Card>
  );
}

function MockSignalKpiCard({ label, value, status, tone, hint }: { label: string; value: string; status: string; tone: 'ok' | 'warn' | 'bad' | 'neutral'; hint: string }) {
  return (
    <Card className={`charts-design-signal charts-design-signal--${tone}`}>
      <CardBody>
        <div className="charts-design-signal__top">
          <span>{label}</span>
          <strong>{status}</strong>
        </div>
        <div className="charts-design-signal__value">{value}</div>
        <div className="charts-design-signal__hint">{hint}</div>
      </CardBody>
    </Card>
  );
}

function extractLlmInsightText(aiText: string, fallback: string, keywords: string[]) {
  const text = String(aiText || '').trim();
  if (!text) return fallback;
  const lines = text
    .split('\n')
    .map(line => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean);
  const matched = lines.filter(line => keywords.some(keyword => line.toLowerCase().includes(keyword.toLowerCase())));
  const source = matched.length ? matched : lines;
  return source.slice(0, 3).join(' ');
}

function RealLlmInsight({ aiText, fallback, keywords }: { aiText: string; fallback: string; keywords: string[] }) {
  const [open, setOpen] = useState(false);
  const text = extractLlmInsightText(aiText, fallback, keywords);
  return (
    <div className="charts-design-llm-insight">
      <button type="button" onClick={() => setOpen(value => !value)}>
        <span>LLM-инсайт по графику</span>
        <strong>{open ? 'Скрыть' : 'Показать'}</strong>
      </button>
      {open && <div>{text}</div>}
    </div>
  );
}

function buildLocalChartsUiSummaryText(report: ChartsReport | null | undefined, decisionText: string, decisionReason: string) {
  const mlSummary = report?.ml.summary;
  if (!mlSummary) {
    return [
      'Короткий вывод',
      `- ${decisionText}`,
      `- ${decisionReason}`,
      '',
      'Главные риски',
      '- Данные ещё не собраны или локальная ML-сводка недоступна.',
      '',
      'Рекомендации на следующий релиз',
      '- Сначала собери отчёт по релизам, затем сформируй LLM-сводку на полном контексте.',
      '',
      'Что проверить вручную',
      '- Собери отчёт по релизам и проверь графики регресса, ЧП, таймингов, типов задач и downtime.',
    ].join('\n');
  }
  return [
    'Короткий вывод',
    `- ${mlSummary.statusText || decisionText}`,
    `- ${mlSummary.compareText || decisionReason}`,
    '- Совместная оценка ролей: Lead Manager оценивает бизнес-решение и коммуникацию риска; Lead QA подтверждает качество по регрессу, ЧП и ручным проверкам; Release Manager отвечает за cutoff/store/SLA и порядок выкладки; Staff/Lead Developer подтверждает технические причины downtime/anomalies и owners.',
    ...mlSummary.overview.map(item => `- ${item}`),
    '',
    'Главные риски',
    ...mlSummary.risks.map(item => `- ${item}`),
    '- Ролевой риск: если хотя бы одна зона Lead QA / Release Manager / Staff Developer не подтверждена фактами из таблиц под графиками, релиз должен оставаться в статусе "выпуск с проверками".',
    '',
    'Рекомендации на следующий релиз',
    '- Manager/Release lead: зафиксировать decision state до выкладки и закрыть owners по главным драйверам риска.',
    '- Lead QA: подтвердить регресс, ЧП, типы задач и stream delta по таблицам под графиками, а не только по общей динамике.',
    '- Release Manager: отдельно сверить cutoff, store, start regression, lag и downtime с SLA и ожиданиями команды.',
    '- Staff/Lead Developer: разобрать технические причины downtime/anomalies и назначить владельцев на повторяемые сигналы.',
    ...mlSummary.changes.map(item => `- ${item}`),
    ...mlSummary.recommendations.map(item => `- ${item}`),
    '',
    'Что проверить вручную',
    '- Manager: KPI и AI/ML summary — подтвердить, что решение по выпуску соответствует фактическому ML-риску и аномалиям.',
    '- Lead QA: графики и таблицы регресса/ЧП/типов задач — проверить последние релизы против предыдущего и среднего уровня.',
    '- Release Manager: cutoff/store/start regression/downtime — подтвердить SLA, лаги и отсутствие поздних блокеров.',
    '- Staff/Lead Developer: DEV downtime, top stream deltas и аномальные task types — подтвердить технический owner и план исправления.',
    ...mlSummary.manualChecks.map(item => `- ${item}`),
  ].join('\n');
}

const LLM_LEGACY_SECTION_TITLES = [
  'Короткий вывод',
  'Главные риски',
  'Рекомендации на следующий релиз',
  'Что проверить вручную',
];

function parseLegacyLlmSections(text: string) {
  const sections = new Map<string, string[]>();
  LLM_LEGACY_SECTION_TITLES.forEach(title => sections.set(title, []));
  let current = LLM_LEGACY_SECTION_TITLES[0];
  String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const normalized = line.replace(/:$/, '').trim().toLowerCase();
      const sectionTitle = LLM_LEGACY_SECTION_TITLES.find(title => title.toLowerCase() === normalized);
      if (sectionTitle) {
        current = sectionTitle;
        if (!sections.has(current)) sections.set(current, []);
        return;
      }
      sections.set(current, [...(sections.get(current) || []), line.replace(/^[-•]\s*/, '').trim()]);
    });
  return LLM_LEGACY_SECTION_TITLES.map(title => ({
    title,
    items: (sections.get(title) || []).filter(Boolean),
  }));
}

function MockAiMlSummary({ compact = false }: { compact?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Card className="charts-design-ai-summary">
      <CardHeader>
        <div>
          <CardTitle>AI и ML сводка</CardTitle>
          <CardHint>Первый блок экрана: прогноз, LLM-вывод, аномалии и основные драйверы риска.</CardHint>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(value => !value)}>
          {collapsed ? 'Развернуть' : 'Свернуть'}
        </Button>
      </CardHeader>
      {!collapsed && (
        <CardBody>
          <div className="charts-design-decision-state">
            <div>
              <span>Решение</span>
              <strong>Выпуск с проверками</strong>
            </div>
            <div>
              <span>Причина</span>
              <strong>Android ЧП + поздний Store</strong>
            </div>
            <div>
              <span>Кто владелец</span>
              <strong>Release lead + Android owners</strong>
            </div>
            <div>
              <span>SLA</span>
              <strong>подтвердить до 18:00</strong>
            </div>
          </div>
          <div className={compact ? 'charts-design-ai-summary__grid charts-design-ai-summary__grid--compact' : 'charts-design-ai-summary__grid'}>
            <div className="charts-design-ai-summary__main">
              <div className="charts-design-llm__label">Главный AI-вывод</div>
              <div className="charts-design-llm__text">Релиз 7.5.600 можно выпускать после проверки Android ЧП и store SLA. ML-риск средний: модель видит рост поздних задач и downtime, но объём регресса остаётся контролируемым.</div>
            </div>
            <div className="charts-design-ai-tile">
              <span>ML риск</span>
              <strong>62%</strong>
              <small>средний, растёт 2 релиза</small>
            </div>
            <div className="charts-design-ai-tile">
              <span>Драйвер #1</span>
              <strong>Store late</strong>
              <small>самый сильный вклад в риск</small>
            </div>
            <div className="charts-design-ai-tile">
              <span>Аномалии</span>
              <strong>3</strong>
              <small>release · timing · downtime</small>
            </div>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

function MockLlmSummary({ compact = false }: { compact?: boolean }) {
  return (
    <Card className="charts-design-llm">
      <CardHeader>
        <div>
          <CardTitle>LLM-сводка</CardTitle>
          <CardHint>Сначала бизнес-вывод, затем причины и действия.</CardHint>
        </div>
        <Button variant="ghost" size="sm">Свернуть</Button>
      </CardHeader>
      <CardBody>
        <div className={compact ? 'charts-design-llm__grid charts-design-llm__grid--compact' : 'charts-design-llm__grid'}>
          <div>
            <div className="charts-design-llm__label">Главный вывод</div>
            <div className="charts-design-llm__text">Релиз 7.5.600 вырос по объёму регресса на 6%, но основной риск сейчас не в размере, а в позднем store и росте ЧП по Android.</div>
          </div>
          <div>
            <div className="charts-design-llm__label">Что проверить</div>
            <div className="charts-design-llm__text">Сверить Android downtime, причины багов после cutoff и владельцев selective-проверок по потокам.</div>
          </div>
          <div>
            <div className="charts-design-llm__label">Решение</div>
            <div className="charts-design-llm__text">Проводить релиз можно после подтверждения store SLA и закрытия двух Android задач класса Bug.</div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function MockSection({ section, palette, columns = 2, forceLine = false, valueMode = 'absolute', showLlmInsight = false }: { section: MockChartSpec['section']; palette: ChartPalette; columns?: 1 | 2; forceLine?: boolean; valueMode?: ChartsDesignValueMode; showLlmInsight?: boolean }) {
  const meta = MOCK_SECTION_META[section];
  const specs = MOCK_CHARTS.filter(item => item.section === section);
  return (
    <section className="charts-design-section">
      <div className="charts-design-section__head">
        <div>
          <div className="charts-design-section__title">{meta.title}</div>
          <div className="charts-design-section__hint">{meta.hint}</div>
        </div>
        <Badge color="gray">{specs.length} граф.</Badge>
      </div>
      <div className={columns === 1 || specs.length === 1 ? 'charts-design-grid charts-design-grid--one' : 'charts-design-grid'}>
        {specs.map(spec => <MockChartCard key={spec.key} spec={spec} palette={palette} forceLine={forceLine} valueMode={valueMode} showLlmInsight={showLlmInsight} />)}
      </div>
    </section>
  );
}

function BusinessReviewMock({ palette }: { palette: ChartPalette }) {
  const [valueMode, setValueMode] = useState<ChartsDesignValueMode>('absolute');
  return (
    <div className="charts-design-preview">
      <MockAiMlSummary />
      <MockLlmSummary />
      <div className="charts-design-sticky-summary">
        <span>7.5.600</span>
        <strong>Выпуск с проверками</strong>
        <span>ML риск 62%</span>
        <span>ЧП 12</span>
        <span>SLA 83%</span>
        <span>Downtime 119 мин</span>
      </div>
      <Card>
        <CardBody>
          <div className="charts-design-value-mode">
            <div>
              <div className="charts-design-value-mode__title">Режим значений</div>
              <div className="charts-design-value-mode__hint">{getMockValueModeHint(valueMode)}</div>
            </div>
            <SegmentControl
              items={[
                { label: 'Абсолютные', value: 'absolute' },
                { label: 'Δ к прошлому', value: 'prevDelta' },
                { label: 'Δ к среднему', value: 'meanDelta' },
              ]}
              value={valueMode}
              onChange={value => setValueMode(value as ChartsDesignValueMode)}
            />
          </div>
        </CardBody>
      </Card>
      <div className="charts-design-kpis">
        <MockSignalKpiCard label="Объём регресса" value="+6%" status="Внимание" tone="warn" hint="рост есть, но Auto растёт быстрее Manual" />
        <MockSignalKpiCard label="Покрытие качества" value="стабильно" status="OK" tone="ok" hint="баланс SWAT и Stream без резкого провала" />
        <MockSignalKpiCard label="Тайминги" value="83%" status="Внимание" tone="warn" hint="один релиз вне store SLA" />
        <MockSignalKpiCard label="Инциденты" value="12" status="Риск" tone="bad" hint="+4 к среднему по диапазону" />
        <MockSignalKpiCard label="DEV downtime" value="119 мин" status="Внимание" tone="warn" hint="требует подтверждения владельцами окружений" />
      </div>
      <MockSection section="regress" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
      <MockStreamDeltaCard />
      <MockSection section="quality" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
      <MockSection section="timing" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
      <MockSection section="incidents" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
      <MockSection section="downtime" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
      <MockSection section="types" palette={palette} forceLine valueMode={valueMode} showLlmInsight />
    </div>
  );
}

function CompactOpsMock({ palette }: { palette: ChartPalette }) {
  const primarySpecs = MOCK_CHARTS.filter(item => ['tc', 'hb', 'cut-store', 'chp', 'downtime-ios', 'types-android'].includes(item.key));
  return (
    <div className="charts-design-preview">
      <MockAiMlSummary compact />
      <MockLlmSummary compact />
      <div className="charts-design-ops-bar">
        {['Регресс', 'Качество', 'Тайминги', 'ЧП', 'Downtime', 'Типы', 'AI/ML'].map(item => (
          <button type="button" key={item}>{item}</button>
        ))}
      </div>
      <div className="charts-design-ops-grid">
        {primarySpecs.map(spec => (
          <MockChartCard
            key={`compact-${spec.key}`}
            spec={spec}
            palette={palette}
            compact
            sideMetrics={(
              <div className="charts-design-side-metrics">
                <div><span>Тренд</span><strong>{spec.badge}</strong></div>
                <div><span>Текущий</span><strong>{spec.rows[spec.rows.length - 1]?.[1]}</strong></div>
                <div><span>Риск</span><Badge color={spec.badgeColor}>{spec.badgeColor === 'green' ? 'низкий' : spec.badgeColor === 'red' ? 'высокий' : 'средний'}</Badge></div>
              </div>
            )}
          />
        ))}
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Остальные графики остаются в этом же паттерне</CardTitle>
            <CardHint>Каждый блок: короткий бизнес-статус, график, таблица, без переключения вкладок.</CardHint>
          </div>
          <Badge color="gray">{MOCK_CHARTS.length} всего</Badge>
        </CardHeader>
      </Card>
    </div>
  );
}

function LegacyPlusMock({ palette }: { palette: ChartPalette }) {
  return (
    <div className="charts-design-preview">
      <MockAiMlSummary />
      <MockLlmSummary />
      <div className="charts-design-legacy-list">
        {MOCK_CHARTS.map(spec => (
          <MockChartCard key={`legacy-${spec.key}`} spec={spec} palette={palette} />
        ))}
      </div>
    </div>
  );
}

function ChartsDesignMockups({ variant, onVariantChange, palette }: { variant: ChartsDesignMockVariant; onVariantChange: (value: ChartsDesignMockVariant) => void; palette: ChartPalette }) {
  return (
    <div className="charts-design-shell">
      <Card>
        <CardBody>
          <div className="charts-design-intro">
            <div>
              <div className="charts-design-intro__eyebrow">Макеты для согласования</div>
              <div className="charts-design-intro__title">Бизнес-дизайн графиков и таблиц на моковых данных</div>
              <div className="charts-design-intro__text">Логика данных не меняется: все legacy-графики остаются на одном экране, у каждого графика своя таблица, LLM сверху, AI/ML отдельно.</div>
            </div>
            <SegmentControl
              items={[
                { label: 'Business Review', value: 'business' },
                { label: 'Compact Ops', value: 'compact' },
                { label: 'Legacy+', value: 'legacy' },
              ]}
              value={variant}
              onChange={value => onVariantChange(value as ChartsDesignMockVariant)}
            />
          </div>
        </CardBody>
      </Card>
      {variant === 'business' && <BusinessReviewMock palette={palette} />}
      {variant === 'compact' && <CompactOpsMock palette={palette} />}
      {variant === 'legacy' && <LegacyPlusMock palette={palette} />}
    </div>
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
  const [chartMode] = useState<ChartMode>('line');
  const [compareMode, setCompareMode] = useState<CompareMode>('mean');
  const [valueMode, setValueMode] = useState<ChartsDesignValueMode>('absolute');
  const [selectedReleases, setSelectedReleases] = useState<string[]>([]);
  const [availableDbReleases, setAvailableDbReleases] = useState<string[]>([]);
  const [dbFilteredReport, setDbFilteredReport] = useState<ChartsReport | null>(null);
  const [releaseFilterBusy, setReleaseFilterBusy] = useState(false);
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
  const [aiMlSummaryCollapsed, setAiMlSummaryCollapsed] = useState(false);
  const [tcTableMode, setTcTableMode] = useState<'streams' | 'counts'>('streams');
  const [designPreviewOpen, setDesignPreviewOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('design');
  });
  const [designMockVariant, setDesignMockVariant] = useState<ChartsDesignMockVariant>(() => {
    if (typeof window === 'undefined') return 'business';
    const value = new URLSearchParams(window.location.search).get('design');
    return value === 'compact' || value === 'legacy' ? value : 'business';
  });
  const abortRef = useRef<AbortController | null>(null);

  const status = useStatusBools(settings, proxyOnline, helperOnline);
  const releaseRangePreview = useMemo(() => buildMajorReleaseRange(releaseFrom, releaseTo), [releaseFrom, releaseTo]);
  const availableReleaseOptions = useMemo(() => {
    const values = new Set<string>();
    (report?.releases || []).forEach(release => values.add(release));
    availableDbReleases.forEach(release => values.add(release));
    return Array.from(values).sort(compareReleaseLabels);
  }, [availableDbReleases, report]);
  const selectedReleaseKey = selectedReleases.join('|');
  const selectedNeedsDb = useMemo(() => (
    Boolean(selectedReleases.length)
    && selectedReleases.some(release => !report?.releases?.includes(release))
  ), [report, selectedReleases]);
  const filteredReport = useMemo(() => {
    if (selectedNeedsDb) return dbFilteredReport;
    return rebuildChartsReportForReleases(report, selectedReleases, compareMode);
  }, [compareMode, dbFilteredReport, report, selectedNeedsDb, selectedReleases]);
  const displayedReport = useMemo(() => {
    if (!filteredReport) return null;
    const summaryState = rebuildChartsSummaryState(filteredReport, compareMode);
    return {
      ...filteredReport,
      aiContext: summaryState.aiContext,
      ml: {
        ...filteredReport.ml,
        summary: summaryState.mlSummary,
      },
    } as ChartsReport;
  }, [compareMode, filteredReport]);
  const labels = useMemo(() => (displayedReport?.releases || []).map(formatReleaseShort), [displayedReport]);
  const currentMetric = displayedReport?.metrics[displayedReport.metrics.length - 1] || null;
  const displayedMlRiskPct = displayedReport?.ml.prediction.activeProbability == null
    ? null
    : Math.round(displayedReport.ml.prediction.activeProbability * 100);
  const visibleReleaseCount = displayedReport?.releases.length || 0;
  const currentChpTotal = displayedReport?.chpRows[displayedReport.chpRows.length - 1]?.total || 0;
  const currentTiming = displayedReport?.timings[displayedReport.timings.length - 1] || null;
  const currentDowntimeMinutes = (displayedReport?.devDowntime.iosByRelease[displayedReport.devDowntime.iosByRelease.length - 1]?.totalMinutes || 0)
    + (displayedReport?.devDowntime.androidByRelease[displayedReport.devDowntime.androidByRelease.length - 1]?.totalMinutes || 0);
  const decisionTone: 'ok' | 'warn' | 'bad' = displayedMlRiskPct == null
    ? 'warn'
    : displayedMlRiskPct >= 70 || (displayedReport?.anomalies.score || 0) >= 5
      ? 'bad'
      : displayedMlRiskPct >= 45 || (displayedReport?.anomalies.score || 0) >= 3 || currentChpTotal >= 10
        ? 'warn'
        : 'ok';
  const decisionText = decisionTone === 'bad' ? 'Стоп до проверки' : decisionTone === 'warn' ? 'Выпуск с проверками' : 'Можно выпускать';
  const decisionReason = decisionTone === 'bad'
    ? 'ML-риск или аномалии выше допустимого уровня'
    : decisionTone === 'warn'
      ? 'Есть сигналы по ML, ЧП, таймингам или downtime'
      : 'Критичных сигналов по текущему срезу нет';
  const storeLate = isStoreLate(currentTiming?.iosStoreMinutes) || isStoreLate(currentTiming?.androidStoreMinutes);
  const slaText = storeLate ? 'подтвердить Store SLA' : 'SLA без позднего Store';
  const previousMetric = displayedReport?.metrics.length ? displayedReport.metrics[displayedReport.metrics.length - 2] : null;
  const currentTcTotal = (currentMetric?.tc_manual || 0) + (currentMetric?.tc_auto || 0);
  const previousTcTotal = (previousMetric?.tc_manual || 0) + (previousMetric?.tc_auto || 0);
  const regressionDeltaPct = previousTcTotal ? ((currentTcTotal - previousTcTotal) / previousTcTotal) * 100 : null;
  const coverageCurrent = (currentMetric?.cov_swat || 0) + (currentMetric?.cov_stream || 0);
  const coveragePrevious = (previousMetric?.cov_swat || 0) + (previousMetric?.cov_stream || 0);
  const coverageDeltaPct = coveragePrevious ? ((coverageCurrent - coveragePrevious) / coveragePrevious) * 100 : null;
  const anomalyScore = displayedReport?.anomalies.score || 0;
  const regressionTone: 'ok' | 'warn' | 'bad' | 'neutral' = regressionDeltaPct == null
    ? 'neutral'
    : regressionDeltaPct > 20
      ? 'bad'
      : regressionDeltaPct > 8
        ? 'warn'
        : 'ok';
  const coverageTone: 'ok' | 'warn' | 'bad' | 'neutral' = coverageDeltaPct == null
    ? 'neutral'
    : coverageDeltaPct < -12
      ? 'bad'
      : coverageDeltaPct < -5
        ? 'warn'
        : 'ok';
  const incidentTone: 'ok' | 'warn' | 'bad' = currentChpTotal >= 10 || anomalyScore >= 5 ? 'bad' : currentChpTotal > 0 || anomalyScore >= 3 ? 'warn' : 'ok';
  const downtimeTone: 'ok' | 'warn' | 'bad' = currentDowntimeMinutes >= 120 ? 'bad' : currentDowntimeMinutes > 0 ? 'warn' : 'ok';
  const timingTone: 'ok' | 'warn' | 'bad' = storeLate ? 'warn' : 'ok';
  const formatSignedPct = (value: number | null) => {
    if (!Number.isFinite(Number(value))) return '—';
    const num = Number(value);
    if (num === 0) return '0%';
    return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
  };
  const applyValueModeToDatasets = useCallback(<T extends LineDataset | BarDataset>(datasets: T[]): T[] => (
    valueMode === 'absolute'
      ? datasets
      : datasets.map(item => ({ ...item, data: transformMockSeries(item.data, valueMode) }))
  ), [valueMode]);
  const formatCountValueForMode = useCallback((value: number | null | undefined, compact = true) => {
    if (valueMode === 'absolute') return compact ? formatCountLabelCompact(value) : formatCountLabel(value);
    return formatMockChartValue(value, valueMode);
  }, [valueMode]);
  const formatMinutesValueForMode = useCallback((value: number | null | undefined, digits = 1) => {
    if (valueMode === 'absolute') return formatMinutesPretty(value, digits);
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    if (num === 0) return '0 мин';
    return `${num > 0 ? '+' : '-'}${Math.abs(num).toFixed(digits)} мин`;
  }, [valueMode]);
  const formatClockValueForMode = useCallback((value: number | null | undefined) => (
    valueMode === 'absolute' ? formatMinutesToClock(value) : formatMinutesValueForMode(value, 0)
  ), [formatMinutesValueForMode, valueMode]);
  const localLlmText = useMemo(() => (
    buildLocalChartsUiSummaryText(displayedReport || report, decisionText, decisionReason)
  ), [decisionReason, decisionText, displayedReport, report]);
  const effectiveLlmText = aiText.trim() || localLlmText;
  const renderDesignSection = useCallback((
    section: keyof typeof MOCK_SECTION_META,
    chartCount: number,
    children: React.ReactNode,
    oneColumn = false
  ) => {
    const meta = MOCK_SECTION_META[section];
    return (
      <section className="charts-design-section">
        <div className="charts-design-section__head">
          <div>
            <div className="charts-design-section__title">{meta.title}</div>
            <div className="charts-design-section__hint">{meta.hint}</div>
          </div>
          <Badge color="gray">{chartCount} граф.</Badge>
        </div>
        <div className={oneColumn ? 'charts-design-grid charts-design-grid--one' : 'charts-design-grid'}>
          {children}
        </div>
      </section>
    );
  }, []);
  const renderAiMlBrief = useCallback(() => {
    const source = displayedReport || report;
    const mlSummary = source?.ml.summary;
    const driver = source?.ml.prediction.featureDrivers?.[0];
    const currentMlRisk = source?.ml.prediction.activeProbability == null ? null : Math.round(source.ml.prediction.activeProbability * 100);
    const overview = mlSummary?.overview?.[0] || decisionReason;
    return (
      <Card className="charts-design-ai-summary">
        <CardHeader>
          <div>
            <CardTitle>AI и ML сводка</CardTitle>
            <CardHint>Первый блок экрана: прогноз, LLM-вывод, аномалии и основные драйверы риска.</CardHint>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAiMlSummaryCollapsed(value => !value)}>
            {aiMlSummaryCollapsed ? 'Развернуть' : 'Свернуть'}
          </Button>
        </CardHeader>
        {!aiMlSummaryCollapsed && (
          <CardBody>
            <div className="charts-design-decision-state">
              <div>
                <span>Решение</span>
                <strong>{decisionText}</strong>
              </div>
              <div>
                <span>Причина</span>
                <strong>{decisionReason}</strong>
              </div>
              <div>
                <span>Кто владелец</span>
                <strong>Release lead + владельцы платформ</strong>
              </div>
              <div>
                <span>SLA</span>
                <strong>{slaText}</strong>
              </div>
            </div>
            <div className="charts-design-ai-summary__grid">
              <div className="charts-design-ai-summary__main">
                <div className="charts-design-llm__label">Главный AI-вывод</div>
                <div className="charts-design-llm__text">{overview}</div>
              </div>
              <div className="charts-design-ai-tile">
                <span>ML риск</span>
                <strong>{currentMlRisk == null ? '—' : `${currentMlRisk}%`}</strong>
                <small>{source?.ml.prediction.datasetQualityText || 'оценка по текущему срезу'}</small>
              </div>
              <div className="charts-design-ai-tile">
                <span>Драйвер #1</span>
                <strong>{driver?.label || '—'}</strong>
                <small>{driver ? `вклад ${driver.contribution >= 0 ? '+' : ''}${driver.contribution.toFixed(2)}` : 'модель не выделила фактор'}</small>
              </div>
              <div className="charts-design-ai-tile">
                <span>Аномалии</span>
                <strong>{source?.anomalies.score ?? '—'}</strong>
                <small>release · timing · downtime</small>
              </div>
            </div>
          </CardBody>
        )}
      </Card>
    );
  }, [aiMlSummaryCollapsed, decisionReason, decisionText, displayedReport, report, slaText]);
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
    let cancelled = false;
    loadAvailableChartsReleaseSnapshotsFromSupabase(settings.projectId)
      .then(releases => {
        if (!cancelled) setAvailableDbReleases(releases);
      })
      .catch(error => {
        if (!cancelled) pushLog(`Supabase cache: ${(error as Error)?.message || String(error)}`, 'warn');
      });
    return () => { cancelled = true; };
  }, [pushLog, settings.projectId]);

  useEffect(() => {
    if (!availableReleaseOptions.length) {
      if (!report?.releases?.length) setSelectedReleases([]);
      return;
    }
    const allowed = new Set(availableReleaseOptions);
    setSelectedReleases(prev => prev.filter(item => allowed.has(item)));
  }, [availableReleaseOptions, report]);

  useEffect(() => {
    if (!selectedNeedsDb || !selectedReleases.length) {
      setDbFilteredReport(null);
      setReleaseFilterBusy(false);
      return;
    }

    let cancelled = false;
    setReleaseFilterBusy(true);
    setDbFilteredReport(null);
    loadChartsReleaseSnapshotsFromSupabase(settings.projectId, selectedReleases)
      .then(async snapshots => {
        if (cancelled) return;
        const byRelease = new Map(snapshots.map(snapshot => [snapshot.release, snapshot]));
        const ordered = selectedReleases
          .map(release => byRelease.get(release))
          .filter((snapshot): snapshot is ChartsReleaseSnapshotPayload => Boolean(snapshot));
        const missing = selectedReleases.filter(release => !byRelease.has(release));
        if (missing.length) {
          pushLog(`Supabase cache: нет срезов для ${missing.map(formatReleaseShort).join(', ')}.`, 'warn');
        }
        if (!ordered.length) {
          setDbFilteredReport(null);
          return;
        }
        const built = rebuildChartsReportFromReleaseSnapshots(ordered, { sourceReport: report, compareMode });
        const helperBase = String(built.ml.helperHealth.base || settings.mlHelperBase || '').trim();
        const refreshed = await refreshChartsMlStateForReport(built, buildMlIoConfig(helperBase), compareMode).catch(() => built);
        if (!cancelled) {
          setDbFilteredReport(refreshed);
          setHelperOnline(refreshed.ml.helperHealth.online);
          pushLog(`Supabase cache: статистика пересобрана по ${refreshed.releases.length} релизам.`, 'ok');
        }
      })
      .catch(error => {
        if (!cancelled) {
          const message = (error as Error)?.message || String(error);
          setError(message);
          pushLog(`Supabase cache: ${message}`, 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setReleaseFilterBusy(false);
      });

    return () => { cancelled = true; };
  }, [buildMlIoConfig, compareMode, pushLog, report, selectedNeedsDb, selectedReleaseKey, selectedReleases, settings.mlHelperBase, settings.projectId]);

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
      const cachedReport = await loadLatestChartsReportFromSupabase({
        projectId: settings.projectId,
        releaseFrom,
        releaseTo,
        compareMode,
      }).catch(loadError => {
        pushLog(`Supabase: ${(loadError as Error)?.message || String(loadError)}`, 'warn');
        return null;
      });
      if (cachedReport?.report && !controller.signal.aborted) {
        setReport(cachedReport.report);
        setSelectedReleases([]);
        setHelperOnline(cachedReport.report.ml.helperHealth.online);
        pushLog(`Supabase: найден готовый отчёт (${cachedReport.report.releases.length} релизов), внешние запросы не запускались.`, 'ok');
        return;
      }

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
      try {
        const saved = await saveChartsReportToSupabase({
          report: result,
          projectId: settings.projectId,
          releaseFrom,
          releaseTo,
          compareMode,
        });
        pushLog(`Supabase: отчёт сохранён (${saved.metrics} метрик, ${saved.ml} ML-записей).`, 'ok');
      } catch (dbError) {
        pushLog(`Supabase: ${(dbError as Error)?.message || String(dbError)}`, 'warn');
      }
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

  const loadFromDb = useCallback(async () => {
    setActionBusy('db-load');
    setError('');
    try {
      pushLog(`Supabase: загрузка последнего отчёта ${releaseFrom} → ${releaseTo}.`);
      const loaded = await loadLatestChartsReportFromSupabase({
        projectId: settings.projectId,
        releaseFrom,
        releaseTo,
        compareMode,
      });
      if (!loaded) {
        pushLog('Supabase: отчёт для выбранного диапазона не найден.', 'warn');
        return;
      }
      setReport(loaded.report);
      setSelectedReleases([]);
      setHelperOnline(loaded.report.ml.helperHealth.online);
      pushLog(`Supabase: отчёт загружен (${loaded.report.releases.length} релизов).`, 'ok');
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      setError(message);
      pushLog(`Supabase: ${message}`, 'error');
    } finally {
      setActionBusy('');
    }
  }, [compareMode, pushLog, releaseFrom, releaseTo, settings.projectId]);

  const saveReportToDb = useCallback(async () => {
    if (!report) return;
    setActionBusy('db-save');
    try {
      const saved = await saveChartsReportToSupabase({
        report,
        projectId: settings.projectId,
        releaseFrom,
        releaseTo,
        compareMode,
      });
      pushLog(`Supabase: отчёт сохранён вручную (${saved.metrics} метрик, ${saved.ml} ML-записей).`, 'ok');
    } catch (error) {
      pushLog(`Supabase: ${(error as Error)?.message || String(error)}`, 'error');
    } finally {
      setActionBusy('');
    }
  }, [compareMode, pushLog, releaseFrom, releaseTo, report, settings.projectId]);

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
      try {
        await saveChartsMlDatasetToSupabase(result.dataset, settings.projectId);
        pushLog('ML-выгрузка синхронизирована с Supabase.', 'ok');
      } catch (dbError) {
        pushLog(`Supabase ML: ${(dbError as Error)?.message || String(dbError)}`, 'warn');
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
  }, [buildMlIoConfig, compareMode, pushLog, report, settings.mlHelperBase, settings.projectId]);

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
      try {
        await saveChartsMlDatasetToSupabase(dataset, settings.projectId);
        pushLog(`ML-разметка "${labelTitle}" синхронизирована с Supabase.`, 'ok');
      } catch (dbError) {
        pushLog(`Supabase ML: ${(dbError as Error)?.message || String(dbError)}`, 'warn');
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
  }, [buildMlIoConfig, compareMode, pushLog, report, settings.mlHelperBase, settings.projectId]);

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
      if (!availableReleaseOptions.length) return prev;
      if (!prev.length) return [release];
      if (prev.includes(release)) {
        const next = prev.filter(item => item !== release);
        return next.length ? next : [];
      }
      const next = [...prev, release].sort(compareReleaseLabels);
      return next.length === availableReleaseOptions.length ? [] : next;
    });
  }, [availableReleaseOptions]);

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

  const renderLlmSummaryCard = useCallback(() => {
    const sections = parseLegacyLlmSections(effectiveLlmText);
    return (
      <Card className="charts-design-llm" data-export-kind="ml">
        <CardHeader>
          <div>
            <CardTitle>LLM-сводка</CardTitle>
            <CardHint>Legacy-структура: короткий вывод, риски, рекомендации и ручные проверки на полном контексте графиков.</CardHint>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!aiText.trim() && <Badge color="gray">локальная сводка</Badge>}
            <Button variant="ghost" size="sm" onClick={() => setLlmSummaryCollapsed(value => !value)}>
              {llmSummaryCollapsed ? 'Развернуть' : 'Свернуть'}
            </Button>
            <Button variant="ghost" size="sm" onClick={generateAi} disabled={aiLoading || !report}>
              {aiLoading ? 'Генерация...' : 'Сформировать'}
            </Button>
          </div>
        </CardHeader>
        {!llmSummaryCollapsed && (
          <CardBody>
            <div className="charts-legacy-llm-grid">
              {sections.map(section => (
                <section className="charts-legacy-llm-section" key={`llm-section-${section.title}`}>
                  <div className="charts-legacy-llm-section__title">{section.title}</div>
                  {section.items.length ? (
                    <ul className="charts-legacy-llm-section__list">
                      {section.items.map((item, index) => <li key={`${section.title}-${index}`}>{item}</li>)}
                    </ul>
                  ) : (
                    <div className="charts-legacy-llm-section__empty">Нет данных в секции.</div>
                  )}
                </section>
              ))}
            </div>
          </CardBody>
        )}
      </Card>
    );
  }, [aiLoading, aiText, effectiveLlmText, generateAi, llmSummaryCollapsed, report]);

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
    const streamDeltaRows = source.streamDeltaRows;
    const streamDeltaTotal = streamDeltaRows.reduce((sum, row) => sum + row.manualDelta + row.autoDelta, 0);
    const streamManualTotal = streamDeltaRows.reduce((sum, row) => sum + row.manualDelta, 0);
    const streamAutoTotal = streamDeltaRows.reduce((sum, row) => sum + row.autoDelta, 0);
    const topStreamGrowth = streamDeltaRows.filter(row => row.manualDelta + row.autoDelta > 0).reduce<ChartsStreamDeltaRow | null>((best, row) => {
      if (!best) return row;
      return row.manualDelta + row.autoDelta > best.manualDelta + best.autoDelta ? row : best;
    }, null);
    const topStreamDrop = streamDeltaRows.filter(row => row.manualDelta + row.autoDelta < 0).reduce<ChartsStreamDeltaRow | null>((best, row) => {
      if (!best) return row;
      return row.manualDelta + row.autoDelta < best.manualDelta + best.autoDelta ? row : best;
    }, null);
    const formatSignedInt = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('ru-RU')}`;

    const renderPrimary = (
      datasets: LineDataset[] | BarDataset[],
      stacked = false,
      yTickFormatter?: (value: number) => string,
      tooltipFormatter?: (value: number, datasetLabel: string) => string,
      valueLabelFormatter?: (value: number, datasetLabel: string) => string,
      valueLabelMode: ValueLabelMode = 'all',
      metricKind: 'count' | 'minutes' = 'count'
    ) => {
      const displayedDatasets = applyValueModeToDatasets(datasets as Array<LineDataset | BarDataset>);
      const modeTickFormatter = metricKind === 'minutes'
        ? (value: number) => formatMinutesValueForMode(value, 2)
        : (value: number) => formatCountValueForMode(value);
      const modeTooltipFormatter = metricKind === 'minutes'
        ? (value: number, label: string) => `${label}: ${formatMinutesValueForMode(value, 2)}`
        : (value: number, label: string) => `${label}: ${formatCountValueForMode(value)}`;
      const modeValueLabelFormatter = metricKind === 'minutes'
        ? (value: number) => formatMinutesValueForMode(value, 2)
        : (value: number) => formatCountValueForMode(value);
      const resolvedYTickFormatter = valueMode === 'absolute' ? yTickFormatter : modeTickFormatter;
      const resolvedTooltipFormatter = valueMode === 'absolute' ? tooltipFormatter : modeTooltipFormatter;
      const resolvedValueLabelFormatter = valueMode === 'absolute' ? valueLabelFormatter : modeValueLabelFormatter;
      if (chartMode === 'bar') {
        return <BarChart labels={labels} datasets={displayedDatasets as BarDataset[]} palette={palette} markers={[]} stacked={stacked} yTickFormatter={resolvedYTickFormatter} tooltipFormatter={resolvedTooltipFormatter} valueLabelFormatter={resolvedValueLabelFormatter} height={240} />;
      }
      return (
        <LineChart
          labels={labels}
          datasets={displayedDatasets as LineDataset[]}
          palette={palette}
          markers={[]}
          yTickFormatter={resolvedYTickFormatter}
          tooltipFormatter={resolvedTooltipFormatter}
          valueLabelFormatter={resolvedValueLabelFormatter}
          valueLabelMode={valueLabelMode}
          height={240}
        />
      );
    };
    const renderStreamDeltaCard = () => (
      <Card className="charts-design-card">
        <CardHeader>
          <div>
            <CardTitle>Дельта тест-кейсов по стримам</CardTitle>
            <CardHint>Изменение Manual, Auto и uWu TC от релиза к релизу. Это отдельный обязательный блок под графиком объёма регресса.</CardHint>
          </div>
          <Badge color="gray">{streamDeltaRows.length} строк</Badge>
        </CardHeader>
        <CardBody>
          <div className="charts-design-stream-delta-summary">
            <div>
              <span>Общая дельта TC</span>
              <strong>{formatSignedInt(streamDeltaTotal)}</strong>
              <small>Manual {formatSignedInt(streamManualTotal)} · Auto {formatSignedInt(streamAutoTotal)}</small>
            </div>
            <div>
              <span>Максимальный рост</span>
              <strong>{topStreamGrowth ? topStreamGrowth.stream : '—'}</strong>
              <small>{topStreamGrowth ? `${formatReleaseShort(topStreamGrowth.release)} · ${formatSignedInt(topStreamGrowth.manualDelta + topStreamGrowth.autoDelta)} TC` : 'Нет данных по росту'}</small>
            </div>
            <div>
              <span>Максимальное снижение</span>
              <strong>{topStreamDrop ? topStreamDrop.stream : '—'}</strong>
              <small>{topStreamDrop ? `${formatReleaseShort(topStreamDrop.release)} · ${formatSignedInt(topStreamDrop.manualDelta + topStreamDrop.autoDelta)} TC` : 'Нет данных по снижению'}</small>
            </div>
          </div>
        </CardBody>
        <RealLlmInsight
          aiText={effectiveLlmText}
          keywords={['стрим', 'stream', 'дельта', 'manual', 'auto']}
          fallback="LLM должен объяснить, какие стримы двигают рост или снижение тест-кейсов, и где нужен владелец проверки перед следующим релизом."
        />
        <div className="charts-data-table-wrap" style={{ maxHeight: 360 }}>
          <table className="charts-data-table">
            <thead>
              <tr>
                <th>Релиз</th>
                <th>Stream</th>
                <th>Manual до</th>
                <th>Manual после</th>
                <th>Manual Δ</th>
                <th>AT до</th>
                <th>AT после</th>
                <th>AT Δ</th>
                <th>Всего Δ</th>
                <th>uWu Manual Δ</th>
                <th>uWu AT Δ</th>
              </tr>
            </thead>
            <tbody>
              {streamDeltaRows.length ? streamDeltaRows.map(row => {
                const totalDelta = row.manualDelta + row.autoDelta;
                return (
                  <tr key={`stream-delta-card-${row.release}-${row.stream}`}>
                    <td>{formatReleaseShort(row.release)}</td>
                    <td style={{ textAlign: 'left' }}>{row.stream}</td>
                    <td>{row.manualBefore}</td>
                    <td>{row.manualAfter}</td>
                    <td className={row.manualDelta > 0 ? 'delta-pos' : row.manualDelta < 0 ? 'delta-neg' : ''}>{formatSignedInt(row.manualDelta)}</td>
                    <td>{row.autoBefore}</td>
                    <td>{row.autoAfter}</td>
                    <td className={row.autoDelta > 0 ? 'delta-pos' : row.autoDelta < 0 ? 'delta-neg' : ''}>{formatSignedInt(row.autoDelta)}</td>
                    <td className={totalDelta > 0 ? 'delta-pos' : totalDelta < 0 ? 'delta-neg' : ''}>{formatSignedInt(totalDelta)}</td>
                    <td className={row.uwuManualDelta > 0 ? 'delta-pos' : row.uwuManualDelta < 0 ? 'delta-neg' : ''}>{row.uwuManualDelta > 0 ? '+' : ''}{row.uwuManualDelta.toFixed(1)}</td>
                    <td className={row.uwuAutoDelta > 0 ? 'delta-pos' : row.uwuAutoDelta < 0 ? 'delta-neg' : ''}>{row.uwuAutoDelta > 0 ? '+' : ''}{row.uwuAutoDelta.toFixed(1)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '16px 0' }}>Нет изменений тест-кейсов по стримам</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );

    return (
      <>
        {renderDesignSection('regress', 1, (
          <Card className="charts-design-card">
            <CardHeader>
              <div><CardTitle>Объём регресса</CardTitle><CardHint>Manual и Auto по релизам в текущей выборке.</CardHint></div>
              <div className="charts-table-toggle">
                <button className={`charts-table-toggle__btn${tcTableMode === 'streams' ? ' charts-table-toggle__btn--active' : ''}`} onClick={() => setTcTableMode('streams')}>По стримам</button>
                <button className={`charts-table-toggle__btn${tcTableMode === 'counts' ? ' charts-table-toggle__btn--active' : ''}`} onClick={() => setTcTableMode('counts')}>Счёт</button>
              </div>
            </CardHeader>
            <CardBody>{renderPrimary(tcDatasets, true, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <RealLlmInsight
              aiText={effectiveLlmText}
              keywords={['регресс', 'manual', 'auto', 'stream', 'стрим']}
              fallback={`${getMockValueModeHint(valueMode)} Объём регресса нужно читать вместе с дельтой по стримам: рост Manual повышает ручную нагрузку, рост Auto показывает расширение автоматизации.`}
            />
            {tcTableMode === 'streams' ? (
              <div className="charts-data-table-wrap" style={{ maxHeight: 260 }}>
                <table className="charts-data-table">
                  <thead><tr><th>Релиз</th><th>Stream</th><th>Manual Δ</th><th>AT Δ</th><th>uWu Manual Δ</th><th>uWu AT Δ</th></tr></thead>
                  <tbody>
                    {source.streamDeltaRows.length ? source.streamDeltaRows.map(row => (
                      <tr key={`sd-${row.release}-${row.stream}`}>
                        <td>{formatReleaseShort(row.release)}</td>
                        <td style={{ textAlign: 'left' }}>{row.stream}</td>
                        <td className={row.manualDelta > 0 ? 'delta-pos' : row.manualDelta < 0 ? 'delta-neg' : ''}>{row.manualDelta > 0 ? '+' : ''}{row.manualDelta}</td>
                        <td className={row.autoDelta > 0 ? 'delta-pos' : row.autoDelta < 0 ? 'delta-neg' : ''}>{row.autoDelta > 0 ? '+' : ''}{row.autoDelta}</td>
                        <td className={row.uwuManualDelta > 0 ? 'delta-pos' : row.uwuManualDelta < 0 ? 'delta-neg' : ''}>{row.uwuManualDelta > 0 ? '+' : ''}{row.uwuManualDelta.toFixed(1)}</td>
                        <td className={row.uwuAutoDelta > 0 ? 'delta-pos' : row.uwuAutoDelta < 0 ? 'delta-neg' : ''}>{row.uwuAutoDelta > 0 ? '+' : ''}{row.uwuAutoDelta.toFixed(1)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '16px 0' }}>Нет изменений по стримам</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
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
            )}
          </Card>
        ), true)}
        <div data-export-kind="data">{renderStreamDeltaCard()}</div>

        {renderDesignSection('quality', 3, (
          <>
          <Card className="charts-design-card">
            <CardHeader><CardTitle>High / Blocker: SWAT vs Stream</CardTitle><CardHint>Сравнение критичных проверок SWAT и stream-команд.</CardHint></CardHeader>
            <CardBody>{renderPrimary(covDatasets, false, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <RealLlmInsight
              aiText={effectiveLlmText}
              keywords={['high', 'blocker', 'swat', 'stream', 'покрыт']}
              fallback={`${getMockValueModeHint(valueMode)} LLM-инсайт должен сверять баланс SWAT и Stream: резкая просадка одного контура означает риск слепой зоны в критичных проверках.`}
            />
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
          <Card className="charts-design-card">
            <CardHeader><CardTitle>Selective: SWAT vs Stream</CardTitle><CardHint>Объём selective-проверок по двум контурам.</CardHint></CardHeader>
            <CardBody>{renderPrimary(selDatasets, false, value => Number(value).toLocaleString('ru-RU'), (value, label) => `${label}: ${Number(value).toLocaleString('ru-RU')}`, value => formatCountLabelCompact(value))}</CardBody>
            <RealLlmInsight
              aiText={effectiveLlmText}
              keywords={['selective', 'swat', 'stream', 'провер']}
              fallback={`${getMockValueModeHint(valueMode)} Selective показывает, где нужна ручная сверка владельцев: рост Stream без SWAT-поддержки требует проверки критичных потоков.`}
            />
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
          <Card className="charts-design-card">
            <CardHeader><CardTitle>Среднее время прохождения</CardTitle><CardHint>Среднее время на кейс: SWAT, STREAM и общее.</CardHint></CardHeader>
            <CardBody>{renderPrimary(avgDatasets, false, value => formatMinutesToClock(value), value => `${formatMinutesPretty(value, 2)} · ${value.toFixed(2)} мин`, value => formatMinutesToClock(value), 'all', 'minutes')}</CardBody>
            <RealLlmInsight
              aiText={effectiveLlmText}
              keywords={['время', 'средн', 'скорость', 'мин']}
              fallback={`${getMockValueModeHint(valueMode)} Если среднее время растёт вместе с объёмом регресса, риск не только в количестве TC, но и в пропускной способности команды.`}
            />
            <div className="charts-data-table-wrap">
              <table className="charts-data-table">
                <thead><tr><th>Номер релиза</th><th>SWAT</th><th>STREAM</th><th>Общее</th><th>Взвешенное</th></tr></thead>
                <tbody>{source.avgRows.map(row => (
                  <tr key={`avg-${row.release}`}>
                    <td>{formatReleaseShort(row.release)}</td>
                    <td>{formatMinutesToClock(row.swatMs / 60000)}</td>
                    <td>{formatMinutesToClock(row.streamMs / 60000)}</td>
                    <td>{formatMinutesToClock(row.totalMs / 60000)}</td>
                    <td>{formatMinutesToClock(row.totalWeighted / 60000)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          </>
        ))}
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
    const renderChpTypeCard = (title: string, datasets: BarDataset[] | LineDataset[], rows: ChartsReport['chpTypes']['rows']) => (
      <div data-export-kind="chart">
        <Card className="charts-design-card">
          <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
          <CardBody>
            {renderLegendRow((datasets as Array<{ label: string; color: string }>).map(item => ({ label: item.label, color: item.color })))}
            {chartMode === 'bar'
              ? <BarChart labels={labels} datasets={applyValueModeToDatasets(datasets as BarDataset[])} palette={palette} markers={quietReleaseMarkers} stacked yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)} legendDisplay={false} height={220} valueLabelFormatter={value => formatCountValueForMode(value)} />
              : <LineChart
                  labels={labels}
                  datasets={applyValueModeToDatasets((datasets as LineDataset[]).map(item => ({ ...item, fill: false })))}
                  palette={palette}
                  markers={quietReleaseMarkers}
                  yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)}
                  tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${formatCountValueForMode(value, valueMode !== 'absolute')}`}
                  valueLabelFormatter={value => formatCountValueForMode(value)}
                  valueLabelMode="all"
                  legendDisplay={false}
                  height={220}
                />}
          </CardBody>
          <RealLlmInsight
            aiText={effectiveLlmText}
            keywords={['чп', 'баг', 'краш', 'аналитика', 'влет']}
            fallback={`${getMockValueModeHint(valueMode)} Для ЧП типов важен не только общий счёт, а смена структуры причин: рост Bug или Crash требует владельца проверки до release decision.`}
          />
          <ChpTypesInlineTable rows={rows} />
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
        {renderDesignSection('incidents', 4, (
          <>
          <div data-export-kind="chart">
            <Card className="charts-design-card">
              <CardHeader><CardTitle>ЧП по релизам</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={applyValueModeToDatasets(chpDatasets.map(item => ({ label: item.label, data: item.data, color: item.color })))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)} valueLabelFormatter={value => formatCountValueForMode(value)} height={240} />
                  : <LineChart labels={labels} datasets={applyValueModeToDatasets(chpDatasets)} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)} tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${formatCountValueForMode(value, valueMode !== 'absolute')}`} valueLabelFormatter={value => formatCountValueForMode(value)} valueLabelMode="all" height={240} />}
              </CardBody>
              <RealLlmInsight
                aiText={effectiveLlmText}
                keywords={['чп', 'cutoff', 'ios', 'android', 'инцидент']}
                fallback={`${getMockValueModeHint(valueMode)} ЧП нужно читать как release-risk: рост после cutoff требует ручной проверки причин и владельцев по платформам.`}
              />
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
          {renderChpTypeCard('ЧП типы · всё', chpTypeDatasets, source.chpTypes.rows)}
          {renderChpTypeCard('ЧП типы · iOS', chpTypeIosDatasets, source.chpTypes.iosRows)}
          {renderChpTypeCard('ЧП типы · Android', chpTypeAndroidDatasets, source.chpTypes.androidRows)}
          </>
        ))}
        <div data-export-kind="ml">
          <ChpQuarterSummary stats={source.chpQuarterStats} />
        </div>

        {renderDesignSection('timing', 2, (
          <>
          <div data-export-kind="chart">
            <Card className="charts-design-card">
              <CardHeader><CardTitle>Cutoff и Store</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart
                      labels={labels}
                      datasets={applyValueModeToDatasets(cutStoreDatasets.map(item => ({ label: item.label, data: item.data, color: item.color })))}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatClockValueForMode}
                      tooltipFormatter={value => formatClockValueForMode(value)}
                      valueLabelFormatter={value => formatClockValueForMode(value)}
                      height={260}
                    />
                  : <LineChart
                      labels={labels}
                      datasets={applyValueModeToDatasets(cutStoreDatasets)}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatClockValueForMode}
                      tooltipFormatter={value => formatClockValueForMode(value)}
                      valueLabelFormatter={value => formatClockValueForMode(value)}
                      valueLabelMode="all"
                      height={260}
                    />}
              </CardBody>
              <RealLlmInsight
                aiText={effectiveLlmText}
                keywords={['cutoff', 'store', 'sla', 'тайминг']}
                fallback={`${getMockValueModeHint(valueMode)} Cutoff и Store — главный SLA-сигнал: поздний Store должен иметь владельца и подтверждённое действие до релиза.`}
              />
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
            <Card className="charts-design-card">
              <CardHeader><CardTitle>Старт регресса и Lag</CardTitle></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart
                      labels={labels}
                      datasets={applyValueModeToDatasets(regressionDatasets.map(item => ({ label: item.label, data: item.data, color: item.color })))}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatClockValueForMode}
                      tooltipFormatter={value => formatClockValueForMode(value)}
                      valueLabelFormatter={value => formatClockValueForMode(value)}
                      height={260}
                    />
                  : <LineChart
                      labels={labels}
                      datasets={applyValueModeToDatasets(regressionDatasets)}
                      palette={palette}
                      markers={quietReleaseMarkers}
                      yTickFormatter={formatClockValueForMode}
                      tooltipFormatter={value => formatClockValueForMode(value)}
                      valueLabelFormatter={value => formatClockValueForMode(value)}
                      valueLabelMode="all"
                      height={260}
                    />}
              </CardBody>
              <RealLlmInsight
                aiText={effectiveLlmText}
                keywords={['старт', 'регресс', 'lag', 'тайминг']}
                fallback={`${getMockValueModeHint(valueMode)} Lag между платформами показывает операционный риск: большой сдвиг старта уменьшает окно реакции на дефекты.`}
              />
              <div className="charts-data-table-wrap">
                <table className="charts-data-table">
                  <thead><tr><th>Релиз</th><th>Время старта iOS</th><th>Время старта Android</th><th>Lag iOS</th><th>Lag Android</th></tr></thead>
                  <tbody>{source.timings.map(row => (
                    <tr key={`reg-${row.release}`}>
                      <td>{formatReleaseShort(row.release)}</td>
                      <td>{row.iosRegressionLabel || '—'}</td>
                      <td>{row.androidRegressionLabel || '—'}</td>
                      <td>{row.iosLagMinutes == null ? '—' : formatMinutesPretty(row.iosLagMinutes, 1)}</td>
                      <td>{row.androidLagMinutes == null ? '—' : formatMinutesPretty(row.androidLagMinutes, 1)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          </div>
          </>
        ))}

        {renderDesignSection('downtime', 2, (
          <>
          <div data-export-kind="chart">
            <Card className="charts-design-card">
              <CardHeader><CardTitle>DEV downtime · iOS</CardTitle><Badge color="purple">{source.devDowntime.iosRows.length}</Badge></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={applyValueModeToDatasets(iosDowntimeDatasets.map(item => ({ label: item.label, data: item.data, color: item.color })))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelFormatter={value => formatMinutesValueForMode(value, 1)} height={220} />
                  : <LineChart labels={labels} datasets={applyValueModeToDatasets(iosDowntimeDatasets)} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesValueForMode(value, 1)} tooltipFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelMode="all" height={220} />}
              </CardBody>
              <RealLlmInsight
                aiText={effectiveLlmText}
                keywords={['downtime', 'простой', 'dev', 'ios']}
                fallback={`${getMockValueModeHint(valueMode)} Downtime iOS важно смотреть по повторяемости: серия коротких простоев перед cutoff опаснее одиночного всплеска.`}
              />
              <DowntimeByReleaseInlineTable rows={source.devDowntime.iosByRelease} />
            </Card>
          </div>
          <div data-export-kind="chart">
            <Card className="charts-design-card">
              <CardHeader><CardTitle>DEV downtime · Android</CardTitle><Badge color="green">{source.devDowntime.androidRows.length}</Badge></CardHeader>
              <CardBody>
                {chartMode === 'bar'
                  ? <BarChart labels={labels} datasets={applyValueModeToDatasets(androidDowntimeDatasets.map(item => ({ label: item.label, data: item.data, color: item.color })))} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelFormatter={value => formatMinutesValueForMode(value, 1)} height={220} />
                  : <LineChart labels={labels} datasets={applyValueModeToDatasets(androidDowntimeDatasets)} palette={palette} markers={quietReleaseMarkers} yTickFormatter={value => formatMinutesValueForMode(value, 1)} tooltipFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelFormatter={value => formatMinutesValueForMode(value, 1)} valueLabelMode="all" height={220} />}
              </CardBody>
              <RealLlmInsight
                aiText={effectiveLlmText}
                keywords={['downtime', 'простой', 'dev', 'android']}
                fallback={`${getMockValueModeHint(valueMode)} Downtime Android нужно связывать с ЧП и late Store: если пики совпадают, релиз требует подтверждения владельцев окружения.`}
              />
              <DowntimeByReleaseInlineTable rows={source.devDowntime.androidByRelease} />
            </Card>
          </div>
          </>
        ))}
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
    <Card className="charts-design-card">
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
                    datasets={applyValueModeToDatasets(legendItems.map(item => ({
                      label: item.label,
                      data: rows.map(row => Number(row.counts[item.label] || 0)),
                      color: item.color,
                    })))}
                    palette={palette}
                    markers={withSilentMarkerLabels(markers)}
                    stacked
                    yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)}
                    valueLabelFormatter={value => formatCountValueForMode(value)}
                    legendDisplay={false}
                    height={220}
                  />
                ) : (
                  <LineChart
                    labels={labels}
                    datasets={applyValueModeToDatasets(legendItems.map(item => ({
                      label: item.label,
                      data: rows.map(row => Number(row.counts[item.label] || 0)),
                      color: item.color,
                      fill: false,
                    })))}
                    palette={palette}
                    markers={withSilentMarkerLabels(markers)}
                    yTickFormatter={value => valueMode === 'absolute' ? Number(value).toLocaleString('ru-RU') : formatCountValueForMode(value)}
                    tooltipFormatter={(value, datasetLabel) => `${datasetLabel}: ${formatCountValueForMode(value, valueMode !== 'absolute')}`}
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
      <RealLlmInsight
        aiText={effectiveLlmText}
        keywords={['тип', 'bug', 'task', 'release', 'epic', 'внешн', 'внутр']}
        fallback={`${getMockValueModeHint(valueMode)} Типы задач нужно читать с разделением на внутренние и внешние: рост внешних Bug/Task повышает координационный риск релиза.`}
      />
      {typeNames.length ? <TaskTypesInlineTable rows={rows} typeNames={typeNames} /> : null}
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
        {renderDesignSection('types', 2, (
          <>
          <div data-export-kind="chart">{renderTypesChart('Типы задач iOS', source.taskTypes.iosRows, source.taskTypes.iosTypes, releaseMarkers)}</div>
          <div data-export-kind="chart">{renderTypesChart('Типы задач Android', source.taskTypes.androidRows, source.taskTypes.androidTypes, releaseMarkers)}</div>
          </>
        ))}
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
    return (
      <section className="charts-design-section">
        <div className="charts-design-section__head">
          <div>
            <div className="charts-design-section__title">7. Внутренние и внешние стримы</div>
            <div className="charts-design-section__hint">Legacy-каталог стримов текущего релиза и лидеры изменений по HB, Selective и UwU.</div>
          </div>
          <Badge color="gray">{source.streamInsights.internalStreams.length + source.streamInsights.externalStreams.length} стрим.</Badge>
        </div>
        <div className="charts-design-grid">
          <div data-export-kind="data">
            <Card className="charts-design-card">
              <CardHeader>
                <div>
                  <CardTitle>Внутренние стримы</CardTitle>
                  <CardHint>Список стримов из текущего релиза без внешних доменов.</CardHint>
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
            <Card className="charts-design-card">
              <CardHeader>
                <div>
                  <CardTitle>Внешние стримы</CardTitle>
                  <CardHint>Финтех, банк, payments, travel и прочие внешние домены текущего релиза.</CardHint>
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
        <div className="charts-design-grid charts-design-grid--three" style={{ marginTop: 14 }}>
          <div data-export-kind="chart"><InsightBlock title="HB стримы" summary={source.streamInsights.hb} /></div>
          <div data-export-kind="chart"><InsightBlock title="Selective стримы" summary={source.streamInsights.selective} /></div>
          <div data-export-kind="chart"><InsightBlock title="UwU по стримам" summary={source.streamInsights.uwu} /></div>
        </div>
      </section>
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

  const renderAiMlLegacySummary = () => {
    const source = displayedReport || report;
    if (!source) return null;
    const mlSummary = source.ml.summary;
    const driver = source.ml.prediction.featureDrivers?.[0];
    const currentMlRisk = source.ml.prediction.activeProbability == null ? null : Math.round(source.ml.prediction.activeProbability * 100);
    const currentRelease = source.metrics[source.metrics.length - 1]?.release || source.releases[source.releases.length - 1] || '—';
    return (
      <section className="charts-legacy-ml-summary" data-export-kind="ml">
        <div className="charts-legacy-ml-summary__head">
          <div>
            <div className="charts-legacy-ml-summary__title">AI и ML сводка</div>
            <div className="charts-legacy-ml-summary__hint">
              Legacy-логика: прогноз ML, статус обучения, доменные выводы, драйверы риска, аномалии и ручные проверки.
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAiMlSummaryCollapsed(value => !value)}>
            {aiMlSummaryCollapsed ? 'Развернуть' : 'Свернуть'}
          </Button>
        </div>
        {!aiMlSummaryCollapsed && (
          <div className="charts-legacy-ml-summary__body">
            <div className="charts-legacy-ml-status-row">
              <Badge color={source.ml.prediction.engine === 'catboost' ? 'green' : source.ml.prediction.engine === 'linear' ? 'yellow' : 'gray'}>
                Статус ML: {mlSummary.statusText}
              </Badge>
              <Badge color="gray">Текущий релиз: {formatReleaseShort(currentRelease)}</Badge>
              <Badge color="gray">{mlSummary.compareText}</Badge>
              <Badge color="gray">Движок: {mlEngineLabel(source.ml.prediction.engine)}</Badge>
              <Badge color="gray">Метки: {source.ml.prediction.labeledSamples}</Badge>
              <Badge color={source.ml.helperHealth.online ? 'green' : 'yellow'}>{helperStatusLabel(source.ml.helperHealth.online)}</Badge>
            </div>
            <div className="charts-legacy-ml-release-strip">
              <span>Диапазон: {formatReleaseShort(source.releases[0] || '—')} → {formatReleaseShort(source.releases[source.releases.length - 1] || '—')}</span>
              <span>Релизов в расчёте: {source.releases.length}</span>
              <span>ML риск: {currentMlRisk == null ? '—' : `${currentMlRisk}%`}</span>
              <span>Драйвер #1: {driver?.label || '—'}{driver ? ` · ${driver.contribution >= 0 ? '+' : ''}${driver.contribution.toFixed(2)}` : ''}</span>
              <span>Аномалии: {source.anomalies.release.count} / {source.anomalies.type.count} / {source.anomalies.platform.count}</span>
            </div>
            <div className="charts-legacy-ml-summary__note">
              {mlSummary.compareText}. Блоки ниже построены из тех же групп, что legacy: обзор, регресс, релиз, типы, стримы, драйверы модели и контроль отклонений.
            </div>
            <div className="charts-legacy-ml-domain-grid">
              <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.overview} /></div>
              <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.regress} /></div>
              <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.release} /></div>
              <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.types} /></div>
              <div data-export-kind="ml"><MlSectionSummaryCard section={mlSummary.sections.streams} /></div>
            </div>
            <div className="charts-legacy-ml-details">
              {renderAiTab()}
            </div>
          </div>
        )}
      </section>
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
          <Button variant={designPreviewOpen ? 'primary' : 'ghost'} size="sm" onClick={() => setDesignPreviewOpen(value => !value)}>
            {designPreviewOpen ? 'Закрыть макеты' : 'Макеты дизайна'}
          </Button>
          <Button variant="ghost" size="sm" onClick={loadFromDb} disabled={loading || Boolean(actionBusy)}>
            {actionBusy === 'db-load' ? 'БД...' : 'БД загрузить'}
          </Button>
          <Button variant="ghost" size="sm" onClick={saveReportToDb} disabled={!report || loading || Boolean(actionBusy)}>
            {actionBusy === 'db-save' ? 'БД...' : 'БД сохранить'}
          </Button>
          <Button variant="ghost" size="sm" onClick={exportJson} disabled={!report}>Экспорт JSON</Button>
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!report}>Экспорт CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf()} disabled={!report || exportingPdf}>{exportingPdf ? 'PDF...' : 'PDF всё'}</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf({ chartsOnly: true, includeMl: true })} disabled={!report || exportingPdf}>PDF графики + ML</Button>
          <Button variant="ghost" size="sm" onClick={() => exportPdf({ chartsOnly: true, includeMl: false })} disabled={!report || exportingPdf}>PDF графики</Button>
        </div>
      </div>

      {designPreviewOpen ? (
        <ChartsDesignMockups variant={designMockVariant} onVariantChange={setDesignMockVariant} palette={palette} />
      ) : (
      <>
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
          <div data-export-kind="data">
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Глобальный фильтр релизов</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      Применяется ко всем графикам, таблицам, ML-сводке и статистике; релизы вне текущего диапазона подтягиваются из БД cache.
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {releaseFilterBusy && <Badge color="yellow">БД...</Badge>}
                    {selectedNeedsDb && !releaseFilterBusy && <Badge color="green">из БД cache</Badge>}
                    <Badge color="gray">{buildReleaseFilterCaption(availableReleaseOptions.length, selectedReleases.length || availableReleaseOptions.length)}</Badge>
                    <Button variant="ghost" size="sm" onClick={resetReleaseFilter} disabled={!selectedReleases.length}>Сбросить</Button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {availableReleaseOptions.map(release => {
                    const active = !selectedReleases.length || selectedReleases.includes(release);
                    const fromDbOnly = !report.releases.includes(release);
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
                        title={fromDbOnly ? 'Релиз доступен из БД cache' : 'Релиз из текущего отчёта'}
                      >
                        {formatReleaseShort(release)}{fromDbOnly ? ' · БД' : ''}
                      </button>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          </div>

          {!displayedReport && selectedNeedsDb && (
            <Card><EmptyState text={releaseFilterBusy ? 'Собираю статистику по выбранным релизам из БД cache...' : 'Не удалось собрать статистику по выбранным релизам из БД cache.'} /></Card>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {renderAiMlLegacySummary()}
            {renderLlmSummaryCard()}
            <div className="charts-design-sticky-summary">
              <span>{formatReleaseShort(currentMetric?.release || report.releases[report.releases.length - 1] || '—')}</span>
              <strong>{decisionText}</strong>
              <span>ML риск {displayedMlRiskPct == null ? '—' : `${displayedMlRiskPct}%`}</span>
              <span>ЧП {currentChpTotal}</span>
              <span>{slaText}</span>
              <span>Downtime {formatMinutesPretty(currentDowntimeMinutes, 0)}</span>
            </div>
          </div>

          <div data-export-kind="data">
            <Card>
              <CardBody>
                <div className="charts-design-value-mode">
                  <div>
                    <div className="charts-design-value-mode__title">Режим значений</div>
                    <div className="charts-design-value-mode__hint">{getMockValueModeHint(valueMode)}</div>
                  </div>
                  <SegmentControl
                    items={[
                      { label: 'Абсолютные', value: 'absolute' },
                      { label: 'Δ к прошлому', value: 'prevDelta' },
                      { label: 'Δ к среднему', value: 'meanDelta' },
                    ]}
                    value={valueMode}
                    onChange={value => setValueMode(value as ChartsDesignValueMode)}
                  />
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="charts-design-kpis" data-export-kind="data">
            <MockSignalKpiCard
              label="Объём регресса"
              value={formatSignedPct(regressionDeltaPct)}
              status={regressionTone === 'bad' ? 'Риск' : regressionTone === 'warn' ? 'Внимание' : regressionTone === 'ok' ? 'OK' : 'Нет базы'}
              tone={regressionTone}
              hint={`Текущий объём: ${currentTcTotal.toLocaleString('ru-RU')} TC, база: ${previousTcTotal ? previousTcTotal.toLocaleString('ru-RU') : '—'}`}
            />
            <MockSignalKpiCard
              label="Покрытие качества"
              value={formatSignedPct(coverageDeltaPct)}
              status={coverageTone === 'bad' ? 'Просадка' : coverageTone === 'warn' ? 'Проверить' : coverageTone === 'ok' ? 'OK' : 'Нет базы'}
              tone={coverageTone}
              hint={`HB SWAT + Stream: ${coverageCurrent.toLocaleString('ru-RU')} проверок`}
            />
            <MockSignalKpiCard
              label="Тайминги"
              value={storeLate ? 'SLA риск' : 'SLA OK'}
              status={timingTone === 'warn' ? 'Внимание' : 'OK'}
              tone={timingTone}
              hint={slaText}
            />
            <MockSignalKpiCard
              label="Инциденты"
              value={String(currentChpTotal)}
              status={incidentTone === 'bad' ? 'Риск' : incidentTone === 'warn' ? 'Внимание' : 'OK'}
              tone={incidentTone}
              hint={`Аномалии: ${anomalyScore}; релиз ${displayedReport?.anomalies.release.count || 0}, типы ${displayedReport?.anomalies.type.count || 0}, платформы ${displayedReport?.anomalies.platform.count || 0}`}
            />
            <MockSignalKpiCard
              label="DEV downtime"
              value={formatMinutesPretty(currentDowntimeMinutes, 0)}
              status={downtimeTone === 'bad' ? 'Риск' : downtimeTone === 'warn' ? 'Внимание' : 'OK'}
              tone={downtimeTone}
              hint="Подтвердить владельцев окружений при ненулевом простое"
            />
          </div>

          <div className="charts-tab-content">
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Режим сравнения: {compareMode === 'mean' ? 'историческое среднее' : 'предыдущий релиз'}
            </div>

            {renderRegressTab()}
            {renderReleaseTab()}
            {renderTypesTab()}
            {renderStreamsTab()}
          </div>

          {logs.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Лог сбора</CardTitle></CardHeader>
              <CardBody><LogView lines={logs} /></CardBody>
            </Card>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
