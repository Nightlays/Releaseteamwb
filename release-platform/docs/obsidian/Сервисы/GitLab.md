---
tags:
  - service
  - gitlab
updated: 2026-05-04
---

# GitLab

## Роль в проекте

Источник pipeline timings, build jobs и MR composition для релизной аналитики.

## Код

- `src/services/charts.ts`
- `src/services/chp.ts`
- `src/services/releasePages.ts`

## Базовый host

`https://gitlab.wildberries.ru`

## Что дает

- GraphQL API для pipelines.
- Jobs API для finished timestamps.
- Merge requests по target branch.
- Build/regression timing signals.

## Используют

- [[Графики]]
- [[ЧП по стримам]]
- [[ЧП за релиз диапазон]]
- [[Анализ релизов за квартал]]

## Настройки

- `gitlabToken`
- `gitlabCookie`
- [[Proxy]]

## Риски

- В коде поддержаны разные варианты auth headers/cookie auth.
- Pipeline/job search завязан на названия jobs и project full paths.
