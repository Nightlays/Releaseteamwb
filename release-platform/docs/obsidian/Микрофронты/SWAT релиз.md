---
tags:
  - microfrontend
  - swat
updated: 2026-05-04
---

# SWAT релиз

## Назначение

Строит SWAT-отчет по релизу: дежурные, платформенные разрезы, часы, uWu, кейсы, стримы и графики по дням.

## Где код

- UI: `src/modules/SwatRelease/index.tsx`
- Сервис: `src/services/swat.ts`
- Реестр: `swat` в `src/config/modules.tsx`
- Legacy fallback: `legacy/SWAT релиз.html`

## Данные и сервисы

- [[Allure TestOps]]:
  - High/Blocker launches;
  - member stats;
  - timeline/leaves;
  - test case overview и uWu custom field.
- [[Google Apps Script и Drive]]:
  - SWAT days bundle.
- [[Proxy]]:
  - gateway.

## Настройки

- `allureBase`
- `allureToken`
- `projectId`
- `proxyBase`, `proxyMode`, `useProxy`

## Локальное состояние

- `swat_release_react_v2`
- `swat_release_tab_v2`

## Что показывает

- employees table;
- platform model Android/iOS;
- cases detail;
- streams view;
- charts по дням;
- XLSX export.

## Что важно при рефакторинге

`swat.ts` и [[Расчет uWu]] имеют похожую работу с Allure timeline/leaves и uWu field. Можно выделить общий Allure timeline reader и SWAT directory adapter.

## Связанные заметки

- [[Расчет uWu]]
- [[Allure TestOps]]
- [[Google Apps Script и Drive]]
