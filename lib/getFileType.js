/** @format */

import { isImage, isVideo, isAudio, isPdf, isXlsx, is3dFile } from '@/lib/clientFileUtils';

/**
 * Determine the file type based on the file name
 * @param {string|object} file - File name string or file object with name property
 * @returns {string|null} - File type: '3d', 'image', 'video', 'audio', 'pdf', 'xlsx', or null
 */
export function getFileType(file) {
  const fileName = typeof file === 'string' ? file : file?.name;

  if (!fileName) return null;
  if (is3dFile(fileName)) return '3d';
  if (isImage(fileName)) return 'image';
  if (isVideo(fileName)) return 'video';
  if (isAudio(fileName)) return 'audio';
  if (isPdf(fileName)) return 'pdf';
  if (isXlsx(fileName)) return 'xlsx';

  return null;
}

/**
 * Check if a file is viewable in the media viewer
 * @param {string|object} file - File name string or file object with name property
 * @returns {boolean} - True if the file is viewable
 */
export function isViewableFile(file) {
  const fileName = typeof file === 'string' ? file : file?.name;
  return !!(fileName && (isImage(fileName) || isVideo(fileName) || isAudio(fileName) || is3dFile(fileName) || isPdf(fileName) || isXlsx(fileName)));
}
