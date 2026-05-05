---
tags:
  - service
  - youtrack
updated: 2026-05-04
---

# YouTrack

## Роль в проекте

Источник задач, релизных полей, Epic/User Story digest, stream/substream metadata и ЧП enrichment.

## Код

- `src/services/youtrack.ts`
- частично `src/services/chp.ts`
- частично `src/services/releasePages.ts`
- частично `src/services/charts.ts`

## Что дает

- Issue search по query.
- Sorted issue IDs.
- Issue details batch/fallback.
- Agile sprint/board data.
- Release fields iOS/Android.
- Stream/substream fields.
- Tags и issue type.

## Используют

- [[Epic User Story]]
- [[ЧП по стримам]]
- [[ЧП за релиз диапазон]]
- [[Анализ релизов за квартал]]
- [[Графики]]
- [[Запуск релиза]]

## Настройки

- `ytBase`, default `https://youtrack.wildberries.ru`
- `ytToken`
- [[Proxy]]

## Риски

- В коде есть нормализация старого host `youtrack.wb.ru` в `youtrack.wildberries.ru`.
- Названия custom fields доменные и хрупкие.
- Нужны fallback paths, потому что разные YouTrack endpoints возвращают разный payload.
