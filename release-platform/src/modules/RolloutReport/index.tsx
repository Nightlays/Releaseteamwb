import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CanonicalTable,
  type CanonicalTableColumn,
  FieldLabel,
  Input,
  Modal,
  SegmentControl,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import {
  buildRolloutExportDataset,
  buildRolloutExportFilename,
  buildRolloutSummary,
  checkRolloutProxy,
  compareRolloutVersionsDesc,
  collectRolloutReport,
  filterRolloutGroupsByRange,
  formatMskDate,
  formatMskDateTime,
  ROLLOUT_DEFAULT_LOOKBACK_DAYS,
  ROLLOUT_DISK_SHEET_NAMES,
  ROLLOUT_DISK_SPREADSHEET_URL,
  ROLLOUT_PLATFORM_CONFIG,
  uploadRolloutDatasetToDisk,
  type AndroidRolloutGroup,
  type IosRolloutGroup,
  type RolloutGroup,
  type RolloutLogLevel,
  type RolloutPlatformId,
  type RolloutReportSummary,
  type RolloutStoreEvent,
} from '../../services/rolloutReport';

const LS_PREFIX = 'band_android_rollout_v1';
const LS_LOOKBACK_DAYS = `${LS_PREFIX}_lookback_days`;
const LS_RELEASE_FROM = `${LS_PREFIX}_release_from`;
const LS_RELEASE_TO = `${LS_PREFIX}_release_to`;
const LS_RELEASE_FILTER = `${LS_PREFIX}_release_filter`;
const LS_ACTIVE_PLATFORM = `${LS_PREFIX}_active_platform`;
const COLUMN_WIDTHS_STORAGE_KEY = 'rp_rollout_report_column_widths';

type StatusMode = 'idle' | 'ok' | 'warn' | 'error';

interface StatusState {
  proxy: { text: string; mode: StatusMode };
  band: { text: string; mode: StatusMode };
  data: { text: string; mode: StatusMode };
}

function readStorage(key: string, fallback = '') {
  try {
    return String(localStorage.getItem(key) || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readActivePlatform() {
  return readStorage(LS_ACTIVE_PLATFORM) === 'ios' ? 'ios' : 'android';
}

function readLookbackDays() {
  const stored = Number(readStorage(LS_LOOKBACK_DAYS, String(ROLLOUT_DEFAULT_LOOKBACK_DAYS)));
  return Number.isFinite(stored) && stored > 0 ? String(Math.round(stored)) : String(ROLLOUT_DEFAULT_LOOKBACK_DAYS);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(value: string) {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function waitForNextPaint() {
  return new Promise<void>(resolve => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function StatusPill({ text, mode }: { text: string; mode: StatusMode }) {
  const color = mode === 'ok' ? 'green' : mode === 'warn' ? 'yellow' : mode === 'error' ? 'red' : 'gray';
  return <Badge color={color}>{text}</Badge>;
}

function pointTitle(event: RolloutStoreEvent | null, emphasizeVersion: boolean) {
  if (!event) return 'Не найдено';
  return emphasizeVersion ? `${event.version} · ${formatMskDate(event.createdAt)}` : formatMskDate(event.createdAt);
}

function PointCell({ event, emphasizeVersion = false, showStoreTag = false }: { event: RolloutStoreEvent | null; emphasizeVersion?: boolean; showStoreTag?: boolean }) {
  if (!event) {
    return (
      <div className="rollout-point rollout-point--empty">
        <span className="rollout-table-empty">Не найдено</span>
        <span className="rollout-table-muted">В диапазоне нет подходящего сообщения.</span>
      </div>
    );
  }

  return (
    <div className="rollout-point">
      {showStoreTag && <span className="rollout-store-tag">{event.storeLabel}</span>}
      <div className="rollout-table-point">{pointTitle(event, emphasizeVersion)}</div>
      <span className="rollout-table-muted">{formatMskDateTime(event.createdAt)} (МСК)</span>
      {event.percent !== null && Number.isFinite(event.percent) && <span className="rollout-table-muted">{event.percent}%</span>}
      <span className="rollout-table-muted">{event.stageLabel}{event.stageText ? ` · ${event.stageText}` : ''}</span>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <article className="rollout-summary-card">
      <span className="rollout-summary-card__label">{label}</span>
      <span className="rollout-summary-card__value">{value}</span>
      <span className="rollout-summary-card__hint">{hint}</span>
    </article>
  );
}

function EmptyResults() {
  return <div className="rollout-empty-state">Пока пусто. Заполни настройки и нажми «Загрузить релизы».</div>;
}

function versionsText(group: RolloutGroup) {
  return Array.from(new Set(group.events.map(event => event.version))).sort(compareRolloutVersionsDesc).join(', ') || '-';
}

function eventText(event: RolloutStoreEvent | null) {
  if (!event) return '-';
  return [
    event.storeLabel,
    event.version,
    event.percent !== null && Number.isFinite(event.percent) ? `${event.percent}%` : '',
    formatMskDateTime(event.createdAt),
    event.stageLabel,
    event.stageText,
  ].filter(Boolean).join(' · ');
}

function visiblePointEvents(row: RolloutGroup) {
  if (row.platform === 'ios') return [row.appStoreFirstRollout, row.appStoreFinal];
  return [row.googleOnePercent, row.googleHundredPercent, row.ruStoreLatest, row.appGalleryLatest];
}

function estimatePointLines(event: RolloutStoreEvent | null) {
  if (!event) return 2;
  const stage = [event.stageLabel, event.stageText].filter(Boolean).join(' · ');
  return 2
    + (event.percent !== null && Number.isFinite(event.percent) ? 1 : 0)
    + (event.store ? 1 : 0)
    + Math.max(1, Math.ceil(stage.length / 26));
}

function rolloutRowHeight(row: RolloutGroup) {
  const maxLines = Math.max(...visiblePointEvents(row).map(estimatePointLines), 4);
  return Math.min(260, Math.max(128, maxLines * 20 + 40));
}

function MatchedPreview({ events }: { events: RolloutStoreEvent[] }) {
  return (
    <div className="rollout-match-list rollout-match-list--preview">
      {events.map(event => (
        <div key={`${event.id}:${event.createdAt}:${event.version}:${event.store}`} className="rollout-match-item">
          <div className="rollout-match-head">
            <span>{event.storeLabel} · {event.version}{event.percent !== null && Number.isFinite(event.percent) ? ` · ${event.percent}%` : ''}{event.finalCompleted ? ' · финал' : ''}</span>
            <span>{formatMskDateTime(event.createdAt)} (МСК)</span>
          </div>
          <div className="rollout-match-text">{event.text}</div>
        </div>
      ))}
    </div>
  );
}

function buildPrintableResultsTable(groups: RolloutGroup[], platformId: RolloutPlatformId) {
  const point = (event: RolloutStoreEvent | null, emphasizeVersion = false, showStoreTag = false) => {
    if (!event) {
      return '<span class="table-empty">Не найдено</span><span class="table-muted">В диапазоне нет подходящего сообщения.</span>';
    }
    const value = emphasizeVersion ? `${escapeHtml(event.version)} · ${escapeHtml(formatMskDate(event.createdAt))}` : escapeHtml(formatMskDate(event.createdAt));
    return `
      ${showStoreTag ? `<span class="store-tag">${escapeHtml(event.storeLabel)}</span>` : ''}
      <div class="table-point">${value}</div>
      <span class="table-muted">${escapeHtml(formatMskDateTime(event.createdAt))} (МСК)</span>
      ${event.percent !== null && Number.isFinite(event.percent) ? `<span class="table-muted">${escapeHtml(event.percent)}%</span>` : ''}
      <span class="table-muted">${escapeHtml(event.stageLabel)}${event.stageText ? ` · ${escapeHtml(event.stageText)}` : ''}</span>
    `;
  };

  if (platformId === 'ios') {
    return `
      <table class="results-table">
        <thead><tr><th>Релиз</th><th>Сообщения</th><th>Версии</th><th>AS старт</th><th>AS финал</th></tr></thead>
        <tbody>
          ${groups.filter((group): group is IosRolloutGroup => group.platform === 'ios').map(group => {
            const versions = Array.from(new Set(group.events.map(event => event.version))).sort(compareRolloutVersionsDesc);
            return `
              <tr>
                <td><div class="table-release">${escapeHtml(group.family)}</div></td>
                <td><span class="mini-chip">${group.events.length} сообщений</span></td>
                <td><div class="table-versions">${escapeHtml(versions.join(', '))}</div></td>
                <td>${point(group.appStoreFirstRollout, false, true)}</td>
                <td>${point(group.appStoreFinal, true, true)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <table class="results-table">
      <thead><tr><th>Релиз</th><th>Сообщения</th><th>Версии</th><th>ПР старт</th><th>ПР 100%</th><th>RuStore</th><th>AppGallery</th></tr></thead>
      <tbody>
        ${groups.filter((group): group is AndroidRolloutGroup => group.platform === 'android').map(group => {
          const versions = Array.from(new Set(group.events.map(event => event.version))).sort(compareRolloutVersionsDesc);
          return `
            <tr>
              <td><div class="table-release">${escapeHtml(group.family)}</div></td>
              <td><span class="mini-chip">${group.events.length} сообщений</span></td>
              <td><div class="table-versions">${escapeHtml(versions.join(', '))}</div></td>
              <td>${point(group.googleOnePercent)}</td>
              <td>${point(group.googleHundredPercent, true)}</td>
              <td>${point(group.ruStoreLatest, true, true)}</td>
              <td>${point(group.appGalleryLatest, true, true)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function buildPrintableHtml(groups: RolloutGroup[], platformId: RolloutPlatformId, releaseFrom: string, releaseTo: string) {
  const platform = ROLLOUT_PLATFORM_CONFIG[platformId];
  const title = buildRolloutExportFilename(platformId, 'pdf', releaseFrom, releaseTo);
  const closeScriptTag = '</' + 'script>';
  const closeBodyTag = '</' + 'body>';
  const closeHtmlTag = '</' + 'html>';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page{ size: landscape; margin: 12mm; }
    body{ font-family: Arial, sans-serif; color:#1f1a2d; margin:0; }
    h1{ margin:0 0 6px; font-size:22px; }
    .results-table{ width:100%; border-collapse:collapse; font-size:10px; }
    .results-table th,.results-table td{ border:1px solid #d8ddea; padding:6px 7px; vertical-align:top; text-align:left; }
    .results-table th{ background:#f2f5fb; font-weight:700; text-transform:uppercase; letter-spacing:.08em; font-size:9px; }
    .results-table tr:nth-child(even) td{ background:#fafcff; }
    .table-release{ font-size:14px; font-weight:800; line-height:1; white-space:nowrap; }
    .mini-chip{ display:inline-block; padding:3px 7px; border:1px solid #d8ddea; border-radius:999px; background:#f8faff; color:#5e5378; font-size:9px; font-weight:700; white-space:nowrap; }
    .table-versions{ color:#5e5378; font-size:10px; line-height:1.45; word-break:break-word; }
    .table-point{ font-size:12px; line-height:1.15; font-weight:800; color:#2c2740; margin-bottom:4px; white-space:nowrap; }
    .table-muted{ display:block; color:#6f6784; font-size:9px; line-height:1.4; margin-top:2px; word-break:break-word; }
    .table-empty{ display:inline-block; color:#9a90b1; font-size:10px; font-weight:700; }
    .store-tag{ display:inline-block; padding:2px 6px; margin-bottom:5px; border-radius:999px; background:#eef4ff; border:1px solid #d5e2ff; color:#4b5f8a; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(platform.label)} rollout report</h1>
  ${buildPrintableResultsTable(groups, platformId)}
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 120);
    });
    window.addEventListener('afterprint', () => {
      setTimeout(() => window.close(), 120);
    });
  ${closeScriptTag}
${closeBodyTag}
${closeHtmlTag}`;
}

export function RolloutReport() {
  const { settings } = useSettings();
  const [platformId, setPlatformId] = useState<RolloutPlatformId>(readActivePlatform);
  const [lookbackDays, setLookbackDays] = useState(readLookbackDays);
  const [releaseFrom, setReleaseFrom] = useState(() => readStorage(LS_RELEASE_FROM));
  const [releaseTo, setReleaseTo] = useState(() => readStorage(LS_RELEASE_TO));
  const [allGroups, setAllGroups] = useState<RolloutGroup[]>([]);
  const [groups, setGroups] = useState<RolloutGroup[]>([]);
  const [events, setEvents] = useState<RolloutStoreEvent[]>([]);
  const [summary, setSummary] = useState<RolloutReportSummary>({ releases: 0, events: 0, start: 0, final: 0, extraA: 0, extraB: 0 });
  const [, setLogs] = useState<Array<{ text: string; level?: RolloutLogLevel }>>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diskUploading, setDiskUploading] = useState(false);
  const [diskUrls, setDiskUrls] = useState<Record<RolloutPlatformId, string | null>>({ android: null, ios: null });
  const [status, setStatus] = useState<StatusState>(() => ({
    proxy: { text: 'Proxy не проверен', mode: 'idle' },
    band: settings.bandCookies ? { text: 'Band cookies из общих настроек', mode: 'ok' } : { text: 'Band cookies не заданы в общих настройках', mode: 'idle' },
    data: { text: 'Данные не загружены', mode: 'idle' },
  }));
  const abortRef = useRef<AbortController | null>(null);

  const platform = ROLLOUT_PLATFORM_CONFIG[platformId];
  const log = useCallback((message: string, level: RolloutLogLevel = 'info') => {
    setLogs(prev => [...prev, { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${message}`, level }]);
  }, []);

  useEffect(() => {
    setStatus(prev => ({
      ...prev,
      band: settings.bandCookies ? { text: 'Band cookies из общих настроек', mode: 'ok' } : { text: 'Band cookies не заданы в общих настройках', mode: 'idle' },
    }));
  }, [settings.bandCookies]);

  useEffect(() => {
    writeStorage(LS_ACTIVE_PLATFORM, platformId);
    setLogs([]);
    setAllGroups([]);
    setGroups([]);
    setEvents([]);
    setSummary({ releases: 0, events: 0, start: 0, final: 0, extraA: 0, extraB: 0 });
    setStatus(prev => ({ ...prev, data: { text: 'Данные не загружены', mode: 'idle' } }));
  }, [platformId]);

  useEffect(() => {
    writeStorage(LS_LOOKBACK_DAYS, lookbackDays);
    writeStorage(LS_RELEASE_FROM, releaseFrom);
    writeStorage(LS_RELEASE_TO, releaseTo);
  }, [lookbackDays, releaseFrom, releaseTo]);

  const applyRangeFilters = useCallback((source = allGroups, updateStatus = true) => {
    const nextGroups = filterRolloutGroupsByRange(source, releaseFrom, releaseTo);
    setGroups(nextGroups);
    setSummary(buildRolloutSummary(nextGroups, events, platformId));
    if (updateStatus) {
      setStatus(prev => ({
        ...prev,
        data: nextGroups.length ? { text: `Готово: ${nextGroups.length} релизов`, mode: 'ok' } : { text: 'Готово, но совпадений нет', mode: 'warn' },
      }));
    }
    return nextGroups;
  }, [allGroups, events, platformId, releaseFrom, releaseTo]);

  useEffect(() => {
    if (!allGroups.length) return;
    try {
      applyRangeFilters(allGroups, true);
      log(`Диапазон обновлён: from=${releaseFrom || '—'}, to=${releaseTo || '—'}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(prev => ({ ...prev, data: { text: message, mode: 'error' } }));
      log(`Ошибка диапазона: ${message}`, 'error');
    }
  }, [allGroups, applyRangeFilters, log, releaseFrom, releaseTo]);

  const loadReport = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setStatus(prev => ({
      ...prev,
      data: { text: 'Идёт загрузка и парсинг', mode: 'warn' },
    }));
    try {
      await waitForNextPaint();
      if (controller.signal.aborted) return;
      const result = await collectRolloutReport({
        settings,
        platform: platformId,
        lookbackDays: Math.max(1, Number(lookbackDays) || ROLLOUT_DEFAULT_LOOKBACK_DAYS),
        releaseFrom,
        releaseTo,
        signal: controller.signal,
        onLog: log,
      });
      setAllGroups(result.allGroups);
      setGroups(result.groups);
      setEvents(result.events);
      setSummary(result.summary);
      setStatus(prev => ({
        proxy: prev.proxy,
        band: { text: `${platform.label} messages прочитаны`, mode: 'ok' },
        data: result.groups.length ? { text: `Готово: ${result.groups.length} релизов`, mode: 'ok' } : { text: 'Готово, но совпадений нет', mode: 'warn' },
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      log(`Ошибка: ${message}`, 'error');
      setStatus(prev => ({
        ...prev,
        band: { text: 'Ошибка чтения Band', mode: 'error' },
        data: { text: message, mode: 'error' },
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [lookbackDays, log, platform.label, platformId, releaseFrom, releaseTo, settings]);

  const checkProxy = useCallback(async () => {
    try {
      const payload = await checkRolloutProxy(settings);
      const detail = payload.host && payload.port ? `${payload.host}:${payload.port}` : settings.proxyBase;
      setStatus(prev => ({ ...prev, proxy: { text: `Proxy OK · ${detail}`, mode: 'ok' } }));
      log(`Proxy OK: ${detail}`, 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(prev => ({ ...prev, proxy: { text: message, mode: 'error' } }));
      log(`Proxy error: ${message}`, 'error');
    }
  }, [log, settings]);

  const exportDataset = useCallback((ext = 'csv') => buildRolloutExportDataset(groups, platformId, releaseFrom, releaseTo, ext), [groups, platformId, releaseFrom, releaseTo]);

  const exportCsv = useCallback(() => {
    const dataset = exportDataset('csv');
    if (!dataset) {
      log('CSV export пропущен: нет данных.', 'warn');
      return;
    }
    const lines = [
      dataset.columns.join(';'),
      ...dataset.values.map(row => row.map(escapeCsvCell).join(';')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    downloadBlob(dataset.filename, blob);
    log(`Экспортирован CSV: ${dataset.filename}`, 'ok');
  }, [exportDataset, log]);

  const exportExcel = useCallback(() => {
    const dataset = exportDataset('xls');
    if (!dataset) {
      log('Excel export пропущен: нет данных.', 'warn');
      return;
    }
    const headerHtml = dataset.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('');
    const bodyHtml = dataset.values.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
    const closeBodyTag = '</' + 'body>';
    const closeHtmlTag = '</' + 'html>';
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <style>
    body{font-family:Arial,sans-serif}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #d9d9d9;padding:8px;vertical-align:top;text-align:left}
    th{background:#f3ecff;font-weight:700}
  </style>
</head>
<body>
  <table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
${closeBodyTag}
${closeHtmlTag}`;
    const blob = new Blob([`\uFEFF${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
    downloadBlob(dataset.filename, blob);
    log(`Экспортирован Excel: ${dataset.filename}`, 'ok');
  }, [exportDataset, log]);

  const exportPdf = useCallback(() => {
    if (!groups.length) {
      log('PDF export пропущен: нет данных.', 'warn');
      return;
    }
    const filename = buildRolloutExportFilename(platformId, 'pdf', releaseFrom, releaseTo);
    const popup = window.open('', '_blank');
    if (!popup) {
      log('PDF export не открыт: браузер заблокировал новое окно.', 'error');
      return;
    }
    popup.document.open();
    popup.document.write(buildPrintableHtml(groups, platformId, releaseFrom, releaseTo));
    popup.document.close();
    log(`Открыт PDF preview: ${filename}. В диалоге печати выбери Save as PDF.`, 'ok');
  }, [groups, log, platformId, releaseFrom, releaseTo]);

  const uploadDisk = useCallback(async () => {
    const dataset = exportDataset('csv');
    if (!dataset) {
      log('Disk export пропущен: нет данных.', 'warn');
      return;
    }
    const controller = new AbortController();
    setDiskUploading(true);
    setStatus(prev => ({ ...prev, data: { text: `Выгружаю в Disk · ${ROLLOUT_DISK_SHEET_NAMES[platformId]}`, mode: 'warn' } }));
    try {
      log(`Старт выгрузки в Disk: platform=${platform.label}, sheet=${ROLLOUT_DISK_SHEET_NAMES[platformId]}, rows=${dataset.values.length}.`);
      const response = await uploadRolloutDatasetToDisk(
        settings,
        platformId,
        dataset,
        {
          releaseFrom,
          releaseTo,
          lookbackDays: Math.max(1, Number(lookbackDays) || ROLLOUT_DEFAULT_LOOKBACK_DAYS),
        },
        controller.signal,
      ) as { ok?: boolean; error?: string; message?: string; details?: string; rowsWritten?: number; sheetUrl?: string; spreadsheetUrl?: string };
      if (!response || response.ok !== true) {
        throw new Error(response?.error || response?.message || response?.details || 'Пустой/невалидный ответ Apps Script');
      }
      const sheetUrl = response.sheetUrl || response.spreadsheetUrl || ROLLOUT_DISK_SPREADSHEET_URL;
      setDiskUrls(prev => ({ ...prev, [platformId]: sheetUrl }));
      log(`Disk OK: sheet=${ROLLOUT_DISK_SHEET_NAMES[platformId]}, rows=${response.rowsWritten || dataset.values.length}.`, 'ok');
      setStatus(prev => ({ ...prev, data: { text: `Выгружено в Disk · ${ROLLOUT_DISK_SHEET_NAMES[platformId]}`, mode: 'ok' } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Disk error: ${message}`, 'error');
      setStatus(prev => ({ ...prev, data: { text: message, mode: 'error' } }));
    } finally {
      setDiskUploading(false);
    }
  }, [exportDataset, log, lookbackDays, platform.label, platformId, releaseFrom, releaseTo, settings]);

  const openDisk = useCallback(() => {
    window.open(diskUrls[platformId] || ROLLOUT_DISK_SPREADSHEET_URL, '_blank', 'noopener');
  }, [diskUrls, platformId]);

  const hasData = groups.length > 0;
  const exportDisabled = loading || diskUploading || !hasData;
  const summaryLabels = platformId === 'android'
    ? {
        start: 'ПР старт',
        final: 'ПР 100%',
        extraA: 'RuStore',
        extraB: 'AppGallery',
        startHint: 'Сколько релизов имеют первое найденное процентное событие раскатки.',
        finalHint: 'Сколько релизов дошли до 100% хотя бы одной версией семейства.',
        extraAHint: 'Сколько релизов имеют найденную версию или событие в RuStore.',
        extraBHint: 'Сколько релизов имеют найденную версию или событие в AppGallery.',
      }
    : {
        start: 'AS старт',
        final: 'AS финал',
        extraA: 'AS события',
        extraB: 'Финал сообщения',
        startHint: 'Сколько iOS релизов имеют первое процентное событие раскатки.',
        finalHint: 'Сколько iOS релизов имеют финальное сообщение о завершении раскатки.',
        extraAHint: 'Сколько release-family имеют хотя бы одно событие в AppStore.',
        extraBHint: 'Сколько финальных сообщений вида «Раскатка в AppStore завершена» найдено.',
      };
  const timingHeaderStyle = useMemo<React.CSSProperties>(() => ({ background: 'rgba(155, 92, 255, .06)' }), []);
  const storeHeaderStyle = useMemo<React.CSSProperties>(() => ({ background: 'rgba(59, 130, 246, .06)' }), []);
  const rolloutColumns = useMemo<Array<CanonicalTableColumn<RolloutGroup>>>(() => {
    const common: Array<CanonicalTableColumn<RolloutGroup>> = [
      {
        id: 'release',
        group: 'Релиз',
        title: 'Релиз',
        width: 112,
        sticky: 'left',
        align: 'center',
        previewTitle: () => 'Релиз',
        text: row => row.family,
        lineClamp: 8,
        headerStyle: { paddingLeft: 4, paddingRight: 4 },
        cellStyle: { paddingLeft: 6, paddingRight: 6 },
        render: row => (
          <div className="rollout-canonical-release">
            <span>{row.family}</span>
            <small>{row.events.length} сообщений</small>
          </div>
        ),
      },
      {
        id: 'messages',
        group: 'Релиз',
        title: 'Сообщения',
        width: 122,
        align: 'center',
        text: row => String(row.events.length),
        lineClamp: 8,
        render: row => <span className="rollout-mini-chip">{row.events.length} сообщений</span>,
      },
      {
        id: 'versions',
        group: 'Релиз',
        title: 'Версии',
        width: 190,
        text: versionsText,
        previewTitle: () => 'Версии',
        lineClamp: 12,
      },
    ];

    if (platformId === 'ios') {
      return [
        ...common,
        {
          id: 'appStoreStart',
          group: 'Тайминги',
          title: 'AS старт',
          width: 190,
          text: row => row.platform === 'ios' ? eventText(row.appStoreFirstRollout) : '-',
          render: row => <PointCell event={row.platform === 'ios' ? row.appStoreFirstRollout : null} showStoreTag />,
          preview: row => row.platform === 'ios' && row.appStoreFirstRollout ? <PointCell event={row.appStoreFirstRollout} showStoreTag /> : null,
          headerStyle: timingHeaderStyle,
          lineClamp: 12,
        },
        {
          id: 'appStoreFinal',
          group: 'Тайминги',
          title: 'AS финал',
          width: 210,
          text: row => row.platform === 'ios' ? eventText(row.appStoreFinal) : '-',
          render: row => <PointCell event={row.platform === 'ios' ? row.appStoreFinal : null} emphasizeVersion showStoreTag />,
          preview: row => row.platform === 'ios' && row.appStoreFinal ? <PointCell event={row.appStoreFinal} emphasizeVersion showStoreTag /> : null,
          headerStyle: timingHeaderStyle,
          lineClamp: 12,
        },
        {
          id: 'matched',
          group: 'Matched',
          title: 'Matched',
          width: 138,
          align: 'center',
          text: row => row.events.map(eventText).join('\n'),
          render: row => <span className="rollout-mini-chip">Показать {row.events.length}</span>,
          preview: row => <MatchedPreview events={row.events} />,
          previewTitle: row => `${row.family} · matched`,
          previewTrigger: 'button',
          lineClamp: 8,
          showOverflowMarker: false,
        },
      ];
    }

    return [
      ...common,
      {
        id: 'googleStart',
        group: 'Google Play',
        title: 'ПР старт',
        width: 190,
        text: row => row.platform === 'android' ? eventText(row.googleOnePercent) : '-',
        render: row => <PointCell event={row.platform === 'android' ? row.googleOnePercent : null} />,
        preview: row => row.platform === 'android' && row.googleOnePercent ? <PointCell event={row.googleOnePercent} /> : null,
        headerStyle: timingHeaderStyle,
        lineClamp: 12,
      },
      {
        id: 'googleFinal',
        group: 'Google Play',
        title: 'ПР 100%',
        width: 210,
        text: row => row.platform === 'android' ? eventText(row.googleHundredPercent) : '-',
        render: row => <PointCell event={row.platform === 'android' ? row.googleHundredPercent : null} emphasizeVersion />,
        preview: row => row.platform === 'android' && row.googleHundredPercent ? <PointCell event={row.googleHundredPercent} emphasizeVersion /> : null,
        headerStyle: timingHeaderStyle,
        lineClamp: 12,
      },
      {
        id: 'ruStore',
        group: 'Доп. stores',
        title: 'RuStore',
        width: 210,
        text: row => row.platform === 'android' ? eventText(row.ruStoreLatest) : '-',
        render: row => <PointCell event={row.platform === 'android' ? row.ruStoreLatest : null} emphasizeVersion showStoreTag />,
        preview: row => row.platform === 'android' && row.ruStoreLatest ? <PointCell event={row.ruStoreLatest} emphasizeVersion showStoreTag /> : null,
        headerStyle: storeHeaderStyle,
        lineClamp: 12,
      },
      {
        id: 'appGallery',
        group: 'Доп. stores',
        title: 'AppGallery',
        width: 220,
        text: row => row.platform === 'android' ? eventText(row.appGalleryLatest) : '-',
        render: row => <PointCell event={row.platform === 'android' ? row.appGalleryLatest : null} emphasizeVersion showStoreTag />,
        preview: row => row.platform === 'android' && row.appGalleryLatest ? <PointCell event={row.appGalleryLatest} emphasizeVersion showStoreTag /> : null,
        headerStyle: storeHeaderStyle,
        lineClamp: 12,
      },
      {
        id: 'matched',
        group: 'Matched',
        title: 'Matched',
        width: 138,
        align: 'center',
        text: row => row.events.map(eventText).join('\n'),
        render: row => <span className="rollout-mini-chip">Показать {row.events.length}</span>,
        preview: row => <MatchedPreview events={row.events} />,
        previewTitle: row => `${row.family} · matched`,
        previewTrigger: 'button',
        lineClamp: 8,
        showOverflowMarker: false,
      },
    ];
  }, [platformId, storeHeaderStyle, timingHeaderStyle]);
  const rolloutTableMinWidth = useMemo(() => (
    rolloutColumns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 140), 0)
  ), [rolloutColumns]);

  return (
    <div className="rollout-page">
      <div className="rollout-platform-tabs">
        <SegmentControl
          value={platformId}
          onChange={value => setPlatformId(value === 'ios' ? 'ios' : 'android')}
          items={[
            { value: 'android', label: 'Android' },
            { value: 'ios', label: 'iOS' },
          ]}
        />
      </div>

      <section className="rollout-hero">
        <div className="rollout-hero__copy">
          <div className="rollout-eyebrow">Band Release Queries</div>
          <h1>{platform.heroTitle}</h1>
          <p>{platform.heroDescription}</p>
          <div className="rollout-hero-controls">
            <div className="rollout-release-grid">
              <div className="rollout-field">
                <FieldLabel>С релиза</FieldLabel>
                <Input value={releaseFrom} onChange={event => setReleaseFrom(event.target.value)} placeholder="например 7.5 или 7.5.6000" />
              </div>
              <div className="rollout-field">
                <FieldLabel>По релиз</FieldLabel>
                <Input value={releaseTo} onChange={event => setReleaseTo(event.target.value)} placeholder="например 7.5 или 7.5.6990" />
              </div>
              <div className="rollout-field">
                <FieldLabel>Глубина, дней</FieldLabel>
                <Input type="number" min={1} step={1} value={lookbackDays} onChange={event => setLookbackDays(event.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="rollout-hero__actions">
          <div>
            <div className="rollout-section-title">Действия</div>
            <p>{platform.sourceSubtitle}</p>
          </div>
          <div className="rollout-actions">
            <Button
              variant="primary"
              onClick={loadReport}
              disabled={loading}
              aria-busy={loading}
              style={loading ? { opacity: .78, cursor: 'wait' } : undefined}
            >
              {loading && <span className="rollout-loader-dot" aria-hidden="true" />}
              {loading ? 'Загружаю релизы...' : 'Загрузить релизы'}
            </Button>
            <Button onClick={() => setSettingsOpen(true)}>Как работает</Button>
            <a className="rollout-link-btn" href={platform.channelUrl} target="_blank" rel="noopener noreferrer">{platform.openLinkLabel}</a>
          </div>
        </div>
      </section>

      <div className="rollout-status-row">
        <StatusPill {...status.proxy} />
        <StatusPill {...status.band} />
        <StatusPill {...status.data} />
      </div>

      {loading && (
        <div className="rollout-loading-strip" role="status" aria-live="polite">
          <span className="rollout-loader-dot" aria-hidden="true" />
          <div>
            <strong>Идёт загрузка релизов</strong>
            <span>Читаю Band, группирую сообщения по release-family и применяю фильтр диапазона.</span>
          </div>
        </div>
      )}

      <section className="rollout-summary">
        <SummaryCard label="Релизы" value={summary.releases} hint="Сколько release-семейств найдено по выбранному диапазону." />
        <SummaryCard label="События" value={summary.events} hint="Сколько сообщений удалось распарсить." />
        <SummaryCard label={summaryLabels.start} value={summary.start} hint={summaryLabels.startHint} />
        <SummaryCard label={summaryLabels.final} value={summary.final} hint={summaryLabels.finalHint} />
        <SummaryCard label={summaryLabels.extraA} value={summary.extraA} hint={summaryLabels.extraAHint} />
        <SummaryCard label={summaryLabels.extraB} value={summary.extraB} hint={summaryLabels.extraBHint} />
      </section>

      <section className="rollout-layout">
        <Card className="rollout-results-panel">
          <div className="rollout-results-head">
            <div>
              <h2>{platform.resultsTitle}</h2>
              <p>{platform.resultsSubtitle}</p>
            </div>
            <div className="rollout-results-actions">
              <Button size="sm" onClick={exportCsv} disabled={exportDisabled}>CSV</Button>
              <Button size="sm" onClick={exportExcel} disabled={exportDisabled}>Excel</Button>
              <Button size="sm" onClick={exportPdf} disabled={exportDisabled}>PDF</Button>
              <span className="rollout-mini-chip">{groups.length} строк</span>
              <Button size="sm" onClick={uploadDisk} disabled={exportDisabled}>{diskUploading ? 'Выгружаю...' : 'Выгрузить в Disk'}</Button>
              <Button size="sm" onClick={openDisk}>Открыть Disk</Button>
            </div>
          </div>

          <div className="rollout-release-list">
            {!hasData ? (
              <EmptyResults />
            ) : (
              <CanonicalTable
                rows={groups}
                columns={rolloutColumns}
                getRowKey={row => `${row.platform}:${row.family}`}
                rowHeight={rolloutRowHeight}
                maxHeight="72vh"
                minWidth={rolloutTableMinWidth}
                overscanRight={18}
                loading={loading}
                loadingText="Загружаю релизы..."
                emptyText="Ничего не найдено. Проверь Band cookies, proxy и диапазон поиска."
                columnResizeStorageKey={`${COLUMN_WIDTHS_STORAGE_KEY}:${platformId}`}
              />
            )}
          </div>
        </Card>
      </section>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Как работает Rollout Report" width={840}>
        <div className="rollout-settings-logic">
          <div className="rollout-channel-meta">
            Band cookies и proxy берутся из общих настроек платформы. Этот микрофронт не хранит отдельные cookies, чтобы логика совпадала с остальными сервисами.
          </div>
          <div className="rollout-settings-head">
            <strong>{platform.rulesTitle}</strong>
            <p>{platform.rulesIntro}</p>
          </div>
          <div className="rollout-logic-facts">
            {platform.heroFacts.map(item => (
              <div key={item.label} className="rollout-hero-fact">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="rollout-hint-box">
            <strong>Правила обработки</strong>
            <ul>
              {platform.rules.map(rule => <li key={rule}>{rule}</li>)}
            </ul>
          </div>
        </div>

        <div className="rollout-actions">
          <Button onClick={checkProxy} disabled={loading}>Проверить proxy</Button>
          <a className="rollout-link-btn" href={platform.channelUrl} target="_blank" rel="noopener noreferrer">{platform.openLinkLabel}</a>
        </div>
      </Modal>
    </div>
  );
}
