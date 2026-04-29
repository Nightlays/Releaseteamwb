import React, { useEffect, useRef, useState } from 'react';
import type { ModuleDefinition } from '../../config/modules';
import { StatusPill, Button } from '../ui';
import { THEME_LIST, type ThemeMode } from '../../context/AppContext';

interface TopbarProps {
  module: ModuleDefinition;
  proxyOnline: boolean;
  mlReady: boolean;
  theme: ThemeMode;
  onSetTheme: (t: ThemeMode) => void;
  onRefresh: () => void;
  onOpenLegacy: () => void;
  showLegacyButton?: boolean;
}

function ThemeDropdown({ theme, onSetTheme }: { theme: ThemeMode; onSetTheme: (t: ThemeMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = THEME_LIST.find(t => t.id === theme) ?? THEME_LIST[0];

  return (
    <div ref={ref} className="app-topbar__theme" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '5px 11px',
          borderRadius: 8,
          border: '1px solid var(--border-hi)',
          background: open ? 'var(--surface-soft-4)' : 'var(--surface-soft-2)',
          color: 'var(--text-2)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background .14s',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: current.accent,
            flexShrink: 0,
            boxShadow: `0 0 0 2px ${current.accent}44`,
          }}
        />
        Тема: {current.label}
        <span style={{ fontSize: 9, opacity: .6, marginLeft: 1 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 174,
            borderRadius: 12,
            border: '1px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: 'var(--modal-shadow)',
            padding: '5px 0',
            zIndex: 999,
            backdropFilter: 'blur(16px)',
          }}
        >
          {THEME_LIST.map(t => {
            const isActive = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { onSetTheme(t.id); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 14px',
                  background: isActive ? 'var(--surface-soft-4)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: isActive ? 'var(--text)' : 'var(--text-2)',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  textAlign: 'left',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-soft-3)'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: '50%',
                    background: t.accent,
                    flexShrink: 0,
                    boxShadow: isActive ? `0 0 0 2.5px ${t.accent}55` : 'none',
                    outline: isActive ? `2px solid ${t.accent}` : '2px solid transparent',
                    outlineOffset: 2,
                    transition: 'outline .14s',
                  }}
                />
                {t.label}
                {isActive && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Topbar({ module, proxyOnline, mlReady, theme, onSetTheme, onRefresh, onOpenLegacy, showLegacyButton = true }: TopbarProps) {
  return (
    <header className="app-topbar" style={{
      height: 64,
      background: 'var(--topbar-bg)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '0 22px',
      flexShrink: 0,
      backdropFilter: 'blur(18px)',
    }}>
      <div className="app-topbar__title">
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.2px' }}>{module.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{module.sub}</div>
      </div>

      <div className="app-topbar__actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <StatusPill status={proxyOnline ? 'live' : 'error'}>Proxy {proxyOnline ? 'online' : 'offline'}</StatusPill>
        <StatusPill status={mlReady ? 'live' : 'warn'}>ML {mlReady ? 'ready' : 'pending'}</StatusPill>
        <ThemeDropdown theme={theme} onSetTheme={onSetTheme} />
        {showLegacyButton && (
          <Button variant="ghost" size="sm" onClick={onOpenLegacy}>↗ Legacy</Button>
        )}
        <Button variant="secondary" size="sm" onClick={onRefresh}>⟳ Обновить</Button>
      </div>
    </header>
  );
}
