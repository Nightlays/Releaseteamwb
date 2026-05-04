---
tags:
  - microfrontend
  - youtrack
updated: 2026-05-04
---

# Epic User Story

## Назначение

Инструмент для подготовки релизных текстов и выборок Epic/User Story/Task из YouTrack под разные режимы: Елена, Надежда, Дарья.

## Где код

- UI: `src/modules/YtCopy/index.tsx`
- Сервис: `src/services/youtrack.ts`
- Реестр: `ytcopy` в `src/config/modules.tsx`
- Legacy fallback: `legacy/Копирование данных из YT.html`

## Данные и сервисы

- [[YouTrack]]:
  - sorted issue search;
  - issue details;
  - agile sprint data;
  - board info;
  - field extraction по версиям iOS/Android.
- [[Proxy]]:
  - gateway.

## Настройки

- `ytBase`
- `ytToken`
- `proxyBase`, `proxyMode`, `useProxy`

## Локальное состояние

- `rp_epic_user_story_release`
- `rp_epic_user_story_mode`
- читает shared legacy key `swat_uwu_release_range`.

## Что показывает

- раздельные списки iOS/Android;
- common rows;
- markdown/text digest для копирования;
- режимы генерации под разных получателей.

## Что важно при рефакторинге

Логика digest generation уже находится в `youtrack.ts`. Ее стоит отделить от низкоуровневого YouTrack client, чтобы можно было тестировать формат сообщений без API.

## Связанные заметки

- [[YouTrack]]
- [[Proxy]]
