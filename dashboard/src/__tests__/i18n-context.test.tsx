/**
 * __tests__/i18n-context.test.tsx — Unit tests for I18nProvider and useT hook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, useT, useLocale } from '../i18n/context';

function TestComponent() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  
  return (
    <div>
      <div data-testid="locale">{locale}</div>
      <div data-testid="title">{t('overview.title')}</div>
      <div data-testid="subtitle">{t('overview.subtitle')}</div>
      <div data-testid="missing">{t('nonexistent.key')}</div>
      <button onClick={() => setLocale('de-DE')}>Change to German</button>
    </div>
  );
}

function TestParamsComponent() {
  const t = useT();
  
  return (
    <div>
      <div data-testid="with-params">{t('cost.lastDays', { count: 14 })}</div>
      <div data-testid="interval-seconds">{t('settings.autoRefresh.intervalSeconds', { count: 30 })}</div>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  
  it('should provide translation function via useT', () => {
    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );
    
    expect(screen.getByTestId('title').textContent).toBe('Overview');
    expect(screen.getByTestId('subtitle').textContent).toBe('System health and session controls.');
  });
  
  it('should return key for missing translations', () => {
    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );
    
    expect(screen.getByTestId('missing').textContent).toBe('nonexistent.key');
  });
  
  it('should support parameter substitution', () => {
    render(
      <I18nProvider>
        <TestParamsComponent />
      </I18nProvider>
    );
    
    expect(screen.getByTestId('with-params').textContent).toBe('Last 14 days');
    expect(screen.getByTestId('interval-seconds').textContent).toBe('30 seconds');
  });
  
  it('should initialize with default locale', () => {
    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );
    
    const locale = screen.getByTestId('locale').textContent;
    expect(locale).toMatch(/en/); // Should be en or en-US
  });
  
  it('should persist locale to localStorage', () => {
    const { rerender } = render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );
    
    // Change locale
    screen.getByText('Change to German').click();
    
    // Check localStorage
    expect(localStorage.getItem('aegis:locale')).toBe('de-DE');
    
    // Rerender to ensure it persists
    rerender(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );
    
    expect(screen.getByTestId('locale').textContent).toBe('de-DE');
  });
  
  it('should handle nested message keys', () => {
    const t = (key: string) => {
      const TestNested = () => {
        const translate = useT();
        return <div data-testid="nested">{translate(key)}</div>;
      };
      
      const { container } = render(
        <I18nProvider>
          <TestNested />
        </I18nProvider>
      );
      
      return container.querySelector('[data-testid="nested"]')?.textContent;
    };
    
    expect(t('settings.display.theme')).toBe('Theme');
    expect(t('settings.autoRefresh.enable')).toBe('Enable auto-refresh');
    expect(t('status.idle')).toBe('Idle');
  });
});
