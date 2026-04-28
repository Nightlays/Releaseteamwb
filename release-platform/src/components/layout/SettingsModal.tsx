import React, { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useApp } from '../../context/AppContext';
import { Modal, Input, Textarea, FieldLabel, Button, Divider, Select } from '../ui';
import { AppSettings } from '../../types';

const SECTIONS: Array<{ label: string; rows: Array<{ key: keyof AppSettings; label: string; type?: 'text' | 'password' | 'textarea' | 'select' | 'checkbox'; placeholder?: string; options?: Array<{ value: string; label: string }> }> }> = [
  {
    label: 'Proxy / Runtime',
    rows: [
      { key: 'proxyBase', label: 'Proxy Base URL', placeholder: 'http://localhost:8787' },
      { key: 'proxyMode', label: 'Режим proxy', type: 'select', options: [{ value: 'query', label: 'Query' }, { value: 'prefix', label: 'Prefix' }] },
      { key: 'useProxy', label: 'Использовать proxy', type: 'checkbox' },
      { key: 'mlHelperBase', label: 'ML Helper Base URL', placeholder: 'http://127.0.0.1:8788' },
    ],
  },
  {
    label: 'Allure / YouTrack',
    rows: [
      { key: 'allureBase', label: 'Allure Base URL', placeholder: 'https://allure-testops.wb.ru' },
      { key: 'allureToken', label: 'Allure Api-Token', type: 'password', placeholder: 'Api-Token ...' },
      { key: 'projectId', label: 'Project ID', placeholder: '7' },
      { key: 'ytBase', label: 'YouTrack Base URL', placeholder: 'https://youtrack.wildberries.ru' },
      { key: 'ytToken', label: 'YouTrack Token', type: 'password', placeholder: 'perm:...' },
    ],
  },
  {
    label: 'Deploy / Docs',
    rows: [
      { key: 'deployLabToken', label: 'Deploy Lab Token', type: 'password', placeholder: 'authorization-deploy-lab' },
      { key: 'gitlabToken', label: 'GitLab Token', type: 'password', placeholder: 'PRIVATE-TOKEN / personal access token' },
      { key: 'gitlabCookie', label: 'GitLab Cookies', type: 'textarea', placeholder: '_gitlab_session=...;' },
      { key: 'biCookie', label: 'WB BI Cookie', type: 'textarea', placeholder: 'wbx-validation-key=...; BIWBToken=...;' },
      { key: 'wikiToken', label: 'Wiki Bearer Token', type: 'password', placeholder: 'Bearer ...' },
      { key: 'bandCookies', label: 'Band Cookies (чтение / публикация)', type: 'textarea', placeholder: 'MMAUTHTOKEN=...; MMUSERID=...;' },
      { key: 'bandCookiesAdmin', label: 'Band Cookies (Администратор групп)', type: 'textarea', placeholder: 'MMAUTHTOKEN=...; MMUSERID=...; (нужен для обновления @qadutyios/@qadutyandr)' },
    ],
  },
  {
    label: 'LLM',
    rows: [
      { key: 'glmBase', label: 'LLM Base URL', placeholder: 'http://localhost:8789/v1' },
      { key: 'glmKey', label: 'LLM API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'glmModel', label: 'LLM Model', placeholder: 'glm-5.1' },
      { key: 'useWebSearch', label: 'Веб-поиск (DuckDuckGo, бесплатно)', type: 'checkbox' },
      { key: 'webSearchKey', label: 'Brave Search API Key (опционально, лучше качество)', type: 'password', placeholder: 'BSA...' },
    ],
  },
];

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useApp();
  const { settings, save, reset } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);

  React.useEffect(() => {
    if (settingsOpen) setDraft(settings);
  }, [settingsOpen, settings]);

  const setField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const onSave = () => {
    save(draft);
    setSettingsOpen(false);
  };

  return (
    <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Общие настройки платформы" width={680}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh', minHeight: 0, background: 'var(--card)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
          {SECTIONS.map(section => (
            <div key={section.label}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text-3)', marginBottom: 12 }}>
                {section.label}
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {section.rows.map(field => (
                  <div key={String(field.key)}>
                    <FieldLabel>{field.label}</FieldLabel>

                    {field.type === 'textarea' ? (
                      <Textarea
                        rows={3}
                        value={String(draft[field.key] ?? '')}
                        placeholder={field.placeholder}
                        onChange={e => setField(field.key, e.target.value as AppSettings[keyof AppSettings])}
                      />
                    ) : field.type === 'select' ? (
                      <Select
                        value={String(draft[field.key])}
                        onChange={e => setField(field.key, e.target.value as AppSettings[keyof AppSettings])}
                      >
                        {field.options?.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </Select>
                    ) : field.type === 'checkbox' ? (
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid var(--border-hi)',
                        background: 'var(--surface-soft)',
                        color: 'var(--text-2)',
                      }}>
                        <input
                          type="checkbox"
                          checked={Boolean(draft[field.key])}
                          onChange={e => setField(field.key, e.target.checked as AppSettings[keyof AppSettings])}
                        />
                        <span>Разрешить проксирование запросов для legacy-модулей</span>
                      </label>
                    ) : (
                      <Input
                        type={field.type === 'password' ? 'password' : 'text'}
                        value={String(draft[field.key] ?? '')}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        onChange={e => setField(field.key, e.target.value as AppSettings[keyof AppSettings])}
                      />
                    )}
                  </div>
                ))}
              </div>

              <Divider style={{ marginTop: 14 }} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', background: 'var(--card)' }}>
          <Button variant="danger" size="sm" onClick={reset}>Удалить</Button>
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(false)}>Отмена</Button>
          <Button variant="primary" size="sm" onClick={onSave}>Сохранить и обновить модули</Button>
        </div>
      </div>
    </Modal>
  );
}
