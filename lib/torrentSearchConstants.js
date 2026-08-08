/** @format */

/**
 * Shared constants for torrent index search.
 *
 * Kept in their own module with no imports so the client bundle can use the
 * category/sort lists without pulling in the server-side scraper in
 * `lib/torrentSearch.js` (which imports the logger and reads env config).
 */

/** Categories offered in the search dropdown. Must match what the API validates. */
export const SEARCH_CATEGORIES = [
  { value: 0, label: 'All categories' },
  { value: 300, label: 'Applications' },
  { value: 303, label: 'Applications › UNIX' },
  { value: 301, label: 'Applications › Windows' },
  { value: 302, label: 'Applications › Mac' },
  { value: 200, label: 'Video' },
  { value: 207, label: 'Video › HD Movies' },
  { value: 208, label: 'Video › HD TV shows' },
  { value: 100, label: 'Audio' },
  { value: 400, label: 'Games' },
  { value: 600, label: 'Other' },
  { value: 601, label: 'Other › E-books' },
];

export const SORT_FIELDS = ['seeders', 'leechers', 'size', 'added', 'name'];
