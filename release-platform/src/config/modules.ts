export type ModuleId =
  | 'dashboard'
  | 'goals'
  | 'vangovat'
  | 'createrun'
  | 'launch'
  | 'chp'
  | 'uvu'
  | 'biusers'
  | 'devices'
  | 'charts'
  | 'swat'
  | 'ytcopy'
  | 'wiki'
  | 'band'
  | 'learnhub'
  | 'access';

export interface ModuleDefinition {
  id: ModuleId;
  legacyId: string;
  label: string;
  sub: string;
  section: 'Обзор' | 'Релизы' | 'Аналитика' | 'Инструменты';
  icon: string;
  badge?: { text: string; color: 'green' | 'red' | 'purple' };
  explicitAccess?: boolean;
  superadminOnly?: boolean;
  openNewTab?: boolean;
  showLegacyButton?: boolean;
}

export const MODULES: ModuleDefinition[] = [
  {
    id: 'dashboard',
    legacyId: 'dashboard_run_module.html',
    label: 'Дашборд + РАН-отчёт',
    sub: 'Готовность релиза · Allure · покрытие и прогресс',
    section: 'Обзор',
    icon: '⬡',
    badge: { text: 'live', color: 'green' },
  },
  {
    id: 'goals',
    legacyId: 'goals-team-portal',
    label: 'Цели команды',
    sub: 'Кварталы · владельцы · план · оценка исполнения',
    section: 'Инструменты',
    icon: '◫',
    showLegacyButton: false,
  },
  {
    id: 'vangovat',
    legacyId: 'Ванговатор.html',
    label: 'Ванговатор',
    sub: 'Прогноз бэклога и результатов прогонов',
    section: 'Релизы',
    icon: '◐',
  },
  {
    id: 'createrun',
    legacyId: 'Создание рана.html',
    label: 'Создание рана',
    sub: 'Allure TestOps',
    section: 'Релизы',
    icon: '＋',
  },
  {
    id: 'launch',
    legacyId: 'Запуск релиза.html',
    label: 'Запуск релиза',
    sub: 'Мажорный · ХФ · NAPI · RuStore',
    section: 'Релизы',
    icon: '▷',
    badge: { text: '!', color: 'red' },
    showLegacyButton: false,
  },
  {
    id: 'chp',
    legacyId: 'Сбор ЧП.html',
    label: 'Сбор ЧП',
    sub: 'Чрезвычайные происшествия',
    section: 'Аналитика',
    icon: '⚑',
  },
  {
    id: 'uvu',
    legacyId: 'УВУ.html',
    label: 'Расчёт uWu',
    sub: 'Управление версионными обновлениями',
    section: 'Аналитика',
    icon: '↗',
  },
  {
    id: 'biusers',
    legacyId: 'BiUser.html',
    label: 'Пользователи по версиям',
    sub: 'Распределение по версиям · iOS + Android',
    section: 'Аналитика',
    icon: '◎',
  },
  {
    id: 'devices',
    legacyId: 'Популярные устройства.html',
    label: 'Популярные устройства',
    sub: 'Аудитория по моделям',
    section: 'Аналитика',
    icon: '▣',
  },
  {
    id: 'charts',
    legacyId: 'Графики.html',
    label: 'Графики',
    sub: 'Тренды · ЧП · ML · Версии',
    section: 'Аналитика',
    icon: '◈',
  },
  {
    id: 'swat',
    legacyId: 'SWAT релиз.html',
    label: 'SWAT релиз',
    sub: 'Дежурные · Потоки · Расписание',
    section: 'Аналитика',
    icon: '◆',
  },
  {
    id: 'ytcopy',
    legacyId: 'Копирование данных из YT.html',
    label: 'Epic / User Story',
    sub: 'Елена · Надежда · Дарья · релизные тексты',
    section: 'Инструменты',
    icon: '⤵',
  },
  {
    id: 'wiki',
    legacyId: 'youtrack-wiki-v4.html',
    label: 'Wiki Intelligence v4',
    sub: 'AI-поиск по базе знаний · Wiki · YT · GitLab',
    section: 'Инструменты',
    icon: '✦',
    badge: { text: 'AI', color: 'purple' },
    superadminOnly: true,
  },
  {
    id: 'band',
    legacyId: 'band-android-rollout.html',
    label: 'Band rollout report',
    sub: 'Band cookies · proxy · RuStore / AppGallery',
    section: 'Инструменты',
    icon: '☰',
    explicitAccess: true,
  },
  {
    id: 'learnhub',
    legacyId: 'LearnHub-Portal.html',
    label: 'Learning Hub',
    sub: 'Обучение и внутренний портал',
    section: 'Инструменты',
    icon: '⌘',
    explicitAccess: true,
    openNewTab: true,
  },
  {
    id: 'access',
    legacyId: 'access-management',
    label: 'Управление доступом',
    sub: 'Пользователи · роли · права на модули',
    section: 'Инструменты',
    icon: '⬡',
    superadminOnly: false,
    explicitAccess: true,
    showLegacyButton: false,
  },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map(module => [module.id, module])) as Record<ModuleId, ModuleDefinition>;

export const MODULE_BY_LEGACY_ID = Object.fromEntries(MODULES.map(module => [module.legacyId, module])) as Record<string, ModuleDefinition>;

const SECTION_ORDER: ModuleDefinition['section'][] = ['Обзор', 'Релизы', 'Аналитика', 'Инструменты'];

export const MODULE_SECTIONS: Array<{ label: ModuleDefinition['section']; items: ModuleDefinition[] }> = SECTION_ORDER.map(section => ({
  label: section,
  items: MODULES.filter(module => module.section === section),
}));
