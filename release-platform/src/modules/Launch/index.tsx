import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Divider, Badge, Button, Input, FieldLabel, Textarea, LogView, Modal, Table, Th, Td, EmptyState } from '../../components/ui';
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
  hasCollectionPingMessage,
  findCollectionUserIds,
  clearBandDutyGroups,
  addBandDutyGroups,
  fetchDutyEditorData,
  saveDutyEditorData,
  createDutyEditorAllureLeaf,
  renameDutyEditorAllureLeaf,
  deleteDutyEditorAllureLeaf,
  fetchMajorReleaseNoticeText,
  majorPublishReleaseNotice,
  fetchDutyPingPendingStreams,
  buildDutyPingMessage,
  postDutyPingToThread,
  findExistingDutyPingMessage,
  runDutyPingPolling,
  refreshMajorPollTextFromAllure,
  fetchMajorYtData,
  fetchNapiHostsText,
  buildNonMajorSwatText,
  buildNonMajorFeedPreviewItems,
  publishNonMajorFeedPosts,
  fetchBandPresenceByHandles,
  fetchBandDisplayNamesByHandles,
  fetchBandUsersByUsernames,
  fetchBandUserAvatarBlob,
  searchBandUsers,
  resolveIosBuildFromBand,
  resolveAndroidBuildFromBot,
  NOTICE_CHANNELS,
  QA_LEADS_SCRIPT_URL,
  type BandPresenceStatus,
  type BandUserSuggestion,
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
  type DutyEditorAllureLeaf,
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
  { code: '3', title: 'Создать новую страницу таблицы для стримов' },
  { code: '4', title: 'Отправить опрос в тред' },
  { code: '5', title: 'Напоминание @qadutyios' },
  { code: '6', title: 'Опубликовать компоненты' },
  { code: '7', title: 'Заполнить раны Allure' },
  { code: '8', title: 'Создание рана готовности (оки)' },
];

const PUSH_AND_STEPS: PushStepDef[] = [
  { code: '1', title: 'Опубликовать в ленту релизов' },
  { code: '2', title: 'Добавить дежурных из сбора' },
  { code: '3', title: 'Создать новую страницу таблицы для стримов' },
  { code: '4', title: 'Отправить опрос в тред' },
  { code: '5', title: 'Напоминание @qadutyandr' },
  { code: '6', title: 'Опубликовать компоненты' },
  { code: '7', title: 'Заполнить раны Allure' },
  { code: '8', title: 'Создание рана готовности (оки)' },
];

type PushStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
type MajorPlatform = 'ios' | 'android';
type NoticeChannelState = 'idle' | 'loading' | 'success' | 'error';
type CopyFeedbackState = 'idle' | 'loading' | 'success';

interface CollectionDisplayRow {
  streamDisplay: string;
  iosDuty: string;
  androidDuty: string;
  leadHandles: string[];
  requireIos: boolean;
  requireAndroid: boolean;
  missing: boolean;
}

type EditorLeadDraft = DutyEditorLeadEntry & { isNew?: boolean };
type EditorStreamGroupDraft = DutyEditorStreamGroupEntry & { isNew?: boolean };

type EditorLeadRow = DutyEditorLeadEntry & {
  editing?: boolean;
  draft?: EditorLeadDraft;
};

type EditorStreamGroupRow = DutyEditorStreamGroupEntry & {
  editing?: boolean;
  draft?: EditorStreamGroupDraft;
};

interface DutyPingUiState {
  streams: string[];
  message: string;
  logs: Array<{ text: string; level: LogLevel }>;
  loading: boolean;
  running: boolean;
  polling: boolean;
  pollState: DutyPingState | null;
}

interface ComponentTimerUiState {
  running: boolean;
  nextFireMs: number;
  lastHour: number;
}

function emptyDutyPingState(): DutyPingUiState {
  return { streams: [], message: '', logs: [], loading: false, running: false, polling: false, pollState: null };
}

function countMajorPollOptions(pollCommand: string): number {
  const quotedArgs = String(pollCommand || '').match(/"(?:\\.|[^"\\])*"/g) || [];
  return Math.max(0, quotedArgs.length - 1);
}

function emptyComponentTimerState(): ComponentTimerUiState {
  return { running: false, nextFireMs: 0, lastHour: 0 };
}

function normalizeCollectionTitle(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function uniqueFilled(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeCollectionBandHandle(value: string): string {
  const handle = String(value || '').trim().replace(/^@+/, '');
  return handle ? `@${handle}` : '';
}

function collectionBandNameKey(value: string): string {
  return normalizeCollectionBandHandle(value).toLocaleLowerCase('ru-RU');
}

function sameCollectionBandHandle(left: string, right: string): boolean {
  const leftKey = collectionBandNameKey(left);
  const rightKey = collectionBandNameKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function formatCollectionBandName(handle: string, displayNames: Record<string, string>): string {
  const normalized = normalizeCollectionBandHandle(handle);
  if (!normalized) return '';
  return displayNames[collectionBandNameKey(normalized)] || normalized;
}

function CopyableCollectionBandName({
  handle,
  displayNames,
}: {
  handle: string;
  displayNames: Record<string, string>;
}) {
  const normalized = normalizeCollectionBandHandle(handle);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const copyHandle = useCallback(async (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!normalized) return;
    const ok = await copyTextToClipboard(normalized);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [normalized]);

  if (!normalized) return null;

  const displayName = formatCollectionBandName(normalized, displayNames);
  const showCopy = hovered || copied;

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}
      title={`${displayName} - ${normalized}`}
    >
      <button
        type="button"
        onClick={copyHandle}
        style={{
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
          textAlign: 'left',
          minWidth: 0,
        }}
      >
        {displayName}
      </button>
      <button
        type="button"
        onClick={copyHandle}
        aria-label={`Скопировать ${normalized}`}
        title={`Скопировать ${normalized}`}
        style={{
          width: 20,
          height: 20,
          borderRadius: 7,
          border: '1px solid var(--border-hi)',
          background: 'var(--surface-soft)',
          color: copied ? '#22C55E' : 'var(--text-3)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
          opacity: showCopy ? 1 : 0,
          transform: showCopy ? 'translateX(0)' : 'translateX(-3px)',
          transition: 'opacity .12s ease, transform .12s ease, color .12s ease',
          pointerEvents: showCopy ? 'auto' : 'none',
          flexShrink: 0,
        }}
      >
        {copied ? '✓' : <DutyEditorCopyIcon size={12} />}
      </button>
    </span>
  );
}

function CollectionBandPeople({
  handles,
  displayNames,
}: {
  handles: string[];
  displayNames: Record<string, string>;
}) {
  const normalizedHandles = uniqueFilled(handles.map(normalizeCollectionBandHandle).filter(Boolean));
  if (!normalizedHandles.length) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {normalizedHandles.map(handle => (
        <CopyableCollectionBandName key={collectionBandNameKey(handle)} handle={handle} displayNames={displayNames} />
      ))}
    </span>
  );
}

function CollectionDutyValue({
  handle,
  required,
  displayNames,
}: {
  handle: string;
  required: boolean;
  displayNames: Record<string, string>;
}) {
  const normalized = normalizeCollectionBandHandle(handle);
  if (normalized) {
    return <CopyableCollectionBandName handle={normalized} displayNames={displayNames} />;
  }
  if (required) return <span style={{ color: '#BE123C', fontWeight: 700 }}>- ?</span>;
  return <span style={{ color: 'var(--text-3)' }}>—</span>;
}

function CollectionPlatformDutyLine({
  platform,
  handle,
  required,
  displayNames,
}: {
  platform: 'ios' | 'android';
  handle: string;
  required: boolean;
  displayNames: Record<string, string>;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
      <span style={{ color: platform === 'ios' ? '#8B5CF6' : '#22C55E', display: 'inline-flex' }}>
        {platform === 'ios' ? <IosPlatformIcon /> : <AndroidPlatformIcon />}
      </span>
      <CollectionDutyValue handle={handle} required={required} displayNames={displayNames} />
    </span>
  );
}

function CollectionDutyCell({
  row,
  displayNames,
}: {
  row: CollectionDisplayRow;
  displayNames: Record<string, string>;
}) {
  const iosHandle = normalizeCollectionBandHandle(row.iosDuty);
  const androidHandle = normalizeCollectionBandHandle(row.androidDuty);
  const oneRequiredPlatform = row.requireIos !== false && row.requireAndroid === false
    || row.requireAndroid !== false && row.requireIos === false;

  if (oneRequiredPlatform) {
    return (
      <CollectionDutyValue
        handle={row.requireIos ? row.iosDuty : row.androidDuty}
        required
        displayNames={displayNames}
      />
    );
  }

  if (iosHandle && androidHandle && sameCollectionBandHandle(iosHandle, androidHandle)) {
    return <CopyableCollectionBandName handle={iosHandle} displayNames={displayNames} />;
  }

  return (
    <span style={{ display: 'grid', gap: 3, alignItems: 'center' }}>
      <CollectionPlatformDutyLine platform="ios" handle={row.iosDuty} required={row.requireIos} displayNames={displayNames} />
      <CollectionPlatformDutyLine platform="android" handle={row.androidDuty} required={row.requireAndroid} displayNames={displayNames} />
    </span>
  );
}

function buildCollectionDisplayRows(rows: CollectionRow[]): CollectionDisplayRow[] {
  const displayRows: CollectionDisplayRow[] = [];
  for (const row of rows) {
    const streamDisplay = String(row.streamDisplay || row.stream || '').trim();
    const isCoreStream = normalizeCollectionTitle(streamDisplay) === 'core';
    if (isCoreStream) {
      displayRows.push({
        streamDisplay: 'Core iOS',
        iosDuty: row.iosDuty,
        androidDuty: '',
        leadHandles: uniqueFilled(row.iosLeads),
        requireIos: true,
        requireAndroid: false,
        missing: !row.iosDuty,
      });
      displayRows.push({
        streamDisplay: 'Core Android',
        iosDuty: '',
        androidDuty: row.androidDuty,
        leadHandles: uniqueFilled(row.androidLeads),
        requireIos: false,
        requireAndroid: true,
        missing: !row.androidDuty,
      });
      continue;
    }

    displayRows.push({
      streamDisplay,
      iosDuty: row.iosDuty,
      androidDuty: row.androidDuty,
      leadHandles: uniqueFilled([...row.iosLeads, ...row.androidLeads]),
      requireIos: row.requireIos !== false,
      requireAndroid: row.requireAndroid !== false,
      missing: row.missing,
    });
  }

  return displayRows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      if (a.row.missing !== b.row.missing) return a.row.missing ? -1 : 1;
      return a.idx - b.idx;
    })
    .map(item => item.row);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text || '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.focus();
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  return true;
}

// ─── MODES ──────────────────────────────────────────────────────
const MODES: Array<{ id: RunMode; icon: React.ReactNode; desc: string }> = [
  { id: 'major',            icon: '🚀', desc: 'Полный цикл Android + iOS' },
  { id: 'hf_android',       icon: <ModeAndroidIcon />, desc: 'Хот-фикс для Android' },
  { id: 'hf_ios',           icon: <ModeIosIcon />, desc: 'Хот-фикс для iOS' },
  { id: 'napi',             icon: '⚡', desc: 'Native API платёжного модуля' },
  { id: 'sunday_devices',   icon: '📱', desc: 'Еженедельный прогон устройств' },
  { id: 'rustore_critical', icon: <StorefrontModeIcons />, desc: 'RuStore / AppGallery — Крит-путь' },
  { id: 'rustore_smoke',    icon: <StorefrontModeIcons />, desc: 'RuStore / AppGallery — Smoke' },
];

const NON_MAJOR_BUILD_MODES = new Set<RunMode>(['hf_android', 'hf_ios', 'rustore_critical', 'rustore_smoke']);
function isNonMajorBuildMode(mode: RunMode): boolean {
  return NON_MAJOR_BUILD_MODES.has(mode);
}

// ─── HELPERS ────────────────────────────────────────────────────
const STATUS_ICONS: Record<PushStatus, string> = {
  pending: '○', running: '↻', done: '✓', error: '✕', skipped: '–',
};
const STATUS_COLORS: Record<PushStatus, string> = {
  pending: 'var(--text-3)', running: '#F59E0B', done: '#22C55E', error: '#EF4444', skipped: 'var(--text-3)',
};
const DUTY_EDITOR_EMPTY_STREAM_ERROR = '__DUTY_EDITOR_EMPTY_STREAM__';

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
  const allDutiesFound = rows.length > 0 && missingCount === 0;
  return [
    allDutiesFound ? 'done' :
    pingTextValue ? (pingFound ? 'done' : 'pending') : 'skipped',
    allDutiesFound ? 'done' : missingCount > 0 ? 'pending' : 'skipped',
    'pending',
    'pending',
    'pending',
  ];
}

function waitForBandReadConsistency(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseStreamList(input: string): string[] {
  return input
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isCoreEditorLead(row: DutyEditorLeadEntry): boolean {
  return String(row?.name || '').trim().toLocaleLowerCase('ru-RU') === 'core';
}

function editorBandProfileKey(value: string): string {
  return normalizeCollectionBandHandle(value).replace(/^@+/, '').toLocaleLowerCase('ru-RU');
}

function cleanEditorLeadRows(rows: EditorLeadRow[]): DutyEditorLeadEntry[] {
  return rows.map(row => {
    const next: DutyEditorLeadEntry = {
      name: String(row.name || ''),
      values: Array.isArray(row.values) ? row.values.map(value => String(value || '')) : [],
    };
    if ('allureLeafId' in row) next.allureLeafId = row.allureLeafId ?? null;
    return next;
  });
}

function cleanEditorStreamGroupRows(rows: EditorStreamGroupRow[]): DutyEditorStreamGroupEntry[] {
  return rows.map(row => ({
    name: String(row.name || ''),
    streams: Array.isArray(row.streams) ? row.streams.map(value => String(value || '')).filter(Boolean) : [],
  }));
}

function collectEditorBandUsernames(rows: DutyEditorLeadEntry[]): string[] {
  return uniqueFilled(
    rows
      .flatMap(row => Array.isArray(row.values) ? row.values : [])
      .map(value => String(value || '').trim())
      .filter(value => /^@?[\w.-]{2,}$/i.test(value))
      .map(editorBandProfileKey)
      .filter(Boolean),
  );
}

function buildBandInitials(displayName: string, handle: string): string {
  const parts = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('ru-RU');
  if (initials) return initials;
  const normalized = normalizeCollectionBandHandle(handle).replace(/^@+/, '');
  return normalized.slice(0, 2).toLocaleUpperCase('ru-RU') || '@';
}

function formatEditorBandDisplayName(value: string, profiles: Record<string, BandUserSuggestion>): string {
  const handle = normalizeCollectionBandHandle(value);
  if (!handle) return '';
  return profiles[editorBandProfileKey(handle)]?.displayName || handle;
}

function presenceClassName(status?: BandPresenceStatus): string {
  const normalized = status === 'online' || status === 'away' || status === 'dnd' ? status : 'offline';
  return `release-launch-duty-editor-search-option-badge is-${normalized}`;
}

function DutyEditorPresenceBadge({ status }: { status?: BandPresenceStatus }) {
  return (
    <span className={presenceClassName(status)} aria-hidden="true">
      {status === 'online' && (
        <svg viewBox="0 0 16 16"><path d="M4 8.3 6.7 11 12 5.2" /></svg>
      )}
      {status === 'away' && (
        <svg viewBox="0 0 16 16"><path d="M8 3.8v4.5l3 1.7" /></svg>
      )}
      {status === 'dnd' && (
        <svg viewBox="0 0 16 16"><path d="M4.5 8h7" /></svg>
      )}
    </span>
  );
}

function DutyEditorBandAvatar({
  handle,
  profile,
  avatarUrls,
  size = 'sm',
}: {
  handle: string;
  profile?: BandUserSuggestion;
  avatarUrls: Record<string, string>;
  size?: 'sm' | 'lg';
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const src = profile?.id ? avatarUrls[profile.id] || '' : '';
  const displayName = profile?.displayName || normalizeCollectionBandHandle(handle);
  const initials = buildBandInitials(displayName, handle);

  useEffect(() => setImageFailed(false), [src]);

  return (
    <span className={size === 'lg' ? 'release-launch-duty-editor-search-option-avatar' : 'release-launch-duty-editor-lead-avatar'}>
      {src && !imageFailed ? (
        <img src={src} alt={displayName || normalizeCollectionBandHandle(handle)} loading="lazy" onError={() => setImageFailed(true)} />
      ) : (
        <span>{initials}</span>
      )}
      {profile && <DutyEditorPresenceBadge status={profile.presence} />}
    </span>
  );
}

function DutyEditorPencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" />
      <path d="M13.5 6 18 10.5" />
    </svg>
  );
}

function DutyEditorTrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function DutyEditorCopyIcon({ size = 16 }: { size?: number } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="8.5" y="8.5" width="10" height="10" rx="2" />
      <rect x="5.5" y="5.5" width="10" height="10" rx="2" />
    </svg>
  );
}

function DutyEditorRefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.35-5.65" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}

function DutyEditorExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 14v5H5V5h5" />
    </svg>
  );
}

function DutyEditorPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DutyEditorChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DutyEditorIconButton({
  children,
  title,
  variant = 'default',
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  variant?: 'default' | 'confirm' | 'delete';
  disabled?: boolean;
  onClick: () => void;
}) {
  const className = [
    'release-launch-duty-editor-icon-btn',
    variant === 'confirm' ? 'is-confirm' : '',
    variant === 'delete' ? 'is-delete' : '',
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={title} title={title}>
      {children}
    </button>
  );
}

function DutyEditorEditDeleteActions({
  editTitle,
  deleteTitle,
  onEdit,
  onDelete,
  disabled,
  className = 'release-launch-duty-editor-row-actions',
}: {
  editTitle: string;
  deleteTitle: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const buttons = (
    <>
      <DutyEditorIconButton title={editTitle} disabled={disabled} onClick={onEdit}>
        <DutyEditorPencilIcon />
      </DutyEditorIconButton>
      <DutyEditorIconButton title={deleteTitle} variant="delete" disabled={disabled} onClick={onDelete}>
        <DutyEditorTrashIcon />
      </DutyEditorIconButton>
    </>
  );
  if (!className) return buttons;
  return <div className={className}>{buttons}</div>;
}

function CopyableDutyEditorLead({
  value,
  profiles,
  avatarUrls,
}: {
  value: string;
  profiles: Record<string, BandUserSuggestion>;
  avatarUrls: Record<string, string>;
}) {
  const handle = normalizeCollectionBandHandle(value);
  const profile = profiles[editorBandProfileKey(handle)];
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const copyHandle = useCallback(async (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!handle) return;
    const ok = await copyTextToClipboard(handle);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [handle]);

  if (!handle) return <span className="release-launch-duty-editor-lead-cell is-muted">Не заполнено</span>;

  const displayName = formatEditorBandDisplayName(handle, profiles);
  return (
    <div className="release-launch-duty-editor-lead-profile" title={`${displayName} - ${handle}`}>
      <DutyEditorBandAvatar handle={handle} profile={profile} avatarUrls={avatarUrls} />
      <div className="release-launch-duty-editor-lead-value-wrap">
        <button type="button" className="release-launch-duty-editor-lead-name-btn" onClick={copyHandle}>
          {displayName}
        </button>
        <button
          type="button"
          className="release-launch-duty-editor-icon-btn release-launch-duty-editor-lead-copy-btn"
          onClick={copyHandle}
          aria-label="Скопировать логин Band"
          title="Скопировать логин Band"
        >
          <span className={`release-launch-duty-editor-copy-icon ${copied ? 'is-hidden' : ''}`} aria-hidden={copied}>
            <DutyEditorCopyIcon />
          </span>
          <span className={`release-launch-duty-editor-copy-success ${copied ? 'is-visible' : ''}`} aria-hidden={!copied}>
            ✓
          </span>
        </button>
      </div>
    </div>
  );
}

function DutyEditorPlatformTag({ platform }: { platform: 'ios' | 'android' }) {
  return (
    <span className={`release-launch-duty-editor-lead-platform-tag is-${platform}`} title={platform === 'ios' ? 'iOS' : 'Android'}>
      {platform === 'ios' ? <IosPlatformIcon /> : <AndroidPlatformIcon />}
    </span>
  );
}

function DutyEditorSearchOption({
  item,
  avatarUrls,
  onSelect,
}: {
  item: BandUserSuggestion;
  avatarUrls: Record<string, string>;
  onSelect: (item: BandUserSuggestion) => void;
}) {
  return (
    <button type="button" className="release-launch-duty-editor-search-option" onClick={() => onSelect(item)}>
      <DutyEditorBandAvatar handle={item.handle} profile={item} avatarUrls={avatarUrls} size="lg" />
      <span className="release-launch-duty-editor-search-option-content">
        <span className="release-launch-duty-editor-search-option-name">{item.displayName || item.handle}</span>
        <span className="release-launch-duty-editor-search-option-login">
          {[item.handle, item.position || item.email].filter(Boolean).join(' - ')}
        </span>
      </span>
    </button>
  );
}

function MiniIcon({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 0 }}>
      {children}
    </span>
  );
}

function CopyListIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <rect x="6.2" y="5.2" width="8" height="9.2" rx="1.5" stroke="currentColor" strokeWidth="1.45" />
        <path d="M3.7 11.9V3.8c0-.8.6-1.4 1.4-1.4h7" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    </MiniIcon>
  );
}

function ThreadsIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M4.2 4.1h9.6a1.7 1.7 0 0 1 1.7 1.7v4.8a1.7 1.7 0 0 1-1.7 1.7H8.2l-3.3 2.4v-2.4h-.7a1.7 1.7 0 0 1-1.7-1.7V5.8a1.7 1.7 0 0 1 1.7-1.7Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
        <path d="M6.2 7.3h5.6M6.2 9.6h3.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    </MiniIcon>
  );
}

function EyeOffIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M2.4 2.8 15.2 15.6" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
        <path d="M6.4 4.3A7.4 7.4 0 0 1 9 3.8c3.7 0 6.1 3 7 4.7a11.3 11.3 0 0 1-2.1 2.8M11 12.1a5.9 5.9 0 0 1-2 .3c-3.7 0-6.1-3-7-4.7a12 12 0 0 1 2.6-3.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.4 6.7a2.3 2.3 0 0 1 3 3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    </MiniIcon>
  );
}

function PlayIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M5.2 3.7v10.6l8.5-5.3-8.5-5.3Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
      </svg>
    </MiniIcon>
  );
}

function LaunchRunButton({
  running,
  onClick,
}: {
  running: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant={running ? 'danger' : 'primary'} size="sm" onClick={onClick}>
      {!running && <PlayIcon />}
      {running ? 'Остановить' : 'Запустить'}
    </Button>
  );
}

function IosPlatformIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M12.15 9.35c-.02-1.8 1.47-2.68 1.54-2.72-.85-1.22-2.15-1.39-2.6-1.41-1.1-.11-2.16.65-2.72.65-.57 0-1.43-.63-2.36-.61-1.2.02-2.32.7-2.94 1.78-1.27 2.2-.32 5.43.9 7.2.6.87 1.32 1.84 2.26 1.8.9-.04 1.25-.58 2.35-.58 1.09 0 1.4.58 2.35.56.98-.02 1.59-.87 2.18-1.75.7-1 1-1.98 1.01-2.03-.02-.01-1.95-.75-1.97-2.89Z" fill="currentColor" />
        <path d="M10.37 4.05c.5-.6.84-1.44.74-2.27-.72.03-1.6.48-2.12 1.08-.47.54-.88 1.41-.77 2.23.8.06 1.64-.41 2.15-1.04Z" fill="currentColor" />
      </svg>
    </MiniIcon>
  );
}

function AndroidPlatformIcon() {
  return (
    <MiniIcon>
      <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M5.2 6.8h7.6v5.7a1.4 1.4 0 0 1-1.4 1.4H6.6a1.4 1.4 0 0 1-1.4-1.4V6.8Z" fill="currentColor" opacity=".92" />
        <path d="M5 5.8c.45-1.55 1.95-2.7 4-2.7s3.55 1.15 4 2.7H5Z" fill="currentColor" />
        <path d="M4.2 7.4v4.5M13.8 7.4v4.5M7.3 13.8v1.9M10.7 13.8v1.9M6.7 1.9l1 1.6M11.3 1.9l-1 1.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="7.4" cy="4.9" r=".45" fill="var(--card)" />
        <circle cx="10.6" cy="4.9" r=".45" fill="var(--card)" />
      </svg>
    </MiniIcon>
  );
}

function ModeAndroidIcon() {
  return (
    <span title="Android" style={{ color: '#34C759', display: 'inline-flex', transform: 'scale(1.18)', transformOrigin: 'left center' }}>
      <AndroidPlatformIcon />
    </span>
  );
}

function ModeIosIcon() {
  return (
    <span title="iOS" style={{ color: '#8B5CF6', display: 'inline-flex', transform: 'scale(1.18)', transformOrigin: 'left center' }}>
      <IosPlatformIcon />
    </span>
  );
}

function RuStoreModeIcon() {
  return (
    <span title="RuStore" style={{ display: 'inline-flex', width: 18, height: 18, flexShrink: 0 }}>
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <rect x="1.5" y="1.5" width="15" height="15" rx="4" fill="#0B78FF" />
        <path d="M5.2 11.9V5.6h3.9c1.6 0 2.6.8 2.6 2.1 0 .9-.5 1.6-1.3 1.9l1.7 2.3H9.9L8.5 9.8H7.1v2.1H5.2Zm1.9-3.6h1.8c.6 0 1-.2 1-.7s-.4-.7-1-.7H7.1v1.4Z" fill="#fff" />
      </svg>
    </span>
  );
}

function AppGalleryModeIcon() {
  return (
    <span title="AppGallery" style={{ display: 'inline-flex', width: 18, height: 18, flexShrink: 0 }}>
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <rect x="1.5" y="1.5" width="15" height="15" rx="4" fill="#E60012" />
        <path d="M9 4.4c1.2 1 2 2.1 2 3.4 0 .9-.4 1.7-1.1 2.2.6.5 1 1.2 1 2.1H7.1c0-.9.4-1.6 1-2.1A2.7 2.7 0 0 1 7 7.8c0-1.3.8-2.4 2-3.4Z" fill="#fff" />
        <path d="M4.5 8.9c1.4-.2 2.6.2 3.4 1.1.5.6.8 1.3.8 2.1H5.3c-.9 0-1.6-.7-1.6-1.6 0-.7.3-1.2.8-1.6ZM13.5 8.9c-1.4-.2-2.6.2-3.4 1.1-.5.6-.8 1.3-.8 2.1h3.4c.9 0 1.6-.7 1.6-1.6 0-.7-.3-1.2-.8-1.6Z" fill="#fff" opacity=".9" />
      </svg>
    </span>
  );
}

function StorefrontModeIcons() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <RuStoreModeIcon />
      <AppGalleryModeIcon />
    </span>
  );
}

function CopyFeedbackButton({
  children,
  state,
  successIcon = '✓',
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  state: CopyFeedbackState;
  successIcon?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const active = state === 'loading' || state === 'success';
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || active}
      aria-busy={state === 'loading'}
      onClick={onClick}
      style={{
        position: 'relative',
        overflow: 'hidden',
        minWidth: 126,
        opacity: disabled ? 0.62 : 1,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          lineHeight: 1,
          transition: 'transform .16s ease, opacity .16s ease',
          transform: active ? 'translateX(-6px)' : 'translateX(0)',
        }}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 14,
          height: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: active ? 1 : 0,
          transition: 'opacity .16s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            width: 12,
            height: 12,
            borderRadius: 999,
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            opacity: state === 'loading' ? 1 : 0,
            animation: state === 'loading' ? 'spin .75s linear infinite' : 'none',
          }}
        />
        <span
          style={{
            position: 'absolute',
            color: '#22C55E',
            fontSize: 12,
            fontWeight: 900,
            transform: state === 'success' ? 'scale(1)' : 'scale(.65)',
            opacity: state === 'success' ? 1 : 0,
            transition: 'transform .14s ease, opacity .14s ease',
          }}
        >
          {successIcon}
        </span>
      </span>
    </Button>
  );
}

function CollectionStatusIcon({ missing }: { missing: boolean }) {
  return (
    <span
      title={missing ? 'Не найден' : 'Найден'}
      aria-label={missing ? 'Не найден' : 'Найден'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        color: missing ? '#B91C1C' : '#15803D',
        background: missing ? '#FFE4E6' : '#DCFCE7',
        border: `1px solid ${missing ? '#FECDD3' : '#BBF7D0'}`,
      }}
    >
      {missing ? '✕' : '✓'}
    </span>
  );
}

// ─── PUSH STEP ROW ───────────────────────────────────────────────
function LegacyWorkflowButton({
  children,
  variant = 'soft',
  muted = false,
  running = false,
  small = false,
  disabled,
  style,
  type,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'soft' | 'grad';
  muted?: boolean;
  running?: boolean;
  small?: boolean;
}) {
  const disabledStyle: React.CSSProperties = disabled && !running
    ? {
        background: 'var(--surface-soft-3)',
        borderColor: 'var(--border)',
        boxShadow: 'none',
        color: 'var(--text-3)',
        cursor: 'not-allowed',
      }
    : {};
  const variantStyle: React.CSSProperties = variant === 'grad'
    ? {
        background: 'linear-gradient(90deg,#9b5cff,#ff5ac8)',
        boxShadow: '0 10px 30px rgba(155,92,255,.25)',
        color: '#fff',
        textShadow: '0 1px 2px rgba(31,41,55,.35)',
      }
    : {
        background: 'var(--surface-soft-4)',
        borderColor: 'var(--border-hi)',
        color: muted ? 'var(--text-3)' : 'var(--accent)',
      };
  const runningStyle: React.CSSProperties = running
    ? {
        background: 'linear-gradient(90deg,#f59e0b,#f97316)',
        borderColor: 'rgba(249,115,22,.38)',
        boxShadow: '0 10px 24px rgba(249,115,22,.24)',
        color: '#fff',
        cursor: 'progress',
        textShadow: 'none',
      }
    : {};

  return (
    <button
      type={type || 'button'}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        border: '1px solid transparent',
        borderRadius: 14,
        padding: small ? '6px 10px' : '8px 14px',
        fontFamily: 'inherit',
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        lineHeight: 1.2,
        transition: 'background-color .15s ease, color .15s ease, border-color .15s ease, box-shadow .15s ease',
        userSelect: 'none',
        WebkitFontSmoothing: 'antialiased',
        backfaceVisibility: 'hidden',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...variantStyle,
        ...disabledStyle,
        ...runningStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function pushWorkflowMeta(status: PushStatus, isLocked: boolean): {
  icon: string;
  text: string;
  badgeStyle: React.CSSProperties;
} {
  if (isLocked) {
    return {
      icon: '🔒',
      text: 'Заблокирован',
      badgeStyle: { color: 'var(--text-3)', background: 'var(--surface-soft-4)', boxShadow: 'inset 0 0 0 1px var(--border)' },
    };
  }
  if (status === 'done') {
    return {
      icon: '✅',
      text: 'Выполнено',
      badgeStyle: { color: 'var(--green)', background: 'color-mix(in srgb, var(--card) 82%, var(--green) 18%)', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,.28)' },
    };
  }
  if (status === 'skipped') {
    return {
      icon: '❌',
      text: 'Пропущено',
      badgeStyle: { color: 'var(--red)', background: 'color-mix(in srgb, var(--card) 82%, var(--red) 18%)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,.28)' },
    };
  }
  if (status === 'running') {
    return {
      icon: '⏳',
      text: 'Выполняется',
      badgeStyle: { color: 'var(--yellow)', background: 'color-mix(in srgb, var(--card) 82%, var(--yellow) 18%)', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,.30)' },
    };
  }
  if (status === 'error') {
    return {
      icon: '✕',
      text: 'Ошибка',
      badgeStyle: { color: 'var(--red)', background: 'color-mix(in srgb, var(--card) 82%, var(--red) 18%)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,.28)' },
    };
  }
  return {
    icon: '○',
    text: 'Ожидает',
    badgeStyle: { color: 'var(--text-3)', background: 'var(--surface-soft-4)', boxShadow: 'inset 0 0 0 1px var(--border-hi)' },
  };
}

function pushWorkflowRowStyle(status: PushStatus, isCurrent: boolean, isLocked: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 16,
    padding: 12,
  };
  if (status === 'done') {
    return { ...base, background: 'color-mix(in srgb, var(--card) 88%, var(--green) 12%)', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,.24)' };
  }
  if (status === 'skipped' || status === 'error') {
    return { ...base, background: 'color-mix(in srgb, var(--card) 88%, var(--red) 12%)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,.24)' };
  }
  if (isCurrent) {
    return {
      ...base,
      background: 'color-mix(in srgb, var(--card) 88%, var(--accent) 12%)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 40%, var(--border-hi)), 0 8px 18px rgba(109,40,217,.08)',
    };
  }
  if (isLocked) {
    return {
      ...base,
      background: 'var(--surface-soft-2)',
      boxShadow: 'inset 0 0 0 1px var(--border)',
      opacity: 0.72,
    };
  }
  return {
    ...base,
    background: 'var(--surface-soft)',
    boxShadow: 'inset 0 0 0 1px var(--border)',
  };
}

function PushStepRow({
  step, idx, status, currentIdx, running,
  onExecute, onSkip, onRetry,
  manualActionLabel,
  onManualAction,
  scheduleControls,
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
  scheduleControls?: React.ReactNode;
}) {
  const isCurrent = idx === currentIdx;
  const isLocked = status === 'pending' && idx > currentIdx;
  const meta = pushWorkflowMeta(status, isLocked);
  const rowStyle = pushWorkflowRowStyle(status, isCurrent, isLocked);
  const retryVisible = status === 'done' || status === 'skipped' || status === 'error';
  const executeVisible = !retryVisible;
  const actionRunning = status === 'running';

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 200 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', flexShrink: 0 }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {step.code}. {step.title}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                marginTop: 4,
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.25,
                ...meta.badgeStyle,
              }}
            >
              {meta.text}
            </span>
            {scheduleControls}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {retryVisible && (
            <LegacyWorkflowButton
              disabled={running || isLocked}
              onClick={onRetry}
            >
              Повторить
            </LegacyWorkflowButton>
          )}
          {status === 'done' && manualActionLabel && onManualAction && (
            <LegacyWorkflowButton small disabled={running} onClick={onManualAction}>
              {manualActionLabel}
            </LegacyWorkflowButton>
          )}
          {status === 'pending' && (
            <LegacyWorkflowButton
              muted
              disabled={running || status !== 'pending'}
              onClick={onSkip}
            >
              Пропустить
            </LegacyWorkflowButton>
          )}
          {executeVisible && (
            <LegacyWorkflowButton
              variant="grad"
              running={actionRunning}
              disabled={running || !isCurrent || status !== 'pending'}
              aria-busy={actionRunning ? true : undefined}
              onClick={onExecute}
            >
              {actionRunning ? 'Выполняется…' : 'Выполнить'}
            </LegacyWorkflowButton>
          )}
        </div>
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
}) {
  const finished = currentIdx >= COLLECTION_WORKFLOW_STEPS.length;
  const isCurrent = !finished && idx === currentIdx;
  const isLockedByCollection = idx === 0 && !hasCollectionRows;
  const isLockedBySequence = !finished && status === 'pending' && idx > currentIdx;
  const isLocked = isLockedByCollection || isLockedBySequence;
  const locked = running || finished || !isCurrent || status !== 'pending' || isLockedByCollection;
  const meta = pushWorkflowMeta(status, isLocked);
  const rowStyle = pushWorkflowRowStyle(status, isCurrent, isLocked);
  const actionRunning = status === 'running';

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 260 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', flexShrink: 0 }}>{meta.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {step.code}. {step.title}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                marginTop: 4,
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.25,
                ...meta.badgeStyle,
              }}
            >
              {meta.text}
            </span>
            {isLockedByCollection && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-3)' }}>
                Начните сбор дежурных и дождитесь выполнения
              </div>
            )}
            {idx === 0 && pingFound && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--green)' }}>
                Сообщение пинг-найдено
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <LegacyWorkflowButton
            variant="grad"
            running={actionRunning}
            disabled={locked}
            aria-busy={actionRunning ? true : undefined}
            onClick={onYes}
          >
            {actionRunning ? 'Выполняется…' : 'Да'}
          </LegacyWorkflowButton>
          <LegacyWorkflowButton disabled={locked} onClick={onNo}>
            Нет
          </LegacyWorkflowButton>
        </div>
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
function SchedulePicker({ onSchedule }: { onSchedule: (targetMs: number) => void }) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const defaultMs = buildDefaultSwatScheduleMs(Date.now());
  const [date, setDate] = useState(() => mskDateStr(defaultMs));
  const [time, setTime] = useState(() => mskTimeStr(defaultMs));
  const [error, setError] = useState('');
  const scheduleDefault = () => {
    onSchedule(buildDefaultSwatScheduleMs(Date.now()));
    setMenuOpen(false);
  };
  const scheduleCustom = () => {
    const targetMs = parseMskToUtcMs(date, time);
    if (!Number.isFinite(targetMs) || targetMs <= Date.now()) {
      setError('Выбери дату и время в будущем.');
      return;
    }
    onSchedule(targetMs);
    setOpen(false);
    setMenuOpen(false);
    setError('');
  };
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Запланировать SWAT Team Only"
        onClick={() => setMenuOpen(prev => !prev)}
        style={{ minWidth: 32, paddingInline: 8 }}
      >
        ▾
      </Button>
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 'calc(100% + 6px)',
            right: 0,
            display: 'grid',
            gap: 4,
            width: 170,
            padding: 6,
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface)',
            boxShadow: '0 12px 30px rgba(0,0,0,.18)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={scheduleDefault}
            style={{ border: 0, borderRadius: 8, padding: '7px 9px', background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12 }}
          >
            Отправить в 10:00
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(true); setMenuOpen(false); }}
            style={{ border: 0, borderRadius: 8, padding: '7px 9px', background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12 }}
          >
            В другое время
          </button>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Запланировать отправку" width={320}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <FieldLabel>Дата</FieldLabel>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-hi)', background: 'var(--surface-soft-4)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%' }} />
          </div>
          <div>
            <FieldLabel>Время</FieldLabel>
            <input type="time" value={time} step={60} onChange={e => setTime(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-hi)', background: 'var(--surface-soft-4)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%' }} />
          </div>
          {error && <div style={{ fontSize: 12, color: '#F87171' }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" size="sm" onClick={scheduleCustom}>Запланировать</Button>
        </div>
      </Modal>
    </div>
  );
}

// ─── SCHEDULING HELPERS ──────────────────────────────────────────
const LS_STEP_SCHEDULES = 'wb_release_launch_step_schedules_v1';
const LEGACY_REACT_STEP_SCHEDULE_KEYS = ['wb_rl_step_schedules_v1'];
const LS_AUTOMATION_PLAN = 'wb_rl_automation_v1';
const LS_MAJOR_RELEASE = 'wb_release_launch_major_release_v1';
const LS_MAJOR_TAB = 'wb_release_launch_major_tab_v1';
const LEGACY_MAJOR_RELEASE_KEYS = [
  'wb_release_launch_major_duty_ping_release_v1',
  'wb_release_launch_major_push_ios_release_v1',
  'wb_release_launch_major_push_android_release_v1',
];
const MSK_OFF_S = 3 * 60 * 60 * 1000;

interface StepSchedulePlan {
  key: string;
  scope?: 'push';
  platform: 'ios' | 'android';
  stepIdx: number;
  targetMs: number;
  triggerMode: 'delay' | 'schedule';
  delayMinutes: number | null;
  note?: string;
  createdAt?: number;
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
function buildDefaultSwatScheduleMs(nowMs: number): number {
  let target = parseMskToUtcMs(mskDateStr(nowMs), '10:00');
  if (target <= nowMs) target += 24 * 60 * 60 * 1000;
  return target;
}
function formatMskDateTimeShort(ms: number): string {
  const d = new Date(ms + MSK_OFF_S);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')} ${mskTimeStr(ms)}`;
}
function formatMskDateTimeHuman(ms: number): string {
  const d = new Date(ms + MSK_OFF_S);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year} ${mskTimeStr(ms)} (МСК)`;
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
function stepSK(platform: string, stepIdx: number) { return `push::${platform}::${stepIdx}`; }
function formatStepScheduleStatus(plan?: StepSchedulePlan): { text: string; color: string } {
  if (!plan) {
    return {
      text: 'Можно запланировать этот шаг по таймеру или к точному времени.',
      color: '#64748b',
    };
  }
  const when = formatMskDateTimeHuman(plan.targetMs);
  const note = String(plan.note || '').trim();
  if (note) {
    return {
      text: Date.now() >= plan.targetMs
        ? `Ожидает выполнения: ${note} · ${when}`
        : `Повторная попытка ${when} · ${note}`,
      color: '#b45309',
    };
  }
  if (Date.now() >= plan.targetMs) {
    return { text: `Время наступило: ${when}`, color: '#b45309' };
  }
  return { text: `Запланировано на ${when}`, color: '#0369a1' };
}
function normalizeStepSchedulePlan(raw: unknown): StepSchedulePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const scope = source.scope === 'push' || String(source.key || '').startsWith('push') ? 'push' : 'push';
  const platform = source.platform === 'android' ? 'android' : source.platform === 'ios' ? 'ios' : null;
  const stepIdx = Number(source.stepIdx);
  const targetMs = Number(source.targetMs);
  if (!platform || !Number.isFinite(stepIdx) || stepIdx < 0 || !Number.isFinite(targetMs)) return null;
  const triggerMode = source.triggerMode === 'schedule' ? 'schedule' : 'delay';
  const delayMinutes = Number(source.delayMinutes) > 0 ? Math.max(1, Math.round(Number(source.delayMinutes))) : null;
  return {
    key: stepSK(platform, stepIdx),
    scope,
    platform,
    stepIdx,
    targetMs,
    triggerMode,
    delayMinutes,
    note: String(source.note || '').trim(),
    createdAt: Number(source.createdAt) || Date.now(),
  };
}
function loadStepSchedules(): Record<string, StepSchedulePlan> {
  const out: Record<string, StepSchedulePlan> = {};
  const keys = [LS_STEP_SCHEDULES, ...LEGACY_REACT_STEP_SCHEDULE_KEYS];
  for (const storageKey of keys) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
      if (!raw || typeof raw !== 'object') continue;
      for (const value of Object.values(raw as Record<string, unknown>)) {
        const plan = normalizeStepSchedulePlan(value);
        if (plan) out[plan.key] = plan;
      }
    } catch {}
  }
  return out;
}
function saveStepSchedules(s: Record<string, StepSchedulePlan>) {
  try {
    localStorage.setItem(LS_STEP_SCHEDULES, JSON.stringify(s));
    for (const key of LEGACY_REACT_STEP_SCHEDULE_KEYS) localStorage.removeItem(key);
  } catch {}
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
function loadMajorReleaseStorage(): string {
  try {
    const primary = String(localStorage.getItem(LS_MAJOR_RELEASE) || '').trim();
    if (primary) return primary;
    for (const key of LEGACY_MAJOR_RELEASE_KEYS) {
      const value = String(localStorage.getItem(key) || '').trim();
      if (value) return value;
    }
  } catch {}
  return '';
}
function saveMajorReleaseStorage(value: string) {
  try {
    const normalized = String(value || '').trim();
    if (normalized) localStorage.setItem(LS_MAJOR_RELEASE, normalized);
    else localStorage.removeItem(LS_MAJOR_RELEASE);
    for (const key of LEGACY_MAJOR_RELEASE_KEYS) localStorage.removeItem(key);
  } catch {}
}
function loadMajorTabStorage(): 'collection' | 'release' | 'ping' | 'editor' {
  try {
    const value = String(localStorage.getItem(LS_MAJOR_TAB) || '').trim();
    if (value === 'release' || value === 'ping' || value === 'editor') return value;
  } catch {}
  return 'collection';
}
function saveMajorTabStorage(value: 'collection' | 'release' | 'ping' | 'editor') {
  try {
    localStorage.setItem(LS_MAJOR_TAB, value);
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
  useEffect(() => {
    if (!plan) return;
    setDate(mskDateStr(plan.targetMs));
    setTime(mskTimeStr(plan.targetMs));
    if (plan.delayMinutes) setDelayMin(plan.delayMinutes);
  }, [plan?.key, plan?.targetMs, plan?.delayMinutes]);
  const statusMeta = formatStepScheduleStatus(plan);
  const delayActive = plan?.triggerMode === 'delay';
  const scheduleActive = plan?.triggerMode === 'schedule';
  const inputStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: 12,
    border: '1px solid var(--border-hi)',
    background: 'var(--surface-soft-4)',
    color: 'var(--text)',
    fontSize: 12,
    outline: 'none',
    lineHeight: 1.2,
  };
  const activeScheduleButton: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--card) 84%, var(--blue) 16%)',
    borderColor: 'rgba(59,130,246,.34)',
    boxShadow: 'inset 0 0 0 1px rgba(59,130,246,.12)',
    color: 'var(--blue)',
  };
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 16, background: 'var(--surface-soft)', boxShadow: 'inset 0 0 0 1px var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: statusMeta.color }}>
        {statusMeta.text}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number" min={1} step={1} value={delayMin}
          onChange={e => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
          disabled={disabled} style={{ ...inputStyle, width: 96 }}
        />
        <LegacyWorkflowButton small disabled={disabled} aria-pressed={delayActive} style={delayActive ? activeScheduleButton : undefined} onClick={() => onDelay(delayMin)}>Таймер</LegacyWorkflowButton>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={disabled} style={{ ...inputStyle, width: 144 }} />
        <input type="time" value={time} step={60} onChange={e => setTime(e.target.value)} disabled={disabled} style={{ ...inputStyle, width: 112 }} />
        <LegacyWorkflowButton small disabled={disabled} aria-pressed={scheduleActive} style={scheduleActive ? activeScheduleButton : undefined} onClick={() => onAtTime(date, time)}>По времени</LegacyWorkflowButton>
        {plan && (
          <LegacyWorkflowButton small disabled={disabled} style={{ color: '#e11d48' }} onClick={onCancel}>Отменить</LegacyWorkflowButton>
        )}
      </div>
    </div>
  );
}

// ─── AUTOMATION BLOCK ────────────────────────────────────────────
const AUTOMATION_SUPPORTED: RunMode[] = ['major'];

function buildAutomationScenarioText(_mode: RunMode): string {
  return 'Сценарий: выполнит сбор дежурных и затем автоматически пройдёт шаги 1–5 с ответом «Да».';
}

function AutomationBlock({
  mode, running, automationRunning, plan, tick, onSchedule, onCancel, withDivider = true,
}: {
  mode: RunMode;
  running: boolean;
  automationRunning: boolean;
  plan: AutomationPlan | null;
  tick: number;
  onSchedule: (triggerMode: 'delay' | 'schedule', delayMin: number, date: string, time: string) => void;
  onCancel: () => void;
  withDivider?: boolean;
}) {
  void tick;
  const def15 = Date.now() + 15 * 60 * 1000;
  const [triggerMode, setTriggerMode] = useState<'delay' | 'schedule'>('delay');
  const [delayMin, setDelayMin] = useState(15);
  const [date, setDate] = useState(() => mskDateStr(def15));
  const [time, setTime] = useState(() => mskTimeStr(def15));

  const supported = AUTOMATION_SUPPORTED.includes(mode);
  const busy = running || automationRunning;
  if (!supported && !plan && !automationRunning) return null;

  const scenarioText = buildAutomationScenarioText(plan?.snapshot.mode || mode);

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 8,
    border: '1px solid var(--border-hi)',
    background: 'var(--surface-soft-4)', color: 'var(--text)',
    fontSize: 12, outline: 'none',
  };

  return (
    <>
      {withDivider && <Divider />}
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
  const [nonMajorLogPanelOpen, setNonMajorLogPanelOpen] = useState(false);
  const [nonMajorLogPanelSize, setNonMajorLogPanelSize] = useState({ width: 430, height: 330 });
  const [createdRuns, setCreatedRuns] = useState<LaunchRecord[]>([]);
  const [steps, setSteps] = useState<Array<{ id: string; label: string; status: StepStatus; detail?: string }>>([]);
  const [buildValue, setBuildValue] = useState('');
  const [buildResolving, setBuildResolving] = useState(false);
	  const [swatLead, setSwatLead] = useState<'none' | 'viktor' | 'roman'>('none');
	  const [nonMajorCopyMessage, setNonMajorCopyMessage] = useState('');
	  const [nonMajorYtData, setNonMajorYtData] = useState<MajorYtData | null>(null);
	  const [napiHostsPreviewText, setNapiHostsPreviewText] = useState('');
	  const abortRef = useRef<AbortController | null>(null);

  // ─── step scheduling ───────────────────────────────────────────
  const [stepSchedules, setStepSchedules] = useState<Record<string, StepSchedulePlan>>(loadStepSchedules);
  const stepTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [scheduleTick, setScheduleTick] = useState(0);
  const scheduleTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executeMajorStepRef = useRef<((platform: 'ios' | 'android', stepIdx: number) => Promise<void>) | null>(null);
  const syncMajorPlatformRef = useRef<((platform: 'ios' | 'android', options?: {
    silent?: boolean;
    preserveLocal?: boolean;
    seedStatuses?: PushStatus[];
    applyThreadText?: boolean;
  }) => Promise<void>) | null>(null);
  const majorWorkflowBusyRef = useRef({
    running: false,
    collectionRunning: false,
    iosRunning: false,
    andRunning: false,
    iosSyncing: false,
    andSyncing: false,
    automationRunning: false,
  });

  // ─── automation plan ───────────────────────────────────────────
  const [automationPlan, setAutomationPlan] = useState<AutomationPlan | null>(loadAutomationPlan);
  const [automationRunning, setAutomationRunning] = useState(false);
  const automationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [automTick, setAutomTick] = useState(0);
  const automTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executeAutomationRef = useRef<((plan: AutomationPlan) => Promise<void>) | null>(null);
  const armAutomationPlanRef = useRef<((plan: AutomationPlan) => void) | null>(null);

  const [streams, setStreams] = useState<DutyStream[]>([]);
  const [pollText, setPollText] = useState('');
  const [majorPollStatusText, setMajorPollStatusText] = useState('Получаем стримы из Allure...');
  const [iosRelease, setIosRelease] = useState(loadMajorReleaseStorage);
  const [andRelease, setAndRelease] = useState(loadMajorReleaseStorage);
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
  const [majorTab, setMajorTab] = useState<'collection' | 'release' | 'ping' | 'editor'>(loadMajorTabStorage);

  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeText, setNoticeText] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeRunning, setNoticeRunning] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const [noticeStatusByChannel, setNoticeStatusByChannel] = useState<Record<string, { state: NoticeChannelState; message: string }>>({});

  const [dutyPingStates, setDutyPingStates] = useState<Record<MajorPlatform, DutyPingUiState>>({
    ios: emptyDutyPingState(),
    android: emptyDutyPingState(),
  });
  const dutyPingAbortRefs = useRef<Record<MajorPlatform, AbortController | null>>({ ios: null, android: null });
  const iosCompTimerRef = useRef<number | null>(null);
  const andCompTimerRef = useRef<number | null>(null);
  const [componentTimers, setComponentTimers] = useState<Record<MajorPlatform, ComponentTimerUiState>>({
    ios: emptyComponentTimerState(),
    android: emptyComponentTimerState(),
  });
  const componentTimersRef = useRef<Record<MajorPlatform, ComponentTimerUiState>>({
    ios: emptyComponentTimerState(),
    android: emptyComponentTimerState(),
  });
  const componentTimerTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [componentTimerTick, setComponentTimerTick] = useState(0);

  const [collectionRunning, setCollectionRunning] = useState(false);
  const [collectionRows, setCollectionRows] = useState<CollectionRow[]>([]);
  const [collectionLogs, setCollectionLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [collectionLogPanelOpen, setCollectionLogPanelOpen] = useState(false);
  const [collectionLogPanelSize, setCollectionLogPanelSize] = useState({ width: 430, height: 330 });
  const [collectionCopyStates, setCollectionCopyStates] = useState<Record<'list' | 'threads', CopyFeedbackState>>({ list: 'idle', threads: 'idle' });
  const collectionCopyTimersRef = useRef<Record<'list' | 'threads', ReturnType<typeof setTimeout> | null>>({ list: null, threads: null });
  const collectionRowsRef = useRef<CollectionRow[]>([]);
  const [dutyPingLogs, setDutyPingLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [dutyPingLogPanelOpen, setDutyPingLogPanelOpen] = useState(false);
  const [dutyPingLogPanelSize, setDutyPingLogPanelSize] = useState({ width: 430, height: 330 });
  const [collectionBandDisplayNames, setCollectionBandDisplayNames] = useState<Record<string, string>>({});
  const collectionBandNamesAbortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    majorWorkflowBusyRef.current = {
      running,
      collectionRunning,
      iosRunning,
      andRunning,
      iosSyncing,
      andSyncing,
      automationRunning,
    };
  }, [running, collectionRunning, iosRunning, andRunning, iosSyncing, andSyncing, automationRunning]);

  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorStatus, setEditorStatus] = useState<{ text: string; level: LogLevel | 'idle' }>({ text: '', level: 'idle' });
  const [editorLoadedOnce, setEditorLoadedOnce] = useState(false);
  const [editorLeads, setEditorLeads] = useState<EditorLeadRow[]>([]);
  const [editorStreamGroups, setEditorStreamGroups] = useState<EditorStreamGroupRow[]>([]);
  const [editorTablesText, setEditorTablesText] = useState('[]');
  const [editorMeta, setEditorMeta] = useState<Record<string, unknown>>({});
  const [editorAllureLeaves, setEditorAllureLeaves] = useState<DutyEditorAllureLeaf[]>([]);
  const [editorLeadsCollapsed, setEditorLeadsCollapsed] = useState(false);
  const [editorStreamGroupsCollapsed, setEditorStreamGroupsCollapsed] = useState(false);
  const [editorPresence, setEditorPresence] = useState<Record<string, BandPresenceStatus>>({});
  const [editorPresenceLoading, setEditorPresenceLoading] = useState(false);
  const [editorLeadProfiles, setEditorLeadProfiles] = useState<Record<string, BandUserSuggestion>>({});
  const [editorLeadAvatarUrls, setEditorLeadAvatarUrls] = useState<Record<string, string>>({});
  const [editorLeadSearch, setEditorLeadSearch] = useState<Record<string, { loading: boolean; items: BandUserSuggestion[]; error: string; open: boolean }>>({});
  const editorLoadAbortRef = useRef<AbortController | null>(null);
  const editorLeadProfilesAbortRef = useRef<AbortController | null>(null);
  const editorLeadAvatarAbortRef = useRef<AbortController | null>(null);
  const editorLeadAvatarCacheRef = useRef<Record<string, { requestKey: string; url: string }>>({});
  const editorLeadSearchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const editorLeadSearchAbortRefs = useRef<Record<string, AbortController>>({});

  const token = String(settings.allureToken || '').replace(/^Api-Token\s+/i, '').trim();
  const cookies = String(settings.bandCookies || '').trim();
  const adminCookies = String(settings.bandCookiesAdmin || '').trim();
  const proxyBase = String(settings.proxyBase || '').trim();
  const gasUrl = QA_LEADS_SCRIPT_URL;

  const log = useCallback((text: string, level: LogLevel = 'info') =>
    setLogs(prev => [...prev.slice(-300), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]), []);

  const collLog = useCallback((text: string, level: LogLevel = 'info') =>
    setCollectionLogs(prev => [...prev.slice(-300), { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level }]), []);

  useEffect(() => {
    collectionRowsRef.current = collectionRows;
  }, [collectionRows]);

  const majorSharedRelease = useMemo(() => {
    const ios = String(iosRelease || '').trim();
    const android = String(andRelease || '').trim();
    return ios && android && ios !== android ? ios : (ios || android);
  }, [iosRelease, andRelease]);

  const updateMajorSharedRelease = useCallback((value: string) => {
    setIosRelease(value);
    setAndRelease(value);
    saveMajorReleaseStorage(value);
    setNoticeText('');
  }, []);

  const updateMajorTab = useCallback((value: 'collection' | 'release' | 'ping' | 'editor') => {
    setMajorTab(value);
    saveMajorTabStorage(value);
  }, []);

  const updateDutyPingState = useCallback((platform: MajorPlatform, patch: Partial<DutyPingUiState>) => {
    setDutyPingStates(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }));
  }, []);

  const dutyPingLog = useCallback((platform: MajorPlatform, text: string, level: LogLevel = 'info') => {
    const line = { text: `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`, level };
    setDutyPingStates(prev => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        logs: [...prev[platform].logs.slice(-120), line],
      },
    }));
    setDutyPingLogs(prev => [...prev.slice(-300), line]);
  }, []);

  const updateComponentTimerState = useCallback((platform: MajorPlatform, patch: Partial<ComponentTimerUiState>) => {
    setComponentTimers(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }));
  }, []);

  useEffect(() => {
    componentTimersRef.current = componentTimers;
  }, [componentTimers]);

  useEffect(() => {
    const hasRunningTimer = componentTimers.ios.running || componentTimers.android.running;
    if (hasRunningTimer && !componentTimerTickerRef.current) {
      componentTimerTickerRef.current = setInterval(() => setComponentTimerTick(t => t + 1), 1000);
    }
    if (!hasRunningTimer && componentTimerTickerRef.current) {
      clearInterval(componentTimerTickerRef.current);
      componentTimerTickerRef.current = null;
    }
  }, [componentTimers.ios.running, componentTimers.android.running]);

  const collectionDisplayRows = useMemo(() => buildCollectionDisplayRows(collectionRows), [collectionRows]);

  useEffect(() => {
    const handles = uniqueFilled(
      collectionDisplayRows
        .flatMap(row => [row.iosDuty, row.androidDuty, ...row.leadHandles])
        .map(normalizeCollectionBandHandle)
        .filter(Boolean),
    );

    collectionBandNamesAbortRef.current?.abort();
    if (!handles.length) {
      setCollectionBandDisplayNames({});
      collectionBandNamesAbortRef.current = null;
      return;
    }
    if (!cookies.trim()) {
      collectionBandNamesAbortRef.current = null;
      return;
    }

    const ac = new AbortController();
    collectionBandNamesAbortRef.current = ac;
    fetchBandDisplayNamesByHandles(proxyBase, cookies, handles, ac.signal)
      .then(names => {
        if (ac.signal.aborted) return;
        setCollectionBandDisplayNames(prev => ({ ...prev, ...names }));
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setCollectionBandDisplayNames(prev => ({ ...prev }));
        }
      });

    return () => ac.abort();
  }, [collectionDisplayRows, cookies, proxyBase]);

  const collectionStats = useMemo(() => {
    const missingCount = collectionDisplayRows.filter(row => row.missing).length;
    return {
      total: collectionDisplayRows.length,
      filled: collectionDisplayRows.length - missingCount,
      missing: missingCount,
      messages: collectionMessages.length,
      iosIds: Object.keys(collectionIdMaps.ios || {}).length,
      androidIds: Object.keys(collectionIdMaps.android || {}).length,
    };
  }, [collectionDisplayRows, collectionMessages, collectionIdMaps]);

  useEffect(() => {
    const timers = collectionCopyTimersRef.current;
    return () => {
      for (const timer of Object.values(timers)) {
        if (timer) clearTimeout(timer);
      }
    };
  }, []);

  const runCollectionCopyAction = useCallback(async (kind: 'list' | 'threads') => {
    if (collectionRunning || !collectionRows.length) return;
    if (collectionCopyStates[kind] === 'loading' || collectionCopyStates[kind] === 'success') return;

    const timer = collectionCopyTimersRef.current[kind];
    if (timer) clearTimeout(timer);
    collectionCopyTimersRef.current[kind] = null;
    setCollectionCopyStates(prev => ({ ...prev, [kind]: 'loading' }));

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    try {
      let streamGroups = editorStreamGroups;
      if (kind === 'threads' && !editorLoadedOnce) {
        const data = await fetchDutyEditorData(proxyBase, token);
        streamGroups = data.streamEntries;
        setEditorLeads(data.leadsEntries);
        setEditorStreamGroups(data.streamEntries);
        setEditorTablesText(JSON.stringify(Array.isArray(data.tables) ? data.tables : [], null, 2));
        setEditorMeta(data.meta || {});
        setEditorAllureLeaves(Array.isArray(data.allureLeaves) ? data.allureLeaves : []);
        setEditorDirty(false);
        setEditorLoadedOnce(true);
      }
      const text = kind === 'list'
        ? buildCurrentDutiesCopyText(collectionRows)
        : buildCurrentDutyThreadsCopyText(collectionRows, streamGroups);
      const copied = await copyTextToClipboard(text);
      if (!copied) {
        setCollectionCopyStates(prev => ({ ...prev, [kind]: 'idle' }));
        return;
      }
      setCollectionCopyStates(prev => ({ ...prev, [kind]: 'success' }));
      collectionCopyTimersRef.current[kind] = setTimeout(() => {
        setCollectionCopyStates(prev => ({ ...prev, [kind]: 'idle' }));
        collectionCopyTimersRef.current[kind] = null;
      }, 2000);
    } catch (error) {
      setCollectionCopyStates(prev => ({ ...prev, [kind]: 'idle' }));
      collLog(`Не удалось скопировать ${kind === 'list' ? 'список' : 'треды'}: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }, [collectionCopyStates, collectionRows, collectionRunning, editorStreamGroups, editorLoadedOnce, proxyBase, token, collLog]);

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
          if (localStatus === 'done') return 'done';
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

  useEffect(() => {
    syncMajorPlatformRef.current = syncMajorPlatform;
  }, [syncMajorPlatform]);

  const refreshMajorPollFromAllure = useCallback(async (signal?: AbortSignal): Promise<string> => {
    setMajorPollStatusText('Получаем стримы из Allure...');
    setPollText('Загружаю стримы из Allure...');
    try {
      if (!String(token || '').trim()) throw new Error('Нужен Allure token для опроса.');
      const freshPollText = await refreshMajorPollTextFromAllure(token, proxyBase, signal);
      setPollText(freshPollText);
      setMajorPollStatusText(`Стримов из Allure: ${countMajorPollOptions(freshPollText)}. Текст опроса только для просмотра.`);
      return freshPollText;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      const message = error instanceof Error ? error.message : String(error || 'Не удалось получить стримы из Allure');
      setPollText('');
      setMajorPollStatusText(message);
      throw error;
    }
  }, [token, proxyBase]);

  const applyCollectionResult = useCallback((
    result: CollectionResult,
    preserveStatuses = false,
    statusesSeed?: PushStatus[],
  ) => {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const dutyStreams = mapRowsToDutyStreams(rows);
    collectionRowsRef.current = rows;
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
        const nextPollText = buildMajorPollText(dutyStreams.map(stream => stream.name));
        setPollText(nextPollText);
        setMajorPollStatusText(`Стримов из Allure: ${countMajorPollOptions(nextPollText)}. Текст опроса только для просмотра.`);
      } catch (error) {
        setPollText('');
        setMajorPollStatusText(error instanceof Error ? error.message : String(error || 'Не удалось получить стримы из Allure'));
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

  const ensureCollectionRowsForMajorStep = useCallback(async (signal?: AbortSignal): Promise<CollectionRow[]> => {
    if (collectionRows.length) return collectionRows;
    const ac = new AbortController();
    const abortCollection = () => ac.abort();
    signal?.addEventListener('abort', abortCollection, { once: true });
    collectionAbortRef.current = ac;
    setCollectionRunning(true);
    try {
      const result = await runCollection(proxyBase, cookies, token, gasUrl, collLog, ac.signal);
      applyCollectionResult(result);
      return result.rows;
    } finally {
      signal?.removeEventListener('abort', abortCollection);
      collectionAbortRef.current = null;
      setCollectionRunning(false);
    }
  }, [collectionRows, proxyBase, cookies, token, gasUrl, collLog, applyCollectionResult]);

  const resetCollectionWorkflow = useCallback(() => {
    const nextStatuses = COLLECTION_WORKFLOW_STEPS.map(() => 'pending' as PushStatus);
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(0);
    setCollectionPingFound(false);
    setCollectionIdMaps({ ios: {}, android: {} });
    collLog('Workflow сброшен.', 'warn');
  }, [collLog]);

  const skipCollectionWorkflowStep = useCallback((idx: number) => {
    if (collectionRunning) return;
    const nextStatuses = collectionWorkflowStatuses.map((status, currentIdx) =>
      currentIdx === idx ? 'skipped' : status,
    );
    setCollectionWorkflowStatuses(nextStatuses);
    setCollectionWorkflowCurrentIdx(firstPendingIndex(nextStatuses));
    collLog(`${COLLECTION_WORKFLOW_STEPS[idx]?.title || `Шаг ${idx + 1}`}: пропущено по решению пользователя.`, 'warn');
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
          const statusesSeed = collectionWorkflowStatuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          );
          if (!String(pingText || '').trim()) {
            collLog('[Шаг 1] Публикация запроса не требуется: все дежурные найдены.', 'ok');
          } else if (collectionPingFound || hasCollectionPingMessage(collectionMessages)) {
            setCollectionPingFound(true);
            collLog('[Шаг 1] Запрос дежурных уже найден в чате, повторная публикация не нужна.', 'ok');
          } else {
            await publishCollectionPing(proxyBase, cookies, rows, ac.signal);
            setCollectionPingFound(true);
            collLog('Пинг опубликован в чат SWAT QA.', 'ok');
            await waitForBandReadConsistency(350, ac.signal);
          }

          if (collectionSinceMs) {
            const refreshed = await refreshCollectionSince(proxyBase, cookies, gasUrl, token, collectionSinceMs, collLog, ac.signal);
            applyCollectionResult(refreshed, true, statusesSeed);
          } else {
            setCollectionWorkflowStatuses(statusesSeed);
            setCollectionWorkflowCurrentIdx(firstPendingIndex(statusesSeed));
          }
          break;
        }
        case 'publishMissing': {
          await publishMissingDutyPosts(proxyBase, cookies, rows, collLog, ac.signal);
          collLog('Недостающие дежурные опубликованы.', 'ok');
          if (collectionSinceMs) {
            const statusesSeed = collectionWorkflowStatuses.map((status, currentIdx) =>
              currentIdx === idx ? 'done' : status,
            );
            await waitForBandReadConsistency(350, ac.signal);
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
    pingText,
    collectionPingFound,
    collectionMessages,
    gasUrl,
    token,
    applyCollectionResult,
    collectionIdMaps,
    adminCookies,
  ]);

  const loadEditorBandAssets = useCallback(async (
    leads: DutyEditorLeadEntry[],
    signal?: AbortSignal,
  ): Promise<{
    profiles: Record<string, BandUserSuggestion>;
    presence: Record<string, BandPresenceStatus>;
    avatarUrls: Record<string, string>;
  }> => {
    const usernames = collectEditorBandUsernames(leads);
    if (!usernames.length || !cookies || !proxyBase) {
      return { profiles: {}, presence: {}, avatarUrls: {} };
    }

    setEditorStatus({ text: 'Загружаю Band-профили...', level: 'info' });
    const handles = usernames.map(username => `@${username}`);
    const [users, presence] = await Promise.all([
      fetchBandUsersByUsernames(proxyBase, cookies, usernames, signal),
      fetchBandPresenceByHandles(proxyBase, cookies, handles, signal).catch(() => ({} as Record<string, BandPresenceStatus>)),
    ]);
    if (signal?.aborted) return { profiles: {}, presence: {}, avatarUrls: {} };

    const profiles: Record<string, BandUserSuggestion> = {};
    for (const user of users) {
      const key = editorBandProfileKey(user.handle);
      const status = presence[user.handle] || presence[editorBandProfileKey(user.handle)] || user.presence;
      if (key) profiles[key] = { ...user, presence: status };
    }

    setEditorStatus({ text: 'Загружаю аватарки Band...', level: 'info' });
    const uniqueUsers = Object.values(profiles)
      .filter(profile => String(profile.id || '').trim())
      .filter((profile, idx, list) => list.findIndex(item => item.id === profile.id) === idx);
    const avatarUrls: Record<string, string> = {};

    await Promise.all(uniqueUsers.map(async profile => {
      const requestKey = `${profile.id}:${Number(profile.avatarStamp || 0)}`;
      const cached = editorLeadAvatarCacheRef.current[profile.id];
      if (cached?.requestKey === requestKey) {
        if (cached.url) avatarUrls[profile.id] = cached.url;
        return;
      }
      if (cached?.url) URL.revokeObjectURL(cached.url);
      delete editorLeadAvatarCacheRef.current[profile.id];

      try {
        const blob = await fetchBandUserAvatarBlob(proxyBase, cookies, profile.id, profile.avatarStamp, signal);
        if (signal?.aborted || !blob) {
          editorLeadAvatarCacheRef.current[profile.id] = { requestKey, url: '' };
          return;
        }
        const url = URL.createObjectURL(blob);
        if (signal?.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        editorLeadAvatarCacheRef.current[profile.id] = { requestKey, url };
        avatarUrls[profile.id] = url;
      } catch {
        if (!signal?.aborted) {
          editorLeadAvatarCacheRef.current[profile.id] = { requestKey, url: '' };
        }
      }
    }));

    return { profiles, presence, avatarUrls };
  }, [cookies, proxyBase]);

  const loadEditor = useCallback(async (force = false) => {
    if (editorLoading || (editorLoadedOnce && !force)) return;
    editorLoadAbortRef.current?.abort();
    editorLeadProfilesAbortRef.current?.abort();
    editorLeadAvatarAbortRef.current?.abort();
    const ac = new AbortController();
    editorLoadAbortRef.current = ac;
    setEditorLoading(true);
    setEditorStatus({ text: 'Загрузка данных редактора...', level: 'info' });
    try {
      const data = await fetchDutyEditorData(proxyBase, token);
      if (ac.signal.aborted) return;
      const leadRows = data.leadsEntries.map(row => ({ ...row, editing: false }));
      const streamRows = data.streamEntries.map(row => ({ ...row, editing: false }));
      const assets = await loadEditorBandAssets(leadRows, ac.signal);
      if (ac.signal.aborted) return;
      setEditorLeads(leadRows);
      setEditorStreamGroups(streamRows);
      setEditorTablesText(JSON.stringify(Array.isArray(data.tables) ? data.tables : [], null, 2));
      setEditorMeta(data.meta || {});
      setEditorAllureLeaves(Array.isArray(data.allureLeaves) ? data.allureLeaves : []);
      setEditorLeadProfiles(assets.profiles);
      setEditorPresence(assets.presence);
      setEditorLeadAvatarUrls(prev => ({ ...prev, ...assets.avatarUrls }));
      setEditorPresenceLoading(false);
      setEditorLeadSearch({});
      setEditorDirty(false);
      setEditorLoadedOnce(true);
      setEditorStatus({ text: 'Редактор загружен.', level: 'ok' });
    } catch (error) {
      if (!ac.signal.aborted) {
        setEditorStatus({ text: error instanceof Error ? error.message : String(error), level: 'error' });
      }
    } finally {
      if (!ac.signal.aborted) {
        setEditorLoading(false);
        editorLoadAbortRef.current = null;
      }
    }
  }, [editorLoading, editorLoadedOnce, loadEditorBandAssets, proxyBase, token]);

  const syncEditorAllureForSave = useCallback(async (leads: DutyEditorLeadEntry[]) => {
    const nextLeads = leads.map(row => ({
      ...row,
      values: Array.isArray(row.values) ? [...row.values] : [],
    }));
    const nextLeaves = editorAllureLeaves.map(leaf => ({ ...leaf }));
    const leafById = new Map<number, DutyEditorAllureLeaf>();
    for (const leaf of nextLeaves) {
      const id = Number(leaf.id);
      if (Number.isFinite(id) && id > 0) leafById.set(id, leaf);
    }

    const seenStreams = new Set<string>();
    for (const row of nextLeads) {
      const streamName = String(row.name || '').trim();
      if (!streamName) throw new Error(DUTY_EDITOR_EMPTY_STREAM_ERROR);
      const values = Array.isArray(row.values) ? row.values.map(value => String(value || '').trim()) : [];
      const streamNames = isCoreEditorLead(row) ? ['Core iOS', 'Core Android'] : [streamName];
      const requiredLeads = isCoreEditorLead(row) ? [values[0] || '', values[1] || ''] : [values[0] || ''];
      requiredLeads.forEach((leadValue, idx) => {
        if (!leadValue.trim()) {
          throw new Error(isCoreEditorLead(row) ? 'Заполни лидов iOS и Android для стрима "Core"' : `Заполни лида для стрима "${streamName}"`);
        }
        const key = streamNames[idx].trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
        if (seenStreams.has(key)) throw new Error(`Повторяющееся название стрима: ${streamNames[idx]}`);
        seenStreams.add(key);
      });
    }

    const activeIdsBeforeCreate = new Set<number>();
    let needsAllureSync = false;
    for (const row of nextLeads) {
      const streamName = String(row.name || '').trim();
      const leafId = Number(row.allureLeafId);
      if (Number.isFinite(leafId) && leafId > 0) {
        activeIdsBeforeCreate.add(leafId);
        const previousName = String(leafById.get(leafId)?.name || '').trim();
        if (previousName && previousName !== streamName) needsAllureSync = true;
      } else {
        needsAllureSync = true;
      }
    }
    for (const leaf of nextLeaves) {
      const leafId = Number(leaf.id);
      if (Number.isFinite(leafId) && leafId > 0 && !activeIdsBeforeCreate.has(leafId)) {
        needsAllureSync = true;
        break;
      }
    }

    if (!needsAllureSync) return { leads: nextLeads, leaves: nextLeaves };
    if (!token) throw new Error('Нужен Allure токен для создания, переименования или удаления стримов.');

    for (const row of nextLeads) {
      const streamName = String(row.name || '').trim();
      const leafId = Number(row.allureLeafId);
      if (!Number.isFinite(leafId) || leafId <= 0) {
        setEditorStatus({ text: `Создаю стрим "${streamName}" в Allure...`, level: 'info' });
        const created = await createDutyEditorAllureLeaf(token, streamName);
        row.allureLeafId = created.id;
        nextLeaves.push(created);
        if (created.id) leafById.set(created.id, created);
        continue;
      }

      const previousName = String(leafById.get(leafId)?.name || '').trim();
      if (previousName && previousName !== streamName) {
        setEditorStatus({ text: `Переименовываю стрим "${previousName}" в Allure...`, level: 'info' });
        await renameDutyEditorAllureLeaf(token, leafId, streamName);
        const leaf = leafById.get(leafId);
        if (leaf) leaf.name = streamName;
      }
    }

    const activeIdsAfterCreate = new Set(nextLeads
      .map(row => Number(row.allureLeafId))
      .filter(id => Number.isFinite(id) && id > 0));
    for (let idx = nextLeaves.length - 1; idx >= 0; idx -= 1) {
      const leaf = nextLeaves[idx];
      const leafId = Number(leaf.id);
      if (!Number.isFinite(leafId) || leafId <= 0 || activeIdsAfterCreate.has(leafId)) continue;
      setEditorStatus({ text: `Удаляю стрим "${leaf.name}" из Allure...`, level: 'info' });
      await deleteDutyEditorAllureLeaf(token, leafId);
      nextLeaves.splice(idx, 1);
    }

    return {
      leads: nextLeads,
      leaves: [...nextLeaves].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru')),
    };
  }, [editorAllureLeaves, token]);

  const persistEditor = useCallback(async (
    leadRows: EditorLeadRow[] = editorLeads,
    streamRows: EditorStreamGroupRow[] = editorStreamGroups,
  ): Promise<boolean> => {
    if (editorSaving) return false;
    setEditorSaving(true);
    setEditorStatus({ text: 'Сохранение...', level: 'info' });
    try {
      const parsed = JSON.parse(editorTablesText || '[]');
      if (!Array.isArray(parsed)) {
        throw new Error('Tables JSON должен быть массивом.');
      }
      const cleanLeads = cleanEditorLeadRows(leadRows);
      const cleanStreamGroups = cleanEditorStreamGroupRows(streamRows);
      const synced = await syncEditorAllureForSave(cleanLeads);
      const payload: DutyEditorData = {
        leadsEntries: synced.leads,
        streamEntries: cleanStreamGroups,
        tables: parsed,
        meta: editorMeta,
        allureLeaves: synced.leaves,
      };
      const saved = await saveDutyEditorData(proxyBase, payload);
      let assets: Awaited<ReturnType<typeof loadEditorBandAssets>> = { profiles: {}, presence: {}, avatarUrls: {} };
      let assetWarning = false;
      try {
        assets = await loadEditorBandAssets(saved.leadsEntries);
      } catch {
        assetWarning = true;
      }
      setEditorLeads(saved.leadsEntries.map(row => ({ ...row, editing: false })));
      setEditorStreamGroups(saved.streamEntries.map(row => ({ ...row, editing: false })));
      setEditorTablesText(JSON.stringify(Array.isArray(saved.tables) ? saved.tables : [], null, 2));
      setEditorMeta(saved.meta || {});
      setEditorAllureLeaves(Array.isArray(saved.allureLeaves) ? saved.allureLeaves : []);
      setEditorLeadProfiles(prev => ({ ...prev, ...assets.profiles }));
      setEditorPresence(prev => ({ ...prev, ...assets.presence }));
      setEditorLeadAvatarUrls(prev => ({ ...prev, ...assets.avatarUrls }));
      setEditorDirty(false);
      setEditorStatus(assetWarning
        ? { text: 'Сохранено, но Band-профили не обновились.', level: 'warn' }
        : { text: 'Редактор сохранён.', level: 'ok' });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorStatus(message === DUTY_EDITOR_EMPTY_STREAM_ERROR || message === 'Заполни название стрима'
        ? { text: '', level: 'idle' }
        : { text: message, level: 'error' });
      return false;
    } finally {
      setEditorSaving(false);
    }
  }, [
    editorSaving,
    editorTablesText,
    syncEditorAllureForSave,
    editorLeads,
    editorStreamGroups,
    editorMeta,
    proxyBase,
    loadEditorBandAssets,
  ]);

  const clearAllEditorLeadSearch = useCallback(() => {
    Object.values(editorLeadSearchTimersRef.current).forEach(timer => clearTimeout(timer));
    Object.values(editorLeadSearchAbortRefs.current).forEach(ac => ac.abort());
    editorLeadSearchTimersRef.current = {};
    editorLeadSearchAbortRefs.current = {};
    setEditorLeadSearch({});
  }, []);

  const addLeadRow = useCallback(() => {
    if (editorSaving) return;
    clearAllEditorLeadSearch();
    setEditorLeads(prev => [{
      name: '',
      values: [''],
      allureLeafId: null,
      editing: true,
      draft: { name: '', values: [''], allureLeafId: null, isNew: true },
    }, ...prev]);
    setEditorDirty(true);
  }, [clearAllEditorLeadSearch, editorSaving]);

  const removeLeadRow = useCallback((idx: number) => {
    if (editorSaving) return;
    clearAllEditorLeadSearch();
    const previousLeads = editorLeads;
    const nextLeads = editorLeads.filter((_, currentIdx) => currentIdx !== idx);
    setEditorLeads(nextLeads);
    setEditorDirty(true);
    void persistEditor(nextLeads, editorStreamGroups).then(saved => {
      if (!saved) setEditorLeads(previousLeads);
    });
  }, [clearAllEditorLeadSearch, editorLeads, editorSaving, editorStreamGroups, persistEditor]);

  const startLeadEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    setEditorLeads(prev => prev.map((row, currentIdx) => currentIdx === idx ? {
      ...row,
      editing: true,
      draft: {
        name: row.name,
        values: Array.isArray(row.values) ? [...row.values] : [],
        allureLeafId: row.allureLeafId ?? null,
      },
    } : row));
  }, [editorSaving]);

  const confirmLeadEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    clearAllEditorLeadSearch();
    if (!editorLeads[idx]) return;
    void persistEditor(editorLeads, editorStreamGroups);
  }, [clearAllEditorLeadSearch, editorLeads, editorSaving, editorStreamGroups, persistEditor]);

  const cancelLeadEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    clearAllEditorLeadSearch();
    setEditorLeads(prev => prev.flatMap((row, currentIdx) => {
      if (currentIdx !== idx) return [row];
      const draft = row.draft;
      if (draft?.isNew) return [];
      if (!draft) return [{ ...row, editing: false }];
      const { draft: _draft, ...rest } = row;
      return [{
        ...rest,
        name: draft.name,
        values: Array.isArray(draft.values) ? [...draft.values] : [],
        allureLeafId: draft.allureLeafId ?? null,
        editing: false,
      }];
    }));
  }, [clearAllEditorLeadSearch, editorSaving]);

  const updateLeadRow = useCallback((idx: number, field: 'name' | 'value', value: string, valueIndex = 0) => {
    setEditorLeads(prev => prev.map((row, currentIdx) => {
      if (currentIdx !== idx) return row;
      if (field === 'name') return { ...row, name: value };
      const values = Array.isArray(row.values) ? [...row.values] : [];
      while (values.length <= valueIndex) values.push('');
      values[valueIndex] = value;
      return { ...row, values };
    }));
    setEditorDirty(true);
  }, []);

  const clearEditorLeadSearch = useCallback((key: string) => {
    const timer = editorLeadSearchTimersRef.current[key];
    if (timer) {
      clearTimeout(timer);
      delete editorLeadSearchTimersRef.current[key];
    }
    const ac = editorLeadSearchAbortRefs.current[key];
    if (ac) {
      ac.abort();
      delete editorLeadSearchAbortRefs.current[key];
    }
    setEditorLeadSearch(prev => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const queueEditorLeadSearch = useCallback((idx: number, valueIndex: number, value: string) => {
    const key = `${idx}:${valueIndex}`;
    const query = String(value || '').trim();
    const timer = editorLeadSearchTimersRef.current[key];
    if (timer) clearTimeout(timer);
    const prevAbort = editorLeadSearchAbortRefs.current[key];
    if (prevAbort) {
      prevAbort.abort();
      delete editorLeadSearchAbortRefs.current[key];
    }

    if (query.length < 2 || query.startsWith('@') || !cookies) {
      clearEditorLeadSearch(key);
      return;
    }

    setEditorLeadSearch(prev => ({ ...prev, [key]: { loading: true, items: [], error: '', open: true } }));
    editorLeadSearchTimersRef.current[key] = setTimeout(async () => {
      const ac = new AbortController();
      editorLeadSearchAbortRefs.current[key] = ac;
      try {
        const items = await searchBandUsers(proxyBase, cookies, query, ac.signal);
        setEditorLeadProfiles(prev => {
          const next = { ...prev };
          for (const item of items) {
            const key = editorBandProfileKey(item.handle);
            if (key) next[key] = item;
          }
          return next;
        });
        setEditorLeadSearch(prev => ({ ...prev, [key]: { loading: false, items, error: '', open: true } }));
      } catch (error) {
        if (ac.signal.aborted) return;
        setEditorLeadSearch(prev => ({
          ...prev,
          [key]: {
            loading: false,
            items: [],
            error: error instanceof Error ? error.message : String(error),
            open: true,
          },
        }));
      } finally {
        delete editorLeadSearchAbortRefs.current[key];
        delete editorLeadSearchTimersRef.current[key];
      }
    }, 220);
  }, [clearEditorLeadSearch, cookies, proxyBase]);

  const addStreamGroupRow = useCallback(() => {
    if (editorSaving) return;
    setEditorStreamGroups(prev => [{
      name: '',
      streams: [''],
      editing: true,
      draft: { name: '', streams: [''], isNew: true },
    }, ...prev]);
    setEditorDirty(true);
  }, [editorSaving]);

  const removeStreamGroupRow = useCallback((idx: number) => {
    if (editorSaving) return;
    const previousGroups = editorStreamGroups;
    const nextGroups = editorStreamGroups.filter((_, currentIdx) => currentIdx !== idx);
    setEditorStreamGroups(nextGroups);
    setEditorDirty(true);
    void persistEditor(editorLeads, nextGroups).then(saved => {
      if (!saved) setEditorStreamGroups(previousGroups);
    });
  }, [editorLeads, editorSaving, editorStreamGroups, persistEditor]);

  const startStreamGroupEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => currentIdx === idx ? {
      ...row,
      editing: true,
      draft: {
        name: row.name,
        streams: Array.isArray(row.streams) ? [...row.streams] : [],
      },
    } : row));
  }, [editorSaving]);

  const confirmStreamGroupEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    if (!editorStreamGroups[idx]) return;
    void persistEditor(editorLeads, editorStreamGroups);
  }, [editorLeads, editorSaving, editorStreamGroups, persistEditor]);

  const cancelStreamGroupEditing = useCallback((idx: number) => {
    if (editorSaving) return;
    setEditorStreamGroups(prev => prev.flatMap((row, currentIdx) => {
      if (currentIdx !== idx) return [row];
      const draft = row.draft;
      if (draft?.isNew) return [];
      if (!draft) return [{ ...row, editing: false }];
      const { draft: _draft, ...rest } = row;
      return [{
        ...rest,
        name: draft.name,
        streams: Array.isArray(draft.streams) ? [...draft.streams] : [],
        editing: false,
      }];
    }));
  }, [editorSaving]);

  const updateStreamGroupRow = useCallback((idx: number, field: 'name' | 'streams', value: string) => {
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => {
      if (currentIdx !== idx) return row;
      if (field === 'name') return { ...row, name: value };
      return { ...row, streams: parseStreamList(value) };
    }));
    setEditorDirty(true);
  }, []);

  const updateStreamGroupValue = useCallback((idx: number, valueIndex: number, value: string) => {
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => {
      if (currentIdx !== idx) return row;
      const streams = Array.isArray(row.streams) ? [...row.streams] : [];
      while (streams.length <= valueIndex) streams.push('');
      streams[valueIndex] = value;
      return { ...row, streams };
    }));
    setEditorDirty(true);
  }, []);

  const addStreamGroupValue = useCallback((idx: number) => {
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => currentIdx === idx
      ? { ...row, streams: [...(Array.isArray(row.streams) ? row.streams : []), ''] }
      : row));
    setEditorDirty(true);
  }, []);

  const removeStreamGroupValue = useCallback((idx: number, valueIndex: number) => {
    setEditorStreamGroups(prev => prev.map((row, currentIdx) => currentIdx === idx
      ? { ...row, streams: (Array.isArray(row.streams) ? row.streams : []).filter((_, currentValueIdx) => currentValueIdx !== valueIndex) }
      : row));
    setEditorDirty(true);
  }, []);

  useEffect(() => {
    if (iosRelease) setIosText(buildMajorThreadTemplate('ios', iosRelease));
  }, [iosRelease]);

  useEffect(() => {
    if (andRelease) setAndText(buildMajorThreadTemplate('android', andRelease));
  }, [andRelease]);

  useEffect(() => {
    if (mode !== 'major') return;
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
  }, [mode, iosRelease, andRelease, syncMajorPlatform]);

  useEffect(() => {
    if (mode !== 'major' || majorTab !== 'release') return;
    const ac = new AbortController();
    void refreshMajorPollFromAllure(ac.signal).catch(error => {
      if ((error as Error)?.name !== 'AbortError') {
        console.warn('[Major poll] failed to refresh from Allure', error);
      }
    });
    return () => ac.abort();
  }, [mode, majorTab, refreshMajorPollFromAllure]);

  useEffect(() => {
    if (mode === 'major' && majorTab === 'editor' && !editorLoadedOnce) {
      loadEditor();
    }
  }, [mode, majorTab, editorLoadedOnce, loadEditor]);

  useEffect(() => {
    const usernames = collectEditorBandUsernames(editorLeads);

    editorLeadProfilesAbortRef.current?.abort();
    if (!usernames.length || !cookies) {
      setEditorPresenceLoading(false);
      return;
    }
    if (usernames.every(username => editorLeadProfiles[username])) {
      setEditorPresenceLoading(false);
      return;
    }

    const ac = new AbortController();
    editorLeadProfilesAbortRef.current = ac;
    setEditorPresenceLoading(true);

    void (async () => {
      try {
        const handles = usernames.map(username => `@${username}`);
        const [users, presence] = await Promise.all([
          fetchBandUsersByUsernames(proxyBase, cookies, usernames, ac.signal),
          fetchBandPresenceByHandles(proxyBase, cookies, handles, ac.signal).catch(() => ({} as Record<string, BandPresenceStatus>)),
        ]);
        if (ac.signal.aborted) return;

        setEditorLeadProfiles(prev => {
          const next = { ...prev };
          for (const user of users) {
            const key = editorBandProfileKey(user.handle);
            const status = presence[user.handle] || presence[editorBandProfileKey(user.handle)] || user.presence;
            if (key) next[key] = { ...user, presence: status };
          }
          return next;
        });
        setEditorPresence(prev => ({ ...prev, ...presence }));
      } catch {
        if (!ac.signal.aborted) setEditorStatus({ text: 'Не удалось обновить профили Band.', level: 'warn' });
      } finally {
        if (!ac.signal.aborted) setEditorPresenceLoading(false);
      }
    })();

    return () => ac.abort();
  }, [editorLeads, editorLeadProfiles, cookies, proxyBase]);

  useEffect(() => {
    const profiles = Object.values(editorLeadProfiles)
      .filter(profile => String(profile.id || '').trim())
      .filter((profile, idx, list) => list.findIndex(item => item.id === profile.id) === idx);
    const clearedAvatarIds: string[] = [];
    const pendingProfiles = profiles.filter(profile => {
      const requestKey = `${profile.id}:${Number(profile.avatarStamp || 0)}`;
      const cached = editorLeadAvatarCacheRef.current[profile.id];
      if (cached?.requestKey === requestKey) return false;
      if (cached?.url) URL.revokeObjectURL(cached.url);
      if (cached) clearedAvatarIds.push(profile.id);
      delete editorLeadAvatarCacheRef.current[profile.id];
      return true;
    });

    if (clearedAvatarIds.length) {
      setEditorLeadAvatarUrls(prev => {
        const next = { ...prev };
        clearedAvatarIds.forEach(id => {
          delete next[id];
        });
        return next;
      });
    }

    editorLeadAvatarAbortRef.current?.abort();
    if (!pendingProfiles.length || !cookies || !proxyBase) return;

    const ac = new AbortController();
    editorLeadAvatarAbortRef.current = ac;

    void (async () => {
      const nextUrls: Record<string, string> = {};
      await Promise.all(pendingProfiles.map(async profile => {
        try {
          const blob = await fetchBandUserAvatarBlob(proxyBase, cookies, profile.id, profile.avatarStamp, ac.signal);
          if (ac.signal.aborted || !blob) return;
          const url = URL.createObjectURL(blob);
          if (ac.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          const requestKey = `${profile.id}:${Number(profile.avatarStamp || 0)}`;
          editorLeadAvatarCacheRef.current[profile.id] = { requestKey, url };
          nextUrls[profile.id] = url;
        } catch {
          if (!ac.signal.aborted) {
            editorLeadAvatarCacheRef.current[profile.id] = {
              requestKey: `${profile.id}:${Number(profile.avatarStamp || 0)}`,
              url: '',
            };
          }
        }
      }));

      if (ac.signal.aborted || !Object.keys(nextUrls).length) return;
      setEditorLeadAvatarUrls(prev => ({ ...prev, ...nextUrls }));
    })();

    return () => ac.abort();
  }, [editorLeadProfiles, cookies, proxyBase]);

  useEffect(() => () => {
    editorLoadAbortRef.current?.abort();
    editorLeadProfilesAbortRef.current?.abort();
    editorLeadAvatarAbortRef.current?.abort();
    Object.values(editorLeadAvatarCacheRef.current).forEach(entry => {
      if (entry.url) URL.revokeObjectURL(entry.url);
    });
  }, []);

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
          await ensureMajorStreamsSheet(platform, rel, token, proxyBase, cookies, log, ac.signal, threadTxt);
          updatePlatformWorkflow('ios', iosStatusesRef.current.map((status, idx) => idx === 2 ? 'done' : status));
          updatePlatformWorkflow('android', andStatusesRef.current.map((status, idx) => idx === 2 ? 'done' : status));
          break;
        case 3: {
          log(`[${isIos ? 'iOS' : 'Android'}] Обновляю список стримов из Allure...`);
          const activePollText = await refreshMajorPollFromAllure(ac.signal);
          log(`[${isIos ? 'iOS' : 'Android'}] Список стримов обновлён.`, 'ok');
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
    settings.deployLabToken,
    settings.ytBase,
    settings.ytToken,
    token,
    log,
    ensureCollectionRowsForMajorStep,
    mapRowsToDutyStreams,
    refreshMajorPollFromAllure,
    updatePlatformWorkflow,
    syncMajorPlatform,
  ]);

  useEffect(() => { executeMajorStepRef.current = executeMajorStep; }, [executeMajorStep]);

  const refreshComponentsMessage = useCallback(async (
    platform: MajorPlatform,
    options?: { updateExisting?: boolean; source?: 'manual' | 'timer' },
  ) => {
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
    log(`[${isIos ? 'iOS' : 'Android'}] ${options?.source === 'timer' ? 'Автообновление компонентов по таймеру' : 'Обновление сообщения по компонентам'}...`);

    try {
      if (settings.deployLabToken) {
        await majorPublishComponentsFromDeployLab(platform, releaseValue, settings.deployLabToken, proxyBase, cookies, log, ac.signal, {
          updateExisting: Boolean(options?.updateExisting),
        });
      } else if (componentsValue) {
        await majorPublishComponents(platform, releaseValue, componentsValue, proxyBase, cookies, log, ac.signal, {
          updateExisting: Boolean(options?.updateExisting),
        });
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

  const componentTimerRefFor = useCallback((platform: MajorPlatform) =>
    platform === 'ios' ? iosCompTimerRef : andCompTimerRef, []);

  const getNextHourTwoMs = useCallback(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(now.getHours() + 1, 2, 0, 0);
    return next.getTime();
  }, []);

  const stopComponentsTimer = useCallback((platform: MajorPlatform, silent = false) => {
    const timerRef = componentTimerRefFor(platform);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateComponentTimerState(platform, { running: false, nextFireMs: 0 });
    if (!silent) log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Таймер автообновления компонентов остановлен.`, 'warn');
  }, [componentTimerRefFor, log, updateComponentTimerState]);

  const armComponentsTimer = useCallback((platform: MajorPlatform, nextMs: number) => {
    const timerRef = componentTimerRefFor(platform);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateComponentTimerState(platform, { running: true, nextFireMs: nextMs });
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      await refreshComponentsMessage(platform, { source: 'timer' });
      const lastHour = Number(componentTimersRef.current[platform].lastHour) || 0;
      const currentHour = new Date().getHours();
      if (lastHour > 0 && currentHour >= lastHour) {
        updateComponentTimerState(platform, { running: false, nextFireMs: 0 });
        log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Достигнут последний час (${lastHour}:02). Таймер остановлен.`, 'ok');
        return;
      }
      armComponentsTimer(platform, getNextHourTwoMs());
    }, Math.max(0, nextMs - Date.now()));
  }, [
    componentTimerRefFor,
    getNextHourTwoMs,
    log,
    refreshComponentsMessage,
    updateComponentTimerState,
  ]);

  const startComponentsTimer = useCallback((platform: MajorPlatform) => {
    const nextMs = getNextHourTwoMs();
    armComponentsTimer(platform, nextMs);
    log(`[${platform === 'ios' ? 'iOS' : 'Android'}] Таймер автообновления компонентов запущен на ${new Date(nextMs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`, 'ok');
  }, [armComponentsTimer, getNextHourTwoMs, log]);

  const startNonMajorLogPanelResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = nonMajorLogPanelSize.width;
    const startHeight = nonMajorLogPanelSize.height;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const maxWidth = Math.max(320, window.innerWidth - 36);
      const maxHeight = Math.max(220, window.innerHeight - 36);
      setNonMajorLogPanelSize({
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
  }, [nonMajorLogPanelSize.height, nonMajorLogPanelSize.width]);

  const startCollectionLogPanelResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = collectionLogPanelSize.width;
    const startHeight = collectionLogPanelSize.height;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const maxWidth = Math.max(320, window.innerWidth - 36);
      const maxHeight = Math.max(220, window.innerHeight - 36);
      setCollectionLogPanelSize({
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
  }, [collectionLogPanelSize.height, collectionLogPanelSize.width]);

  const startDutyPingLogPanelResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = dutyPingLogPanelSize.width;
    const startHeight = dutyPingLogPanelSize.height;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const maxWidth = Math.max(320, window.innerWidth - 36);
      const maxHeight = Math.max(220, window.innerHeight - 36);
      setDutyPingLogPanelSize({
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
  }, [dutyPingLogPanelSize.height, dutyPingLogPanelSize.width]);

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
    stopComponentsTimer('ios', true);
    stopComponentsTimer('android', true);
    updatePlatformWorkflow('ios', PUSH_IOS_STEPS.map(() => 'pending' as PushStatus));
    updatePlatformWorkflow('android', PUSH_AND_STEPS.map(() => 'pending' as PushStatus));
    resetCollectionWorkflow();
    log('Workflow major-релиза сброшен.', 'warn');
  }, [stopComponentsTimer, updatePlatformWorkflow, resetCollectionWorkflow, log]);

  const openNoticeModal = useCallback(async () => {
    setNoticeOpen(true);
    setNoticeError('');
    setNoticeStatusByChannel(Object.fromEntries(NOTICE_CHANNELS.map(channel => [channel.id, { state: 'idle' as NoticeChannelState, message: '' }])));
    setNoticeLoading(true);
    setNoticeText('Формирую текст оповещения...');
    try {
      const text = await fetchMajorReleaseNoticeText(
        iosRelease, andRelease, settings.deployLabToken || '', proxyBase,
      );
      setNoticeText(text);
    } catch (error) {
      setNoticeError(error instanceof Error ? error.message : String(error));
      setNoticeText('');
    } finally {
      setNoticeLoading(false);
    }
  }, [iosRelease, andRelease, settings.deployLabToken, proxyBase]);

  const publishNotice = useCallback(async () => {
    if (noticeRunning || !noticeText.trim()) return;
    const ac = new AbortController();
    setNoticeRunning(true);
    setNoticeError('');
    setNoticeStatusByChannel(Object.fromEntries(NOTICE_CHANNELS.map(channel => [channel.id, { state: 'idle' as NoticeChannelState, message: '' }])));
    try {
      await majorPublishReleaseNotice(
        noticeText,
        proxyBase,
        cookies,
        log,
        ac.signal,
        (channelId, state, message = '') => {
          setNoticeStatusByChannel(prev => ({ ...prev, [channelId]: { state, message } }));
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNoticeError(message);
      log(message, 'error');
    } finally {
      setNoticeRunning(false);
    }
  }, [noticeRunning, noticeText, proxyBase, cookies, log]);

  const sendDutyPing = useCallback(async (platform: MajorPlatform): Promise<boolean> => {
    const state = dutyPingStates[platform];
    if (state.running || !state.message.trim()) return false;
    const rel = platform === 'ios' ? iosRelease : andRelease;
    if (!rel.trim()) { dutyPingLog(platform, 'Укажи версию релиза для пинга.', 'warn'); return false; }
    if (!cookies.trim()) { dutyPingLog(platform, 'Нужны Band cookies.', 'warn'); return false; }
    const ac = new AbortController();
    dutyPingAbortRefs.current[platform] = ac;
    updateDutyPingState(platform, { running: true });
    try {
      await postDutyPingToThread(platform, rel, state.message, proxyBase, cookies, (msg, level) => dutyPingLog(platform, msg, level), ac.signal);
      return true;
    } catch (error) {
      dutyPingLog(platform, error instanceof Error ? error.message : String(error), 'error');
      return false;
    } finally {
      updateDutyPingState(platform, { running: false });
      dutyPingAbortRefs.current[platform] = null;
    }
  }, [dutyPingStates, iosRelease, andRelease, proxyBase, cookies, dutyPingLog, updateDutyPingState]);

  const startDutyPingPolling = useCallback(async (platform: MajorPlatform) => {
    const state = dutyPingStates[platform];
    if (state.polling) {
      dutyPingAbortRefs.current[platform]?.abort();
      updateDutyPingState(platform, { polling: false });
      return;
    }
    const rel = platform === 'ios' ? iosRelease : andRelease;
    if (!rel.trim()) { dutyPingLog(platform, 'Укажи версию релиза для мониторинга.', 'warn'); return; }
    if (!token) { dutyPingLog(platform, 'Нужен Allure токен.', 'warn'); return; }
    if (!cookies.trim()) { dutyPingLog(platform, 'Нужны Band cookies.', 'warn'); return; }
    const ac = new AbortController();
    dutyPingAbortRefs.current[platform] = ac;
    updateDutyPingState(platform, { polling: true, pollState: null });
    dutyPingLog(platform, 'Запуск мониторинга пинга...');
    try {
      const rows = collectionRowsRef.current.length ? collectionRowsRef.current : await ensureCollectionRowsForMajorStep(ac.signal);
      collectionRowsRef.current = rows;
      await runDutyPingPolling(
        platform, rel, token, proxyBase, cookies, rows,
        (state) => {
          updateDutyPingState(platform, {
            pollState: state,
            message: state.message || dutyPingStates[platform].message,
          });
        },
        (msg, level) => dutyPingLog(platform, msg, level),
        ac.signal,
      );
      dutyPingLog(platform, 'Мониторинг завершён.', 'ok');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        dutyPingLog(platform, 'Мониторинг остановлен.', 'warn');
      } else {
        dutyPingLog(platform, error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      updateDutyPingState(platform, { polling: false });
      dutyPingAbortRefs.current[platform] = null;
    }
  }, [
    dutyPingStates, iosRelease, andRelease, token, proxyBase, cookies,
    dutyPingLog, updateDutyPingState, ensureCollectionRowsForMajorStep,
  ]);

  const startDutyPing = useCallback(async (platform: MajorPlatform) => {
    const rel = platform === 'ios' ? iosRelease : andRelease;
    if (!rel.trim()) { dutyPingLog(platform, 'Укажи версию релиза для пинга.', 'warn'); return; }
    if (!token) { dutyPingLog(platform, 'Нужен Allure токен.', 'warn'); return; }
    if (!cookies.trim()) { dutyPingLog(platform, 'Нужны Band cookies.', 'warn'); return; }
    const state = dutyPingStates[platform];
    if (state.loading || state.running || state.polling) return;

    const ac = new AbortController();
    let resumeExisting = false;
    dutyPingAbortRefs.current[platform] = ac;
    updateDutyPingState(platform, { loading: true, pollState: null });
    try {
      const rows = collectionRowsRef.current.length ? collectionRowsRef.current : await ensureCollectionRowsForMajorStep(ac.signal);
      collectionRowsRef.current = rows;
      dutyPingLog(platform, 'Проверяю существующий пинг в треде...');
      const existingMessage = await findExistingDutyPingMessage(platform, rel, proxyBase, cookies, ac.signal);
      if (existingMessage.trim()) {
        updateDutyPingState(platform, { streams: [], message: existingMessage });
        dutyPingLog(platform, 'Найден существующий пинг, запускаю мониторинг.', 'ok');
        resumeExisting = true;
        return;
      }

      dutyPingLog(platform, 'Загружаю незакрытые стримы из Allure...');
      const streams = await fetchDutyPingPendingStreams(platform, rel, token, proxyBase, ac.signal);
      const msg = buildDutyPingMessage(platform, streams, rows);
      updateDutyPingState(platform, {
        streams,
        message: msg,
        pollState: streams.length ? null : { message: '', pendingCount: 0, verifiedCount: 0, done: true },
      });
      dutyPingLog(platform, `Найдено незакрытых стримов: ${streams.length}.`, streams.length ? 'warn' : 'ok');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        dutyPingLog(platform, 'Подготовка остановлена.', 'warn');
      } else {
        dutyPingLog(platform, error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      updateDutyPingState(platform, { loading: false });
      dutyPingAbortRefs.current[platform] = null;
      if (resumeExisting) void startDutyPingPolling(platform);
    }
  }, [
    iosRelease, andRelease, token, cookies, proxyBase, dutyPingStates,
    dutyPingLog, updateDutyPingState, ensureCollectionRowsForMajorStep, startDutyPingPolling,
  ]);

  const publishDutyPingAndStartMonitor = useCallback(async (platform: MajorPlatform) => {
    const posted = await sendDutyPing(platform);
    if (posted && !dutyPingStates[platform].polling) {
      await startDutyPingPolling(platform);
    }
  }, [sendDutyPing, startDutyPingPolling, dutyPingStates]);

  const stopDutyPing = useCallback((platform: MajorPlatform) => {
    dutyPingAbortRefs.current[platform]?.abort();
    updateDutyPingState(platform, emptyDutyPingState());
  }, [updateDutyPingState]);

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
      sunday_devices: [
        { id: 'create_run', label: 'Создание ранов устройств', status: 'pending' },
        { id: 'notify_swat', label: 'Уведомление SWAT', status: 'pending' },
      ],
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

  const resolveBuildValueForMode = useCallback(async (
    targetMode: RunMode,
    targetRelease: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    const rel = String(targetRelease || '').trim();
    if (!isNonMajorBuildMode(targetMode)) return '';
    if (!rel) throw new Error('Укажи номер релиза.');

    if (!cookies) {
      if (targetMode === 'hf_android') {
        log('Сборка: Cookies для чтения не заданы, продолжаю без pipeline.', 'warn');
        return '';
      }
      throw new Error('Заполни Band cookies для запроса сборки.');
    }

    if (targetMode === 'hf_ios') {
      return resolveIosBuildFromBand(rel, proxyBase, cookies, log, signal);
    }
    return resolveAndroidBuildFromBot(targetMode, rel, proxyBase, cookies, log, signal);
  }, [cookies, log, proxyBase]);

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
      let resolvedBuildValue = buildValue;
      let runResult: { runs: LaunchRecord[]; message: string } | null = null;
      if (runStep) {
        stepLog('create_run', 'running');
        log(`${runStep.label}...`);
        try {
          if (isNonMajorBuildMode(mode)) {
            setBuildResolving(true);
            resolvedBuildValue = await resolveBuildValueForMode(mode, release, ac.signal);
            setBuildValue(resolvedBuildValue);
          }
          runResult = await runCreatorScenario(mode, release, settings, log, ac.signal, resolvedBuildValue);
          setCreatedRuns(runResult.runs);
          setNonMajorCopyMessage(runResult.message);
          const detail = runResult.runs.length ? runResult.runs.map(run => `#${run.id}`).join(', ') : 'Завершено';
          stepLog('create_run', 'done', detail);
          log(`✓ ${detail}`, 'ok');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stepLog('create_run', 'error', message.slice(0, 80));
          log(`✗ ${message}`, 'error');
          return;
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
      setBuildResolving(false);
      setRunning(false);
      abortRef.current = null;
    }
  }, [mode, running, proxyBase, settings, release, log, buildValue, resolveBuildValueForMode]);

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
        if (Date.now() < Number(plan.targetMs)) {
          armStepSchedule(plan);
          return;
        }
        const busy = majorWorkflowBusyRef.current;
        if (
          busy.running ||
          busy.collectionRunning ||
          busy.automationRunning ||
          (plan.platform === 'ios' ? (busy.iosRunning || busy.iosSyncing) : (busy.andRunning || busy.andSyncing))
        ) {
          const nextPlan = { ...plan, targetMs: Date.now() + 30 * 1000, note: 'интерфейс занят' };
          armStepSchedule(nextPlan);
          log(`⏰ ${plan.platform === 'ios' ? 'iOS' : 'Android'} шаг ${plan.stepIdx + 1} перенесён: интерфейс занят`, 'warn');
          return;
        }
        try {
          await syncMajorPlatformRef.current?.(plan.platform, {
            silent: true,
            preserveLocal: true,
            applyThreadText: true,
          });
        } catch {}
	      const statuses = plan.platform === 'ios' ? iosStatusesRef.current : andStatusesRef.current;
	      const currentStatus = statuses[plan.stepIdx] ?? 'pending';
	      const hasBusyStep = statuses.some(status => status === 'running');
	      const waitsPrevious = statuses
	        .slice(0, plan.stepIdx)
	        .some(status => status !== 'done' && status !== 'skipped');
        const waitsCurrent = plan.stepIdx !== firstPendingIndex(statuses);
	      if (hasBusyStep || waitsPrevious || waitsCurrent) {
	        const note = hasBusyStep ? 'интерфейс занят' : 'ждёт предыдущие шаги';
	        const nextPlan = { ...plan, targetMs: Date.now() + 30 * 1000, note };
	        armStepSchedule(nextPlan);
	        log(`⏰ ${plan.platform === 'ios' ? 'iOS' : 'Android'} шаг ${plan.stepIdx + 1} перенесён: ${note}`, 'warn');
	        return;
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
	      if (currentStatus !== 'pending' && currentStatus !== 'error') {
	        log(`⏰ ${plan.platform === 'ios' ? 'iOS' : 'Android'} шаг ${plan.stepIdx + 1} уже не ожидает выполнения, расписание снято.`, 'info');
	        return;
	      }
        if (!executeMajorStepRef.current) {
          armStepSchedule({ ...plan, targetMs: Date.now() + 30 * 1000, note: 'интерфейс занят' });
          return;
        }
	      try {
          await executeMajorStepRef.current(plan.platform, plan.stepIdx);
          const nextStatuses = plan.platform === 'ios' ? iosStatusesRef.current : andStatusesRef.current;
          if (nextStatuses[plan.stepIdx] === 'error') {
            armStepSchedule({ ...plan, targetMs: Date.now() + 60 * 1000, note: 'ошибка выполнения' });
          }
        } catch {
          armStepSchedule({ ...plan, targetMs: Date.now() + 60 * 1000, note: 'ошибка выполнения' });
        }
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
    armStepSchedule({
      key,
      scope: 'push',
      platform,
      stepIdx,
      targetMs,
      triggerMode,
      delayMinutes: triggerMode === 'delay' ? delayMin : null,
      note: '',
      createdAt: Date.now(),
    });
    log(`⏰ ${platform === 'ios' ? 'iOS' : 'Android'} шаг ${stepIdx + 1} — запланирован через ${schedCountdown(targetMs)}`, 'ok');
  }, [armStepSchedule, log]);

  // ─── AUTOMATION CALLBACKS ────────────────────────────────────
  const executeMajorCollectionAutomation = useCallback(async () => {
    if (collectionRunning) throw new Error('Сбор дежурных уже выполняется.');
    if (!cookies) throw new Error('Band cookies не заданы — укажи в Настройках.');

    updateMajorTab('collection');
    setCollectionLogs([]);
    setCollectionRunning(true);
    const ac = new AbortController();
    collectionAbortRef.current = ac;

    let rows: CollectionRow[] = [];
    let sinceMs: number | null = null;
    let currentPingText = '';
    let currentMessages: string[] = [];
    let idMaps: CollectionIdMaps = { ios: {}, android: {} };
    let statuses: PushStatus[] = COLLECTION_WORKFLOW_STEPS.map(() => 'pending');

    const setLocalStatuses = (nextStatuses: PushStatus[], currentIdx = firstPendingIndex(nextStatuses)) => {
      statuses = nextStatuses;
      setCollectionWorkflowStatuses(nextStatuses);
      setCollectionWorkflowCurrentIdx(currentIdx);
    };

    try {
      collLog('Автозапуск: начинаю сбор дежурных.');
      const result = await runCollection(proxyBase, cookies, token, gasUrl, collLog, ac.signal);
      rows = Array.isArray(result.rows) ? result.rows : [];
      sinceMs = Number.isFinite(result.sinceMs) ? result.sinceMs : null;
      currentPingText = result.pingText || '';
      currentMessages = Array.isArray(result.messages) ? result.messages : [];
      applyCollectionResult(result);
      setLocalStatuses(buildCollectionWorkflowStatuses(rows, result.pingText || '', Boolean(result.pingFound)));

      for (let idx = 0; idx < COLLECTION_WORKFLOW_STEPS.length; idx += 1) {
        const step = COLLECTION_WORKFLOW_STEPS[idx];
        if (!step) continue;

        if (statuses[idx] === 'done') {
          collLog(`[${step.code}] Уже выполнено.`, 'ok');
          continue;
        }
        if (statuses[idx] === 'skipped') {
          collLog(`[${step.code}] Действие не требуется.`, 'ok');
          continue;
        }

        setLocalStatuses(statuses.map((status, currentIdx) =>
          currentIdx === idx ? 'running' : status,
        ), idx);

        try {
          let statusesAfterStep: PushStatus[] | null = null;
          switch (step.action) {
            case 'publishPing': {
              const statusesSeed = statuses.map((status, currentIdx) =>
                currentIdx === idx ? 'done' : status,
              );
              if (!String(currentPingText || '').trim()) {
                collLog('[Шаг 1] Публикация запроса не требуется: все дежурные найдены.', 'ok');
              } else if (hasCollectionPingMessage(currentMessages)) {
                setCollectionPingFound(true);
                collLog('[Шаг 1] Запрос дежурных уже найден в чате, повторная публикация не нужна.', 'ok');
              } else {
                await publishCollectionPing(proxyBase, cookies, rows, ac.signal);
                setCollectionPingFound(true);
                collLog('Пинг опубликован в чат SWAT QA.', 'ok');
                await waitForBandReadConsistency(350, ac.signal);
              }
              if (sinceMs) {
                const refreshed = await refreshCollectionSince(proxyBase, cookies, gasUrl, token, sinceMs, collLog, ac.signal);
                rows = Array.isArray(refreshed.rows) ? refreshed.rows : [];
                sinceMs = Number.isFinite(refreshed.sinceMs) ? refreshed.sinceMs : sinceMs;
                currentPingText = refreshed.pingText || '';
                currentMessages = Array.isArray(refreshed.messages) ? refreshed.messages : [];
                idMaps = { ios: {}, android: {} };
                setCollectionIdMaps(idMaps);
                applyCollectionResult(refreshed, true, statusesSeed);
                statusesAfterStep = buildCollectionWorkflowStatuses(rows, refreshed.pingText || '', Boolean(refreshed.pingFound))
                  .map((status, statusIdx) => {
                    if (statusIdx < 2 && (statusesSeed[statusIdx] === 'done' || statusesSeed[statusIdx] === 'skipped')) return statusesSeed[statusIdx];
                    if (statusIdx >= 2) return 'pending';
                    return status;
                  });
              }
              break;
            }
            case 'publishMissing': {
              await publishMissingDutyPosts(proxyBase, cookies, rows, collLog, ac.signal);
              collLog('Недостающие дежурные опубликованы.', 'ok');
              if (sinceMs) {
                const statusesSeed = statuses.map((status, currentIdx) =>
                  currentIdx === idx ? 'done' : status,
                );
                await waitForBandReadConsistency(350, ac.signal);
                const refreshed = await refreshCollectionSince(proxyBase, cookies, gasUrl, token, sinceMs, collLog, ac.signal);
                rows = Array.isArray(refreshed.rows) ? refreshed.rows : [];
                sinceMs = Number.isFinite(refreshed.sinceMs) ? refreshed.sinceMs : sinceMs;
                currentPingText = refreshed.pingText || '';
                currentMessages = Array.isArray(refreshed.messages) ? refreshed.messages : [];
                idMaps = { ios: {}, android: {} };
                setCollectionIdMaps(idMaps);
                applyCollectionResult(refreshed, true, statusesSeed);
                statusesAfterStep = buildCollectionWorkflowStatuses(rows, refreshed.pingText || '', Boolean(refreshed.pingFound))
                  .map((status, statusIdx) => {
                    if (statusIdx < 2 && (statusesSeed[statusIdx] === 'done' || statusesSeed[statusIdx] === 'skipped')) return statusesSeed[statusIdx];
                    if (statusIdx >= 2) return 'pending';
                    return status;
                  });
              }
              break;
            }
            case 'findIds': {
              idMaps = await findCollectionUserIds(proxyBase, cookies, rows, ac.signal);
              setCollectionIdMaps(idMaps);
              collLog(`user_id: iOS ${Object.keys(idMaps.ios).length}, Android ${Object.keys(idMaps.android).length}.`, 'ok');
              break;
            }
            case 'clearGroups': {
              await clearBandDutyGroups(proxyBase, cookies, adminCookies, collLog, ac.signal);
              break;
            }
            case 'addGroups': {
              if (!Object.keys(idMaps.ios).length && !Object.keys(idMaps.android).length) {
                idMaps = await findCollectionUserIds(proxyBase, cookies, rows, ac.signal);
                setCollectionIdMaps(idMaps);
                collLog(`user_id подготовлены автоматически: iOS ${Object.keys(idMaps.ios).length}, Android ${Object.keys(idMaps.android).length}.`, 'ok');
              }
              await addBandDutyGroups(proxyBase, cookies, adminCookies, idMaps, collLog, ac.signal);
              break;
            }
          }

          setLocalStatuses(statusesAfterStep || statuses.map((status, currentIdx) =>
            currentIdx === idx ? 'done' : status,
          ));
          collLog(`[${step.code}] Выполнено.`, 'ok');
        } catch (error) {
          setLocalStatuses(statuses.map((status, currentIdx) =>
            currentIdx === idx ? 'error' : status,
          ), idx);
          throw error;
        }
      }

      collLog('Автосценарий сбора дежурных завершён.', 'ok');
    } finally {
      setCollectionRunning(false);
      collectionAbortRef.current = null;
    }
  }, [
    collectionRunning,
    cookies,
    proxyBase,
    token,
    gasUrl,
    collLog,
    applyCollectionResult,
    adminCookies,
    updateMajorTab,
  ]);

  const executeAutomation = useCallback(async (plan: AutomationPlan) => {
    const { mode: m, release: rel } = plan.snapshot;
    if (running || collectionRunning || iosRunning || andRunning) {
      const postponedPlan = { ...plan, targetMs: Date.now() + 60 * 1000 };
      log('Автозапуск: интерфейс занят, переношу на 1 минуту.', 'warn');
      armAutomationPlanRef.current?.(postponedPlan);
      return;
    }

    setAutomationRunning(true);
    log(`Автозапуск: ${RUN_MODE_LABELS[m]} ${rel}...`);
    try {
      if (m === 'major') {
        setMode('major');
        if (rel) updateMajorSharedRelease(rel);
        await executeMajorCollectionAutomation();
        log('✓ Автозапуск мажора завершён', 'ok');
        return;
      }

      log('Автозапуск для второстепенных запусков отключён.', 'warn');
      return;
    } catch (e) {
      log(`✗ Автозапуск: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setAutomationRunning(false);
    }
  }, [
    running,
    collectionRunning,
    iosRunning,
    andRunning,
    log,
    updateMajorSharedRelease,
    executeMajorCollectionAutomation,
    settings,
    cookies,
    proxyBase,
  ]);

  useEffect(() => { executeAutomationRef.current = executeAutomation; }, [executeAutomation]);

  const armAutomationPlan = useCallback((plan: AutomationPlan) => {
    if (automationTimerRef.current) { clearTimeout(automationTimerRef.current); automationTimerRef.current = null; }
    if (automTickerRef.current) { clearInterval(automTickerRef.current); automTickerRef.current = null; }
    if (plan.snapshot.mode !== 'major') {
      setAutomationPlan(null);
      saveAutomationPlan(null);
      return;
    }
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

  useEffect(() => { armAutomationPlanRef.current = armAutomationPlan; }, [armAutomationPlan]);

  const cancelAutomation = useCallback(() => {
    if (automationTimerRef.current) { clearTimeout(automationTimerRef.current); automationTimerRef.current = null; }
    if (automTickerRef.current) { clearInterval(automTickerRef.current); automTickerRef.current = null; }
    setAutomationPlan(null);
    saveAutomationPlan(null);
  }, []);

  const scheduleAutomation = useCallback((
    triggerMode: 'delay' | 'schedule', delayMin: number, date: string, time: string,
  ) => {
    if (mode !== 'major') {
      log('Автозапуск для второстепенных запусков отключён.', 'warn');
      return;
    }
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
      snapshot: { mode, release: mode === 'major' ? majorSharedRelease : release, buildValue, swatLead },
    });
    log(`⏰ Автозапуск запланирован через ${schedCountdown(targetMs)}`, 'ok');
  }, [armAutomationPlan, log, mode, majorSharedRelease, release, buildValue, swatLead]);

  // Restore schedules and automation from localStorage on mount
  useEffect(() => {
    const stored = loadStepSchedules();
    for (const plan of Object.values(stored)) { armStepSchedule(plan); }
    const ap = loadAutomationPlan();
    if (ap) armAutomationPlan(ap);
    return () => {
      Object.values(stepTimersRef.current).forEach(t => clearTimeout(t));
      dutyPingAbortRefs.current.ios?.abort();
      dutyPingAbortRefs.current.android?.abort();
      if (iosCompTimerRef.current) window.clearTimeout(iosCompTimerRef.current);
      if (andCompTimerRef.current) window.clearTimeout(andCompTimerRef.current);
      if (componentTimerTickerRef.current) clearInterval(componentTimerTickerRef.current);
      if (scheduleTickerRef.current) clearInterval(scheduleTickerRef.current);
      if (automationTimerRef.current) clearTimeout(automationTimerRef.current);
      if (automTickerRef.current) clearInterval(automTickerRef.current);
      Object.values(editorLeadSearchTimersRef.current).forEach(timer => clearTimeout(timer));
      Object.values(editorLeadSearchAbortRefs.current).forEach(ac => ac.abort());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publishSwatPost = useCallback(async (scheduledAtMs?: number) => {
    if (!cookies) { log('✗ Band cookies не заданы — укажи в Настройках', 'error'); return; }
    if (!nonMajorCopyMessage) { log('✗ Сначала запусти раны (нет copy message)', 'error'); return; }
    const scheduledLabel = Number.isFinite(scheduledAtMs) ? formatMskDateTimeShort(Number(scheduledAtMs)) : '';

    setSteps(prev => prev.map(step =>
      step.id === 'notify_swat'
        ? { ...step, status: 'running', detail: scheduledLabel ? `Запланировано на ${scheduledLabel}` : 'Отправка...' }
        : step,
    ));
    log(`SWAT Team Only${scheduledLabel ? ` в ${scheduledLabel}` : ''}...`);

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
      if (Number.isFinite(scheduledAtMs)) {
        await bandScheduleMessage(proxyBase, cookies, message, Number(scheduledAtMs), { channelId: SWAT_CHANNEL_ID });
        setSteps(prev => prev.map(step => step.id === 'notify_swat' ? { ...step, status: 'done', detail: `Запланировано на ${scheduledLabel}` } : step));
        log(`✓ SWAT Team Only — запланировано на ${scheduledLabel}`, 'ok');
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

	  const leadTag = swatLead === 'viktor' ? '@dolgov.viktor7' : swatLead === 'roman' ? '@kolosov.roman' : '';

	  useEffect(() => {
	    if (mode !== 'napi' || !nonMajorCopyMessage || !cookies) {
	      setNapiHostsPreviewText('');
	      return;
	    }
	    const ac = new AbortController();
	    fetchNapiHostsText(proxyBase, cookies, ac.signal)
	      .then(text => setNapiHostsPreviewText(text))
	      .catch(() => setNapiHostsPreviewText(''));
	    return () => ac.abort();
	  }, [mode, nonMajorCopyMessage, proxyBase, cookies]);

	  const swatPreviewText = useMemo(
	    () => nonMajorCopyMessage ? buildNonMajorSwatText(nonMajorCopyMessage, leadTag, mode === 'napi' ? napiHostsPreviewText : undefined) : '',
	    [nonMajorCopyMessage, leadTag, mode, napiHostsPreviewText],
	  );

  const feedPreviewItems = useMemo(() => {
    if (!createdRuns.length || !release.trim()) return [];
    try {
      return buildNonMajorFeedPreviewItems(
        mode,
        release,
        createdRuns,
        buildValue,
        nonMajorYtData?.boardUrl ?? '',
        nonMajorYtData?.ticketKey ?? '',
        nonMajorYtData?.ticketUrl ?? '',
      );
    } catch {
      return [];
    }
  }, [mode, release, createdRuns, buildValue, nonMajorYtData]);

  const noticeStatusMeta = (state: NoticeChannelState) => {
    switch (state) {
      case 'loading':
        return { color: 'yellow' as const, label: 'Публикуется', dot: true };
      case 'success':
        return { color: 'green' as const, label: 'Готово', dot: false };
      case 'error':
        return { color: 'red' as const, label: 'Ошибка', dot: false };
      default:
        return { color: 'gray' as const, label: 'Ожидает', dot: false };
    }
  };

  const renderComponentTimerControls = (platform: MajorPlatform) => {
    const label = platform === 'ios' ? 'iOS' : 'Android';
    const timer = componentTimers[platform];
    const statuses = platform === 'ios' ? iosStatuses : andStatuses;
    const enabled = statuses[5] === 'done';
    const countdown = timer.nextFireMs ? schedCountdown(timer.nextFireMs + componentTimerTick * 0) : '';
    return (
      <div key={platform} style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: timer.running ? 'rgba(155,92,255,.06)' : 'var(--surface-soft)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
          <Badge color={timer.running ? 'yellow' : 'gray'}>
            {timer.running && countdown ? `Следующее через ${countdown}` : 'Остановлен'}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" disabled={!enabled || timer.running} onClick={() => startComponentsTimer(platform)}>
            Старт таймера
          </Button>
          <Button variant="ghost" size="sm" disabled={!timer.running} onClick={() => stopComponentsTimer(platform)}>
            Стоп
          </Button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-3)' }}>
            Последний час
            <select
              value={timer.lastHour}
              onChange={event => updateComponentTimerState(platform, { lastHour: Number(event.target.value) || 0 })}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '5px 7px',
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
            >
              <option value={0}>не ограничивать</option>
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:02</option>
              ))}
            </select>
          </label>
        </div>
        {!enabled && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Доступно после шага «Опубликовать компоненты».</div>}
      </div>
    );
  };

  const renderDutyPingCard = (platform: MajorPlatform) => {
    const label = platform === 'ios' ? 'iOS' : 'Android';
    const state = dutyPingStates[platform];
    const busy = state.loading || state.running || state.polling;
    const ready = !busy && Boolean(state.message.trim());
    const idle = !busy && !state.message.trim();
    const startDisabled = !majorSharedRelease.trim();
    const statusText = state.loading
      ? 'Подготовка...'
      : state.running
        ? 'Публикация...'
        : state.polling
          ? 'Мониторинг активен, сообщение обновляется каждые 5 секунд.'
          : state.pollState?.done && !state.message.trim()
            ? 'В pending нет активных стримов'
          : ready
            ? 'Готово к публикации'
            : 'Ожидает запуска';
    return (
      <Card key={platform}>
        <CardHeader>
          <div>
            <CardTitle>{label}</CardTitle>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              {statusText}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {idle && (
              <Button
                variant="secondary"
                size="sm"
                style={{
                  background: 'linear-gradient(135deg,#2563EB,#0EA5E9)',
                  color: '#fff',
                  boxShadow: '0 4px 14px rgba(37,99,235,.28)',
                  border: '1px solid rgba(37,99,235,.35)',
                  opacity: startDisabled ? .55 : 1,
                }}
                disabled={startDisabled}
                title={startDisabled ? 'Укажи номер релиза' : undefined}
                onClick={() => void startDutyPing(platform)}
              >
                Старт пинга
              </Button>
            )}
            {ready && (
              <Button
                variant="primary"
                size="sm"
                disabled={!cookies}
                onClick={() => void publishDutyPingAndStartMonitor(platform)}
              >
                Опубликовать
              </Button>
            )}
            {!idle && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => stopDutyPing(platform)}
              >
                Стоп пинга
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(state.pollState || state.streams.length > 0) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {state.polling && <Badge color="yellow">В работе</Badge>}
              {state.pollState ? (
                <>
                  <Badge color="yellow">Pending: {state.pollState.pendingCount}</Badge>
                  <Badge color="green">OK: {state.pollState.verifiedCount}</Badge>
                  {state.pollState.done && <Badge color="green">Все закрыты</Badge>}
                </>
              ) : (
                <Badge color="yellow">Незакрыто: {state.streams.length}</Badge>
              )}
            </div>
          )}
          <div>
            <FieldLabel>Сообщение в тред</FieldLabel>
            <Textarea
              value={state.message}
              onChange={event => updateDutyPingState(platform, { message: event.target.value })}
              rows={10}
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              readOnly={state.polling}
              placeholder={`Коллеги, просьба написать сроки проставления оков по платформе ${label}\n\nСтрим @handle`}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="sm" disabled={!state.message.trim()} onClick={() => navigator.clipboard.writeText(state.message)}>
              Скопировать
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  };
  const dutyPingLogActive = dutyPingStates.android.loading || dutyPingStates.android.running || dutyPingStates.android.polling
    || dutyPingStates.ios.loading || dutyPingStates.ios.running || dutyPingStates.ios.polling;
  const nonMajorBuildMode = isNonMajorBuildMode(mode);
  const nonMajorSwatLeadMode = mode === 'hf_android' || mode === 'hf_ios' || mode === 'napi' || mode === 'rustore_critical' || mode === 'rustore_smoke';
  const nonMajorHasSwatAction = steps.some(step => step.id === 'notify_swat');
  const nonMajorHasFeedAction = steps.some(step => step.id === 'feed_post');
  const nonMajorLogActive = running || automationRunning || buildResolving;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <CardHeader><CardTitle>Тип запуска</CardTitle></CardHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, padding: '14px 16px' }}>
          {MODES.map(item => (
            <button
              type="button"
              key={item.id}
              onClick={() => setMode(item.id)}
              style={{
                border: `1px solid ${mode === item.id ? 'rgba(155,92,255,.4)' : 'var(--border)'}`,
                borderRadius: 14,
                padding: '12px 14px',
                cursor: 'pointer',
                background: mode === item.id ? 'rgba(155,92,255,.08)' : 'transparent',
                transition: 'all .12s',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6, minHeight: 22, display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>{item.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{RUN_MODE_LABELS[item.id]}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {mode === 'major' && (
        <>
	          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
	            {!settings.allureToken && <Badge color="red">Нужен Allure токен</Badge>}
	            {!settings.bandCookies && <Badge color="red">Нужны Band cookies</Badge>}
	            {!settings.bandCookiesAdmin && <Badge color="yellow">Нет admin cookies для групп</Badge>}
	          </div>

          {noticeOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="majorReleaseNoticeModalTitle"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 5000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: 'rgba(15,23,42,.36)',
                backdropFilter: 'blur(3px)',
              }}
              onMouseDown={() => setNoticeOpen(false)}
            >
              <div
                style={{
                  width: 'min(760px, calc(100vw - 32px))',
                  maxHeight: 'calc(100vh - 32px)',
                  overflow: 'auto',
                  borderRadius: 20,
                  background: '#fff',
                  boxShadow: '0 24px 64px rgba(15,23,42,.28)',
                  border: '1px solid rgba(226,232,240,.95)',
                }}
                onMouseDown={event => event.stopPropagation()}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '24px 24px 8px' }}>
                  <div id="majorReleaseNoticeModalTitle" style={{ fontSize: 24, lineHeight: 1.12, fontWeight: 800, color: '#3f3f53' }}>
                    Опубликовать оповещение
                  </div>
                  <button
                    type="button"
                    aria-label="Закрыть окно оповещения"
                    onClick={() => setNoticeOpen(false)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#8b90a0',
                      fontSize: 34,
                      lineHeight: 1,
                      padding: 0,
                      width: 40,
                      height: 40,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 14, padding: '10px 24px 24px' }}>
                  {noticeError && (
                    <div style={{ padding: '10px 12px', borderRadius: 12, background: '#fff1f2', border: '1px solid #fecdd3', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
                      {noticeError}
                    </div>
                  )}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#6b7280' }}>Текст</span>
                    <textarea
                      value={noticeText}
                      onChange={event => setNoticeText(event.target.value)}
                      rows={7}
                      spellCheck={false}
                      readOnly={noticeLoading}
                      style={{
                        width: '100%',
                        minHeight: 176,
                        resize: 'vertical',
                        borderRadius: 12,
                        border: '1px solid #ecebff',
                        background: '#fff',
                        color: '#111827',
                        padding: '10px 14px',
                        fontFamily: 'var(--mono)',
                        fontSize: 13,
                        lineHeight: 1.45,
                        outline: 'none',
                      }}
                    />
                  </label>
                  <div style={{ border: '1px solid #ecebff', borderRadius: 16, background: '#fbfcff', padding: '14px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', marginBottom: 10 }}>Каналы</div>
                    <div style={{ display: 'grid', gap: 0 }}>
                      {NOTICE_CHANNELS.map((channel, idx) => {
                        const status = noticeStatusByChannel[channel.id] ?? { state: 'idle' as NoticeChannelState, message: '' };
                        return (
                          <div
                            key={channel.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 16,
                              padding: '10px 0',
                              borderTop: idx === 0 ? 'none' : '1px solid #ecebff',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>{channel.name}</div>
                              <div style={{ marginTop: 2, fontSize: 11, color: '#94a3b8' }}>({channel.id})</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 128 }}>
                              {status.state === 'loading' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, fontSize: 12, fontWeight: 700, color: '#475569' }}>
                                  <span style={{ width: 14, height: 14, borderRadius: 999, border: '2px solid #cbd5e1', borderTopColor: '#475569', animation: 'spin .8s linear infinite' }} />
                                  <span>Отправляю...</span>
                                </span>
                              ) : status.state === 'success' ? (
                                <span title="Отправлено" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 999, border: '1px solid #bbf7d0', background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 800, lineHeight: 1 }}>
                                  ✓
                                </span>
                              ) : status.state === 'error' ? (
                                <span title={status.message || 'Ошибка отправки'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, fontSize: 12, fontWeight: 700, color: '#b91c1c', textAlign: 'right' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 999, border: '1px solid #fecdd3', background: '#ffe4e6', color: '#b91c1c', fontSize: 12, fontWeight: 800, lineHeight: 1 }}>
                                    ✕
                                  </span>
                                  <span>{status.message || 'Ошибка'}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textAlign: 'right' }}>Не отправлено</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                    <button
                      type="button"
                      onClick={() => setNoticeOpen(false)}
                      style={{
                        minWidth: 140,
                        minHeight: 48,
                        borderRadius: 12,
                        border: '1px solid transparent',
                        color: '#fff',
                        background: 'linear-gradient(90deg,#ef4444,#dc2626)',
                        fontFamily: 'inherit',
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={noticeRunning || noticeLoading || !noticeText.trim()}
                      onClick={() => void publishNotice()}
                      style={{
                        minWidth: 180,
                        minHeight: 48,
                        borderRadius: 12,
                        border: '1px solid transparent',
                        color: '#fff',
                        background: noticeRunning || noticeLoading || !noticeText.trim()
                          ? '#cbd5e1'
                          : 'linear-gradient(90deg,#9b5cff,#ff5ac8)',
                        boxShadow: noticeRunning || noticeLoading || !noticeText.trim()
                          ? 'none'
                          : '0 10px 30px rgba(155,92,255,.25)',
                        fontFamily: 'inherit',
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: noticeRunning || noticeLoading || !noticeText.trim() ? 'not-allowed' : 'pointer',
                        textShadow: noticeRunning || noticeLoading || !noticeText.trim() ? 'none' : '0 1px 2px rgba(31,41,55,.35)',
                      }}
                    >
                      {noticeRunning ? 'Публикую...' : 'Опубликовать'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', borderRadius: '12px 12px 0 0', padding: '0 16px' }}>
	            {([
	              { id: 'collection' as const, label: collectionRows.length ? `Сбор дежурных ${collectionStats.filled}/${collectionStats.total}` : 'Сбор дежурных' },
	              { id: 'ping' as const, label: 'Пинг дежурных' },
	              { id: 'release' as const, label: 'Релиз' },
	              { id: 'editor' as const, label: 'Редактор' },
	            ]).map(item => (
              <button
                key={item.id}
                onClick={() => updateMajorTab(item.id)}
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
              <Card style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 34px rgba(15,23,42,.06)' }}>
                <CardHeader style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', padding: '18px 20px 0' }}>
                  <div style={{ minWidth: 260 }}>
                    <CardTitle>Результат сбора</CardTitle>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                      {sinceLabel && (
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          Сканируются сообщения с {sinceLabel}
                        </span>
                      )}
                      {sinceLabel && <span style={{ width: 1, height: 16, background: 'var(--border)' }} />}
                      <Badge color="purple" style={{ padding: '4px 12px', fontSize: 12, fontWeight: 800 }}>
                        Стримов: {collectionStats.total}
                      </Badge>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <CopyFeedbackButton
                      state={collectionCopyStates.list}
                      disabled={!collectionRows.length || collectionRunning}
                      onClick={() => void runCollectionCopyAction('list')}
                    >
                      <CopyListIcon /> Копировать список
                    </CopyFeedbackButton>
                    <CopyFeedbackButton
                      state={collectionCopyStates.threads}
                      successIcon="✓✓"
                      disabled={!collectionRows.length || collectionRunning}
                      onClick={() => void runCollectionCopyAction('threads')}
                    >
                      <ThreadsIcon /> Копировать треды
                    </CopyFeedbackButton>
                    <Button variant="ghost" size="sm" disabled={!collectionRows.length} onClick={() => setResultsCollapsed(prev => !prev)}>
                      <EyeOffIcon />
                      {resultsCollapsed ? 'Показать' : 'Скрыть'}
                    </Button>
                    <LaunchRunButton running={collectionRunning} onClick={startCollection} />
                  </div>
                </CardHeader>
                <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 20px 16px' }}>
                  {!resultsCollapsed && (
                    <>
                      {collectionDisplayRows.length ? (
                        <Table
                          style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}
                          tableStyle={{ borderCollapse: 'separate', borderSpacing: 0 }}
                        >
                          <thead>
                            <tr>
                              <Th style={{ width: 70, padding: '12px 18px' }}>#</Th>
                              <Th style={{ width: '22%', padding: '12px 18px' }}>Стрим</Th>
                              <Th style={{ width: '36%', padding: '12px 18px' }}>Дежурный</Th>
                              <Th style={{ width: '24%', padding: '12px 18px' }}>Лид</Th>
                              <Th style={{ width: 120, padding: '12px 18px', textAlign: 'center' }}>Статус</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {collectionDisplayRows.map((row, idx) => {
                              return (
                                <tr key={`${row.streamDisplay}-${idx}`} style={{ background: row.missing ? 'rgba(251,113,133,.05)' : undefined }}>
                                  <Td mono style={{ padding: '12px 18px', height: 52, color: 'var(--text-2)' }}>{idx + 1}</Td>
                                  <Td bold style={{ padding: '12px 18px', height: 52 }}>{row.streamDisplay}</Td>
                                  <Td style={{ padding: '12px 18px', height: 52 }}>
                                    <CollectionDutyCell row={row} displayNames={collectionBandDisplayNames} />
                                  </Td>
                                  <Td style={{ padding: '12px 18px', height: 52 }} title={row.leadHandles.join(' ')}>
                                    <CollectionBandPeople handles={row.leadHandles} displayNames={collectionBandDisplayNames} />
                                  </Td>
                                  <Td style={{ padding: '12px 18px', height: 52, textAlign: 'center' }}><CollectionStatusIcon missing={row.missing} /></Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      ) : (
                        <EmptyState text="Данные появятся после запуска сбора." />
                      )}

                    </>
                  )}
                </CardBody>
              </Card>

              {pingText && (
                <Card style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 34px rgba(15,23,42,.06)' }}>
                  <CardHeader style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', padding: '18px 20px 0' }}>
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
                    <CardBody style={{ padding: '18px 20px 16px' }}>
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

              <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 22, boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Пошаговый запуск</div>
                  <LegacyWorkflowButton disabled={collectionRunning} onClick={resetCollectionWorkflow}>
                    Сбросить шаги
                  </LegacyWorkflowButton>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

	          {majorTab === 'release' && (
	            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
	              <Card>
	                <CardBody style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
	                  <div style={{ flex: '1 1 280px' }}>
	                    <FieldLabel>Номер релиза</FieldLabel>
	                    <Input
	                      value={majorSharedRelease}
	                      onChange={event => updateMajorSharedRelease(event.target.value)}
	                      placeholder="например: 7.5.5"
	                    />
	                  </div>
	                  <Button
                      variant="secondary"
                      onClick={() => void openNoticeModal()}
                      style={{
                        background: '#2563eb',
                        borderColor: '#2563eb',
                        color: '#fff',
                        boxShadow: '0 8px 18px rgba(37,99,235,.22)',
                      }}
                    >
	                    Опубликовать оповещение
	                  </Button>
	                </CardBody>
	              </Card>

	              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
	                <Card>
	                  <CardHeader><CardTitle>iOS</CardTitle></CardHeader>
	                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
	                    <div>
	                      <FieldLabel>Сообщение в тред</FieldLabel>
	                      <Textarea value={iosText} onChange={event => setIosText(event.target.value)} rows={20} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
	                    </div>
	                  </CardBody>
                </Card>
	                <Card>
	                  <CardHeader><CardTitle>Android</CardTitle></CardHeader>
	                  <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
	                    <div>
	                      <FieldLabel>Сообщение в тред</FieldLabel>
	                      <Textarea value={andText} onChange={event => setAndText(event.target.value)} rows={20} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
	                    </div>
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Опрос по стримам</CardTitle>
                </CardHeader>
                <CardBody>
                  <FieldLabel>Текст опроса (получаем из Allure / только просмотр)</FieldLabel>
                  <Textarea value={pollText} readOnly rows={6} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>{majorPollStatusText}</div>
                </CardBody>
              </Card>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 4px' }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Пошаговая публикация в ленту релизов</div>
                <LegacyWorkflowButton disabled={iosRunning || andRunning || iosSyncing || andSyncing} onClick={resetMajorWorkflow}>
                  Сбросить шаги
                </LegacyWorkflowButton>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                <Card style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 22, boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', padding: '0 4px' }}>iOS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PUSH_IOS_STEPS.map((step, idx) => {
                      const sk = stepSK('ios', idx);
                      const st = iosStatuses[idx] ?? 'pending';
                      return (
                        <PushStepRow
                          key={step.code}
                          step={step} idx={idx} status={st}
                          currentIdx={iosCurrentIdx} running={iosRunning || iosSyncing}
                          onExecute={() => executeMajorStep('ios', idx)}
                          onSkip={() => skipMajorStep('ios', idx)}
                          onRetry={() => retryMajorStep('ios', idx)}
                          manualActionLabel={idx === 5 && st === 'done' ? 'Обновить сообщение' : undefined}
                          onManualAction={idx === 5 ? () => void refreshComponentsMessage('ios', { updateExisting: true, source: 'manual' }) : undefined}
                          scheduleControls={st === 'pending' ? (
                            <StepScheduleBlock
                              plan={stepSchedules[sk]} tick={scheduleTick}
                              disabled={iosRunning || iosSyncing}
                              onDelay={min => scheduleStep('ios', idx, 'delay', min, '', '')}
                              onAtTime={(d, t) => scheduleStep('ios', idx, 'schedule', 0, d, t)}
                              onCancel={() => cancelStepSchedule(sk)}
                            />
                          ) : undefined}
                        />
                      );
                    })}
                  </div>
                </Card>
                <Card style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 22, boxShadow: 'var(--shadow-soft)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', padding: '0 4px' }}>Android</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PUSH_AND_STEPS.map((step, idx) => {
                      const sk = stepSK('android', idx);
                      const st = andStatuses[idx] ?? 'pending';
                      return (
                        <PushStepRow
                          key={step.code}
                          step={step} idx={idx} status={st}
                          currentIdx={andCurrentIdx} running={andRunning || andSyncing}
                          onExecute={() => executeMajorStep('android', idx)}
                          onSkip={() => skipMajorStep('android', idx)}
                          onRetry={() => retryMajorStep('android', idx)}
                          manualActionLabel={idx === 5 && st === 'done' ? 'Обновить сообщение' : undefined}
                          onManualAction={idx === 5 ? () => void refreshComponentsMessage('android', { updateExisting: true, source: 'manual' }) : undefined}
                          scheduleControls={st === 'pending' ? (
                            <StepScheduleBlock
                              plan={stepSchedules[sk]} tick={scheduleTick}
                              disabled={andRunning || andSyncing}
                              onDelay={min => scheduleStep('android', idx, 'delay', min, '', '')}
                              onAtTime={(d, t) => scheduleStep('android', idx, 'schedule', 0, d, t)}
                              onCancel={() => cancelStepSchedule(sk)}
                            />
                          ) : undefined}
                        />
                      );
                    })}
                  </div>
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
	                <CardBody>
	                  <div>
	                    <FieldLabel>Номер релиза</FieldLabel>
	                    <Input
	                      value={majorSharedRelease}
	                      onChange={event => updateMajorSharedRelease(event.target.value)}
	                      placeholder="например: 7.3.1000"
	                    />
	                  </div>
	                </CardBody>
	              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {renderDutyPingCard('android')}
                {renderDutyPingCard('ios')}
              </div>
            </div>
          )}

          {majorTab === 'editor' && (
            <div className="release-launch-duty-editor-shell">
              <div className="release-launch-duty-editor-top">
                <div className="release-launch-duty-editor-meta">
                  {editorStatus.text && (
                    <Badge color={
                      editorStatus.level === 'ok' ? 'green' :
                      editorStatus.level === 'error' ? 'red' :
                      editorStatus.level === 'info' ? 'blue' :
                      editorStatus.level === 'warn' ? 'yellow' : 'gray'
                    }>
                      {editorStatus.text}
                    </Badge>
                  )}
                  {editorPresenceLoading && <Badge color="blue">Band-профили обновляются</Badge>}
                </div>
                <div className="release-launch-duty-editor-top-actions">
                  <button
                    type="button"
                    className="release-launch-duty-editor-action-btn"
                    onClick={() => loadEditor(true)}
                    disabled={editorLoading || editorSaving}
                  >
                    <DutyEditorRefreshIcon />
                    <span>{editorLoading ? 'Загрузка...' : 'Обновить'}</span>
                  </button>
                </div>
              </div>

              <div className="release-launch-duty-editor-content">
                <Card>
                  <CardHeader>
                    <CardTitle>Стримы и их лиды</CardTitle>
                    <div className="release-launch-duty-editor-block-actions">
                      <button type="button" className="release-launch-duty-editor-link" onClick={() => openExternal(DUTY_EDITOR_JSON_URL)}>
                        <DutyEditorExternalIcon />
                        <span>Ссылка на файл</span>
                      </button>
                      <button
                        type="button"
                        className="release-launch-duty-editor-add-btn"
                        onClick={addLeadRow}
                        disabled={editorLoading || editorSaving || editorLeads.some(row => row.editing)}
                      >
                        <DutyEditorPlusIcon />
                        <span>Добавить</span>
                      </button>
                      <button
                        type="button"
                        className="release-launch-duty-editor-collapse-btn"
                        onClick={() => setEditorLeadsCollapsed(prev => !prev)}
                        aria-expanded={!editorLeadsCollapsed}
                      >
                        <DutyEditorChevronIcon collapsed={editorLeadsCollapsed} />
                        <span>{editorLeadsCollapsed ? 'Развернуть' : 'Свернуть'}</span>
                      </button>
                    </div>
                  </CardHeader>
                  {!editorLeadsCollapsed && (
                    <CardBody style={{ padding: '18px 20px 16px' }}>
                      {editorLoading ? (
                        <div className="release-launch-duty-editor-loader-inline">
                          <span className="release-launch-duty-editor-inline-spinner" />
                          <span>Загружаю лидов, Band-профили и фото...</span>
                        </div>
                      ) : editorLeads.length ? (
                        <div className="release-launch-duty-editor-leads">
                          <div className="release-launch-duty-editor-leads-head">
                            <div>Название стрима</div>
                            <div>Лид</div>
                            <div />
                          </div>
                          {editorLeads.map((row, idx) => {
                            const values = Array.isArray(row.values) ? row.values : [];
                            const isCore = isCoreEditorLead(row);
                            const renderLeadDisplay = (valueIndex: number, platform?: 'ios' | 'android') => {
                              const value = values[valueIndex] || '';
                              if (platform) {
                                return (
                                  <div className="release-launch-duty-editor-lead-stack-item">
                                    <DutyEditorPlatformTag platform={platform} />
                                    <div className="release-launch-duty-editor-lead-stack-value">
                                      <CopyableDutyEditorLead value={value} profiles={editorLeadProfiles} avatarUrls={editorLeadAvatarUrls} />
                                    </div>
                                  </div>
                                );
                              }
                              return <CopyableDutyEditorLead value={value} profiles={editorLeadProfiles} avatarUrls={editorLeadAvatarUrls} />;
                            };
                            const renderLeadInput = (valueIndex: number, platform?: 'ios' | 'android') => {
                              const value = values[valueIndex] || '';
                              const searchKey = `${idx}:${valueIndex}`;
                              const search = editorLeadSearch[searchKey];
                              return (
                                <div className="release-launch-duty-editor-lead-search-item">
                                  {platform && <DutyEditorPlatformTag platform={platform} />}
                                  <div className={`release-launch-duty-editor-lead-search ${search?.open ? 'is-open' : ''}`}>
                                    <Input
                                      value={value}
                                      disabled={editorSaving}
                                      onChange={event => {
                                        const nextValue = event.target.value;
                                        updateLeadRow(idx, 'value', nextValue, valueIndex);
                                        queueEditorLeadSearch(idx, valueIndex, nextValue);
                                      }}
                                      placeholder={platform ? `@login ${platform === 'ios' ? 'iOS' : 'Android'}` : '@login'}
                                      autoComplete="off"
                                      spellCheck={false}
                                    />
                                    {search?.open && (
                                      <div className="release-launch-duty-editor-search-panel">
                                        {search.loading && <div className="release-launch-duty-editor-search-empty">Ищем в Band...</div>}
                                        {search.error && <div className="release-launch-duty-editor-search-empty is-error">{search.error}</div>}
                                        {!search.loading && !search.error && search.items.length === 0 && (
                                          <div className="release-launch-duty-editor-search-empty">Ничего не найдено</div>
                                        )}
                                        {search.items.map(item => (
                                          <DutyEditorSearchOption
                                            key={item.id}
                                            item={item}
                                            avatarUrls={editorLeadAvatarUrls}
                                            onSelect={selected => {
                                              updateLeadRow(idx, 'value', selected.handle, valueIndex);
                                              setEditorPresence(prev => ({ ...prev, [selected.handle]: selected.presence }));
                                              setEditorLeadProfiles(prev => ({ ...prev, [editorBandProfileKey(selected.handle)]: selected }));
                                              clearEditorLeadSearch(searchKey);
                                            }}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            };

                            return (
                              <div key={`lead-${idx}`} className={`release-launch-duty-editor-lead-row ${row.editing ? 'is-editing' : ''}`}>
                                {row.editing ? (
                                  <>
                                    <Input
                                      value={row.name}
                                      disabled={editorSaving}
                                      onChange={event => updateLeadRow(idx, 'name', event.target.value)}
                                      placeholder="Название стрима"
                                      spellCheck={false}
                                    />
                                    <div className={`release-launch-duty-editor-lead-search-stack ${isCore ? 'is-multi' : ''}`}>
                                      {isCore ? (
                                        <>
                                          {renderLeadInput(0, 'ios')}
                                          {renderLeadInput(1, 'android')}
                                        </>
                                      ) : renderLeadInput(0)}
                                    </div>
                                    <div className="release-launch-duty-editor-row-actions">
                                      <DutyEditorIconButton title="Сохранить строку" variant="confirm" disabled={editorSaving} onClick={() => confirmLeadEditing(idx)}>
                                        ✓
                                      </DutyEditorIconButton>
                                      <DutyEditorIconButton title="Отменить изменения" disabled={editorSaving} onClick={() => cancelLeadEditing(idx)}>
                                        ×
                                      </DutyEditorIconButton>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className={`release-launch-duty-editor-lead-cell ${row.name ? '' : 'is-muted'}`}>
                                      {row.name || 'Не заполнено'}
                                    </div>
                                    <div className="release-launch-duty-editor-lead-cell">
                                      {isCore ? (
                                        <div className="release-launch-duty-editor-lead-stack">
                                          {renderLeadDisplay(0, 'ios')}
                                          {renderLeadDisplay(1, 'android')}
                                        </div>
                                      ) : renderLeadDisplay(0)}
                                    </div>
                                    <DutyEditorEditDeleteActions
                                      editTitle="Редактировать строку"
                                      deleteTitle="Удалить строку"
                                      disabled={editorSaving}
                                      onEdit={() => startLeadEditing(idx)}
                                      onDelete={() => removeLeadRow(idx)}
                                    />
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <EmptyState text="Список лидов пока пуст." />
                      )}
                    </CardBody>
                  )}
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Группы стримов</CardTitle>
                    <div className="release-launch-duty-editor-block-actions">
                      <button type="button" className="release-launch-duty-editor-link" onClick={() => openExternal(DUTY_EDITOR_DOC_URL)}>
                        <DutyEditorExternalIcon />
                        <span>Ссылка на файл</span>
                      </button>
                      <button
                        type="button"
                        className="release-launch-duty-editor-add-btn"
                        onClick={addStreamGroupRow}
                        disabled={editorLoading || editorSaving || editorStreamGroups.some(row => row.editing)}
                      >
                        <DutyEditorPlusIcon />
                        <span>Добавить</span>
                      </button>
                      <button
                        type="button"
                        className="release-launch-duty-editor-collapse-btn"
                        onClick={() => setEditorStreamGroupsCollapsed(prev => !prev)}
                        aria-expanded={!editorStreamGroupsCollapsed}
                      >
                        <DutyEditorChevronIcon collapsed={editorStreamGroupsCollapsed} />
                        <span>{editorStreamGroupsCollapsed ? 'Развернуть' : 'Свернуть'}</span>
                      </button>
                    </div>
                  </CardHeader>
                  {!editorStreamGroupsCollapsed && (
                    <CardBody>
                      {editorLoading ? (
                        <div className="release-launch-duty-editor-loader-inline">
                          <span className="release-launch-duty-editor-inline-spinner" />
                          <span>Загружаю группы...</span>
                        </div>
                      ) : editorStreamGroups.length ? (
                        <div className="release-launch-duty-editor-grid">
                          {editorStreamGroups.map((row, idx) => {
                            const streams = Array.isArray(row.streams) ? row.streams : [];
                            const editStreams = streams.length ? streams : [''];
                            return (
                              <article key={`stream-group-${idx}`} className={`release-launch-duty-editor-card ${row.editing ? 'is-editing' : ''}`}>
                                <div className="release-launch-duty-editor-card-head">
                                  <div className="release-launch-duty-editor-card-copy">
                                    <div className="release-launch-duty-editor-card-title">{row.name || 'Новая группа'}</div>
                                    <div className="release-launch-status release-launch-status-muted">Значений: {streams.filter(Boolean).length}</div>
                                  </div>
                                  <div className="release-launch-duty-editor-card-head-actions">
                                    {row.editing ? (
                                      <>
                                        <DutyEditorIconButton title="Сохранить блок" variant="confirm" disabled={editorSaving} onClick={() => confirmStreamGroupEditing(idx)}>
                                          ✓
                                        </DutyEditorIconButton>
                                        <DutyEditorIconButton title="Отменить изменения" disabled={editorSaving} onClick={() => cancelStreamGroupEditing(idx)}>
                                          ×
                                        </DutyEditorIconButton>
                                      </>
                                    ) : (
                                      <DutyEditorEditDeleteActions
                                        className=""
                                        editTitle="Редактировать блок"
                                        deleteTitle="Удалить блок"
                                        disabled={editorSaving}
                                        onEdit={() => startStreamGroupEditing(idx)}
                                        onDelete={() => removeStreamGroupRow(idx)}
                                      />
                                    )}
                                  </div>
                                </div>

                                {row.editing ? (
                                  <div className="release-launch-duty-editor-card-body">
                                    <div className="release-launch-field">
                                      <FieldLabel>Название группы</FieldLabel>
                                      <Input
                                        value={row.name}
                                        disabled={editorSaving}
                                        onChange={event => updateStreamGroupRow(idx, 'name', event.target.value)}
                                        placeholder="Payments"
                                        spellCheck={false}
                                      />
                                    </div>
                                    <div className="release-launch-duty-editor-values-block">
                                      <div className="release-launch-duty-editor-card-actions">
                                        <FieldLabel>Стримы</FieldLabel>
                                        <button type="button" className="release-launch-duty-editor-mini-btn" disabled={editorSaving} onClick={() => addStreamGroupValue(idx)}>
                                          Добавить значение
                                        </button>
                                      </div>
                                      <div className="release-launch-duty-editor-values-list">
                                        {editStreams.map((value, valueIndex) => (
                                          <div className="release-launch-duty-editor-value-row" key={`stream-group-${idx}-value-${valueIndex}`}>
                                            <Input
                                              value={value}
                                              disabled={editorSaving}
                                              onChange={event => updateStreamGroupValue(idx, valueIndex, event.target.value)}
                                              placeholder="Название стрима"
                                              spellCheck={false}
                                            />
                                            <button
                                              type="button"
                                              className="release-launch-duty-editor-inline-btn"
                                              disabled={editorSaving}
                                              onClick={() => removeStreamGroupValue(idx, valueIndex)}
                                              aria-label="Удалить значение"
                                              title="Удалить значение"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="release-launch-duty-editor-chip-list">
                                    {streams.length ? streams.map(value => (
                                      <span key={`${row.name}-${value}`} className="release-launch-duty-editor-chip">{value}</span>
                                    )) : (
                                      <span className="release-launch-duty-editor-chip release-launch-duty-editor-chip-empty">Пусто</span>
                                    )}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <EmptyState text="Stream-группы пока не загружены." />
                      )}
                    </CardBody>
                  )}
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {mode !== 'major' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          <Card>
            <CardHeader><CardTitle>Параметры</CardTitle></CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 180 }}>
                  <FieldLabel>Номер релиза</FieldLabel>
                  <Input value={release} onChange={event => setRelease(event.target.value)} placeholder="например: 7.3.5420" />
                </div>
                {nonMajorBuildMode && (
                  <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                    <FieldLabel>Номер сборки (необязательно)</FieldLabel>
                    <Input
                      value={buildValue}
                      onChange={event => setBuildValue(event.target.value)}
                      placeholder="ссылка или номер сборки"
                      disabled={buildResolving || running}
                    />
                  </div>
                )}
                {nonMajorSwatLeadMode && (
                  <div style={{ flex: '1 1 300px', minWidth: 260 }}>
                    <FieldLabel>Дежурный SWAT (необязательно)</FieldLabel>
                    <div style={{ display: 'flex', gap: 12, minHeight: 34, alignItems: 'center', flexWrap: 'wrap' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  <LaunchRunButton running={running} onClick={runWorkflow} />
                </div>
              </div>

              {(!settings.allureToken || !settings.ytToken || !settings.bandCookies) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {!settings.allureToken && <Badge color="red">Нужен Allure токен</Badge>}
                  {!settings.ytToken && <Badge color="yellow">Нужен YouTrack токен</Badge>}
                  {!settings.bandCookies && <Badge color="red">Нужны Band cookies</Badge>}
                </div>
              )}
              {(nonMajorHasSwatAction || nonMajorHasFeedAction || createdRuns.length > 0) && (
                <>
                  <Divider />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {nonMajorHasSwatAction && (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>SWAT</span>
                        <Button variant="ghost" size="sm" onClick={() => publishSwatPost()}>
                          SWAT Team Only
                        </Button>
                        <SchedulePicker onSchedule={targetMs => publishSwatPost(targetMs)} />
                      </>
                    )}
                    {nonMajorHasFeedAction && (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Лента</span>
                        <Button variant="ghost" size="sm" onClick={publishFeedPost}>
                          Лента релизов
                        </Button>
                      </>
                    )}
                    {createdRuns.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Раны</span>
                        {createdRuns.map(run => (
                          <a
                            key={run.id}
                            href={run.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 12, color: '#9B5CFF', textDecoration: 'none', whiteSpace: 'nowrap' }}
                          >
                            #{run.id}{run.reused ? ' ↩' : ''}
                          </a>
                        ))}
                      </div>
                    )}
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
            {(steps.some(step => step.id === 'notify_swat') || steps.some(step => step.id === 'feed_post')) && (
              <Card>
                <CardHeader>
                  <CardTitle>Предварительный просмотр</CardTitle>
                  <Badge color={swatPreviewText || feedPreviewItems.length ? 'green' : 'gray'}>
                    {swatPreviewText || feedPreviewItems.length ? 'Готов' : 'Пока пусто'}
                  </Badge>
                </CardHeader>
                <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
	                  {steps.some(step => step.id === 'notify_swat') && (
	                    <div>
	                      <FieldLabel>SWAT Team Only</FieldLabel>
	                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Тред</div>
	                      <pre style={{
	                        whiteSpace: 'pre-wrap',
	                        margin: 0,
	                        padding: 10,
	                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-soft)',
                        fontSize: 11,
	                        color: swatPreviewText ? 'var(--text)' : 'var(--text-3)',
	                        fontFamily: 'var(--mono)',
	                      }}>{swatPreviewText || 'Пока пусто'}</pre>
	                      <div style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 4px' }}>Содержимое треда</div>
	                      <pre style={{
	                        whiteSpace: 'pre-wrap',
	                        margin: 0,
	                        padding: 10,
	                        borderRadius: 8,
	                        border: '1px solid var(--border)',
	                        background: 'var(--surface-soft)',
	                        fontSize: 11,
	                        color: 'var(--text-3)',
	                        fontFamily: 'var(--mono)',
	                      }}>Нет содержимого треда</pre>
	                    </div>
	                  )}
	                  {steps.some(step => step.id === 'feed_post') && (
	                    <div>
	                      <FieldLabel>Лента релизов</FieldLabel>
	                      {feedPreviewItems.length ? feedPreviewItems.map(item => (
	                        <div key={item.rootMessage} style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
	                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Тред</div>
	                          <pre style={{
	                            whiteSpace: 'pre-wrap',
	                            margin: 0,
	                            padding: 10,
	                            borderRadius: 8,
	                            border: '1px solid var(--border)',
	                            background: 'var(--surface-soft)',
	                            fontSize: 11,
	                            color: 'var(--text)',
	                            fontFamily: 'var(--mono)',
	                          }}>{item.rootMessage}</pre>
	                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Содержимое треда</div>
	                          <pre style={{
	                            whiteSpace: 'pre-wrap',
	                            margin: 0,
	                            padding: 10,
	                            borderRadius: 8,
	                            border: '1px solid var(--border)',
	                            background: 'var(--surface-soft)',
	                            fontSize: 11,
	                            color: 'var(--text)',
	                            fontFamily: 'var(--mono)',
	                          }}>{item.threadMessage}</pre>
	                        </div>
	                      )) : (
                        <pre style={{
                          whiteSpace: 'pre-wrap',
                          margin: 0,
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-soft)',
                          fontSize: 11,
                          color: 'var(--text-3)',
                          fontFamily: 'var(--mono)',
                        }}>Пока пусто</pre>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {mode !== 'major' && logs.length > 0 && !nonMajorLogPanelOpen && (
        <button
          type="button"
          onClick={() => setNonMajorLogPanelOpen(true)}
          title="Открыть лог запуска"
          aria-label="Открыть лог запуска"
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
              background: nonMajorLogActive ? '#A855F7' : '#64748B',
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
      {mode !== 'major' && logs.length > 0 && nonMajorLogPanelOpen && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 520,
            width: nonMajorLogPanelSize.width,
            height: nonMajorLogPanelSize.height,
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
            onMouseDown={startNonMajorLogPanelResize}
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
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>Лог запуска</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge color={nonMajorLogActive ? 'purple' : 'gray'}>{logs.length}</Badge>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(logs.map(line => line.text).join('\n'))}
                title="Скопировать лог"
                aria-label="Скопировать лог"
                style={{
                  height: 26,
                  borderRadius: 8,
                  border: '1px solid var(--border-hi)',
                  background: 'var(--surface-soft)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '0 8px',
                }}
              >
                Копировать
              </button>
              <button
                type="button"
                onClick={() => setLogs([])}
                title="Очистить лог"
                aria-label="Очистить лог"
                style={{
                  height: 26,
                  borderRadius: 8,
                  border: '1px solid var(--border-hi)',
                  background: 'var(--surface-soft)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '0 8px',
                }}
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={() => setNonMajorLogPanelOpen(false)}
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

      {mode === 'major' && majorTab === 'collection' && collectionLogs.length > 0 && !collectionLogPanelOpen && (
        <button
          type="button"
          onClick={() => setCollectionLogPanelOpen(true)}
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
              background: collectionRunning ? '#A855F7' : '#64748B',
              color: '#fff',
              fontSize: 10,
              lineHeight: '20px',
              fontWeight: 800,
              border: '2px solid var(--card)',
            }}
          >
            {collectionLogs.length}
          </span>
        </button>
      )}
      {mode === 'major' && majorTab === 'collection' && collectionLogs.length > 0 && collectionLogPanelOpen && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 520,
            width: collectionLogPanelSize.width,
            height: collectionLogPanelSize.height,
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
            onMouseDown={startCollectionLogPanelResize}
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
              <Badge color={collectionRunning ? 'purple' : 'gray'}>{collectionLogs.length}</Badge>
              <button
                type="button"
                onClick={() => setCollectionLogPanelOpen(false)}
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
            <LogView lines={collectionLogs} maxHeight="100%" style={{ height: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}
      {mode === 'major' && majorTab === 'ping' && dutyPingLogs.length > 0 && !dutyPingLogPanelOpen && (
        <button
          type="button"
          onClick={() => setDutyPingLogPanelOpen(true)}
          title="Открыть лог пинга"
          aria-label="Открыть лог пинга"
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
              background: dutyPingLogActive ? '#A855F7' : '#64748B',
              color: '#fff',
              fontSize: 10,
              lineHeight: '20px',
              fontWeight: 800,
              border: '2px solid var(--card)',
            }}
          >
            {dutyPingLogs.length}
          </span>
        </button>
      )}
      {mode === 'major' && majorTab === 'ping' && dutyPingLogs.length > 0 && dutyPingLogPanelOpen && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 520,
            width: dutyPingLogPanelSize.width,
            height: dutyPingLogPanelSize.height,
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
            onMouseDown={startDutyPingLogPanelResize}
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
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase' }}>Лог пинга</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge color={dutyPingLogActive ? 'purple' : 'gray'}>{dutyPingLogs.length}</Badge>
              <button
                type="button"
                onClick={() => setDutyPingLogPanelOpen(false)}
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
            <LogView lines={dutyPingLogs} maxHeight="100%" style={{ height: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}
    </div>
  );
}
