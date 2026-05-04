---
tags:
  - service
  - band
updated: 2026-05-04
---

# Band

## Роль в проекте

Источник и target для релизных коммуникаций: публикации, треды, опросы, группы, rollout-события, SWAT/duty pings.

## Код

- `src/services/launch.ts`
- `src/services/rolloutReport.ts`
- частично `src/services/releasePages.ts`
- частично `src/services/charts.ts`

## Базовый host

`https://band.wb.ru`

## Что дает

- Чтение posts из каналов.
- Создание posts/replies.
- Scheduled messages.
- Polls.
- Group membership.
- Rollout milestones.

## Используют

- [[Запуск релиза]]
- [[Band rollout report]]
- [[Анализ релизов за квартал]]
- [[Графики]]

## Настройки

- `bandCookies`
- `bandCookiesAdmin`
- [[Proxy]]

## Важные детали

- Cookie передается через `X-Proxy-Cookie`.
- Для write operations нужны admin cookies и CSRF из cookie `MMCSRF`.
- Channel IDs захардкожены в service modules.

## Риски

Parsing сообщений в Band текстовый и зависит от форматов сообщений команд.
