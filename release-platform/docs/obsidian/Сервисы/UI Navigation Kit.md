---
tags:
  - release-platform
  - ui-kit
  - navigation
updated: 2026-05-05
---

# UI Navigation Kit

UI Navigation Kit - черновой слой для переиспользуемой навигации между микрофронтами и сервисами. Его задача - отделить визуальный sidebar от конкретного shell `Release Platform`, чтобы каждый фронт мог передавать свои внутренние ссылки, кнопки и сервисы через конфиг.

## Файлы

| Файл | Назначение |
|---|---|
| `src/components/navigation/NavigationSidebar.tsx` | Абстрактный sidebar-компонент: brand, секции, пункты меню, profile actions, точка подключения кнопки сервисов. |
| `src/components/layout/Sidebar.tsx` | Адаптер текущего shell: переводит `ModuleDefinition` в контракт `NavigationSidebarConfig`. |
| `src/components/layout/ServiceLauncher.tsx` | Встраиваемая менюшка сервисов: Learning Hub, Project и будущие внешние сервисы. |
| `src/navigation/sidebarMockApi.tsx` | Моковая API-прослойка с `fetch` interceptor для `/api/navigation/sidebar`. |
| `src/modules/ServiceGateway/index.tsx` | Отдельный модуль первой разводящей: конфиг сервисов, hero, карточки выбора и auth-target для выбранного сервиса. |

## Первая разводящая страница

Стартовый модуль shell - `home` (`legacyId: service-home`) в `src/config/modules.tsx`. Он отображает `ServiceGateway` и становится первым экраном после авторизации, если в URL нет явного `?module=...`.

Во время авторизации первым экраном тоже показывается `ServiceGateway`: `AuthScreen` в `src/App.tsx` передаёт форму входа через `authPanel`. Поэтому пользователь до входа сразу видит разводку `Dashboard / Learning Hub / Project`, а не отдельную абстрактную форму входа.

Auth-версия страницы использует hero-заголовок в стиле старой авторизации: `Управляй релизами уверенно`. Заголовок `Выберите рабочий контур` оставлен только как fallback для обычного режима компонента. Форма авторизации стоит по центру экрана, а карточки выбора сервисов расположены под ней.

Логика:

- `Dashboard` открывается как внутренний модуль через `handleActivate('dashboard')`.
- До авторизации выбор карточки запоминает `authTarget`; после успешного логина приложение открывает выбранный внутренний модуль или переводит на внешний сервис.
- До авторизации выбор любой карточки подсвечивает её и меняет заголовок/описание в центральной auth-карточке: пользователь сразу видит, что делает выбранный сервис.
- Auth-карточка имеет фиксированную минимальную высоту и постоянную зону действия, поэтому экран не прыгает при переключении между Dashboard и внешними сервисами.
- Наполнение разводящей задаётся в `SERVICE_GATEWAY_ITEMS`. Туда можно добавлять внутренние модули, внешние сервисы, новые тексты hero и описание карточек.
- `ServiceLauncher` в sidebar остаётся отдельным меню сервисов и продолжает брать данные из `sidebarMockApi.tsx`.
- Доступ к стартовой странице добавлен через `service-home` в RBAC (`legacy/rb_roles_access.json` и default role access).

## Контракт разводящей

Главный контракт - `ServiceGatewayItem`:

- `id` - стабильный идентификатор сервиса.
- `label` - название карточки.
- `href` - человекочитаемая ссылка для карточки/документации.
- `color` и `icon` - визуал карточки.
- `cardDescription` - короткое описание в карточке выбора.
- `title`, `description` - заголовок и описание в auth-карточке.
- `headline`, `accent`, `headlineSuffix`, `subtitle` - hero-текст выбранного сервиса.
- `authTarget` - что делать после авторизации:
  - `{ type: 'module', moduleId: 'dashboard' }` - открыть внутренний модуль.
  - `{ type: 'external', href: 'https://...' }` - перейти во внешний сервис.

Пример добавления нового сервиса:

```tsx
{
  id: 'retro',
  label: 'Retro',
  href: '/retro',
  color: 'linear-gradient(135deg,#334155,#0F766E)',
  icon: <Icon />,
  cardDescription: 'Ретро команды, action items и история решений.',
  title: 'Retro',
  headline: 'Улучшай',
  accent: 'процессы',
  headlineSuffix: 'регулярно',
  subtitle: 'Retro помогает фиксировать выводы, решения и follow-up команды.',
  description: 'После авторизации откроется рабочее пространство ретро.',
  authTarget: { type: 'external', href: '/retro' },
}
```

## Контракт компонента

Главный контракт - `NavigationSidebarConfig`:

- `brand` - заголовок, mark и версия.
- `sections` - группы пунктов sidebar.
- `activeItemId` - текущий активный пункт.
- `services` - список сервисов для кнопки `ServiceLauncher` в header sidebar.
- `profile` - имя пользователя и роль.
- `profileActions` - действия профиля, например настройки и выход.

Пункты меню описываются через `NavigationSidebarItem`:

- `id` - стабильный идентификатор.
- `label` - текст кнопки.
- `href` - внутренняя или внешняя ссылка.
- `icon` - React-иконка конкретного фронта.
- `badge` - статусная плашка.
- `external` - не перехватывать click, открыть как обычную ссылку.

## Как подключать в новом фронте

Внутренние ссылки можно указывать прямо в коде фронта:

```tsx
<NavigationSidebar
  config={{
    brand: { title: 'My Front', mark: 'MF', version: 'v1' },
    activeItemId: activeId,
    sections: [
      {
        id: 'main',
        label: 'Основное',
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: <Icon /> },
          { id: 'settings', label: 'Settings', href: '/settings', icon: <Icon /> },
        ],
      },
    ],
    services,
    profile,
    profileActions,
  }}
  onNavigate={item => navigate(item.href || '/')}
/>
```

## Mock API

Сейчас API специально замокан без сетевых запросов:

- endpoint: `/api/navigation/sidebar`;
- установка: `installSidebarNavigationMockApi()`;
- чтение: `fetchSidebarNavigationConfig()`;
- данные лежат в `MOCK_SIDEBAR_NAVIGATION`.
- `services` можно наполнять любыми сервисами: `id`, `label`, `href`, `color`, `icon`, `iconLabel`, `target`.

Interceptor перехватывает только `/api/navigation/sidebar`, остальные `fetch` уходят в оригинальный `window.fetch`.

## Подключение сервисов

В текущем shell сервисы приходят через mock API и попадают в `ServiceLauncher`:

```ts
services: [
  {
    id: 'learnhub',
    label: 'Learning\nHub',
    href: 'https://releaseteamwb.ru/LearnHub-Portal.html',
    color: 'linear-gradient(135deg,#7C3AED,#9B5CFF)',
    icon: 'learnhub',
  },
  {
    id: 'project',
    label: 'Project',
    href: 'http://10.29.47.57',
    color: 'linear-gradient(135deg,#0EA5E9,#0369A1)',
    icon: 'project',
  },
]
```

Для конкретного фронта можно не использовать mock API и передать в `NavigationSidebarConfig.services` готовый `ServiceLauncherItem[]` с любыми React-иконками. Это основной механизм подключения кнопки сервисов и наполнения её меню.

## Правила развития

- Визуальную разметку sidebar менять в `NavigationSidebar`, а не в shell-адаптерах.
- Конкретный фронт может задавать свои `sections`, `services` и `profileActions`.
- Если появится реальный backend endpoint, менять нужно только `sidebarMockApi.tsx` или заменить его на настоящий client.
- `ServiceLauncher` должен оставаться отдельным компонентом, чтобы его можно было вставить в любой navigation header.

## Связанные заметки

- [[01 - Карта микрофронтов]]
- [[02 - Карта сервисов и интеграций]]
- [[05 - Рефакторинг]]
