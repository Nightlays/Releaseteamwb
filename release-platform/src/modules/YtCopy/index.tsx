import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SegmentControl,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy } from '../../services/proxy';
import {
  buildEpicUserStoryDigest,
  type EpicUserStoryCommonRow,
  type EpicUserStoryDigestResult,
  type EpicUserStoryMode,
  type EpicUserStoryRow,
} from '../../services/youtrack';

const LS_RELEASE_KEY = 'rp_epic_user_story_release';
const LS_MODE_KEY = 'rp_epic_user_story_mode';
const LEGACY_SHARED_RELEASE_KEY = 'swat_uwu_release_range';

function readSharedRelease() {
  try {
    const raw = localStorage.getItem(LEGACY_SHARED_RELEASE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { from?: string; to?: string } | null;
    return String(parsed?.from || parsed?.to || '').trim();
  } catch {
    return '';
  }
}

function readStoredRelease() {
  try {
    return String(localStorage.getItem(LS_RELEASE_KEY) || '').trim() || readSharedRelease() || '7.3.5420';
  } catch {
    return readSharedRelease() || '7.3.5420';
  }
}

function readStoredMode(): EpicUserStoryMode {
  try {
    const raw = String(localStorage.getItem(LS_MODE_KEY) || '').trim();
    return raw === 'nadezhda' || raw === 'darya' ? raw : 'elena';
  } catch {
    return 'elena';
  }
}

function issueHref(base: string, key: string) {
  return `${String(base || 'https://youtrack.wildberries.ru').replace('youtrack.wb.ru', 'youtrack.wildberries.ru').replace(/\/+$/, '')}/issue/${encodeURIComponent(key)}`;
}

function SectionList({
  title,
  rows,
  base,
  emptyText,
}: {
  title: string;
  rows: EpicUserStoryRow[];
  base: string;
  emptyText: string;
}) {
  return (
    <Card style={{ minHeight: 280 }}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardHint>{rows.length} задач</CardHint>
        </div>
        <Badge color={rows.length ? 'purple' : 'gray'}>{rows.length}</Badge>
      </CardHeader>
      <CardBody style={{ paddingTop: 10, maxHeight: 340, overflowY: 'auto' }}>
        {!rows.length && <EmptyState text={emptyText} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(row => (
            <a
              key={`${title}:${row.key}`}
              href={issueHref(base, row.key)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                textDecoration: 'none',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--surface-soft-4)',
                background: 'var(--surface-soft)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#C4B5FD', fontFamily: 'var(--mono)' }}>{row.key}</span>
                <Badge color={row.typeBucket === 'user_story' ? 'blue' : row.typeBucket === 'epic' ? 'purple' : 'gray'}>
                  {row.type || '—'}
                </Badge>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>
                {row.summary || 'Без названия'}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                {row.state || 'Состояние не найдено'}
              </div>
            </a>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function CommonSection({
  rows,
}: {
  rows: EpicUserStoryCommonRow[];
}) {
  return (
    <Card style={{ minHeight: 280 }}>
      <CardHeader>
        <div>
          <CardTitle>Общие задачи</CardTitle>
          <CardHint>Совпали по summary между iOS и Android</CardHint>
        </div>
        <Badge color={rows.length ? 'yellow' : 'gray'}>{rows.length}</Badge>
      </CardHeader>
      <CardBody style={{ paddingTop: 10, maxHeight: 340, overflowY: 'auto' }}>
        {!rows.length && <EmptyState text="Общих задач не найдено." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(row => (
            <div
              key={`${row.issueRef}:${row.summary}`}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--surface-soft-4)',
                background: 'var(--surface-soft)',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {row.issues.map(issue => (
                  <a
                    key={`${row.summary}:${issue.platform}:${issue.key}`}
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 8px',
                      borderRadius: 999,
                      textDecoration: 'none',
                      border: '1px solid var(--border)',
                      background: issue.platform === 'ios' ? 'rgba(59,130,246,.12)' : 'rgba(155,92,255,.14)',
                      color: issue.platform === 'ios' ? '#93C5FD' : '#C4B5FD',
                      fontSize: 11,
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    <span>{issue.platform === 'ios' ? 'iOS' : 'Android'}</span>
                    <span>{issue.key}</span>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>{row.summary}</div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function OutputCard({
  mode,
  result,
  onCopy,
  copying,
}: {
  mode: EpicUserStoryMode;
  result: EpicUserStoryDigestResult | null;
  onCopy: () => void;
  copying: boolean;
}) {
  const activeMode = result?.mode || mode;
  const outputTitle = activeMode === 'elena' ? 'Текст для отправки' : 'Текст для копирования';
  const boardUrls = result?.boardUrls || {};

  return (
    <Card>
      <CardHeader style={{ paddingBottom: 12 }}>
        <div>
          <CardTitle>{outputTitle}</CardTitle>
          <CardHint>Готовый текст по релизу, который строится на реальных данных YouTrack и agile board.</CardHint>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {boardUrls.ios && (
            <a href={boardUrls.ios} target="_blank" rel="noopener noreferrer" style={{ color: '#C4B5FD', textDecoration: 'none', fontSize: 12 }}>
              iOS board
            </a>
          )}
          {boardUrls.android && (
            <a href={boardUrls.android} target="_blank" rel="noopener noreferrer" style={{ color: '#C4B5FD', textDecoration: 'none', fontSize: 12 }}>
              Android board
            </a>
          )}
          {!boardUrls.ios && !boardUrls.android && boardUrls.current && (
            <a href={boardUrls.current} target="_blank" rel="noopener noreferrer" style={{ color: '#C4B5FD', textDecoration: 'none', fontSize: 12 }}>
              Открыть доску
            </a>
          )}
          <Button variant="secondary" onClick={onCopy} disabled={!result?.text}>
            {copying ? '...' : 'Копировать'}
          </Button>
        </div>
      </CardHeader>
      <CardBody style={{ paddingTop: 0 }}>
        {!result?.text ? (
          <EmptyState text={activeMode === 'elena' ? 'Здесь будет сформирован текст.' : 'Здесь будет сформирован список задач.'} />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 16,
              minHeight: 280,
              maxHeight: 520,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              borderRadius: 14,
              border: '1px solid var(--surface-soft-4)',
              background: 'var(--surface-soft)',
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            }}
          >
            {result.text}
          </pre>
        )}
      </CardBody>
    </Card>
  );
}

export function YtCopy() {
  const { settings } = useSettings();
  const [release, setRelease] = useState(readStoredRelease);
  const [mode, setMode] = useState<EpicUserStoryMode>(readStoredMode);
  const [result, setResult] = useState<EpicUserStoryDigestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [status, setStatus] = useState('Введите релиз и нажмите «Запустить сбор».');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ok' | 'error'>('neutral');
  const [logs, setLogs] = useState<Array<{ text: string; level: 'info' | 'ok' | 'warn' | 'error' }>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const log = useCallback((text: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') => {
    setLogs(prev => [...prev.slice(-299), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RELEASE_KEY, release);
      localStorage.setItem(LEGACY_SHARED_RELEASE_KEY, JSON.stringify({ from: release, to: release }));
    } catch {
      /* ignore */
    }
  }, [release]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const chips = result?.chips || [];
  const modeLabel = useMemo(() => {
    if (mode === 'nadezhda') return 'Надежда(iOS)';
    if (mode === 'darya') return 'Надежда(Andr)';
    return 'Елена';
  }, [mode]);

  const resetForMode = useCallback((nextMode: EpicUserStoryMode) => {
    if (loading) return;
    setMode(nextMode);
    setResult(null);
    setLogs([]);
    setStatus(nextMode === 'elena'
      ? 'Введите релиз и нажмите «Запустить сбор».'
      : 'Введите релиз и нажмите «Запустить сбор», чтобы сформировать список задач.');
    setStatusTone('neutral');
  }, [loading]);

  const run = useCallback(async () => {
    if (!String(release || '').trim()) {
      setStatus('Укажи номер релиза.');
      setStatusTone('error');
      return;
    }

    if (!String(settings.ytToken || '').trim()) {
      setStatus('Заполни YouTrack Token в настройках.');
      setStatusTone('error');
      return;
    }

    abortRef.current?.abort();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult(null);
    setLogs([]);
    setStatus(`Сбор задач из YouTrack: ${modeLabel}.`);
    setStatusTone('neutral');
    log(`Старт сборки для релиза ${release} в режиме ${modeLabel}.`);

    try {
      const digest = await buildEpicUserStoryDigest(
        {
          base: settings.ytBase,
          token: settings.ytToken,
          signal: controller.signal,
          proxyBase: settings.proxyBase,
          proxyMode: settings.proxyMode,
          useProxy: settings.useProxy,
        },
        release,
        mode
      );

      if (runIdRef.current !== runId) {
        return;
      }
      setResult(digest);
      setStatus('Готово.');
      setStatusTone('ok');
      log(`Сбор завершён. Сформирован текст в режиме ${digest.modeLabel}.`, 'ok');
    } catch (error) {
      if (runIdRef.current !== runId) {
        return;
      }
      if ((error as Error)?.name === 'AbortError') {
        setStatus('Сбор остановлен.');
        setStatusTone('neutral');
        log('Сбор остановлен вручную.', 'warn');
      } else {
        const message = (error as Error)?.message || 'Ошибка при сборе задач.';
        setStatus(message);
        setStatusTone('error');
        log(message, 'error');
      }
    } finally {
      if (runIdRef.current !== runId) {
        return;
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [log, mode, modeLabel, release, settings]);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;

    runIdRef.current += 1;
    abortRef.current = null;
    controller.abort();
    setLoading(false);
    setStatus('Сбор остановлен.');
    setStatusTone('neutral');
    log('Сбор остановлен вручную.', 'warn');
  }, [log]);

  const handleReleaseKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!loading) void run();
  }, [loading, run]);

  const handleProxyCheck = useCallback(async () => {
    if (!String(settings.proxyBase || '').trim()) {
      setProxyState('error');
      log('Proxy base не заполнен.', 'error');
      return;
    }

    try {
      const ok = await checkProxy(settings.proxyBase);
      setProxyState(ok ? 'ok' : 'error');
      log(ok ? `Proxy доступен: ${settings.proxyBase}` : 'Proxy не отвечает.', ok ? 'ok' : 'error');
    } catch {
      setProxyState('error');
      log('Proxy не отвечает.', 'error');
    }
  }, [log, settings.proxyBase]);

  const handleCopy = useCallback(async () => {
    const text = String(result?.text || '').trim();
    if (!text) {
      log('Нечего копировать.', 'warn');
      return;
    }

    try {
      setCopying(true);
      await navigator.clipboard.writeText(text);
      log('Текст скопирован в буфер обмена.', 'ok');
    } catch {
      log('Не удалось скопировать автоматически.', 'error');
    } finally {
      setCopying(false);
    }
  }, [log, result?.text]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⤵</div>
        Epic / User Story
      </div>

      <Card>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Номер релиза</FieldLabel>
              <Input
                value={release}
                onChange={event => setRelease(event.target.value)}
                onKeyDown={handleReleaseKeyDown}
                placeholder="7.5.1000"
              />
            </div>

            <div>
              <FieldLabel>Режим</FieldLabel>
              <div style={loading ? { opacity: .55, pointerEvents: 'none' } : undefined}>
                <SegmentControl
                  items={[
                    { label: 'Елена', value: 'elena' },
                    { label: 'Надежда(iOS)', value: 'nadezhda' },
                    { label: 'Надежда(Andr)', value: 'darya' },
                  ]}
                  value={mode}
                  onChange={value => resetForMode(value as EpicUserStoryMode)}
                  style={{ width: 'fit-content' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {loading ? (
                <Button
                  variant="danger"
                  type="button"
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    stop();
                  }}
                >
                  Остановить
                </Button>
              ) : (
                <Button variant="primary" type="button" onClick={() => void run()}>Запустить сбор</Button>
              )}
              <Button variant="secondary" type="button" onClick={handleProxyCheck}>Проверить proxy</Button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ fontSize: 12, color: statusTone === 'error' ? '#F87171' : statusTone === 'ok' ? '#4ADE80' : 'var(--text-2)' }}>
              {status}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge color={String(settings.ytToken || '').trim() ? 'green' : 'red'}>YT token {String(settings.ytToken || '').trim() ? 'ready' : 'missing'}</Badge>
              <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
                proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
              </Badge>
            </div>
          </div>

          {chips.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {chips.map(chip => (
                <Badge key={chip} color="gray">{chip}</Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <OutputCard mode={mode} result={result} onCopy={handleCopy} copying={copying} />

      {result?.mode === 'elena' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <SectionList title="iOS" rows={result.details.iosRows || []} base={settings.ytBase} emptyText="Нет iOS задач." />
          <SectionList title="Android" rows={result.details.androidRows || []} base={settings.ytBase} emptyText="Нет Android задач." />
          <CommonSection rows={result.details.commonRows || []} />
        </div>
      )}

      {result && result.mode !== 'elena' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <SectionList title="User Story" rows={result.details.userStoryRows || []} base={settings.ytBase} emptyText="Нет User Story." />
          <SectionList title="Epic" rows={result.details.epicRows || []} base={settings.ytBase} emptyText="Нет Epic." />
          <SectionList title="Другие задачи" rows={result.details.taskRows || []} base={settings.ytBase} emptyText="Нет других задач." />
        </div>
      )}

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Лог</CardTitle>
              <CardHint>Статус выполнения и диагностические сообщения.</CardHint>
            </div>
          </CardHeader>
          <CardBody style={{ paddingTop: 10 }}>
            <LogView lines={logs} maxHeight={260} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
