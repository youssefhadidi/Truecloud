/** @format */

import fs from 'node:fs/promises';

const MAX_ROWS = parseInt(process.env.AI_XLSX_MAX_ROWS || '5000', 10);
const MAX_CHARS_PER_CELL = 500;

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (s.length > MAX_CHARS_PER_CELL) s = s.slice(0, MAX_CHARS_PER_CELL) + '…';
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Parse an xlsx workbook locally and produce a CSV-ish text block bounded by
// MAX_ROWS across all sheets. We do this locally rather than uploading because
// Claude reads CSV-style text far more reliably than raw xlsx.
export async function xlsxToText(absolutePath, fileName) {
  const xlsx = await import('xlsx');
  const buf = await fs.readFile(absolutePath);
  const workbook = xlsx.read(buf, { type: 'buffer' });

  let totalRows = 0;
  let truncated = false;
  const parts = [`# Spreadsheet: ${fileName}\n`];

  for (const sheetName of workbook.SheetNames) {
    if (totalRows >= MAX_ROWS) { truncated = true; break; }
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    parts.push(`\n## Sheet: ${sheetName}\n`);

    const remaining = MAX_ROWS - totalRows;
    const take = Math.min(rows.length, remaining);
    if (rows.length > take) truncated = true;

    for (let i = 0; i < take; i++) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      parts.push(row.map(csvEscape).join(',') + '\n');
    }
    totalRows += take;
  }

  if (truncated) {
    parts.push(`\n(Note: spreadsheet truncated at ${MAX_ROWS} rows.)\n`);
  }

  return parts.join('');
}
