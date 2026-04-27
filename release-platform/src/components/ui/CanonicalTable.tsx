import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export interface CanonicalTableColumn<T> {
  id: string;
  title: ReactNode;
  group?: ReactNode;
  groupKey?: string;
  width?: number | string;
  align?: React.CSSProperties['textAlign'];
  render?: (row: T) => ReactNode;
  text?: (row: T) => string;
  preview?: (row: T) => ReactNode;
  previewTitle?: (row: T) => ReactNode;
  cellStyle?: React.CSSProperties | ((row: T) => React.CSSProperties);
  headerStyle?: React.CSSProperties;
  lineClamp?: number;
  disablePreview?: boolean;
  showOverflowMarker?: boolean;
  sticky?: 'left';
}

export interface CanonicalTableProps<T> {
  rows: T[];
  columns: Array<CanonicalTableColumn<T>>;
  getRowKey: (row: T, index: number) => React.Key;
  emptyText?: string;
  rowHeight?: number;
  maxHeight?: number | string;
  minWidth?: number | string;
  overscanRight?: number;
}

interface HoverPreview {
  left: number;
  top: number;
  title: ReactNode;
  body: ReactNode;
}

function cssSize(value: number | string | undefined) {
  return typeof value === 'number' ? `${value}px` : value;
}

function textFromNode(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function isMeaningfulPreview(value: ReactNode) {
  const text = textFromNode(value).trim();
  if (text) return text !== '-';
  return value != null && value !== false && value !== '';
}

function getPreviewPosition(clientX: number, clientY: number) {
  const width = Math.min(460, Math.max(280, window.innerWidth - 32));
  const height = 300;
  const gap = 12;
  const left = Math.min(Math.max(16, clientX + gap), Math.max(16, window.innerWidth - width - 16));
  const below = clientY + gap;
  const top = below + height <= window.innerHeight - 16
    ? below
    : Math.max(16, clientY - height - gap);
  return { left, top };
}

export function CanonicalTable<T>({
  rows,
  columns,
  getRowKey,
  emptyText = 'Нет данных.',
  rowHeight = 72,
  maxHeight = '70vh',
  minWidth,
  overscanRight = 16,
}: CanonicalTableProps<T>) {
  const [hover, setHover] = useState<HoverPreview | null>(null);
  const [clippedCells, setClippedCells] = useState<Set<string>>(() => new Set());
  const closeTimerRef = useRef<number | null>(null);
  const hasGroups = columns.some(column => column.group || column.groupKey);
  const stickyLeftOffsets = useMemo(() => {
    let left = 0;
    return columns.map(column => {
      if (column.sticky !== 'left') return null;
      const offset = left;
      left += typeof column.width === 'number' ? column.width : 0;
      return offset;
    });
  }, [columns]);

  const updateClippedCell = (key: string, clipped: boolean) => {
    setClippedCells(prev => {
      if (prev.has(key) === clipped) return prev;
      const next = new Set(prev);
      if (clipped) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const closePreview = () => {
    clearCloseTimer();
    setHover(null);
  };

  const scheduleClosePreview = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setHover(null);
      closeTimerRef.current = null;
    }, 120);
  };

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: ReactNode; span: number }> = [];
    columns.forEach(column => {
      const key = column.groupKey || String(column.group || column.id);
      const label = column.group || column.title;
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.span += 1;
      } else {
        out.push({ key, label, span: 1 });
      }
    });
    return out;
  }, [columns]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        style={{
          width: '100%',
          maxHeight,
          overflow: 'auto',
          paddingRight: overscanRight,
          border: '1.5px solid var(--border-hi)',
          borderRadius: 8,
          background: 'var(--card)',
          boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        }}
        onMouseLeave={scheduleClosePreview}
      >
        <table
          style={{
            width: '100%',
            minWidth: cssSize(minWidth),
            tableLayout: 'fixed',
            borderCollapse: 'separate',
            borderSpacing: 0,
          }}
        >
          <colgroup>
            {columns.map(column => (
              <col key={column.id} style={{ width: cssSize(column.width) }} />
            ))}
          </colgroup>
          <thead>
            {hasGroups && (
              <tr>
                {groups.map(group => (
                  <th
                    key={group.key}
                    colSpan={group.span}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 4,
                      padding: '10px 12px',
                      borderRight: '1px solid var(--border-hi)',
                      borderBottom: '1.5px solid var(--border-hi)',
                      background: 'var(--card-hi)',
                      backgroundClip: 'padding-box',
                      color: 'var(--text)',
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      textAlign: 'center',
                    }}
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns.map((column, columnIndex) => {
                const stickyLeft = stickyLeftOffsets[columnIndex];
                const isStickyLeft = typeof stickyLeft === 'number';
                const headerBg = 'var(--card-hi)';
                return (
                <th
                  key={column.id}
                  style={{
                    position: 'sticky',
                    top: hasGroups ? 39 : 0,
                    left: isStickyLeft ? stickyLeft : undefined,
                    zIndex: isStickyLeft ? 7 : 3,
                    height: 40,
                    padding: '8px 10px',
                    borderRight: '1px solid var(--border-hi)',
                    borderBottom: '1.5px solid var(--border-hi)',
                    background: headerBg,
                    backgroundClip: 'padding-box',
                    boxShadow: isStickyLeft ? '3px 0 0 var(--border-hi), 10px 0 16px -16px rgba(0,0,0,.65)' : '0 2px 0 var(--border-hi)',
                    color: 'var(--text-2)',
                    fontSize: 10.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    textAlign: 'center',
                    lineHeight: 1.2,
                    whiteSpace: 'normal',
                    ...column.headerStyle,
                  }}
                >
                  {column.title}
                </th>
              );
              })}
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    color: 'var(--text-3)',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((row, rowIndex) => (
              <tr key={getRowKey(row, rowIndex)} style={{ height: rowHeight }}>
                {columns.map((column, columnIndex) => {
                  const rowKey = getRowKey(row, rowIndex);
                  const cellKey = `${String(rowKey)}:${column.id}`;
                  const rendered = column.render ? column.render(row) : column.text?.(row) || '';
                  const previewBody = column.preview ? column.preview(row) : column.text?.(row);
                  const title = column.previewTitle ? column.previewTitle(row) : column.title;
                  const cellStyle = typeof column.cellStyle === 'function' ? column.cellStyle(row) : column.cellStyle;
                  const canPreview = !column.disablePreview && isMeaningfulPreview(previewBody);
                  const rowBg = rowIndex % 2 === 0 ? 'var(--card)' : 'var(--surface-soft)';
                  const stickyRowBg = rowIndex % 2 === 0 ? 'var(--card)' : 'var(--card-hi)';
                  const stickyLeft = stickyLeftOffsets[columnIndex];
                  const isStickyLeft = typeof stickyLeft === 'number';
                  const cellBg = isStickyLeft ? stickyRowBg : rowBg;

                  return (
                    <td
                      key={column.id}
                      onMouseEnter={event => {
                        clearCloseTimer();
                        if (!canPreview) return;
                        const content = event.currentTarget.querySelector('[data-canonical-cell-content="true"]') as HTMLElement | null;
                        const clipped = content
                          ? content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1
                          : true;
                        if (!clipped) return;
                        const position = getPreviewPosition(event.clientX, event.clientY);
                        setHover({ ...position, title, body: previewBody });
                      }}
                      onMouseLeave={scheduleClosePreview}
                      style={{
                        position: isStickyLeft ? 'sticky' : 'relative',
                        left: isStickyLeft ? stickyLeft : undefined,
                        zIndex: isStickyLeft ? 2 : 1,
                        height: rowHeight,
                        maxHeight: rowHeight,
                        padding: '8px 10px',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border-hi)',
                        color: 'var(--text-2)',
                        fontSize: 12,
                        verticalAlign: 'top',
                        background: cellBg,
                        backgroundClip: 'padding-box',
                        boxShadow: isStickyLeft ? '3px 0 0 var(--border-hi), 10px 0 16px -16px rgba(0,0,0,.65)' : undefined,
                        textAlign: column.align || 'left',
                        ...cellStyle,
                      }}
                    >
                      <div
                        data-canonical-cell-content="true"
                        ref={element => {
                          if (!element) return;
                          window.requestAnimationFrame(() => {
                            updateClippedCell(cellKey, element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
                          });
                        }}
                        style={{
                          maxHeight: rowHeight - 16,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: column.lineClamp || 3,
                          WebkitBoxOrient: 'vertical',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                          lineHeight: 1.38,
                        }}
                      >
                        {rendered || '-'}
                      </div>
                      {canPreview && column.showOverflowMarker !== false && clippedCells.has(cellKey) && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            right: 6,
                            bottom: 5,
                            padding: '0 4px 1px 14px',
                            background: `linear-gradient(90deg, rgba(255,255,255,0), ${cellBg} 38%)`,
                            color: 'var(--text-3)',
                            fontWeight: 900,
                            fontSize: 13,
                            lineHeight: 1,
                            pointerEvents: 'none',
                          }}
                        >
                          ...
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && (
        <div
          onMouseEnter={clearCloseTimer}
          onMouseLeave={closePreview}
          style={{
            position: 'fixed',
            left: hover.left,
            top: hover.top,
            zIndex: 600,
            width: 'min(460px, calc(100vw - 32px))',
            maxHeight: '300px',
            overflow: 'auto',
            pointerEvents: 'auto',
            padding: 14,
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.32)',
            color: 'var(--text)',
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text-3)', fontWeight: 800, textTransform: 'uppercase' }}>
            {hover.title}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12.5, lineHeight: 1.55 }}>
            {hover.body}
          </div>
        </div>
      )}
    </div>
  );
}
