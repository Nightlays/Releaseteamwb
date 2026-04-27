import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Divider, Badge, Button, Input, Select, FieldLabel, Textarea, LogView, Modal, Table, Th, Td, EmptyState } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';

import { RunMode, RUN_MODE_LABELS, StepStatus, DutyStream } from '../../types';
import {
  runCreatorScenario,
  bandPostMessage,
  bandScheduleMessage,
  majorPublishFeedPost,
  majorFillDuty,
  majorPublishPoll,
  majorPublishReminder,
  majorPublishComponents,
  majorPublishComponentsFromDeployLab,
  majorFillRuns,
  majorCreateReadinessRun,
  ensureMajorStreamsSheet,
  syncMajorWorkflowState,
  buildMajorPollText,
  buildMajorThreadTemplate,
  runCollection,
  refreshCollectionSince,
  buildCurrentDutiesCopyText,
  buildCurrentDutyThreadsCopyText,
  buildSinceWindow,
  publishCollectionPing,
  publishMissingDutyPosts,
  findCollectionUserIds,
  clearBandDutyGroups,
  addBandDutyGroups,
  fetchDutyEditorData,
  saveDutyEditorData,
  fetchMajorReleaseNoticeText,
  majorPublishReleaseNotice,
  fetchDutyPingPendingStreams,
  buildDutyPingMessage,
  postDutyPingToThread,
  runDutyPingPolling,
  refreshMajorPollTextFromAllure,
  fetchMajorYtData,
  fetchNapiHostsText,
  buildNonMajorSwatText,
  publishNonMajorFeedPosts,
  fetchBandPresenceByHandles,
  resolveIosBuildFromBand,
  resolveAndroidBuildFromBot,
  type BandPresenceStatus,
  type DutyPingState,
  type MajorYtData,
  COLLECTION_WORKFLOW_STEPS,
  DUTY_EDITOR_DOC_URL,
  DUTY_EDITOR_JSON_URL,
  SWAT_CHANNEL_ID,
  FEED_CHANNEL_ID,
  type LogLevel,
  type LaunchRecord,
  type CollectionRow,
  type CollectionResult,
  type CollectionIdMaps,
  type DutyEditorData,
  type DutyEditorLeadEntry,
  type DutyEditorStreamGroupEntry,
} from '../../services/launch';
import { checkProxy } from '../../services/proxy';

// ─── PUSH STEP DEFINITIONS ──────────────────────────────────────
interface PushStepDef {
  code: string;
  title: string;
}

const PUSH_IOS_STEPS: PushStepDef[] = [
  { code: '1', title: 'Опубликовать в ленту релизов' },
  { code: '2', title: 'Добавить дежурных из сбора' },
  { code: '3', title: 'Таблица стримов (Google Sheets)' },
  { code: '4', title: 'Отправить опрос в тред' },
  { code: '5', title: 'Напоминание @qadutyios' },
  { code: '6', title: 'Опубликовать компоненты' },
  { code: '7', title: 'Заполнить раны Allure' },
  { code: '8', title: 'Создание рана готовности (оки)' },
];

const PUSH_AND_STEPS: PushStepDef[] = [
  { code: '1', title: 'Опубликовать в ленту релизов' },
  { code: '2', title: 'Добавить дежурных из сбора' },
  { code: '3', title: 'Таблица стримов (Google Sheets)' },
  { code: '4', title: 'Отправить опрос в тред' },
  { code: '5', title: 'Напоминание @qadutyandr' },
  { code: '6', title: 'Опубликовать компоненты' },
  { code: '7', title: 'Заполнить раны Allure' },
  { code: '8', title: 'Создание рана готовности (оки)' },
];

type PushStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

// ─── MODES ──────────────────────────────────────────────────────
const MODES: Array<{ id: RunMode; icon: string; desc: string }> = [
  { id: 'major',            icon: '🚀', desc: 'Полный цикл Android + iOS' },
  { id: 'hf_android',       icon: '🤖', desc: 'Хот-фикс для Android' },
  { id: 'hf_ios',           icon: '🍎', desc: 'Хот-фикс для iOS' },
  { id: 'napi',             icon: '⚡', desc: 'Native API платёжного модуля' },
  { id: 'sunday_devices',   icon: '📱', desc: 'Еженедельный прогон устройств' },
  { id: 'rustore_critical', icon: '🏪', desc: 'RuStore / AppGallery — Крит-путь' },
  { id: 'rustore_smoke',    icon: '🏪', desc: 'RuStore / AppGallery — Smoke' },
];

// ─── HELPERS ────────────────────────────────────────────────────
const STATUS_ICONS: Record<PushStatus, string> = {
  pending: '○', running: '↻', done: '✓', error: '✕', skipped: '–',
};
const STATUS_COLORS: Record<PushStatus, string> = {
  pending: 'var(--text-3)', running: '#F59E0B', done: '#22C55E', error: '#EF4444', skipped: 'var(--text-3)',
};

function firstPendingIndex(statuses: PushStatus[]): number {
  const idx = statuses.findIndex(status => status === 'pending' || status === 'error');
  return idx === -1 ? statuses.length : idx;
}

function buildCollectionWorkflowStatuses(
  rows: CollectionRow[],
  pingTextValue: string,
  pingFound: boolean,
): PushStatus[] {
  const missingCount = rows.filter(row => row.missing).length;
  return [
    pingTextValue ? (pingFound ? 'done' : 'pending') : 'skipped',
    missingCount > 0 ? 'pending' : 'skipped',
    'pending',
    'pending',
    'pending',
  ];
}

function stringifyStreamList(streams: string[]): string {
  return streams.join(', ');
}

function parseStreamList(input: string): string[] {
  return input
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function rowBg(status: PushStatus, isCurrent: boolean, isLocked: boolean): string {
  if (status === 'done')    return 'rgba(34,197,94,.06)';
  if (status === 'skipped') return 'rgba(239,68,68,.06)';
  if (status === 'error')   return 'rgba(239,68,68,.08)';
  if (status === 'running') return 'rgba(245,158,11,.08)';
  if (isCurrent) return 'rgba(155,92,255,.05)';
  if (isLocked) return 'rgba(0,0,0,.02)';
  return 'var(--surface-soft)';
}
function rowBorder(status: PushStatus, isCurrent: boolean, isLocked: boolean): string {
  if (status === 'done')    return 'rgba(34,197,94,.15)';
  if (status === 'skipped') return 'rgba(239,68,68,.15)';
  if (status === 'error')   return 'rgba(239,68,68,.2)';
  if (status === 'running') return 'rgba(245,158,11,.2)';
  if (isCurrent) return 'rgba(155,92,255,.25)';
  return 'var(--surface-soft-4)';
}

function buildCollectionWorkflowHint(
  statuses: PushStatus[],
  rows: CollectionRow[],
  currentIdx: number,
): { text: string; color: 'green' | 'yellow' | 'gray' } {
  const finished = currentIdx >= COLLECTION_WORKFLOW_STEPS.length;
  if (finished) {
    return { text: 'Все шаги пройдены. Можно запускать следующий цикл.', color: 'green' };
  }
  if (!rows.length) {
    return {
      text: 'Начните сбор дежурных и дождитесь выполнения, затем переходите к шагам.',
      color: 'yellow',
    };
  }
  const current = COLLECTION_WORKFLOW_STEPS[currentIdx];
  if (!current) {
    return { text: 'Workflow готов к запуску.', color: 'gray' };
  }
  return { text: `Текущий шаг: ${current.code} — ${current.title}`, color: 'gray' };
}

function workflowStatusLabel(status: PushStatus): string {
  if (status === 'done') return 'Выполнено';
  if (status === 'skipped') return 'Пропущено';
  if (status === 'running') return 'Выполняется';
  if (status === 'error') return 'Ошибка';
  return 'Ожидает';
}

// ─── PUSH STEP ROW ───────────────────────────────────────────────
function PushStepRow({
  step, idx, status, currentIdx, running,
  onExecute, onSkip, onRetry,
  manualActionLabel,
  onManualAction,
}: {
  step: PushStepDef;
  idx: number;
  status: PushStatus;
  currentIdx: number;
  running: boolean;
  onExecute: () => void;
  onSkip: () => void;
  onRetry: () => void;
  manualActionLabel?: string;
  onManualAction?: () => void;
}) {
  const isCurrent = status === 'pending' && idx === currentIdx;
  const isLocked  = status === 'pending' && idx > currentIdx;
  const isDoneOrSkip = status === 'done' || status === 'skipped';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
      padding: '10px 14px', borderRadius: 12,
      background: rowBg(status, isCurrent, isLocked),
      border: `1px solid ${rowBorder(status, isCurrent, isLocked)}`,
      opacity: isLocked ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0,
          color: STATUS_COLORS[status],
          animation: status === 'running' ? 'spin .8s linear infinite' : 'none',
        }}>{STATUS_ICONS[status]}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {step.code}. {step.title}
          </div>
          {isLocked && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>Заблокирован</div>}
          {status === 'done' && <div style={{ fontSize: 10, color: '#22C55E', marginTop: 2 }}>Выполнено</div>}
          {status === 'skipped' && <div style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }}>Пропущено</div>}
          {status === 'error' && <div style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }}>Ошибка</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {isDoneOrSkip && (
          <>
            {status === 'done' && manualActionLabel && onManualAction && (
              <Button variant="ghost" size="sm" disabled={running} onClick={onManualAction}>
                {manualActionLabel}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={running} onClick={onRetry}>Повторить</Button>
          </>
        )}
        {!isDoneOrSkip && (
          <>
            <Button variant="ghost" size="sm" disabled={running || isLocked || status === 'running'} onClick={onSkip}>
              Пропустить
            </Button>
            <Button
              variant="primary" size="sm"
              disabled={running || isLocked || !isCurrent}
              onClick={onExecute}
            >
              Выполнить
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CollectionStepRow({
  idx,
  status,
  currentIdx,
  running,
  pingFound,
  hasCollectionRows,
  step,
  onYes,
  onNo,
  onRetry,
}: {
  idx: number;
  status: PushStatus;
  currentIdx: number;
  running: boolean;
  pingFound: boolean;
  hasCollectionRows: boolean;
  step: { code: string; title: string };
  onYes: () => void;
  onNo: () => void;
  onRetry: () => void;
}) {
  const finished = currentIdx >= COLLECTION_WORKFLOW_STEPS.length;
  const isCurrent = !finished && idx === currentIdx;
  const isLockedByCollection = idx === 0 && !hasCollectionRows;
  const isLockedBySequence = !finished && status === 'pending' && idx > currentIdx;
  const isLocked = isLockedByCollection || isLockedBySequence;
  const doneOrSkipped = status === 'done' || status === 'skipped';
  const icon = isLocked ? '🔒' : status === 'done' ? '✅' : status === 'skipped' ? '❌' : status === 'running' ? '⏳' : status === 'error' ? '✕' : '○';
  const badgeColor = isLocked ? 'gray' : status === 'done' ? 'green' : status === 'skipped' ? 'red' : status === 'running' ? 'yellow' : status === 'error' ? 'red' : 'gray';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        background: rowBg(status, isCurrent, isLocked),
        border: `1px solid ${rowBorder(status, isCurrent, isLocked)}`,
        opacity: isLocked ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 10, minWidth: 260 }}>
        <span style={{ fontSize: 14, lineHeight: '20px', width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {step.code}. {step.title}
          </div>
          <div style={{ marginTop: 4 }}>
            <Badge color={badgeColor}>{isLocked ? 'Заблокирован' : workflowStatusLabel(status)}</Badge>
          </div>
          {isLockedByCollection && (
            <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-3)' }}>
              Начните сбор дежурных и дождитесь выполнения
            </div>
          )}
          {idx === 0 && pingFound && (
            <div style={{ fontSize: 11, marginTop: 6, color: '#22C55E' }}>
              Сообщение пинг найдено
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {doneOrSkipped ? (
          <Button variant="ghost" size="sm" disabled={running} onClick={onRetry}>
            Повторить
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={running || finished || !isCurrent || status !== 'pending' || isLockedByCollection}
              onClick={onYes}
            >
              Да
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={running || finished || !isCurrent || status !== 'pending' || isLockedByCollection}
              onClick={onNo}
            >
              Нет
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── DUTY TABLE ─────────────────────────────────────────────────
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
            <tr>{['#', 'Стрим', 'iOS', 'Android', 'Лид', ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {streams.map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)' }}>{i + 1}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border-subtle)' }}>{s.name}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.ios || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.android || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-2)', borderBottom: '1px solid var(--border-subtle)' }}>{s.lead || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
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

// ─── SCHEDULE PICKER ─────────────────────────────────────────────
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

// ─── SCHEDULING HELPERS ──────────────────────────────────────────
const LS_STEP_SCHEDULES = 'wb_rl_step_schedules_v1';
const LS_AUTOMATION_PLAN = 'wb_rl_automation_v1';
const MSK_OFF_S = 3 * 60 * 60 * 1000;

interface StepSchedulePlan {
  key: string;
  platform: 'ios' | 'android';
  stepIdx: number;
  targetMs: number;
  triggerMode: 'delay' | 'schedule';
  delayMinutes: number | null;
  note?: string;
}

interface AutomationPlan {
  triggerMode: 'delay' | 'schedule';
  targetMs: number;
  snapshot: {
    mode: RunMode;
    release: string;
    buildValue: string;
    swatLead: 'none' | 'viktor' | 'roman';
  };
}

function mskDateStr(ms: number) {
  const d = new Date(ms + MSK_OFF_S);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function mskTimeStr(ms: number) {
  const d = new Date(ms + MSK_OFF_S);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function parseMskToUtcMs(date: string, time: string): number {
  const [y, mo, day] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, day, h, mi, 0, 0) - MSK_OFF_S;
}
function schedCountdown(targetMs: number): string {
  const delta = Math.max(0, targetMs - Date.now());
  const min = Math.ceil(delta / 60000);
  if (min <= 1) return 'менее минуты';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}
function stepSK(platform: string, stepIdx: number) { return `push-${platform}-${stepIdx}`; }
function loadStepSchedules(): Record<string, StepSchedulePlan> {
  try { return JSON.parse(localStorage.getItem(LS_STEP_SCHEDULES) || '{}') || {}; } catch { return {}; }
}
function saveStepSchedules(s: Record<string, StepSchedulePlan>) {
  try { localStorage.setItem(LS_STEP_SCHEDULES, JSON.stringify(s)); } catch {}
}
function loadAutomationPlan(): AutomationPlan | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_AUTOMATION_PLAN) || 'null');
    if (!raw || !Number.isFinite(raw.targetMs) || !raw.snapshot?.mode) return null;
    return raw as AutomationPlan;
  } catch { return null; }
}
function saveAutomationPlan(plan: AutomationPlan | null) {
  try {
    if (plan) localStorage.setItem(LS_AUTOMATION_PLAN, JSON.stringify(plan));
    else localStorage.removeItem(LS_AUTOMATION_PLAN);
  } catch {}
}

// ─── STEP SCHEDULE BLOCK ─────────────────────────────────────────
function StepScheduleBlock({
  plan, tick, disabled, onDelay, onAtTime, onCancel,
}: {
  plan?: StepSchedulePlan;
  tick: number;
  disabled: boolean;
  onDelay: (minutes: number) => void;
  onAtTime: (date: string, time: string) => void;
  onCancel: () => void;
}) {
  void tick;
  const def15 = Date.now() + 15 * 60 * 1000;
  const [delayMin, setDelayMin] = useState(10);
  const [date, setDate] = useState(() => mskDateStr(def15));
  const [time, setTime] = useState(() => mskTimeStr(def15));
  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 8,
    border: '1px solid var(--border-hi)',
    background: 'var(--surface-soft-4)', color: 'var(--text)',
    fontSize: 12, outline: 'none',
  };
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,.1)', border: '1px solid var(--border)' }}>
      {plan && (
        <div style={{ fontSize: 11, color: '#22C55E', marginBottom: 6 }}>
          ⏰ через {schedCountdown(plan.targetMs)}{plan.note ? ` · ${plan.note}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number" min={1} step={1} value={delayMin}
          onChange={e => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
          disabled={disabled} style={{ ...inputStyle, width: 56 }}
        />
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onDelay(delayMin)}>Таймер</Button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={disabled} style={inputStyle} />
        <input type="time" value={time} step={60} onChange={e => setTime(e.target.value)} disabled={disabled} style={inputStyle} />
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onAtTime(date, time)}>По времени</Button>
        {plan && (
          <Button variant="ghost" size="sm" style={{ color: '#EF4444' }} disabled={disabled} onClick={onCancel}>Отменить</Button>
        )}
      </div>
    </div>
  );
}

// ─── AUTOMATION BLOCK ────────────────────────────────────────────
const AUTOMATION_SUPPORTED: RunMode[] = ['hf_android', 'hf_ios', 'napi', 'rustore_critical', 'rustore_smoke'];
function AutomationBlock({
  mode, running, automationRunning, plan, tick, onSchedule, onCancel,
}: {
  mode: RunMode;
  running: boolean;
  automationRunning: boolean;
  plan: AutomationPlan | null;
  tick: number;
  onSchedule: (triggerMode: 'delay' | 'schedule', delayMin: number, date: string, time: string) => void;
  onCancel: () => void;
}) {
  void tick;
  const def15 = Date.now() + 15 * 60 * 1000;
  const [triggerMode, setTriggerMode] = useState<'delay' | 'schedule'>('delay');
  const [delayMin, setDelayMin] = useState(10);
  const [date, setDate] = useState(() => mskDateStr(def15));
  const [time, setTime] = useState(() => mskTimeStr(def15));

  const supported = AUTOMATION_SUPPORTED.includes(mode);
  const busy = running || automationRunning;
  if (!supported && !plan && !automationRunning) return null;

  const scenarioText = mode === 'napi'
    ? 'Сценарий: создаст ран, опубликует SWAT Team Only.'
    : 'Сценарий: создаст ран, опубликует SWAT Team Only, обновит ленту релизов.';

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 8,
    border: '1px solid var(--border-hi)',
    background: 'var(--surface-soft-4)', color: 'var(--text)',
    fontSize: 12, outline: 'none',
  };

  return (
    <>
      <Divider />
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Автозапуск</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{scenarioText}</div>

      {automationRunning && (
        <div style={{ fontSize: 12, color: '#F59E0B' }}>⟳ Автосценарий выполняется...</div>
      )}
      {!automationRunning && plan && (
        <div style={{ fontSize: 12, color: '#22C55E' }}>
          ⏰ {RUN_MODE_LABELS[plan.snapshot.mode]} · через {schedCountdown(plan.targetMs)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['delay', 'schedule'] as const).map(m => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text-2)' }}>
            <input type="radio" name="automTrigger" checked={triggerMode === m} onChange={() => setTriggerMode(m)} disabled={busy} style={{ accentColor: '#9B5CFF' }} />
            {m === 'delay' ? 'Через (мин)' : 'По времени'}
          </label>
        ))}
        {triggerMode === 'delay' && (
          <input type="number" min={1} step={1} value={delayMin}
            onChange={e => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
            disabled={busy} style={{ ...inputStyle, width: 56 }}
          />
        )}
        {triggerMode === 'schedule' && (
          <>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={busy} style={inputStyle} />
            <input type="time" value={time} step={60} onChange={e => setTime(e.target.value)} disabled={busy} style={inputStyle} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="secondary" size="sm" disabled={busy || !supported}
          onClick={() => onSchedule(triggerMode, delayMin, date, time)}>
          Запланировать
        </Button>
        {plan && !automationRunning && (
          <Button variant="ghost" size="sm" style={{ color: '#EF4444' }} onClick={onCancel}>Отменить</Button>
        )}
      </div>
    </>
  );
}

// ─── MAJOR PLATFORM PANEL ────────────────────────────────────────
function MajorPlatformPanel({
  platform, release, threadText, statuses, currentIdx, running,
  streams, pollText, componentsText,
  onReleaseChange, onThreadTextChange,
  onExecuteStep, onSkipStep, onRetryStep,
}: {
  platform: 'ios' | 'android';
  release: string;
  threadText: string;
  statuses: PushStatus[];
  currentIdx: number;
  running: boolean;
  streams: DutyStream[];
  pollText: string;
  componentsText: string;
  onReleaseChange: (v: string) => void;
  onThreadTextChange: (v: string) => void;
  onExecuteStep: (idx: number) => void;
  onSkipStep: (idx: number) => void;
  onRetryStep: (idx: number) => void;
}) {
  const steps = platform === 'ios' ? PUSH_IOS_STEPS : PUSH_AND_STEPS;
  const label = platform === 'ios' ? 'iOS' : 'Android';
  const accent = platform === 'ios' ? 'rgba(0,122,255,.15)' : 'rgba(52,199,89,.15)';

  const doneCount = statuses.filter(s => s === 'done').length;
  const allDone = doneCount >= steps.length;

  const [tab, setTab] = useState<'steps' | 'thread'>('steps');

  return (
    <Card style={{ border: `1px solid ${accent}` }}>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>{platform === 'ios' ? '🍎' : '🤖'}</span>
          <CardTitle>{label}</CardTitle>
          {allDone ? <Badge color="green">Готово</Badge> : <Badge color={running ? 'yellow' : 'gray'}>{doneCount}/{steps.length}</Badge>}
        </div>
      </CardHeader>

      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
        <FieldLabel>Версия {label}</FieldLabel>
        <Input
          value={release}
          onChange={e => onReleaseChange(e.target.value)}
          placeholder={`например: 7.3.5420`}
          style={{ fontSize: 13 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
        {(['steps', 'thread'] as const).map(v => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none', fontFamily: 'inherit',
            borderBottom: `2px solid ${tab === v ? '#9B5CFF' : 'transparent'}`,
            color: tab === v ? 'var(--text)' : 'var(--text-2)',
            marginBottom: -1, transition: 'all .12s',
          }}>
            {v === 'steps' ? `Шаги (${doneCount}/${steps.length})` : 'Тред'}
          </button>
        ))}
      </div>

      {tab === 'steps' && (
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((step, idx) => (
            <PushStepRow
              key={idx}
              step={step}
              idx={idx}
              status={statuses[idx] ?? 'pending'}
              currentIdx={currentIdx}
              running={running}
              onExecute={() => onExecuteStep(idx)}
              onSkip={() => onSkipStep(idx)}
              onRetry={() => onRetryStep(idx)}
            />
          ))}
        </CardBody>
      )}

      {tab === 'thread' && (
        <CardBody>
          <FieldLabel>Сообщение в тред</FieldLabel>
          <Textarea
            value={threadText}
            onChange={e => onThreadTextChange(e.target.value)}
            rows={18}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
          <Button variant="ghost" size="sm" style={{ marginTop: 6 }}
            onClick={() => navigator.clipboard.writeText(threadText)}>
            Скопировать
          </Button>
        </CardBody>
      )}
    </Card>
  );
}

// ─── LAUNCH MODULE ───────────────────────────────────────────────
export function Launch() {
  const { settings } = useSettings();

  const [mode, setMode] = useState<RunMode>('major');
  const [release, setRelease] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [createdRuns, setCreatedRuns] = useState<LaunchRecord[]>([]);
  const [steps, setSteps] = useState<Array<{ id: string; label: string; status: StepStatus; detail?: string }>>([]);
  const [buildValue, setBuildValue] = useState('');
  const [buildResolving, setBuildResolving] = useState(false);
  const [swatLead, setSwatLead] = useState<'none' | 'viktor' | 'roman'>('none');
  const [nonMajorCopyMessage, setNonMajorCopyMessage] = useState('');
  const [nonMajorYtData, setNonMajorYtData] = useState<MajorYtData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ─── step scheduling ───────────────────────────────────────────
  const [stepSchedules, setStepSchedules] = useState<Record<string, StepSchedulePlan>>(loadStepSchedules);
  const stepTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [scheduleTick, setScheduleTick] = useState(0);
  const scheduleTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executeMajorStepRef = useRef<((platform: 'ios' | 'android', stepIdx: number) => Promise<void>) | null>(null);

  // ─── automation plan ───────────────────────────────────────────
  const [automationPlan, setAutomationPlan] = useState<AutomationPlan | null>(loadAutomationPlan);
  const [automationRunning, setAutomationRunning] = useState(false);
  const automationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [automTick, setAutomTick] = useState(0);
  const automTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executeAutomationRef = useRef<((plan: AutomationPlan) => Promise<void>) | null>(null);

  const [streams, setStreams] = useState<DutyStream[]>([]);
  const [pollText, setPollText] = useState('');
  const [iosRelease, setIosRelease] = useState('');
  const [andRelease, setAndRelease] = useState('');
  const [iosText, setIosText] = useState('');
  const [andText, setAndText] = useState('');
  const [iosStatuses, setIosStatuses] = useState<PushStatus[]>(PUSH_IOS_STEPS.map(() => 'pending' as PushStatus));
  const [andStatuses, setAndStatuses] = useState<PushStatus[]>(PUSH_AND_STEPS.map(() => 'pending' as PushStatus));
  const iosStatusesRef = useRef<PushStatus[]>(PUSH_IOS_STEPS.map(() => 'pending' as PushStatus));
  const andStatusesRef = useRef<PushStatus[]>(PUSH_AND_STEPS.map(() => 'pending' as PushStatus));
  const [iosCurrentIdx, setIosCurrentIdx] = useState(0);
  const [andCurrentIdx, setAndCurrentIdx] = useState(0);
  const [iosRunning, setIosRunning] = useState(false);
  const [andRunning, setAndRunning] = useState(false);
  const [iosSyncing, setIosSyncing] = useState(false);
  const [andSyncing, setAndSyncing] = useState(false);
  const [iosComponents, setIosComponents] = useState('');
  const [andComponents, setAndComponents] = useState('');
  const [majorTab, setMajorTab] = useState<'collection' | 'release' | 'ping' | 'editor'>('collection');

  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeText, setNoticeText] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeRunning, setNoticeRunning] = useState(false);

  const [dutyPingPlatform, setDutyPingPlatform] = useState<'ios' | 'android'>('ios');
  const [dutyPingStreams, setDutyPingStreams] = useState<string[]>([]);
  const [dutyPingMessage, setDutyPingMessage] = useState('');
  const [dutyPingLoading, setDutyPingLoading] = useState(false);
  const [dutyPingRunning, setDutyPingRunning] = useState(false);
  const [dutyPingPolling, setDutyPingPolling] = useState(false);
  const [dutyPingPollState, setDutyPingPollState] = useState<DutyPingState | null>(null);
  const dutyPingAbortRef = useRef<AbortController | null>(null);
  const iosCompTimerRef = useRef<number | null>(null);
  const andCompTimerRef = useRef<number | null>(null);

  const [collectionRunning, setCollectionRunning] = useState(false);
  const [collectionRows, setCollectionRows] = useState<CollectionRow[]>([]);
  const [collectionLogs, setCollectionLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [collectionSinceMs, setCollectionSinceMs] = useState<number | null>(null);
  const [collectionMessages, setCollectionMessages] = useState<string[]>([]);
  const [collectionPingFound, setCollectionPingFound] = useState(false);
  const [collectionIdMaps, setCollectionIdMaps] = useState<CollectionIdMaps>({ ios: {}, android: {} });
  const [collectionWorkflowStatuses, setCollectionWorkflowStatuses] =
    useState<PushStatus[]>(COLLECTION_WORKFLOW_STEPS.map(() => 'pending'));
  const [collectionWorkflowCurrentIdx, setCollectionWorkflowCurrentIdx] = useState(0);
  const [pingText, setPingText] = useState('');
  const [sinceLabel, setSinceLabel] = useState('');
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [pingCollapsed, setPingCollapsed] = useState(false);
  const collectionAbortRef = useRef<AbortController | null>(null);

  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorStatus, setEditorStatus] = useState<{ text: string; level: LogLevel | 'idle' }>({ text: '', level: 'idle' });
  const [editorLoadedOnce, setEditorLoadedOnce] = useState(false);
  const [editorLeads, setEditorLeads] = useState<DutyEditorLeadEntry[]>([]);
  const [editorStreamGroups, setEditorStreamGroups] = useState<DutyEditorStreamGroupEntry[]>([]);
  const [editorTablesText, setEditorTablesText] = useState('[]');
  const [editorMeta, setEditorMeta] = useState<Record<string, unknown>>({});
  const [editorAllureLeaves, setEditorAllureLeaves] = useState<string[]>([]);
  const [editorLeadsCollapsed, setEditorLeadsCollapsed] = useState(false);
  const [editorStreamGroupsCollapsed, setEditorStreamGroupsCollapsed] = useState(false);
  const [editorPresence, setEditorPresence] = useState<Record<string, BandPresenceStatus>>({});
  const [editorPresenceLoading, setEditorPresenceLoading] = useState(false);

  const token = String(settings.allureToken || '').replace(/^Api-Token\s+/i, '').trim();
  const cookies = String(settings.bandCookies || '').trim();
  const adminCookies = String(settings.bandCookiesAdmin || '').trim();
  const proxyBase = String(settings.proxyBase || '').trim();
  const gasUrl = String(settings.gasUrl || '').trim();

  const log = useCallback((text: string, level: LogLevel = 'info') =>
    setLogs(prev => [...prev.slice(-300), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]), []);

  const collLog = useCallback((text: string, level: LogLevel = 'info') =>
    setCollectionLogs(prev => [...prev.slice(-300), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]), []);

  const collectionStats = useMemo(() => {
    const missingCount = collectionRows.filter(row => row.missing).length;
    return {
      total: collectionRows.length,
      filled: collectionRows.length - missingCount,
      missing: missingCount,
      messages: collectionMessages.length,
      iosIds: Object.keys(collectionIdMaps.ios || {}).length,
      androidIds: Object.keys(collectionIdMaps.android || {}).length,
    };
  }, [collectionRows, collectionMessages, collectionIdMaps]);

  const collectionWorkflowHint = useMemo(
    () => buildCollectionWorkflowHint(collectionWorkflowStatuses, collectionRows, collectionWorkflowCurrentIdx),
    [collectionWorkflowStatuses, collectionRows, collectionWorkflowCurrentIdx],
  );

  const majorPollStatusText = useMemo(() => {
    if (!pollText.trim()) return 'Получаем стримы из Allure...';
    return 'Опрос готов к отправке.';
  }, [pollText]);

  const mapRowsToDutyStreams = useCallback((rows: CollectionRow[]): DutyStream[] => {
    return rows.map(row => {
      const leadList = [...new Set([...row.iosLeads, ...row.androidLeads])];
      const hasBoth = Boolean(row.iosDuty && row.androidDuty);
      return {
        name: row.streamDisplay || row.stream,
        ios: row.iosDuty || '',
        android: row.androidDuty || '',
        lead: leadList.join(', '),
        status: row.missing ? 'missing' : hasBoth ? 'filled' : 'partial',
      };
    });
  }, []);

  const updatePlatformWorkflow = useCallback((
    platform: 'ios' | 'android',
    nextStatuses: PushStatus[],
  ) => {
    if (platform === 'ios') {
      iosStatusesRef.current = nextStatuses;
      setIosStatuses(nextStatuses);
      setIosCurrentIdx(firstPendingIndex(nextStatuses));
      return;
    }
    andStatusesRef.current = nextStatuses;
    setAndStatuses(nextStatuses);
    setAndCurrentIdx(firstPendingIndex(nextStatuses));
  }, []);

  const syncMajorPlatform = useCallback(async (
    platform: 'ios' | 'android',
    options?: {
      silent?: boolean;
      preserveLocal?: boolean;
      seedStatuses?: PushStatus[];
      applyThreadText?: boolean;
    },
  ) => {
    const isIos = platform === 'ios';
    const releaseValue = String(isIos ? iosRelease : andRelease).trim();
    const setSyncing = isIos ? setIosSyncing : setAndSyncing;
    const currentStatuses = options?.seedStatuses || (isIos ? iosStatusesRef.current : andStatusesRef.current);
    const emptyStatuses = (isIos ? PUSH_IOS_STEPS : PUSH_AND_STEPS).map(() => 'pending' as PushStatus);

    if (!releaseValue) {
      updatePlatformWorkflow(platform, emptyStatuses);
      return;
    }

    if (!cookies) {
      if (!options?.silent) {
        log(`[${isIos ? 'iOS' : 'Android'}] Нужны Band cookies для синхронизации workflow.`, 'warn');
      }
      return;
    }

    setSyncing(true);
    try {
      const resolved = await syncMajorWorkflowState(platform, releaseValue, token, proxyBase, cookies);
      let nextStatuses = resolved.statuses.map(status => status === 'done' ? 'done' : 'pending') as PushStatus[];
      if (options?.preserveLocal) {
        nextStatuses = nextStatuses.map((status, idx) => {
          const localStatus = currentStatuses[idx];
          if (status === 'done') return 'done';
          if (localStatus === 'skipped') return 'skipped';
          if (localStatus === 'error') return 'error';
          return 'pending';
        });
      }
      updatePlatformWorkflow(platform, nextStatuses);
      if (resolved.threadText && options?.applyThreadText !== false) {
        if (isIos) setIosText(resolved.threadText);
        else setAndText(resolved.threadText);
      }
      if (!options?.silent) {
        log(
          `[${isIos ? 'iOS' : 'Android'}] Workflow синхронизирован${resolved.finalRunUrl ? ' (найден финальный ран).' : '.'}`,
          'ok',
        );
      }
    } catch (error) {
      if (!options?.silent) {
        log(
          `[${isIos ? 'iOS' : 'Android'}] Ошибка синхронизации workflow: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    } finally {
      setSyncing(false);
    }
  }, [
    iosRelease,
    andRelease,
    updatePlatformWorkflow,
    cookies,
    token,
    proxyBase,
    log,
  ]);

  const applyCollectionResult = useCallback((
    result: CollectionResult,
    preserveStatuses = false,
    statusesSeed?: PushStatus[],
  ) => {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const dutyStreams = mapRowsToDutyStreams(rows);
    setCollectionRows(rows);
    setCollectionSinceMs(result.sinceMs);
    setCollectionMessages(Array.isArray(result.messages) ? result.messages : []);
    setCollectionPingFound(Boolean(result.pingFound));
    setPingText(result.pingText || '');
    setSinceLabel(
      result.sinceMs
        ? `${new Date(result.sinceMs).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })} МСК`
        : '',
    );
    setCollectionIdMaps({ ios: {}, android: {} });
    setStreams(dutyStreams);
    if (dutyStreams.length) {
      try {
        setPollText(buildMajorPollText(dutyStreams.map(stream => stream.name)));
      } catch {
        // ignore poll generation errors
      }
    }

    let nextStatuses = buildCollectionWorkflowStatuses(rows, result.pingText || '', Boolean(result.pingFound));
    if (preserveStatuses && statusesSeed?.length) {
      nextStatuses = nextStatuses.map((status, idx) => {
        if (idx < 2 && (statusesSeed[idx] === 'done' || statusesSeed[idx] === 'skipped')) return statusesSeed[idx];
        if (idx >= 2) return 'pending';
        return status;
      });
    }
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
  }, [mapRowsToDutyStreams]);

  const ensureCollectionRowsForMajorStep = useCallback(async (): Promise<CollectionRow[]> => {
    if (collectionRows.length) return collectionRows;
    const ac = new AbortController();
    collectionAbortRef.current = ac;
    setCollectionRunning(true);
    try {
      const result = await runCollection(proxyBase, cookies, token, gasUrl, collLog, ac.signal);
      applyCollectionResult(result);
      return result.rows;
    } finally {
      collectionAbortRef.current = null;
      setCollectionRunning(false);
    }
  }, [collectionRows, proxyBase, cookies, token, gasUrl, collLog, applyCollectionResult]);

  const resetCollectionWorkflow = useCallback(() => {
    const nextStatuses = buildCollectionWorkflowStatuses(collectionRows, pingText, collectionPingFound);
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
    setCollectionIdMaps({ ios: {}, android: {} });
    collLog('Workflow сброшен.', 'warn');
  }, [collectionRows, pingText, collectionPingFound, collLog]);

  const skipCollectionWorkflowStep = useCallback((idx: number) => {
    if (collectionRunning) return;
    const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
      currentIdx === idx ? 'skipped' : status,
    );
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
    collLog(`${COLLECTION_WORKFLOW_STEPS[idx]?.title || `Шаг ${idx + 1}`}: пропущено по решению пользователя.`, 'warn');
  }, [collectionRunning, collectionWorkflowStatuses, collLog]);

  const retryCollectionWorkflowStep = useCallback((idx: number) => {
    if (collectionRunning) return;
    const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
      currentIdx === idx ? 'pending' : status,
    );
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(Math.min(idx, firstPendingIndex(nextStatuses)));
    collLog(`${COLLECTION_WORKFLOW_STEPS[idx]?.title || `Шаг ${idx + 1}`}: повтор.`, 'warn');
  }, [collectionRunning, collectionWorkflowStatuses, collLog]);

  const executeCollectionWorkflowStep = useCallback(async (idx: number) => {
    if (collectionRunning) return;
    const step = COLLECTION_WORKFLOW_STEPS[idx];
    if (!step) return;
    const rows = await ensureCollectionRowsForMajorStep();
    const ac = new AbortController();
    collectionAbortRef.current = ac;
    setCollectionRunning(true);
    setCollectionWorkflowStatuses(prev => {
      const next = [...prev];
      next[idx] = 'running';
      return next;
    });
    setCollectionWorkflowCurrentIdx(idx);

    try {
      switch (step.action) {
        case 'publishPing': {
          await publishCollectionPing(proxyBase, cookies, rows, ac.signal);
          setCollectionPingFound(true);
          collLog('Пинг опубликован в чат SWAT QA.', 'ok');
          const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          );
          setCollectionWorkflowStatuses(nextStatuses);
          setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
          break;
        }
        case 'publishMissing': {
          await publishMissingDutyPosts(proxyBase, cookies, rows, collLog, ac.signal);
          collLog('Недостающие дежурные опубликованы.', 'ok');
          if (collectionSinceMs) {
            const statusesSeed = collectionWorkflowStatuses.map((status, currentIdx) =>
              currentIdx === idx ? 'done' : status,
            );
            const refreshed = await refreshCollectionSince(proxyBase, cookies, gasUrl, token, collectionSinceMs, collLog, ac.signal);
            applyCollectionResult(refreshed, true, statusesSeed);
          } else {
            const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
              currentIdx === idx ? 'done' : status,
            );
            setCollectionWorkflowStatuses(nextStatuses);
            setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
          }
          break;
        }
        case 'findIds': {
          const idMaps = await findCollectionUserIds(proxyBase, cookies, rows, ac.signal);
          setCollectionIdMaps(idMaps);
          collLog(`user_id: iOS ${Object.keys(idMaps.ios).length}, Android ${Object.keys(idMaps.android).length}.`, 'ok');
          const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          );
          setCollectionWorkflowStatuses(nextStatuses);
          setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
          break;
        }
        case 'clearGroups': {
          await clearBandDutyGroups(proxyBase, cookies, adminCookies, collLog, ac.signal);
          const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          );
          setCollectionWorkflowStatuses(nextStatuses);
          setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
          break;
        }
        case 'addGroups': {
          let nextIdMaps = collectionIdMaps;
          if (!Object.keys(nextIdMaps.ios).length && !Object.keys(nextIdMaps.android).length) {
            nextIdMaps = await findCollectionUserIds(proxyBase, cookies, rows, ac.signal);
            setCollectionIdMaps(nextIdMaps);
            collLog(`user_id подготовлены автоматически: iOS ${Object.keys(nextIdMaps.ios).length}, Android ${Object.keys(nextIdMaps.android).length}.`, 'ok');
          }
          await addBandDutyGroups(proxyBase, cookies, adminCookies, nextIdMaps, collLog, ac.signal);
          const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          );
          setCollectionWorkflowStatuses(nextStatuses);
          setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      collLog(`${step.title}: ${message}`, 'error');
      setCollectionWorkflowStatuses(prev => {
        const next = [...prev];
        next[idx] = 'error';
        return next;
      });
    } finally {
      setCollectionRunning(false);
      collectionAbortRef.current = null;
    }
  }, [
    collectionRunning,
    collectionWorkflowStatuses,
    ensureCollectionRowsForMajorStep,
    proxyBase,
    cookies,
    collLog,
    collectionSinceMs,
    gasUrl,
    token,
    applyCollectionResult,
    collectionIdMaps,
    adminCookies,
  ]);

  const loadEditor = useCallback(async (force = false) => {
    if (editorLoading || (editorLoadedOnce && !force)) return;
    setEditorLoading(true);
    setEditorStatus({ text: 'Загрузка данных редактора...', level: 'info' });
    try {
      const data = await fetchDutyEditorData(proxyBase, token);
      setEditorLeads(data.leadsEntries);
      setEditorStreamGroups(data.streamEntries);
      setEditorTablesText(JSON.stringify(Array.isArray(data.tables) ? data.tables : [], null, 2));
      setEditorMeta(data.meta || {});
      setEditorAllureLeaves(Array.isArray(data.allureLeaves) ? data.allureLeaves : []);
      setEditorDirty(false);
      setEditorLoadedOnce(true);
      setEditorStatus({ text: 'Редактор загружен.', level: 'ok' });
    } catch (error) {
      setEditorStatus({ text: error instanceof Error ? error.message : String(error), level: 'error' });
    } finally {
      setEditorLoading(false);
    }
  }, [editorLoading, editorLoadedOnce, proxyBase, token]);

  const saveEditor = useCallback(async () => {
    if (editorSaving) return;
    setEditorSaving(true);
    setEditorStatus({ text: 'Сохранение...', level: 'info' });
    try {
      const parsed = JSON.parse(editorTablesText || '[]');
      if (!Array.isArray(parsed)) {
        throw new Error('Tables JSON должен быть массивом.');
      }
      const payload: DutyEditorData = {
        leadsEntries: editorLeads,
        streamEntries: editorStreamGroups,
        tables: parsed,
        meta: editorMeta,
        allureLeaves: editorAllureLeaves,
      };
      const saved = await saveDutyEditorData(proxyBase, payload);
      setEditorLeads(saved.leadsEntries);
      setEditorStreamGroups(saved.streamEntries);
      setEditorTablesText(JSON.stringify(Array.isArray(saved.tables) ? saved.tables : [], null, 2));
      setEditorMeta(saved.meta || {});
      setEditorAllureLeaves(Array.isArray(saved.allureLeaves) ? saved.allureLeaves : []);
      setEditorDirty(false);
      setEditorStatus({ text: 'Редактор сохранён.', level: 'ok' });
    } catch (error) {
      setEditorStatus({ text: error instanceof Error ? error.message : String(error), level: 'error' });
    } finally {
      setEditorSaving(false);
    }
  }, [editorSaving, editorTablesText, editorLeads, editorStreamGroups, editorMeta, editorAllureLeaves, proxyBase]);

  const addLeadRow = useCallback(() => {
    setEditorLeads(prev => [...prev, { handle: '', streams: [] }]);
    setEditorDirty(true);
  }, []);

  const removeLeadRow = useCallback((idx: number) => {
    setEditorLeads(prev => prev.filter((_, currentIdx) => currentIdx !== idx));
    setEditorDirty(true);
  }, []);

  const updateLeadRow = useCallback((idx: number, field: 'handle' | 'streams', value: string) => {
    setEditorLeads(prev => prev.map((row, currentIdx) => {
      if (currentIdx !== idx) return row;
      if (field === 'handle') return { ...row, handle: value };
      return { ...row, streams: parseStreamList(value) };
    }));
    setEditorDirty(true);
  }, []);

  const addStreamGroupRow = useCallback(() => {
    setEditorStreamGroups(prev => [...prev, { name: '', streams: [] }]);
    setEditorDirty(true);
  }, []);

  const removeStreamGroupRow = useCallback((idx: number) => {
    setEditorStreamGroups(prev => prev.filter((_, currentIdx) => currentIdx !== idx));
    setEditorDirty(true);
  }, []);

  const updateStreamGroupRow = useCallback((idx: number, field: 'name' | 'streams', value: string) => {
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => {
      if (currentIdx !== idx) return row;
      if (field === 'name') return { ...row, name: value };
      return { ...row, streams: parseStreamList(value) };
    }));
    setEditorDirty(true);
  }, []);

  useEffect(() => {
    if (iosRelease) setIosText(buildMajorThreadTemplate('ios', iosRelease));
  }, [iosRelease]);

  useEffect(() => {
    if (andRelease) setAndText(buildMajorThreadTemplate('android', andRelease));
  }, [andRelease]);

  useEffect(() => {
    if (mode !== 'major' || majorTab !== 'release') return;
    const timers: number[] = [];
    if (String(iosRelease || '').trim()) {
      timers.push(window.setTimeout(() => {
        void syncMajorPlatform('ios', { silent: true, applyThreadText: true });
      }, 350));
    }
    if (String(andRelease || '').trim()) {
      timers.push(window.setTimeout(() => {
        void syncMajorPlatform('android', { silent: true, applyThreadText: true });
      }, 350));
    }
    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [mode, majorTab, iosRelease, andRelease, syncMajorPlatform]);

  useEffect(() => {
    if (mode === 'major' && majorTab === 'editor' && !editorLoadedOnce) {
      loadEditor();
    }
  }, [mode, majorTab, editorLoadedOnce, loadEditor]);

  const executeMajorStep = useCallback(async (platform: 'ios' | 'android', stepIdx: number) => {
    const isIos = platform === 'ios';
    const rel = isIos ? iosRelease : andRelease;
    const threadTxt = isIos ? iosText : andText;
    const compText = isIos ? iosComponents : andComponents;
    const statuses = isIos ? iosStatuses : andStatuses;
    const stepsDef = isIos ? PUSH_IOS_STEPS : PUSH_AND_STEPS;
    const setRunningPlatform = isIos ? setIosRunning : setAndRunning;

    const ac = new AbortController();
    abortRef.current = ac;
    setRunningPlatform(true);
    updatePlatformWorkflow(platform, statuses.map((status, idx) => idx === stepIdx ? 'running' : status));
    log(`[${isIos ? 'iOS' : 'Android'}] ${stepsDef[stepIdx].title}...`);

    try {
      switch (stepIdx) {
        case 0: {
          let finalThreadTxt = threadTxt;
          const ytBase = String(settings.ytBase || '').trim();
          const ytToken = String(settings.ytToken || '').trim();
          if (ytBase && ytToken) {
            try {
              log(`[${isIos ? 'iOS' : 'Android'}] Загружаю данные из YouTrack...`);
              const ytData: MajorYtData = await fetchMajorYtData(platform, rel, ytBase, ytToken, proxyBase, ac.signal);
              if (ytData.boardUrl) {
                finalThreadTxt = finalThreadTxt.replace(/(Ссылка на доску:)[^\n]*/m, `$1 ${ytData.boardUrl}`);
                log(`[${isIos ? 'iOS' : 'Android'}] Доска YT: ${ytData.boardUrl}`, 'ok');
              }
              if (ytData.ticketKey && ytData.ticketUrl) {
                finalThreadTxt = finalThreadTxt.replace(/(Ссылка на релизный таск:)[^\n]*/m, `$1 [${ytData.ticketKey}](${ytData.ticketUrl})`);
                log(`[${isIos ? 'iOS' : 'Android'}] Тикет: ${ytData.ticketKey}`, 'ok');
              }
              if (isIos) setIosText(finalThreadTxt); else setAndText(finalThreadTxt);
            } catch (ytErr) {
              log(`[${isIos ? 'iOS' : 'Android'}] Ошибка YT: ${ytErr instanceof Error ? ytErr.message : String(ytErr)}`, 'warn');
            }
          }
          await majorPublishFeedPost(platform, rel, finalThreadTxt, proxyBase, cookies, log, ac.signal);
          break;
        }
        case 1: {
          const rows = await ensureCollectionRowsForMajorStep();
          const dutyStreams = mapRowsToDutyStreams(rows);
          await majorFillDuty(platform, rel, dutyStreams, proxyBase, cookies, adminCookies, log, ac.signal, rows);
          break;
        }
        case 2:
          await ensureMajorStreamsSheet(platform, rel, proxyBase, log, ac.signal);
          break;
        case 3: {
          let activePollText = pollText;
          if (token) {
            try {
              log(`[${isIos ? 'iOS' : 'Android'}] Обновляю список стримов из Allure...`);
              const freshPollText = await refreshMajorPollTextFromAllure(token, proxyBase, ac.signal);
              setPollText(freshPollText);
              activePollText = freshPollText;
              log(`[${isIos ? 'iOS' : 'Android'}] Список стримов обновлён.`, 'ok');
            } catch (pollErr) {
              log(`[${isIos ? 'iOS' : 'Android'}] Не удалось обновить стримы: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}`, 'warn');
            }
          }
          await majorPublishPoll(platform, rel, activePollText, proxyBase, cookies, log, ac.signal);
          break;
        }
        case 4:
          await majorPublishReminder(platform, rel, proxyBase, cookies, log, ac.signal);
          break;
        case 5:
          if (settings.deployLabToken) {
            await majorPublishComponentsFromDeployLab(platform, rel, settings.deployLabToken, proxyBase, cookies, log, ac.signal);
          } else if (compText.trim()) {
            await majorPublishComponents(platform, rel, compText, proxyBase, cookies, log, ac.signal);
          } else {
            throw new Error('Задай компоненты вручную или добавь DeployLab token в Настройках.');
          }
          break;
        case 6:
          await majorFillRuns(platform, rel, token, proxyBase, cookies, log, ac.signal);
          break;
        case 7:
          await majorCreateReadinessRun(platform, rel, token, proxyBase, cookies, log, ac.signal);
          break;
        default:
          throw new Error(`Неизвестный шаг ${stepIdx + 1}`);
      }

      const optimisticStatuses = statuses.map((status, idx) => idx === stepIdx ? 'done' : status);
      updatePlatformWorkflow(platform, optimisticStatuses);
      await new Promise(resolve => window.setTimeout(resolve, 250));
      await syncMajorPlatform(platform, {
        silent: false,
        preserveLocal: true,
        seedStatuses: optimisticStatuses,
        applyThreadText: true,
      });
      log(`[${isIos ? 'iOS' : 'Android'}] Шаг ${stepIdx + 1} выполнен.`, 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextStatuses = statuses.map((status, idx) => idx === stepIdx ? 'error' : status);
      updatePlatformWorkflow(platform, nextStatuses);
      log(`[${isIos ? 'iOS' : 'Android'}] ${message}`, 'error');
    } finally {
      setRunningPlatform(false);
      abortRef.current = null;
    }
  }, [
    iosRelease,
    andRelease,
    iosText,
    andText,
    iosComponents,
    andComponents,
    iosStatuses,
    andStatuses,
    proxyBase,
    cookies,
    adminCookies,
    pollText,
    settings.deployLabToken,
    settings.ytBase,
    settings.ytToken,
    token,
    log,
    ensureCollectionRowsForMajorStep,
    mapRowsToDutyStreams,
    updatePlatformWorkflow,
    syncMajorPlatform,
  ]);

  useEffect(() => { executeMajorStepRef.current = executeMajorStep; }, [executeMajorStep]);

  const refreshComponentsMessage = useCallback(async (platform: 'ios' | 'android') => {
    const isIos = platform === 'ios';
    const releaseValue = String(isIos ? iosRelease : andRelease).trim();
    const componentsValue = String(isIos ? iosComponents : andComponents).trim();
    const setRunningPlatform = isIos ? setIosRunning : setAndRunning;

    if (!releaseValue) {
      log(`[${isIos ? 'iOS' : 'Android'}] Сначала укажи версию релиза.`, 'warn');
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setRunningPlatform(true);
    log(`[${isIos ? 'iOS' : 'Android'}] Обновление сообщения по компонентам...`);

    try {
      if (settings.deployLabToken) {
        await majorPublishComponentsFromDeployLab(platform, releaseValue, settings.deployLabToken, proxyBase, cookies, log, ac.signal);
      } else if (componentsValue) {
        await majorPublishComponents(platform, releaseValue, componentsValue, proxyBase, cookies, log, ac.signal);
      } else {
        throw new Error('Задай компоненты вручную или добавь DeployLab token в Настройках.');
      }
      await new Promise(resolve => window.setTimeout(resolve, 250));
      await syncMajorPlatform(platform, {
        silent: false,
        preserveLocal: true,
        applyThreadText: true,
      });
      log(`[${isIos ? 'iOS' : 'Android'}] Сообщение по компонентам обновлено.`, 'ok');
    } catch (error) {
      log(`[${isIos ? 'iOS' : 'Android'}] ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setRunningPlatform(false);
      abortRef.current = null;
    }
  }, [
    iosRelease,
    andRelease,
    iosComponents,
    andComponents,
    settings.deployLabToken,
    proxyBase,
    cookies,
    log,
    syncMajorPlatform,
  ]);

  // Components auto-timer: fires at next :02 of each hour once step 6 (idx=5) is done
  useEffect(() => {
    if (mode !== 'major') return;
    if (iosStatuses[5] !== 'done') {
      if (iosCompTimerRef.current) { window.clearTimeout(iosCompTimerRef.current); iosCompTimerRef.current = null; }
      return;
    }
    const scheduleIos = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(now.getHours() + 1, 2, 0, 0);
      const delay = next.getTime() - Date.now();
      iosCompTimerRef.current = window.setTimeout(() => {
        void refreshComponentsMessage('ios');
        scheduleIos();
      }, delay);
    };
    scheduleIos();
    return () => { if (iosCompTimerRef.current) { window.clearTimeout(iosCompTimerRef.current); iosCompTimerRef.current = null; } };
  }, [mode, iosStatuses, refreshComponentsMessage]);

  useEffect(() => {
    if (mode !== 'major') return;
    if (andStatuses[5] !== 'done') {
      if (andCompTimerRef.current) { window.clearTimeout(andCompTimerRef.current); andCompTimerRef.current = null; }
      return;
    }
    const scheduleAnd = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(now.getHours() + 1, 2, 0, 0);
      const delay = next.getTime() - Date.now();
      andCompTimerRef.current = window.setTimeout(() => {
        void refreshComponentsMessage('android');
        scheduleAnd();
      }, delay);
    };
    scheduleAnd();
    return () => { if (andCompTimerRef.current) { window.clearTimeout(andCompTimerRef.current); andCompTimerRef.current = null; } };
  }, [mode, andStatuses, refreshComponentsMessage]);

  const skipMajorStep = useCallback((platform: 'ios' | 'android', stepIdx: number) => {
    const statuses = platform === 'ios' ? iosStatuses : andStatuses;
    const isRunning = platform === 'ios' ? iosRunning : andRunning;
    if (isRunning) return;
    const nextStatuses = statuses.map((status, idx) => idx === stepIdx ? 'skipped' : status);
    updatePlatformWorkflow(platform, nextStatuses);
    log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Шаг ${stepIdx + 1} пропущен.`, 'warn');
  }, [iosStatuses, andStatuses, iosRunning, andRunning, updatePlatformWorkflow, log]);

  const retryMajorStep = useCallback((platform: 'ios' | 'android', stepIdx: number) => {
    const statuses = platform === 'ios' ? iosStatuses : andStatuses;
    const isRunning = platform === 'ios' ? iosRunning : andRunning;
    if (isRunning) return;
    const nextStatuses = statuses.map((status, idx) => idx === stepIdx ? 'pending' : status);
    updatePlatformWorkflow(platform, nextStatuses);
    log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Шаг ${stepIdx + 1} поставлен на повтор.`, 'warn');
  }, [iosStatuses, andStatuses, iosRunning, andRunning, updatePlatformWorkflow, log]);

  const resetMajorWorkflow = useCallback(() => {
    updatePlatformWorkflow('ios', PUSH_IOS_STEPS.map(() => 'pending' as PushStatus));
    updatePlatformWorkflow('android', PUSH_AND_STEPS.map(() => 'pending' as PushStatus));
    resetCollectionWorkflow();
    log('Workflow major-релиза сброшен.', 'warn');
  }, [updatePlatformWorkflow, resetCollectionWorkflow, log]);

  const openNoticeModal = useCallback(async () => {
    setNoticeOpen(true);
    if (noticeText) return;
    setNoticeLoading(true);
    try {
      const text = await fetchMajorReleaseNoticeText(
        iosRelease, andRelease, settings.deployLabToken || '', proxyBase,
      );
      setNoticeText(text);
    } catch {
      setNoticeText('');
    } finally {
      setNoticeLoading(false);
    }
  }, [noticeText, iosRelease, andRelease, settings.deployLabToken, proxyBase]);

  const publishNotice = useCallback(async () => {
    if (noticeRunning || !noticeText.trim()) return;
    const ac = new AbortController();
    setNoticeRunning(true);
    try {
      await majorPublishReleaseNotice(noticeText, proxyBase, cookies, log, ac.signal);
      setNoticeOpen(false);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setNoticeRunning(false);
    }
  }, [noticeRunning, noticeText, proxyBase, cookies, log]);

  const loadDutyPing = useCallback(async (platform: 'ios' | 'android') => {
    const rel = platform === 'ios' ? iosRelease : andRelease;
    if (!rel.trim()) { log('Укажи версию релиза для пинга.', 'warn'); return; }
    if (!token) { log('Нужен Allure токен.', 'warn'); return; }
    const ac = new AbortController();
    dutyPingAbortRef.current = ac;
    setDutyPingPlatform(platform);
    setDutyPingLoading(true);
    log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Загружаю незакрытые стримы из Allure...`);
    try {
      const streams = await fetchDutyPingPendingStreams(platform, rel, token, proxyBase, ac.signal);
      setDutyPingStreams(streams);
      const msg = buildDutyPingMessage(streams, collectionRows);
      setDutyPingMessage(msg);
      log(`Найдено незакрытых стримов: ${streams.length}.`, streams.length ? 'warn' : 'ok');
    } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setDutyPingLoading(false);
      dutyPingAbortRef.current = null;
    }
  }, [iosRelease, andRelease, token, proxyBase, collectionRows, log]);

  const sendDutyPing = useCallback(async () => {
    if (dutyPingRunning || !dutyPingMessage.trim()) return;
    const rel = dutyPingPlatform === 'ios' ? iosRelease : andRelease;
    const ac = new AbortController();
    dutyPingAbortRef.current = ac;
    setDutyPingRunning(true);
    try {
      await postDutyPingToThread(dutyPingPlatform, rel, dutyPingMessage, proxyBase, cookies, log, ac.signal);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setDutyPingRunning(false);
      dutyPingAbortRef.current = null;
    }
  }, [dutyPingRunning, dutyPingMessage, dutyPingPlatform, iosRelease, andRelease, proxyBase, cookies, log]);

  const startDutyPingPolling = useCallback(async () => {
    if (dutyPingPolling) {
      dutyPingAbortRef.current?.abort();
      setDutyPingPolling(false);
      return;
    }
    const rel = dutyPingPlatform === 'ios' ? iosRelease : andRelease;
    if (!rel.trim()) { log('Укажи версию релиза для мониторинга.', 'warn'); return; }
    if (!token) { log('Нужен Allure токен.', 'warn'); return; }
    if (!cookies.trim()) { log('Нужны Band cookies.', 'warn'); return; }
    const ac = new AbortController();
    dutyPingAbortRef.current = ac;
    setDutyPingPolling(true);
    setDutyPingPollState(null);
    log(`[${dutyPingPlatform === 'ios' ? 'iOS' : 'Android'}] Запуск мониторинга пинга...`);
    try {
      await runDutyPingPolling(
        dutyPingPlatform, rel, token, proxyBase, cookies, collectionRows,
        (state) => {
          setDutyPingPollState(state);
          if (state.message) setDutyPingMessage(state.message);
        },
        log,
        ac.signal,
      );
      log(`[${dutyPingPlatform === 'ios' ? 'iOS' : 'Android'}] Мониторинг завершён.`, 'ok');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        log(`[${dutyPingPlatform === 'ios' ? 'iOS' : 'Android'}] Мониторинг остановлен.`, 'warn');
      } else {
        log(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      setDutyPingPolling(false);
      dutyPingAbortRef.current = null;
    }
  }, [
    dutyPingPolling, dutyPingPlatform, iosRelease, andRelease, token, proxyBase, cookies,
    collectionRows, log,
  ]);

  const startCollection = useCallback(async () => {
    if (collectionRunning) {
      collectionAbortRef.current?.abort();
      return;
    }
    if (!cookies) {
      collLog('Band cookies не заданы — укажи в Настройках.', 'error');
      return;
    }
    setCollectionLogs([]);
    const ac = new AbortController();
    collectionAbortRef.current = ac;
    setCollectionRunning(true);
    try {
      const result = await runCollection(proxyBase, cookies, token, gasUrl, collLog, ac.signal);
      applyCollectionResult(result);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        collLog('Сбор остановлен.', 'warn');
      } else {
        collLog(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      setCollectionRunning(false);
      collectionAbortRef.current = null;
    }
  }, [collectionRunning, cookies, proxyBase, token, gasUrl, collLog, applyCollectionResult]);

  function buildNonMajorSteps(m: RunMode) {
    const common = [
      { id: 'check_proxy', label: 'Проверка прокси', status: 'pending' as StepStatus },
      { id: 'check_allure', label: 'Проверка Allure токена', status: 'pending' as StepStatus },
      { id: 'check_yt', label: 'Проверка YouTrack токена', status: 'pending' as StepStatus },
    ];
    const byMode: Record<string, Array<{ id: string; label: string; status: StepStatus }>> = {
      hf_android: [
        { id: 'create_run', label: 'Создание рана Android Critical Path (ХФ)', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
        { id: 'feed_post', label: 'Публикация в ленту релизов', status: 'pending' },
      ],
      hf_ios: [
        { id: 'create_run', label: 'Создание рана iOS Critical Path (ХФ)', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
        { id: 'feed_post', label: 'Публикация в ленту релизов', status: 'pending' },
      ],
      napi: [
        { id: 'create_run', label: 'Создание NAPI ранов', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
      ],
      sunday_devices: [{ id: 'create_run', label: 'Создание ранов устройств', status: 'pending' }],
      rustore_critical: [
        { id: 'create_run', label: 'Создание RuStore/AppGallery Critical Path', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
        { id: 'feed_post', label: 'Публикация в ленту релизов', status: 'pending' },
      ],
      rustore_smoke: [
        { id: 'create_run', label: 'Создание RuStore/AppGallery Smoke', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
        { id: 'feed_post', label: 'Публикация в ленту релизов', status: 'pending' },
      ],
    };
    return [...common, ...(byMode[m] ?? [])];
  }

  const runWorkflow = useCallback(async () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      return;
    }

    const newSteps = buildNonMajorSteps(mode);
    setSteps(newSteps);
    setLogs([]);
    setCreatedRuns([]);
    setNonMajorCopyMessage('');
    setNonMajorYtData(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const stepLog = (id: string, status: StepStatus, detail?: string) =>
      setSteps(prev => prev.map(step => step.id === id ? { ...step, status, detail } : step));

    try {
      stepLog('check_proxy', 'running');
      log('Проверка прокси...');
      const proxyOk = await checkProxy(proxyBase).catch(() => false);
      if (proxyOk) {
        stepLog('check_proxy', 'done', proxyBase);
        log('✓ Прокси доступен', 'ok');
      } else {
        stepLog('check_proxy', 'error', 'Недоступен');
        log('✗ Прокси недоступен — убедись что proxy-standalone.js запущен на :8787', 'warn');
      }

      stepLog('check_allure', 'running');
      if (!settings.allureToken) {
        stepLog('check_allure', 'error', 'Токен не задан');
        log('✗ Allure токен не задан', 'warn');
      } else {
        stepLog('check_allure', 'done', 'Задан');
        log('✓ Allure токен задан', 'ok');
      }

      stepLog('check_yt', 'running');
      if (settings.ytToken) {
        stepLog('check_yt', 'done', 'Задан');
        log('✓ YouTrack токен задан', 'ok');
      } else {
        stepLog('check_yt', 'skipped', 'Не задан');
        log('⚠ YouTrack токен не задан', 'warn');
      }

      const runStep = newSteps.find(step => step.id === 'create_run');
      let runResult: { runs: LaunchRecord[]; message: string } | null = null;
      if (runStep) {
        stepLog('create_run', 'running');
        log(`${runStep.label}...`);
        try {
          runResult = await runCreatorScenario(mode, release, settings, log, ac.signal);
          setCreatedRuns(runResult.runs);
          setNonMajorCopyMessage(runResult.message);
          const detail = runResult.runs.length ? runResult.runs.map(run => `#${run.id}`).join(', ') : 'Завершено';
          stepLog('create_run', 'done', detail);
          log(`✓ ${detail}`, 'ok');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stepLog('create_run', 'error', message.slice(0, 80));
          log(`✗ ${message}`, 'error');
        }
      }

      const hasNotifySwat = newSteps.some(step => step.id === 'notify_swat');
      const hasFeedPost   = newSteps.some(step => step.id === 'feed_post');

      if (hasNotifySwat) {
        stepLog('notify_swat', 'pending');
        log('⬤ Готово к SWAT-уведомлению. Нажми «SWAT Team Only»', 'info');
      }

      if (hasFeedPost) {
        // Pre-fetch YT data for feed thread (board URL + ticket)
        const ytBase  = String(settings.ytBase  || '').trim();
        const ytToken = String(settings.ytToken || '').trim();
        if (ytBase && ytToken) {
          const ytPlatform = mode === 'hf_ios' ? 'ios' : 'android';
          try {
            log('Запрашиваю данные YouTrack для ленты...');
            const ytData = await fetchMajorYtData(ytPlatform, release, ytBase, ytToken, proxyBase, ac.signal);
            setNonMajorYtData(ytData);
            if (ytData.boardUrl) log(`YouTrack: ${ytData.boardUrl}`, 'ok');
          } catch (e) {
            log(`YouTrack: ${e instanceof Error ? e.message : String(e)}`, 'warn');
          }
        }
        stepLog('feed_post', 'pending');
        log('⬤ Готово к публикации в ленту. Нажми «Лента релизов»', 'info');
      }

      log('✓ Запуск завершён', 'ok');
    } catch {
      log('Запуск прерван', 'warn');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [mode, running, proxyBase, settings, release, log]);

  // ─── STEP SCHEDULE CALLBACKS ─────────────────────────────────
  const armStepSchedule = useCallback((plan: StepSchedulePlan) => {
    const key = plan.key;
    if (stepTimersRef.current[key]) {
      clearTimeout(stepTimersRef.current[key]);
      delete stepTimersRef.current[key];
    }
    setStepSchedules(prev => {
      const next = { ...prev, [key]: plan };
      saveStepSchedules(next);
      return next;
    });
    const delayMs = Math.max(0, plan.targetMs - Date.now());
    stepTimersRef.current[key] = setTimeout(async () => {
      delete stepTimersRef.current[key];
      setStepSchedules(prev => {
        const { [key]: _r, ...rest } = prev;
        saveStepSchedules(rest);
        if (!Object.keys(rest).length && scheduleTickerRef.current) {
          clearInterval(scheduleTickerRef.current);
          scheduleTickerRef.current = null;
        }
        return rest;
      });
      try { await executeMajorStepRef.current?.(plan.platform, plan.stepIdx); } catch {}
    }, delayMs);
    if (!scheduleTickerRef.current) {
      scheduleTickerRef.current = setInterval(() => setScheduleTick(t => t + 1), 1000);
    }
  }, []);

  const cancelStepSchedule = useCallback((key: string) => {
    if (stepTimersRef.current[key]) {
      clearTimeout(stepTimersRef.current[key]);
      delete stepTimersRef.current[key];
    }
    setStepSchedules(prev => {
      const { [key]: _r, ...rest } = prev;
      saveStepSchedules(rest);
      if (!Object.keys(rest).length && scheduleTickerRef.current) {
        clearInterval(scheduleTickerRef.current);
        scheduleTickerRef.current = null;
      }
      return rest;
    });
  }, []);

  const scheduleStep = useCallback((
    platform: 'ios' | 'android', stepIdx: number,
    triggerMode: 'delay' | 'schedule', delayMin: number, date: string, time: string,
  ) => {
    let targetMs: number;
    if (triggerMode === 'schedule') {
      targetMs = parseMskToUtcMs(date, time);
      if (!Number.isFinite(targetMs) || targetMs <= Date.now()) {
        log('✗ Укажи корректное время (должно быть в будущем)', 'error');
        return;
      }
    } else {
      targetMs = Date.now() + Math.max(1, delayMin) * 60 * 1000;
    }
    const key = stepSK(platform, stepIdx);
    armStepSchedule({ key, platform, stepIdx, targetMs, triggerMode, delayMinutes: triggerMode === 'delay' ? delayMin : null });
    log(`⏰ ${platform === 'ios' ? 'iOS' : 'Android'} шаг ${stepIdx + 1} — запланирован через ${schedCountdown(targetMs)}`, 'ok');
  }, [armStepSchedule, log]);

  // ─── AUTOMATION CALLBACKS ────────────────────────────────────
  const executeAutomation = useCallback(async (plan: AutomationPlan) => {
    const { mode: m, release: rel, buildValue: bv, swatLead: lead } = plan.snapshot;
    setAutomationRunning(true);
    log(`Автозапуск: ${RUN_MODE_LABELS[m]} ${rel}...`);
    try {
      const result = await runCreatorScenario(m, rel, settings, log);
      setCreatedRuns(result.runs);
      setNonMajorCopyMessage(result.message);
      if (cookies) {
        const leadTag = lead === 'viktor' ? '@dolgov.viktor7' : lead === 'roman' ? '@kolosov.roman' : '';
        let napiHosts = '';
        if (m === 'napi') { try { napiHosts = await fetchNapiHostsText(proxyBase, cookies); } catch {} }
        const swatText = buildNonMajorSwatText(result.message, leadTag, napiHosts);
        await bandPostMessage(proxyBase, cookies, swatText, { channelId: SWAT_CHANNEL_ID });
        log('✓ SWAT Team Only опубликован', 'ok');
        if (m !== 'napi') {
          try {
            await publishNonMajorFeedPosts(m, rel, result.runs, bv, '', '', '', proxyBase, cookies, log);
            log('✓ Лента релизов опубликована', 'ok');
          } catch (fe) {
            log(`Лента: ${fe instanceof Error ? fe.message : String(fe)}`, 'warn');
          }
        }
      }
      log('✓ Автозапуск завершён', 'ok');
    } catch (e) {
      log(`✗ Автозапуск: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setAutomationRunning(false);
    }
  }, [cookies, log, proxyBase, settings]);

  useEffect(() => { executeAutomationRef.current = executeAutomation; }, [executeAutomation]);

  const armAutomationPlan = useCallback((plan: AutomationPlan) => {
    if (automationTimerRef.current) { clearTimeout(automationTimerRef.current); automationTimerRef.current = null; }
    if (automTickerRef.current) { clearInterval(automTickerRef.current); automTickerRef.current = null; }
    const targetMs = Number(plan.targetMs);
    if (!Number.isFinite(targetMs)) return;
    if (Date.now() - targetMs > 15 * 60 * 1000) { setAutomationPlan(null); saveAutomationPlan(null); return; }
    setAutomationPlan(plan);
    saveAutomationPlan(plan);
    automationTimerRef.current = setTimeout(() => {
      automationTimerRef.current = null;
      if (automTickerRef.current) { clearInterval(automTickerRef.current); automTickerRef.current = null; }
      setAutomationPlan(null);
      saveAutomationPlan(null);
      executeAutomationRef.current?.(plan);
    }, Math.max(0, targetMs - Date.now()));
    automTickerRef.current = setInterval(() => setAutomTick(t => t + 1), 1000);
  }, []);

  const cancelAutomation = useCallback(() => {
    if (automationTimerRef.current) { clearTimeout(automationTimerRef.current); automationTimerRef.current = null; }
    if (automTickerRef.current) { clearInterval(automTickerRef.current); automTickerRef.current = null; }
    setAutomationPlan(null);
    saveAutomationPlan(null);
  }, []);

  const scheduleAutomation = useCallback((
    triggerMode: 'delay' | 'schedule', delayMin: number, date: string, time: string,
  ) => {
    let targetMs: number;
    if (triggerMode === 'schedule') {
      targetMs = parseMskToUtcMs(date, time);
      if (!Number.isFinite(targetMs) || targetMs <= Date.now()) {
        log('✗ Укажи корректное время (должно быть в будущем)', 'error');
        return;
      }
    } else {
      targetMs = Date.now() + Math.max(1, delayMin) * 60 * 1000;
    }
    armAutomationPlan({
      triggerMode, targetMs,
      snapshot: { mode, release, buildValue, swatLead },
    });
    log(`⏰ Автозапуск запланирован через ${schedCountdown(targetMs)}`, 'ok');
  }, [armAutomationPlan, log, mode, release, buildValue, swatLead]);

  // Restore schedules and automation from localStorage on mount
  useEffect(() => {
    const stored = loadStepSchedules();
    for (const plan of Object.values(stored)) { armStepSchedule(plan); }
    const ap = loadAutomationPlan();
    if (ap) armAutomationPlan(ap);
    return () => {
      Object.values(stepTimersRef.current).forEach(t => clearTimeout(t));
      if (scheduleTickerRef.current) clearInterval(scheduleTickerRef.current);
      if (automationTimerRef.current) clearTimeout(automationTimerRef.current);
      if (automTickerRef.current) clearInterval(automTickerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveBuild = useCallback(async () => {
    if (!cookies) { log('✗ Band cookies не заданы — укажи в Настройках', 'error'); return; }
    if (!release) { log('✗ Укажи номер релиза', 'error'); return; }
    setBuildResolving(true);
    log('Поиск номера сборки...');
    try {
      let result: string;
      if (mode === 'hf_ios') {
        result = await resolveIosBuildFromBand(release, proxyBase, cookies, log);
      } else {
        result = await resolveAndroidBuildFromBot(mode, release, proxyBase, cookies, log);
      }
      setBuildValue(result);
      log(`✓ Сборка найдена: ${result}`, 'ok');
    } catch (err) {
      log(`✗ Не удалось найти сборку: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBuildResolving(false);
    }
  }, [cookies, log, mode, proxyBase, release]);

  const publishSwatPost = useCallback(async (scheduledTime?: string) => {
    if (!cookies) { log('✗ Band cookies не заданы — укажи в Настройках', 'error'); return; }
    if (!nonMajorCopyMessage) { log('✗ Сначала запусти раны (нет copy message)', 'error'); return; }

    setSteps(prev => prev.map(step =>
      step.id === 'notify_swat'
        ? { ...step, status: 'running', detail: scheduledTime ? `Запланировано на ${scheduledTime}` : 'Отправка...' }
        : step,
    ));
    log(`SWAT Team Only${scheduledTime ? ` в ${scheduledTime}` : ''}...`);

    const leadTag = swatLead === 'viktor' ? '@dolgov.viktor7' : swatLead === 'roman' ? '@kolosov.roman' : '';
    let napiHostsText: string | undefined;
    if (mode === 'napi') {
      try {
        napiHostsText = await fetchNapiHostsText(proxyBase, cookies);
        log(`NAPI хосты получены`, 'ok');
      } catch (e) {
        log(`NAPI хосты: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      }
    }

    const message = buildNonMajorSwatText(nonMajorCopyMessage, leadTag, napiHostsText);

    try {
      if (scheduledTime) {
        const [hh, mm] = scheduledTime.split(':').map(Number);
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);
        if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);
        await bandScheduleMessage(proxyBase, cookies, message, scheduled.getTime(), { channelId: SWAT_CHANNEL_ID });
        setSteps(prev => prev.map(step => step.id === 'notify_swat' ? { ...step, status: 'done', detail: `Запланировано на ${scheduledTime}` } : step));
        log(`✓ SWAT Team Only — запланировано на ${scheduledTime}`, 'ok');
      } else {
        await bandPostMessage(proxyBase, cookies, message, { channelId: SWAT_CHANNEL_ID });
        setSteps(prev => prev.map(step => step.id === 'notify_swat' ? { ...step, status: 'done', detail: 'Отправлено' } : step));
        log(`✓ SWAT Team Only — отправлено`, 'ok');
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSteps(prev => prev.map(step => step.id === 'notify_swat' ? { ...step, status: 'error', detail: messageText.slice(0, 60) } : step));
      log(`✗ SWAT Team Only: ${messageText}`, 'error');
    }
  }, [cookies, log, nonMajorCopyMessage, swatLead, mode, proxyBase]);

  const publishFeedPost = useCallback(async () => {
    if (!cookies) { log('✗ Band cookies не заданы — укажи в Настройках', 'error'); return; }
    setSteps(prev => prev.map(step => step.id === 'feed_post' ? { ...step, status: 'running', detail: 'Публикация...' } : step));
    try {
      await publishNonMajorFeedPosts(
        mode, release, createdRuns, buildValue,
        nonMajorYtData?.boardUrl ?? '',
        nonMajorYtData?.ticketKey ?? '',
        nonMajorYtData?.ticketUrl ?? '',
        proxyBase, cookies, log,
      );
      setSteps(prev => prev.map(step => step.id === 'feed_post' ? { ...step, status: 'done', detail: 'Опубликовано' } : step));
      log('✓ Лента релизов — опубликовано', 'ok');
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSteps(prev => prev.map(step => step.id === 'feed_post' ? { ...step, status: 'error', detail: messageText.slice(0, 60) } : step));
      log(`✗ Лента релизов: ${messageText}`, 'error');
    }
  }, [cookies, log, mode, release, createdRuns, buildValue, nonMajorYtData, proxyBase]);

  const publishToChannel = useCallback(async (
    channelId: string,
    stepId: string,
    label: string,
    scheduledTime?: string,
  ) => {
    if (!cookies) {
      log('✗ Band cookies не заданы — укажи в Настройках', 'error');
      return;
    }

    setSteps(prev => prev.map(step =>
      step.id === stepId
        ? { ...step, status: 'running', detail: scheduledTime ? `Запланировано на ${scheduledTime}` : 'Отправка...' }
        : step,
    ));
    log(`${label}${scheduledTime ? ` в ${scheduledTime}` : ''}...`);

    const runLines = createdRuns.length ? createdRuns.map(run => `Ран: ${run.name} — ${run.url}`).join('\n') : '';
    const message = [
      release ? `Релиз ${release}` : 'Запуск релиза',
      runLines,
      `${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`,
    ].filter(Boolean).join('\n');

    try {
      if (scheduledTime) {
        const [hh, mm] = scheduledTime.split(':').map(Number);
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);
        if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);
        await bandScheduleMessage(proxyBase, cookies, message, scheduled.getTime(), { channelId });
        setSteps(prev => prev.map(step => step.id === stepId ? { ...step, status: 'done', detail: `Запланировано на ${scheduledTime}` } : step));
        log(`✓ ${label} — запланировано на ${scheduledTime}`, 'ok');
      } else {
        await bandPostMessage(proxyBase, cookies, message, { channelId });
        setSteps(prev => prev.map(step => step.id === stepId ? { ...step, status: 'done', detail: 'Отправлено' } : step));
        log(`✓ ${label} — отправлено`, 'ok');
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSteps(prev => prev.map(step => step.id === stepId ? { ...step, status: 'error', detail: messageText.slice(0, 60) } : step));
      log(`✗ ${label}: ${messageText}`, 'error');
    }
  }, [cookies, log, createdRuns, release, proxyBase]);

  const openExternal = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▷</div>
        Запуск релиза
      </div>

      <Card>
        <CardHeader><CardTitle>Тип запуска</CardTitle></CardHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, padding: '14px 16px' }}>
          {MODES.map(item => (
            <div
              key={item.id}
              onClick={() => setMode(item.id)}
              style={{
                border: `1px solid ${mode === item.id ? 'rgba(155,92,255,.4)' : 'var(--border)'}`,
                borderRadius: 14,
                padding: '12px 14px',
                cursor: 'pointer',
                background: mode === item.id ? 'rgba(155,92,255,.08)' : 'transparent',
                transition: 'all .12s',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{RUN_MODE_LABELS[item.id]}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {mode === 'major' && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={resetMajorWorkflow}>Сбросить workflow</Button>
            <Button variant="ghost" onClick={() => void openNoticeModal()}>Оповещение о запуске</Button>
            {!settings.allureToken && <Badge color="red">Нужен Allure токен</Badge>}
            {!settings.bandCookies && <Badge color="red">Нужны Band cookies</Badge>}
            {!settings.bandCookiesAdmin && <Badge color="yellow">Нет admin cookies для групп</Badge>}
          </div>

          <Modal open={noticeOpen} onClose={() => setNoticeOpen(false)} title="Оповещение о запуске мажора" width={540}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Публикует оповещение в 4 канала: mp-ios-release, mp-Релиз Андроид, Олеся и Лиды QA, SWAT QA
              </div>
              {noticeLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Загрузка текста оповещения...</div>
              ) : (
                <Textarea
                  rows={5}
                  value={noticeText}
                  onChange={e => setNoticeText(e.target.value)}
                  placeholder="Запуск мажора! Версия iOS X.X.XXXX / Android X.X.XXXX"
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" onClick={() => setNoticeOpen(false)}>Отмена</Button>
                <Button
                  variant="primary" size="sm"
                  disabled={noticeRunning || noticeLoading || !noticeText.trim()}
                  onClick={() => void publishNotice()}
                >
                  {noticeRunning ? 'Публикуется...' : 'Опубликовать'}
                </Button>
              </div>
            </div>
          </Modal>

          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', borderRadius: '12px 12px 0 0', padding: '0 16px' }}>
            {([
              { id: 'collection' as const, label: collectionRows.length ? `Сбор дежурных ${collectionStats.filled}/${collectionStats.total}` : 'Сбор дежурных' },
              { id: 'release' as const, label: 'Релиз' },
              { id: 'ping' as const, label: 'Пинг дежурных' },
              { id: 'editor' as const, label: 'Редактор' },
            ]).map(item => (
              <button
                key={item.id}
                onClick={() => setMajorTab(item.id)}
                style={{
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  fontFamily: 'inherit',
                  borderBottom: `2px solid ${majorTab === item.id ? '#9B5CFF' : 'transparent'}`,
                  color: majorTab === item.id ? 'var(--text)' : 'var(--text-2)',
                  marginBottom: -1,
                  transition: 'all .12s',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {majorTab === 'collection' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Результат сбора</CardTitle>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      {sinceLabel ? `Сканируются сообщения с ${sinceLabel}` : 'Собираем дежурных из Band SWAT QA + Allure/Apps Script'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="ghost" size="sm" disabled={!collectionRows.length} onClick={() => navigator.clipboard.writeText(buildCurrentDutiesCopyText(collectionRows))}>
                      Копировать
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!collectionRows.length} onClick={() => navigator.clipboard.writeText(buildCurrentDutyThreadsCopyText(collectionRows, collectionIdMaps, editorStreamGroups))}>
                      Копировать треды
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!collectionRows.length} onClick={() => setResultsCollapsed(prev => !prev)}>
                      {resultsCollapsed ? 'Показать' : 'Скрыть'}
                    </Button>
                    <Button variant={collectionRunning ? 'danger' : 'primary'} size="sm" onClick={startCollection}>
                      {collectionRunning ? '■ Остановить' : '▷ Начать сбор'}
                    </Button>
                  </div>
                </CardHeader>
                <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Badge color="purple">Стримов: {collectionStats.total}</Badge>
                    <Badge color="green">Заполнено: {collectionStats.filled}</Badge>
                    <Badge color={collectionStats.missing ? 'red' : 'gray'}>Пропусков: {collectionStats.missing}</Badge>
                    <Badge color="blue">Сообщений: {collectionStats.messages}</Badge>
                    <Badge color="cyan">iOS user_id: {collectionStats.iosIds}</Badge>
                    <Badge color="cyan">Android user_id: {collectionStats.androidIds}</Badge>
                  </div>

                  {!resultsCollapsed && (
                    <>
                      {collectionRows.length ? (
                        <Table>
                          <thead>
                            <tr>
                              <Th>#</Th>
                              <Th>Стрим</Th>
                              <Th>iOS</Th>
                              <Th>Android</Th>
                              <Th>Лиды</Th>
                              <Th>Статус</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...collectionRows]
                              .sort((a, b) => Number(b.missing) - Number(a.missing))
                              .map((row, idx) => {
                                const leads = [...new Set([...row.iosLeads, ...row.androidLeads])];
                                return (
                                  <tr key={`${row.stream}-${idx}`}>
                                    <Td mono>{idx + 1}</Td>
                                    <Td bold>{row.streamDisplay || row.stream}</Td>
                                    <Td>{row.iosDuty || (row.requireIos ? 'не найден' : '—')}</Td>
                                    <Td>{row.androidDuty || (row.requireAndroid ? 'не найден' : '—')}</Td>
                                    <Td>{leads.length ? leads.join(', ') : '—'}</Td>
                                    <Td>{row.missing ? <Badge color="red">Есть пропуск</Badge> : <Badge color="green">Собрано</Badge>}</Td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </Table>
                      ) : (
                        <EmptyState text="Данные появятся после запуска сбора." />
                      )}

                      {collectionMessages.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <FieldLabel>Комментарии сборки</FieldLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {collectionMessages.map((message, idx) => (
                              <div key={`${message}-${idx}`} style={{ fontSize: 12, color: 'var(--text-2)' }}>• {message}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>

              {pingText && (
                <Card>
                  <CardHeader>
                    <CardTitle>Пинг для дежурных</CardTitle>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(pingText)}>
                        Скопировать
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPingCollapsed(prev => !prev)}>
                        {pingCollapsed ? 'Показать' : 'Скрыть'}
                      </Button>
                    </div>
                  </CardHeader>
                  {!pingCollapsed && (
                    <CardBody>
                      <Textarea
                        value={pingText}
                        onChange={event => setPingText(event.target.value)}
                        rows={10}
                        style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                      />
                    </CardBody>
                  )}
                </Card>
              )}

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Пошаговый запуск</CardTitle>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      Полный workflow публикации и обновления @qadutyios / @qadutyandr
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={resetCollectionWorkflow}>
                    Сбросить
                  </Button>
                </CardHeader>
                <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Badge color={collectionWorkflowHint.color}>{collectionWorkflowHint.text}</Badge>
                  {COLLECTION_WORKFLOW_STEPS.map((step, idx) => (
                    <CollectionStepRow
                      key={step.code}
                      step={{ code: step.code, title: step.title }}
                      idx={idx}
                      status={collectionWorkflowStatuses[idx] ?? 'pending'}
                      currentIdx={collectionWorkflowCurrentIdx}
                      running={collectionRunning}
                      pingFound={collectionPingFound}
                      hasCollectionRows={collectionRows.length > 0}
                      onYes={() => executeCollectionWorkflowStep(idx)}
                      onNo={() => skipCollectionWorkflowStep(idx)}
                      onRetry={() => retryCollectionWorkflowStep(idx)}
                    />
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader><CardTitle>Логи</CardTitle></CardHeader>
                <CardBody>
                  {collectionLogs.length ? <LogView lines={collectionLogs} maxHeight={260} /> : <EmptyState text="Пока нет логов сбора." />}
                </CardBody>
              </Card>
            </div>
          )}

          {majorTab === 'release' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Card>
                  <CardHeader><CardTitle>iOS</CardTitle></CardHeader>
                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <FieldLabel>Версия iOS</FieldLabel>
                      <Input value={iosRelease} onChange={event => setIosRelease(event.target.value)} placeholder="например: 7.6.1234" />
                    </div>
                    <div>
                      <FieldLabel>Тред iOS</FieldLabel>
                      <Textarea value={iosText} onChange={event => setIosText(event.target.value)} rows={14} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                    </div>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Android</CardTitle></CardHeader>
                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <FieldLabel>Версия Android</FieldLabel>
                      <Input value={andRelease} onChange={event => setAndRelease(event.target.value)} placeholder="например: 7.6.1234" />
                    </div>
                    <div>
                      <FieldLabel>Тред Android</FieldLabel>
                      <Textarea value={andText} onChange={event => setAndText(event.target.value)} rows={14} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                    </div>
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Опрос по стримам</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(pollText)} disabled={!pollText.trim()}>
                    Скопировать
                  </Button>
                </CardHeader>
                <CardBody>
                  <Textarea value={pollText} readOnly rows={5} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{majorPollStatusText}</div>
                </CardBody>
              </Card>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Workflow релиза</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Паритет со старым major-релизом: лента → дежурные → опрос → reminder → компоненты → раны → готовность.</div>
                </div>
                <Button variant="secondary" size="sm" onClick={resetMajorWorkflow}>
                  Сбросить workflow
                </Button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Card>
                  <CardHeader>
                    <CardTitle>Workflow iOS</CardTitle>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {iosSyncing && <Badge color="yellow">Синхронизация...</Badge>}
                      <Button variant="ghost" size="sm" disabled={iosRunning || iosSyncing} onClick={() => void syncMajorPlatform('ios', { silent: false, applyThreadText: true })}>
                        Синхронизировать
                      </Button>
                      <Badge color={iosRunning || iosSyncing ? 'yellow' : 'green'}>{iosStatuses.filter(status => status === 'done').length}/{PUSH_IOS_STEPS.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PUSH_IOS_STEPS.map((step, idx) => {
                      const sk = stepSK('ios', idx);
                      const st = iosStatuses[idx] ?? 'pending';
                      return (
                        <div key={step.code}>
                          <PushStepRow
                            step={step} idx={idx} status={st}
                            currentIdx={iosCurrentIdx} running={iosRunning || iosSyncing}
                            onExecute={() => executeMajorStep('ios', idx)}
                            onSkip={() => skipMajorStep('ios', idx)}
                            onRetry={() => retryMajorStep('ios', idx)}
                            manualActionLabel={idx === 5 && st === 'done' ? 'Обновить сообщение' : undefined}
                            onManualAction={idx === 5 ? () => void refreshComponentsMessage('ios') : undefined}
                          />
                          {st === 'pending' && (
                            <StepScheduleBlock
                              plan={stepSchedules[sk]} tick={scheduleTick}
                              disabled={iosRunning || iosSyncing}
                              onDelay={min => scheduleStep('ios', idx, 'delay', min, '', '')}
                              onAtTime={(d, t) => scheduleStep('ios', idx, 'schedule', 0, d, t)}
                              onCancel={() => cancelStepSchedule(sk)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Workflow Android</CardTitle>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {andSyncing && <Badge color="yellow">Синхронизация...</Badge>}
                      <Button variant="ghost" size="sm" disabled={andRunning || andSyncing} onClick={() => void syncMajorPlatform('android', { silent: false, applyThreadText: true })}>
                        Синхронизировать
                      </Button>
                      <Badge color={andRunning || andSyncing ? 'yellow' : 'green'}>{andStatuses.filter(status => status === 'done').length}/{PUSH_AND_STEPS.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PUSH_AND_STEPS.map((step, idx) => {
                      const sk = stepSK('android', idx);
                      const st = andStatuses[idx] ?? 'pending';
                      return (
                        <div key={step.code}>
                          <PushStepRow
                            step={step} idx={idx} status={st}
                            currentIdx={andCurrentIdx} running={andRunning || andSyncing}
                            onExecute={() => executeMajorStep('android', idx)}
                            onSkip={() => skipMajorStep('android', idx)}
                            onRetry={() => retryMajorStep('android', idx)}
                            manualActionLabel={idx === 5 && st === 'done' ? 'Обновить сообщение' : undefined}
                            onManualAction={idx === 5 ? () => void refreshComponentsMessage('android') : undefined}
                          />
                          {st === 'pending' && (
                            <StepScheduleBlock
                              plan={stepSchedules[sk]} tick={scheduleTick}
                              disabled={andRunning || andSyncing}
                              onDelay={min => scheduleStep('android', idx, 'delay', min, '', '')}
                              onAtTime={(d, t) => scheduleStep('android', idx, 'schedule', 0, d, t)}
                              onCancel={() => cancelStepSchedule(sk)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Card>
                  <CardHeader>
                    <CardTitle>Компоненты iOS</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!iosComponents.trim()}
                      onClick={() => navigator.clipboard.writeText(iosComponents)}
                    >
                      Скопировать
                    </Button>
                  </CardHeader>
                  <CardBody>
                    <Textarea value={iosComponents} onChange={event => setIosComponents(event.target.value)} rows={10} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} placeholder={'ComponentA 1.0.0\nComponentB 2.0.0'} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Компоненты Android</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!andComponents.trim()}
                      onClick={() => navigator.clipboard.writeText(andComponents)}
                    >
                      Скопировать
                    </Button>
                  </CardHeader>
                  <CardBody>
                    <Textarea value={andComponents} onChange={event => setAndComponents(event.target.value)} rows={10} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} placeholder={'ComponentA 1.0.0\nComponentB 2.0.0'} />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Лог</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Очистить</Button>
                </CardHeader>
                <CardBody>
                  {logs.length ? <LogView lines={logs} maxHeight={260} /> : <EmptyState text="Выполняй шаги workflow — лог появится здесь." />}
                </CardBody>
              </Card>
            </div>
          )}

          {majorTab === 'ping' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Пинг дежурных</CardTitle>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      Мониторинг незакрытых стримов по рану готовности. Обновляет пинг-сообщение каждые 5 секунд.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Select
                      value={dutyPingPlatform}
                      onChange={e => {
                        setDutyPingPlatform(e.target.value as 'ios' | 'android');
                        setDutyPingPollState(null);
                      }}
                      disabled={dutyPingPolling}
                    >
                      <option value="ios">iOS</option>
                      <option value="android">Android</option>
                    </Select>
                    <Button
                      variant="secondary" size="sm"
                      disabled={dutyPingLoading || dutyPingPolling}
                      onClick={() => void loadDutyPing(dutyPingPlatform)}
                    >
                      {dutyPingLoading ? 'Загрузка...' : 'Загрузить незакрытые'}
                    </Button>
                    <Button
                      variant={dutyPingPolling ? 'ghost' : 'primary'} size="sm"
                      disabled={dutyPingLoading || (!dutyPingPolling && (!token || !cookies))}
                      onClick={() => void startDutyPingPolling()}
                    >
                      {dutyPingPolling ? 'Остановить мониторинг' : 'Запустить мониторинг'}
                    </Button>
                  </div>
                </CardHeader>
                <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(dutyPingPollState || dutyPingStreams.length > 0) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {dutyPingPolling && <Badge color="yellow">Мониторинг активен</Badge>}
                      {dutyPingPollState && (
                        <>
                          <Badge color="yellow">Pending: {dutyPingPollState.pendingCount}</Badge>
                          <Badge color="green">OK: {dutyPingPollState.verifiedCount}</Badge>
                          {dutyPingPollState.done && <Badge color="green">Все стримы закрыты</Badge>}
                        </>
                      )}
                      {!dutyPingPollState && dutyPingStreams.length > 0 && (
                        <Badge color="yellow">Незакрыто: {dutyPingStreams.length}</Badge>
                      )}
                    </div>
                  )}
                  <div>
                    <FieldLabel>Сообщение пинга</FieldLabel>
                    <Textarea
                      value={dutyPingMessage}
                      onChange={e => setDutyPingMessage(e.target.value)}
                      rows={12}
                      style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                      placeholder={'Коллеги, просьба написать сроки проставления оков по платформе iOS\n\nСтрим @handle'}
                      readOnly={dutyPingPolling}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="ghost" size="sm"
                      disabled={!dutyPingMessage.trim()}
                      onClick={() => navigator.clipboard.writeText(dutyPingMessage)}
                    >
                      Скопировать
                    </Button>
                    <Button
                      variant="primary" size="sm"
                      disabled={dutyPingRunning || dutyPingLoading || dutyPingPolling || !dutyPingMessage.trim() || !cookies}
                      onClick={() => void sendDutyPing()}
                    >
                      {dutyPingRunning ? 'Публикуется...' : 'Опубликовать в тред'}
                    </Button>
                  </div>
                  {!cookies && <Badge color="red">Нужны Band cookies</Badge>}
                  {!token && <Badge color="yellow">Нужен Allure токен для загрузки незакрытых стримов</Badge>}
                </CardBody>
              </Card>

              <Card>
                <CardHeader><CardTitle>Лог</CardTitle></CardHeader>
                <CardBody>
                  {logs.length ? <LogView lines={logs} maxHeight={260} /> : <EmptyState text="Лог появится здесь." />}
                </CardBody>
              </Card>
            </div>
          )}

          {majorTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Редактор дежурных</CardTitle>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      Справочник лидов и stream-групп для duty collection.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {editorStatus.text && (
                      <Badge color={
                        editorStatus.level === 'ok' ? 'green' :
                        editorStatus.level === 'error' ? 'red' :
                        editorStatus.level === 'info' ? 'blue' : 'gray'
                      }>
                        {editorStatus.text}
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openExternal(DUTY_EDITOR_DOC_URL)}>Документ</Button>
                    <Button variant="ghost" size="sm" onClick={() => openExternal(DUTY_EDITOR_JSON_URL)}>JSON</Button>
                    <Button variant="secondary" size="sm" onClick={() => loadEditor(true)} disabled={editorLoading}>
                      {editorLoading ? 'Загрузка...' : 'Перезагрузить'}
                    </Button>
                    <Button variant="primary" size="sm" onClick={saveEditor} disabled={editorSaving}>
                      {editorSaving ? 'Сохранение...' : 'Сохранить'}
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Лиды</CardTitle>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="ghost" size="sm"
                      disabled={editorPresenceLoading || !editorLeads.length || !cookies}
                      onClick={async () => {
                        if (!cookies) return;
                        setEditorPresenceLoading(true);
                        try {
                          const handles = editorLeads.map(r => r.handle).filter(Boolean);
                          const presence = await fetchBandPresenceByHandles(proxyBase, cookies, handles);
                          setEditorPresence(presence);
                        } catch { /* silent */ } finally {
                          setEditorPresenceLoading(false);
                        }
                      }}
                    >
                      {editorPresenceLoading ? '...' : 'Присутствие'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={addLeadRow}>Добавить строку</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditorLeadsCollapsed(prev => !prev)}>
                      {editorLeadsCollapsed ? 'Развернуть' : 'Свернуть'}
                    </Button>
                  </div>
                </CardHeader>
                {!editorLeadsCollapsed && (
                  <CardBody>
                  {editorLeads.length ? (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Handle</Th>
                          <Th>Стримы</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {editorLeads.map((row, idx) => {
                          const ps = editorPresence[row.handle];
                          const dotColor = ps === 'online' ? '#22C55E' : ps === 'away' ? '#F59E0B' : ps === 'dnd' ? '#EF4444' : ps === 'offline' ? 'var(--text-3)' : '';
                          return (
                            <tr key={`lead-${idx}`}>
                              <Td style={{ width: 220 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {dotColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} title={ps} />}
                                  <Input value={row.handle} onChange={event => updateLeadRow(idx, 'handle', event.target.value)} placeholder="@login" />
                                </div>
                              </Td>
                              <Td>
                                <Input value={stringifyStreamList(row.streams)} onChange={event => updateLeadRow(idx, 'streams', event.target.value)} placeholder="Stream A, Stream B" />
                              </Td>
                              <Td style={{ width: 110 }}>
                                <Button variant="danger" size="sm" onClick={() => removeLeadRow(idx)}>Удалить</Button>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  ) : (
                    <EmptyState text="Список лидов пока пуст." />
                  )}
                  </CardBody>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Stream-группы</CardTitle>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" size="sm" onClick={addStreamGroupRow}>Добавить группу</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditorStreamGroupsCollapsed(prev => !prev)}>
                      {editorStreamGroupsCollapsed ? 'Развернуть' : 'Свернуть'}
                    </Button>
                  </div>
                </CardHeader>
                {!editorStreamGroupsCollapsed && (
                  <CardBody>
                  {editorStreamGroups.length ? (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Название группы</Th>
                          <Th>Стримы</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {editorStreamGroups.map((row, idx) => (
                          <tr key={`stream-group-${idx}`}>
                            <Td style={{ width: 280 }}>
                              <Input value={row.name} onChange={event => updateStreamGroupRow(idx, 'name', event.target.value)} placeholder="Payments" />
                            </Td>
                            <Td>
                              <Input value={stringifyStreamList(row.streams)} onChange={event => updateStreamGroupRow(idx, 'streams', event.target.value)} placeholder="Stream A, Stream B" />
                            </Td>
                            <Td style={{ width: 110 }}>
                              <Button variant="danger" size="sm" onClick={() => removeStreamGroupRow(idx)}>Удалить</Button>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <EmptyState text="Stream-группы пока не загружены." />
                  )}
                  </CardBody>
                )}
              </Card>

              <Card>
                <CardHeader><CardTitle>Tables JSON</CardTitle></CardHeader>
                <CardBody>
                  <Textarea
                    value={editorTablesText}
                    onChange={event => {
                      setEditorTablesText(event.target.value);
                      setEditorDirty(true);
                    }}
                    rows={14}
                    style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader><CardTitle>Allure streams</CardTitle></CardHeader>
                <CardBody>
                  {editorAllureLeaves.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {editorAllureLeaves.map(streamName => (
                        <Badge key={streamName} color="gray">{streamName}</Badge>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="Allure streams не загружены." />
                  )}
                  {editorDirty && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>Есть несохранённые изменения.</div>
                  )}
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}

      {mode !== 'major' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card>
            <CardHeader><CardTitle>Параметры</CardTitle></CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Номер релиза</FieldLabel>
                <Input value={release} onChange={event => setRelease(event.target.value)} placeholder="например: 7.3.5420" />
              </div>
              {(mode === 'hf_android' || mode === 'hf_ios' || mode === 'rustore_critical' || mode === 'rustore_smoke') && (
                <div>
                  <FieldLabel>Номер сборки (необязательно)</FieldLabel>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Input
                      value={buildValue}
                      onChange={event => setBuildValue(event.target.value)}
                      placeholder="например: 12345"
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={resolveBuild}
                      disabled={buildResolving || running || !cookies}
                    >
                      {buildResolving ? '...' : 'Найти'}
                    </Button>
                  </div>
                </div>
              )}
              {(mode === 'hf_android' || mode === 'hf_ios' || mode === 'napi' || mode === 'rustore_critical' || mode === 'rustore_smoke') && (
                <div>
                  <FieldLabel>Дежурный SWAT (необязательно)</FieldLabel>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    {(['none', 'viktor', 'roman'] as const).map(v => (
                      <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text-2)' }}>
                        <input
                          type="radio"
                          name="swatLead"
                          checked={swatLead === v}
                          onChange={() => setSwatLead(v)}
                          style={{ accentColor: '#9B5CFF' }}
                        />
                        {v === 'none' ? 'Никто' : v === 'viktor' ? '@dolgov.viktor7' : '@kolosov.roman'}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <Divider />
              <Button variant={running ? 'danger' : 'primary'} onClick={runWorkflow}>
                {running ? '■ Остановить' : '▷ Запустить'}
              </Button>
              {(!settings.allureToken || !settings.ytToken || (mode !== 'sunday_devices' && !settings.bandCookies)) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {!settings.allureToken && <Badge color="red">Нужен Allure токен</Badge>}
                  {!settings.ytToken && <Badge color="yellow">Нужен YouTrack токен</Badge>}
                  {mode !== 'sunday_devices' && !settings.bandCookies && <Badge color="red">Нужны Band cookies</Badge>}
                </div>
              )}

              <AutomationBlock
                mode={mode} running={running} automationRunning={automationRunning}
                plan={automationPlan} tick={automTick}
                onSchedule={scheduleAutomation} onCancel={cancelAutomation}
              />

              {steps.some(step => step.id === 'notify_swat') && (
                <>
                  <Divider />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>SWAT</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => publishSwatPost()}>
                      SWAT Team Only
                    </Button>
                    <SchedulePicker onSchedule={time => publishSwatPost(time)} />
                  </div>
                </>
              )}

              {steps.some(step => step.id === 'feed_post') && (
                <>
                  <Divider />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Лента</div>
                  <Button variant="ghost" size="sm" onClick={publishFeedPost}>
                    Лента релизов
                  </Button>
                </>
              )}

              {createdRuns.length > 0 && (
                <>
                  <Divider />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Созданные раны</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {createdRuns.map(run => (
                      <a
                        key={run.id}
                        href={run.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#9B5CFF', textDecoration: 'none' }}
                      >
                        #{run.id} {run.name}{run.reused ? ' ↩' : ''}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {steps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Шаги</CardTitle>
                  <Badge color={running ? 'yellow' : 'green'}>{running ? 'running' : 'done'}</Badge>
                </CardHeader>
                <CardBody>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {steps.map(step => (
                      <div
                        key={step.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: step.status === 'running'
                            ? 'rgba(245,158,11,.08)'
                            : step.status === 'done'
                              ? 'rgba(34,197,94,.06)'
                              : step.status === 'error'
                                ? 'rgba(239,68,68,.08)'
                                : 'var(--surface-soft)',
                          border: `1px solid ${step.status === 'running'
                            ? 'rgba(245,158,11,.2)'
                            : step.status === 'done'
                              ? 'rgba(34,197,94,.15)'
                              : step.status === 'error'
                                ? 'rgba(239,68,68,.2)'
                                : 'var(--surface-soft-4)'}`,
                        }}
                      >
                        <span style={{ fontSize: 13, color: STATUS_COLORS[step.status as PushStatus] ?? 'var(--text-3)', width: 16, textAlign: 'center', flexShrink: 0 }}>
                          {STATUS_ICONS[step.status as PushStatus] ?? '○'}
                        </span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: step.status === 'done' ? 'var(--text-3)' : 'var(--text-2)', textDecoration: step.status === 'done' ? 'line-through' : 'none' }}>{step.label}</div>
                          {step.detail && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{step.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
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
                  <Button variant="secondary" size="sm" style={{ marginTop: 10 }} onClick={() => navigator.clipboard.writeText(logs.map(line => line.text).join('\n'))}>
                    Скопировать лог
                  </Button>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
