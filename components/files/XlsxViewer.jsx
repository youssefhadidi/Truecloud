/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

export default function XlsxViewer({ fileId, currentPath, fileName }) {
  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadXlsx = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/files/parse-xlsx?id=${encodeURIComponent(fileId)}&path=${encodeURIComponent(currentPath)}`);

        if (!response.ok) {
          throw new Error(`Failed to load XLSX: ${response.statusText}`);
        }

        const data = await response.json();
        setSheets(data.sheets || []);
        setActiveSheet(0);
      } catch (err) {
        console.error('Error loading XLSX:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadXlsx();
  }, [fileId, currentPath]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-gray-400">Loading spreadsheet...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  if (!sheets.length) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-gray-400">No data found in spreadsheet</div>
      </div>
    );
  }

  const currentSheetData = sheets[activeSheet];

  return (
    <div className="w-full h-full flex flex-col bg-gray-800">
      {/* Spreadsheet Table */}
      <div className="flex-1 overflow-auto p-0">
        <table className="border-collapse bg-gray-800 ">
          <tbody>
            {currentSheetData.data?.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {/* Row Header (Row Number) */}
                <td className="sticky left-0 z-20 bg-gray-700 border border-gray-600 px-3 py-1 text-gray-400 font-semibold w-12 text-right">{rowIdx + 1}</td>

                {/* Cells */}
                {row.map((cell, cellIdx) => {
                  const colLetter = String.fromCharCode(65 + (cellIdx % 26)) + (cellIdx >= 26 ? Math.floor(cellIdx / 26) : '');
                  const isHeaderRow = rowIdx === 0;
                  const isNumeric = typeof cell === 'number';

                  return (
                    <td
                      key={cellIdx}
                      className={`border border-gray-600 px-3 py-1 min-w-[100px] whitespace-nowrap overflow-hidden text-ellipsis ${
                        isHeaderRow ? 'bg-gray-700 font-semibold text-blue-300' : 'bg-gray-800 text-gray-200'
                      } ${isNumeric ? 'text-right' : 'text-left'}`}
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

        {!currentSheetData.data?.length && <div className="text-gray-400">No data in this sheet</div>}
      </div>
      {/* Sheet Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-2 bg-gray-900 overflow-x-auto">
        {sheets.length > 1 && (
          <button
            onClick={() => setActiveSheet(Math.max(0, activeSheet - 1))}
            disabled={activeSheet === 0}
            className="p-1 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            <FiChevronLeft size={18} />
          </button>
        )}

        <div className="flex gap-1">
          {sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => setActiveSheet(idx)}
              className={`px-3 py-1 rounded  whitespace-nowrap transition-colors ${idx === activeSheet ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {sheet.name}
            </button>
          ))}
        </div>

        {sheets.length > 1 && (
          <button
            onClick={() => setActiveSheet(Math.min(sheets.length - 1, activeSheet + 1))}
            disabled={activeSheet === sheets.length - 1}
            className="p-1 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            <FiChevronRight size={18} />
          </button>
        )}
      </div>
      {/* Footer Info */}
      <div className="border-t border-gray-700 px-4 py-2 bg-gray-900 text-xs text-gray-400">
        <span>
          Sheet {activeSheet + 1} of {sheets.length} • {currentSheetData.data?.length || 0} rows • {currentSheetData.data?.[0]?.length || 0} columns
        </span>
      </div>
    </div>
  );
}
