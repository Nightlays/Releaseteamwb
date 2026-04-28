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
  previewTrigger?: 'hover' | 'button';
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
  loading?: boolean;
  loadingText?: ReactNode;
  isRowHighlighted?: (row: T, index: number) => boolean;
}

interface TablePreview {
  left: number;
  top: number;
  title: ReactNode;
  body: ReactNode;
  mode: 'hover' | 'button';
}

const GROUP_HEADER_HEIGHT = 38;

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

function getPreviewPosition(clientX: number, clientY: number, anchorRect: DOMRect) {
  const width = Math.min(460, Math.max(280, window.innerWidth - 32));
  const height = 300;
  const gap = 12;
  const maxLeft = Math.max(16, window.innerWidth - width - 16);
  const anchorLeft = anchorRect.left + gap;
  const anchorRightAligned = anchorRect.right - width - gap;
  const preferredLeft = anchorLeft + width <= window.innerWidth - 16 ? anchorLeft : anchorRightAligned;
  const left = Math.min(Math.max(16, preferredLeft), maxLeft);
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
  loading = false,
  loadingText = 'Загружаю данные...',
  isRowHighlighted,
}: CanonicalTableProps<T>) {
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [clippedCells, setClippedCells] = useState<Set<string>>(() => new Set());
  const closeTimerRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
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
    setPreview(null);
  };

  const scheduleClosePreview = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setPreview(prev => prev?.mode === 'button' ? prev : null);
      closeTimerRef.current = null;
    }, 120);
  };

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (preview?.mode !== 'button') return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && previewRef.current?.contains(target)) return;
      setPreview(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [preview?.mode]);

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
        data-canonical-table-scroll="true"
        aria-busy={loading}
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
                      height: GROUP_HEADER_HEIGHT,
                      padding: '10px 12px',
                      borderRight: '1px solid var(--border-hi)',
                      borderBottom: '1.5px solid var(--border-hi)',
                      background: 'var(--card-hi)',
                      backgroundClip: 'border-box',
                      boxShadow: '0 3px 0 var(--card-hi), 0 4px 0 var(--border-hi)',
                      color: 'var(--text)',
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      lineHeight: 1.1,
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
                    top: hasGroups ? GROUP_HEADER_HEIGHT : 0,
                    left: isStickyLeft ? stickyLeft : undefined,
                    zIndex: isStickyLeft ? 7 : 3,
                    height: 40,
                    padding: '8px 10px',
                    borderRight: '1px solid var(--border-hi)',
                    borderBottom: '1.5px solid var(--border-hi)',
                    background: headerBg,
                    backgroundClip: 'border-box',
                    boxShadow: isStickyLeft
                      ? '3px 0 0 var(--border-hi), 0 4px 0 var(--card-hi), 0 5px 0 var(--border-hi), 10px 0 16px -16px rgba(0,0,0,.65)'
                      : '0 4px 0 var(--card-hi), 0 5px 0 var(--border-hi)',
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
            {loading && !rows.length && (
              <>
                <tr>
                  <td
                    colSpan={columns.length}
                    style={{
                      padding: '22px 24px',
                      textAlign: 'center',
                      color: 'var(--text-2)',
                      borderBottom: '1px solid var(--border-hi)',
                      background: 'var(--card)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        background: 'var(--surface-soft)',
                        boxShadow: '0 10px 28px rgba(0,0,0,.08)',
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: '2px solid rgba(168,85,247,.22)',
                          borderTopColor: 'var(--accent)',
                          animation: 'spin .8s linear infinite',
                        }}
                      />
                      <span>{loadingText}</span>
                    </div>
                  </td>
                </tr>
                {Array.from({ length: 5 }).map((_, skeletonRowIndex) => (
                  <tr key={`canonical-loader-${skeletonRowIndex}`} style={{ height: rowHeight }}>
                    {columns.map((column, columnIndex) => {
                      const stickyLeft = stickyLeftOffsets[columnIndex];
                      const isStickyLeft = typeof stickyLeft === 'number';
                      const rowBg = skeletonRowIndex % 2 === 0 ? 'var(--card)' : 'var(--card-hi)';
                      const widthSeed = ((skeletonRowIndex + 1) * (columnIndex + 3) * 17) % 36;
                      const barWidth = `${58 + widthSeed}%`;

                      return (
                        <td
                          key={column.id}
                          style={{
                            position: isStickyLeft ? 'sticky' : 'relative',
                            left: isStickyLeft ? stickyLeft : undefined,
                            zIndex: isStickyLeft ? 2 : 1,
                            height: rowHeight,
                            padding: '12px 10px',
                            borderRight: '1px solid var(--border)',
                            borderBottom: '1px solid var(--border-hi)',
                            background: rowBg,
                            backgroundClip: 'padding-box',
                            boxShadow: isStickyLeft ? '3px 0 0 var(--border-hi), 10px 0 16px -16px rgba(0,0,0,.65)' : undefined,
                          }}
                        >
                          <div
                            style={{
                              width: barWidth,
                              height: 12,
                              borderRadius: 999,
                              background: 'linear-gradient(90deg, var(--surface-soft), var(--surface-soft-2), var(--surface-soft))',
                              backgroundSize: '200% 100%',
                              animation: 'shimmer 1.4s ease-in-out infinite',
                            }}
                          />
                          <div
                            style={{
                              width: columnIndex % 3 === 0 ? '42%' : '68%',
                              height: 10,
                              marginTop: 10,
                              borderRadius: 999,
                              background: 'linear-gradient(90deg, var(--surface-soft), var(--surface-soft-2), var(--surface-soft))',
                              backgroundSize: '200% 100%',
                              animation: 'shimmer 1.4s ease-in-out infinite',
                              opacity: 0.75,
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            )}
            {!loading && !rows.length && (
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
                  const rowHighlighted = Boolean(isRowHighlighted?.(row, rowIndex));
                  const rendered = column.render ? column.render(row) : column.text?.(row) || '';
                  const previewBody = column.preview ? column.preview(row) : column.text?.(row);
                  const title = column.previewTitle ? column.previewTitle(row) : column.title;
                  const cellStyle = typeof column.cellStyle === 'function' ? column.cellStyle(row) : column.cellStyle;
                  const canPreview = !column.disablePreview && isMeaningfulPreview(previewBody);
                  const previewTrigger = column.previewTrigger || 'hover';
                  const isButtonPreview = canPreview && previewTrigger === 'button';
                  const rowBg = rowHighlighted
                    ? 'color-mix(in srgb, var(--accent) 13%, var(--card))'
                    : (rowIndex % 2 === 0 ? 'var(--card)' : 'var(--card-hi)');
                  const stickyRowBg = rowBg;
                  const stickyLeft = stickyLeftOffsets[columnIndex];
                  const isStickyLeft = typeof stickyLeft === 'number';
                  const cellBg = isStickyLeft ? stickyRowBg : rowBg;

                  return (
                    <td
                      key={column.id}
                      onMouseEnter={event => {
                        clearCloseTimer();
                        if (!canPreview || previewTrigger !== 'hover') return;
                        const content = event.currentTarget.querySelector('[data-canonical-cell-content="true"]') as HTMLElement | null;
                        const clipped = content
                          ? content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1
                          : true;
                        if (!clipped) return;
                        const position = getPreviewPosition(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
                        setPreview({ ...position, title, body: previewBody, mode: 'hover' });
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
                        animation: rowHighlighted ? 'pulse 1.8s ease-in-out 2' : undefined,
                        transition: 'background .25s ease',
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
                          paddingRight: isButtonPreview ? 28 : undefined,
                        }}
                      >
                        {rendered || '-'}
                      </div>
                      {isButtonPreview && (
                        <button
                          type="button"
                          title="Открыть подробности"
                          aria-label="Открыть подробности"
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            clearCloseTimer();
                            const cell = event.currentTarget.closest('td') as HTMLTableCellElement | null;
                            const anchorRect = cell?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
                            const position = getPreviewPosition(event.clientX, event.clientY, anchorRect);
                            setPreview({ ...position, title, body: previewBody, mode: 'button' });
                          }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            zIndex: 3,
                            width: 22,
                            height: 22,
                            borderRadius: 7,
                            border: '1px solid var(--border-hi)',
                            background: 'var(--card)',
                            color: 'var(--accent)',
                            boxShadow: '0 4px 12px rgba(0,0,0,.12)',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 900,
                            lineHeight: '20px',
                            padding: 0,
                          }}
                        >
                          ?
                        </button>
                      )}
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
      {preview && (
        <div
          ref={previewRef}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={() => {
            if (preview.mode === 'hover') closePreview();
          }}
          style={{
            position: 'fixed',
            left: preview.left,
            top: preview.top,
            zIndex: 600,
            width: 'min(460px, calc(100vw - 32px))',
            maxHeight: '300px',
            overflow: 'hidden',
            pointerEvents: 'auto',
            borderRadius: 10,
            border: '1.5px solid var(--border-hi)',
            background: 'var(--card)',
            boxShadow: '0 22px 70px rgba(0,0,0,.32)',
            color: 'var(--text)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px 8px',
            borderBottom: preview.mode === 'button' ? '1px solid var(--border)' : undefined,
            background: 'var(--card)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 800, textTransform: 'uppercase' }}>
              {preview.title}
            </div>
            {preview.mode === 'button' && (
              <button
                type="button"
                onClick={closePreview}
                title="Закрыть"
                aria-label="Закрыть подсказку"
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: 7,
                  border: '1px solid var(--border-hi)',
                  background: 'var(--surface-soft)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: '20px',
                  padding: 0,
                }}
              >
                x
              </button>
            )}
          </div>
          <div style={{ padding: '0 14px 14px', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12.5, lineHeight: 1.55 }}>
            {preview.body}
          </div>
        </div>
      )}
    </div>
  );
}
