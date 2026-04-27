import React, { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

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
export function Card({ children, style }: CardProps) {
  return (
    <div style={{
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

/* ─── SEGMENT CONTROL ────────────────────────────────────── */
interface SegItem { label: string; value: string; }
interface SegProps { items: SegItem[]; value: string; onChange: (v: string) => void; style?: React.CSSProperties; }

export function SegmentControl({ items, value, onChange, style }: SegProps) {
  return (
    <div style={{
      display: 'inline-flex', background: 'var(--surface-soft-3)',
      border: '1px solid var(--border)', borderRadius: 10, padding: 3, gap: 2, ...style,
    }}>
      {items.map(item => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          style={{
            padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: 'none', fontFamily: 'inherit', transition: 'all .12s',
            background: value === item.value ? 'var(--card-hi)' : 'transparent',
            color:      value === item.value ? 'var(--text)' : 'var(--text-2)',
            boxShadow:  value === item.value ? 'var(--sh-sm)' : 'none',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
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
interface LogProps { lines: Array<{ text: string; level?: 'info' | 'ok' | 'warn' | 'error' }>; maxHeight?: number; }
const LOG_COLORS = { info: 'var(--text-2)', ok: '#4ADE80', warn: '#FCD34D', error: '#F87171' };

export function LogView({ lines, maxHeight = 220 }: LogProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  return (
    <div ref={ref} style={{
      fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px', maxHeight, overflowY: 'auto', color: 'var(--text-2)',
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
      style={{ position: 'fixed', inset: 0, background: 'var(--backdrop)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
export function Table({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: '0 0 18px 18px', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
    </div>
  );
}

export function Th({ children, style }: { children?: ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-3)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', ...style }}>
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
