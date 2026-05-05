---
tags:
  - service
  - google-apps-script
  - drive
updated: 2026-05-04
---

# Google Apps Script и Drive

## Роль в проекте

Используются как lightweight backend для истории, JSON datasets, выгрузок и отдельных справочников.

## Где встречается

- `GOOGLE_APPS_SCRIPT_URL` в `src/types/index.ts`
- `src/services/regressionHistory.ts`
- `src/services/charts.ts`
- `src/services/chp.ts`
- `src/services/rolloutReport.ts`
- `src/services/swat.ts`
- `src/services/uvu.ts`
- `src/modules/BiUsers/index.tsx`

## Что хранит или отдает

- История regression/dashboard snapshots.
- BI history/cache JSON.
- Charts ML dataset.
- CHП таблицы.
- Rollout datasets в Google Sheets.
- SWAT days bundle.
- Duty editor/release notice data для launch workflow.

## Используют

- [[Дашборд]]
- [[Графики]]
- [[Пользователи по версиям]]
- [[ЧП по стримам]]
- [[Band rollout report]]
- [[SWAT релиз]]
- [[Расчет uWu]]
- [[Запуск релиза]]

## Риски

- URL Apps Script часто захардкожены в коде.
- Нет единого contract/versioning для payload.
- Ошибки Apps Script могут выглядеть как обычный HTTP 200 с текстом ошибки, если script так настроен.
