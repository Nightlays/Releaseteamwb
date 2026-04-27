import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  InfoRow,
  Input,
  Modal,
  Progress,
  SegmentControl,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui';
import {
  cloneGoal,
  createEmptyGoal,
  createGoalUpdate,
  DEFAULT_STATUS_ORDER,
  exportGoalsCsv,
  GOAL_APPROVAL_META,
  formatGoalQuarter,
  formatGoalScore,
  GOALS_PORTAL_PERMISSION_LABELS,
  GOAL_HEALTH_META,
  GOAL_PRIORITY_META,
  GOAL_STATUS_META,
  GoalHealth,
  GoalPriority,
  GoalQuarter,
  GoalRecord,
  GoalApprovalStatus,
  GoalFlowStep,
  GoalScoreDefinition,
  GoalStatus,
  GoalUpdateEntry,
  GoalUpdateSource,
  GoalsPortalMember,
  GoalsPortalPermission,
  GoalsPortalRole,
  GoalsPortalRoleDefinition,
  GoalsPortalState,
  loadGoalsPortalState,
  QUARTERS,
  SCORING_SCALE,
  saveGoalsPortalState,
} from '../../services/goalsPortal';

type GoalsTab = 'overview' | 'board' | 'registry' | 'details' | 'people' | 'settings';
type FilterQuarter = GoalQuarter | 'all';
type FilterStatus = GoalStatus | 'all';
type PortalMode = 'lead' | 'owner';

interface GoalFormState {
  year: string;
  quarter: GoalQuarter;
  platform: string;
  owner: string;
  participants: string;
  title: string;
  objective: string;
  successMetric: string;
  formationStatus: string;
  status: GoalStatus;
  health: GoalHealth;
  priority: GoalPriority;
  progress: string;
  plan: string;
  blockers: string;
  tags: string;
  selfScore: string;
  leadScore: string;
  selfComment: string;
  leadComment: string;
}

const TAB_ITEMS = [
  { label: 'Обзор', value: 'overview' },
  { label: 'Доска', value: 'board' },
  { label: 'Реестр', value: 'registry' },
  { label: 'Карточка', value: 'details' },
  { label: 'Люди', value: 'people' },
  { label: 'Настройки', value: 'settings' },
];

const badgeColorByStatus: Record<GoalStatus, 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'purple'> = {
  draft: 'gray',
  aligned: 'blue',
  in_progress: 'yellow',
  review: 'purple',
  done: 'green',
  blocked: 'red',
};

const badgeColorByHealth: Record<GoalHealth, 'green' | 'yellow' | 'red'> = {
  on_track: 'green',
  risk: 'yellow',
  critical: 'red',
};

const badgeColorByApproval: Record<GoalApprovalStatus, 'gray' | 'blue' | 'yellow' | 'green'> = {
  draft: 'gray',
  pending_lead: 'blue',
  rework: 'yellow',
  approved: 'green',
};

const statusAccentColor: Record<GoalStatus, string> = {
  draft: '#6B7280',
  aligned: '#3B82F6',
  in_progress: '#F59E0B',
  review: '#8B5CF6',
  done: '#10B981',
  blocked: '#EF4444',
};

const healthAccentColor: Record<GoalHealth, string> = {
  on_track: '#10B981',
  risk: '#F59E0B',
  critical: '#EF4444',
};

const statusIcon: Record<GoalStatus, string> = {
  draft: '○',
  aligned: '◎',
  in_progress: '◐',
  review: '◷',
  done: '✓',
  blocked: '⊗',
};

const ROLE_BADGE_COLOR: Record<GoalsPortalRole, 'gray' | 'blue' | 'yellow' | 'green' | 'purple'> = {
  admin: 'purple',
  lead: 'blue',
  owner: 'green',
  participant: 'yellow',
  viewer: 'gray',
};

const BADGE_COLOR_TO_ACCENT: Record<'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'purple', string> = {
  gray: '#6B7280',
  blue: '#3B82F6',
  yellow: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  purple: '#8B5CF6',
};

function makeLocalId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStatusMeta(
  status: GoalStatus,
  definitions: GoalsPortalState['settings']['statuses'],
) {
  const fromSettings = definitions.find(item => item.key === status);
  if (fromSettings) {
    return {
      label: fromSettings.label,
      description: fromSettings.description,
      color: fromSettings.color,
    };
  }
  return GOAL_STATUS_META[status] || {
    label: status,
    description: '',
    color: 'gray' as const,
  };
}

function getSubordinateIds(memberId: string, members: GoalsPortalMember[]) {
  const visited = new Set<string>();
  const stack = [memberId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    members.forEach(member => {
      if (member.active && member.leadId === current && !visited.has(member.id)) {
        visited.add(member.id);
        stack.push(member.id);
      }
    });
  }
  return visited;
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function scoreLabel(score: number | null) {
  return score == null ? 'Нет оценки' : `${score}/5`;
}

function averageScore(goals: GoalRecord[]) {
  const values = goals.map(goal => formatGoalScore(goal)).filter((score): score is number => score != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatApprovalDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}

function getRoleScopeLabels(permissions: Set<GoalsPortalPermission>) {
  const labels: string[] = [];
  if (permissions.has('view_all_goals')) labels.push('Видит все цели');
  if (permissions.has('view_team_goals')) labels.push('Видит цели команды');
  if (permissions.has('view_own_goals')) labels.push('Видит свои цели');
  if (permissions.has('view_assigned_goals')) labels.push('Видит назначенные цели');
  if (permissions.has('review_goals')) labels.push('Проводит согласование');
  if (permissions.has('manage_settings') || permissions.has('manage_members')) labels.push('Управляет моделью');
  return labels;
}

function makeFormState(goal?: GoalRecord): GoalFormState {
  return {
    year: String(goal?.year ?? new Date().getFullYear()),
    quarter: goal?.quarter ?? 'Q2',
    platform: goal?.platform ?? 'Портал',
    owner: goal?.owner ?? '',
    participants: goal?.participants.join(', ') ?? '',
    title: goal?.title ?? '',
    objective: goal?.objective ?? '',
    successMetric: goal?.successMetric ?? '',
    formationStatus: goal?.formationStatus ?? 'Черновик цели.',
    status: goal?.status ?? 'draft',
    health: goal?.health ?? 'on_track',
    priority: goal?.priority ?? 'medium',
    progress: String(goal?.progress ?? 0),
    plan: goal?.plan.map(item => item.text).join('\n') ?? '',
    blockers: goal?.blockers.join('\n') ?? '',
    tags: goal?.tags.join(', ') ?? '',
    selfScore: goal?.evaluation.selfScore != null ? String(goal.evaluation.selfScore) : '',
    leadScore: goal?.evaluation.leadScore != null ? String(goal.evaluation.leadScore) : '',
    selfComment: goal?.evaluation.selfComment ?? '',
    leadComment: goal?.evaluation.leadComment ?? '',
  };
}

function FlowCard({ title, text }: { title: string; text: string }) {
  return (
    <div style={{
      borderRadius: 18,
      padding: 16,
      border: '1px solid var(--border)',
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--card) 95%, transparent), color-mix(in srgb, var(--surface-soft-2) 92%, transparent))',
      boxShadow: 'var(--shadow-soft)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-3)', marginTop: 8 }}>{text}</div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
  accent,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
  accent?: string;
}) {
  return (
    <Card style={{ boxShadow: 'var(--shadow-soft)' }}>
      <CardBody style={{ padding: 18 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.45px', color: 'var(--text-3)', fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: accent || 'var(--text)', marginTop: 8, letterSpacing: '-.7px' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{hint}</div>
      </CardBody>
    </Card>
  );
}

function GoalStatusBadge({
  status,
  definitions,
}: {
  status: GoalStatus;
  definitions?: GoalsPortalState['settings']['statuses'];
}) {
  const meta = getStatusMeta(status, definitions ?? []);
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

function GoalHealthBadge({ health }: { health: GoalHealth }) {
  return <Badge color={badgeColorByHealth[health]}>{GOAL_HEALTH_META[health].label}</Badge>;
}

function GoalPriorityBadge({ priority }: { priority: GoalPriority }) {
  return <Badge color={GOAL_PRIORITY_META[priority].color}>{GOAL_PRIORITY_META[priority].label}</Badge>;
}

function GoalApprovalBadge({ status }: { status: GoalApprovalStatus }) {
  return <Badge color={badgeColorByApproval[status]}>{GOAL_APPROVAL_META[status].label}</Badge>;
}

function GoalPreviewCard({
  goal,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  statusDefinitions,
  canQuickReview,
  onQuickApprove,
  onQuickRework,
}: {
  goal: GoalRecord;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>;
  statusDefinitions?: GoalsPortalState['settings']['statuses'];
  canQuickReview?: boolean;
  onQuickApprove?: () => void;
  onQuickRework?: () => void;
}) {
  const score = formatGoalScore(goal);
  const hColor = healthAccentColor[goal.health];
  const statusMeta = getStatusMeta(goal.status, statusDefinitions ?? []);
  const initials = goal.owner.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '??';

  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        width: '100%',
        textAlign: 'left',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${hColor}`,
        background: goal.health === 'critical'
          ? `color-mix(in srgb, var(--card) 94%, ${hColor} 6%)`
          : goal.health === 'risk'
          ? `color-mix(in srgb, var(--card) 96%, ${hColor} 4%)`
          : 'var(--card)',
        borderRadius: 14,
        padding: '12px 12px 12px 11px',
        cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        transition: 'transform .13s ease, box-shadow .13s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,.16)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.08)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.42, marginBottom: 6 }}>{goal.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 18, height: 18, borderRadius: 999, flexShrink: 0,
              background: `color-mix(in srgb, ${hColor} 20%, var(--surface-soft-2))`,
              border: `1px solid color-mix(in srgb, ${hColor} 35%, transparent)`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, fontWeight: 800, color: hColor,
            }}>{initials}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{goal.owner}</span>
            <span style={{ fontSize: 11, color: 'var(--border-hi)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goal.platform}</span>
          </div>
        </div>
        <GoalHealthBadge health={goal.health} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 11, flexWrap: 'wrap' }}>
        <GoalApprovalBadge status={goal.approval.status} />
        <GoalPriorityBadge priority={goal.priority} />
        <Badge color="gray">{formatGoalQuarter(goal)}</Badge>
        {score != null && <Badge color="purple">{score}/5</Badge>}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 600, marginBottom: 5 }}>
          <span style={{ color: 'var(--text-3)' }}>Прогресс</span>
          <span style={{ color: hColor }}>{goal.progress}%</span>
        </div>
        <Progress value={goal.progress} color={goal.health === 'critical' ? 'red' : goal.health === 'risk' ? 'yellow' : 'green'} />
      </div>

      {/* Lead quick actions — только для pending_lead */}
      {canQuickReview && goal.approval.status === 'pending_lead' && onQuickApprove && (
        <div
          style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid color-mix(in srgb, #7C3AED 20%, var(--border))' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onQuickRework}
            style={{ flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}
          >
            На доработку
          </button>
          <button
            type="button"
            onClick={onQuickApprove}
            style={{ flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 700, borderRadius: 8, border: 'none', background: '#7C3AED', color: '#fff', cursor: 'pointer' }}
          >
            ✓ Согласовать
          </button>
        </div>
      )}
    </button>
  );
}

function GoalListItem({ goal, selected, onSelect }: { goal: GoalRecord; selected: boolean; onSelect: () => void }) {
  const hColor = healthAccentColor[goal.health];
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%', textAlign: 'left',
        border: `1px solid ${selected ? `color-mix(in srgb, ${hColor} 40%, var(--border))` : 'var(--border)'}`,
        borderLeft: `3px solid ${selected ? hColor : 'transparent'}`,
        background: selected ? `color-mix(in srgb, var(--surface-soft) 92%, ${hColor} 8%)` : 'transparent',
        borderRadius: 12, padding: '9px 10px 9px 9px', cursor: 'pointer',
        transition: 'background .1s, border-color .1s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface-soft)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35, marginBottom: 5 }}>{goal.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7, flexWrap: 'wrap' }}>
        <GoalStatusBadge status={goal.status} />
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{goal.owner}</span>
      </div>
      <Progress value={goal.progress} color={goal.health === 'critical' ? 'red' : goal.health === 'risk' ? 'yellow' : 'green'} />
    </button>
  );
}

function KpiChip({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ borderRadius: 14, padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent || 'var(--text)', letterSpacing: '-.6px', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function ProgressRing({ value, color, size = 72 }: { value: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function SectionChrome({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card style={{ boxShadow: 'var(--shadow-soft)' }}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <CardHint>{subtitle}</CardHint>}
        </div>
        {actions}
      </CardHeader>
      <CardBody style={{ paddingTop: 14 }}>{children}</CardBody>
    </Card>
  );
}

export function GoalsPortal() {
  const initialStateRef = useRef<GoalsPortalState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = loadGoalsPortalState();
  }
  const initialPortalState = initialStateRef.current;
  const hasPersistedRef = useRef(false);

  const [portalState, setPortalState] = useState<GoalsPortalState>(() => initialPortalState);
  const [activeTab, setActiveTab] = useState<GoalsTab>('overview');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(() => initialPortalState.goals[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [quarterFilter, setQuarterFilter] = useState<FilterQuarter>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(() => makeFormState());
  const [dragGoalId, setDragGoalId] = useState<string | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(() =>
    initialPortalState.settings.members.find(member => member.active)?.id ?? initialPortalState.settings.members[0]?.id ?? null,
  );
  const [settingsDraft, setSettingsDraft] = useState(() => ({
    quarters: portalState.settings.quarters.join('\n'),
    platforms: portalState.settings.platforms.join('\n'),
    owners: portalState.settings.ownerDirectory.join('\n'),
  }));
  const [roleDrafts, setRoleDrafts] = useState<GoalsPortalRoleDefinition[]>(() =>
    portalState.settings.roles.map(role => ({ ...role, permissions: [...role.permissions] })),
  );
  const [membersDraft, setMembersDraft] = useState<GoalsPortalMember[]>(() =>
    portalState.settings.members.map(member => ({ ...member })),
  );
  const [quickNote, setQuickNote] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [blockerDraft, setBlockerDraft] = useState('');
  const [ownerApprovalCommentDraft, setOwnerApprovalCommentDraft] = useState('');
  const [leadApprovalCommentDraft, setLeadApprovalCommentDraft] = useState('');
  const [boardOwnerFilter, setBoardOwnerFilter] = useState('all');
  const [boardQuarterFilter, setBoardQuarterFilter] = useState<FilterQuarter>('all');
  const [boardPriorityFilter, setBoardPriorityFilter] = useState('all');
  const [platformViewCompact, setPlatformViewCompact] = useState(false);
  const [scoringItems, setScoringItems] = useState<GoalScoreDefinition[]>(() =>
    portalState.settings.scoringScale.map(item => ({ ...item })),
  );
  const [flowItems, setFlowItems] = useState<GoalFlowStep[]>(() =>
    portalState.settings.workflow.map(item => ({ ...item })),
  );
  const [editingScoringIdx, setEditingScoringIdx] = useState<number | null>(null);
  const [editingFlowIdx, setEditingFlowIdx] = useState<number | null>(null);
  const [scoringDraft, setScoringDraft] = useState<GoalScoreDefinition>({ score: 0, title: '', description: '' });
  const [flowDraft, setFlowDraft] = useState<GoalFlowStep>({ id: makeLocalId('flow'), title: '', text: '' });
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [memberDraft, setMemberDraft] = useState<GoalsPortalMember>({ id: '', name: '', role: 'owner', leadId: null, active: true });
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    if (!hasPersistedRef.current) {
      hasPersistedRef.current = true;
      return;
    }
    saveGoalsPortalState(portalState);
  }, [portalState]);

  useEffect(() => {
    setSettingsDraft({
      quarters: portalState.settings.quarters.join('\n'),
      platforms: portalState.settings.platforms.join('\n'),
      owners: portalState.settings.ownerDirectory.join('\n'),
    });
    setRoleDrafts(portalState.settings.roles.map(role => ({ ...role, permissions: [...role.permissions] })));
    setMembersDraft(portalState.settings.members.map(member => ({ ...member })));
    setScoringItems(portalState.settings.scoringScale.map(item => ({ ...item })));
    setFlowItems(portalState.settings.workflow.map(item => ({ ...item })));
  }, [portalState.settings]);

  const quarterOptions = useMemo(() => {
    return portalState.settings.quarters.length ? portalState.settings.quarters : ['Q1', 'Q2', 'Q3', 'Q4'];
  }, [portalState.settings.quarters]);

  const statusDefinitions = useMemo(() => {
    return portalState.settings.statuses.length
      ? portalState.settings.statuses
      : Object.entries(GOAL_STATUS_META).map(([key, meta]) => ({
          key,
          label: meta.label,
          description: meta.description,
          color: meta.color,
        }));
  }, [portalState.settings.statuses]);

  const statusOrder = useMemo(
    () => (statusDefinitions.length ? statusDefinitions.map(item => item.key) : [...DEFAULT_STATUS_ORDER]),
    [statusDefinitions],
  );
  const scoringScaleOptions = useMemo(
    () => (portalState.settings.scoringScale.length ? portalState.settings.scoringScale : [...SCORING_SCALE]),
    [portalState.settings.scoringScale],
  );

  const roleOptions = useMemo(() => portalState.settings.roles, [portalState.settings.roles]);

  const activeMembers = useMemo(
    () => portalState.settings.members.filter(member => member.active),
    [portalState.settings.members],
  );

  useEffect(() => {
    if (!activeMembers.length) {
      setCurrentMemberId(null);
      return;
    }
    if (!currentMemberId || !activeMembers.some(member => member.id === currentMemberId)) {
      setCurrentMemberId(activeMembers[0].id);
    }
  }, [activeMembers, currentMemberId]);

  const currentMember = useMemo(
    () => activeMembers.find(member => member.id === currentMemberId) ?? activeMembers[0] ?? null,
    [activeMembers, currentMemberId],
  );

  const currentRoleDefinition = useMemo(
    () => roleOptions.find(role => role.key === currentMember?.role) ?? null,
    [roleOptions, currentMember],
  );

  const currentPermissions = useMemo(
    () => new Set<GoalsPortalPermission>(currentRoleDefinition?.permissions ?? []),
    [currentRoleDefinition],
  );

  const subordinateIds = useMemo(
    () => (currentMember ? getSubordinateIds(currentMember.id, activeMembers) : new Set<string>()),
    [currentMember, activeMembers],
  );

  const subordinateNames = useMemo(
    () => new Set(activeMembers.filter(member => subordinateIds.has(member.id)).map(member => member.name)),
    [activeMembers, subordinateIds],
  );

  const teamNames = useMemo(() => {
    const names = new Set<string>();
    if (currentMember?.name) names.add(currentMember.name);
    subordinateNames.forEach(name => names.add(name));
    return names;
  }, [currentMember, subordinateNames]);

  const currentLead = useMemo(
    () => activeMembers.find(member => member.id === currentMember?.leadId) ?? null,
    [activeMembers, currentMember],
  );

  const portalMode: PortalMode = currentMember?.role === 'lead' || currentMember?.role === 'admin' ? 'lead' : 'owner';
  const roleScopeLabels = useMemo(() => getRoleScopeLabels(currentPermissions), [currentPermissions]);

  const platformOptions = useMemo(() => {
    const set = new Set(portalState.settings.platforms);
    portalState.goals.forEach(goal => set.add(goal.platform));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [portalState]);

  const ownerOptions = useMemo(() => {
    const set = new Set(portalState.settings.ownerDirectory);
    activeMembers.forEach(member => set.add(member.name));
    portalState.goals.forEach(goal => {
      set.add(goal.owner);
      goal.participants.forEach(person => set.add(person));
    });
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [portalState, activeMembers]);

  const hasPermission = (permission: GoalsPortalPermission) => currentPermissions.has(permission);
  const canManageSettings = hasPermission('manage_settings');
  const canManageMembers = hasPermission('manage_members');

  const isGoalOwner = (goal: GoalRecord) => Boolean(currentMember && goal.owner === currentMember.name);
  const isGoalParticipant = (goal: GoalRecord) => Boolean(currentMember && goal.participants.includes(currentMember.name));
  const isTeamGoal = (goal: GoalRecord) => {
    if (!currentMember) return false;
    if (goal.owner === currentMember.name || subordinateNames.has(goal.owner)) return true;
    return goal.participants.some(person => teamNames.has(person));
  };

  const canViewGoal = (goal: GoalRecord) => {
    if (hasPermission('view_all_goals')) return true;
    if (hasPermission('view_team_goals') && isTeamGoal(goal)) return true;
    if (hasPermission('view_own_goals') && isGoalOwner(goal)) return true;
    if (hasPermission('view_assigned_goals') && isGoalParticipant(goal)) return true;
    return false;
  };

  const canEditGoal = (goal: GoalRecord) => {
    if (hasPermission('edit_any_goal')) return true;
    if (hasPermission('edit_team_goals') && isTeamGoal(goal)) return true;
    if (hasPermission('edit_own_goals') && isGoalOwner(goal)) return true;
    return false;
  };

  const canDeleteGoal = (goal: GoalRecord) => hasPermission('delete_goals') || (hasPermission('edit_own_goals') && isGoalOwner(goal));

  const canReviewGoal = (goal: GoalRecord) => {
    if (!hasPermission('review_goals')) return false;
    if (hasPermission('edit_any_goal')) return true;
    return isTeamGoal(goal);
  };

  const canSelfReviewGoal = (goal: GoalRecord) => hasPermission('self_review') && isGoalOwner(goal);
  const canLeadReviewGoal = (goal: GoalRecord) => hasPermission('lead_review') && canReviewGoal(goal);
  const canCommentGoal = (goal: GoalRecord) => hasPermission('add_goal_updates') && canViewGoal(goal);

  const accessibleGoals = useMemo(
    () => portalState.goals.filter(goal => canViewGoal(goal)),
    [portalState.goals, currentRoleDefinition, currentMember, subordinateNames, teamNames],
  );

  const filteredGoals = useMemo(() => {
    return accessibleGoals.filter(goal => {
      if (quarterFilter !== 'all' && goal.quarter !== quarterFilter) return false;
      if (platformFilter !== 'all' && goal.platform !== platformFilter) return false;
      if (ownerFilter !== 'all' && goal.owner !== ownerFilter) return false;
      if (statusFilter !== 'all' && goal.status !== statusFilter) return false;
      if (!deferredSearch) return true;
      return [
        goal.title,
        goal.objective,
        goal.successMetric,
        goal.platform,
        goal.owner,
        goal.participants.join(' '),
        goal.tags.join(' '),
        goal.blockers.join(' '),
      ].join(' ').toLowerCase().includes(deferredSearch);
    });
  }, [accessibleGoals, quarterFilter, platformFilter, ownerFilter, statusFilter, deferredSearch]);

  const selectedGoal = useMemo(
    () => filteredGoals.find(goal => goal.id === selectedGoalId) ?? filteredGoals[0] ?? accessibleGoals[0] ?? null,
    [filteredGoals, accessibleGoals, selectedGoalId],
  );

  useEffect(() => {
    setOwnerApprovalCommentDraft(selectedGoal?.approval.ownerComment || '');
    setLeadApprovalCommentDraft(selectedGoal?.approval.leadComment || '');
  }, [selectedGoal?.id, selectedGoal?.approval.ownerComment, selectedGoal?.approval.leadComment]);

  useEffect(() => {
    if (!selectedGoalId && filteredGoals[0]) {
      setSelectedGoalId(filteredGoals[0].id);
      return;
    }
    if (selectedGoalId && !accessibleGoals.some(goal => goal.id === selectedGoalId)) {
      setSelectedGoalId(accessibleGoals[0]?.id ?? null);
    }
  }, [filteredGoals, accessibleGoals, selectedGoalId]);

  const metrics = useMemo(() => {
    const avgScore = averageScore(filteredGoals);
    const activeGoals = filteredGoals.filter(goal => goal.status === 'in_progress' || goal.status === 'review').length;
    const blockedGoals = filteredGoals.filter(goal => goal.status === 'blocked').length;
    const atRiskGoals = filteredGoals.filter(goal => goal.health !== 'on_track').length;
    const completion = filteredGoals.length
      ? Math.round(filteredGoals.reduce((sum, goal) => sum + goal.progress, 0) / filteredGoals.length)
      : 0;
    const leadApprovalQueue = filteredGoals.filter(goal => goal.approval.status === 'pending_lead').length;
    const ownerReworkQueue = filteredGoals.filter(goal => goal.approval.status === 'rework').length;
    return { avgScore, activeGoals, blockedGoals, atRiskGoals, completion, leadApprovalQueue, ownerReworkQueue };
  }, [filteredGoals]);

  const platformBreakdown = useMemo(() => {
    return platformOptions.map(platform => {
      const goals = filteredGoals.filter(goal => goal.platform === platform);
      return {
        platform,
        count: goals.length,
        active: goals.filter(goal => goal.status === 'in_progress').length,
        blocked: goals.filter(goal => goal.status === 'blocked').length,
        avgScore: averageScore(goals),
        progress: goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length) : 0,
      };
    }).filter(item => item.count);
  }, [filteredGoals, platformOptions]);

  const peopleRows = useMemo(() => {
    return ownerOptions.map(person => {
      const owned = portalState.goals.filter(goal => goal.owner === person);
      const involved = portalState.goals.filter(goal => goal.participants.includes(person));
      const ownedAvg = owned.length ? Math.round(owned.reduce((sum, goal) => sum + goal.progress, 0) / owned.length) : 0;
      return {
        person,
        ownedCount: owned.length,
        involvedCount: involved.length,
        blocked: [...owned, ...involved].filter(goal => goal.health === 'critical').length,
        ownedAvg,
        avgScore: averageScore(owned),
      };
    }).filter(row => row.ownedCount || row.involvedCount);
  }, [ownerOptions, portalState.goals]);

  const recentUpdates = useMemo(() => {
    return portalState.goals
      .flatMap(goal => goal.updates.slice(0, 2).map(update => ({ ...update, goalTitle: goal.title, goalId: goal.id })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);
  }, [portalState.goals]);

  const topRisks = useMemo(() => {
    return filteredGoals
      .filter(goal => goal.health !== 'on_track' || goal.status === 'blocked')
      .sort((a, b) => (b.health === 'critical' ? 2 : b.health === 'risk' ? 1 : 0) - (a.health === 'critical' ? 2 : a.health === 'risk' ? 1 : 0))
      .slice(0, 5);
  }, [filteredGoals]);

  const actionItems = useMemo(() => {
    const items: Array<{ goal: GoalRecord; reason: string; urgent: boolean }> = [];
    const seen = new Set<string>();
    filteredGoals.forEach(goal => {
      if (goal.health === 'critical' && !seen.has(goal.id)) { items.push({ goal, reason: 'Критический риск', urgent: true }); seen.add(goal.id); }
      if (goal.status === 'blocked' && !seen.has(goal.id)) { items.push({ goal, reason: 'Заблокирована', urgent: true }); seen.add(goal.id); }
      if (goal.approval.status === 'rework' && !seen.has(goal.id)) { items.push({ goal, reason: 'Нужна доработка', urgent: true }); seen.add(goal.id); }
      if (goal.approval.status === 'pending_lead' && !seen.has(goal.id)) { items.push({ goal, reason: 'Ожидает согласования', urgent: false }); seen.add(goal.id); }
      if (goal.health === 'risk' && !seen.has(goal.id)) { items.push({ goal, reason: 'Риск срыва', urgent: false }); seen.add(goal.id); }
    });
    return items.slice(0, 8);
  }, [filteredGoals]);

  const healthSummary = useMemo(() => ({
    on_track: filteredGoals.filter(g => g.health === 'on_track').length,
    risk: filteredGoals.filter(g => g.health === 'risk').length,
    critical: filteredGoals.filter(g => g.health === 'critical').length,
  }), [filteredGoals]);

  const reviewQueue = useMemo(() =>
    filteredGoals
      .filter(g => g.approval.status === 'pending_lead' && canReviewGoal(g))
      .sort((a, b) => (a.approval.ownerSubmittedAt || '').localeCompare(b.approval.ownerSubmittedAt || '')),
    [filteredGoals, currentRoleDefinition, currentMember, subordinateNames, teamNames],
  );

  const boardGoals = useMemo(() => {
    return filteredGoals.filter(goal => {
      if (boardOwnerFilter !== 'all' && goal.owner !== boardOwnerFilter) return false;
      if (boardQuarterFilter !== 'all' && goal.quarter !== boardQuarterFilter) return false;
      if (boardPriorityFilter !== 'all' && goal.priority !== boardPriorityFilter) return false;
      return true;
    });
  }, [filteredGoals, boardOwnerFilter, boardQuarterFilter, boardPriorityFilter]);

  const statusSummary = useMemo(() => {
    return statusOrder.map(status => ({
      status,
      count: filteredGoals.filter(goal => goal.status === status).length,
    }));
  }, [filteredGoals, statusOrder]);

  const approvalSummary = useMemo(() => {
    return Object.entries(GOAL_APPROVAL_META).map(([status, meta]) => ({
      status: status as GoalApprovalStatus,
      meta,
      count: filteredGoals.filter(goal => goal.approval.status === status).length,
    }));
  }, [filteredGoals]);

  const openCreateModal = () => {
    if (!hasPermission('create_goal')) return;
    setEditingGoalId(null);
    setForm(makeFormState(createEmptyGoal({
      platform: platformFilter !== 'all' ? platformFilter : platformOptions[0] || 'Портал',
      quarter: quarterFilter !== 'all' ? quarterFilter : quarterOptions[0] || 'Q2',
      owner: ownerFilter !== 'all' ? ownerFilter : currentMember?.name || '',
    })));
    setModalOpen(true);
  };

  const openEditModal = (goal: GoalRecord) => {
    if (!canEditGoal(goal)) return;
    setEditingGoalId(goal.id);
    setForm(makeFormState(goal));
    setModalOpen(true);
  };

  const applyGoalMutation = (mutator: (goals: GoalRecord[]) => GoalRecord[]) => {
    setPortalState(prev => ({ ...prev, goals: mutator(prev.goals) }));
  };

  const handleSaveGoal = () => {
    const now = new Date().toISOString();
    const existingGoal = editingGoalId ? portalState.goals.find(goal => goal.id === editingGoalId) : null;
    if (existingGoal && !canEditGoal(existingGoal)) return;
    if (!existingGoal && !hasPermission('create_goal')) return;
    const baseGoal = existingGoal ?? createEmptyGoal();
    const previousPlan = existingGoal?.plan ?? [];
    const nextGoal: GoalRecord = {
      ...baseGoal,
      id: baseGoal.id,
      year: Number(form.year || new Date().getFullYear()),
      quarter: form.quarter,
      platform: form.platform.trim() || 'Портал',
      owner: form.owner.trim() || 'Не назначен',
      participants: form.participants.split(',').map(item => item.trim()).filter(Boolean),
      title: form.title.trim() || 'Новая цель',
      objective: form.objective.trim(),
      successMetric: form.successMetric.trim(),
      formationStatus: form.formationStatus.trim(),
      status: form.status,
      health: form.health,
      priority: form.priority,
      progress: Math.max(0, Math.min(100, Number(form.progress || 0))),
      plan: form.plan.split('\n').map(line => line.trim()).filter(Boolean).map((text, index) => ({
        id: previousPlan[index]?.id || `${baseGoal.id}-plan-${index + 1}`,
        text,
        done: previousPlan[index]?.done ?? false,
      })),
      blockers: form.blockers.split('\n').map(line => line.trim()).filter(Boolean),
      tags: form.tags.split(',').map(item => item.trim()).filter(Boolean),
      evaluation: {
        selfScore: form.selfScore ? Number(form.selfScore) : null,
        leadScore: form.leadScore ? Number(form.leadScore) : null,
        selfComment: form.selfComment.trim(),
        leadComment: form.leadComment.trim(),
        lastReviewedAt: form.leadScore || form.selfScore ? now : null,
      },
      updatedAt: now,
      createdAt: existingGoal?.createdAt || now,
      updates: [
        createGoalUpdate(editingGoalId ? 'Карточка цели обновлена.' : 'Цель создана через портал.', 'portal', 'system'),
        ...(existingGoal?.updates || []),
      ],
    };

    applyGoalMutation(goals => {
      if (!editingGoalId) return [nextGoal, ...goals];
      return goals.map(goal => goal.id === editingGoalId ? nextGoal : goal);
    });

    startTransition(() => {
      setSelectedGoalId(nextGoal.id);
      setActiveTab('details');
    });
    setModalOpen(false);
  };

  const handleDuplicate = (goal: GoalRecord) => {
    if (!hasPermission('create_goal')) return;
    const duplicated = cloneGoal(goal);
    applyGoalMutation(goals => [duplicated, ...goals]);
    startTransition(() => {
      setSelectedGoalId(duplicated.id);
      setActiveTab('details');
    });
  };

  const handleDelete = (goalId: string) => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canDeleteGoal(goal)) return;
    applyGoalMutation(goals => goals.filter(goal => goal.id !== goalId));
    if (selectedGoalId === goalId) setSelectedGoalId(null);
  };

  const handleMoveGoal = (goalId: string, status: GoalStatus) => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canEditGoal(goal)) return;
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      if (goal.status === status) return goal;
      return {
        ...goal,
        status,
        updatedAt: new Date().toISOString(),
        updates: [
          createGoalUpdate(`Статус изменен на «${GOAL_STATUS_META[status].label}».`, 'portal', 'status'),
          ...goal.updates,
        ],
      };
    }));
  };

  const handleTogglePlanItem = (goalId: string, itemId: string) => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canEditGoal(goal)) return;
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      const updatedPlan = goal.plan.map(item => item.id === itemId ? { ...item, done: !item.done } : item);
      const autoProgress = updatedPlan.length > 0 ? Math.round(updatedPlan.filter(i => i.done).length / updatedPlan.length * 100) : goal.progress;
      return {
        ...goal,
        plan: updatedPlan,
        progress: autoProgress,
        updatedAt: new Date().toISOString(),
        updates: [
          createGoalUpdate(`Пункт плана выполнен. Прогресс: ${autoProgress}%.`, 'portal', 'plan'),
          ...goal.updates,
        ],
      };
    }));
  };

  const handleAddBlocker = (goalId: string, text: string) => {
    if (!text.trim()) return;
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canEditGoal(goal)) return;
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      return {
        ...goal,
        blockers: [...goal.blockers, text.trim()],
        updatedAt: new Date().toISOString(),
        updates: [createGoalUpdate(`Добавлен блокер: ${text.trim()}`, 'portal', 'status'), ...goal.updates],
      };
    }));
  };

  const handleRemoveBlocker = (goalId: string, idx: number) => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canEditGoal(goal)) return;
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      const removed = goal.blockers[idx];
      return {
        ...goal,
        blockers: goal.blockers.filter((_, i) => i !== idx),
        updatedAt: new Date().toISOString(),
        updates: [createGoalUpdate(`Блокер снят: ${removed}`, 'portal', 'status'), ...goal.updates],
      };
    }));
  };

  const handleSaveGoalMeta = (goalId: string, patch: Partial<GoalRecord>, updateText: string, type: GoalUpdateEntry['type']) => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canEditGoal(goal)) return;
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      return {
        ...goal,
        ...patch,
        updatedAt: new Date().toISOString(),
        updates: [createGoalUpdate(updateText, 'portal', type), ...goal.updates],
      };
    }));
  };

  const handleSubmitForApproval = () => {
    if (!selectedGoal || !canEditGoal(selectedGoal) || !isGoalOwner(selectedGoal)) return;
    const now = new Date().toISOString();
    const ownerComment = ownerApprovalCommentDraft.trim();
    handleSaveGoalMeta(
      selectedGoal.id,
      {
        approval: {
          ...selectedGoal.approval,
          status: 'pending_lead',
          ownerComment,
          ownerSubmittedAt: now,
          ownerSubmittedBy: selectedGoal.owner || 'owner',
          leadComment: '',
          leadReviewedAt: null,
          leadReviewedBy: null,
        },
      },
      ownerComment
        ? `Owner отправил цель на согласование lead. Комментарий: ${ownerComment}`
        : 'Owner отправил цель на согласование lead.',
      'approval',
    );
  };

  const handleLeadDecision = (nextStatus: 'approved' | 'rework') => {
    if (!selectedGoal || !canLeadReviewGoal(selectedGoal)) return;
    const now = new Date().toISOString();
    const leadComment = leadApprovalCommentDraft.trim();
    handleSaveGoalMeta(
      selectedGoal.id,
      {
        approval: {
          ...selectedGoal.approval,
          status: nextStatus,
          leadComment,
          leadReviewedAt: now,
          leadReviewedBy: 'lead',
        },
      },
      nextStatus === 'approved'
        ? leadComment
          ? `Lead согласовал цель. Комментарий: ${leadComment}`
          : 'Lead согласовал цель.'
        : leadComment
          ? `Lead вернул цель на доработку. Комментарий: ${leadComment}`
          : 'Lead вернул цель на доработку.',
      'approval',
    );
  };

  const handleSaveEvaluation = () => {
    if (!selectedGoal || (!canSelfReviewGoal(selectedGoal) && !canLeadReviewGoal(selectedGoal))) return;
    handleSaveGoalMeta(
      selectedGoal.id,
      {
        evaluation: {
          ...selectedGoal.evaluation,
          lastReviewedAt: new Date().toISOString(),
        },
      },
      'Обновлены self-review и lead-review.',
      'evaluation',
    );
  };

  const handleAddNote = () => {
    if (!selectedGoal || !quickNote.trim() || !canCommentGoal(selectedGoal)) return;
    handleSaveGoalMeta(
      selectedGoal.id,
      {},
      quickNote.trim(),
      'note',
    );
    setQuickNote('');
  };

  const handleAddComment = (goalId: string, text: string) => {
    if (!text.trim()) return;
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canCommentGoal(goal)) return;
    const source: GoalUpdateSource = portalMode === 'owner' ? 'owner_comment' : 'lead_comment';
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      const newUpdate: GoalUpdateEntry = {
        id: `${goalId}-cmt-${Date.now()}`,
        text: text.trim(),
        at: new Date().toISOString(),
        author: currentMember?.name || (portalMode === 'owner' ? goal.owner || 'Owner' : 'Lead'),
        source,
        type: 'note' as const,
      };
      return { ...goal, updatedAt: new Date().toISOString(), updates: [newUpdate, ...goal.updates] };
    }));
    setCommentDraft('');
  };

  const quickLeadDecision = (goalId: string, nextStatus: 'approved' | 'rework') => {
    const goal = portalState.goals.find(item => item.id === goalId);
    if (!goal || !canLeadReviewGoal(goal)) return;
    const now = new Date().toISOString();
    const text = nextStatus === 'approved' ? 'Lead согласовал цель.' : 'Lead вернул цель на доработку.';
    applyGoalMutation(goals => goals.map(goal => {
      if (goal.id !== goalId) return goal;
      return {
        ...goal,
        approval: { ...goal.approval, status: nextStatus, leadReviewedAt: now, leadReviewedBy: 'lead' },
        updatedAt: now,
        updates: [createGoalUpdate(text, 'portal', 'approval'), ...goal.updates],
      };
    }));
  };

  const handleSaveSettings = () => {
    if (!canManageSettings && !canManageMembers) return;
    setPortalState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        quarters: canManageSettings ? settingsDraft.quarters.split('\n').map(line => line.trim()).filter(Boolean) : prev.settings.quarters,
        platforms: canManageSettings ? settingsDraft.platforms.split('\n').map(line => line.trim()).filter(Boolean) : prev.settings.platforms,
        ownerDirectory: canManageSettings ? settingsDraft.owners.split('\n').map(line => line.trim()).filter(Boolean) : prev.settings.ownerDirectory,
        scoringScale: canManageSettings ? scoringItems.map(item => ({ ...item })) : prev.settings.scoringScale,
        workflow: canManageSettings ? flowItems.map(item => ({ ...item })) : prev.settings.workflow,
        roles: canManageSettings ? roleDrafts.map(role => ({ ...role, permissions: [...role.permissions] })) : prev.settings.roles,
        members: canManageMembers ? membersDraft.map(member => ({ ...member })) : prev.settings.members,
      },
    }));
  };

  const exportJson = () => {
    downloadText('goals-portal.json', JSON.stringify(portalState, null, 2), 'application/json');
  };

  const exportCsv = () => {
    downloadText('goals-portal.csv', exportGoalsCsv(filteredGoals), 'text/csv;charset=utf-8');
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '10px 12px 24px' }}>
      <div style={{
        display: 'grid',
        gap: 10,
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--card) 97%, transparent), color-mix(in srgb, var(--surface-soft-2) 94%, transparent))',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '12px 14px',
        boxShadow: 'var(--shadow-soft)',
      }}>
        {/* Строка 1: лого-заголовок + кнопки */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', fontWeight: 700, flexShrink: 0 }}>Goals</span>
          <span style={{ color: 'var(--border-hi)', fontSize: 12 }}>·</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.5px', flex: 1, minWidth: 0 }}>Цели команды</span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <Button variant="ghost" size="sm" onClick={exportJson}>JSON</Button>
            <Button variant="ghost" size="sm" onClick={exportCsv}>CSV</Button>
            <Button variant="primary" onClick={openCreateModal}>+ Создать цель</Button>
          </div>
        </div>

        {/* Строка 2: фильтры в одну линию */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 190px' }}>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." />
          </div>
          <div style={{ flex: '0 0 118px' }}>
            <Select value={quarterFilter} onChange={e => setQuarterFilter(e.target.value as FilterQuarter)}>
              <option value="all">Все кварталы</option>
              {quarterOptions.map(q => <option key={q} value={q}>{q}</option>)}
            </Select>
          </div>
          <div style={{ flex: '0 0 138px' }}>
            <Select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}>
              <option value="all">Все платформы</option>
              {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div style={{ flex: '0 0 138px' }}>
            <Select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
              <option value="all">Все owner</option>
              {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
          </div>
          <div style={{ flex: '0 0 118px' }}>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FilterStatus)}>
              <option value="all">Все статусы</option>
              {statusOrder.map(s => <option key={s} value={s}>{GOAL_STATUS_META[s].label}</option>)}
            </Select>
          </div>
          {(search || quarterFilter !== 'all' || platformFilter !== 'all' || ownerFilter !== 'all' || statusFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setQuarterFilter('all'); setPlatformFilter('all'); setOwnerFilter('all'); setStatusFilter('all'); }}>
              Сбросить
            </Button>
          )}
          <Badge color="gray" style={{ marginLeft: 'auto', flexShrink: 0 }}>{filteredGoals.length}</Badge>
        </div>

        {/* Строка 3: табы + текущий пользователь/роль */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SegmentControl items={TAB_ITEMS} value={activeTab} onChange={value => setActiveTab(value as GoalsTab)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ minWidth: 220 }}>
              <Select value={currentMemberId ?? ''} onChange={e => setCurrentMemberId(e.target.value)}>
                {activeMembers.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {roleOptions.find(role => role.key === member.role)?.label || member.role}
                  </option>
                ))}
              </Select>
            </div>
            {currentRoleDefinition && (
              <Badge color={ROLE_BADGE_COLOR[currentRoleDefinition.key]}>
                {currentRoleDefinition.label}
              </Badge>
            )}
            {currentLead?.name && <Badge color="gray">Lead: {currentLead.name}</Badge>}
            {roleScopeLabels.slice(0, 2).map(label => (
              <Badge key={label} color="gray">{label}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
        {activeTab === 'overview' && (
          <>
            {/* Lead: Review Queue */}
            {portalMode === 'lead' && (
              <Card style={{ border: `1px solid color-mix(in srgb, #7C3AED 30%, var(--border))`, boxShadow: 'var(--shadow-soft)' }}>
                <CardHeader>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 999, background: '#7C3AED', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>L</div>
                    <CardTitle>Review Queue</CardTitle>
                  </div>
                  <Badge color={reviewQueue.length ? 'purple' : 'gray'}>{reviewQueue.length} на рассмотрении</Badge>
                </CardHeader>
                <CardBody style={{ paddingTop: 10 }}>
                  {reviewQueue.length ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {reviewQueue.map(goal => (
                        <div key={goal.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                          border: '1px solid color-mix(in srgb, #7C3AED 22%, var(--border))',
                          borderRadius: 12, background: 'color-mix(in srgb, var(--card) 96%, #7C3AED 4%)',
                          flexWrap: 'wrap',
                        }}>
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{goal.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{goal.owner} · {goal.platform} · {formatGoalQuarter(goal)}</div>
                            {goal.approval.ownerComment && (
                              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 5, padding: '5px 8px', background: 'var(--surface-soft)', borderRadius: 8, lineHeight: 1.5 }}>
                                «{goal.approval.ownerComment.slice(0, 120)}{goal.approval.ownerComment.length > 120 ? '…' : ''}»
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <Button variant="secondary" size="sm" onClick={() => { setSelectedGoalId(goal.id); setActiveTab('details'); }}>Открыть</Button>
                            <Button variant="ghost" size="sm" onClick={() => quickLeadDecision(goal.id, 'rework')}>На доработку</Button>
                            <Button variant="primary" size="sm" onClick={() => quickLeadDecision(goal.id, 'approved')}>Согласовать</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="✓" text="Нет целей, ожидающих вашего решения." />
                  )}
                </CardBody>
              </Card>
            )}

            {/* Квартальный quick-selector + health bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, marginRight: 2 }}>Квартал:</span>
              {(['all', ...quarterOptions] as const).map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarterFilter(q as FilterQuarter)}
                  style={{
                    padding: '3px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${quarterFilter === q ? 'var(--primary)' : 'var(--border)'}`,
                    background: quarterFilter === q ? 'var(--primary)' : 'transparent',
                    color: quarterFilter === q ? '#fff' : 'var(--text-3)',
                    transition: 'all .12s',
                  }}
                >{q === 'all' ? 'Все' : q}</button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#10B981', fontWeight: 700 }}>✓ {healthSummary.on_track} в норме</span>
                {healthSummary.risk > 0 && <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>⚠ {healthSummary.risk} риск</span>}
                {healthSummary.critical > 0 && <span style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>✕ {healthSummary.critical} крит.</span>}
              </div>
            </div>

            {/* KPI chips */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
              <KpiChip label="В срезе" value={filteredGoals.length} sub="целей по фильтрам" />
              <KpiChip label="Активные" value={metrics.activeGoals} sub="в работе и ревью" accent="#F59E0B" />
              <KpiChip label="Блокеры" value={metrics.blockedGoals} sub="требуют реакции" accent={metrics.blockedGoals ? '#EF4444' : undefined} />
              <KpiChip label="Ср. оценка" value={metrics.avgScore ? metrics.avgScore.toFixed(1) : '—'} sub="итоговый lead score" accent="#7C3AED" />
              <KpiChip label="Ср. прогресс" value={formatPercent(metrics.completion)} sub={`Апрув: ${metrics.leadApprovalQueue} · доработка: ${metrics.ownerReworkQueue}`} accent="#10B981" />
            </div>

            {/* Main 2-col layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 14, alignItems: 'start' }}>

              {/* Left: воронка + платформы */}
              <div style={{ display: 'grid', gap: 14 }}>

                {/* Status funnel */}
                <Card style={{ boxShadow: 'var(--shadow-soft)' }}>
                  <CardBody style={{ padding: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Воронка статусов</div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                      {statusSummary.map((item, idx) => {
                        const ac = statusAccentColor[item.status];
                        return (
                          <React.Fragment key={item.status}>
                            {idx > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 16, flexShrink: 0, paddingBottom: 4 }}>›</div>
                            )}
                            <div style={{
                              flex: 1, minWidth: 0, textAlign: 'center',
                              borderRadius: 12, padding: '10px 6px',
                              border: `1px solid color-mix(in srgb, ${ac} 25%, var(--border))`,
                              borderTop: `3px solid ${ac}`,
                              background: `color-mix(in srgb, var(--surface-soft) 96%, ${ac} 4%)`,
                            }}>
                              <div style={{ fontSize: 20, fontWeight: 800, color: ac, letterSpacing: '-.4px', lineHeight: 1 }}>{item.count}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, fontWeight: 600 }}>{GOAL_STATUS_META[item.status].label}</div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>

                {/* Platform breakdown */}
                <SectionChrome
                  title="По платформам"
                  actions={
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Badge color="gray">{platformBreakdown.length}</Badge>
                      <button
                        type="button"
                        onClick={() => setPlatformViewCompact(v => !v)}
                        style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
                      >
                        {platformViewCompact ? 'Подробно' : 'Компакт'}
                      </button>
                    </div>
                  }
                >
                  {platformBreakdown.length ? (
                    platformViewCompact ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {platformBreakdown.map(item => (
                          <div key={item.platform} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{item.platform}</span>
                            <span style={{ fontSize: 11, color: '#10B981', fontWeight: 700 }}>{item.progress}%</span>
                            {item.blocked > 0 && <span style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>✕{item.blocked}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 7 }}>
                        {platformBreakdown.map(item => (
                          <div key={item.platform} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)' }}>
                            <div style={{ minWidth: 110, flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.platform}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{item.count} цел. · {item.active} в работе</div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>
                                <span>Прогресс</span><span style={{ color: item.blocked ? '#F59E0B' : '#10B981', fontWeight: 700 }}>{item.progress}%</span>
                              </div>
                              <Progress value={item.progress} color={item.blocked ? 'yellow' : 'green'} />
                            </div>
                            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                              {item.blocked > 0 && <Badge color="red">{item.blocked} блок.</Badge>}
                              {item.avgScore != null && <Badge color="purple">{item.avgScore.toFixed(1)}/5</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <EmptyState text="Нет данных по платформам." />
                  )}
                </SectionChrome>
              </div>

              {/* Right: action center + activity */}
              <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>

                {/* Action center */}
                <Card style={{ boxShadow: 'var(--shadow-soft)' }}>
                  <CardHeader>
                    <CardTitle>Требует реакции</CardTitle>
                    <Badge color={actionItems.length ? 'red' : 'gray'}>{actionItems.length || '—'}</Badge>
                  </CardHeader>
                  <CardBody style={{ paddingTop: 10 }}>
                    {actionItems.length ? (
                      <div style={{ display: 'grid', gap: 7 }}>
                        {actionItems.map(({ goal, reason, urgent }) => (
                          <button
                            key={goal.id}
                            type="button"
                            onClick={() => { setSelectedGoalId(goal.id); setActiveTab('details'); }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '9px 10px',
                              border: `1px solid ${urgent ? 'color-mix(in srgb, #EF4444 28%, var(--border))' : 'var(--border)'}`,
                              borderLeft: `3px solid ${urgent ? '#EF4444' : '#3B82F6'}`,
                              borderRadius: 11, cursor: 'pointer',
                              background: urgent ? 'color-mix(in srgb, var(--card) 96%, #EF4444 4%)' : 'var(--card)',
                              transition: 'opacity .1s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '.82'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3, lineHeight: 1.35 }}>{goal.title}</div>
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: urgent ? '#EF4444' : '#3B82F6', fontWeight: 700 }}>{reason}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· {goal.owner}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon="✓" text="Нет срочных задач" />
                    )}
                  </CardBody>
                </Card>

                {/* Activity feed */}
                <SectionChrome title="Активность">
                  {recentUpdates.length ? (
                    <div style={{ display: 'grid', gap: 7 }}>
                      {recentUpdates.slice(0, 6).map(update => (
                        <button
                          key={update.id}
                          type="button"
                          onClick={() => { setSelectedGoalId(update.goalId); setActiveTab('details'); }}
                          style={{
                            width: '100%', textAlign: 'left', padding: '8px 10px',
                            border: '1px solid var(--border)', borderRadius: 11,
                            background: 'var(--card)', cursor: 'pointer',
                            transition: 'opacity .1s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '.82'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{update.goalTitle}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{update.text}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 5 }}>
                            {new Date(update.at).toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {update.author}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="Пока нет активности." />
                  )}
                </SectionChrome>
              </div>
            </div>
          </>
        )}

        {activeTab === 'board' && (
          <SectionChrome
            title="Доска целей"
            actions={<Badge color="gray">{boardGoals.length} карточек</Badge>}
          >
            {/* Board filters */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 0 165px' }}>
                <Select value={boardOwnerFilter} onChange={e => setBoardOwnerFilter(e.target.value)}>
                  <option value="all">Все исполнители</option>
                  {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </Select>
              </div>
              <div style={{ flex: '0 0 118px' }}>
                <Select value={boardQuarterFilter} onChange={e => setBoardQuarterFilter(e.target.value as FilterQuarter)}>
                  <option value="all">Все кварталы</option>
                  {quarterOptions.map(q => <option key={q} value={q}>{q}</option>)}
                </Select>
              </div>
              <div style={{ flex: '0 0 148px' }}>
                <Select value={boardPriorityFilter} onChange={e => setBoardPriorityFilter(e.target.value)}>
                  <option value="all">Все приоритеты</option>
                  {Object.entries(GOAL_PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                </Select>
              </div>
              {(boardOwnerFilter !== 'all' || boardQuarterFilter !== 'all' || boardPriorityFilter !== 'all') && (
                <Button variant="ghost" size="sm" onClick={() => { setBoardOwnerFilter('all'); setBoardQuarterFilter('all'); setBoardPriorityFilter('all'); }}>
                  Сбросить
                </Button>
              )}
              <Badge color="gray" style={{ marginLeft: 'auto', flexShrink: 0 }}>{boardGoals.length} карточек</Badge>
            </div>

            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(260px, 1fr))', gap: 12, minWidth: 1620 }}>
                {statusOrder.map(status => {
                  const items = boardGoals.filter(goal => goal.status === status);
                  const accent = statusAccentColor[status];
                  return (
                    <div
                      key={status}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        if (dragGoalId) handleMoveGoal(dragGoalId, status);
                        setDragGoalId(null);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        border: '1px solid var(--border)',
                        borderRadius: 18,
                        overflow: 'hidden',
                        minHeight: 460,
                        background: 'var(--card)',
                      }}
                    >
                      {/* Цветная полоса сверху */}
                      <div style={{ height: 3, background: accent, flexShrink: 0 }} />

                      {/* Заголовок колонки */}
                      <div style={{
                        padding: '12px 14px 11px',
                        borderBottom: '1px solid var(--border)',
                        background: `color-mix(in srgb, var(--card) 97%, ${accent} 3%)`,
                        flexShrink: 0,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 13, color: accent,
                            }}>
                              {statusIcon[status]}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{GOAL_STATUS_META[status].label}</span>
                          </div>
                          <span style={{
                            minWidth: 22, height: 22, borderRadius: 999, padding: '0 6px',
                            background: items.length ? accent : 'var(--surface-soft-2)',
                            color: items.length ? '#fff' : 'var(--text-3)',
                            fontSize: 11, fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {items.length}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.5 }}>
                          {GOAL_STATUS_META[status].description}
                        </div>
                      </div>

                      {/* Карточки */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, padding: 10, overflowY: 'auto' }}>
                        {items.length
                          ? items.map(goal => (
                            <GoalPreviewCard
                              key={goal.id}
                              goal={goal}
                              draggable
                                                            onOpen={() => {
                                setSelectedGoalId(goal.id);
                                setActiveTab('details');
                              }}
                              onDragStart={() => setDragGoalId(goal.id)}
                              onDragEnd={() => setDragGoalId(null)}
                              onQuickApprove={() => quickLeadDecision(goal.id, 'approved')}
                              onQuickRework={() => quickLeadDecision(goal.id, 'rework')}
                            />
                          ))
                          : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                              <EmptyState text="Целей нет" />
                            </div>
                          )
                        }
                      </div>

                      {/* Добавить цель */}
                      <div style={{ padding: '6px 10px 10px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={openCreateModal}
                          style={{
                            width: '100%', padding: '7px 10px',
                            border: `1px dashed color-mix(in srgb, ${accent} 38%, var(--border))`,
                            borderRadius: 10, background: 'transparent',
                            color: 'var(--text-3)', fontSize: 12, cursor: 'pointer',
                            textAlign: 'center',
                            transition: 'background .12s, color .12s, border-color .12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = `color-mix(in srgb, ${accent} 8%, transparent)`;
                            e.currentTarget.style.color = accent;
                            e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 55%, transparent)`;
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-3)';
                            e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 38%, var(--border))`;
                          }}
                        >
                          + Добавить цель
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionChrome>
        )}

        {activeTab === 'registry' && (
          <SectionChrome
            title="Реестр целей"
            subtitle="Основной рабочий контур вместо Google Docs: owner, участники, квартал, статус, план, оценка."
            actions={
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" size="sm" onClick={openCreateModal}>Добавить строку</Button>
                <Button variant="secondary" size="sm" onClick={exportCsv}>CSV</Button>
              </div>
            }
          >
            {filteredGoals.length ? (
              <Table style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto', borderRadius: 16, border: '1px solid var(--border)' }}>
                <thead>
                  <tr>
                    <Th>Квартал</Th>
                    <Th>Платформа</Th>
                    <Th>Owner</Th>
                    <Th>Участники</Th>
                    <Th>Цель</Th>
                    <Th>Статус</Th>
                    <Th>Согласование</Th>
                    <Th>Риск</Th>
                    <Th>Прогресс</Th>
                    <Th>Оценка</Th>
                    <Th>Действия</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGoals.map(goal => (
                    <tr key={goal.id} style={{ cursor: 'pointer' }} onClick={() => {
                      setSelectedGoalId(goal.id);
                      setActiveTab('details');
                    }}>
                      <Td>{formatGoalQuarter(goal)}</Td>
                      <Td>{goal.platform}</Td>
                      <Td bold>{goal.owner}</Td>
                      <Td>{goal.participants.join(', ') || '—'}</Td>
                      <Td style={{ minWidth: 320 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>{goal.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55 }}>{goal.successMetric || goal.objective}</div>
                      </Td>
                      <Td><GoalStatusBadge status={goal.status} /></Td>
                      <Td><GoalApprovalBadge status={goal.approval.status} /></Td>
                      <Td><GoalHealthBadge health={goal.health} /></Td>
                      <Td style={{ minWidth: 160 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>{goal.progress}%</div>
                        <Progress value={goal.progress} color={goal.health === 'critical' ? 'red' : goal.health === 'risk' ? 'yellow' : 'green'} />
                      </Td>
                      <Td>{scoreLabel(formatGoalScore(goal))}</Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={event => event.stopPropagation()}>
                          <Button variant="ghost" size="sm" onClick={() => openEditModal(goal)}>Редактировать</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDuplicate(goal)}>Дублировать</Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(goal.id)}>Удалить</Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState text="По выбранным фильтрам реестр пуст. Сбрось фильтры или создай первую цель." />
            )}
          </SectionChrome>
        )}

        {activeTab === 'details' && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, alignItems: 'start' }}>
            {/* Sidebar: list of goals */}
            <Card style={{ boxShadow: 'var(--shadow-soft)', overflow: 'hidden' }}>
              <CardHeader>
                <CardTitle>Цели</CardTitle>
                <Badge color="gray">{filteredGoals.length}</Badge>
              </CardHeader>
              <CardBody style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {filteredGoals.length ? filteredGoals.map(g => (
                  <GoalListItem
                    key={g.id}
                    goal={g}
                    selected={g.id === selectedGoalId}
                    onSelect={() => setSelectedGoalId(g.id)}
                  />
                )) : <EmptyState text="Нет целей по фильтрам." />}
              </CardBody>
            </Card>

            {/* Detail panel */}
            {selectedGoal ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1.45fr .95fr', gap: 14 }}>
              <SectionChrome
                title={selectedGoal.title}
                subtitle={`${selectedGoal.platform} · ${formatGoalQuarter(selectedGoal)} · owner: ${selectedGoal.owner}`}
                actions={
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                    <GoalApprovalBadge status={selectedGoal.approval.status} />
                    <GoalStatusBadge status={selectedGoal.status} />
                    <GoalHealthBadge health={selectedGoal.health} />
                    <GoalPriorityBadge priority={selectedGoal.priority} />
                    {portalMode === 'owner' && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(selectedGoal)}>Редактировать</Button>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(selectedGoal.id)}>Удалить</Button>
                      </>
                    )}
                    {portalMode === 'lead' && selectedGoal.approval.status === 'pending_lead' && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => quickLeadDecision(selectedGoal.id, 'rework')}>На доработку</Button>
                        <Button variant="primary" size="sm" onClick={() => quickLeadDecision(selectedGoal.id, 'approved')}>✓ Согласовать</Button>
                      </>
                    )}
                    {portalMode === 'lead' && selectedGoal.approval.status !== 'pending_lead' && (
                      <Button variant="ghost" size="sm" onClick={() => openEditModal(selectedGoal)}>Редактировать</Button>
                    )}
                  </div>
                }
              >
                <div style={{ display: 'grid', gap: 14 }}>
                  {/* Hero: progress ring + meta grid */}
                  <Card style={{ background: 'var(--surface-soft)', borderRadius: 18 }}>
                    <CardBody style={{ padding: 16 }}>
                      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <ProgressRing
                            value={selectedGoal.progress}
                            size={80}
                            color={selectedGoal.progress === 100 ? '#22C55E' : selectedGoal.health === 'critical' ? '#EF4444' : selectedGoal.health === 'risk' ? '#F59E0B' : '#22C55E'}
                          />
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 0,
                          }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{selectedGoal.progress}%</span>
                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, marginTop: 2 }}>прогресс</span>
                          </div>
                        </div>
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
                          {[
                            { label: 'Квартал', value: formatGoalQuarter(selectedGoal) },
                            { label: 'Платформа', value: selectedGoal.platform },
                            { label: 'Owner', value: selectedGoal.owner },
                            { label: 'Оценка', value: scoreLabel(formatGoalScore(selectedGoal)) },
                          ].map(({ label, value }) => (
                            <div key={label}>
                              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Objective */}
                  <div style={{ padding: '0 2px', display: 'grid', gap: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
                      {selectedGoal.objective || <span style={{ color: 'var(--text-3)' }}>Описание цели пока не заполнено.</span>}
                    </div>
                    {selectedGoal.successMetric && (
                      <div style={{
                        padding: '8px 14px', borderRadius: 12,
                        background: 'color-mix(in srgb, var(--surface-soft) 85%, #3B82F6 15%)',
                        borderLeft: '3px solid #3B82F6',
                        fontSize: 12, color: 'var(--text)', fontWeight: 600, lineHeight: 1.5,
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: 3 }}>Критерий успеха</span>
                        {selectedGoal.successMetric}
                      </div>
                    )}
                    {(selectedGoal.participants.length > 0 || selectedGoal.tags.length > 0) && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {selectedGoal.participants.map(p => (
                          <span key={p} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: 'var(--surface-soft)', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 600 }}>{p}</span>
                        ))}
                        {selectedGoal.tags.map(t => (
                          <span key={t} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: 'color-mix(in srgb, var(--surface-soft) 80%, #8B5CF6 20%)', border: '1px solid color-mix(in srgb, var(--border) 70%, #8B5CF6 30%)', color: 'var(--text-2)', fontWeight: 600 }}>#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Compact controls row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    <div>
                      <FieldLabel>Статус</FieldLabel>
                      <Select
                        value={selectedGoal.status}
                        onChange={e => handleSaveGoalMeta(selectedGoal.id, { status: e.target.value as GoalStatus }, `Статус изменен на «${GOAL_STATUS_META[e.target.value as GoalStatus].label}».`, 'status')}
                      >
                        {statusOrder.map(status => <option key={status} value={status}>{GOAL_STATUS_META[status].label}</option>)}
                      </Select>
                    </div>
                    <div>
                      <FieldLabel>Риск</FieldLabel>
                      <Select
                        value={selectedGoal.health}
                        onChange={e => handleSaveGoalMeta(selectedGoal.id, { health: e.target.value as GoalHealth }, `Оценка риска изменена на «${GOAL_HEALTH_META[e.target.value as GoalHealth].label}».`, 'status')}
                      >
                        {Object.entries(GOAL_HEALTH_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                      </Select>
                    </div>
                    <div>
                      <FieldLabel>Приоритет</FieldLabel>
                      <Select
                        value={selectedGoal.priority}
                        onChange={e => handleSaveGoalMeta(selectedGoal.id, { priority: e.target.value as GoalPriority }, `Приоритет изменен на «${GOAL_PRIORITY_META[e.target.value as GoalPriority].label}».`, 'status')}
                      >
                        {Object.entries(GOAL_PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                      </Select>
                    </div>
                  </div>

                  {/* Approval pipeline */}
                  <Card style={{ background: 'var(--surface-soft)', borderRadius: 18 }}>
                    <CardBody style={{ padding: 16, display: 'grid', gap: 14 }}>
                      {/* Lead action banner — visible only when action needed */}
                      {portalMode === 'lead' && selectedGoal.approval.status === 'pending_lead' && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                          borderRadius: 12, background: 'color-mix(in srgb, var(--surface) 80%, #7C3AED 20%)',
                          border: '1px solid color-mix(in srgb, var(--border) 50%, #7C3AED 50%)',
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Ожидает твоего решения</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Owner отправил цель на согласование</div>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => handleLeadDecision('rework')}>↩ На доработку</Button>
                          <Button variant="primary" size="sm" onClick={() => handleLeadDecision('approved')}>✓ Согласовать</Button>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                        {([
                          { key: 'draft', label: 'Черновик', icon: '○' },
                          { key: 'pending_lead', label: 'На апруве', icon: '⟳' },
                          { key: 'approved', label: 'Согласована', icon: '✓' },
                          { key: 'rework', label: 'Доработка', icon: '↩' },
                        ] as { key: GoalApprovalStatus; label: string; icon: string }[]).map((step, idx, arr) => {
                          const isCurrent = selectedGoal.approval.status === step.key;
                          const isRework = step.key === 'rework';
                          const activeColor = isRework ? '#EF4444' : '#3B82F6';
                          return (
                            <React.Fragment key={step.key}>
                              <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 64, flex: isRework ? undefined : 1,
                              }}>
                                <div style={{
                                  width: 30, height: 30, borderRadius: 999,
                                  background: isCurrent ? activeColor : 'var(--surface)',
                                  border: `2px solid ${isCurrent ? activeColor : 'var(--border-hi)'}`,
                                  color: isCurrent ? '#fff' : 'var(--text-3)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                                }}>{step.icon}</div>
                                <span style={{ fontSize: 10, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? activeColor : 'var(--text-3)', textAlign: 'center', lineHeight: 1.2 }}>{step.label}</span>
                              </div>
                              {idx < arr.length - 1 && (
                                <div style={{ flex: 1, height: 2, background: 'var(--border)', marginBottom: 18, maxWidth: isRework ? 24 : undefined }} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {/* Context rows */}
                      <div style={{ display: 'grid', gap: 3 }}>
                        <InfoRow label="Owner отправил" value={selectedGoal.approval.ownerSubmittedBy ? `${selectedGoal.approval.ownerSubmittedBy} · ${formatApprovalDate(selectedGoal.approval.ownerSubmittedAt)}` : 'Пока не отправлено'} />
                        <InfoRow label="Lead обработал" value={selectedGoal.approval.leadReviewedBy ? `${selectedGoal.approval.leadReviewedBy} · ${formatApprovalDate(selectedGoal.approval.leadReviewedAt)}` : 'Пока нет решения'} />
                      </div>

                      {portalMode === 'owner' ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          <div>
                            <FieldLabel>Комментарий для lead</FieldLabel>
                            <Textarea
                              value={ownerApprovalCommentDraft}
                              onChange={e => setOwnerApprovalCommentDraft(e.target.value)}
                              rows={3}
                              placeholder="Что нужно согласовать, какие KPI и ограничения важно учесть"
                            />
                          </div>
                          {selectedGoal.approval.leadComment && (
                            <div style={{ padding: '8px 12px', borderRadius: 12, background: 'color-mix(in srgb, var(--surface) 85%, #7C3AED 15%)', borderLeft: '3px solid #7C3AED' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Ответ lead</div>
                              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{selectedGoal.approval.leadComment}</div>
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            {selectedGoal.approval.status === 'pending_lead'
                              ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Ожидаем решения lead...</span>
                              : selectedGoal.approval.status === 'approved'
                              ? <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>Цель согласована ✓</span>
                              : <Button variant="primary" size="sm" onClick={handleSubmitForApproval}>Отправить на согласование</Button>
                            }
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {selectedGoal.approval.ownerComment && (
                            <div style={{ padding: '8px 12px', borderRadius: 12, background: 'color-mix(in srgb, var(--surface) 85%, #3B82F6 15%)', borderLeft: '3px solid #3B82F6' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Комментарий owner</div>
                              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{selectedGoal.approval.ownerComment}</div>
                            </div>
                          )}
                          <div>
                            <FieldLabel>Решение lead</FieldLabel>
                            <Textarea
                              value={leadApprovalCommentDraft}
                              onChange={e => setLeadApprovalCommentDraft(e.target.value)}
                              rows={3}
                              placeholder="Что подтверждаем или что owner должен доработать"
                            />
                          </div>
                          {selectedGoal.approval.status === 'pending_lead' ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <Button variant="secondary" size="sm" onClick={() => handleLeadDecision('rework')}>На доработку</Button>
                              <Button variant="primary" size="sm" onClick={() => handleLeadDecision('approved')}>Согласовать</Button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Цель не на апруве — действие недоступно.</span>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>

                  <SectionChrome
                    title="План исполнения"
                    subtitle={selectedGoal.plan.length ? `${selectedGoal.plan.filter(p => p.done).length} / ${selectedGoal.plan.length} выполнено` : 'Пункты цели, которые должны быть закрыты в рамках квартала.'}
                  >
                    {selectedGoal.plan.length ? (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {selectedGoal.plan.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleTogglePlanItem(selectedGoal.id, item.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              border: '1px solid var(--border)',
                              background: item.done ? 'rgba(34,197,94,.08)' : 'var(--surface-soft)',
                              borderRadius: 16,
                              padding: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              border: `2px solid ${item.done ? '#22C55E' : 'var(--border-hi)'}`,
                              background: item.done ? '#22C55E' : 'transparent',
                              flexShrink: 0,
                            }} />
                            <span style={{ fontSize: 13, color: 'var(--text)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="План пока не заполнен." />
                    )}
                  </SectionChrome>
                </div>
              </SectionChrome>

              <div style={{ display: 'grid', gap: 18 }}>
                <SectionChrome title="Квартальная оценка">
                  <div style={{ display: 'grid', gap: 10 }}>

                    {/* Self-review блок — только owner */}
                    <div style={{ border: '1px solid color-mix(in srgb, #3B82F6 22%, var(--border))', borderRadius: 14, overflow: 'hidden' }}>
                      <div style={{
                        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8,
                        background: 'color-mix(in srgb, var(--surface-soft) 92%, #3B82F6 8%)',
                        borderBottom: '1px solid color-mix(in srgb, #3B82F6 18%, var(--border))',
                      }}>
                        <div style={{ width: 20, height: 20, borderRadius: 999, background: '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>O</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Self-review (Owner)</span>
                        {portalMode === 'lead' && <Badge color="gray">только просмотр</Badge>}
                      </div>
                      <div style={{ padding: 12 }}>
                        {portalMode === 'owner' ? (
                          <div style={{ display: 'grid', gap: 10 }}>
                            <div>
                              <FieldLabel>Оценка</FieldLabel>
                              <Select
                                value={selectedGoal.evaluation.selfScore ?? ''}
                                onChange={e => handleSaveGoalMeta(selectedGoal.id, { evaluation: { ...selectedGoal.evaluation, selfScore: e.target.value ? Number(e.target.value) : null } }, 'Обновлен self-review.', 'evaluation')}
                              >
                                <option value="">Нет оценки</option>
                                {scoringScaleOptions.map(item => <option key={item.score} value={item.score}>{item.title}</option>)}
                              </Select>
                            </div>
                            <div>
                              <FieldLabel>Комментарий</FieldLabel>
                              <Textarea
                                value={selectedGoal.evaluation.selfComment}
                                onChange={e => handleSaveGoalMeta(selectedGoal.id, { evaluation: { ...selectedGoal.evaluation, selfComment: e.target.value } }, 'Обновлен self-review комментарий.', 'evaluation')}
                                rows={3}
                                placeholder="Опиши выполнение цели своими словами"
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button variant="secondary" size="sm" onClick={handleSaveEvaluation}>Сохранить</Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: selectedGoal.evaluation.selfScore != null ? '#3B82F6' : 'var(--text-3)' }}>
                              {selectedGoal.evaluation.selfScore != null
                                ? `${selectedGoal.evaluation.selfScore}/5 — ${scoringItems.find(s => s.score === selectedGoal.evaluation.selfScore)?.title || ''}`
                                : 'Owner ещё не выставил оценку'}
                            </div>
                            {selectedGoal.evaluation.selfComment
                              ? <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{selectedGoal.evaluation.selfComment}</div>
                              : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Комментарий не добавлен.</div>}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Lead-review блок — только lead */}
                    <div style={{ border: '1px solid color-mix(in srgb, #7C3AED 22%, var(--border))', borderRadius: 14, overflow: 'hidden' }}>
                      <div style={{
                        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8,
                        background: 'color-mix(in srgb, var(--surface-soft) 92%, #7C3AED 8%)',
                        borderBottom: '1px solid color-mix(in srgb, #7C3AED 18%, var(--border))',
                      }}>
                        <div style={{ width: 20, height: 20, borderRadius: 999, background: '#7C3AED', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>L</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Lead-review</span>
                        {portalMode === 'owner' && <Badge color="gray">только просмотр</Badge>}
                      </div>
                      <div style={{ padding: 12 }}>
                        {portalMode === 'lead' ? (
                          <div style={{ display: 'grid', gap: 10 }}>
                            <div>
                              <FieldLabel>Оценка</FieldLabel>
                              <Select
                                value={selectedGoal.evaluation.leadScore ?? ''}
                                onChange={e => handleSaveGoalMeta(selectedGoal.id, { evaluation: { ...selectedGoal.evaluation, leadScore: e.target.value ? Number(e.target.value) : null } }, 'Обновлен lead-review.', 'evaluation')}
                              >
                                <option value="">Нет оценки</option>
                                {scoringScaleOptions.map(item => <option key={item.score} value={item.score}>{item.title}</option>)}
                              </Select>
                            </div>
                            <div>
                              <FieldLabel>Комментарий lead</FieldLabel>
                              <Textarea
                                value={selectedGoal.evaluation.leadComment}
                                onChange={e => handleSaveGoalMeta(selectedGoal.id, { evaluation: { ...selectedGoal.evaluation, leadComment: e.target.value } }, 'Обновлен lead-review комментарий.', 'evaluation')}
                                rows={3}
                                placeholder="Оценка выполнения, сильные стороны, область роста"
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button variant="secondary" size="sm" onClick={handleSaveEvaluation}>Зафиксировать</Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: selectedGoal.evaluation.leadScore != null ? '#7C3AED' : 'var(--text-3)' }}>
                              {selectedGoal.evaluation.leadScore != null
                                ? `${selectedGoal.evaluation.leadScore}/5 — ${scoringItems.find(s => s.score === selectedGoal.evaluation.leadScore)?.title || ''}`
                                : 'Lead ещё не выставил оценку'}
                            </div>
                            {selectedGoal.evaluation.leadComment
                              ? <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{selectedGoal.evaluation.leadComment}</div>
                              : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Комментарий не добавлен.</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </SectionChrome>

                <SectionChrome
                  title="Блокеры и риски"
                  subtitle="Что мешает достичь результата в этом квартале"
                  actions={selectedGoal.blockers.length > 0 ? <Badge color="red">{selectedGoal.blockers.length}</Badge> : undefined}
                >
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* Add blocker row */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Input
                        value={blockerDraft}
                        onChange={e => setBlockerDraft(e.target.value)}
                        placeholder="Опиши блокер или риск..."
                        onKeyDown={e => {
                          if (e.key === 'Enter' && blockerDraft.trim()) {
                            handleAddBlocker(selectedGoal.id, blockerDraft);
                            setBlockerDraft('');
                          }
                        }}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { handleAddBlocker(selectedGoal.id, blockerDraft); setBlockerDraft(''); }}
                      >+ Добавить</Button>
                    </div>

                    {selectedGoal.blockers.length > 0 ? (
                      selectedGoal.blockers.map((blocker, idx) => (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          border: '1px solid color-mix(in srgb, #EF4444 30%, var(--border))',
                          background: 'color-mix(in srgb, var(--surface-soft) 90%, #EF4444 10%)',
                          borderRadius: 12, padding: '9px 12px',
                        }}>
                          <span style={{ fontSize: 14, color: '#EF4444', flexShrink: 0, marginTop: 1 }}>⚠</span>
                          <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, flex: 1 }}>{blocker}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveBlocker(selectedGoal.id, idx)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}
                            title="Снять блокер"
                          >×</button>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '8px 0' }}>
                        Блокеров нет — введи описание выше и нажми Enter или «+ Добавить»
                      </div>
                    )}
                  </div>
                </SectionChrome>

                {/* Обсуждение — комментарии owner и lead */}
                {(() => {
                  const comments = selectedGoal.updates.filter(u => u.source === 'owner_comment' || u.source === 'lead_comment');
                  const roleColor = portalMode === 'owner' ? '#3B82F6' : '#7C3AED';
                  return (
                    <SectionChrome
                      title="Обсуждение"
                      actions={comments.length > 0 ? <Badge color="gray">{comments.length}</Badge> : undefined}
                    >
                      {/* Поле ввода */}
                      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 999, background: roleColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 2 }}>
                          {portalMode === 'owner' ? 'O' : 'L'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <Textarea
                            value={commentDraft}
                            onChange={e => setCommentDraft(e.target.value)}
                            rows={2}
                            placeholder={portalMode === 'owner' ? 'Напиши комментарий для lead...' : 'Напиши комментарий для owner...'}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                            <Button variant="primary" size="sm" onClick={() => handleAddComment(selectedGoal.id, commentDraft)}>
                              Отправить
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Тред комментариев */}
                      {comments.length ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {[...comments].reverse().map(comment => {
                            const isOwner = comment.source === 'owner_comment';
                            const cColor = isOwner ? '#3B82F6' : '#7C3AED';
                            return (
                              <div key={comment.id} style={{ display: 'flex', gap: 8, flexDirection: isOwner ? 'row' : 'row-reverse' }}>
                                <div style={{ width: 24, height: 24, borderRadius: 999, background: cColor, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                                  {isOwner ? 'O' : 'L'}
                                </div>
                                <div style={{
                                  flex: 1, border: `1px solid color-mix(in srgb, ${cColor} 22%, var(--border))`,
                                  borderRadius: 14,
                                  borderBottomLeftRadius: isOwner ? 4 : 14,
                                  borderBottomRightRadius: isOwner ? 14 : 4,
                                  padding: '9px 12px',
                                  background: `color-mix(in srgb, var(--card) 94%, ${cColor} 6%)`,
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: cColor }}>{isOwner ? 'Owner' : 'Lead'} · {comment.author}</span>
                                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                                      {new Date(comment.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.65 }}>{comment.text}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <EmptyState text="Пока нет комментариев. Начни обсуждение." />
                      )}
                    </SectionChrome>
                  );
                })()}

                {/* История — кнопка открытия модала */}
                {(() => {
                  const events = selectedGoal.updates.filter(u => u.source !== 'owner_comment' && u.source !== 'lead_comment');
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button variant="ghost" size="sm" onClick={() => setShowHistoryModal(true)}>
                          История событий {events.length > 0 ? `(${events.length})` : ''}
                        </Button>
                      </div>

                      {showHistoryModal && (
                        <Modal open={showHistoryModal} title="История событий" onClose={() => setShowHistoryModal(false)}>
                          <div style={{ display: 'grid', gap: 12, minWidth: 480, maxWidth: 600 }}>
                            <div style={{ display: 'grid', gap: 8 }}>
                              <Textarea value={quickNote} onChange={e => setQuickNote(e.target.value)} rows={2} placeholder="Добавить заметку (weekly sync, решение риска...)" />
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Button variant="secondary" size="sm" onClick={handleAddNote}>Добавить заметку</Button>
                              </div>
                            </div>
                            {events.length ? (
                              <div style={{ display: 'grid', gap: 7, maxHeight: 420, overflowY: 'auto' }}>
                                {events.map(event => (
                                  <div key={event.id} style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', borderRadius: 12, padding: '9px 12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                                      <Badge color="gray">{event.type}</Badge>
                                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{new Date(event.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {event.author}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{event.text}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <EmptyState text="Системные события появятся после изменений." />
                            )}
                          </div>
                        </Modal>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            ) : (
              <SectionChrome title="Карточка цели">
                <EmptyState text="Выбери цель из списка слева." />
              </SectionChrome>
            )}
          </div>
        )}

        {activeTab === 'people' && (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Lead: контекст команды */}
            {portalMode === 'lead' && (
              <Card style={{ border: `1px solid color-mix(in srgb, #7C3AED 25%, var(--border))` }}>
                <CardBody style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 999, background: '#7C3AED', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>L</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Coaching обзор команды</span>
                    <Badge color="purple">{peopleRows.length} owner</Badge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                    {[
                      { label: 'Целей в работе', value: filteredGoals.filter(g => g.status === 'in_progress').length, color: '#F59E0B' },
                      { label: 'Ожидают апрув', value: reviewQueue.length, color: '#7C3AED' },
                      { label: 'Критических', value: healthSummary.critical, color: '#EF4444' },
                      { label: 'Ср. прогресс', value: `${metrics.completion}%`, color: '#10B981' },
                    ].map(stat => (
                      <div key={stat.label} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-soft)', textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, letterSpacing: '-.4px' }}>{stat.value}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, fontWeight: 600 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            <SectionChrome title={portalMode === 'lead' ? 'Owner-ы и их цели' : 'Участники и owner'}>
              {peopleRows.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                  {peopleRows.map(row => {
                    const ownerGoals = portalState.goals.filter(g => g.owner === row.person);
                    const pendingForLead = ownerGoals.filter(g => g.approval.status === 'pending_lead').length;
                    return (
                      <Card key={row.person} style={{ boxShadow: 'var(--shadow-soft)' }}>
                        <CardBody style={{ padding: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                              background: `color-mix(in srgb, ${row.blocked ? '#EF4444' : '#10B981'} 15%, var(--surface-soft-2))`,
                              border: `2px solid color-mix(in srgb, ${row.blocked ? '#EF4444' : '#10B981'} 30%, transparent)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, fontWeight: 800, color: row.blocked ? '#EF4444' : '#10B981',
                            }}>
                              {row.person.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{row.person}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{row.ownedCount} целей · {row.involvedCount} участий</div>
                            </div>
                            <Badge color={row.blocked ? 'red' : 'gray'} style={{ flexShrink: 0 }}>
                              {row.blocked ? `${row.blocked} риска` : 'норма'}
                            </Badge>
                          </div>

                          <div style={{ marginBottom: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 4, fontWeight: 600 }}>
                              <span>Ср. прогресс</span>
                              <span style={{ color: '#10B981', fontWeight: 700 }}>{row.ownedAvg}%</span>
                            </div>
                            <Progress value={row.ownedAvg} color={row.blocked ? 'yellow' : 'green'} />
                          </div>

                          <div style={{ display: 'grid', gap: 5 }}>
                            <InfoRow label="Ср. оценка" value={row.avgScore ? `${row.avgScore.toFixed(1)} / 5` : '—'} />
                            {portalMode === 'lead' && pendingForLead > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'color-mix(in srgb, var(--surface-soft) 90%, #7C3AED 10%)', borderRadius: 8, border: '1px solid color-mix(in srgb, #7C3AED 20%, var(--border))' }}>
                                <span style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700 }}>⏳ {pendingForLead} ожидают вашего решения</span>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                            <Button variant="ghost" size="sm" onClick={() => { setOwnerFilter(row.person); setActiveTab('registry'); }} style={{ flex: 1 }}>
                              Цели
                            </Button>
                            {portalMode === 'lead' && pendingForLead > 0 && (
                              <Button variant="secondary" size="sm" onClick={() => { setOwnerFilter(row.person); setActiveTab('board'); }} style={{ flex: 1 }}>
                                Рассмотреть
                              </Button>
                            )}
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="В справочнике пока нет участников." />
              )}
            </SectionChrome>
          </div>
        )}

        {activeTab === 'settings' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Справочники */}
            <SectionChrome title="Справочники портала">
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <FieldLabel>Платформы (по одной на строку)</FieldLabel>
                  <Textarea value={settingsDraft.platforms} onChange={e => setSettingsDraft(prev => ({ ...prev, platforms: e.target.value }))} rows={7} />
                </div>
                <div>
                  <FieldLabel>Owner directory (по одному на строку)</FieldLabel>
                  <Textarea value={settingsDraft.owners} onChange={e => setSettingsDraft(prev => ({ ...prev, owners: e.target.value }))} rows={7} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="primary" onClick={handleSaveSettings}>Сохранить</Button>
                </div>
              </div>
            </SectionChrome>

            {/* Колонка: Модель оценки + Флоу */}
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>

              {/* Модель оценки CRUD */}
              <SectionChrome
                title="Модель оценки"
                actions={
                  <Button variant="secondary" size="sm" onClick={() => {
                    const newItem = { score: scoringItems.length + 1, title: 'Новый уровень', description: '' };
                    setScoringItems(prev => [...prev, newItem]);
                    setEditingScoringIdx(scoringItems.length);
                    setScoringDraft(newItem);
                  }}>+ Добавить</Button>
                }
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  {scoringItems.map((item, idx) => (
                    <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                      {editingScoringIdx === idx ? (
                        <div style={{ padding: 12, display: 'grid', gap: 10, background: 'var(--surface-soft)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10 }}>
                            <div>
                              <FieldLabel>Балл</FieldLabel>
                              <Input type="number" value={scoringDraft.score} onChange={e => setScoringDraft(prev => ({ ...prev, score: Number(e.target.value) }))} />
                            </div>
                            <div>
                              <FieldLabel>Название</FieldLabel>
                              <Input value={scoringDraft.title} onChange={e => setScoringDraft(prev => ({ ...prev, title: e.target.value }))} />
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Описание</FieldLabel>
                            <Textarea value={scoringDraft.description} onChange={e => setScoringDraft(prev => ({ ...prev, description: e.target.value }))} rows={3} />
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Button variant="ghost" size="sm" onClick={() => setEditingScoringIdx(null)}>Отмена</Button>
                            <Button variant="primary" size="sm" onClick={() => {
                              setScoringItems(prev => prev.map((it, i) => i === idx ? { ...scoringDraft } : it));
                              setEditingScoringIdx(null);
                            }}>Сохранить</Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--card)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                              <Badge color="purple">{item.score}</Badge>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.title}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{item.description}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingScoringIdx(idx); setScoringDraft({ ...item }); }}>Ред.</Button>
                            <Button variant="danger" size="sm" onClick={() => { setScoringItems(prev => prev.filter((_, i) => i !== idx)); setEditingScoringIdx(null); }}>✕</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SectionChrome>

              {/* Пользователи портала */}
              <SectionChrome
                title="Пользователи портала"
                actions={
                  canManageMembers ? (
                    <Button variant="secondary" size="sm" onClick={() => {
                      const newMember: GoalsPortalMember = { id: makeLocalId('member'), name: '', role: 'owner', leadId: null, active: true };
                      setMembersDraft(prev => [...prev, newMember]);
                      setEditingMemberIdx(membersDraft.length);
                      setMemberDraft(newMember);
                    }}>+ Добавить</Button>
                  ) : undefined
                }
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  {membersDraft.length === 0 && <EmptyState text="Нет пользователей. Добавь первого." />}
                  {membersDraft.map((member, idx) => (
                    <div key={member.id} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                      {editingMemberIdx === idx ? (
                        <div style={{ padding: 12, display: 'grid', gap: 10, background: 'var(--surface-soft)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <FieldLabel>Имя / логин</FieldLabel>
                              <Input
                                value={memberDraft.name}
                                onChange={e => setMemberDraft(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Иван Иванов"
                              />
                            </div>
                            <div>
                              <FieldLabel>Роль</FieldLabel>
                              <Select
                                value={memberDraft.role}
                                onChange={e => setMemberDraft(prev => ({ ...prev, role: e.target.value as GoalsPortalRole }))}
                              >
                                {(['admin', 'lead', 'owner', 'participant', 'viewer'] as GoalsPortalRole[]).map(r => (
                                  <option key={r} value={r}>
                                    {r === 'admin' ? 'Администратор' : r === 'lead' ? 'Lead' : r === 'owner' ? 'Owner' : r === 'participant' ? 'Участник' : 'Просмотр'}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Lead (руководитель)</FieldLabel>
                            <Select
                              value={memberDraft.leadId ?? ''}
                              onChange={e => setMemberDraft(prev => ({ ...prev, leadId: e.target.value || null }))}
                            >
                              <option value="">— Нет —</option>
                              {membersDraft.filter((m, i) => i !== idx && (m.role === 'lead' || m.role === 'admin')).map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </Select>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              id={`member-active-${idx}`}
                              checked={memberDraft.active}
                              onChange={e => setMemberDraft(prev => ({ ...prev, active: e.target.checked }))}
                            />
                            <label htmlFor={`member-active-${idx}`} style={{ fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>Активный пользователь</label>
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Button variant="ghost" size="sm" onClick={() => {
                              if (!memberDraft.name.trim()) {
                                setMembersDraft(prev => prev.filter((_, i) => i !== idx));
                              }
                              setEditingMemberIdx(null);
                            }}>Отмена</Button>
                            <Button variant="primary" size="sm" onClick={() => {
                              if (!memberDraft.name.trim()) return;
                              setMembersDraft(prev => prev.map((m, i) => i === idx ? { ...memberDraft } : m));
                              setEditingMemberIdx(null);
                            }}>Сохранить</Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: member.active ? 'var(--card)' : 'var(--surface-soft)', opacity: member.active ? 1 : 0.55 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 999, flexShrink: 0,
                            background: member.role === 'admin' ? '#EF4444' : member.role === 'lead' ? '#7C3AED' : member.role === 'owner' ? '#3B82F6' : 'var(--border-hi)',
                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 800,
                          }}>
                            {member.name.trim().charAt(0).toUpperCase() || '?'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name || '—'}</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                              <Badge color={member.role === 'admin' ? 'red' : member.role === 'lead' ? 'purple' : member.role === 'owner' ? 'blue' : 'gray'}>
                                {member.role === 'admin' ? 'Администратор' : member.role === 'lead' ? 'Lead' : member.role === 'owner' ? 'Owner' : member.role === 'participant' ? 'Участник' : 'Просмотр'}
                              </Badge>
                              {member.leadId && (
                                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                                  → {membersDraft.find(m => m.id === member.leadId)?.name ?? member.leadId}
                                </span>
                              )}
                              {!member.active && <Badge color="gray">Неактивен</Badge>}
                            </div>
                          </div>
                          {canManageMembers && (
                            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                              <Button variant="ghost" size="sm" onClick={() => { setEditingMemberIdx(idx); setMemberDraft({ ...member }); }}>Ред.</Button>
                              <Button variant="danger" size="sm" onClick={() => { setMembersDraft(prev => prev.filter((_, i) => i !== idx)); setEditingMemberIdx(null); }}>✕</Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {canManageMembers && membersDraft.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                      <Button variant="primary" size="sm" onClick={handleSaveSettings}>Применить изменения</Button>
                    </div>
                  )}
                </div>
              </SectionChrome>

              {/* Рабочий флоу CRUD */}
              <SectionChrome
                title="Рабочий флоу"
                actions={
                  <Button variant="secondary" size="sm" onClick={() => {
                    const newStep: GoalFlowStep = { id: makeLocalId('flow'), title: 'Новый шаг', text: '' };
                    setFlowItems(prev => [...prev, newStep]);
                    setEditingFlowIdx(flowItems.length);
                    setFlowDraft(newStep);
                  }}>+ Добавить</Button>
                }
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  {flowItems.map((step, idx) => (
                    <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                      {editingFlowIdx === idx ? (
                        <div style={{ padding: 12, display: 'grid', gap: 10, background: 'var(--surface-soft)' }}>
                          <div>
                            <FieldLabel>Название шага</FieldLabel>
                            <Input value={flowDraft.title} onChange={e => setFlowDraft(prev => ({ ...prev, title: e.target.value }))} />
                          </div>
                          <div>
                            <FieldLabel>Описание</FieldLabel>
                            <Textarea value={flowDraft.text} onChange={e => setFlowDraft(prev => ({ ...prev, text: e.target.value }))} rows={3} />
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Button variant="ghost" size="sm" onClick={() => setEditingFlowIdx(null)}>Отмена</Button>
                            <Button variant="primary" size="sm" onClick={() => {
                              setFlowItems(prev => prev.map((s, i) => i === idx ? { ...flowDraft } : s));
                              setEditingFlowIdx(null);
                            }}>Сохранить</Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--card)' }}>
                          <div style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--surface-soft-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', flexShrink: 0 }}>{idx + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{step.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{step.text}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingFlowIdx(idx); setFlowDraft({ ...step }); }}>Ред.</Button>
                            <Button variant="danger" size="sm" onClick={() => { setFlowItems(prev => prev.filter((_, i) => i !== idx)); setEditingFlowIdx(null); }}>✕</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SectionChrome>

              {/* Роли и права */}
              <SectionChrome title="Роли и права доступа">
                <div style={{ display: 'grid', gap: 8 }}>
                  {([
                    { role: 'admin' as GoalsPortalRole, label: 'Администратор', color: '#EF4444', desc: 'Полный доступ: управление пользователями, настройки, все цели' },
                    { role: 'lead' as GoalsPortalRole, label: 'Lead', color: '#7C3AED', desc: 'Согласование целей, просмотр команды, lead-review, coaching' },
                    { role: 'owner' as GoalsPortalRole, label: 'Owner', color: '#3B82F6', desc: 'Создание и ведение своих целей, self-review, отправка на апрув' },
                    { role: 'participant' as GoalsPortalRole, label: 'Участник', color: '#10B981', desc: 'Просмотр назначенных целей, комментарии' },
                    { role: 'viewer' as GoalsPortalRole, label: 'Просмотр', color: 'var(--text-3)', desc: 'Только чтение — целей, прогресса, истории' },
                  ]).map(({ role, label, color, desc }) => {
                    const roleDef = roleDrafts.find(r => r.key === role);
                    const memberCount = membersDraft.filter(m => m.role === role && m.active).length;
                    return (
                      <div key={role} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '10px 14px', background: 'var(--card)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 999, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                          {label.charAt(0)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{roleDef?.label ?? label}</span>
                            <Badge color="gray">{memberCount} чел.</Badge>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 6 }}>{roleDef?.description || desc}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(roleDef?.permissions ?? []).map(p => (
                              <span key={p} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'var(--surface-soft)', border: '1px solid var(--border)', color: 'var(--text-2)', fontFamily: 'monospace' }}>{p}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionChrome>
            </div>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingGoalId ? 'Редактирование цели' : 'Новая цель'} width={880}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div>
            <FieldLabel>Год</FieldLabel>
            <Input value={form.year} onChange={e => setForm(prev => ({ ...prev, year: e.target.value }))} />
          </div>
          <div>
            <FieldLabel>Квартал</FieldLabel>
            <Select value={form.quarter} onChange={e => setForm(prev => ({ ...prev, quarter: e.target.value as GoalQuarter }))}>
              {quarterOptions.map(quarter => <option key={quarter} value={quarter}>{quarter}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Платформа</FieldLabel>
            <Select value={form.platform} onChange={e => setForm(prev => ({ ...prev, platform: e.target.value }))}>
              {platformOptions.map(platform => <option key={platform} value={platform}>{platform}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Ответственный</FieldLabel>
            <Input value={form.owner} onChange={e => setForm(prev => ({ ...prev, owner: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Участники через запятую</FieldLabel>
            <Input value={form.participants} onChange={e => setForm(prev => ({ ...prev, participants: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Название цели</FieldLabel>
            <Input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Описание цели</FieldLabel>
            <Textarea value={form.objective} onChange={e => setForm(prev => ({ ...prev, objective: e.target.value }))} rows={4} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Критерий успеха / KPI</FieldLabel>
            <Textarea value={form.successMetric} onChange={e => setForm(prev => ({ ...prev, successMetric: e.target.value }))} rows={3} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Статус на момент формирования</FieldLabel>
            <Textarea value={form.formationStatus} onChange={e => setForm(prev => ({ ...prev, formationStatus: e.target.value }))} rows={3} />
          </div>
          <div>
            <FieldLabel>Статус</FieldLabel>
            <Select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as GoalStatus }))}>
              {statusOrder.map(status => <option key={status} value={status}>{GOAL_STATUS_META[status].label}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Риск</FieldLabel>
            <Select value={form.health} onChange={e => setForm(prev => ({ ...prev, health: e.target.value as GoalHealth }))}>
              {Object.entries(GOAL_HEALTH_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Приоритет</FieldLabel>
            <Select value={form.priority} onChange={e => setForm(prev => ({ ...prev, priority: e.target.value as GoalPriority }))}>
              {Object.entries(GOAL_PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Прогресс, %</FieldLabel>
            <Input type="number" min={0} max={100} value={form.progress} onChange={e => setForm(prev => ({ ...prev, progress: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>План, по одному пункту на строку</FieldLabel>
            <Textarea value={form.plan} onChange={e => setForm(prev => ({ ...prev, plan: e.target.value }))} rows={6} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Блокеры, по одному на строку</FieldLabel>
            <Textarea value={form.blockers} onChange={e => setForm(prev => ({ ...prev, blockers: e.target.value }))} rows={4} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldLabel>Теги через запятую</FieldLabel>
            <Input value={form.tags} onChange={e => setForm(prev => ({ ...prev, tags: e.target.value }))} />
          </div>
          <div>
            <FieldLabel>Self-review</FieldLabel>
            <Select value={form.selfScore} onChange={e => setForm(prev => ({ ...prev, selfScore: e.target.value }))}>
              <option value="">Нет оценки</option>
              {scoringScaleOptions.map(item => <option key={item.score} value={item.score}>{item.title}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Lead-review</FieldLabel>
            <Select value={form.leadScore} onChange={e => setForm(prev => ({ ...prev, leadScore: e.target.value }))}>
              <option value="">Нет оценки</option>
              {scoringScaleOptions.map(item => <option key={item.score} value={item.score}>{item.title}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>Комментарий owner</FieldLabel>
            <Textarea value={form.selfComment} onChange={e => setForm(prev => ({ ...prev, selfComment: e.target.value }))} rows={3} />
          </div>
          <div>
            <FieldLabel>Комментарий lead</FieldLabel>
            <Textarea value={form.leadComment} onChange={e => setForm(prev => ({ ...prev, leadComment: e.target.value }))} rows={3} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Отмена</Button>
          <Button variant="primary" onClick={handleSaveGoal}>Сохранить</Button>
        </div>
      </Modal>
    </div>
  );
}
