/** @format */

// Supported UI languages. The first entry is the default/fallback.
export const LOCALES = ['en', 'fr'];
export const DEFAULT_LOCALE = 'en';

// Cookie the server reads to render the right language with no flash, and the
// client reads/writes when the user switches language.
export const LANG_COOKIE = 'truecloud-lang';

// One year, in seconds — used for the language cookie max-age.
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Human labels for the language picker.
export const LANG_LABELS = {
  en: 'English',
  fr: 'Français',
};

export function isLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value);
}

export function normalizeLocale(value) {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
