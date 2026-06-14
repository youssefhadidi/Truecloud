/** @format */

import en from './dictionaries/en';
import fr from './dictionaries/fr';
import { DEFAULT_LOCALE } from './config';

export const dictionaries = { en, fr };

function lookup(dict, key) {
  if (!dict) return undefined;
  // Fast path: exact key (allows keys that contain dots if ever needed).
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Translate a dot-path key against a dictionary.
 * Falls back to the default locale, then to the key itself, so a missing
 * translation degrades gracefully instead of rendering blank.
 *
 * @param {string} lang   active locale (e.g. "fr")
 * @param {string} key    dot-path key (e.g. "files.emptyFolder")
 * @param {object} [vars] interpolation values for {placeholders}
 */
export function translate(lang, key, vars) {
  if (key == null) return '';
  const active = dictionaries[lang] || dictionaries[DEFAULT_LOCALE];
  let value = lookup(active, key);
  if (value === undefined && lang !== DEFAULT_LOCALE) {
    value = lookup(dictionaries[DEFAULT_LOCALE], key);
  }
  if (value === undefined) return key;
  return interpolate(value, vars);
}
