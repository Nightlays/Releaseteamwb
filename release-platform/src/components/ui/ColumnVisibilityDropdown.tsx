import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnVisibilityOption {
  id: string;
  label: ReactNode;
  searchText?: string;
}

export interface ColumnVisibilityDropdownProps {
  columns: ColumnVisibilityOption[];
  visibleColumnIds: string[];
  onChange: (value: string[]) => void;
  allLabel?: string;
  boundarySelector?: string;
  buttonStyle?: React.CSSProperties;
}

function labelToText(value: ReactNode) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function EyeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M1.8 9s2.6-4.4 7.2-4.4S16.2 9 16.2 9s-2.6 4.4-7.2 4.4S1.8 9 1.8 9Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.12 : 0}
      />
      <path
        d="M9 10.9A1.9 1.9 0 1 0 9 7.1a1.9 1.9 0 0 0 0 3.8Z"
        stroke="currentColor"
        strokeWidth="1.45"
      />
    </svg>
  );
}

export function ColumnVisibilityDropdown({
  columns,
  visibleColumnIds,
  onChange,
  allLabel = 'Все',
  boundarySelector,
  buttonStyle,
}: ColumnVisibilityDropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [panelWidth, setPanelWidth] = useState(260);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const allIds = useMemo(() => columns.map(column => column.id), [columns]);
  const visibleSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]);
  const allVisible = columns.length > 0 && columns.every(column => visibleSet.has(column.id));
  const active = !allVisible;

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const boundary = boundarySelector
      ? buttonRef.current?.closest(boundarySelector) as HTMLElement | null
      : null;
    const boundaryRect = boundary?.getBoundingClientRect();
    const boundaryLeft = Math.max(12, boundaryRect?.left ?? 12);
    const boundaryRight = Math.min(window.innerWidth - 12, boundaryRect?.right ?? window.innerWidth - 12);
    const width = Math.min(280, Math.max(230, boundaryRight - boundaryLeft));
    const gap = 8;
    const left = Math.min(Math.max(boundaryLeft, rect.left), Math.max(boundaryLeft, boundaryRight - width));
    const top = Math.min(rect.bottom + gap, Math.max(12, window.innerHeight - 360));
    setPanelWidth(width);
    setPosition({ left, top });
  }, [boundarySelector]);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        title={active ? 'Есть скрытые колонки' : 'Показ колонок'}
        aria-label={active ? 'Есть скрытые колонки' : 'Настроить показ колонок'}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          updatePosition();
          setOpen(true);
        }}
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          border: `1px solid ${active ? 'rgba(168,85,247,.58)' : 'var(--border-hi)'}`,
          background: active ? 'rgba(168,85,247,.16)' : 'var(--surface-soft-3)',
          color: active ? 'var(--accent)' : 'var(--text-2)',
          boxShadow: active ? '0 0 0 2px rgba(168,85,247,.08)' : 'none',
          cursor: 'pointer',
          padding: 0,
          ...buttonStyle,
        }}
      >
        <EyeIcon active={active} />
      </button>
      {open && (
        <div
          ref={panelRef}
          onClick={event => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            zIndex: 850,
            width: panelWidth,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 10,
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.34)',
            color: 'var(--text)',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 32,
              padding: '7px 8px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-2)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={allVisible}
              onChange={() => onChange(allVisible ? [] : allIds)}
              style={{ width: 14, height: 14, accentColor: 'var(--accent)' }}
            />
            <span>{allLabel}</span>
          </label>
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'auto', paddingRight: 2 }}>
            {columns.map(column => {
              const visible = visibleSet.has(column.id);
              const text = column.searchText || labelToText(column.label) || column.id;
              return (
                <label
                  key={column.id}
                  title={text}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 30,
                    padding: '6px 8px',
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'transparent',
                    color: 'var(--text-2)',
                    border: '1px solid transparent',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onChange(visible
                      ? visibleColumnIds.filter(id => id !== column.id)
                      : [...visibleColumnIds, column.id])}
                    style={{ width: 14, height: 14, flexShrink: 0, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
