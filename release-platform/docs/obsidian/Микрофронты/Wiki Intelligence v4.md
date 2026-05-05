---
tags:
  - microfrontend
  - wiki
  - ai
updated: 2026-05-05
---

# Wiki Intelligence v4

## Назначение

AI-поиск и генерация ответов по базе знаний: Wiki WB, optional web search, история диалога, persona prompts, черновики wiki-статей и публикация в wiki.

## Где код

- UI: `src/modules/WikiIntelligence/index.tsx`
- Сервис: `src/services/wikiIntelligence.ts`
- Legacy notes: `legacy/youtrack-wiki-rag-implementation.md`
- Реестр: `wiki` в `src/config/modules.tsx`
- Legacy fallback: `legacy/youtrack-wiki-v4.html`

## Данные и сервисы

- [[GLM adapter]]:
  - OpenAI-compatible `/v1/chat/completions`.
- Wiki WB:
  - search articles;
  - hydrate content;
  - create/update article.
- Web search:
  - Brave API если задан ключ;
  - fallback через DuckDuckGo parsing.
- [[Proxy]]:
  - маршрутизация для Wiki/web/API.

## Настройки

- `wikiToken`
- `glmBase`
- `glmKey`
- `glmModel`
- `useWebSearch`
- `webSearchKey`
- `proxyBase`, `proxyMode`, `useProxy`

## Что показывает

- чат с источниками;
- выбор источника `wiki`, `web`, `all`;
- persona selector;
- suggested questions;
- draft actions: publish/copy.

## Публикация статей

Перед отправкой черновика в Wiki сервис нормализует markdown:

- очищает подписи markdown-ссылок от percent-encoded мусора;
- голые URL и URL в скобках превращает в markdown-ссылки с подписью `ссылка`;
- одинаково очищает `markdown` и HTML `content`, которые уходят в publish API.

Prompt генерации статьи дополнительно запрещает использовать URL, encoded slug и `%D0...` фрагменты в видимом тексте ссылок.

Это защищает опубликованные статьи от артефактов вида `ADR 0011%20...` и сырых `https://wiki.wb.ru/...%D0...` внутри текста.

## Доступ

В реестре модуль помечен `superadminOnly: true`.

## Что важно при рефакторинге

`wikiIntelligence.ts` совмещает retrieval, prompt planning, LLM calls, markdown rendering и publish. Оптимальная граница: `wikiClient`, `webSearchClient`, `ragPlanner`, `llmClient`, `wikiPublishService`.

## Связанные заметки

- [[GLM adapter]]
- [[Proxy]]
- [[Learning Hub]]
