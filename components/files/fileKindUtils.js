/** @format */

import {
  isImage, isVideo, isAudio, isPdf, isXlsx, is3dFile, getFileExtension,
} from '@/lib/clientFileUtils';

const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'];
const DOC_EXTS = ['doc', 'docx', 'odt', 'rtf'];
const SHEET_EXTS = ['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'ods', 'tsv'];
const TEXT_EXTS = ['txt', 'md', 'log', 'json', 'yaml', 'yml', 'xml', 'ini', 'cfg', 'conf', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'rb', 'go', 'rs', 'sh'];

/** Map a file to one of the design's ft-* kinds. */
export function fileKind(file) {
  if (!file) return 'text';
  if (file.isDirectory) return 'folder';
  const name = file.name || '';
  if (isImage(name)) return 'image';
  if (isVideo(name)) return 'video';
  if (isAudio(name)) return 'audio';
  if (isPdf(name)) return 'pdf';
  if (is3dFile(name)) return '3d';
  if (isXlsx(name)) return 'sheet';
  const ext = getFileExtension(name);
  if (SHEET_EXTS.includes(ext)) return 'sheet';
  if (ARCHIVE_EXTS.includes(ext)) return 'archive';
  if (DOC_EXTS.includes(ext)) return 'doc';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'text';
}

export function ftClass(file) {
  return `ft-${fileKind(file)}`;
}

export function fileKindLabel(file) {
  return {
    folder: 'Folder', image: 'Image', video: 'Video', audio: 'Audio',
    pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet',
    archive: 'Archive', '3d': '3D Model', text: 'File',
  }[fileKind(file)] || 'File';
}
