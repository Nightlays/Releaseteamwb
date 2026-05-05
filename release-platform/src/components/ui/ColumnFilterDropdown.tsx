import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnFilterDropdownProps {
  label: ReactNode;
  values: string[];
  selectedValues: string[];
  onChange: (value: string[]) => void;
  searchPlaceholder?: string;
  resetLabel?: string;
  emptyText?: string;
  boundarySelector?: string;
}

function labelToText(label: ReactNode) {
  return typeof label === 'string' || typeof label === 'number' ? String(label) : 'Фильтр';
}

function FilterIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M2.25 3.25h11.5L9.35 8.4v3.55l-2.7 1.35V8.4L2.25 3.25Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.16 : 0}
      />
    </svg>
  );
}

export function ColumnFilterDropdown({
  label,
  values,
  selectedValues,
  onChange,
  searchPlaceholder = 'Поиск',
  resetLabel = 'Сбросить все',
  emptyText = 'Значений не найдено',
  boundarySelector = '[data-canonical-table-scroll="true"]',
}: ColumnFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [panelWidth, setPanelWidth] = useState(280);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const labelText = labelToText(label);
  const active = selectedValues.length > 0;
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const canResetAll = selectedValues.length > 0;
  const filteredValues = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    if (!needle) return values;
    return values.filter(item => item.toLocaleLowerCase('ru-RU').includes(needle));
  }, [query, values]);

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const boundary = boundarySelector
      ? buttonRef.current?.closest(boundarySelector) as HTMLElement | null
      : null;
    const boundaryRect = boundary?.getBoundingClientRect();
    const boundaryLeft = Math.max(12, boundaryRect?.left ?? 12);
    const boundaryRight = Math.min(window.innerWidth - 12, boundaryRect?.right ?? window.innerWidth - 12);
    const width = Math.min(280, Math.max(220, boundaryRight - boundaryLeft));
    const gap = 8;
    const left = Math.min(Math.max(boundaryLeft, rect.right - width), Math.max(boundaryLeft, boundaryRight - width));
    const top = Math.min(rect.bottom + gap, Math.max(12, window.innerHeight - 320));
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
    <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 22px', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        title={active ? `Фильтр активен: ${selectedValues.length}` : 'Фильтр'}
        aria-label={active ? `Фильтр активен: ${selectedValues.length}` : `Открыть фильтр ${labelText}`}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          updatePosition();
          setOpen(true);
        }}
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          border: `1px solid ${active ? 'rgba(168,85,247,.55)' : 'var(--border-hi)'}`,
          background: active ? 'rgba(168,85,247,.16)' : 'var(--card)',
          color: active ? 'var(--accent)' : 'var(--text-3)',
          boxShadow: active ? '0 0 0 2px rgba(168,85,247,.08)' : 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <FilterIcon active={active} />
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
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.34)',
            color: 'var(--text)',
            textTransform: 'none',
            textAlign: 'left',
          }}
        >
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            style={{
              width: '100%',
              height: 32,
              padding: '0 10px',
              borderRadius: 8,
              border: '1px solid var(--border-hi)',
              background: 'var(--surface-soft-2)',
              color: 'var(--text)',
              outline: 'none',
              fontSize: 12,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'auto', paddingRight: 2 }}>
            <button
              type="button"
              disabled={!canResetAll}
              onClick={() => {
                if (canResetAll) onChange([]);
              }}
              style={{
                minHeight: 30,
                padding: '6px 8px',
                borderRadius: 7,
                textAlign: 'left',
                fontSize: 12,
                fontWeight: 700,
                background: canResetAll ? 'var(--surface-soft-4)' : 'transparent',
                color: canResetAll ? 'var(--text)' : 'var(--text-3)',
                border: '1px solid transparent',
                cursor: canResetAll ? 'pointer' : 'not-allowed',
                opacity: canResetAll ? 1 : 0.55,
              }}
            >
              {resetLabel}
            </button>
            {filteredValues.map(item => {
              const selected = selectedSet.has(item);
              return (
                <label
                  key={item}
                  title={item}
                  onClick={event => event.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 30,
                    padding: '6px 8px',
                    borderRadius: 7,
                    textAlign: 'left',
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'transparent',
                    color: 'var(--text-2)',
                    border: '1px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      onChange(selected
                        ? selectedValues.filter(value => value !== item)
                        : [...selectedValues, item]);
                    }}
                    style={{ width: 14, height: 14, flexShrink: 0, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item}</span>
                </label>
              );
            })}
            {!filteredValues.length && (
              <div style={{ padding: '10px 8px', color: 'var(--text-3)', fontSize: 12 }}>
                {emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
