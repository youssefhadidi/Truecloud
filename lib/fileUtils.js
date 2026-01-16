/** @format */

import fs from 'fs';
import path from 'path';

const STORAGE_MODE = process.env.STORAGE_MODE || 'direct';
export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// For direct mode, ensure the directory exists and is writable
if (STORAGE_MODE === 'direct') {
  console.log(`Using direct filesystem access: ${UPLOAD_DIR}`);
}

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

// Initialize upload directory on module load
ensureUploadDir();

export function getFilePath(fileId, filename) {
  return path.join(UPLOAD_DIR, `${fileId}_${filename}`);
}

export function getThumbnailPath(fileId) {
  const thumbDir = path.join(UPLOAD_DIR, 'thumbnails');
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  return path.join(thumbDir, `${fileId}.jpg`);
}

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
