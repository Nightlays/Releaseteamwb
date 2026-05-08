---
tags:
  - service
  - allure
updated: 2026-05-04
---

# Allure TestOps

## Роль в проекте

Главный источник данных по тестовым прогонам и готовности релиза. Также используется для создания новых runs.

## Код

- `src/services/allure.ts`
- `src/services/createRun.ts`
- часть workflow в `src/services/launch.ts`

## Что дает

- Launch list по версии.
- Launch statistics.
- Member statistics.
- Leaf/timeline data.
- Test case overview/custom fields.
- Test plan sync/run.
- Создание release tags.

## Используют

- [[Дашборд]]
- [[Ванговатор]]
- [[Создание рана]]
- [[Запуск релиза]]
- [[SWAT релиз]]
- [[Расчет uWu]]
- [[Графики]]

## Настройки

- `allureBase`, default `https://allure-testops.wb.ru`
- `allureToken`
- `projectId`, default `7`
- [[Proxy]] для browser requests

## Риски

- Разные endpoints требуют разных форматов Authorization: `Api-Token` или bearer-like raw token.
- Для heavy reports много запросов к leaf/timeline/test case overview.
- Кеши dashboard могут скрывать stale data, если релиз перезапускали.
