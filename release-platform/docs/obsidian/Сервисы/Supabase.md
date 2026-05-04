---
tags:
  - service
  - supabase
updated: 2026-05-04
---

# Supabase

## Роль в проекте

Persistence для квартального анализа релизов.

## Код

- `src/services/releaseQuarterSupabase.ts`
- schema: `supabase/release_quarter_analysis.sql`

## Tables

- `release_quarter_android`
- `release_quarter_ios`

## Использует

- [[Анализ релизов за квартал]]

## Как работает

- `loadQuarterAnalysisRows()` читает обе таблицы и нормализует payload в `QuarterAnalysisRow`.
- `saveQuarterAnalysisRows()` группирует строки по платформам и делает upsert с `on_conflict=version`.
- В row сохраняются плоские поля и `row_payload` для восстановления полной структуры.

## Настройки

Publishable key и Supabase URL сейчас находятся прямо в `releaseQuarterSupabase.ts`.

## Риски

- Publishable key в frontend.
- Conflict только по `version`: если нужно хранить несколько диапазонов или пересборок, схема потребует пересмотра.
