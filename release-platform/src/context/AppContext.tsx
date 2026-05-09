import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ModuleId } from '../config/modules';

export type ThemeMode = 'dark' | 'light' | 'oled' | 'midnight' | 'nord' | 'sepia';

export const THEME_LIST: Array<{ id: ThemeMode; label: string; accent: string; dark: boolean }> = [
  { id: 'dark',     label: 'Тёмная',   accent: '#9B5CFF', dark: true  },
  { id: 'light',    label: 'Светлая',  accent: '#9B5CFF', dark: false },
  { id: 'oled',     label: 'OLED',     accent: '#A86FFF', dark: true  },
  { id: 'midnight', label: 'Ночь',     accent: '#4A9EFF', dark: true  },
  { id: 'nord',     label: 'Север',    accent: '#88C0D0', dark: true  },
  { id: 'sepia',    label: 'Сепия',    accent: '#8B5E3C', dark: false },
];

export function isDarkTheme(t: ThemeMode) {
  return t !== 'light' && t !== 'sepia';
}

interface AppCtx {
  activeModule: ModuleId;
  setActiveModule: (m: ModuleId) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<AppCtx | null>(null);
const THEME_STORAGE_KEY = 'release-platform-theme-v2';

const VALID_THEMES = new Set<ThemeMode>(['dark', 'light', 'oled', 'midnight', 'nord', 'sepia']);

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  return stored && VALID_THEMES.has(stored) ? stored : 'dark';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (isDarkTheme(prev) ? 'light' : 'dark'));
  };

  return (
    <Ctx.Provider value={{ activeModule, setActiveModule, settingsOpen, setSettingsOpen, theme, setTheme, toggleTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
