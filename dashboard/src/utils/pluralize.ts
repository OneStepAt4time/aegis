/**
 * utils/pluralize.ts — Pluralization using Intl.PluralRules.
 * Replaces manual `${n} session${n !== 1 ? 's' : ''}` patterns.
 */

const LOCALE_STORAGE_KEY = 'aegis:locale';

function getLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  return navigator.language || 'en-US';
}

/**
 * Get the plural category for a number in the current locale.
 * Returns 'zero', 'one', 'two', 'few', 'many', or 'other'.
 */
export function getPluralCategory(count: number): Intl.LDMLPluralRule {
  const locale = getLocale();
  const pr = new Intl.PluralRules(locale);
  return pr.select(count);
}

/**
 * Simple pluralization: choose between singular and plural forms.
 * For English: count=1 uses singular, otherwise plural.
 * 
 * @example
 * pluralize(1, 'session', 'sessions') // "1 session"
 * pluralize(5, 'session', 'sessions') // "5 sessions"
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  const category = getPluralCategory(count);
  const word = category === 'one' ? singular : (plural || `${singular}s`);
  return `${count} ${word}`;
}

/**
 * Advanced pluralization with custom forms for each category.
 * Useful for languages with more complex plural rules.
 * 
 * @example
 * pluralizeAdvanced(0, {
 *   zero: 'no sessions',
 *   one: 'one session',
 *   other: '# sessions',
 * }) // "no sessions"
 */
export function pluralizeAdvanced(
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>>
): string {
  const category = getPluralCategory(count);
  let message = forms[category] || forms.other || `${count}`;
  
  // Replace # with the count
  message = message.replace(/#/g, String(count));
  
  return message;
}

/**
 * Create a pluralization function bound to specific forms.
 * 
 * @example
 * const sessionCount = createPluralize('session', 'sessions');
 * sessionCount(1) // "1 session"
 * sessionCount(5) // "5 sessions"
 */
export function createPluralize(
  singular: string,
  plural?: string
): (count: number) => string {
  return (count: number) => pluralize(count, singular, plural);
}
