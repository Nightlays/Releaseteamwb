import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CanonicalTable,
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
const MAJOR_RELEASE_TO_STORAGE_KEY = 'rp_release_quarter_major_release_to';

interface ReleaseQuarterAnalysisProps {
  role?: Role;
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

function versionText(row: QuarterAnalysisRow) {
  return `${row.version}\nЗадач: ${taskCount(row)}`;
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

export function ReleaseQuarterAnalysis({ role = 'viewer' }: ReleaseQuarterAnalysisProps) {
  const { settings } = useSettings();
  const canSaveRows = role !== 'viewer';
  const [releaseFrom, setReleaseFrom] = useState(() => readStoredRelease(MAJOR_RELEASE_STORAGE_KEY, '7.5.6000'));
  const [releaseTo, setReleaseTo] = useState(() => readStoredRelease(MAJOR_RELEASE_TO_STORAGE_KEY, readStoredRelease(MAJOR_RELEASE_STORAGE_KEY, '7.5.6000')));
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [rows, setRows] = useState<QuarterAnalysisRow[]>([]);
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

  useEffect(() => {
    try {
      localStorage.setItem(MAJOR_RELEASE_STORAGE_KEY, releaseFrom.trim());
    } catch {
      /* ignore */
    }
  }, [releaseFrom]);

  useEffect(() => {
    try {
      localStorage.setItem(MAJOR_RELEASE_TO_STORAGE_KEY, releaseTo.trim());
    } catch {
      /* ignore */
    }
  }, [releaseTo]);

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

  const visibleRows = useMemo(() => rows.filter(row => {
    if (row.platform !== platform) return false;
    const branchCutDate = branchCutDateParts(row);
    if (year !== 'all' && branchCutDate?.year !== Number(year)) return false;
    if (month === 'all') return true;
    return branchCutDate?.month === Number(month);
  }), [month, platform, rows, year]);

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
    setRows([]);
    setLogs([]);
    setProgress(0);
    setStatus('Собираю хотфиксы и задачи...');
    setStatusTone('neutral');
    try {
      const result = await collectQuarterReleaseAnalysis(
        { settings, signal: controller.signal, onLog: log, onProgress: setProgress },
        releaseFrom,
        releaseTo || releaseFrom
      );
      setRows(result);
      setYear('all');
      setMonth('all');
      setStatus(`Готово: ${result.length} строк.`);
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
  }, [log, releaseFrom, releaseTo, settings]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus('Сбор остановлен.');
    setStatusTone('warn');
  }, []);

  const saveRows = useCallback(async () => {
    if (!canSaveRows || !rows.length || saving) return;
    setSaving(true);
    setStatus('Записываю найденные релизы в Supabase...');
    setStatusTone('neutral');
    try {
      const result = await saveQuarterAnalysisRows(rows, releaseFrom, releaseTo || releaseFrom);
      setStatus(`Записано в БД: Android ${result.android}, iOS ${result.ios}.`);
      setStatusTone(result.total ? 'ok' : 'warn');
      log(`Supabase: записано Android ${result.android}, iOS ${result.ios}`, result.total ? 'ok' : 'warn');
    } catch (error) {
      const message = (error as Error).message || 'Не удалось записать данные в Supabase.';
      setStatus(message);
      setStatusTone('error');
      log(message, 'error');
    } finally {
      setSaving(false);
    }
  }, [canSaveRows, log, releaseFrom, releaseTo, rows, saving]);

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
  const csvRangeLabel = `${releaseFrom || 'start'}_${releaseTo || releaseFrom || 'end'}`.replace(/\s+/g, '');
  const showRunStatus = Boolean(status) || progress > 0 || busy || saving;
  const timingHeaderStyle = useMemo<React.CSSProperties>(() => ({ whiteSpace: 'nowrap' }), []);
  const tableColumns = useMemo<Array<CanonicalTableColumn<QuarterAnalysisRow>>>(() => [
    {
      id: 'version',
      group: 'Задачи',
      title: 'Версия',
      width: 76,
      sticky: 'left',
      align: 'center',
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
    { id: 'stream', group: 'Задачи', title: 'Стрим', width: 140, text: row => dash(row.stream), lineClamp: 3 },
    { id: 'substream', group: 'Задачи', title: 'Сабстрим', width: 150, text: row => dash(row.substream), lineClamp: 3 },
    {
      id: 'primaryTask',
      group: 'Задачи',
      title: 'Локомотивная задача',
      width: 300,
      render: row => issueCell(row.primaryTask),
      preview: row => row.primaryTask ? issueCell(row.primaryTask) : null,
      text: row => issueText(row.primaryTask),
      lineClamp: 3,
    },
    {
      id: 'secondaryTasks',
      group: 'Задачи',
      title: 'Вторичные задачи',
      width: 340,
      render: secondaryTasksCell,
      text: secondaryTasksText,
      preview: secondaryTasksPreview,
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
  ], [timingHeaderStyle]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Анализ релизов за квартал</div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Параметры</CardTitle>
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Релиз с</FieldLabel>
              <Input value={releaseFrom} onChange={event => setReleaseFrom(event.target.value)} placeholder="7.5.6000" />
            </div>
            <div>
              <FieldLabel>Релиз по</FieldLabel>
              <Input value={releaseTo} onChange={event => setReleaseTo(event.target.value)} placeholder={releaseFrom || '7.5.6000'} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busy ? <Button variant="danger" onClick={stop}>Остановить</Button> : <Button variant="primary" disabled={loadingSaved} onClick={() => void run()}>Собрать</Button>}
              {canSaveRows && (
                <Button
                  variant="secondary"
                  disabled={!rows.length || busy || saving || loadingSaved}
                  onClick={() => void saveRows()}
                  style={{
                    borderColor: rows.length ? 'rgba(34,197,94,.32)' : undefined,
                    color: rows.length ? '#4ADE80' : undefined,
                  }}
                >
                  {saving ? 'Записываю...' : 'Записать'}
                </Button>
              )}
              <Button variant="secondary" disabled={!visibleRows.length || loadingSaved} onClick={() => exportCsv(visibleRows, platform, csvRangeLabel)}>CSV</Button>
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
        <CardHeader>
          <div>
            <CardTitle>Таблица</CardTitle>
          </div>
          <Badge color={visibleRows.length ? 'purple' : 'gray'}>{visibleRows.length}</Badge>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <SegmentControl
              items={[{ label: 'Android', value: 'android' }, { label: 'iOS', value: 'ios' }]}
              value={platform}
              onChange={value => { setPlatform(value as PlatformKey); setYear('all'); setMonth('all'); }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 'auto', maxWidth: '100%' }}>
              <SegmentControl
                items={[{ label: 'Все', value: 'all' }, ...availableYears.map(item => ({ label: String(item), value: String(item) }))]}
                value={year}
                onChange={value => { setYear(value); setMonth('all'); }}
              />
              <SegmentControl
                items={[{ label: 'Все', value: 'all' }, ...availableMonths.map(index => ({ label: MONTHS[index], value: String(index) }))]}
                value={month}
                onChange={setMonth}
              />
            </div>
          </div>
        </CardBody>
        <CanonicalTable
          rows={visibleRows}
          columns={tableColumns}
          getRowKey={row => `${row.platform}:${row.version}`}
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
