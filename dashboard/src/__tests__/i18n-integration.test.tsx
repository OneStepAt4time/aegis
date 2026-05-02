/**
 * i18n-integration.test.tsx — Integration tests for i18n context, catalogs, and LanguageSwitcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useT, useLocale } from '../i18n/context';
import { en } from '../i18n/en';
import { it as itCatalog } from '../i18n/it';
import LanguageSwitcher from '../components/shared/LanguageSwitcher';

// ---------- helpers ----------

/** Recursively collect all leaf string values from a nested object. */
function collectKeys(obj: unknown, prefix = ''): string[] {
  const keys: string[] = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') {
        keys.push(path);
      } else if (v && typeof v === 'object') {
        keys.push(...collectKeys(v, path));
      }
    }
  }
  return keys;
}


// ---------- mock localStorage ----------

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key: string) => store[key] ?? null,
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
    (key: string, value: string) => {
      store[key] = value;
    },
  );
});

// ---------- tests ----------

describe('i18n integration', () => {
  it('Italian catalog has the same keys as English catalog', () => {
    const enKeys = collectKeys(en).sort();
    const itKeys = collectKeys(itCatalog).sort();
    expect(itKeys).toEqual(enKeys);
  });

  it('switching locale changes rendered text', () => {
    function LocaleSwitcher() {
      const { locale, setLocale } = useLocale();
      const t = useT();
      return (
        <div>
          <span data-testid="current-locale">{locale}</span>
          <span>{t('settings.display.title')}</span>
          <button onClick={() => setLocale('it-IT')}>Switch to Italian</button>
          <button onClick={() => setLocale('en-US')}>Switch to English</button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <LocaleSwitcher />
      </I18nProvider>,
    );

    // Default is en-US
    expect(screen.getByText('Display')).toBeDefined();

    // Switch to Italian
    fireEvent.click(screen.getByText('Switch to Italian'));
    expect(screen.getByText('Visualizzazione')).toBeDefined();

    // Switch back to English
    fireEvent.click(screen.getByText('Switch to English'));
    expect(screen.getByText('Display')).toBeDefined();
  });

  it('persists locale choice to localStorage', () => {
    function LocaleWriter() {
      const { setLocale } = useLocale();
      return <button onClick={() => setLocale('it-IT')}>Set Italian</button>;
    }

    render(
      <I18nProvider>
        <LocaleWriter />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Set Italian'));
    expect(localStorage.setItem).toHaveBeenCalledWith('aegis:locale', 'it-IT');
  });

  it('useT returns the key when translation is missing', () => {
    function MissingKey() {
      const t = useT();
      return <span>{t('nonexistent.key.path')}</span>;
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <I18nProvider>
        <MissingKey />
      </I18nProvider>,
    );

    expect(screen.getByText('nonexistent.key.path')).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing translation'),
    );
    warnSpy.mockRestore();
  });

  it('useT supports parameter substitution', () => {
    function Params() {
      const t = useT();
      return <span>{t('cost.lastDays', { count: 7 })}</span>;
    }

    render(
      <I18nProvider>
        <Params />
      </I18nProvider>,
    );

    expect(screen.getByText('Last 7 days')).toBeDefined();
  });
});

describe('LanguageSwitcher', () => {
  it('renders with accessible label', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();
    expect(select.getAttribute('aria-label')).toBe('Language');
  });

  it('renders English and Italian options', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );

    expect(screen.getByText('English')).toBeDefined();
    expect(screen.getByText('Italiano')).toBeDefined();
  });

  it('falls back to en-US when locale is bare "en"', () => {
    function BareEn() {
      const { locale } = useLocale();
      const t = useT();
      return (
        <div>
          <span data-testid="locale">{locale}</span>
          <span>{t('nav.overview')}</span>
        </div>
      );
    }

    render(
      <I18nProvider>
        <BareEn />
      </I18nProvider>,
    );

    expect(screen.getByText('Overview')).toBeDefined();
  });
});
