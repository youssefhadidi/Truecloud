/** @format */

/**
 * Server-only loader for on-disk category lists.
 *
 * The curated table in lib/dnsCategories.js covers the domains that dominate
 * real traffic, but it is hand-maintained and finite. Dropping a
 * newline-delimited domain list at <dir>/<category>.txt extends it — the
 * intended source being a category-organised blocklist such as UT1, whose
 * adult/ set alone runs to about a million names:
 *
 *   mkdir -p /etc/truecloud/dns-categories
 *   curl -sL ftp://ftp.ut-capitole.fr/pub/reseau/cache/squidguard_contrib/adult.tar.gz \
 *     | tar -xzO adult/domains > /etc/truecloud/dns-categories/adult.txt
 *
 * Filenames that do not name a known category are ignored, so a stray file
 * cannot invent one. Lines may be bare domains or hosts-file format
 * ("0.0.0.0 example.com"), since published lists ship both ways.
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { registrableDomain, CATEGORY_KEYS, installOverlay, getOverlayMeta } from '@/lib/dnsCategories';

export const DEFAULT_OVERLAY_DIR = '/etc/truecloud/dns-categories';

/**
 * Read every recognised list under `dir` and install the result.
 * Safe to call repeatedly; each call replaces the previous overlay.
 */
export async function loadCategoryOverlay(dir = DEFAULT_OVERLAY_DIR) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    // No overlay directory is the normal case, not an error.
    return installOverlay(new Map(), { dir });
  }

  const next = new Map();
  const counts = {};

  try {
    for (const entry of entries) {
      const match = /^([a-z]+)\.txt$/i.exec(entry);
      if (!match) continue;
      const category = match[1].toLowerCase();
      if (!CATEGORY_KEYS.includes(category)) continue;

      const text = await readFile(join(dir, entry), 'utf8');
      let n = 0;
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const candidate = line.split(/\s+/).pop();
        const domain = registrableDomain(candidate);
        if (!domain || next.has(domain)) continue;
        next.set(domain, category);
        n += 1;
      }
      counts[category] = (counts[category] || 0) + n;
    }
  } catch (e) {
    return installOverlay(new Map(), { dir, error: e.message });
  }

  return installOverlay(next, { dir, counts });
}

export { getOverlayMeta };
