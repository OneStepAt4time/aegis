/**
 * shared/LanguageSwitcher.tsx — Locale selector dropdown.
 * Uses the I18n context to read/write locale preference.
 */

import { useLocale } from '../../i18n/context';

const LANGUAGES = [
  { value: 'en-US', label: 'English' },
  { value: 'it-IT', label: 'Italiano' },
] as const;

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      value={locale === 'en' ? 'en-US' : locale}
      onChange={(e) => setLocale(e.target.value)}
      aria-label="Language"
      className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
    >
      {LANGUAGES.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
