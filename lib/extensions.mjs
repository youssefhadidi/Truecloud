/** @format */

// Centralized file extension constants for the backend.
// All extensions include a leading dot (e.g. '.jpg').

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.bmp', '.png', '.webp', '.svg', '.ico', '.heic', '.heif'];

export const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];

export const PDF_EXTENSIONS = ['.pdf'];

export const STREAM_EXTENSIONS = ['.mp4'];

/** Extensions that support thumbnail generation */
export const THUMBNAIL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...PDF_EXTENSIONS];

/** Extensions that support optimized-image caching (sharp) */
export const OPTIMIZE_EXTENSIONS = IMAGE_EXTENSIONS;
