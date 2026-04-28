import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CanonicalTable,
  ColumnFilterDropdown,
  type CanonicalTableColumn,
  FieldLabel,
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
const SHOW_RELEASE_ANALYSIS_FLOATING_LOGS = true;
const MAJOR_RELEASE_STORAGE_KEY = 'rp_release_quarter_major_release';

interface ReleaseQuarterAnalysisProps {
  role?: Role;
}

type ColumnFilterKey = 'version' | 'stream' | 'substream';
type ColumnFilters = Record<ColumnFilterKey, string[]>;

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

function issueCell(issue: QuarterAnalysisRow['primaryTask']) {
  if (!issue) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
      <a href={issue.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--mono)' }}>
        {issue.key}
      </a>
      <span style={{ color: 'var(--text-2)' }}>{issue.summary || '-'}</span>
      {issue.locomotive.any.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{issue.locomotive.any.join(', ')}</span>
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
  if (!row.secondaryTasks.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {row.secondaryTasks.map(issue => <div key={issue.key}>{issueCell(issue)}</div>)}
    </div>
  );
}

function secondaryTasksCell(row: QuarterAnalysisRow) {
  if (!row.secondaryTasks.length) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  return (
    <span style={{ whiteSpace: 'normal' }}>
      {row.secondaryTasks.map((issue, index) => (
        <React.Fragment key={issue.key}>
          {index > 0 && <><br /><br /></>}
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--mono)' }}
          >
            {issue.key}
          </a>
          {issue.summary ? ` ${issue.summary}` : ''}
        </React.Fragment>
      ))}
    </span>
  );
}

function taskCount(row: QuarterAnalysisRow) {
  return row.secondaryTasks.length + (row.primaryTask ? 1 : 0);
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
  return { month, year };
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

export function ReleaseQuarterAnalysis({ role = 'viewer' }: ReleaseQuarterAnalysisProps) {
  const { settings } = useSettings();
  const canSaveRows = role !== 'viewer';
  const [releaseFrom, setReleaseFrom] = useState(() => readStoredRelease(MAJOR_RELEASE_STORAGE_KEY, '7.5.6000'));
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [rows, setRows] = useState<QuarterAnalysisRow[]>([]);
  const [pendingRows, setPendingRows] = useState<QuarterAnalysisRow[]>([]);
  const [freshRowKeys, setFreshRowKeys] = useState<Set<string>>(() => new Set());
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(() => emptyColumnFilters());
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

  const log = useCallback((message: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-249), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${message}`, level }]);
  }, []);

  const updateRelease = useCallback((value: string) => {
    setReleaseFrom(value);
    setPendingRows([]);
    setFreshRowKeys(new Set());
    setColumnFilters(emptyColumnFilters());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MAJOR_RELEASE_STORAGE_KEY, releaseFrom.trim());
    } catch {
      /* ignore */
    }
  }, [releaseFrom]);

  useEffect(() => {
    let alive = true;
    setLoadingSaved(true);
    loadQuarterAnalysisRows()
      .then(savedRows => {
        if (!alive) return;
        setRows(savedRows);
        setYear('all');
        setMonth('all');
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
    if (month === 'all') return true;
    return branchCutDate?.month === Number(month);
  }), [month, platform, rows, year]);

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

  const availableYears = useMemo(() => {
    const set = new Set(rows
      .filter(row => row.platform === platform)
      .map(row => branchCutDateParts(row)?.year)
      .filter((value): value is number => value != null));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, rows]);

  const availableMonths = useMemo(() => {
    const set = new Set(rows
      .filter(row => {
        if (row.platform !== platform) return false;
        const branchCutDate = branchCutDateParts(row);
        return branchCutDate != null && (year === 'all' || branchCutDate.year === Number(year));
      })
      .map(row => branchCutDateParts(row)?.month)
      .filter((value): value is number => value != null));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, rows, year]);

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
      const result = await collectQuarterReleaseAnalysis(
        { settings, signal: controller.signal, onLog: log, onProgress: setProgress },
        releaseFrom
      );
      setRows(prev => mergeCollectedRowsTop(result, prev));
      setPendingRows(result);
      setFreshRowKeys(new Set(result.map(quarterRowKey)));
      setColumnFilters(emptyColumnFilters());
      setYear('all');
      setMonth('all');
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
  }, [log, releaseFrom, settings]);

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
      const result = await saveQuarterAnalysisRows(pendingRows, releaseFrom, releaseFrom);
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
  }, [canSaveRows, log, pendingRows, releaseFrom, saving]);

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
  const csvRangeLabel = `${releaseFrom || 'release'}`.replace(/\s+/g, '');
  const showRunStatus = Boolean(status) || progress > 0 || busy || saving;
  const timingHeaderStyle = useMemo<React.CSSProperties>(() => ({ whiteSpace: 'nowrap' }), []);
  const filterSegmentStyle = useMemo<React.CSSProperties>(() => ({ height: 32, padding: 2, alignItems: 'center' }), []);
  const filterButtonStyle = useMemo<React.CSSProperties>(() => ({
    height: 26,
    minHeight: 26,
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }), []);
  const visibleTaskCount = useMemo(() => visibleRows.reduce((sum, row) => sum + taskCount(row), 0), [visibleRows]);
  const tableColumns = useMemo<Array<CanonicalTableColumn<QuarterAnalysisRow>>>(() => [
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
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.version}</span>
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
      lineClamp: 3,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Анализ релизов за квартал</div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 360px) 1fr', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Релиз:</FieldLabel>
              <Input value={releaseFrom} onChange={event => updateRelease(event.target.value)} placeholder="7.5.6000" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busy ? (
                <Button variant="danger" onClick={stop}>Остановить</Button>
              ) : (
                <Button variant="primary" disabled={loadingSaved || pendingRows.length > 0} onClick={() => void run()}>Собрать</Button>
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

      <Card>
        <CardBody style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px' }}>
          <SegmentControl
            items={[{ label: 'Android', value: 'android' }, { label: 'iOS', value: 'ios' }]}
            value={platform}
            onChange={value => { setPlatform(value as PlatformKey); setYear('all'); setMonth('all'); }}
            style={filterSegmentStyle}
            buttonStyle={filterButtonStyle}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', maxWidth: '100%', flexWrap: 'wrap' }}>
            <Badge color={visibleTaskCount ? 'purple' : 'gray'} style={{ height: 32, padding: '0 10px', fontSize: 12, fontWeight: 700 }}>
              Задач: {visibleTaskCount}
            </Badge>
            <SegmentControl
              items={[{ label: 'Все', value: 'all' }, ...availableMonths.map(index => ({ label: MONTHS[index], value: String(index) }))]}
              value={month}
              onChange={setMonth}
              style={filterSegmentStyle}
              buttonStyle={filterButtonStyle}
            />
            <div aria-hidden="true" style={{ width: 1, height: 28, background: 'var(--border-hi)', margin: '0 2px' }} />
            <SegmentControl
              items={[{ label: 'Все', value: 'all' }, ...availableYears.map(item => ({ label: String(item), value: String(item) }))]}
              value={year}
              onChange={value => { setYear(value); setMonth('all'); }}
              style={filterSegmentStyle}
              buttonStyle={filterButtonStyle}
            />
          </div>
        </CardBody>
        <CanonicalTable
          rows={visibleRows}
          columns={tableColumns}
          getRowKey={quarterRowKey}
          isRowHighlighted={row => freshRowKeys.has(quarterRowKey(row))}
          rowHeight={74}
          maxHeight="72vh"
          minWidth={2751}
          overscanRight={18}
          loading={loadingSaved}
          loadingText="Загружаю сохраненные релизы..."
          emptyText="Данных по выбранному фильтру нет."
        />
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
