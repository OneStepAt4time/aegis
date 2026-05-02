/**
 * i18n/context.tsx — I18n provider and useT hook.
 * Simple React Context-based solution without external library.
 */

import { createContext, useContext, ReactNode, useState } from 'react';
import { en, type Messages } from './en';
import { it } from './it';

interface I18nContextValue {
  locale: string;
  messages: Messages;
  setLocale: (locale: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LOCALE_STORAGE_KEY = 'aegis:locale';
const DEFAULT_LOCALE = 'en-US';

// For now we only have English, but the structure is ready for more languages
const MESSAGES: Record<string, Messages> = {
  'en': en,
  'en-US': en,
  'en-GB': en,
  'de-DE': en, // TODO: Add German translations
  'ja-JP': en, // TODO: Add Japanese translations
  'ar-SA': en, // TODO: Add Arabic translations
  'it': it as typeof en,
  'it-IT': it as typeof en,
};

function getInitialLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && MESSAGES[stored]) return stored;
  } catch {}
  
  // Fall back to navigator.language
  const navLang = navigator.language;
  if (MESSAGES[navLang]) return navLang;
  
  // Try just the language code (e.g., 'en' from 'en-AU')
  const langCode = navLang.split('-')[0];
  if (MESSAGES[langCode]) return langCode;
  
  return DEFAULT_LOCALE;
}

function getValue(obj: unknown, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  
  return typeof current === 'string' ? current : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(getInitialLocale);

  const setLocale = (newLocale: string) => {
    if (MESSAGES[newLocale]) {
      setLocaleState(newLocale);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
      } catch {}
    }
  };

  const messages = MESSAGES[locale] || en;

  const t = (key: string, params?: Record<string, string | number>): string => {
    let message = getValue(messages, key);
    
    if (!message) {
      console.warn(`[i18n] Missing translation for key: ${key}`);
      return key;
    }
    
    // Simple parameter substitution: {count} -> params.count
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        message = message!.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }
    
    return message;
  };

  const value: I18nContextValue = {
    locale,
    messages,
    setLocale,
    t,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useT must be used within I18nProvider');
  }
  return context.t;
}

export function useLocale() {
  const context = useContext(I18nContext);
  if (!context) {
    // Safe fallback when used outside I18nProvider (e.g., unit tests)
    return { locale: DEFAULT_LOCALE, setLocale: (_locale: string) => {} };
  }
  return {
    locale: context.locale,
    setLocale: context.setLocale,
  };
}
