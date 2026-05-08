export const GOALS_PORTAL_STORAGE_KEY = 'release-platform-goals-portal-v3';
const GOALS_PORTAL_FALLBACK_STORAGE_KEY = 'release-platform-goals-portal-v3-fallback';

export type GoalQuarter = string;
export type GoalStatus = string;
export type GoalHealth = 'on_track' | 'risk' | 'critical';
export type GoalPriority = 'low' | 'medium' | 'high';
export type GoalApprovalStatus = 'draft' | 'pending_lead' | 'rework' | 'approved';
export type GoalUpdateType = 'system' | 'status' | 'progress' | 'evaluation' | 'plan' | 'note' | 'approval';
export type GoalUpdateSource = 'timeline' | 'owner_comment' | 'lead_comment';
export type GoalsPortalRole = 'admin' | 'lead' | 'owner' | 'participant' | 'viewer';
export type GoalsPortalPermission =
  | 'view_all_goals'
  | 'view_team_goals'
  | 'view_own_goals'
  | 'view_assigned_goals'
  | 'create_goal'
  | 'edit_any_goal'
  | 'edit_team_goals'
  | 'edit_own_goals'
  | 'delete_goals'
  | 'review_goals'
  | 'self_review'
  | 'lead_review'
  | 'add_goal_updates'
  | 'manage_settings'
  | 'manage_members';

export interface GoalPlanItem {
  id: string;
  text: string;
  done: boolean;
}

export interface GoalUpdateEntry {
  id: string;
  at: string;
  author: string;
  text: string;
  type: GoalUpdateType;
  source?: GoalUpdateSource;
}

export interface GoalEvaluation {
  selfScore: number | null;
  leadScore: number | null;
  selfComment: string;
  leadComment: string;
  lastReviewedAt: string | null;
}

export interface GoalApproval {
  status: GoalApprovalStatus;
  ownerComment: string;
  ownerSubmittedAt: string | null;
  ownerSubmittedBy: string | null;
  leadComment: string;
  leadReviewedAt: string | null;
  leadReviewedBy: string | null;
}

export interface GoalRecord {
  id: string;
  year: number;
  quarter: GoalQuarter;
  platform: string;
  owner: string;
  participants: string[];
  title: string;
  objective: string;
  successMetric: string;
  formationStatus: string;
  status: GoalStatus;
  health: GoalHealth;
  priority: GoalPriority;
  progress: number;
  tags: string[];
  blockers: string[];
  plan: GoalPlanItem[];
  updates: GoalUpdateEntry[];
  approval: GoalApproval;
  evaluation: GoalEvaluation;
  createdAt: string;
  updatedAt: string;
}

export interface GoalStatusDefinition {
  key: string;
  label: string;
  description: string;
  color: 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'purple';
}

export interface GoalsPortalRoleDefinition {
  key: GoalsPortalRole;
  label: string;
  description: string;
  permissions: GoalsPortalPermission[];
}

export interface GoalsPortalMember {
  id: string;
  name: string;
  role: GoalsPortalRole;
  leadId: string | null;
  active: boolean;
}

export interface GoalFlowStep {
  id: string;
  title: string;
  text: string;
}

export interface GoalScoreDefinition {
  score: number;
  title: string;
  description: string;
}

export interface GoalsPortalSettings {
  quarters: string[];
  platforms: string[];
  ownerDirectory: string[];
  statuses: GoalStatusDefinition[];
  workflow: GoalFlowStep[];
  scoringScale: GoalScoreDefinition[];
  roles: GoalsPortalRoleDefinition[];
  members: GoalsPortalMember[];
}

export interface GoalsPortalState {
  goals: GoalRecord[];
  settings: GoalsPortalSettings;
}

export const QUARTERS: GoalQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

export const GOAL_STATUS_META: Record<GoalStatus, { label: string; description: string; color: 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'purple' }> = {
  draft: {
    label: 'Черновик',
    description: 'Цель еще не подтверждена руководителем.',
    color: 'gray',
  },
  aligned: {
    label: 'Согласование',
    description: 'Цель сформулирована и ждет подтверждения.',
    color: 'blue',
  },
  in_progress: {
    label: 'В работе',
    description: 'Основная активная стадия исполнения.',
    color: 'yellow',
  },
  review: {
    label: 'Квартальный review',
    description: 'Собран результат, идет квартальная оценка.',
    color: 'purple',
  },
  done: {
    label: 'Закрыто',
    description: 'Цель выполнена и закрыта.',
    color: 'green',
  },
  blocked: {
    label: 'Блокер',
    description: 'Есть зависимость или риск, мешающий исполнению.',
    color: 'red',
  },
};

export const GOAL_HEALTH_META: Record<GoalHealth, { label: string; color: 'green' | 'yellow' | 'red' }> = {
  on_track: { label: 'В норме', color: 'green' },
  risk: { label: 'Риск', color: 'yellow' },
  critical: { label: 'Критично', color: 'red' },
};

export const GOAL_PRIORITY_META: Record<GoalPriority, { label: string; color: 'gray' | 'blue' | 'red' }> = {
  low: { label: 'Низкий приоритет', color: 'gray' },
  medium: { label: 'Средний приоритет', color: 'blue' },
  high: { label: 'Высокий приоритет', color: 'red' },
};

export const GOAL_APPROVAL_META: Record<GoalApprovalStatus, { label: string; description: string; color: 'gray' | 'blue' | 'yellow' | 'green' }> = {
  draft: {
    label: 'Черновик owner',
    description: 'Owner еще не отправил цель на согласование lead.',
    color: 'gray',
  },
  pending_lead: {
    label: 'На апруве lead',
    description: 'Цель ждет решения lead по квартальному контуру.',
    color: 'blue',
  },
  rework: {
    label: 'Доработка owner',
    description: 'Lead вернул цель на доработку owner.',
    color: 'yellow',
  },
  approved: {
    label: 'Согласовано',
    description: 'Lead подтвердил цель, можно вести ее в квартале.',
    color: 'green',
  },
};

export const SCORING_SCALE = [
  { score: 1, title: '1/5', description: 'Не начато или сорвано.' },
  { score: 2, title: '2/5', description: 'Сделано частично, есть высокий риск по результату.' },
  { score: 3, title: '3/5', description: 'MVP достигнут, но есть хвост или компромисс.' },
  { score: 4, title: '4/5', description: 'Результат выполнен по плану и закреплен в работе команды.' },
  { score: 5, title: '5/5', description: 'Результат выполнен и дал дополнительный эффект сверх ожиданий.' },
] as const;

export const GOALS_PORTAL_FLOW = [
  {
    title: '1. Формирование цели',
    text: 'Lead выбирает квартал, платформу, owner, участников и описывает цель в одном месте без Google Docs.',
  },
  {
    title: '2. Согласование',
    text: 'Цель проходит статус согласования: уточняются план, критерии оценки, риски и ожидаемый результат.',
  },
  {
    title: '3. Исполнение',
    text: 'Команда двигает цель по статусам, обновляет прогресс, блокеры, план и заметки по изменениям.',
  },
  {
    title: '4. Квартальная оценка',
    text: 'Owner оставляет self-review, руководитель ставит lead-review, после чего цель уходит в финальный квартальный результат.',
  },
] as const;

export const DEFAULT_STATUS_ORDER = ['draft', 'aligned', 'in_progress', 'review', 'done', 'blocked'] as const;
export const GOALS_PORTAL_PERMISSION_LABELS: Record<GoalsPortalPermission, string> = {
  view_all_goals: 'Видеть все цели',
  view_team_goals: 'Видеть цели своей команды',
  view_own_goals: 'Видеть свои цели',
  view_assigned_goals: 'Видеть цели, где участвует',
  create_goal: 'Создавать цели',
  edit_any_goal: 'Редактировать любые цели',
  edit_team_goals: 'Редактировать цели команды',
  edit_own_goals: 'Редактировать свои цели',
  delete_goals: 'Удалять цели',
  review_goals: 'Проводить согласование',
  self_review: 'Заполнять self-review',
  lead_review: 'Заполнять lead-review',
  add_goal_updates: 'Добавлять заметки и обновления',
  manage_settings: 'Менять справочники и настройки',
  manage_members: 'Управлять участниками и иерархией',
};

const GOALS_PORTAL_ROLE_KEYS: GoalsPortalRole[] = ['admin', 'lead', 'owner', 'participant', 'viewer'];
const GOALS_PORTAL_PERMISSION_KEYS: GoalsPortalPermission[] = [
  'view_all_goals',
  'view_team_goals',
  'view_own_goals',
  'view_assigned_goals',
  'create_goal',
  'edit_any_goal',
  'edit_team_goals',
  'edit_own_goals',
  'delete_goals',
  'review_goals',
  'self_review',
  'lead_review',
  'add_goal_updates',
  'manage_settings',
  'manage_members',
];

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function formatGoalScore(goal: GoalRecord) {
  if (goal.evaluation.leadScore != null) return goal.evaluation.leadScore;
  if (goal.evaluation.selfScore != null) return goal.evaluation.selfScore;
  return null;
}

export function formatGoalQuarter(goal: GoalRecord) {
  return `${goal.quarter} ${goal.year}`;
}

export function createPlanItems(lines: string[]) {
  return lines
    .map(line => line.trim())
    .filter(Boolean)
    .map(text => ({ id: makeId('plan'), text, done: false }));
}

export function createGoalUpdate(text: string, author: string, type: GoalUpdateType = 'note'): GoalUpdateEntry {
  return {
    id: makeId('upd'),
    at: nowIso(),
    author,
    text,
    type,
    source: 'timeline',
  };
}

export function createEmptyGoal(defaults?: Partial<GoalRecord>): GoalRecord {
  const createdAt = nowIso();
  return {
    id: makeId('goal'),
    year: new Date().getFullYear(),
    quarter: 'Q2',
    platform: 'Портал',
    owner: '',
    participants: [],
    title: '',
    objective: '',
    successMetric: '',
    formationStatus: 'Черновик цели.',
    status: 'draft',
    health: 'on_track',
    priority: 'medium',
    progress: 0,
    tags: [],
    blockers: [],
    plan: [],
    updates: [],
    approval: {
      status: 'draft',
      ownerComment: '',
      ownerSubmittedAt: null,
      ownerSubmittedBy: null,
      leadComment: '',
      leadReviewedAt: null,
      leadReviewedBy: null,
    },
    evaluation: {
      selfScore: null,
      leadScore: null,
      selfComment: '',
      leadComment: '',
      lastReviewedAt: null,
    },
    createdAt,
    updatedAt: createdAt,
    ...defaults,
  };
}

function createSeedGoals(): GoalRecord[] {
  const goals = [
    createEmptyGoal({
      year: 2026,
      quarter: 'Q2',
      platform: 'Портал',
      owner: 'Дмитрий И.',
      participants: ['Мария Ф.', 'Тигран Г.'],
      title: 'Перевести квартальные цели команды из Google Docs в портал',
      objective: 'Собрать единый сценарий планирования, сопровождения и квартальной оценки целей команды в одном интерфейсе.',
      successMetric: 'Все цели Q2 ведутся только через портал; у каждой цели есть owner, план, прогресс и итоговая оценка.',
      formationStatus: 'Состав полей согласован, MVP подтвержден руководителем.',
      status: 'in_progress',
      health: 'on_track',
      priority: 'high',
      progress: 54,
      tags: ['MVP', 'портал', 'цели'],
      blockers: [],
      plan: createPlanItems([
        'Собрать доменную модель цели и квартальной оценки',
        'Поднять реестр целей с фильтрами по кварталу и owner',
        'Добавить kanban для статусов и квартальную оценку',
      ]),
      updates: [
        createGoalUpdate('Согласована модель данных и структура портала.', 'Дмитрий И.', 'system'),
        createGoalUpdate('Подтвердили необходимость owner-review и self-review.', 'Тигран Г.', 'note'),
      ],
      approval: {
        status: 'approved',
        ownerComment: 'Подтверждены owner, участники, KPI и базовый квартальный план.',
        ownerSubmittedAt: '2026-04-14T08:30:00.000Z',
        ownerSubmittedBy: 'Дмитрий И.',
        leadComment: 'Согласовано. Это базовая квартальная цель команды.',
        leadReviewedAt: '2026-04-14T12:00:00.000Z',
        leadReviewedBy: 'Тигран Г.',
      },
      evaluation: {
        selfScore: 4,
        leadScore: null,
        selfComment: 'MVP движется в срок, нужно добить реестр и историю изменений.',
        leadComment: '',
        lastReviewedAt: null,
      },
    }),
    createEmptyGoal({
      year: 2026,
      quarter: 'Q2',
      platform: 'Регресс',
      owner: 'Тигран Г.',
      participants: ['QA stream', 'Дмитрий И.'],
      title: 'Перевести критические релизные чек-листы из Docs в управляемый реестр',
      objective: 'Убрать ручной разнобой по целям команды регресса и привязать каждую цель к owner и финальной оценке.',
      successMetric: 'Все цели регресса по Q2 описаны в едином реестре и имеют квартальный review.',
      formationStatus: 'Есть риск по дисциплине обновления данных командами.',
      status: 'aligned',
      health: 'risk',
      priority: 'high',
      progress: 22,
      tags: ['регресс', 'процессы'],
      blockers: ['Нужно согласовать owner для части стримовых целей.'],
      plan: createPlanItems([
        'Подготовить шаблон цели для регресса',
        'Разложить owner и участников по стримам',
        'Согласовать политику квартальной оценки',
      ]),
      updates: [
        createGoalUpdate('Подготовлен шаблон цели под релизные направления.', 'Тигран Г.', 'system'),
      ],
      approval: {
        status: 'pending_lead',
        ownerComment: 'Нужно подтвердить состав stream owner и правила quarterly review.',
        ownerSubmittedAt: '2026-04-18T09:20:00.000Z',
        ownerSubmittedBy: 'Тигран Г.',
        leadComment: '',
        leadReviewedAt: null,
        leadReviewedBy: null,
      },
    }),
    createEmptyGoal({
      year: 2026,
      quarter: 'Q2',
      platform: 'BI',
      owner: 'Анна Б.',
      participants: ['BI team', 'Lead QA'],
      title: 'Сделать обзорную витрину по квартальным целям и их оценке',
      objective: 'Показывать прогресс, оценки и риски по командам в одном квартальном разрезе.',
      successMetric: 'На конец квартала lead получает одну витрину с оценкой исполнения по платформам.',
      formationStatus: 'Согласован основной состав агрегатов.',
      status: 'review',
      health: 'on_track',
      priority: 'medium',
      progress: 76,
      tags: ['аналитика', 'витрина'],
      blockers: [],
      plan: createPlanItems([
        'Собрать агрегаты по owner, платформе и статусу',
        'Отрисовать квартальный срез и сравнение по платформам',
        'Сделать экспорт на квартальный review',
      ]),
      updates: [
        createGoalUpdate('Срез по owner и платформам собран.', 'Анна Б.', 'progress'),
      ],
      approval: {
        status: 'approved',
        ownerComment: 'Цель готова, метрики и контур витрины согласованы.',
        ownerSubmittedAt: '2026-04-10T10:00:00.000Z',
        ownerSubmittedBy: 'Анна Б.',
        leadComment: 'Согласовано, можно вести в квартале.',
        leadReviewedAt: '2026-04-10T13:10:00.000Z',
        leadReviewedBy: 'Дмитрий И.',
      },
      evaluation: {
        selfScore: 4,
        leadScore: 4,
        selfComment: 'Витрина уже показывает квартальные оценки, осталось добить экспорт.',
        leadComment: 'Хорошая траектория, нужно закрыть экспорт и доступы.',
        lastReviewedAt: '2026-04-18T11:00:00.000Z',
      },
    }),
    createEmptyGoal({
      year: 2026,
      quarter: 'Q2',
      platform: 'Мобильная команда',
      owner: 'Саша К.',
      participants: ['iOS lead', 'Android lead'],
      title: 'Каталог инициатив мобильной команды с единым owner и планом',
      objective: 'Собрать мобильные инициативы в одном квартальном контуре и убрать разрозненные документы.',
      successMetric: 'Не менее 90% мобильных квартальных целей имеют owner, план и статус без внешних файлов.',
      formationStatus: 'Не хватает owner для части инициатив AppGrowth.',
      status: 'blocked',
      health: 'critical',
      priority: 'high',
      progress: 15,
      tags: ['mobile', 'ownership'],
      blockers: ['Owner части целей не назначен.', 'Не согласован набор обязательных полей для финальной оценки.'],
      plan: createPlanItems([
        'Собрать владельцев инициатив',
        'Согласовать структуру quarterly review',
        'Перевести карточки мобильных целей в единый шаблон',
      ]),
      updates: [
        createGoalUpdate('Зависли на согласовании владельцев AppGrowth.', 'Саша К.', 'status'),
      ],
      approval: {
        status: 'rework',
        ownerComment: 'Цель сформирована, но owner по части инициатив пока не закреплен.',
        ownerSubmittedAt: '2026-04-16T08:40:00.000Z',
        ownerSubmittedBy: 'Саша К.',
        leadComment: 'Вернуть на доработку: закрепить owner и убрать пустые направления.',
        leadReviewedAt: '2026-04-16T11:25:00.000Z',
        leadReviewedBy: 'Дмитрий И.',
      },
    }),
    createEmptyGoal({
      year: 2026,
      quarter: 'Q2',
      platform: 'Инфраструктура',
      owner: 'Илья С.',
      participants: ['DevOps', 'Security'],
      title: 'Собрать процесс апрува и архива целей по кварталам',
      objective: 'Сделать понятный цикл согласования цели, ее исполнения, оценки и последующего архива.',
      successMetric: 'После окончания квартала все цели переводятся в финальный статус и доступны по истории.',
      formationStatus: 'Требуется формализовать статус review и критерии архива.',
      status: 'draft',
      health: 'on_track',
      priority: 'medium',
      progress: 8,
      tags: ['workflow', 'архив'],
      blockers: [],
      plan: createPlanItems([
        'Описать workflow цели по стадиям',
        'Согласовать критерии архива и закрытия',
        'Привязать review к квартальной оценке',
      ]),
      updates: [
        createGoalUpdate('Черновик workflow собран.', 'Илья С.', 'system'),
      ],
    }),
  ];

  return goals.map(goal => ({
    ...goal,
    updatedAt: goal.updates[0]?.at || goal.updatedAt,
  }));
}

function defaultSettings(): GoalsPortalSettings {
  const roles: GoalsPortalRoleDefinition[] = [
    {
      key: 'admin',
      label: 'Администратор',
      description: 'Видит все цели, управляет настройками и доступами.',
      permissions: [...GOALS_PORTAL_PERMISSION_KEYS],
    },
    {
      key: 'lead',
      label: 'Lead',
      description: 'Ведёт цели своей команды, согласует и оценивает.',
      permissions: [
        'view_team_goals',
        'view_own_goals',
        'create_goal',
        'edit_team_goals',
        'review_goals',
        'lead_review',
        'add_goal_updates',
      ],
    },
    {
      key: 'owner',
      label: 'Owner',
      description: 'Создаёт и ведёт свои цели, заполняет self-review.',
      permissions: [
        'view_own_goals',
        'create_goal',
        'edit_own_goals',
        'self_review',
        'add_goal_updates',
      ],
    },
    {
      key: 'participant',
      label: 'Участник',
      description: 'Видит цели, в которых участвует, и может оставлять обновления.',
      permissions: [
        'view_assigned_goals',
        'add_goal_updates',
      ],
    },
    {
      key: 'viewer',
      label: 'Наблюдатель',
      description: 'Имеет только чтение всех целей.',
      permissions: ['view_all_goals'],
    },
  ];
  const members: GoalsPortalMember[] = [
    { id: 'member-dmitrii', name: 'Дмитрий И.', role: 'admin', leadId: null, active: true },
    { id: 'member-tigran', name: 'Тигран Г.', role: 'lead', leadId: 'member-dmitrii', active: true },
    { id: 'member-anna', name: 'Анна Б.', role: 'owner', leadId: 'member-dmitrii', active: true },
    { id: 'member-sasha', name: 'Саша К.', role: 'owner', leadId: 'member-tigran', active: true },
    { id: 'member-ilya', name: 'Илья С.', role: 'owner', leadId: 'member-dmitrii', active: true },
    { id: 'member-maria', name: 'Мария Ф.', role: 'participant', leadId: 'member-dmitrii', active: true },
  ];
  return {
    quarters: [...QUARTERS],
    platforms: ['Портал', 'Регресс', 'BI', 'Мобильная команда', 'Инфраструктура'],
    ownerDirectory: ['Дмитрий И.', 'Тигран Г.', 'Анна Б.', 'Саша К.', 'Илья С.'],
    statuses: DEFAULT_STATUS_ORDER.map(key => ({
      key,
      label: GOAL_STATUS_META[key].label,
      description: GOAL_STATUS_META[key].description,
      color: GOAL_STATUS_META[key].color,
    })),
    workflow: GOALS_PORTAL_FLOW.map(step => ({
      id: makeId('flow'),
      title: step.title,
      text: step.text,
    })),
    scoringScale: SCORING_SCALE.map(item => ({
      score: item.score,
      title: item.title,
      description: item.description,
    })),
    roles,
    members,
  };
}

function normalizeStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback];
  const items = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : [...fallback];
}

function normalizeStatuses(value: unknown, fallback: GoalStatusDefinition[]) {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }));
  const items = value
    .map(item => {
      const raw = item as Partial<GoalStatusDefinition>;
      const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
      const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
      const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
      const color = raw?.color;
      if (!key || !label) return null;
      if (!['gray', 'blue', 'yellow', 'green', 'red', 'purple'].includes(String(color))) return null;
      return {
        key,
        label,
        description,
        color: color as GoalStatusDefinition['color'],
      };
    })
    .filter((item): item is GoalStatusDefinition => Boolean(item));
  return items.length ? items : fallback.map(item => ({ ...item }));
}

function normalizeWorkflow(value: unknown, fallback: GoalFlowStep[]) {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }));
  const items = value
    .map(item => {
      const raw = item as Partial<GoalFlowStep>;
      const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
      const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
      const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : makeId('flow');
      if (!title || !text) return null;
      return { id, title, text };
    })
    .filter((item): item is GoalFlowStep => Boolean(item));
  return items.length ? items : fallback.map(item => ({ ...item }));
}

function normalizeScoringScale(value: unknown, fallback: GoalScoreDefinition[]) {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }));
  const items = value
    .map(item => {
      const raw = item as Partial<GoalScoreDefinition>;
      const score = Number(raw?.score);
      const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
      const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
      if (!Number.isFinite(score) || score < 1 || score > 5 || !title || !description) return null;
      return { score, title, description };
    })
    .filter((item): item is GoalScoreDefinition => Boolean(item))
    .sort((left, right) => left.score - right.score);
  return items.length ? items : fallback.map(item => ({ ...item }));
}

function normalizePermissions(value: unknown, fallback: GoalsPortalPermission[]) {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.filter((item): item is GoalsPortalPermission =>
    typeof item === 'string' && GOALS_PORTAL_PERMISSION_KEYS.includes(item as GoalsPortalPermission),
  );
  return items.length ? Array.from(new Set(items)) : [...fallback];
}

function normalizeRoles(value: unknown, fallback: GoalsPortalRoleDefinition[]) {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item, permissions: [...item.permissions] }));
  const items = value
    .map(item => {
      const raw = item as Partial<GoalsPortalRoleDefinition>;
      const key = typeof raw?.key === 'string' ? raw.key.trim() as GoalsPortalRole : null;
      if (!key || !GOALS_PORTAL_ROLE_KEYS.includes(key)) return null;
      const fallbackRole = fallback.find(role => role.key === key);
      return {
        key,
        label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : fallbackRole?.label || key,
        description: typeof raw?.description === 'string' ? raw.description.trim() : fallbackRole?.description || '',
        permissions: normalizePermissions(raw?.permissions, fallbackRole?.permissions || []),
      };
    })
    .filter((item): item is GoalsPortalRoleDefinition => Boolean(item));
  return items.length ? items : fallback.map(item => ({ ...item, permissions: [...item.permissions] }));
}

function normalizeMembers(value: unknown, fallback: GoalsPortalMember[]) {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }));
  const items = value
    .map(item => {
      const raw = item as Partial<GoalsPortalMember>;
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      const role = typeof raw?.role === 'string' ? raw.role.trim() as GoalsPortalRole : null;
      if (!name || !role || !GOALS_PORTAL_ROLE_KEYS.includes(role)) return null;
      return {
        id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : makeId('member'),
        name,
        role,
        leadId: typeof raw?.leadId === 'string' && raw.leadId.trim() ? raw.leadId.trim() : null,
        active: raw?.active !== false,
      };
    })
    .filter((item): item is GoalsPortalMember => Boolean(item));
  return items.length ? items : fallback.map(item => ({ ...item }));
}

function normalizeSettings(raw: Partial<GoalsPortalSettings> | undefined): GoalsPortalSettings {
  const fallback = defaultSettings();
  const roles = normalizeRoles(raw?.roles, fallback.roles);
  const members = normalizeMembers(raw?.members, fallback.members).map(member => {
    if (member.leadId && !member.leadId.trim()) return { ...member, leadId: null };
    return member;
  });
  const leadIds = new Set(members.map(member => member.id));
  return {
    quarters: normalizeStringList(raw?.quarters, fallback.quarters),
    platforms: normalizeStringList(raw?.platforms, fallback.platforms),
    ownerDirectory: normalizeStringList(
      raw?.ownerDirectory,
      Array.from(new Set([
        ...fallback.ownerDirectory,
        ...members
          .filter(member => member.role === 'admin' || member.role === 'lead' || member.role === 'owner')
          .map(member => member.name),
      ])),
    ),
    statuses: normalizeStatuses(raw?.statuses, fallback.statuses),
    workflow: normalizeWorkflow(raw?.workflow, fallback.workflow),
    scoringScale: normalizeScoringScale(raw?.scoringScale, fallback.scoringScale),
    roles,
    members: members.map(member => ({
      ...member,
      leadId: member.leadId && leadIds.has(member.leadId) && member.leadId !== member.id ? member.leadId : null,
    })),
  };
}

function normalizePlan(plan: GoalRecord['plan']) {
  return Array.isArray(plan)
    ? plan
        .map(item => ({
          id: typeof item?.id === 'string' && item.id ? item.id : makeId('plan'),
          text: typeof item?.text === 'string' ? item.text : '',
          done: Boolean(item?.done),
        }))
        .filter(item => item.text.trim())
    : [];
}

function normalizeUpdates(updates: GoalRecord['updates']): GoalUpdateEntry[] {
  return Array.isArray(updates)
    ? updates
        .map((item): GoalUpdateEntry => {
          const source: GoalUpdateSource =
            item?.source === 'owner_comment' || item?.source === 'lead_comment'
              ? item.source
              : 'timeline';
          return {
            id: typeof item?.id === 'string' && item.id ? item.id : makeId('upd'),
            at: typeof item?.at === 'string' ? item.at : nowIso(),
            author: typeof item?.author === 'string' && item.author ? item.author : 'system',
            text: typeof item?.text === 'string' ? item.text : '',
            type: (item?.type as GoalUpdateType) || 'note',
            source,
          };
        })
        .filter(item => item.text.trim())
    : [];
}

function normalizeGoal(raw: Partial<GoalRecord>): GoalRecord {
  const base = createEmptyGoal();
  const goal = { ...base, ...raw };
  return {
    ...goal,
    year: Number(raw.year || base.year),
    quarter: typeof raw.quarter === 'string' && raw.quarter.trim() ? raw.quarter : base.quarter,
    status: typeof raw.status === 'string' && raw.status.trim() ? raw.status : base.status,
    health: raw.health && raw.health in GOAL_HEALTH_META ? raw.health : base.health,
    priority: raw.priority && raw.priority in GOAL_PRIORITY_META ? raw.priority : base.priority,
    participants: Array.isArray(raw.participants) ? raw.participants.filter(Boolean) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    blockers: Array.isArray(raw.blockers) ? raw.blockers.filter(Boolean) : [],
    plan: normalizePlan(raw.plan as GoalRecord['plan']),
    updates: normalizeUpdates(raw.updates as GoalRecord['updates']),
    progress: Math.max(0, Math.min(100, Number(raw.progress ?? base.progress))),
    approval: {
      status: raw.approval?.status && raw.approval.status in GOAL_APPROVAL_META ? raw.approval.status : base.approval.status,
      ownerComment: raw.approval?.ownerComment || '',
      ownerSubmittedAt: raw.approval?.ownerSubmittedAt || null,
      ownerSubmittedBy: raw.approval?.ownerSubmittedBy || null,
      leadComment: raw.approval?.leadComment || '',
      leadReviewedAt: raw.approval?.leadReviewedAt || null,
      leadReviewedBy: raw.approval?.leadReviewedBy || null,
    },
    evaluation: {
      selfScore: raw.evaluation?.selfScore ?? null,
      leadScore: raw.evaluation?.leadScore ?? null,
      selfComment: raw.evaluation?.selfComment || '',
      leadComment: raw.evaluation?.leadComment || '',
      lastReviewedAt: raw.evaluation?.lastReviewedAt || null,
    },
    createdAt: raw.createdAt || base.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt || base.updatedAt,
  };
}

function createDefaultState(): GoalsPortalState {
  return {
    goals: createSeedGoals(),
    settings: defaultSettings(),
  };
}

function compactStateForStorage(state: GoalsPortalState): GoalsPortalState {
  return {
    ...state,
    goals: state.goals.map(goal => ({
      ...goal,
      title: goal.title.slice(0, 220),
      objective: goal.objective.slice(0, 800),
      successMetric: goal.successMetric.slice(0, 240),
      formationStatus: goal.formationStatus.slice(0, 280),
      blockers: goal.blockers.slice(0, 6).map(item => item.slice(0, 180)),
      tags: goal.tags.slice(0, 10).map(item => item.slice(0, 48)),
      plan: goal.plan.slice(0, 16).map(item => ({
        ...item,
        text: item.text.slice(0, 240),
      })),
      updates: goal.updates.slice(0, 6).map(item => ({
        ...item,
        text: item.text.slice(0, 320),
      })),
    })),
  };
}

export function loadGoalsPortalState(): GoalsPortalState {
  if (typeof window === 'undefined') return createDefaultState();
  try {
    const raw =
      window.localStorage.getItem(GOALS_PORTAL_STORAGE_KEY) ||
      window.sessionStorage.getItem(GOALS_PORTAL_FALLBACK_STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw) as Partial<GoalsPortalState>;
    return {
      goals: Array.isArray(parsed.goals) && parsed.goals.length ? parsed.goals.map(normalizeGoal) : createSeedGoals(),
      settings: normalizeSettings(parsed.settings),
    };
  } catch {
    return createDefaultState();
  }
}

export function saveGoalsPortalState(state: GoalsPortalState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GOALS_PORTAL_STORAGE_KEY, JSON.stringify(state));
    window.sessionStorage.removeItem(GOALS_PORTAL_FALLBACK_STORAGE_KEY);
  } catch {
    const compacted = compactStateForStorage(state);
    try {
      window.localStorage.setItem(GOALS_PORTAL_STORAGE_KEY, JSON.stringify(compacted));
      window.sessionStorage.removeItem(GOALS_PORTAL_FALLBACK_STORAGE_KEY);
    } catch {
      try {
        window.localStorage.removeItem(GOALS_PORTAL_STORAGE_KEY);
        window.sessionStorage.setItem(GOALS_PORTAL_FALLBACK_STORAGE_KEY, JSON.stringify(compacted));
      } catch {
        // Last resort: storage is unavailable or full in both scopes.
        // Swallow the error so the portal UI keeps working in memory.
      }
    }
  }
}

export function cloneGoal(goal: GoalRecord): GoalRecord {
  const cloned = normalizeGoal({
    ...goal,
    id: makeId('goal'),
    title: `${goal.title} (копия)`,
    updates: [
      createGoalUpdate('Цель продублирована из существующей карточки.', 'portal', 'system'),
      ...goal.updates,
    ],
  });
  return cloned;
}

export function exportGoalsCsv(goals: GoalRecord[], settings?: GoalsPortalSettings) {
  const statuses = settings?.statuses ?? defaultSettings().statuses;
  const statusMap = Object.fromEntries(statuses.map(item => [item.key, item])) as Record<string, GoalStatusDefinition>;
  const rows = goals.map(goal => [
    goal.id,
    goal.year,
    goal.quarter,
    goal.platform,
    goal.owner,
    goal.participants.join(', '),
    goal.title,
    goal.objective,
    goal.successMetric,
    statusMap[goal.status]?.label || goal.status,
    GOAL_HEALTH_META[goal.health].label,
    goal.priority,
    goal.progress,
    GOAL_APPROVAL_META[goal.approval.status].label,
    goal.evaluation.selfScore ?? '',
    goal.evaluation.leadScore ?? '',
  ]);
  const header = [
    'id',
    'year',
    'quarter',
    'platform',
    'owner',
    'participants',
    'title',
    'objective',
    'success_metric',
    'status',
    'health',
    'priority',
    'progress',
    'approval_status',
    'self_score',
    'lead_score',
  ];
  return [header, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
