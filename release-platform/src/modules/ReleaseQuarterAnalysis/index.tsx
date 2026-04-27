import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardHint,
  CardTitle,
  CanonicalTable,
  type CanonicalTableColumn,
  FieldLabel,
  Input,
  LogView,
  Progress,
  SegmentControl,
  Select,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import {
  collectQuarterReleaseAnalysis,
  platformLabel,
  type LogLevel,
  type PlatformKey,
  type QuarterAnalysisRow,
} from '../../services/releasePages';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const SHOW_RELEASE_ANALYSIS_FLOATING_LOGS = true;

function nowYear() {
  return new Date().getFullYear();
}

function dash(value: unknown) {
  const text = String(value || '').trim();
  return text || '-';
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

function taskCount(row: QuarterAnalysisRow) {
  return row.secondaryTasks.length + (row.primaryTask ? 1 : 0);
}

function versionText(row: QuarterAnalysisRow) {
  return `${row.version}\nЗадач: ${taskCount(row)}`;
}

function exportCsv(rows: QuarterAnalysisRow[], platform: PlatformKey, year: number) {
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
    'Когда попали на проверку',
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
    row.enteredReviewTime,
    row.onePercentDate,
    row.hotfixReason,
    row.hotfixDetails,
  ])];
  const csv = lines.map(line => line.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `release-quarter-${platform}-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReleaseQuarterAnalysis() {
  const { settings } = useSettings();
  const [release, setRelease] = useState('7.5.6000');
  const [year, setYear] = useState(String(nowYear()));
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [month, setMonth] = useState('all');
  const [rows, setRows] = useState<QuarterAnalysisRow[]>([]);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [status, setStatus] = useState('Укажи мажорный релиз и запусти сбор.');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ok' | 'warn' | 'error'>('neutral');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [logPanelSize, setLogPanelSize] = useState({ width: 430, height: 330 });
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((message: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-249), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${message}`, level }]);
  }, []);

  const visibleRows = useMemo(() => rows.filter(row => {
    if (row.platform !== platform) return false;
    if (month === 'all') return true;
    return row.month === Number(month);
  }), [month, platform, rows]);

  const availableMonths = useMemo(() => {
    const set = new Set(rows.filter(row => row.platform === platform && row.month != null).map(row => row.month as number));
    return Array.from(set).sort((a, b) => a - b);
  }, [platform, rows]);

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
        release,
        Number(year)
      );
      setRows(result);
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
  }, [log, release, settings, year]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus('Сбор остановлен.');
    setStatusTone('warn');
  }, []);

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

  const years = useMemo(() => Array.from({ length: 6 }, (_, index) => nowYear() + 1 - index), []);
  const platformRows = rows.filter(row => row.platform === platform);
  const missingHotfixInfoCount = visibleRows.reduce((count, row) => (
    count
      + (!String(row.hotfixReason || '').trim() || row.hotfixReason === '-' ? 1 : 0)
      + (!String(row.hotfixDetails || '').trim() || row.hotfixDetails === '-' ? 1 : 0)
  ), 0);
  const progressColor = statusTone === 'ok' ? 'green' : statusTone === 'warn' ? 'yellow' : statusTone === 'error' ? 'red' : 'accent';
  const tableColumns = useMemo<Array<CanonicalTableColumn<QuarterAnalysisRow>>>(() => [
    {
      id: 'version',
      group: 'Задачи',
      title: 'Версия',
      width: 150,
      text: versionText,
      lineClamp: 3,
      render: row => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: 'var(--text)' }}>{row.version}</span>
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
      render: row => row.secondaryTasks.length
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{row.secondaryTasks.map(issue => <div key={issue.key}>{issueCell(issue)}</div>)}</div>
        : '-',
      text: secondaryTasksText,
      preview: secondaryTasksPreview,
      lineClamp: 3,
    },
    { id: 'buildTime', group: 'Тайминги', title: 'Время сборки', width: 150, text: row => dash(row.buildTime), lineClamp: 2 },
    { id: 'previousRolloutPercent', group: 'Тайминги', title: '% раскатки предыдущей версии', width: 220, text: row => dash(row.previousRolloutPercent), lineClamp: 2 },
    { id: 'plannedHotfixDate', group: 'Тайминги', title: 'Плановая дата отправки хф', width: 190, text: row => dash(row.plannedHotfixDate), lineClamp: 2 },
    { id: 'branchCutTime', group: 'Тайминги', title: 'Время отведения хотфикса', width: 180, text: row => dash(row.branchCutTime), lineClamp: 2 },
    { id: 'actualSendTime', group: 'Тайминги', title: 'Фактическая дата отправки', width: 170, text: row => dash(row.actualSendTime), lineClamp: 2 },
    { id: 'enteredReviewTime', group: 'Тайминги', title: 'Когда попали на проверку', width: 170, text: row => dash(row.enteredReviewTime), lineClamp: 2 },
    { id: 'onePercentDate', group: 'Тайминги', title: 'Дата раскатки на 1%', width: 165, text: row => dash(row.onePercentDate), lineClamp: 2 },
    { id: 'hotfixReason', group: 'Хотфикс', title: 'Причина хф', width: 260, text: row => dash(row.hotfixReason), lineClamp: 3 },
    { id: 'hotfixDetails', group: 'Хотфикс', title: 'Детали хф', width: 340, text: row => dash(row.hotfixDetails), lineClamp: 3 },
  ], []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Анализ релизов за квартал</div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Параметры</CardTitle>
            <CardHint>Токены DeployLab, YouTrack, GitLab, Band и proxy берутся из общих настроек платформы.</CardHint>
          </div>
          <Badge color={busy ? 'purple' : rows.length ? 'green' : 'gray'}>{busy ? 'Сбор...' : rows.length ? 'Данные есть' : 'Ожидаю'}</Badge>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Год</FieldLabel>
              <Select value={year} onChange={event => setYear(event.target.value)}>
                {years.map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Мажорный релиз</FieldLabel>
              <Input value={release} onChange={event => setRelease(event.target.value)} placeholder="7.5.6000" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busy ? <Button variant="danger" onClick={stop}>Остановить</Button> : <Button variant="primary" onClick={() => void run()}>Собрать</Button>}
              <Button variant="secondary" disabled={!visibleRows.length} onClick={() => exportCsv(visibleRows, platform, Number(year))}>CSV</Button>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: statusTone === 'error' ? '#F87171' : statusTone === 'warn' ? '#FCD34D' : statusTone === 'ok' ? '#4ADE80' : 'var(--text-2)' }}>{status}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{progress}%</span>
            </div>
            <Progress value={progress} color={progressColor} height={7} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Таблица</CardTitle>
            <CardHint>Платформа, месяц и строки хотфиксов по выбранному году.</CardHint>
          </div>
          <Badge color={visibleRows.length ? 'purple' : 'gray'}>{visibleRows.length}</Badge>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <SegmentControl
              items={[{ label: 'Android', value: 'android' }, { label: 'iOS', value: 'ios' }]}
              value={platform}
              onChange={value => { setPlatform(value as PlatformKey); setMonth('all'); }}
            />
            <SegmentControl
              items={[{ label: 'Все', value: 'all' }, ...availableMonths.map(index => ({ label: MONTHS[index], value: String(index) }))]}
              value={month}
              onChange={setMonth}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Badge color="gray">Всего {platformLabel(platform)}: {platformRows.length}</Badge>
            <Badge color="gray">С задачами: {visibleRows.filter(row => row.primaryTask).length}</Badge>
            <Badge color={missingHotfixInfoCount ? 'yellow' : 'green'}>Не найдено: {missingHotfixInfoCount}</Badge>
          </div>
        </CardBody>
        <CanonicalTable
          rows={visibleRows}
          columns={tableColumns}
          getRowKey={row => `${row.platform}:${row.version}`}
          rowHeight={74}
          maxHeight="72vh"
          minWidth={2825}
          overscanRight={18}
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
