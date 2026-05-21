/** @format */

import fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { prisma } from '@/lib/prisma';
import { anthropic } from './client';

// Upload a local file to Anthropic's Files API, or reuse a cached upload if the
// file hasn't changed since the last upload. Returns the anthropic file_id.
export async function getOrUploadAnthropicFile({ absolutePath, normalizedPath, mediaType }) {
  const stats = await stat(absolutePath);
  const mtimeMs = BigInt(Math.floor(stats.mtimeMs));
  const fileSize = BigInt(stats.size);

  const cached = await prisma.aiFileUpload.findUnique({
    where: { filePath: normalizedPath },
  });

  if (cached && cached.mtimeMs === mtimeMs && cached.fileSize === fileSize) {
    return { fileId: cached.anthropicFileId, mediaType: cached.mediaType, cached: true };
  }

  const buffer = await fs.readFile(absolutePath);
  const fileName = basename(absolutePath);
  const blob = new File([buffer], fileName, { type: mediaType });

  const uploaded = await anthropic.beta.files.upload({ file: blob });

  if (cached) {
    await prisma.aiFileUpload.update({
      where: { filePath: normalizedPath },
      data: {
        fileSize,
        mtimeMs,
        anthropicFileId: uploaded.id,
        mediaType,
        uploadedAt: new Date(),
      },
    });
  } else {
    await prisma.aiFileUpload.create({
      data: {
        filePath: normalizedPath,
        fileSize,
        mtimeMs,
        anthropicFileId: uploaded.id,
        mediaType,
      },
    });
  }

  return { fileId: uploaded.id, mediaType, cached: false };
}
