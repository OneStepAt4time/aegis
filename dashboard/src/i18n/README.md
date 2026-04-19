# Internationalization (i18n) — Aegis Dashboard

**Issue 021** — i18n plumbing for future multilingual support.

## Overview

The Aegis dashboard now has a complete i18n infrastructure in place, ready for translation to additional languages. While we currently only ship English (`en`), the plumbing is production-ready.

## Architecture

### 1. Message Catalog (`dashboard/src/i18n/en.ts`)

All user-facing strings live in a single, nested object:

```typescript
export const en = {
  nav: { overview: 'Overview', sessions: 'Sessions', ... },
  overview: { title: 'Overview', subtitle: '...', ... },
  settings: { display: { theme: 'Theme', ... }, ... },
  // ...
};
```

**Rules:**
- **No inline JSX strings** of > 3 words (enforced by `npm run dashboard:i18n:check`)
- Pure accessible labels on icons (e.g., `aria-label="Close"`) are exempt

### 2. Context + Hook (`dashboard/src/i18n/context.tsx`)

Simple React Context-based solution (no external library):

```tsx
import { I18nProvider, useT, useLocale } from './i18n/context';

// Wrap app:
<I18nProvider>
  <App />
</I18nProvider>

// In components:
const t = useT();
return <h1>{t('overview.title')}</h1>;

// With parameters:
<p>{t('cost.lastDays', { count: 14 })}</p>
```

**Locale management:**
```tsx
const { locale, setLocale } = useLocale();
setLocale('de-DE'); // persists to localStorage → aegis:locale
```

### 3. Format Utilities

All formatting uses standard `Intl.*` APIs, respecting the user's locale preference:

#### Dates (`dashboard/src/utils/formatDate.ts`)
```typescript
formatDate(date)          // → "Jan 15, 2025"
formatDateShort(date)     // → "Jan 15"
formatDateTime(date)      // → "Jan 15, 2025, 3:45 PM"
```

#### Numbers (`dashboard/src/utils/formatNumber.ts`)
```typescript
formatNumber(1234.56)     // → "1,234.56"
formatCurrency(123.45)    // → "$123.45"
formatPercent(0.456)      // → "46%"
formatCompact(1500)       // → "1.5K"
formatBytes(1024)         // → "1 KB"
```

#### Relative Time (`dashboard/src/utils/formatRelativeTime.ts`)
```typescript
formatRelativeTime(timestamp)     // → "5 minutes ago"
formatTimeAgo(timestamp)          // → "5 minutes ago" (past only)
formatRelativeTimeShort(timestamp) // → "5m ago"
```

#### Plurals (`dashboard/src/utils/pluralize.ts`)
```typescript
pluralize(1, 'session', 'sessions')  // → "1 session"
pluralize(5, 'session', 'sessions')  // → "5 sessions"

// Or create a reusable function:
const countSessions = createPluralize('session', 'sessions');
countSessions(3); // → "3 sessions"
```

### 4. i18n Gate (`scripts/i18n-gate.cjs`)

Prevents inline JSX string literals from creeping back in:

```bash
npm run dashboard:i18n:check
```

**Allowlist patterns:**
- Short strings (< 15 chars, < 4 words)
- `aria-*` attributes
- CSS variables, URLs, paths
- Single PascalCase words

## Adding a New Language

1. **Create catalog:** `dashboard/src/i18n/de.ts`
   ```typescript
   export const de = {
     nav: { overview: 'Übersicht', sessions: 'Sitzungen', ... },
     // ... translate all keys from en.ts
   };
   ```

2. **Register in context:** `dashboard/src/i18n/context.tsx`
   ```typescript
   import { de } from './de';
   
   const MESSAGES: Record<string, Messages> = {
     'en-US': en,
     'de-DE': de,
     // ...
   };
   ```

3. **Add to locale picker:** `dashboard/src/pages/SettingsPage.tsx`
   ```typescript
   const LOCALES = [
     { value: 'en-US', label: 'English (US)', flag: '🇺🇸' },
     { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
     // ...
   ];
   ```

## RTL Support

Key layout components use **logical properties** (`padding-inline-start`, `margin-inline-end`) instead of directional ones (`padding-left`, `margin-right`).

Test RTL rendering:
```bash
cd dashboard && npm run test:e2e -- i18n-rtl.spec.ts
```

## Testing

### Unit Tests
```bash
cd dashboard && npm test -- i18n
```

### E2E Tests
```bash
cd dashboard && npm run test:e2e -- i18n-rtl.spec.ts
```

### Snapshot Tests
Render key components in multiple locales (future work):
```typescript
test('renders in German', () => {
  render(
    <I18nProvider locale="de-DE">
      <OverviewPage />
    </I18nProvider>
  );
  expect(screen.getByText('Übersicht')).toBeInTheDocument();
});
```

## Migration Path

**NOT all components are migrated yet** — that's by design. The infrastructure is ready, but we're not blocking existing work.

**Current state:**
- ✅ Infrastructure complete (catalog, context, utilities, gate)
- ✅ Settings page has locale picker
- ✅ Format utilities used in CostPage, SparklineCard
- ⏳ Most pages still have inline strings (will migrate incrementally)

**Future work:**
- Migrate remaining pages to use `useT()` hook
- Add German, Japanese, Arabic translations
- Enable the i18n gate in CI (currently standalone only)

## Quality Gates

```bash
npm run dashboard:i18n:check  # Standalone gate (not in main gate yet)
npm run gate                   # Full quality gate (passes)
```

## Design Principles

1. **No external library** — React Context + `Intl.*` APIs
2. **Locale from localStorage** → `aegis:locale` (falls back to `navigator.language`)
3. **Parameter substitution** — `{count}` → `params.count`
4. **Future-proof** — structure ready for ICU MessageFormat if needed
5. **RTL-first** — logical properties throughout

---

**Status:** ✅ Infrastructure complete, ready for incremental migration  
**Issue:** #021  
**Author:** Copilot  
**Date:** 2026-04-19
