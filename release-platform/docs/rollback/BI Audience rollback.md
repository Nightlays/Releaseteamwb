# BI Audience rollback

Состояние до добавления модуля `BI аудитория` сохранено здесь:

- `bi-audience-before-cross-source.patch` — изменения `BiUsers` / `Devices` до cross-source этапа.
- `bi-service-before-cross-source.ts` — копия `src/services/bi.ts` до cross-source этапа.
- `bi-audience-cross-feature.patch` — patch подключения нового datasource-клиента и пункта меню.
- `src/components/layout/ServiceLauncher.tsx` — текущая вынесенная реализация лаунчера сервисов; для отката удалить файл и вернуть inline-блок сервисов в `Sidebar.tsx`.

Для отката только cross-source этапа:

```bash
git apply -R docs/rollback/bi-audience-cross-feature.patch
rm -rf src/modules/BiAudience
```

`BiUsers` и `Devices` при этом останутся в текущем улучшенном состоянии.
