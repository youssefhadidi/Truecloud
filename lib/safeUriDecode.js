/** @format */

/**
 * Safely decode URI components, handling malformed URIs that can occur
 * when URLs are double-encoded (e.g., through nginx reverse proxy)
 * @param {string} str - The string to decode
 * @param {boolean} fallbackToOriginal - If true, returns original string on error. If false, returns empty string.
 * @returns {string} - The decoded string, or fallback value if decoding fails
 */
export function safeDecodeURIComponent(str, fallbackToOriginal = true) {
  if (!str) return '';

  try {
    // First, try to decode normally
    return decodeURIComponent(str);
  } catch (e) {
    // If that fails, it might be already decoded or malformed
    // Try to detect if it's already decoded by attempting to encode and decode
    try {
      const encoded = encodeURIComponent(str);
      const decoded = decodeURIComponent(encoded);
      // If this works, the original string was likely already decoded
      return fallbackToOriginal ? str : '';
    } catch (innerError) {
      // String is truly malformed, return fallback
      console.warn('URI decode failed for:', str, innerError.message);
      return fallbackToOriginal ? str : '';
    }
  }
}

/**
 * Safely decode an entire URI, handling malformed URIs
 * @param {string} uri - The URI to decode
 * @param {boolean} fallbackToOriginal - If true, returns original URI on error
 * @returns {string} - The decoded URI, or fallback value if decoding fails
 */
export function safeDecodeURI(uri, fallbackToOriginal = true) {
  if (!uri) return '';

  try {
    return decodeURI(uri);
  } catch (e) {
    try {
      const encoded = encodeURI(uri);
      const decoded = decodeURI(encoded);
      return fallbackToOriginal ? uri : '';
    } catch (innerError) {
      console.warn('URI decode failed for:', uri, innerError.message);
      return fallbackToOriginal ? uri : '';
    }
  }
}
