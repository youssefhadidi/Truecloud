/** @format */

// Image file extensions
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif', 'jfif', 'pjpeg', 'pjp'];

// Video file extensions
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', '3g2', 'mpeg', 'mpg', 'ts', 'm2ts', 'mts', 'vob', 'rm', 'rmvb'];

// Audio file extensions
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'webm', 'aiff', 'ape', 'amr', 'mid', 'midi'];

// PDF file extensions
const PDF_EXTENSIONS = ['pdf'];

export function getFileExtension(filename) {
  if (!filename) return '';
  return filename.split('.').pop().toLowerCase();
}

export function isImage(filename) {
  const ext = getFileExtension(filename);
  return IMAGE_EXTENSIONS.includes(ext);
}

export function isVideo(filename) {
  const ext = getFileExtension(filename);
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isAudio(filename) {
  const ext = getFileExtension(filename);
  return AUDIO_EXTENSIONS.includes(ext);
}

export function isPdf(filename) {
  const ext = getFileExtension(filename);
  return PDF_EXTENSIONS.includes(ext);
}
