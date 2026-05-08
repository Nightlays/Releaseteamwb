---
tags:
  - microfrontend
  - legacy
  - learnhub
updated: 2026-05-04
---

# Learning Hub

## Назначение

Внутренний портал обучения и материалов. В текущем React shell это legacy-only микрофронт, который открывается в новой вкладке.

## Где код

- Legacy UI: `legacy/LearnHub-Portal.html`
- Rules/docs: `legacy/LEARNHUB_PORTAL_RULES.md`
- Реестр: `learnhub` в `src/config/modules.tsx`

## Тип интеграции

В `MODULES` выставлено:

- `openNewTab: true`
- `explicitAccess: true`
- legacy asset `LearnHub-Portal.html`

Shell не рендерит React-компонент для `learnhub`; при клике вызывает `buildLegacyModuleUrl()` и `window.open()`.

## Настройки

Передаются общие legacy query-параметры:

- `rbProxyBase`
- `rbProxyMode`
- `rbUseProxy`
- `shell=release-platform`

## Что важно при рефакторинге

Если переносить в React, нужно сначала описать контентную модель: курсы, материалы, роли, прогресс, владельцы, ссылки на внешние источники. Пока это отдельный legacy surface.

## Связанные заметки

- [[Legacy assets]]
- [[Управление доступом]]
