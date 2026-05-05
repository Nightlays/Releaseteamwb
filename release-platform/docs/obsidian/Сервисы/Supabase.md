---
tags:
  - service
  - supabase
updated: 2026-05-05
---

# Supabase

## Роль в проекте

Persistence для квартального анализа релизов и dashboard snapshots.

## Код

- `src/services/releaseQuarterSupabase.ts`
- schema: `supabase/release_quarter_analysis.sql`
- `src/services/dashboardSupabase.ts`
- schema: `supabase/dashboard_snapshots.sql`

## Tables

- `release_quarter_android`
- `release_quarter_ios`
- `dashboard_snapshots`

## Использует

- [[Анализ релизов за квартал]]
- [[Дашборд]]

## Как работает

- `loadQuarterAnalysisRows()` читает обе таблицы и нормализует payload в `QuarterAnalysisRow`.
- `saveQuarterAnalysisRows()` группирует строки по платформам и делает upsert с `on_conflict=version`.
- В row сохраняются плоские поля и `row_payload` для восстановления полной структуры.
- `loadDashboardSnapshotHistory()` читает последние snapshots dashboard по `project_id + version`.
- `loadLatestDashboardSnapshot()` читает последнюю полную строку dashboard и восстанавливает UI payload без ручного сбора.
- `saveDashboardSnapshot()` пишет append-only срез dashboard в `dashboard_snapshots`.
- Для dashboard в таблице хранятся плоские метрики, сырые payload, `history_point`, `tracking_payload` и `enrichment_payload`.

## Таблицы

### release_quarter_android

Назначение: сохраненная аналитика Android-релизов за выбранный квартал/диапазон.

Код:

- схема: `supabase/release_quarter_analysis.sql`;
- клиент: `src/services/releaseQuarterSupabase.ts`;
- UI: [[Анализ релизов за квартал]].

Ключ строки:

- `version` - primary key;
- при повторном сохранении используется upsert `on_conflict=version`.

Основные поля:

| Колонки | Назначение |
|---|---|
| `release_from`, `release_to` | Диапазон релизов, в котором строка была собрана. |
| `month` | Месяц релиза в нормализованном формате `0..11`. |
| `stream`, `substream` | Команда/направление релиза. |
| `primary_task_key`, `primary_task_summary`, `primary_task_url` | Основная задача/локомотив релиза. |
| `secondary_tasks` | JSONB список вторичных задач. |
| `build_time`, `branch_cut_time`, `actual_send_time`, `one_percent_date` | Ключевые даты релизного процесса. |
| `previous_rollout_percent`, `planned_hotfix_date` | Контекст rollout/hotfix. |
| `hotfix_reason`, `hotfix_details` | Причина и детали hotfix, если применимо. |
| `source_count` | Сколько источников участвовало в сборе строки. |
| `row_payload` | Полная структура `QuarterAnalysisRow` для восстановления UI. |
| `created_at`, `updated_at` | Технический audit. |

### release_quarter_ios

Назначение: такая же квартальная аналитика, но для iOS.

Структура совпадает с `release_quarter_android`. Разделение на две таблицы сделано на уровне `tableName(platform)`, чтобы Android/iOS можно было сохранять и читать независимо.

Ключевые отличия:

- `platform === 'ios'` маршрутизируется в `release_quarter_ios`;
- `saveQuarterAnalysisRows()` группирует строки по платформе и пишет Android/iOS параллельно;
- `loadQuarterAnalysisRows()` читает обе таблицы параллельно и объединяет результат.

### dashboard_snapshots

Назначение: append-only история dashboard по релизной версии.

Код:

- схема: `supabase/dashboard_snapshots.sql`;
- клиент: `src/services/dashboardSupabase.ts`;
- UI: [[Дашборд]].

Ключ строки:

- `id` - uuid primary key;
- unique index `project_id + version + snapshot_at`;
- dashboard не делает upsert, а создает новый snapshot на каждый успешный сбор.

Основные поля:

| Колонки | Назначение |
|---|---|
| `project_id`, `version`, `snapshot_at`, `source` | Идентификация проекта, версии и времени среза. |
| `total_cases`, `finished_cases`, `remaining_cases` | Общий прогресс регресса. |
| `manual_finished_cases`, `manual_timed_finished_cases` | Ручное прохождение, включая расчетное окно. |
| `assigned_cases`, `in_progress_cases` | Расклад остатка по назначенным/в работе. |
| `launches_count` | Сколько Allure launches попало в dashboard. |
| `active_people_count`, `active_people_logins` | Активные исполнители из Allure memberstats. |
| `readiness_android`, `readiness_ios` | Готовность Android/iOS launch. |
| `critical_total`, `critical_finished` | Critical/High/Blocker counters. |
| `selective_total`, `selective_finished` | Selective counters. |
| `uwu_total`, `uwu_left` | uWu counters для High/Blocker. |
| `empty_alerts`, `no_passed_alerts` | Launch quality alerts. |
| `completion_pct`, `manual_completion_pct` | Общий и ручной прогресс в процентах. |
| `critical_completion_pct`, `selective_completion_pct` | Проценты по Critical/Selective. |
| `readiness_min_pct`, `readiness_gap_pct` | Минимальная readiness и разрыв Android/iOS. |
| `prediction_status`, `prediction_risk`, `prediction_confidence`, `eta_at`, `deadline_at` | Быстрые поля прогноза. |
| `history_point` | Полный `DashboardHistoryPoint` для восстановления burndown/history table. |
| `aggregate_payload` | Сырые counts по `DASHBOARD_ORDER`. |
| `uwu_payload` | Сырые uWu counts. |
| `readiness_payload` | Сырые readiness summaries Android/iOS. |
| `launches_payload` | Launch rows, которые показывает dashboard. |
| `alerts_payload` | Все alerts по пустым/no passed launches. |
| `prediction_payload` | Полный результат `DashboardPrediction`. |
| `tracking_payload` | Дельты к прошлому срезу, velocity, compact counters. |
| `enrichment_payload` | Сводка enrichment: source, generatedAt, tracking, prediction summary. |
| `created_at`, `updated_at` | Технический audit. |

Порядок работы:

1. UI вызывает `loadDashboardSnapshotHistory(version, projectId, 48)`.
2. Сервис делает Data API GET:
   `dashboard_snapshots?select=id,version,snapshot_at,history_point&project_id=eq.<projectId>&version=eq.<version>&order=snapshot_at.desc&limit=48`.
3. Ответ нормализуется в `DashboardHistoryPoint[]` и сортируется по времени.
4. Параллельно UI вызывает `loadLatestDashboardSnapshot(version, projectId)`.
5. Последняя строка восстанавливает `agg`, `uwu`, `readiness`, `launches`, `alerts`, `prediction`, чтобы dashboard отображал сохраненное состояние без нажатия "Собрать dashboard".
6. После полного сбора Allure и расчета прогноза UI вызывает `saveDashboardSnapshot()`.
7. Сервис собирает плоские поля, payload и tracking/enrichment.
8. Data API POST пишет новую строку в `dashboard_snapshots`.
9. После успешной записи сервис перечитывает историю, чтобы UI видел общий Supabase-state, а не только локальный snapshot.

## RLS и доступ

Все текущие таблицы включают Row Level Security.

`release_quarter_android` и `release_quarter_ios`:

- `select` открыт для `anon`, `authenticated`;
- `insert` открыт для `anon`, `authenticated`;
- `update` открыт для `anon`, `authenticated`.

`dashboard_snapshots`:

- `select` открыт для `anon`, `authenticated`;
- `insert` открыт для `anon`, `authenticated`;
- `update` открыт для `anon`, `authenticated`;
- `delete` не открыт.

Текущая причина открытого RLS: frontend пишет напрямую через Supabase Data API с publishable key. Если появится backend/gateway, запись нужно перенести туда и закрыть insert/update для `anon`.

## Индексы

`release_quarter_android` и `release_quarter_ios`:

- primary key по `version`.

`dashboard_snapshots`:

- unique `project_id, version, snapshot_at`;
- index `version, snapshot_at desc`;
- index `project_id, version, snapshot_at desc`;
- GIN index по `tracking_payload`.

## Настройки

Publishable key и Supabase URL сейчас находятся прямо в `releaseQuarterSupabase.ts` и `dashboardSupabase.ts`.

## Риски

- Publishable key в frontend.
- Conflict только по `version`: если нужно хранить несколько диапазонов или пересборок, схема потребует пересмотра.
- `dashboard_snapshots` открыт на insert/select/update для anon/authenticated через RLS, потому что текущий frontend пишет напрямую через Data API.
- Secret key нельзя переносить в frontend, Obsidian или git.
- `dashboard_snapshots` append-only: чистку старых срезов нужно делать отдельной SQL-задачей или backend job, не из UI.
