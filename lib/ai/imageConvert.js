/** @format */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export const AI_TEMP_DIR = join(tmpdir(), 'truecloud-ai-images');

async function ensureDir() {
  try { await fs.mkdir(AI_TEMP_DIR, { recursive: true }); } catch {}
}

// Transcode an image Claude's Read tool can't open (e.g. HEIC) into a JPEG
// living in /tmp. Cached by the source path + mtime so follow-up turns and
// subsequent chats on the same untouched file reuse the same temp output.
// Returns the absolute path of the JPEG. Caller must --add-dir AI_TEMP_DIR.
export async function transcodeImageToJpeg(absoluteSrc, mtimeMs, sizeBytes) {
  await ensureDir();
  const key = createHash('sha1')
    .update(`${absoluteSrc}\n${mtimeMs}\n${sizeBytes}`)
    .digest('hex')
    .slice(0, 20);
  const out = join(AI_TEMP_DIR, `${key}.jpg`);

  try { await fs.access(out); return out; } catch {}

  // Lazy-load sharp so module import doesn't crash if the binary is missing
  // on dev machines that won't transcode HEIC.
  const sharpMod = await import('sharp');
  const sharp = sharpMod.default || sharpMod;
  const buf = await fs.readFile(absoluteSrc);
  await sharp(buf).rotate().jpeg({ quality: 85 }).toFile(out);
  return out;
}
