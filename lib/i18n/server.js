/** @format */

import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLocale } from './config';
import { translate } from './translate';

/**
 * Read the active language from the request cookie (server components only).
 * Returns the default locale when the cookie is absent or invalid.
 */
export async function getServerLang() {
  const store = await cookies();
  return normalizeLocale(store.get(LANG_COOKIE)?.value);
}

/**
 * Returns a bound `t(key, vars)` for use in server components.
 */
export async function getServerT() {
  const lang = await getServerLang();
  return (key, vars) => translate(lang, key, vars);
}
