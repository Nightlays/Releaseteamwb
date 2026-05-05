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
  Progress,
  Table,
  Textarea,
  Th,
  Td,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useApp } from '../../context/AppContext';
import { checkProxy } from '../../services/proxy';
import { executeCreateRunScenario, createRunModeLabel, type CreateRunMode, type CreateRunResult } from '../../services/createRun';
import { fetchLaunches, mapLaunch } from '../../services/allure';
import type { AllureLaunchResult } from '../../types';

const STORAGE_KEY = 'create_run_react_state_v1';

const MODE_CARDS: Array<{ value: CreateRunMode; title: string; desc: string; summary: string }> = [
  { value: '1', title: 'ХФ Android', desc: 'Крит-путь Android', summary: '1 launch · TP 1998' },
  { value: '2', title: 'ХФ iOS', desc: 'Крит-путь iOS', summary: '1 launch · TP 3258' },
  { value: '3', title: 'NAPI', desc: 'База + iOS + Android', summary: '3 sync + 3 launch' },
  { value: '4', title: 'Воскресные устройства', desc: 'Old devices / Fold / iPad', summary: '4 launch' },
  { value: '5', title: 'RuStore / AppGallery CP', desc: 'Крит-путь Android storefronts', summary: '2 launch + 2 tag' },
  { value: '6', title: 'RuStore / AppGallery Smoke', desc: 'Smoke storefronts', summary: '2 launch + 2 tag' },
];

type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';
type ProxyState = 'unknown' | 'ok' | 'error';
type LogLevel = 'info' | 'ok' | 'warn' | 'error';

interface StoredState {
  release?: string;
  mode?: CreateRunMode;
}

function readStoredState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredState | null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredState(patch: Partial<StoredState>) {
  try {
    const current = readStoredState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* ignore */
  }
}

function formatTimeStamp() {
  return new Date().toLocaleTimeString('ru-RU');
}

function statusColor(tone: StatusTone) {
  if (tone === 'ok') return '#4ADE80';
  if (tone === 'warn') return '#FCD34D';
  if (tone === 'error') return '#F87171';
  return 'var(--text-2)';
}

function progressColor(tone: StatusTone) {
  if (tone === 'ok') return 'green' as const;
  if (tone === 'warn') return 'yellow' as const;
  if (tone === 'error') return 'red' as const;
  return 'accent' as const;
}

function timeAgo(ms: number): string {
  const value = Number(ms || 0);
  if (!value) return '—';
  const diff = Date.now() - value;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}м назад`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}ч назад`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))}д назад`;
}

export function CreateRun() {
  const { settings } = useSettings();
  const { setSettingsOpen } = useApp();
  const stored = useMemo(readStoredState, []);

  const [release, setRelease] = useState(String(stored.release || '').trim());
  const [mode, setMode] = useState<CreateRunMode>(stored.mode || '1');
  const [proxyState, setProxyState] = useState<ProxyState>('unknown');
  const [status, setStatus] = useState('Выбери сценарий, укажи релиз и запусти создание.');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [result, setResult] = useState<CreateRunResult | null>(null);
  const [recent, setRecent] = useState<AllureLaunchResult[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'error'>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const actionIdRef = useRef(0);

  useEffect(() => {
    writeStoredState({ release, mode });
  }, [release, mode]);

  const addLog = useCallback((text: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-299), { text: `[${formatTimeStamp()}] ${text}`, level }]);
  }, []);

  const createCfg = useCallback((signal?: AbortSignal) => ({
    base: settings.allureBase,
    token: settings.allureToken,
    proxyBase: settings.proxyBase,
    proxyMode: settings.proxyMode,
    useProxy: settings.useProxy,
    signal,
  }), [settings.allureBase, settings.allureToken, settings.proxyBase, settings.proxyMode, settings.useProxy]);

  const refreshRecent = useCallback(async (targetRelease = release, signal?: AbortSignal) => {
    const cleanRelease = String(targetRelease || '').trim();
    if (!cleanRelease || !String(settings.allureToken || '').trim()) {
      setRecent([]);
      return;
    }

    const raw = await fetchLaunches(
      {
        base: settings.allureBase,
        token: settings.allureToken,
        projectId: settings.projectId,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
        signal,
      },
      cleanRelease
    );
    setRecent(raw.map(mapLaunch).slice(0, 20));
  }, [release, settings.allureBase, settings.allureToken, settings.projectId, settings.proxyBase, settings.proxyMode, settings.useProxy]);

  const handleProxyCheck = useCallback(async () => {
    if (settings.useProxy === false) {
      setProxyState('unknown');
      setStatus('Proxy отключен в настройках.');
      setStatusTone('warn');
      return;
    }

    setStatus('Проверяю proxy...');
    setStatusTone('neutral');
    try {
      const ok = await checkProxy(settings.proxyBase);
      setProxyState(ok ? 'ok' : 'error');
      setStatus(ok ? 'Proxy доступен.' : 'Proxy недоступен.');
      setStatusTone(ok ? 'ok' : 'error');
    } catch {
      setProxyState('error');
      setStatus('Proxy недоступен.');
      setStatusTone('error');
    }
  }, [settings.proxyBase, settings.useProxy]);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;
    actionIdRef.current += 1;
    abortRef.current = null;
    controller.abort();
    setRunning(false);
    setStatus('Создание остановлено.');
    setStatusTone('warn');
    setProgress(0);
    addLog('Создание остановлено пользователем.', 'warn');
  }, [addLog]);

  const run = useCallback(async () => {
    const cleanRelease = String(release || '').trim();
    if (!cleanRelease) {
      setStatus('Укажи номер релиза.');
      setStatusTone('error');
      return;
    }
    if (!String(settings.allureToken || '').trim()) {
      setStatus('Заполни Allure Api-Token в настройках.');
      setStatusTone('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    const actionId = actionIdRef.current + 1;
    actionIdRef.current = actionId;
    abortRef.current = controller;

    setRunning(true);
    setResult(null);
    setRecent([]);
    setLogs([]);
    setCopyState('idle');
    setProgress(0);
    setStatus(`Запускаю сценарий ${createRunModeLabel(mode)} для релиза ${cleanRelease}.`);
    setStatusTone('neutral');

    try {
      const created = await executeCreateRunScenario(createCfg(controller.signal), mode, cleanRelease, {
        onLog: addLog,
        onProgress: value => setProgress(value),
      });

      if (actionIdRef.current !== actionId) return;
      setResult(created);
      setStatus(`Готово: создано ${created.launches.length} launch по сценарию ${created.modeLabel}.`);
      setStatusTone('ok');
      setProgress(92);
      addLog('Обновляю список последних launch по релизу...', 'info');

      await refreshRecent(cleanRelease, controller.signal);

      if (actionIdRef.current !== actionId) return;
      setProgress(100);
      addLog('Список launch обновлён.', 'ok');
    } catch (error) {
      if (actionIdRef.current !== actionId) return;
      if ((error as Error)?.name === 'AbortError') return;
      const message = (error as Error)?.message || 'Не удалось создать launch.';
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      addLog(message, 'error');
    } finally {
      if (actionIdRef.current !== actionId) return;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRunning(false);
    }
  }, [addLog, createCfg, mode, refreshRecent, release, settings.allureToken]);

  const copyMessage = useCallback(async () => {
    if (!result?.messageText) return;
    try {
      await navigator.clipboard.writeText(result.messageText);
      setCopyState('ok');
      setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1800);
    }
  }, [result]);

  const activeMode = MODE_CARDS.find(item => item.value === mode) || MODE_CARDS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>＋</div>
        Создание рана
      </div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Релиз</FieldLabel>
              <Input value={release} onChange={event => setRelease(event.target.value)} placeholder="например: 7.5.9000" />
            </div>
            <div>
              <FieldLabel>Allure Base</FieldLabel>
              <Input value={settings.allureBase} readOnly />
            </div>
            <div>
              <FieldLabel>Project ID</FieldLabel>
              <Input value={settings.projectId} readOnly />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge color={String(settings.allureToken || '').trim() ? 'green' : 'red'}>Allure {String(settings.allureToken || '').trim() ? 'ready' : 'missing'}</Badge>
            <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
              proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
            </Badge>
            <Badge color="purple">Mode {mode}</Badge>
            <Badge color="gray">{activeMode.summary}</Badge>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {MODE_CARDS.map(item => {
              const active = item.value === mode;
              return (
                <button
                  key={item.value}
                  onClick={() => setMode(item.value)}
                  disabled={running}
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: 16,
                    border: `1px solid ${active ? 'rgba(155,92,255,.45)' : 'var(--border)'}`,
                    background: active ? 'rgba(155,92,255,.10)' : 'var(--card)',
                    color: 'var(--text)',
                    cursor: running ? 'default' : 'pointer',
                    opacity: running ? 0.8 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{item.title}</div>
                    <Badge color={active ? 'purple' : 'gray'}>{item.value}</Badge>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)' }}>{item.desc}</div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{item.summary}</div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Сценарий</div>
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{activeMode.title}</div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{activeMode.desc}. Все запросы идут в Allure TestOps с тем же токеном и proxy, что и остальная платформа.</div>
            </div>
            <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Статус</div>
              <div style={{ marginTop: 6, fontSize: 13, color: statusColor(statusTone), lineHeight: 1.55 }}>{status}</div>
              <div style={{ marginTop: 10 }}>
                <Progress value={progress} color={progressColor(statusTone)} height={7} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {running ? (
              <Button variant="danger" onClick={stop}>Остановить</Button>
            ) : (
              <Button variant="primary" onClick={() => void run()}>Создать</Button>
            )}
            <Button variant="secondary" onClick={handleProxyCheck} disabled={running}>Проверить proxy</Button>
            <Button variant="ghost" onClick={() => void refreshRecent()} disabled={running || !release.trim() || !String(settings.allureToken || '').trim()}>
              Обновить список
            </Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(true)}>Настройки</Button>
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Результат</CardTitle>
                <CardHint>Созданные launch и итоговое сообщение для отправки.</CardHint>
              </div>
              {result ? <Badge color="green">{result.launches.length} launch</Badge> : <Badge color="gray">пусто</Badge>}
            </CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!result ? (
                <EmptyState text="После запуска здесь появятся созданные launch и готовый текст сообщения." />
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Сценарий</div>
                      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{result.modeLabel}</div>
                    </div>
                    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Теги</div>
                      <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{result.createdTagNames.join(', ') || '—'}</div>
                    </div>
                    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Sync testplan</div>
                      <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
                        {result.syncedTestPlanIds.length ? result.syncedTestPlanIds.join(', ') : 'не требовался'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Готовое сообщение</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Текст собран по тем же шаблонам, что и в legacy-утилите.</div>
                      </div>
                      <Button variant="secondary" size="sm" onClick={copyMessage}>
                        {copyState === 'ok' ? 'Скопировано' : copyState === 'error' ? 'Ошибка копирования' : 'Копировать'}
                      </Button>
                    </div>
                    <Textarea value={result.messageText} readOnly rows={Math.min(10, Math.max(4, result.messageText.split('\n').length + 1))} />
                  </div>

                  <Table>
                    <thead>
                      <tr>
                        <Th>Launch</Th>
                        <Th>TP</Th>
                        <Th>Теги</Th>
                        <Th>Allure</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.launches.map(launch => (
                        <tr key={launch.id}>
                          <Td bold>{launch.name}</Td>
                          <Td mono>{launch.testPlanId}</Td>
                          <Td mono>{launch.tagIds.join(', ')}</Td>
                          <Td>
                            <a href={launch.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                              Открыть
                            </a>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Лог</CardTitle>
                <CardHint>Пошаговое выполнение сценария создания launch.</CardHint>
              </div>
            </CardHeader>
            <CardBody>
              {logs.length ? <LogView lines={logs} maxHeight={320} /> : <EmptyState text="Лог появится после запуска сценария." />}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Последние launch по релизу</CardTitle>
              <CardHint>{release.trim() || 'Укажи релиз, чтобы обновить список.'}</CardHint>
            </div>
            <Badge color="gray">{recent.length}</Badge>
          </CardHeader>
          <CardBody style={{ paddingTop: 10 }}>
            {!recent.length ? (
              <EmptyState text="Список ещё не загружен." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 760, overflowY: 'auto' }}>
                {recent.map(item => (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-soft)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>{item.name}</div>
                      <Badge color={item.status === 'DONE' ? 'green' : item.status === 'RUNNING' ? 'yellow' : 'gray'}>{item.status}</Badge>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge color={item.platform === 'android' ? 'green' : item.platform === 'ios' ? 'blue' : item.platform === 'napi' ? 'purple' : 'gray'}>
                        {item.platform}
                      </Badge>
                      <Badge color="gray">{item.type}</Badge>
                      <Badge color="gray">{item.pct}%</Badge>
                      <Badge color="gray">{timeAgo(item.createdDate)}</Badge>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--surface-soft-5)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${item.pct}%`, borderRadius: 999, background: item.pct >= 90 ? '#22C55E' : item.pct >= 70 ? '#F59E0B' : '#9B5CFF' }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', minWidth: 62, textAlign: 'right' }}>
                        {item.finished}/{item.total}
                      </span>
                    </div>

                    <a
                      href={`${settings.allureBase.replace(/\/+$/, '')}/launch/${item.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                    >
                      Открыть launch →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
