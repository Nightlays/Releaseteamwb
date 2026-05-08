import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AppSettings, DEFAULT_SETTINGS, normalizeSettings } from '../types';
import { readLegacyBootstrapSettings, syncLegacySettings } from '../services/legacy';

const LS_KEY = 'rp_settings_v1';

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const next = normalizeSettings(parsed);
      syncLegacySettings(next);
      return next;
    }
  } catch { /* ignore */ }
  const next = normalizeSettings({ ...DEFAULT_SETTINGS, ...readLegacyBootstrapSettings() });
  syncLegacySettings(next);
  return next;
}

interface SettingsCtx {
  settings: AppSettings;
  save: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(load);

  const save = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = normalizeSettings({ ...prev, ...patch });
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      syncLegacySettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(normalizeSettings(DEFAULT_SETTINGS));
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    syncLegacySettings(normalizeSettings(DEFAULT_SETTINGS));
  }, []);

  return <Ctx.Provider value={{ settings, save, reset }}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}
