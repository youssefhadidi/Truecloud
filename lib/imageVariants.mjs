/** @format */

/**
 * Optimized-image variants, shared by the media viewer (which builds the
 * optimize-image URLs) and the cache worker (which pre-generates them).
 *
 * WHY THIS EXISTS:
 * The worker used to pre-generate q80 / 1440 px while the viewer asked for
 * q85 / 2000 px, so not one pre-generated file was ever served. Both now read
 * the variant from here. Dependency-free on purpose: the client bundle imports
 * it.
 */

/** What the viewer shows for an image, for signed-in users and share links. */
export const VIEWER_IMAGE = { quality: 85, width: 2000, height: 2000, format: 'webp' };

/** Images smaller than this are served as-is instead of being optimized. */
export const OPTIMIZE_MIN_BYTES = 100_000;
