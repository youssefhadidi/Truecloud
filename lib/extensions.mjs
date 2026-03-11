/** @format */

// Centralized file extension constants for the backend.
// All extensions include a leading dot (e.g. '.jpg').

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp', '.gif', '.bmp', '.png', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.raf', '.pef', '.srw'];

export const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];

export const PDF_EXTENSIONS = ['.pdf'];

export const STREAM_EXTENSIONS = VIDEO_EXTENSIONS;

/** Extensions that support HLS adaptive transcoding */
export const HLS_EXTENSIONS = VIDEO_EXTENSIONS;

/** Extensions that support thumbnail generation */
export const THUMBNAIL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...PDF_EXTENSIONS];

/** Extensions that support optimized-image caching (sharp) */
export const OPTIMIZE_EXTENSIONS = IMAGE_EXTENSIONS;
