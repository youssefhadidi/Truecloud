/** @format */

// Builds the spreadsheet viewer's payload for one sheet of a workbook.
// Shared by the parse worker (lib/workers/xlsxPreviewWorker.mjs) and its
// in-process fallback, so it imports nothing through the '@/' alias.

// The viewer shows at most this much of a sheet: enough to read it, while
// the payload stays a few MB and the parse a fraction of a second. Past it
// the viewer says so and offers the download.
export const XLSX_PREVIEW_MAX_ROWS = 10_000;
export const XLSX_PREVIEW_MAX_COLS = 100;

/**
 * @param {Buffer} buffer Workbook bytes (.xlsx/.xls/.xlsm/.xlsb)
 * @param {number} sheetIndex
 * @returns {Promise<{sheetNames: string[], sheet: number, rows: Array<Array<string|number|boolean>>,
 *   totalRows: number, totalCols: number, truncatedRows: boolean, truncatedCols: boolean}>}
 */
export async function buildXlsxPreview(buffer, sheetIndex) {
  const XLSX = await import('xlsx');

  // Sheet names only: reads the workbook index, not the sheets themselves.
  const { SheetNames: sheetNames } = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
  if (sheetNames.length === 0) {
    return { sheetNames, sheet: 0, rows: [], totalRows: 0, totalCols: 0, truncatedRows: false, truncatedCols: false };
  }
  const sheet = Math.min(Math.max(0, sheetIndex | 0), sheetNames.length - 1);

  // Parse just that sheet, and stop reading rows past the limit (+1 so a
  // sheet of exactly the limit isn't reported as truncated).
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    sheets: sheet,
    sheetRows: XLSX_PREVIEW_MAX_ROWS + 1,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  const worksheet = workbook.Sheets[sheetNames[sheet]];
  if (!worksheet || !worksheet['!ref']) {
    return { sheetNames, sheet, rows: [], totalRows: 0, totalCols: 0, truncatedRows: false, truncatedCols: false };
  }

  // With sheetRows, '!ref' is cut to the rows read and '!fullref' keeps the
  // sheet's real extent.
  const full = XLSX.utils.decode_range(worksheet['!fullref'] || worksheet['!ref']);
  const totalRows = full.e.r - full.s.r + 1;
  const totalCols = full.e.c - full.s.c + 1;

  const range = XLSX.utils.decode_range(worksheet['!ref']);
  range.e.c = Math.min(range.e.c, range.s.c + XLSX_PREVIEW_MAX_COLS - 1);
  range.e.r = Math.min(range.e.r, range.s.r + XLSX_PREVIEW_MAX_ROWS - 1);

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range });

  return {
    sheetNames,
    sheet,
    rows,
    totalRows,
    totalCols,
    truncatedRows: totalRows > XLSX_PREVIEW_MAX_ROWS,
    truncatedCols: totalCols > XLSX_PREVIEW_MAX_COLS,
  };
}
