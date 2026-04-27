import React from 'react';

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
  | 'releaseAnalysis'
  | 'chpRange'
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
  icon: React.ReactNode;
  badge?: { text: string; color: 'green' | 'red' | 'purple' };
  explicitAccess?: boolean;
  superadminOnly?: boolean;
  openNewTab?: boolean;
  showLegacyButton?: boolean;
}

// ── Icons (14×14, currentColor, viewBox 0 0 22 22) ──────────────────────────

const icDashboard = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="14" width="3.5" height="6" rx="1" fill="currentColor" fillOpacity=".85" stroke="none"/>
    <rect x="7" y="10" width="3.5" height="10" rx="1" fill="currentColor" fillOpacity=".85" stroke="none"/>
    <rect x="12" y="12" width="3.5" height="8" rx="1" fill="currentColor" fillOpacity=".85" stroke="none"/>
    <polyline points="1,9 4,9 6,5 8,11 10,7 13,9 16,9" strokeWidth="1.5"/>
  </svg>
);

const icVangovat = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="10" r="7"/>
    <path d="M8 20h6M11 20v-3" strokeWidth="1.3" strokeOpacity=".55"/>
    <path d="M8.5 10c0-1.38 1.12-2.5 2.5-2.5" strokeOpacity=".65"/>
    <circle cx="15.5" cy="6.5" r="1" fill="currentColor" stroke="none" fillOpacity=".75"/>
    <circle cx="17.5" cy="3.5" r=".6" fill="currentColor" stroke="none" fillOpacity=".5"/>
  </svg>
);

const icCreateRun = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2v7L3.5 16.5A2 2 0 0 0 5.3 19.5h11.4a2 2 0 0 0 1.8-3L14 9V2"/>
    <path d="M7 2h8"/>
    <path d="M16 4h4M18 2v4" strokeWidth="1.8"/>
  </svg>
);

const icLaunch = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2C11 2 16 5 16 11l-5 8-5-8C6 5 11 2 11 2z" fill="currentColor" fillOpacity=".12"/>
    <circle cx="11" cy="10" r="2" fill="currentColor" stroke="none" fillOpacity=".85"/>
    <path d="M8 14.5l-2.5 2.5M14 14.5l2.5 2.5" strokeOpacity=".45" strokeWidth="1.3"/>
  </svg>
);

const icChp = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 3C8.24 3 6 5.24 6 8v5l-1.5 2.5h13L16 13V8c0-2.76-2.24-5-5-5z" fill="currentColor" fillOpacity=".1"/>
    <path d="M9 18.5a2 2 0 0 0 4 0" strokeOpacity=".7"/>
    <circle cx="17.5" cy="5" r="2" fill="currentColor" stroke="none" fillOpacity=".75"/>
  </svg>
);

const icUvu = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="14" width="16" height="3" rx="1.5" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="1.4" strokeOpacity=".85"/>
    <rect x="3" y="9.5" width="13" height="3" rx="1.5" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="1.4" strokeOpacity=".6"/>
    <rect x="3" y="5" width="9" height="3" rx="1.5" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.4" strokeOpacity=".4"/>
    <path d="M18 6l2.5 2.5-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const icBiUsers = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="7" r="2.8"/>
    <path d="M2 19c0-3.31 2.69-6 6-6s6 2.69 6 6" strokeOpacity=".8"/>
    <circle cx="16" cy="7" r="2.2" strokeOpacity=".65"/>
    <path d="M16 12c2.5 0 4.5 2 4.5 4.5" strokeOpacity=".5"/>
  </svg>
);

const icDevices = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="10" height="18" rx="2.5" fill="currentColor" fillOpacity=".08"/>
    <circle cx="11" cy="17.5" r=".9" fill="currentColor" stroke="none" fillOpacity=".75"/>
    <path d="M8.5 9h1.5M8.5 11h3M8.5 13h2" strokeOpacity=".65" strokeWidth="1.3"/>
  </svg>
);

const icCharts = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="12" width="4" height="8" rx="1.2" fill="currentColor" fillOpacity=".3"/>
    <rect x="8" y="7" width="4" height="13" rx="1.2" fill="currentColor" fillOpacity=".52"/>
    <rect x="14" y="10" width="4" height="10" rx="1.2" fill="currentColor" fillOpacity=".38"/>
    <polyline points="2,10 6,6 10,8 14,3 20,5" stroke="currentColor" strokeWidth="1.8" fill="none"/>
    <circle cx="14" cy="3" r="1.3" fill="currentColor" stroke="none" fillOpacity=".9"/>
  </svg>
);

const icSwat = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2L4 5v6c0 4.42 2.96 8.56 7 9.93C15.04 19.56 18 15.42 18 11V5L11 2z" fill="currentColor" fillOpacity=".1"/>
    <path d="M12.5 7l-3 5h4l-3 4" strokeWidth="1.8"/>
  </svg>
);

const icGoals = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="9" strokeOpacity=".32"/>
    <circle cx="11" cy="11" r="5.5" strokeOpacity=".6"/>
    <circle cx="11" cy="11" r="2" fill="currentColor" stroke="none" fillOpacity=".9"/>
    <path d="M14.5 3.5l3-1.5-1.5 3M14.5 3.5L11 7" strokeWidth="1.4"/>
  </svg>
);

const icYtCopy = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="14" height="17" rx="2.5" fill="currentColor" fillOpacity=".08"/>
    <path d="M6 9h8"/>
    <path d="M6 12h6" strokeOpacity=".65"/>
    <path d="M6 15h4" strokeOpacity=".45"/>
    <path d="M14 2v4M14 2l3 3-2.5.5" strokeWidth="1.4"/>
  </svg>
);

const icWiki = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5.5C4 5.5 7.5 4 11 5.5V19C7.5 17.5 4 19 4 19V5.5z" fill="currentColor" fillOpacity=".1"/>
    <path d="M11 5.5C11 5.5 14.5 4 18 5.5V19C14.5 17.5 11 19 11 19V5.5z" fill="currentColor" fillOpacity=".07" strokeOpacity=".6"/>
    <circle cx="17" cy="2" r="1.2" fill="currentColor" stroke="none" fillOpacity=".85"/>
    <circle cx="20" cy="4" r=".8" fill="currentColor" stroke="none" fillOpacity=".65"/>
    <circle cx="19" cy="7" r=".6" fill="currentColor" stroke="none" fillOpacity=".45"/>
    <path d="M17 2L20 4M20 4L19 7" strokeOpacity=".45" strokeWidth="1"/>
  </svg>
);

const icBand = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M2 13c0-5 4-9 9-9s9 4 9 9" strokeOpacity=".3"/>
    <path d="M5 13c0-3.31 2.69-6 6-6s6 2.69 6 6" strokeOpacity=".6"/>
    <path d="M8 13c0-1.66 1.34-3 3-3s3 1.34 3 3" strokeOpacity=".9"/>
    <circle cx="11" cy="13" r="1.6" fill="currentColor" stroke="none"/>
  </svg>
);

const icLearnHub = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
    <path d="M6 12v5c3.53 1.67 8.47 1.67 12 0v-5"/>
  </svg>
);

const icAccess = (
  <svg viewBox="0 0 22 22" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="7" cy="11" r="4.5"/>
    <circle cx="7" cy="11" r="1.8" fill="currentColor" stroke="none" fillOpacity=".25"/>
    <path d="M11 11h9" strokeWidth="1.7"/>
    <path d="M17 11v3" strokeWidth="1.5"/>
    <path d="M20 11v2" strokeWidth="1.5"/>
  </svg>
);

// ── Module registry ───────────────────────────────────────────────────────────

export const MODULES: ModuleDefinition[] = [
  {
    id: 'dashboard',
    legacyId: 'dashboard_run_module.html',
    label: 'Дашборд + РАН-отчёт',
    sub: 'Готовность релиза · Allure · покрытие и прогресс',
    section: 'Обзор',
    icon: icDashboard,
    badge: { text: 'live', color: 'green' },
  },
  {
    id: 'goals',
    legacyId: 'goals-team-portal',
    label: 'Цели команды',
    sub: 'Кварталы · владельцы · план · оценка исполнения',
    section: 'Инструменты',
    icon: icGoals,
    showLegacyButton: false,
  },
  {
    id: 'vangovat',
    legacyId: 'Ванговатор.html',
    label: 'Ванговатор',
    sub: 'Прогноз бэклога и результатов прогонов',
    section: 'Релизы',
    icon: icVangovat,
  },
  {
    id: 'createrun',
    legacyId: 'Создание рана.html',
    label: 'Создание рана',
    sub: 'Allure TestOps',
    section: 'Релизы',
    icon: icCreateRun,
  },
  {
    id: 'launch',
    legacyId: 'Запуск релиза.html',
    label: 'Запуск релиза',
    sub: 'Мажорный · ХФ · NAPI · RuStore',
    section: 'Релизы',
    icon: icLaunch,
    badge: { text: '!', color: 'red' },
    showLegacyButton: false,
  },
  {
    id: 'chp',
    legacyId: 'Сбор ЧП.html',
    label: 'ЧП по стримам',
    sub: 'Количество принесенных ЧП по Android/iOS',
    section: 'Аналитика',
    icon: icChp,
  },
  {
    id: 'uvu',
    legacyId: 'УВУ.html',
    label: 'Расчёт uWu',
    sub: 'Управление версионными обновлениями',
    section: 'Аналитика',
    icon: icUvu,
  },
  {
    id: 'biusers',
    legacyId: 'BiUser.html',
    label: 'Пользователи по версиям',
    sub: 'Распределение по версиям · iOS + Android',
    section: 'Аналитика',
    icon: icBiUsers,
  },
  {
    id: 'devices',
    legacyId: 'Популярные устройства.html',
    label: 'Популярные устройства',
    sub: 'Аудитория по моделям',
    section: 'Аналитика',
    icon: icDevices,
  },
  {
    id: 'charts',
    legacyId: 'Графики.html',
    label: 'Графики',
    sub: 'Тренды · ЧП · ML · Версии',
    section: 'Аналитика',
    icon: icCharts,
  },
  {
    id: 'releaseAnalysis',
    legacyId: 'Анализ релизов за квартал.html',
    label: 'Анализ релизов за квартал',
    sub: 'Хотфиксы · Android/iOS · квартальная таблица',
    section: 'Аналитика',
    icon: icCharts,
    showLegacyButton: false,
  },
  {
    id: 'chpRange',
    legacyId: 'ЧП за релиз диапазон.html',
    label: 'ЧП за релиз диапазон',
    sub: 'Детализация ЧП по релизам и стримам',
    section: 'Аналитика',
    icon: icChp,
    showLegacyButton: false,
  },
  {
    id: 'swat',
    legacyId: 'SWAT релиз.html',
    label: 'SWAT релиз',
    sub: 'Дежурные · Потоки · Расписание',
    section: 'Аналитика',
    icon: icSwat,
  },
  {
    id: 'ytcopy',
    legacyId: 'Копирование данных из YT.html',
    label: 'Epic / User Story',
    sub: 'Елена · Надежда · Дарья · релизные тексты',
    section: 'Инструменты',
    icon: icYtCopy,
  },
  {
    id: 'wiki',
    legacyId: 'youtrack-wiki-v4.html',
    label: 'Wiki Intelligence v4',
    sub: 'AI-поиск по базе знаний · Wiki · YT · GitLab',
    section: 'Инструменты',
    icon: icWiki,
    badge: { text: 'AI', color: 'purple' },
    superadminOnly: true,
  },
  {
    id: 'band',
    legacyId: 'band-android-rollout.html',
    label: 'Band rollout report',
    sub: 'Band cookies · proxy · RuStore / AppGallery',
    section: 'Инструменты',
    icon: icBand,
    explicitAccess: true,
  },
  {
    id: 'learnhub',
    legacyId: 'LearnHub-Portal.html',
    label: 'Learning Hub',
    sub: 'Обучение и внутренний портал',
    section: 'Инструменты',
    icon: icLearnHub,
    explicitAccess: true,
    openNewTab: true,
  },
  {
    id: 'access',
    legacyId: 'access-management',
    label: 'Управление доступом',
    sub: 'Пользователи · роли · права на модули',
    section: 'Инструменты',
    icon: icAccess,
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
