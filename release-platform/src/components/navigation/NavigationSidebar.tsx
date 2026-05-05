import React from 'react';
import { ServiceLauncher, type ServiceLauncherItem } from '../layout/ServiceLauncher';

export type NavigationBadgeColor = 'green' | 'red' | 'purple' | 'blue' | 'gray';

export interface NavigationSidebarBadge {
  text: string;
  color: NavigationBadgeColor;
}

export interface NavigationSidebarItem {
  id: string;
  label: string;
  href?: string;
  icon?: React.ReactNode;
  badge?: NavigationSidebarBadge;
  external?: boolean;
  disabled?: boolean;
}

export interface NavigationSidebarSection {
  id: string;
  label: string;
  items: NavigationSidebarItem[];
}

export interface NavigationSidebarBrand {
  title: string;
  mark?: string;
  version?: string;
}

export interface NavigationSidebarProfile {
  name: string;
  roleLabel: string;
  initials?: string;
}

export interface NavigationSidebarAction {
  id: string;
  label: string;
  title: string;
  tone?: 'neutral' | 'danger';
  onClick: () => void;
}

export interface NavigationSidebarConfig {
  brand: NavigationSidebarBrand;
  sections: NavigationSidebarSection[];
  activeItemId: string;
  services?: ServiceLauncherItem[];
  serviceTitle?: string;
  profile: NavigationSidebarProfile;
  profileActions: NavigationSidebarAction[];
}

interface NavigationSidebarProps {
  config: NavigationSidebarConfig;
  onNavigate: (item: NavigationSidebarItem) => void;
}

const BADGE_COLORS: Record<NavigationBadgeColor, React.CSSProperties> = {
  green: { background: 'rgba(34,197,94,.16)', color: '#4ADE80' },
  red: { background: 'rgba(239,68,68,.18)', color: '#F87171' },
  purple: { background: 'rgba(155,92,255,.22)', color: '#B893FF' },
  blue: { background: 'rgba(59,130,246,.16)', color: '#60A5FA' },
  gray: { background: 'var(--surface-soft-4)', color: 'var(--text-3)' },
};

function actionStyle(tone: NavigationSidebarAction['tone']): React.CSSProperties {
  if (tone === 'danger') {
    return {
      background: 'rgba(239,68,68,.08)',
      border: '1px solid rgba(239,68,68,.14)',
      color: '#FCA5A5',
    };
  }
  return {
    background: 'var(--surface-soft-4)',
    border: '1px solid var(--border-hi)',
    color: 'var(--text-2)',
  };
}

function isModifiedClick(event: React.MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export function NavigationSidebar({ config, onNavigate }: NavigationSidebarProps) {
  const initials = config.profile.initials || (config.profile.name || 'RT').slice(0, 2).toUpperCase();
  const services = config.services || [];

  const handleItemClick = (event: React.MouseEvent, item: NavigationSidebarItem) => {
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    if (item.external || isModifiedClick(event)) return;
    event.preventDefault();
    onNavigate(item);
  };

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
          {config.brand.mark || 'WB'}
        </div>
        <div className="app-sidebar__brand-text" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.2px', color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {config.brand.title}
        </div>
        {config.brand.version && (
          <div className="app-sidebar__version" style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-3)',
            background: 'var(--surface-soft-4)',
            padding: '2px 6px',
            borderRadius: 4,
            flexShrink: 0,
          }}>
            {config.brand.version}
          </div>
        )}

        {!!services.length && (
          <ServiceLauncher
            items={services}
            title={config.serviceTitle || 'Сервисы'}
            placement="right-start"
          />
        )}
      </div>

      <nav className="app-sidebar__nav" style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {config.sections.map(section => (
          <div className="app-sidebar__section" key={section.id} style={{ marginBottom: 18 }}>
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
              const isActive = config.activeItemId === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href || '#'}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={event => handleItemClick(event, item)}
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
                    textDecoration: 'none',
                    boxSizing: 'border-box',
                    opacity: item.disabled ? .45 : 1,
                    pointerEvents: item.disabled ? 'none' : undefined,
                  }}
                  onMouseEnter={event => {
                    if (isActive) return;
                    event.currentTarget.style.background = 'var(--surface-soft-3)';
                  }}
                  onMouseLeave={event => {
                    if (isActive) return;
                    event.currentTarget.style.background = 'transparent';
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

                  {item.icon && (
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
                  )}

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
                </a>
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
              {config.profile.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {config.profile.roleLabel}
            </div>
          </div>

          <div className="app-sidebar__profile-actions" style={{ display: 'flex', gap: 6 }}>
            {config.profileActions.map(action => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                title={action.title}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  padding: 0,
                  ...actionStyle(action.tone),
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
