/** @format */

import fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { classifyAiFile } from './fileTypes';
import { getOrUploadAnthropicFile } from './files';
import { xlsxToText } from './xlsx';

const IMAGE_MAX_BYTES = parseInt(process.env.AI_IMAGE_MAX_BYTES || '5242880', 10);
const PDF_MAX_BYTES = parseInt(process.env.AI_PDF_MAX_BYTES || '33554432', 10);
const TEXT_MAX_CHARS = 200_000;

function tooLargeMsg(label, size, limit) {
  const mb = (size / 1024 / 1024).toFixed(1);
  const lim = (limit / 1024 / 1024).toFixed(0);
  return `${label} is too large for the AI assistant (${mb} MB; limit ${lim} MB).`;
}

// Build the Anthropic content blocks representing this file. Throws a user-facing
// Error.message for unsupported / oversize files. The last block is marked
// cache_control: ephemeral so follow-up turns hit the prompt cache.
export async function buildFileContentBlocks({ absolutePath, normalizedPath, fileName }) {
  const cls = classifyAiFile(fileName);
  if (cls.kind === 'unsupported') {
    throw new Error('This file type is not supported by the AI assistant.');
  }

  const stats = await stat(absolutePath);

  if (cls.kind === 'image') {
    if (stats.size > IMAGE_MAX_BYTES) {
      throw new Error(tooLargeMsg('Image', stats.size, IMAGE_MAX_BYTES));
    }
    const { fileId } = await getOrUploadAnthropicFile({
      absolutePath,
      normalizedPath,
      mediaType: cls.mediaType,
    });
    return [{
      type: 'image',
      source: { type: 'file', file_id: fileId },
      cache_control: { type: 'ephemeral' },
    }];
  }

  if (cls.kind === 'pdf') {
    if (stats.size > PDF_MAX_BYTES) {
      throw new Error(tooLargeMsg('PDF', stats.size, PDF_MAX_BYTES));
    }
    const { fileId } = await getOrUploadAnthropicFile({
      absolutePath,
      normalizedPath,
      mediaType: cls.mediaType,
    });
    return [{
      type: 'document',
      source: { type: 'file', file_id: fileId },
      cache_control: { type: 'ephemeral' },
    }];
  }

  if (cls.kind === 'text') {
    let content = await fs.readFile(absolutePath, 'utf8');
    let truncated = false;
    if (content.length > TEXT_MAX_CHARS) {
      content = content.slice(0, TEXT_MAX_CHARS);
      truncated = true;
    }
    return [{
      type: 'text',
      text: `File: ${fileName}\n\n${content}${truncated ? '\n\n[truncated]' : ''}`,
      cache_control: { type: 'ephemeral' },
    }];
  }

  if (cls.kind === 'xlsx') {
    const text = await xlsxToText(absolutePath, fileName);
    return [{
      type: 'text',
      text,
      cache_control: { type: 'ephemeral' },
    }];
  }

  throw new Error(`Unhandled file kind: ${cls.kind}`);
}
