import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ServiceLauncherItem {
  id: string;
  label: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  target?: React.HTMLAttributeAnchorTarget;
  rel?: string;
}

export type ServiceLauncherPlacement = 'right-start' | 'bottom-start' | 'bottom-end';

export const DEFAULT_SERVICE_LAUNCHER_ITEMS: ServiceLauncherItem[] = [
  {
    id: 'learnhub',
    label: 'Learning\nHub',
    href: 'http://wii-front-ingress-controller.wii-front.k8s.stage-dm/frontend',
    color: 'linear-gradient(135deg,#7C3AED,#9B5CFF)',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3.53 1.67 8.47 1.67 12 0v-5" />
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
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

interface ServiceLauncherProps {
  items?: ServiceLauncherItem[];
  title?: string;
  placement?: ServiceLauncherPlacement;
  buttonSize?: number;
  panelWidth?: number;
  zIndex?: number;
  className?: string;
  style?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPanelPosition(
  rect: DOMRect,
  placement: ServiceLauncherPlacement,
  panelWidth: number,
  panelHeight: number,
) {
  const gap = 8;
  const margin = 10;
  const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);

  if (placement === 'right-start') {
    return {
      left: clamp(rect.right + gap, margin, maxLeft),
      top: clamp(rect.top, margin, maxTop),
    };
  }

  if (placement === 'bottom-start') {
    return {
      left: clamp(rect.left, margin, maxLeft),
      top: clamp(rect.bottom + gap, margin, maxTop),
    };
  }

  return {
    left: clamp(rect.right - panelWidth, margin, maxLeft),
    top: clamp(rect.bottom + gap, margin, maxTop),
  };
}

export function ServiceLauncher({
  items = DEFAULT_SERVICE_LAUNCHER_ITEMS,
  title = 'Сервисы',
  placement = 'bottom-end',
  buttonSize = 28,
  panelWidth = 220,
  zIndex = 5000,
  className,
  style,
  panelStyle,
}: ServiceLauncherProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelHeight = panelRef.current?.offsetHeight || 178;
    setPosition(getPanelPosition(rect, placement, panelWidth, panelHeight));
  }, [panelWidth, placement]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target)
        && !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    updatePosition();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) updatePosition();
  }, [items.length, open, updatePosition]);

  return (
    <div ref={rootRef} className={className} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: 8,
          background: open ? 'rgba(155,92,255,.18)' : 'var(--surface-soft-4)',
          border: `1px solid ${open ? 'rgba(155,92,255,.45)' : 'var(--border-hi)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: open ? '#B893FF' : 'var(--text-2)',
          transition: 'background .12s, border-color .12s, color .12s',
          padding: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
          <rect x="0" y="0" width="5.2" height="5.2" rx="1.2" />
          <rect x="7.8" y="0" width="5.2" height="5.2" rx="1.2" />
          <rect x="0" y="7.8" width="5.2" height="5.2" rx="1.2" />
          <rect x="7.8" y="7.8" width="5.2" height="5.2" rx="1.2" />
        </svg>
      </button>

      {open && position && createPortal((
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            zIndex,
            width: panelWidth,
            background: 'var(--card, #1C1C28)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '18px 16px 14px',
            boxShadow: '0 20px 60px rgba(0,0,0,.55), 0 4px 16px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06)',
            backdropFilter: 'blur(12px)',
            animation: 'serviceLauncherPanelIn .18s cubic-bezier(.22,.68,0,1.2) both',
            ...panelStyle,
          }}
        >
          <style>{`
            @keyframes serviceLauncherPanelIn {
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
            {title}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {items.map(item => (
              <a
                key={item.id}
                href={item.href}
                title={item.label.replace('\n', ' ')}
                role="menuitem"
                target={item.target}
                rel={item.rel || (item.target === '_blank' ? 'noopener noreferrer' : undefined)}
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
                onClick={() => setOpen(false)}
                onMouseEnter={event => { event.currentTarget.style.background = 'var(--surface-soft-4)'; }}
                onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 50,
                  height: 50,
                  borderRadius: 15,
                  background: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 16px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.24)',
                  flexShrink: 0,
                }}>
                  {item.icon}
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: 1.25,
                  color: 'var(--text-2)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {item.label}
                </span>
              </a>
            ))}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
