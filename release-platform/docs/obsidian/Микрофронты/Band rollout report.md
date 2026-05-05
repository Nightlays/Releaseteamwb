---
tags:
  - microfrontend
  - band
  - rollout
updated: 2026-05-04
---

# Band rollout report

## Назначение

Отчет по раскаткам Android/iOS из Band-каналов. Группирует события по release-family и показывает старт раскатки, финал 100%, RuStore/AppGallery/AppStore milestones.

## Где код

- UI: `src/modules/RolloutReport/index.tsx`
- Сервис: `src/services/rolloutReport.ts`
- Реестр: `band` в `src/config/modules.tsx`
- Legacy fallback: `legacy/band-android-rollout.html`

## Данные и сервисы

- [[Band]]:
  - Android channel `android-announcement`;
  - iOS channel `mp-ios-releases`;
  - чтение posts через cookies.
- [[Google Apps Script и Drive]]:
  - upload dataset в Google Sheets.
- [[Proxy]]:
  - cookie forwarding.

## Настройки

- `bandCookies`
- `proxyBase`, `proxyMode`, `useProxy`

## Локальное состояние

- `band_android_rollout_v1_lookback_days`
- `band_android_rollout_v1_release_from`
- `band_android_rollout_v1_release_to`
- `band_android_rollout_v1_release_filter`
- `band_android_rollout_v1_active_platform`
- `rp_rollout_report_column_widths`

## Что показывает

- Android: Google Play start/final, RuStore latest, AppGallery latest.
- iOS: AppStore first rollout/final.
- lookback фильтр;
- release range фильтр;
- export/upload dataset.

## Что важно при рефакторинге

Parsing Band text должен быть покрыт тестовыми примерами: разные проценты, hotfix versions, 100%, success/final text, отсутствующая версия.

## Связанные заметки

- [[Band]]
- [[Google Apps Script и Drive]]
- [[Запуск релиза]]
