/** @format */

// Worker thread for lib/xlsxPreview.mjs: parsing a workbook is synchronous
// CPU work (unzip + XML) that would otherwise stall the server's event loop,
// and with it every other request, for as long as it takes.
//
// Replies with the payload already JSON-encoded: a string crosses the thread
// boundary as one copy, where a nested array would be structured-cloned cell
// by cell on the main thread.

import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { buildXlsxPreview } from '../xlsxPreviewParse.mjs';

parentPort.on('message', async ({ id, filePath, sheetIndex }) => {
  try {
    const buffer = await readFile(filePath);
    const preview = await buildXlsxPreview(buffer, sheetIndex);
    parentPort.postMessage({ id, json: JSON.stringify(preview) });
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err) });
  }
});
