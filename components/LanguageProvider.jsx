/** @format */

'use client';

import { createContext, useContext, useCallback, useMemo, useState } from 'react';
import axios from '@/lib/axiosConfig';
import { translate } from '@/lib/i18n/translate';
import {
  LOCALES,
  DEFAULT_LOCALE,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  normalizeLocale,
} from '@/lib/i18n/config';

const LanguageContext = createContext(null);

function writeCookie(lang) {
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {}
}

export function LanguageProvider({ children, initialLang = DEFAULT_LOCALE }) {
  const [lang, setLang] = useState(() => normalizeLocale(initialLang));

  // `persist: false` updates the cookie + UI only (used when syncing from the
  // logged-in user's DB value, where a write-back would be redundant).
  const setLanguage = useCallback((next, { persist = true } = {}) => {
    const value = normalizeLocale(next);
    setLang((prev) => (prev === value ? prev : value));
    writeCookie(value);
    if (persist) {
      axios.put('/api/account/language', { language: value }).catch(() => {});
    }
  }, []);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(
    () => ({ lang, setLanguage, t, locales: LOCALES }),
    [lang, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return ctx;
}
