import React, { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, useLayoutEffect, useRef, useState } from 'react';
export { CanonicalTable, type CanonicalTableColumn } from './CanonicalTable';
export { ColumnFilterDropdown, type ColumnFilterDropdownProps } from './ColumnFilterDropdown';
export { ColumnVisibilityDropdown, type ColumnVisibilityDropdownProps, type ColumnVisibilityOption } from './ColumnVisibilityDropdown';

/* ─── BUTTON ─────────────────────────────────────────────── */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type BtnSize    = 'sm' | 'md';

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?:    BtnSize;
  children: ReactNode;
}

const BTN_BASE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all .1s',
  borderRadius: 10, fontFamily: 'inherit',
};

const BTN_VARIANTS: Record<BtnVariant, React.CSSProperties> = {
  primary:   { background: 'linear-gradient(135deg,#9B5CFF,#CB11AB)', color: '#fff', boxShadow: '0 4px 14px rgba(155,92,255,.35)' },
  secondary: { background: 'var(--surface-soft-4)', border: '1px solid var(--border)', color: 'var(--text-2)' },
  ghost:     { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' },
  danger:    { background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.2)', color: '#F87171' },
  icon:      { background: 'var(--surface-soft-4)', border: '1px solid var(--border)', color: 'var(--text-2)', width: 32, height: 32, padding: 0 },
};

const BTN_SIZES: Record<BtnSize, React.CSSProperties> = {
  sm: { padding: '5px 10px', fontSize: 11 },
  md: { padding: '7px 14px', fontSize: 13 },
};

export function Button({ variant = 'secondary', size = 'md', children, style, ...rest }: BtnProps) {
  return (
    <button
      style={{ ...BTN_BASE, ...BTN_VARIANTS[variant], ...BTN_SIZES[size], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ─── BADGE ──────────────────────────────────────────────── */
type BadgeColor = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'gray' | 'cyan';

const BADGE_COLORS: Record<BadgeColor, React.CSSProperties> = {
  green:  { background: 'rgba(34,197,94,.1)',   borderColor: 'rgba(34,197,94,.2)',    color: '#4ADE80' },
  red:    { background: 'rgba(239,68,68,.1)',   borderColor: 'rgba(239,68,68,.2)',    color: '#F87171' },
  yellow: { background: 'rgba(245,158,11,.1)',  borderColor: 'rgba(245,158,11,.2)',   color: '#FCD34D' },
  blue:   { background: 'rgba(59,130,246,.1)',  borderColor: 'rgba(59,130,246,.2)',   color: '#93C5FD' },
  purple: { background: 'rgba(155,92,255,.12)', borderColor: 'rgba(155,92,255,.25)',  color: '#C4B5FD' },
  gray:   { background: 'var(--surface-soft-4)', borderColor: 'var(--border-hi)', color: 'var(--text-2)' },
  cyan:   { background: 'rgba(6,182,212,.1)',   borderColor: 'rgba(6,182,212,.2)',    color: '#67E8F9' },
};

interface BadgeProps { color?: BadgeColor; children: ReactNode; dot?: boolean; style?: React.CSSProperties; }
export function Badge({ color = 'gray', children, dot, style }: BadgeProps) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      border: '1px solid', ...BADGE_COLORS[color], ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: 'pulse-dot 2s infinite' }} />}
      {children}
    </span>
  );
}

/* ─── CARD ───────────────────────────────────────────────── */
interface CardProps { children: ReactNode; style?: React.CSSProperties; className?: string; }
export function Card({ children, style, className }: CardProps) {
  return (
    <div className={className} style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 18, ...style,
    }}>
      {children}
    </div>
  );
}

export function CardHeader({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0', ...style }}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{children}</div>;
}

export function CardHint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{children}</div>;
}

export function CardBody({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ padding: '14px 16px', ...style }}>{children}</div>;
}

export function Divider({ style }: { style?: React.CSSProperties }) {
  return <div style={{ height: 1, background: 'var(--border)', ...style }} />;
}

/* ─── INPUT ──────────────────────────────────────────────── */
const inputBase: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface-soft-2)', color: 'var(--text)',
  fontSize: 13, outline: 'none', fontFamily: 'inherit',
  transition: 'border-color .15s, box-shadow .15s',
};

export function Input({ style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = React.useState(false);
  return (
    <input
      style={{ ...inputBase, ...(focused ? { borderColor: 'rgba(155,92,255,.5)', boxShadow: '0 0 0 3px rgba(155,92,255,.12)' } : {}), ...style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      {...props}
    />
  );
}

export function Select({ style, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      style={{ ...inputBase, ...style }}
      {...props}
    />
  );
}

interface CanonicalValueSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  clearLabel?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function CanonicalValueSelect({
  value,
  options,
  onChange,
  placeholder = 'Выбрать значение',
  searchPlaceholder = 'Поиск',
  emptyText = 'Значений не найдено',
  clearLabel = 'Сбросить',
  disabled = false,
  style,
}: CanonicalValueSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [position, setPosition] = React.useState({ left: 0, top: 0, width: 280 });
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const normalizedOptions = React.useMemo(() => (
    Array.from(new Set(options.map(option => String(option || '').trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, 'ru', { sensitivity: 'base' }))
  ), [options]);
  const filteredOptions = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    if (!needle) return normalizedOptions;
    return normalizedOptions.filter(option => option.toLocaleLowerCase('ru-RU').includes(needle));
  }, [normalizedOptions, query]);

  const updatePosition = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, Math.max(260, rect.width));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 320));
    setPosition({ left, top, width });
  }, []);

  React.useEffect(() => {
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
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          updatePosition();
          setOpen(true);
        }}
        style={{
          ...inputBase,
          height: 36,
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 16px',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.64 : 1,
          ...style,
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--text)' : 'var(--text-3)' }}>
          {value || placeholder}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          onClick={event => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            zIndex: 6500,
            width: position.width,
            maxHeight: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.34)',
            color: 'var(--text)',
          }}
        >
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            style={{
              ...inputBase,
              height: 32,
              padding: '0 10px',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <div style={{ maxHeight: 218, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, paddingRight: 2 }}>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
                setQuery('');
              }}
              style={{
                minHeight: 30,
                padding: '6px 8px',
                borderRadius: 7,
                border: '1px solid transparent',
                background: value ? 'var(--surface-soft-4)' : 'transparent',
                color: value ? 'var(--text)' : 'var(--text-3)',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 750,
                cursor: 'pointer',
              }}
            >
              {clearLabel}
            </button>
            {filteredOptions.map(option => {
              const selected = option === value;
              return (
                <button
                  key={option}
                  type="button"
                  title={option}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={{
                    minHeight: 30,
                    padding: '6px 8px',
                    borderRadius: 7,
                    border: `1px solid ${selected ? 'rgba(168,85,247,.34)' : 'transparent'}`,
                    background: selected ? 'rgba(168,85,247,.14)' : 'transparent',
                    color: selected ? 'var(--accent)' : 'var(--text-2)',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: selected ? 800 : 650,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {option}
                </button>
              );
            })}
            {!filteredOptions.length && (
              <div style={{ padding: '12px 8px', color: 'var(--text-3)', fontSize: 12 }}>
                {emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function Textarea({ style, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = React.useState(false);
  return (
    <textarea
      style={{ ...inputBase, resize: 'vertical', ...(focused ? { borderColor: 'rgba(155,92,255,.5)', boxShadow: '0 0 0 3px rgba(155,92,255,.12)' } : {}), ...style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      {...props}
    />
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 5 }}>{children}</label>;
}

/* ─── PROGRESS BAR ───────────────────────────────────────── */
type ProgressColor = 'accent' | 'green' | 'yellow' | 'red';
const PROG_COLORS: Record<ProgressColor, string> = {
  accent: 'linear-gradient(135deg,#9B5CFF,#CB11AB)',
  green:  '#22C55E',
  yellow: '#F59E0B',
  red:    '#EF4444',
};

interface ProgressProps { value: number; max?: number; color?: ProgressColor; height?: number; style?: React.CSSProperties; }
export function Progress({ value, max = 100, color = 'accent', height = 5, style }: ProgressProps) {
  const pct = Math.round(Math.min(100, Math.max(0, (value / max) * 100)));
  const c = color === 'accent' ? PROG_COLORS.accent :
            color === 'green'  && pct >= 90 ? PROG_COLORS.green :
            color === 'yellow' ? PROG_COLORS.yellow :
            color === 'red'    ? PROG_COLORS.red : PROG_COLORS.accent;
  return (
    <div style={{ height, borderRadius: 99, background: 'var(--surface-soft-5)', overflow: 'hidden', ...style }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: c, transition: 'width .4s ease' }} />
    </div>
  );
}

type RunStatusTone = 'neutral' | 'ok' | 'warn' | 'error';

interface CanonicalRunLineProps {
  controls: ReactNode;
  actions: ReactNode;
  showStatus?: boolean;
  status?: ReactNode;
  statusTone?: RunStatusTone;
  progress?: number;
  progressMax?: number;
  progressColor?: ProgressColor;
  progressLabel?: ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

const RUN_STATUS_COLORS: Record<RunStatusTone, string> = {
  neutral: 'var(--text-2)',
  ok: '#4ADE80',
  warn: '#FCD34D',
  error: '#F87171',
};

export function CanonicalRunLine({
  controls,
  actions,
  showStatus = false,
  status,
  statusTone = 'neutral',
  progress = 0,
  progressMax = 100,
  progressColor = 'accent',
  progressLabel,
  style,
  bodyStyle,
}: CanonicalRunLineProps) {
  const safeProgress = Math.round(Math.min(progressMax, Math.max(0, progress)));
  return (
    <Card style={{ borderRadius: 10, border: '1.5px solid var(--border-hi)', boxShadow: '0 8px 22px rgba(15,23,42,.06)', ...style }}>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', ...bodyStyle }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            {controls}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {actions}
          </div>
        </div>
        {showStatus ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: RUN_STATUS_COLORS[statusTone] }}>{status}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{progressLabel ?? `${safeProgress}%`}</span>
            </div>
            <Progress value={progress} max={progressMax} color={progressColor} height={7} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ─── SEGMENT CONTROL ────────────────────────────────────── */
interface SegItem { label: ReactNode; value: string; disabled?: boolean; title?: string; }
interface SegProps {
  items: SegItem[];
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
  activeButtonStyle?: React.CSSProperties;
  inactiveButtonStyle?: React.CSSProperties;
  activeMode?: 'fill' | 'underline';
  indicatorStyle?: React.CSSProperties;
  showSeparators?: boolean;
}

export function SegmentControl({
  items,
  value,
  onChange,
  style,
  buttonStyle,
  activeButtonStyle,
  inactiveButtonStyle,
  activeMode = 'fill',
  indicatorStyle,
  showSeparators = true,
}: SegProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ left: number; top: number; text: string } | null>(null);
  const underline = activeMode === 'underline';

  useLayoutEffect(() => {
    if (!underline) return undefined;

    const updateIndicator = () => {
      const root = rootRef.current;
      const button = buttonRefs.current[value];
      if (!root || !button) {
        setIndicator(null);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const target = button.querySelector<HTMLElement>('[data-segment-indicator-target="true"]');
      const targetRect = target?.getBoundingClientRect();
      const targetPadding = 8;
      const width = targetRect
        ? Math.max(18, Math.min(buttonRect.width - 10, targetRect.width + targetPadding))
        : Math.max(18, buttonRect.width - 18);
      setIndicator({
        left: targetRect
          ? targetRect.left - rootRect.left - (width - targetRect.width) / 2
          : buttonRect.left - rootRect.left + (buttonRect.width - width) / 2,
        width,
      });
    };

    updateIndicator();
    const frame = window.requestAnimationFrame(updateIndicator);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateIndicator) : null;
    if (resizeObserver && rootRef.current) resizeObserver.observe(rootRef.current);
    window.addEventListener('resize', updateIndicator);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateIndicator);
    };
  }, [items, underline, value]);

  return (
    <>
      <div ref={rootRef} style={{
        position: 'relative',
        display: 'inline-flex', background: 'var(--surface-soft-3)',
        border: '1px solid var(--border)', borderRadius: 10, padding: 3, gap: 2, ...style,
      }}>
        {underline && indicator && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              bottom: 3,
              width: indicator.width,
              height: 3,
              borderRadius: 99,
              background: 'linear-gradient(90deg,var(--accent),var(--accent-2))',
              boxShadow: '0 4px 12px rgba(155,92,255,.34)',
              transform: `translateX(${indicator.left}px)`,
              transition: 'transform .24s cubic-bezier(.2,.8,.2,1), width .24s cubic-bezier(.2,.8,.2,1)',
              pointerEvents: 'none',
              ...indicatorStyle,
            }}
          />
        )}
        {items.map((item, index) => {
          const active = value === item.value;
          const disabled = Boolean(item.disabled);
          const label = typeof item.label === 'string' || typeof item.label === 'number'
            ? <span data-segment-indicator-target="true">{item.label}</span>
            : item.label;
          return (
            <button
              key={item.value}
              ref={element => {
                buttonRefs.current[item.value] = element;
              }}
              type="button"
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : undefined}
              onMouseEnter={event => {
                if (!disabled || !item.title) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setTooltip({ text: item.title, left: rect.left + rect.width / 2, top: rect.bottom + 7 });
              }}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (!disabled) onChange(item.value);
              }}
              style={{
                position: 'relative',
                zIndex: 1,
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
                border: 'none', fontFamily: 'inherit', transition: 'color .16s ease, background .16s ease, opacity .16s ease',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                background: underline ? 'transparent' : active ? 'var(--card-hi)' : 'transparent',
                color: active ? (underline ? 'var(--accent)' : 'var(--text)') : 'var(--text-2)',
                boxShadow: underline ? 'none' : active ? 'var(--sh-sm)' : 'none',
                ...buttonStyle,
                ...(active ? activeButtonStyle : inactiveButtonStyle),
                ...(showSeparators && index < items.length - 1 && underline ? { borderRight: '1px solid var(--border)' } : {}),
                ...(disabled ? {
                  background: 'var(--surface-soft-4)',
                  color: 'var(--text-3)',
                  borderColor: 'var(--border)',
                  boxShadow: 'none',
                  opacity: 0.72,
                } : {}),
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.left,
            top: tooltip.top,
            zIndex: 1200,
            transform: 'translateX(-50%)',
            maxWidth: 260,
            padding: '7px 9px',
            borderRadius: 8,
            border: '1px solid var(--border-hi)',
            background: 'var(--card)',
            color: 'var(--text-2)',
            boxShadow: '0 14px 34px rgba(0,0,0,.22)',
            fontSize: 11,
            fontWeight: 750,
            lineHeight: 1.35,
            pointerEvents: 'none',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}

/* ─── STATUS PILL ────────────────────────────────────────── */
type PillStatus = 'live' | 'warn' | 'error' | 'neutral';
const PILL_STYLES: Record<PillStatus, React.CSSProperties> = {
  live:    { background: 'rgba(34,197,94,.1)',  borderColor: 'rgba(34,197,94,.25)',  color: '#4ADE80' },
  warn:    { background: 'rgba(245,158,11,.1)', borderColor: 'rgba(245,158,11,.25)', color: '#FCD34D' },
  error:   { background: 'rgba(239,68,68,.1)',  borderColor: 'rgba(239,68,68,.25)',  color: '#F87171' },
  neutral: { background: 'var(--surface-soft-3)', borderColor: 'var(--border-hi)', color: 'var(--text-2)' },
};

export function StatusPill({ status, children }: { status: PillStatus; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, border: '1px solid',
      ...PILL_STYLES[status],
    }}>
      {status === 'live' && (
        <span style={{ width: 6, height: 6, borderRadius: 99, background: '#22C55E' }} />
      )}
      {children}
    </span>
  );
}

/* ─── LOG ────────────────────────────────────────────────── */
interface LogProps {
  lines: Array<{ text: string; level?: 'info' | 'ok' | 'warn' | 'error' }>;
  maxHeight?: number | string;
  style?: React.CSSProperties;
}
const LOG_COLORS = { info: 'var(--text-2)', ok: '#4ADE80', warn: '#FCD34D', error: '#F87171' };

export function LogView({ lines, maxHeight = 220, style }: LogProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  return (
    <div ref={ref} style={{
      fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px', maxHeight, overflowY: 'auto', color: 'var(--text-2)',
      ...style,
    }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: LOG_COLORS[l.level ?? 'info'] }}>{l.text}</div>
      ))}
    </div>
  );
}

/* ─── MODAL ──────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, width = 560 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number;
}) {
  if (!open) return null;
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'var(--backdrop)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={onClose}
    >
      <div
        style={{ background: 'var(--card)', border: '1px solid var(--border-hi)', borderRadius: 18, width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--modal-shadow)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{title}</span>
          <button onClick={onClose} style={{ color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', border: 'none', background: 'none' }}>✕</button>
        </div>
        <div style={{ padding: '16px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

/* ─── TABLE ──────────────────────────────────────────────── */
export function Table({ children, style, tableStyle }: { children: ReactNode; style?: React.CSSProperties; tableStyle?: React.CSSProperties }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: '0 0 18px 18px', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...tableStyle }}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  style,
  ...props
}: {
  children?: ReactNode;
  style?: React.CSSProperties;
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...props} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', ...style }}>
      {children}
    </th>
  );
}

export function Td({
  children,
  style,
  mono,
  bold,
  ...props
}: {
  children?: ReactNode;
  style?: React.CSSProperties;
  mono?: boolean;
  bold?: boolean;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      style={{
        padding: '11px 14px',
        fontSize: 12,
        color: bold ? 'var(--text)' : 'var(--text-2)',
        borderBottom: '1px solid var(--border-subtle)',
        verticalAlign: 'middle',
        fontFamily: mono ? 'var(--mono)' : undefined,
        fontWeight: bold ? 600 : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

/* ─── EMPTY STATE ────────────────────────────────────────── */
export function EmptyState({ icon = '◈', text }: { icon?: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 20px', color: 'var(--text-3)' }}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <span style={{ fontSize: 13 }}>{text}</span>
    </div>
  );
}

/* ─── INFO ROW ───────────────────────────────────────────── */
export function InfoRow({ label, value, valueStyle }: { label: string; value: ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', ...valueStyle }}>{value}</span>
    </div>
  );
}
