---
tags:
  - service
  - llm
  - glm
updated: 2026-05-04
---

# GLM adapter

## Роль в проекте

Локальный OpenAI-compatible adapter к CoreLLM. Нужен, чтобы браузер мог вызывать `/v1/chat/completions` без прямого доступа к CoreLLM и без хранения JWT в frontend.

## Код

- `GLM/glm-zai-local-adapter.mjs`
- docs: `GLM/README.md`
- docker service: `legacy/docker-compose.yml`, service `llm`

## Endpoints

- `GET /health`
- `POST /v1/chat/completions`
- `POST /chat/completions`

## Env

- `GLM_API_KEY`
- `GLM_UPSTREAM_BASE`, default `https://corellm.wb.ru/glm-51/v1`
- `GLM_MODEL`, default `glm-5.1`
- `PORT`, default `8789`
- `HOST`, default `127.0.0.1`

## Используют

- [[Wiki Intelligence v4]]
- [[Графики]] для AI summary

## Настройки UI

- `glmBase`: `http://localhost:8789/v1`
- `glmKey`: optional, если adapter имеет `GLM_API_KEY`
- `glmModel`

## Риски

- Если upstream CoreLLM меняет model/base, надо обновлять adapter env и UI settings.
- Adapter подменяет OpenAI-like key на CoreLLM env key только для `corellm.wb.ru`.
