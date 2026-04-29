import React, { useState, useRef, useEffect } from 'react';
import type { ModuleDefinition, ModuleId } from '../../config/modules';

const BADGE_COLORS: Record<string, React.CSSProperties> = {
  green: { background: 'rgba(34,197,94,.16)', color: '#4ADE80' },
  red: { background: 'rgba(239,68,68,.18)', color: '#F87171' },
  purple: { background: 'rgba(155,92,255,.22)', color: '#B893FF' },
};

const SERVICES = [
  {
    id: 'learnhub',
    label: 'Learning\nHub',
    href: 'https://releaseteamwb.ru/LearnHub-Portal.html',
    color: 'linear-gradient(135deg,#7C3AED,#9B5CFF)',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
        <path d="M6 12v5c3.53 1.67 8.47 1.67 12 0v-5"/>
      </svg>
    ),
  },
  {
    id: 'project',
    label: 'Project',
    href: 'http://10.29.47.57',
    color: 'linear-gradient(135deg,#0EA5E9,#0369A1)',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
];

export function Sidebar({
  sections,
  activeModule,
  currentUser,
  roleLabel,
  onActivate,
  onOpenSettings,
  onLogout,
}: {
  sections: Array<{ label: string; items: ModuleDefinition[] }>;
  activeModule: ModuleId;
  currentUser: string;
  roleLabel: string;
  onActivate: (module: ModuleDefinition) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const initials = (currentUser || 'RT').slice(0, 2).toUpperCase();
  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!servicesOpen) return;
    function onDown(e: MouseEvent) {
      if (servicesRef.current && !servicesRef.current.contains(e.target as Node)) {
        setServicesOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [servicesOpen]);

  return (
    <aside className="app-sidebar" style={{
      width: 228,
      flexShrink: 0,
      height: '100vh',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px 0 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: 'linear-gradient(135deg,#9B5CFF,#CB11AB)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 800,
          color: '#fff',
          boxShadow: '0 4px 14px rgba(155,92,255,.45)',
          flexShrink: 0,
        }}>
          WB
        </div>
        <div className="app-sidebar__brand-text" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.2px', color: 'var(--text)', flex: 1, minWidth: 0 }}>
          Release Platform
        </div>
        <div className="app-sidebar__version" style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text-3)',
          background: 'var(--surface-soft-4)',
          padding: '2px 6px',
          borderRadius: 4,
          flexShrink: 0,
        }}>
          v4
        </div>

        {/* Services launcher button */}
        <button
          onClick={() => setServicesOpen(v => !v)}
          title="Сервисы"
          aria-label="Сервисы"
          aria-expanded={servicesOpen}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: servicesOpen ? 'rgba(155,92,255,.18)' : 'var(--surface-soft-4)',
            border: `1px solid ${servicesOpen ? 'rgba(155,92,255,.45)' : 'var(--border-hi)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            color: servicesOpen ? '#B893FF' : 'var(--text-2)',
            transition: 'background .12s, border-color .12s, color .12s',
          }}
        >
          <svg className="app-sidebar__services-icon" width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
            <rect x="0" y="0" width="5.2" height="5.2" rx="1.2"/>
            <rect x="7.8" y="0" width="5.2" height="5.2" rx="1.2"/>
            <rect x="0" y="7.8" width="5.2" height="5.2" rx="1.2"/>
            <rect x="7.8" y="7.8" width="5.2" height="5.2" rx="1.2"/>
          </svg>
        </button>
      </div>

      {/* Services floating card */}
      {servicesOpen && (
        <div ref={servicesRef} style={{
          position: 'fixed',
          top: 10,
          left: 236,
          zIndex: 1000,
          width: 220,
          background: 'var(--card, #1C1C28)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '18px 16px 14px',
          boxShadow: '0 20px 60px rgba(0,0,0,.55), 0 4px 16px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06)',
          backdropFilter: 'blur(12px)',
          animation: 'servicesPanelIn .18s cubic-bezier(.22,.68,0,1.2) both',
        }}>
          <style>{`
            @keyframes servicesPanelIn {
              from { opacity: 0; transform: scale(.94) translateY(-6px); }
              to   { opacity: 1; transform: scale(1)  translateY(0); }
            }
          `}</style>

          <div style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: 14,
            letterSpacing: '-.1px',
          }}>
            Сервисы
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {SERVICES.map(s => (
              <a
                key={s.id}
                href={s.href}
                title={s.label.replace('\n', ' ')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 6px 9px',
                  borderRadius: 14,
                  textDecoration: 'none',
                  background: 'transparent',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--surface-soft-4)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
              >
                <div style={{
                  width: 50,
                  height: 50,
                  borderRadius: 15,
                  background: s.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 16px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.24)',
                  flexShrink: 0,
                }}>
                  {s.icon}
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: 1.25,
                  color: 'var(--text-2)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {s.label}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}


      <nav className="app-sidebar__nav" style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {sections.map(section => (
          <div className="app-sidebar__section" key={section.label} style={{ marginBottom: 18 }}>
            <div className="app-sidebar__section-label" style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.7px',
              color: 'var(--text-3)',
              padding: '0 8px 6px',
            }}>
              {section.label}
            </div>

            {section.items.map(item => {
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onActivate(item)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 9px',
                    marginBottom: 2,
                    borderRadius: 12,
                    textAlign: 'left',
                    background: isActive ? 'rgba(155,92,255,.14)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-2)',
                    border: 'none',
                    position: 'relative',
                    transition: 'background .1s ease, color .1s ease',
                  }}
                  onMouseEnter={e => {
                    if (isActive) return;
                    e.currentTarget.style.background = 'var(--surface-soft-3)';
                  }}
                  onMouseLeave={e => {
                    if (isActive) return;
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {isActive && (
                    <span style={{
                      position: 'absolute',
                      left: -8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: 18,
                      background: 'linear-gradient(135deg,#9B5CFF,#CB11AB)',
                      borderRadius: '0 3px 3px 0',
                    }} />
                  )}

                  <span className="app-sidebar__nav-icon" style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    opacity: isActive ? 1 : 0.7,
                  }}>
                    {item.icon}
                  </span>

                  <span className="app-sidebar__nav-label" style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.label}
                  </span>

                  {item.badge && (
                    <span className="app-sidebar__nav-badge" style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      ...BADGE_COLORS[item.badge.color],
                    }}>
                      {item.badge.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '7px 9px',
          borderRadius: 12,
        }}>
          <div style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: 'linear-gradient(135deg,#9B5CFF,#CB11AB)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div className="app-sidebar__profile-text" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentUser}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {roleLabel}
            </div>
          </div>

          <div className="app-sidebar__profile-actions" style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onOpenSettings}
              title="Настройки"
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                background: 'var(--surface-soft-4)',
                border: '1px solid var(--border-hi)',
                color: 'var(--text-2)',
              }}
            >
              ⚙
            </button>
            <button
              onClick={onLogout}
              title="Выйти"
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                background: 'rgba(239,68,68,.08)',
                border: '1px solid rgba(239,68,68,.14)',
                color: '#FCA5A5',
              }}
            >
              ↩
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
