import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  Progress,
  SegmentControl,
  Select,
  Table,
  Td,
  Th,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <a href={issue.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--mono)' }}>
        {issue.key}
      </a>
      <span>{issue.summary || '-'}</span>
      {issue.locomotive.any.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{issue.locomotive.any.join(', ')}</span>
      )}
    </div>
  );
}

function exportCsv(rows: QuarterAnalysisRow[], platform: PlatformKey, year: number) {
  const headers = [
    'Версия',
    'Стрим',
    'Сабстрим',
    'Причина ХФ',
    'Детали ХФ',
    'Локомотивная задача',
    'Вторичные задачи',
    'Время сборки',
    '% раскатки предыдущей версии',
    'Плановая дата хотфикса',
    'Время отведения ветки хотфикса',
    'Фактическая дата отправки',
    'Когда попали на проверку',
    'Дата раскатки на 1%',
  ];
  const lines = [headers, ...rows.map(row => [
    row.version,
    row.stream,
    row.substream,
    row.hotfixReason,
    row.hotfixDetails,
    row.primaryTask ? `${row.primaryTask.key} ${row.primaryTask.summary}` : '',
    row.secondaryTasks.map(issue => `${issue.key} ${issue.summary}`).join('\n'),
    row.buildTime,
    row.previousRolloutPercent,
    row.plannedHotfixDate,
    row.branchCutTime,
    row.actualSendTime,
    row.enteredReviewTime,
    row.onePercentDate,
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

  const years = useMemo(() => Array.from({ length: 6 }, (_, index) => nowYear() + 1 - index), []);
  const platformRows = rows.filter(row => row.platform === platform);
  const tbdCount = visibleRows.filter(row => row.hotfixReason === 'TBD' || row.hotfixDetails === 'TBD').length;
  const progressColor = statusTone === 'ok' ? 'green' : statusTone === 'warn' ? 'yellow' : statusTone === 'error' ? 'red' : 'accent';

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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge color={settings.deployLabToken ? 'green' : 'red'}>DeployLab {settings.deployLabToken ? 'ready' : 'missing'}</Badge>
            <Badge color={settings.ytToken ? 'green' : 'red'}>YT {settings.ytToken ? 'ready' : 'missing'}</Badge>
            <Badge color={settings.useProxy ? 'green' : 'gray'}>proxy {settings.useProxy ? 'on' : 'off'}</Badge>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: statusTone === 'error' ? '#F87171' : statusTone === 'warn' ? '#FCD34D' : statusTone === 'ok' ? '#4ADE80' : 'var(--text-2)' }}>{status}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{progress}%</span>
            </div>
            <Progress value={progress} color={progressColor} height={7} />
          </div>
          {logs.length > 0 && <LogView lines={logs} maxHeight={180} />}
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
            <Badge color={tbdCount ? 'yellow' : 'green'}>TBD: {tbdCount}</Badge>
          </div>
        </CardBody>
        {visibleRows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Версия</Th>
                <Th>Стрим</Th>
                <Th>Сабстрим</Th>
                <Th>Причина / детали ХФ</Th>
                <Th>Локомотивная задача</Th>
                <Th>Вторичные задачи</Th>
                <Th>Тайминги</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={`${row.platform}:${row.version}`}>
                  <Td mono bold>{row.version}</Td>
                  <Td>{dash(row.stream)}</Td>
                  <Td>{dash(row.substream)}</Td>
                  <Td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>
                    <strong>{row.hotfixReason}</strong>
                    <div style={{ marginTop: 6, color: 'var(--text-3)' }}>{row.hotfixDetails}</div>
                  </Td>
                  <Td>{issueCell(row.primaryTask)}</Td>
                  <Td>{row.secondaryTasks.length ? row.secondaryTasks.map(issue => <div key={issue.key}>{issueCell(issue)}</div>) : '-'}</Td>
                  <Td style={{ minWidth: 260 }}>
                    <div>Ветка ХФ: {row.branchCutTime}</div>
                    <div>Отправка: {row.actualSendTime}</div>
                    <div>1%: {row.onePercentDate}</div>
                    <div>Сборка: {row.buildTime}</div>
                    <div>План: {row.plannedHotfixDate}</div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody>
            <EmptyState text="Данных по выбранному фильтру нет." />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

