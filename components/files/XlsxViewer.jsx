/** @format */

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useParseXlsx, useParseXlsxShare } from '@/lib/api/viewers';
import './xlsx-viewer.css';

// Rows are a fixed height so a scroll offset maps straight to a row index;
// only the rows in view (plus OVERSCAN_ROWS each side) are mounted. The
// window moves once the view comes within MARGIN_ROWS of its edge, so a scroll
// re-renders the table every dozen rows rather than every frame.
const ROW_HEIGHT = 26;
const OVERSCAN_ROWS = 30;
const MARGIN_ROWS = 10;

// Column widths come from the content of the first rows, since the table can't
// size columns from rows that aren't mounted.
const ROWNUM_WIDTH = 56;
const WIDTH_SAMPLE_ROWS = 200;
const COL_MIN_WIDTH = 80;
const COL_MAX_WIDTH = 320;
const CHAR_WIDTH = 7;
const CELL_PADDING = 22;

function columnWidths(rows) {
  let count = 0;
  for (const row of rows) if (row.length > count) count = row.length;
  const widths = new Array(count).fill(COL_MIN_WIDTH);
  const sample = Math.min(rows.length, WIDTH_SAMPLE_ROWS);
  for (let r = 0; r < sample; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const width = Math.min(COL_MAX_WIDTH, String(row[c] ?? '').length * CHAR_WIDTH + CELL_PADDING);
      if (width > widths[c]) widths[c] = width;
    }
  }
  return widths;
}

function rowWindow(scrollTop, height, rowCount) {
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const last = Math.ceil((scrollTop + height) / ROW_HEIGHT);
  return {
    first: Math.max(0, first - OVERSCAN_ROWS),
    last: Math.min(rowCount - 1, last + OVERSCAN_ROWS),
    visibleFirst: first,
    visibleLast: last,
  };
}

function SheetGrid({ rows }) {
  const scrollRef = useRef(null);
  const rafRef = useRef(0);
  const widths = useMemo(() => columnWidths(rows), [rows]);
  const [range, setRange] = useState(() => rowWindow(0, 800, rows.length));

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = rowWindow(el.scrollTop, el.clientHeight, rows.length);
    setRange((prev) => {
      const covered =
        prev.first <= Math.max(0, next.visibleFirst - MARGIN_ROWS) &&
        prev.last >= Math.min(rows.length - 1, next.visibleLast + MARGIN_ROWS);
      return covered ? prev : next;
    });
  }, [rows.length]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [update]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      update();
    });
  }, [update]);

  if (rows.length === 0) {
    return (
      <div className="xv-scroll">
        <div className="xv-empty">No data in this sheet</div>
      </div>
    );
  }

  const tableWidth = widths.reduce((sum, w) => sum + w, ROWNUM_WIDTH);
  const colSpan = widths.length + 1;
  const { first, last } = range;

  return (
    <div ref={scrollRef} className="xv-scroll" onScroll={onScroll}>
      <table className="xv-table" style={{ width: tableWidth, '--xv-row-h': `${ROW_HEIGHT}px` }}>
        <colgroup>
          <col style={{ width: ROWNUM_WIDTH }} />
          {widths.map((w, c) => (
            <col key={c} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {first > 0 && (
            <tr className="xv-spacer" style={{ height: first * ROW_HEIGHT }}>
              <td colSpan={colSpan} />
            </tr>
          )}
          {rows.slice(first, last + 1).map((row, i) => {
            const r = first + i;
            return (
              <tr key={r} className={r === 0 ? 'xv-header' : undefined}>
                <td className="xv-rownum">{r + 1}</td>
                {widths.map((_, c) => {
                  const cell = row[c] ?? '';
                  return (
                    <td key={c} className={typeof cell === 'number' ? 'xv-num' : undefined} title={String(cell)}>
                      {String(cell)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {last < rows.length - 1 && (
            <tr className="xv-spacer" style={{ height: (rows.length - 1 - last) * ROW_HEIGHT }}>
              <td colSpan={colSpan} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function XlsxViewer({ fileId, currentPath, fileName, shareToken, sharePassword }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
  // Only the query matching the viewer's context runs: share visitors aren't
  // signed in, and a 401/403 from the authenticated endpoint would log them out.
  const authQuery = useParseXlsx(fileId, currentPath, activeSheet, !shareToken);
  const shareQuery = useParseXlsxShare(shareToken, filePath, sharePassword, activeSheet);
  const { data, isLoading, isPlaceholderData, error } = shareToken ? shareQuery : authQuery;

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mv-loader-card">
          <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span className="mv-loader-card__text">Loading spreadsheet…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="mv-video-state-card"
          style={{
            padding: '20px 28px',
            background: 'var(--danger-light)',
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error.message}
        </div>
      </div>
    );
  }

  const sheetNames = data?.sheetNames || [];

  if (!sheetNames.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No data found in spreadsheet
      </div>
    );
  }

  const rows = data.rows || [];
  const shownCols = rows.reduce((max, row) => Math.max(max, row.length), 0);

  return (
    <div className="xv">
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Keyed by sheet: a new sheet starts scrolled to the top. */}
        <SheetGrid key={data.sheet} rows={rows} />
        {isPlaceholderData && (
          <div className="xv-loading">
            <div className="mv-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
          </div>
        )}
      </div>

      <div className="xv-tabs">
        {sheetNames.length > 1 && (
          <button
            onClick={() => setActiveSheet(Math.max(0, activeSheet - 1))}
            disabled={activeSheet === 0}
            className="mv-icon-btn"
            style={{ width: 28, height: 28 }}
          >
            <FiChevronLeft size={16} />
          </button>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {sheetNames.map((name, idx) => (
            <button
              key={idx}
              onClick={() => setActiveSheet(idx)}
              className={`xv-tab${idx === activeSheet ? ' xv-tab--active' : ''}`}
            >
              {name}
            </button>
          ))}
        </div>
        {sheetNames.length > 1 && (
          <button
            onClick={() => setActiveSheet(Math.min(sheetNames.length - 1, activeSheet + 1))}
            disabled={activeSheet === sheetNames.length - 1}
            className="mv-icon-btn"
            style={{ width: 28, height: 28 }}
          >
            <FiChevronRight size={16} />
          </button>
        )}
      </div>

      <div className="xv-footer">
        Sheet {data.sheet + 1} of {sheetNames.length} • {data.totalRows.toLocaleString()} rows •{' '}
        {data.totalCols.toLocaleString()} columns
        {(data.truncatedRows || data.truncatedCols) && (
          <span className="xv-footer__note">
            {' '}
            — showing the first {rows.length.toLocaleString()} rows and {shownCols.toLocaleString()} columns; download the
            file to see the rest
          </span>
        )}
      </div>
    </div>
  );
}
