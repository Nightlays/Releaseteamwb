---
tags:
  - service
  - proxy
updated: 2026-05-04
---

# Proxy

## Роль в проекте

Локальный CORS gateway для браузерных запросов к корпоративным API. Без него часть интеграций не работает из-за CORS, cookies или нестандартных headers.

## Код

- Frontend helper: `src/services/proxy.ts`
- Local service: `legacy/proxy-standalone.js`

## Endpoints

- `GET /health`
- `GET /healthz` проверяется frontend helper, но standalone service реализует `/health`.
- `/proxy?url=<target>` основной режим.
- `/prefix/<target>` поддержан frontend helper как альтернативный mode, если backend proxy это умеет.

## Headers

Proxy forwarding поддерживает:

- `Authorization`
- `authorization-deploy-lab`
- `PRIVATE-TOKEN`
- `X-Proxy-Cookie`
- `X-Proxy-Token`
- `X-Proxy-Key`
- `X-Client-Request-Id`

`X-Proxy-Cookie` перекладывается в upstream `Cookie`.

## Используют

Почти все модули с внешними API: [[Дашборд]], [[Графики]], [[Запуск релиза]], [[ЧП по стримам]], [[Wiki Intelligence v4]], [[Band rollout report]].

## Настройки

- `proxyBase`: обычно `http://localhost:8787`
- `proxyMode`: `query` или `prefix`
- `useProxy`: boolean

## Рефакторинг

Стабилизировать contract proxy как отдельный backend API. Сейчас frontend знает слишком много о fallback URL и режимах.
