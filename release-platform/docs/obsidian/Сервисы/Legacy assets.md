---
tags:
  - service
  - legacy
updated: 2026-05-04
---

# Legacy assets

## Роль в проекте

Старые HTML-инструменты, proxy scripts, ML assets и RBAC config. React shell сохраняет совместимость с ними через `/legacy/*`.

## Код

- Assets: `legacy/*`
- Bridge: `vite.config.ts`, plugin `legacy-assets-bridge`
- URL builder: `src/services/legacy.ts`
- Frame: `src/components/layout/LegacyModuleFrame.tsx`

## Что лежит в legacy

- HTML версии модулей: `Графики.html`, `Запуск релиза.html`, `УВУ.html`, etc.
- `proxy-standalone.js`
- `rb_roles_access.json`
- ML assets: CatBoost files.
- Docker/nginx config.
- Helper scripts.

## Как работает bridge

- Dev server отдает `/legacy/<file>` напрямую из `legacyRoot`.
- Build копирует разрешенные extensions в `dist/legacy`.
- Для кириллических имен файлов создается Unicode-normalized alias.

## Используют

- Shell topbar "legacy" button.
- [[Learning Hub]] как legacy-only модуль.
- Старые modules как fallback для большинства экранов.

## Риски

- Нельзя переименовывать legacy HTML без обновления `legacyId` в `src/config/modules.tsx`.
- Query `?module=<legacyId>` используется для deep links.
- Legacy localStorage keys синхронизируются в `src/services/legacy.ts`.
