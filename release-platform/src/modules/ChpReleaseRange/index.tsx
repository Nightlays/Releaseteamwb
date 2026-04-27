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
  Table,
  Td,
  Th,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import {
  collectChpReleaseRange,
  platformLabel,
  type ChpRangeRow,
  type LogLevel,
  type PlatformKey,
} from '../../services/releasePages';

function exportCsv(rows: ChpRangeRow[], platform: PlatformKey) {
  const headers = ['Релиз', 'Задача', 'Название', 'Стрим', 'Сабстрим', 'Принёс', 'Время', 'OK', 'MR merged', 'Теги'];
  const lines = [headers, ...rows.map(row => [
    row.release,
    row.issue.key,
    row.issue.summary,
    row.issue.stream,
    row.issue.substream,
    row.broughtBy,
    row.broughtAt,
    row.approval,
    row.mergedAt,
    row.issue.tags.join(', '),
  ])];
  const csv = lines.map(line => line.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `chp-release-range-${platform}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function issueLink(row: ChpRangeRow) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <a href={row.issue.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 800, textDecoration: 'none', fontFamily: 'var(--mono)' }}>
        {row.issue.key}
      </a>
      <span>{row.issue.summary || '-'}</span>
    </div>
  );
}

export function ChpReleaseRange() {
  const { settings } = useSettings();
  const [startRelease, setStartRelease] = useState('7.6.0000');
  const [endRelease, setEndRelease] = useState('7.6.3000');
  const [streamName, setStreamName] = useState('Банк');
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [rows, setRows] = useState<ChpRangeRow[]>([]);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [status, setStatus] = useState('Укажи диапазон релизов и стрим.');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ok' | 'warn' | 'error'>('neutral');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((message: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-249), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${message}`, level }]);
  }, []);

  const visibleRows = useMemo(() => rows.filter(row => row.platform === platform), [platform, rows]);
  const platformRows = useMemo(() => ({
    android: rows.filter(row => row.platform === 'android'),
    ios: rows.filter(row => row.platform === 'ios'),
  }), [rows]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setRows([]);
    setLogs([]);
    setProgress(0);
    setStatus('Собираю ЧП по диапазону...');
    setStatusTone('neutral');
    try {
      const result = await collectChpReleaseRange(
        { settings, signal: controller.signal, onLog: log, onProgress: setProgress },
        startRelease,
        endRelease,
        streamName
      );
      setRows(result);
      setStatus(`Готово: ${result.length} строк.`);
      setStatusTone(result.length ? 'ok' : 'warn');
      setProgress(100);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setStatus((error as Error).message || 'Не удалось собрать отчёт.');
      setStatusTone('error');
      log((error as Error).message || 'Не удалось собрать отчёт.', 'error');
      setProgress(0);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, [endRelease, log, settings, startRelease, streamName]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus('Сбор остановлен.');
    setStatusTone('warn');
  }, []);

  const progressColor = statusTone === 'ok' ? 'green' : statusTone === 'warn' ? 'yellow' : statusTone === 'error' ? 'red' : 'accent';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>ЧП за релиз диапазон</div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Параметры</CardTitle>
            <CardHint>Токены, Band cookies и proxy берутся из общих настроек платформы.</CardHint>
          </div>
          <Badge color={busy ? 'purple' : rows.length ? 'green' : 'gray'}>{busy ? 'Сбор...' : rows.length ? 'Данные есть' : 'Ожидаю'}</Badge>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Начальный релиз</FieldLabel>
              <Input value={startRelease} onChange={event => setStartRelease(event.target.value)} placeholder="7.6.0000" />
            </div>
            <div>
              <FieldLabel>Конечный релиз</FieldLabel>
              <Input value={endRelease} onChange={event => setEndRelease(event.target.value)} placeholder="7.6.3000" />
            </div>
            <div>
              <FieldLabel>Стрим</FieldLabel>
              <Input value={streamName} onChange={event => setStreamName(event.target.value)} placeholder="Банк" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busy ? <Button variant="danger" onClick={stop}>Остановить</Button> : <Button variant="primary" onClick={() => void run()}>Собрать</Button>}
              <Button variant="secondary" disabled={!visibleRows.length} onClick={() => exportCsv(visibleRows, platform)}>CSV</Button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge color={settings.deployLabToken ? 'green' : 'red'}>DeployLab {settings.deployLabToken ? 'ready' : 'missing'}</Badge>
            <Badge color={settings.ytToken ? 'green' : 'red'}>YT {settings.ytToken ? 'ready' : 'missing'}</Badge>
            <Badge color={settings.gitlabToken ? 'green' : 'gray'}>GitLab {settings.gitlabToken ? 'ready' : 'optional'}</Badge>
            <Badge color={settings.bandCookies ? 'green' : 'gray'}>Band {settings.bandCookies ? 'ready' : 'optional'}</Badge>
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
            <CardTitle>Результат</CardTitle>
            <CardHint>Строки ЧП по выбранному стриму, разложенные по платформам.</CardHint>
          </div>
          <Badge color={visibleRows.length ? 'purple' : 'gray'}>{visibleRows.length}</Badge>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <SegmentControl
              items={[
                { label: `Android (${platformRows.android.length})`, value: 'android' },
                { label: `iOS (${platformRows.ios.length})`, value: 'ios' },
              ]}
              value={platform}
              onChange={value => setPlatform(value as PlatformKey)}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="gray">Стрим: {streamName || '-'}</Badge>
              <Badge color="gray">Платформа: {platformLabel(platform)}</Badge>
            </div>
          </div>
        </CardBody>
        {visibleRows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Релиз</Th>
                <Th>Задача</Th>
                <Th>Стрим</Th>
                <Th>Сабстрим</Th>
                <Th>Принёс / OK</Th>
                <Th>MR</Th>
                <Th>Локомотивные теги</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={`${row.platform}:${row.release}:${row.issue.key}`}>
                  <Td mono bold>{row.release}</Td>
                  <Td>{issueLink(row)}</Td>
                  <Td>{row.issue.stream}</Td>
                  <Td>{row.issue.substream}</Td>
                  <Td>
                    <div>{row.broughtBy}</div>
                    <div style={{ color: 'var(--text-3)', marginTop: 4 }}>{row.broughtAt}</div>
                    <div style={{ color: 'var(--text-3)', marginTop: 4 }}>OK: {row.approval}</div>
                  </Td>
                  <Td>{row.mergedAt}</Td>
                  <Td>{row.issue.locomotive.any.length ? row.issue.locomotive.any.join(', ') : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody>
            <EmptyState text="Данных по выбранной платформе пока нет." />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

