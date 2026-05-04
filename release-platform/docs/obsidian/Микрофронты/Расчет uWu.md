---
tags:
  - microfrontend
  - uwu
updated: 2026-05-04
---

# Расчет uWu

## Назначение

Считает uWu-покрытие по Smoke/Selective прогонам релиза: люди, стримы, дни, длительность, наличие custom field uWu и детализация по кейсам.

## Где код

- UI: `src/modules/Uvu/index.tsx`
- Сервис: `src/services/uvu.ts`
- Реестр: `uvu` в `src/config/modules.tsx`
- Legacy fallback: `legacy/УВУ.html`

## Данные и сервисы

- [[Allure TestOps]]:
  - поиск Smoke/Selective launches;
  - timeline/leaves;
  - member stats;
  - test case overview для uWu custom field.
- [[Google Apps Script и Drive]]:
  - SWAT payload endpoint `UWU_SWAT_ENDPOINT`.
- [[Proxy]]:
  - маршрутизация запросов.

## Настройки

- `allureBase`
- `allureToken`
- `projectId`
- `proxyBase`, `proxyMode`, `useProxy`

## Локальное состояние

- `swat_uwu_release`
- `swat_uwu_filters`

## Что показывает

- разрез по людям;
- разрез по стримам;
- разрез по дням;
- детализацию кейсов по человеку/стриму;
- экспорт PDF/XLSX.

## Что важно при рефакторинге

Модуль зависит от Allure timeline и custom fields, поэтому в тестовых фикстурах нужны реальные варианты launch payload: без uWu, с пустыми custom fields, с несколькими платформами и разными day slots.

## Связанные заметки

- [[SWAT релиз]]
- [[Allure TestOps]]
- [[Google Apps Script и Drive]]
