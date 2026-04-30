/** @format */

'use client';

import { useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useParseXlsx, useParseXlsxShare } from '@/lib/api/viewers';

export default function XlsxViewer({ fileId, currentPath, fileName, shareToken, sharePassword }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
  const authQuery = useParseXlsx(fileId, currentPath);
  const shareQuery = useParseXlsxShare(shareToken, filePath, sharePassword);
  const { data, isLoading, error } = shareToken ? shareQuery : authQuery;

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

  const sheets = data?.sheets || [];

  if (!sheets.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No data found in spreadsheet
      </div>
    );
  }

  const currentSheetData = sheets[activeSheet];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        <table style={{ borderCollapse: 'collapse', background: 'var(--surface)', fontSize: 12 }}>
          <tbody>
            {currentSheetData.data?.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <td
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    padding: '4px 10px',
                    color: 'var(--text-3)',
                    fontWeight: 600,
                    width: 48,
                    textAlign: 'right',
                  }}
                >
                  {rowIdx + 1}
                </td>
                {row.map((cell, cellIdx) => {
                  const isHeaderRow = rowIdx === 0;
                  const isNumeric = typeof cell === 'number';
                  return (
                    <td
                      key={cellIdx}
                      style={{
                        border: '1px solid var(--border)',
                        padding: '4px 10px',
                        minWidth: 100,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        background: isHeaderRow ? 'var(--surface-2)' : 'var(--surface)',
                        fontWeight: isHeaderRow ? 600 : 400,
                        color: isHeaderRow ? 'var(--accent)' : 'var(--text)',
                        textAlign: isNumeric ? 'right' : 'left',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                      title={cell?.toString() || ''}
                    >
                      {cell ?? ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!currentSheetData.data?.length && (
          <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>No data in this sheet</div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          overflowX: 'auto',
        }}
      >
        {sheets.length > 1 && (
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
          {sheets.map((sheet, idx) => {
            const active = idx === activeSheet;
            return (
              <button
                key={idx}
                onClick={() => setActiveSheet(idx)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--r-sm)',
                  border: 'none',
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text-2)',
                  fontWeight: active ? 600 : 500,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 120ms',
                }}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
        {sheets.length > 1 && (
          <button
            onClick={() => setActiveSheet(Math.min(sheets.length - 1, activeSheet + 1))}
            disabled={activeSheet === sheets.length - 1}
            className="mv-icon-btn"
            style={{ width: 28, height: 28 }}
          >
            <FiChevronRight size={16} />
          </button>
        )}
      </div>

      <div
        style={{
          padding: '8px 16px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-3)',
        }}
      >
        Sheet {activeSheet + 1} of {sheets.length} • {currentSheetData.data?.length || 0} rows •{' '}
        {currentSheetData.data?.[0]?.length || 0} columns
      </div>
    </div>
  );
}
