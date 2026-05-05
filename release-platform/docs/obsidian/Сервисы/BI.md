---
tags:
  - service
  - bi
updated: 2026-05-04
---

# BI

## Роль в проекте

Источник пользовательской аудитории по версиям и популярности устройств/OS.

## Код

- `src/services/youtrack.ts`, BI section
- UI consumers: [[Пользователи по версиям]], [[Популярные устройства]]

## Базовые endpoints

- `https://bi.wb.ru/bi/v2/queue`
- `https://bi.wb.ru/bi/queue`
- `https://bi.wb.ru/cache-puller/api/v1/cache`

## Datasource IDs

- Users: `11386`
- Devices: `14517`
- Device OS: `16888`

## Настройки

- `biCookie`
- [[Proxy]]

## Как работает поток

1. UI отправляет query в BI queue.
2. Service poll-ит статус request.
3. Service забирает result/cache.
4. UI сохраняет snapshot в local history и optionally Drive cache.

## Риски

- Авторизация cookie-based.
- BI query может быть долгим, поэтому важны timeout/retry/status handling.
