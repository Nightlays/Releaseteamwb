---
tags:
  - service
  - deploy-lab
updated: 2026-05-04
---

# Deploy Lab

## Роль в проекте

Источник релизных issues, компонентов, статусов и дат релиза.

## Код

- `src/services/chp.ts`
- `src/services/charts.ts`
- `src/services/releasePages.ts`
- `src/services/launch.ts`

## Базовый host

`https://deploy-lab-api.wb.ru`

## Что дает

- Issues по release id и platform prefix.
- Release summary.
- Deploy/cutoff dates.
- Components для major workflow.
- Hotfix/release metadata.

## Используют

- [[Запуск релиза]]
- [[ЧП по стримам]]
- [[ЧП за релиз диапазон]]
- [[Анализ релизов за квартал]]
- [[Графики]]

## Настройки

- `deployLabToken`
- [[Proxy]]

## Риски

- Token нормализуется из разных форматов: bare token, `Bearer`, header-like paste.
- Часть данных потом enrich-ится через [[YouTrack]] и [[GitLab]], поэтому ошибки могут быть частичными.
