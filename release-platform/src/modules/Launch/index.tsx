import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Divider, Badge, Button, Input, FieldLabel, Textarea, LogView, Modal } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { useApp } from '../../context/AppContext';
import { RunMode, RUN_MODE_LABELS, WorkflowStep, StepStatus, DutyStream } from '../../types';
import {
  runCreatorScenario,
  fetchDutyStreamNames,
  bandPostMessage,
  bandScheduleMessage,
  SWAT_CHANNEL_ID,
  FEED_CHANNEL_ID,
  type LogLevel,
  type LaunchRecord,
} from '../../services/launch';
import { checkProxy } from '../../services/proxy';

/* ─── MODE CARD ─────────────────────────────────────────────── */
const MODES: Array<{ id: RunMode; icon: string; desc: string }> = [
  { id: 'major',            icon: '🚀', desc: 'Полный цикл Android + iOS' },
  { id: 'hf_android',       icon: '🤖', desc: 'Хот-фикс для Android' },
  { id: 'hf_ios',           icon: '🍎', desc: 'Хот-фикс для iOS' },
  { id: 'napi',             icon: '⚡', desc: 'Native API платёжного модуля' },
  { id: 'sunday_devices',   icon: '📱', desc: 'Еженедельный прогон устройств' },
  { id: 'rustore_critical', icon: '🏪', desc: 'RuStore / AppGallery — Крит-путь' },
  { id: 'rustore_smoke',    icon: '🏪', desc: 'RuStore / AppGallery — Smoke' },
];

/* ─── STEP STATUS ICONS ─────────────────────────────────────── */
const STEP_ICONS: Record<StepStatus, string> = {
  pending: '○',
  running: '↻',
  done:    '✓',
  error:   '✕',
  skipped: '–',
};

const STEP_COLORS: Record<StepStatus, string> = {
  pending: 'var(--text-3)',
  running: '#F59E0B',
  done:    '#22C55E',
  error:   '#EF4444',
  skipped: 'var(--text-3)',
};

function WorkflowList({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map(step => (
        <div key={step.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '8px 12px', borderRadius: 10,
          background: step.status === 'running' ? 'rgba(245,158,11,.08)'
            : step.status === 'done'   ? 'rgba(34,197,94,.06)'
            : step.status === 'error'  ? 'rgba(239,68,68,.08)' : 'var(--surface-soft)',
          border: `1px solid ${
            step.status === 'running' ? 'rgba(245,158,11,.2)'
            : step.status === 'done'   ? 'rgba(34,197,94,.15)'
            : step.status === 'error'  ? 'rgba(239,68,68,.2)' : 'var(--surface-soft-4)'}`,
        }}>
          <span style={{
            fontSize: 13, color: STEP_COLORS[step.status], width: 16, textAlign: 'center',
            marginTop: 1, flexShrink: 0,
            animation: step.status === 'running' ? 'spin .8s linear infinite' : 'none',
          }}>
            {STEP_ICONS[step.status]}
          </span>
          <div>
            <div style={{
              fontSize: 13, fontWeight: 500,
              color: step.status === 'done' ? 'var(--text-3)' : 'var(--text-2)',
              textDecoration: step.status === 'done' ? 'line-through' : 'none',
            }}>{step.label}</div>
            {step.detail && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{step.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── DUTY TABLE ─────────────────────────────────────────────── */
function DutyTable({ streams, onEdit }: { streams: DutyStream[]; onEdit: (idx: number) => void }) {
  const filled = streams.filter(s => s.status === 'filled').length;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <Badge color="purple">Стримов: {streams.length}</Badge>
        <Badge color="green">Заполнено: {filled}</Badge>
        <Badge color={streams.length - filled > 0 ? 'red' : 'gray'}>С пропусками: {streams.length - filled}</Badge>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['#','Стрим','iOS','Android','Лид','Статус',''].map(h => (
              <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {streams.map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)' }}>{i + 1}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border-subtle)' }}>{s.name}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.ios || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.android || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.lead || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <Badge color={s.status === 'filled' ? 'green' : s.status === 'partial' ? 'yellow' : 'red'}>
                    {s.status === 'filled' ? 'Заполнен' : s.status === 'partial' ? 'Частично' : 'Пусто'}
                  </Badge>
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <button onClick={() => onEdit(i)} style={{ fontSize: 11, color: '#9B5CFF', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>Ред.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── SCHEDULE PICKER ───────────────────────────────────────── */
function SchedulePicker({ onSchedule }: { onSchedule: (time: string) => void }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState('10:00');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <Button variant="ghost" size="sm" onClick={() => onSchedule('10:00')}>Отправить в 10:00</Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>В другое время</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Запланировать отправку" width={320}>
        <FieldLabel>Время</FieldLabel>
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-hi)', background: 'var(--surface-soft-4)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" size="sm" onClick={() => { onSchedule(time); setOpen(false); }}>Запланировать</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ─── STEPS BY MODE ──────────────────────────────────────────── */
function buildSteps(mode: RunMode): WorkflowStep[] {
  const common: WorkflowStep[] = [
    { id: 'check_proxy',  label: 'Проверка прокси',         status: 'pending' },
    { id: 'check_allure', label: 'Проверка Allure токена',   status: 'pending' },
    { id: 'check_yt',     label: 'Проверка YouTrack токена', status: 'pending' },
  ];
  const byMode: Record<RunMode, WorkflowStep[]> = {
    major: [
      { id: 'collect_duty',   label: 'Сбор стримов (Allure TestOps)',             status: 'pending' },
      { id: 'build_yt_msg',   label: 'Формирование сообщений YT',                  status: 'pending' },
      { id: 'run_android_cp', label: 'Запуск Android Critical Path',               status: 'pending' },
      { id: 'run_ios_cp',     label: 'Запуск iOS Critical Path',                   status: 'pending' },
      { id: 'publish_swat',   label: 'Публикация в SWAT Team Only',                status: 'pending' },
      { id: 'publish_feed',   label: 'Публикация в ленту релизов',                 status: 'pending' },
    ],
    hf_android: [
      { id: 'create_run',   label: 'Создание рана Android Critical Path (ХФ)',    status: 'pending' },
      { id: 'notify_swat',  label: 'Уведомление SWAT',                             status: 'pending' },
    ],
    hf_ios: [
      { id: 'create_run',   label: 'Создание рана iOS Critical Path (ХФ)',        status: 'pending' },
      { id: 'notify_swat',  label: 'Уведомление SWAT',                             status: 'pending' },
    ],
    napi: [
      { id: 'create_run',   label: 'Создание NAPI ранов',                          status: 'pending' },
    ],
    sunday_devices: [
      { id: 'create_run',   label: 'Создание ранов устройств',                     status: 'pending' },
    ],
    rustore_critical: [
      { id: 'create_run',   label: 'Создание RuStore/AppGallery Critical Path',   status: 'pending' },
    ],
    rustore_smoke: [
      { id: 'create_run',   label: 'Создание RuStore/AppGallery Smoke',           status: 'pending' },
    ],
  };
  return [...common, ...(byMode[mode] ?? [])];
}

/* ─── LAUNCH MODULE ──────────────────────────────────────────── */
export function Launch() {
  const { settings } = useSettings();
  const { setSettingsOpen } = useApp();

  const [mode, setMode]           = useState<RunMode>('major');
  const [majorView, setMajorView] = useState<'collection' | 'release' | 'editor' | null>(null);
  const [release, setRelease]     = useState('');
  const [steps, setSteps]         = useState<WorkflowStep[]>([]);
  const [streams, setStreams]      = useState<DutyStream[]>([]);
  const [running, setRunning]     = useState(false);
  const [logs, setLogs]           = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [iosText, setIosText]     = useState('');
  const [andText, setAndText]     = useState('');
  const [createdRuns, setCreatedRuns] = useState<LaunchRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((text: string, level: LogLevel = 'info') =>
    setLogs(prev => [...prev.slice(-300), { text: `[${new Date().toLocaleTimeString('ru')}] ${text}`, level }]), []);

  const setStep = useCallback((id: string, status: StepStatus, detail?: string) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, detail } : s)), []);

  /* Load streams when token available */
  useEffect(() => {
    const token = String(settings.allureToken || '').replace(/^Api-Token\s+/i, '').trim();
    if (!token || streams.length) return;
    fetchDutyStreamNames(token)
      .then(names => {
        if (!names.length) return;
        setStreams(names.map(name => ({ name, ios: '', android: '', lead: '', status: 'missing' as const })));
      })
      .catch(() => { /* ignore — streams stay empty */ });
  }, [settings.allureToken]);

  /* ─── MAIN WORKFLOW ────────────────────────────────────────── */
  const runWorkflow = useCallback(async () => {
    if (running) { abortRef.current?.abort(); setRunning(false); return; }

    const newSteps = buildSteps(mode);
    setSteps(newSteps);
    setLogs([]);
    setCreatedRuns([]);
    setRunning(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const stepLog = (id: string, status: StepStatus, detail?: string) =>
      setSteps(prev => prev.map(s => s.id === id ? { ...s, status, detail } : s));

    try {
      /* 1. Proxy */
      stepLog('check_proxy', 'running');
      log('Проверка прокси...');
      const proxyOk = await checkProxy(settings.proxyBase).catch(() => false);
      if (proxyOk) {
        stepLog('check_proxy', 'done', settings.proxyBase);
        log('✓ Прокси доступен', 'ok');
      } else {
        stepLog('check_proxy', 'error', 'Недоступен');
        log('✗ Прокси недоступен — убедись что proxy-standalone.js запущен на :8787', 'warn');
      }

      /* 2. Allure */
      stepLog('check_allure', 'running');
      log('Проверка Allure токена...');
      if (!settings.allureToken) {
        stepLog('check_allure', 'error', 'Токен не задан');
        log('✗ Allure токен не задан', 'warn');
      } else {
        stepLog('check_allure', 'done', 'Задан');
        log('✓ Allure токен задан', 'ok');
      }

      /* 3. YT */
      stepLog('check_yt', 'running');
      if (settings.ytToken) {
        stepLog('check_yt', 'done', 'Задан');
        log('✓ YouTrack токен задан', 'ok');
      } else {
        stepLog('check_yt', 'skipped', 'Не задан — пропускаем');
        log('⚠ YouTrack токен не задан', 'warn');
      }

      /* 4. Mode-specific */
      if (mode === 'major') {
        /* Collect duty streams */
        stepLog('collect_duty', 'running');
        log('Загружаю список стримов из Allure TestOps...');
        try {
          const token = String(settings.allureToken || '').replace(/^Api-Token\s+/i, '').trim();
          const names = token ? await fetchDutyStreamNames(token, signal) : [];
          if (names.length) {
            setStreams(names.map(name => ({ name, ios: '', android: '', lead: '', status: 'missing' as const })));
            stepLog('collect_duty', 'done', `${names.length} стримов`);
            log(`✓ Получено ${names.length} стримов из Allure`, 'ok');
          } else {
            stepLog('collect_duty', 'skipped', 'Нет данных');
            log('⚠ Стримы не получены (нужен Allure токен)', 'warn');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stepLog('collect_duty', 'error', msg.slice(0, 60));
          log(`✗ Ошибка загрузки стримов: ${msg}`, 'error');
        }

        /* Build YT messages */
        stepLog('build_yt_msg', 'running');
        log('Формирование сообщений YouTrack...');
        const ios = `#IOS #Release ${release || '7.x.x'}\n\n📱 iOS релиз запущен\nДежурные:\n${streams.filter(s => s.ios).map(s => `${s.name} ${s.ios}`).join('\n')}`;
        const and = `#Android #Release ${release || '7.x.x'}\n\n🤖 Android релиз запущен\nДежурные:\n${streams.filter(s => s.android).map(s => `${s.name} ${s.android}`).join('\n')}`;
        setIosText(ios);
        setAndText(and);
        stepLog('build_yt_msg', 'done');
        log('✓ Тексты сформированы', 'ok');

        /* Android CP */
        stepLog('run_android_cp', 'running');
        log(`Запускаю Android Critical Path для релиза ${release || '?'}...`);
        try {
          const result = await runCreatorScenario('hf_android', release, settings, log, signal);
          const run = result.runs[0];
          if (run) {
            setCreatedRuns(prev => [...prev, run]);
            stepLog('run_android_cp', 'done', `Ран #${run.id}${run.reused ? ' (переиспользован)' : ''}`);
            log(`✓ Android CP: ран #${run.id}`, 'ok');
          } else {
            stepLog('run_android_cp', 'skipped', 'Нет токена');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stepLog('run_android_cp', 'error', msg.slice(0, 60));
          log(`✗ Android CP: ${msg}`, 'error');
        }

        /* iOS CP */
        stepLog('run_ios_cp', 'running');
        log(`Запускаю iOS Critical Path...`);
        try {
          const result = await runCreatorScenario('hf_ios', release, settings, log, signal);
          const run = result.runs[0];
          if (run) {
            setCreatedRuns(prev => [...prev, run]);
            stepLog('run_ios_cp', 'done', `Ран #${run.id}${run.reused ? ' (переиспользован)' : ''}`);
            log(`✓ iOS CP: ран #${run.id}`, 'ok');
          } else {
            stepLog('run_ios_cp', 'skipped', 'Нет токена');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stepLog('run_ios_cp', 'error', msg.slice(0, 60));
          log(`✗ iOS CP: ${msg}`, 'error');
        }

        stepLog('publish_swat', 'pending');
        stepLog('publish_feed', 'pending');
        log('⬤ Готово к публикации. Нажми «SWAT Team Only» или «Лента релизов»', 'info');

      } else {
        /* Non-major modes */
        const runStep = newSteps.find(s => s.id === 'create_run');
        if (runStep) {
          stepLog('create_run', 'running');
          log(`${runStep.label}...`);
          try {
            const result = await runCreatorScenario(mode, release, settings, log, signal);
            setCreatedRuns(result.runs);
            const detail = result.runs.length
              ? result.runs.map(r => `#${r.id}`).join(', ')
              : 'Завершено';
            stepLog('create_run', 'done', detail);
            log(`✓ ${detail}`, 'ok');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            stepLog('create_run', 'error', msg.slice(0, 80));
            log(`✗ ${msg}`, 'error');
          }
        }

        const notifyStep = newSteps.find(s => s.id === 'notify_swat');
        if (notifyStep) {
          stepLog('notify_swat', 'pending');
          log('⬤ Готово к публикации. Нажми «SWAT Team Only»', 'info');
        }
      }

      log('✓ Запуск завершён', 'ok');
    } catch {
      log('Запуск прерван', 'warn');
    } finally {
      setRunning(false);
    }
  }, [mode, running, settings, release, streams, log, setStep]);

  /* ─── PUBLISH ─────────────────────────────────────────────── */
  const publishToChannel = useCallback(async (
    channelId: string,
    stepId: string,
    label: string,
    scheduledTime?: string,
  ) => {
    const cookies = settings.bandCookies;
    const proxyBase = settings.proxyBase;

    if (!cookies) {
      log(`✗ Band cookies не заданы — укажи в Настройках`, 'error');
      return;
    }

    setStep(stepId, 'running', scheduledTime ? `Запланировано на ${scheduledTime}` : 'Отправка...');
    log(`${label}${scheduledTime ? ` в ${scheduledTime}` : ''}...`);

    const runLines = createdRuns.length
      ? createdRuns.map(r => `Ран: ${r.name} — ${r.url}`).join('\n')
      : '';
    const message = [
      release ? `Релиз ${release}` : 'Запуск релиза',
      runLines,
      new Date().toLocaleString('ru', { timeZone: 'Europe/Moscow' }) + ' (МСК)',
    ].filter(Boolean).join('\n');

    try {
      if (scheduledTime) {
        const [hh, mm] = scheduledTime.split(':').map(Number);
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);
        if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);
        await bandScheduleMessage(proxyBase, cookies, message, scheduled.getTime(), { channelId });
        setStep(stepId, 'done', `Запланировано на ${scheduledTime}`);
        log(`✓ ${label} — запланировано на ${scheduledTime}`, 'ok');
      } else {
        await bandPostMessage(proxyBase, cookies, message, { channelId });
        setStep(stepId, 'done', 'Отправлено');
        log(`✓ ${label} — отправлено`, 'ok');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep(stepId, 'error', msg.slice(0, 60));
      log(`✗ ${label}: ${msg}`, 'error');
    }
  }, [settings, release, createdRuns, log, setStep]);

  /* ─── RENDER ──────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* PAGE HEADER */}
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▷</div>
        Запуск релиза
      </div>

      {/* MODE SELECTOR */}
      <Card>
        <CardHeader><CardTitle>Тип запуска</CardTitle></CardHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, padding: '14px 16px' }}>
          {MODES.map(m => (
            <div key={m.id} onClick={() => setMode(m.id)} style={{
              border: `1px solid ${mode === m.id ? 'rgba(155,92,255,.4)' : 'var(--border)'}`,
              borderRadius: 14, padding: '12px 14px', cursor: 'pointer',
              background: mode === m.id ? 'rgba(155,92,255,.08)' : 'transparent',
              transition: 'all .12s',
            }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{m.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{RUN_MODE_LABELS[m.id]}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* LEFT: PARAMS + ACTIONS */}
        <Card>
          <CardHeader><CardTitle>Параметры</CardTitle></CardHeader>
          <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <FieldLabel>Номер релиза</FieldLabel>
              <Input value={release} onChange={e => setRelease(e.target.value)} placeholder="например: 7.3.5420" />
            </div>
            <div>
              <FieldLabel>Allure Api-Token</FieldLabel>
              <Input defaultValue={settings.allureToken} type="password" placeholder="perm:..." readOnly />
            </div>
            <div>
              <FieldLabel>YouTrack Token</FieldLabel>
              <Input defaultValue={settings.ytToken} type="password" placeholder="perm:..." readOnly />
            </div>
            {(mode === 'major' || mode === 'hf_android' || mode === 'hf_ios') && (
              <div>
                <FieldLabel>Band Cookies (для публикации)</FieldLabel>
                <Input defaultValue={settings.bandCookies} type="password" placeholder="MMAUTHTOKEN=..." readOnly />
              </div>
            )}

            <Divider />

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant={running ? 'danger' : 'primary'} style={{ flex: 1 }} onClick={runWorkflow}>
                {running ? '■ Остановить' : '▷ Запустить'}
              </Button>
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>Настройки</Button>
            </div>

            {/* PUBLISH CONTROLS */}
            {steps.length > 0 && (
              <>
                <Divider />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Публикация</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="ghost" size="sm"
                      onClick={() => publishToChannel(SWAT_CHANNEL_ID, 'publish_swat', 'SWAT Team Only')}>
                      SWAT Team Only
                    </Button>
                    <SchedulePicker onSchedule={t => publishToChannel(SWAT_CHANNEL_ID, 'publish_swat', 'SWAT Team Only (запланировано)', t)} />
                  </div>
                  <Button variant="ghost" size="sm"
                    onClick={() => publishToChannel(FEED_CHANNEL_ID, 'publish_feed', 'Лента релизов')}>
                    Лента релизов
                  </Button>
                </div>
              </>
            )}

            {/* CREATED RUNS LIST */}
            {createdRuns.length > 0 && (
              <>
                <Divider />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Созданные раны</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {createdRuns.map(run => (
                    <a key={run.id} href={run.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#9B5CFF', textDecoration: 'none' }}>
                      #{run.id} {run.name}{run.reused ? ' ↩' : ''}
                    </a>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* RIGHT: LOG + STEPS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Пошаговый запуск</CardTitle>
                <Badge color={running ? 'yellow' : 'green'}>{running ? 'running' : 'done'}</Badge>
              </CardHeader>
              <CardBody><WorkflowList steps={steps} /></CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Лог</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Очистить</Button>
            </CardHeader>
            <CardBody>
              {logs.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Нажмите «Запустить» для начала</div>
                : <LogView lines={logs} />
              }
              {logs.length > 0 && (
                <Button variant="secondary" size="sm" style={{ marginTop: 10 }}
                  onClick={() => navigator.clipboard.writeText(logs.map(l => l.text).join('\n'))}>
                  Скопировать лог
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* MAJOR: SUB-TABS */}
      {mode === 'major' && (
        <Card>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
            {(['collection', 'release', 'editor'] as const).map(v => (
              <button key={v} onClick={() => setMajorView(v === majorView ? null : v)} style={{
                padding: '10px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none', fontFamily: 'inherit',
                borderBottom: `2px solid ${majorView === v ? '#9B5CFF' : 'transparent'}`,
                color: majorView === v ? 'var(--text)' : 'var(--text-2)',
                marginBottom: -1, transition: 'all .12s',
              }}>
                {v === 'collection' ? 'Сбор стримов' : v === 'release' ? 'Релиз' : 'Редактор'}
              </button>
            ))}
          </div>

          {majorView === 'collection' && (
            <CardBody>
              {streams.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Стримы загружаются после нажатия «Запустить» или при наличии Allure токена</div>
                : <DutyTable streams={streams} onEdit={idx => {
                    const name = window.prompt('Редактировать стрим: ' + streams[idx].name + '\nВведите iOS (@ или имя):') || streams[idx].ios;
                    setStreams(prev => prev.map((s, i) => i === idx ? { ...s, ios: name, status: name ? 'filled' : s.status } : s));
                  }} />
              }
            </CardBody>
          )}

          {majorView === 'release' && (
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>iOS</div>
                  <FieldLabel>Сообщение в тред</FieldLabel>
                  <Textarea value={iosText} onChange={e => setIosText(e.target.value)} rows={12} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  <Button variant="ghost" size="sm" style={{ marginTop: 6 }}
                    onClick={() => navigator.clipboard.writeText(iosText)}>Скопировать</Button>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Android</div>
                  <FieldLabel>Сообщение в тред</FieldLabel>
                  <Textarea value={andText} onChange={e => setAndText(e.target.value)} rows={12} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  <Button variant="ghost" size="sm" style={{ marginTop: 6 }}
                    onClick={() => navigator.clipboard.writeText(andText)}>Скопировать</Button>
                </div>
              </div>
            </CardBody>
          )}

          {majorView === 'editor' && (
            <CardBody>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
                Редактор дежурных по стримам — заполни iOS / Android / Лид для каждого стрима
              </div>
              {streams.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Сначала загрузи стримы (нажми «Запустить»)</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {streams.map((s, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                        <Input placeholder="iOS (@user)" defaultValue={s.ios}
                          onChange={e => setStreams(prev => prev.map((x, j) => j === i ? { ...x, ios: e.target.value, status: e.target.value ? 'filled' : 'missing' } : x))}
                          style={{ fontSize: 11 }} />
                        <Input placeholder="Android (@user)" defaultValue={s.android}
                          onChange={e => setStreams(prev => prev.map((x, j) => j === i ? { ...x, android: e.target.value } : x))}
                          style={{ fontSize: 11 }} />
                        <Input placeholder="Лид (@user)" defaultValue={s.lead}
                          onChange={e => setStreams(prev => prev.map((x, j) => j === i ? { ...x, lead: e.target.value } : x))}
                          style={{ fontSize: 11 }} />
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" style={{ marginTop: 8, alignSelf: 'flex-start' }}
                      onClick={() => {
                        const ios = `#IOS #Release ${release || '?'}\n\nДежурные:\n${streams.filter(s => s.ios).map(s => `${s.name} ${s.ios}`).join('\n')}`;
                        const and = `#Android #Release ${release || '?'}\n\nДежурные:\n${streams.filter(s => s.android).map(s => `${s.name} ${s.android}`).join('\n')}`;
                        setIosText(ios);
                        setAndText(and);
                      }}>
                      Сформировать сообщения ▸
                    </Button>
                  </div>
                )
              }
            </CardBody>
          )}
        </Card>
      )}
    </div>
  );
}
