import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsPage from '../pages/SettingsPage';

const STORAGE_KEY = 'aegis-dashboard-settings';
const THEME_KEY = 'aegis-dashboard-theme';

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, 'getItem');
    vi.spyOn(Storage.prototype, 'setItem');
    // Mock matchMedia for useTheme hook
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage(): void {
    render(<SettingsPage />);
  }

  it('renders the settings page with header and sections', () => {
    renderPage();

    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Dashboard preferences')).toBeDefined();
    expect(screen.getByText('Display')).toBeDefined();
    expect(screen.getByText('Auto-Refresh')).toBeDefined();
  });

  it('loads default settings when localStorage is empty', () => {
    renderPage();

    const pageSizeSelect = screen.getByDisplayValue('25');
    expect(pageSizeSelect).toBeDefined();

    // Auto-refresh toggle is on by default (aria-checked=true)
    const toggle = screen.getByRole('switch', { name: 'Enable auto-refresh' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Refresh interval select is visible (auto-refresh is on) with default 30s
    expect(screen.getByDisplayValue('30 seconds')).toBeDefined();
  });

  it('loads persisted settings from localStorage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoRefresh: false, refreshIntervalSec: 60, defaultPageSize: 50 }),
    );

    renderPage();

    expect(screen.getByDisplayValue('50')).toBeDefined();

    // Auto-refresh is off — toggle should show false
    const toggle = screen.getByRole('switch', { name: 'Enable auto-refresh' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    // Refresh interval select should NOT be visible when auto-refresh is off
    expect(screen.queryByText('Refresh interval')).toBeNull();
  });

  it('persists settings to localStorage on change', () => {
    renderPage();

    const pageSizeSelect = screen.getByDisplayValue('25');
    fireEvent.change(pageSizeSelect, { target: { value: '100' } });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining('"defaultPageSize":100'),
    );
  });

  it('toggles theme between dark and light', () => {
    renderPage();

    // Default theme depends on system preference / localStorage — find the button
    const themeButton = screen.getByRole('button', { name: /Dark|Light/ });

    // Click to toggle
    fireEvent.click(themeButton);

    // Theme is persisted via useTheme hook
    expect(localStorage.setItem).toHaveBeenCalledWith(THEME_KEY, expect.any(String));
  });

  it('toggles auto-refresh switch off and hides refresh interval', () => {
    renderPage();

    // auto-refresh is on by default
    expect(screen.getByText('Refresh interval')).toBeDefined();

    const toggle = screen.getByRole('switch', { name: 'Enable auto-refresh' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Refresh interval')).toBeNull();

    // Verify persisted with autoRefresh: false
    expect(localStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining('"autoRefresh":false'),
    );
  });

  it('toggles auto-refresh back on and shows refresh interval', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoRefresh: false, refreshIntervalSec: 60, defaultPageSize: 25 }),
    );

    renderPage();

    // auto-refresh is off
    expect(screen.queryByText('Refresh interval')).toBeNull();

    const toggle = screen.getByRole('switch', { name: 'Enable auto-refresh' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Refresh interval')).toBeDefined();
  });

  it('changes refresh interval and persists', () => {
    renderPage();

    const intervalSelect = screen.getByDisplayValue('30 seconds');
    fireEvent.change(intervalSelect, { target: { value: '120' } });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining('"refreshIntervalSec":120'),
    );
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json');

    renderPage();

    // Should fall back to defaults
    expect(screen.getByDisplayValue('25')).toBeDefined();
    const toggle = screen.getByRole('switch', { name: 'Enable auto-refresh' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders all page size options', () => {
    renderPage();

    const pageSizeSelect = screen.getByDisplayValue('25');
    const options = pageSizeSelect.querySelectorAll('option');
    const values = Array.from(options).map((o) => o.getAttribute('value'));

    expect(values).toEqual(['10', '25', '50', '100']);
  });

  it('renders all refresh interval options', () => {
    renderPage();

    const intervalSelect = screen.getByDisplayValue('30 seconds');
    const options = intervalSelect.querySelectorAll('option');
    const values = Array.from(options).map((o) => o.getAttribute('value'));

    expect(values).toEqual(['10', '30', '60', '120', '300']);
  });

  it('all form controls have accessible names (issue #2365)', () => {
    const { container } = render(<SettingsPage />);

    // Always-visible controls
    expect(screen.getByLabelText('Default page size')).toBeDefined();
    expect(screen.getByLabelText('Language and region')).toBeDefined();
    expect(screen.getByRole('switch', { name: /Enable auto-refresh/ })).toBeDefined();
    expect(screen.getByRole('switch', { name: /Enable budget alerts/ })).toBeDefined();

    // Budget section — conditionally visible when budgetAlertEnabled is true (default)
    const dailyInput = screen.queryByLabelText('Daily spending cap (USD)');
    const monthlyInput = screen.queryByLabelText('Monthly spending cap (USD)');
    const hardStop = screen.queryByLabelText('Hard stop at 100%');
    const refreshSelect = screen.queryByLabelText('Refresh interval');

    if (dailyInput) {
      expect(dailyInput.getAttribute('type')).toBe('number');
    }
    if (monthlyInput) {
      expect(monthlyInput.getAttribute('type')).toBe('number');
    }
    if (hardStop) {
      expect(hardStop).toBeDefined();
    }
    if (refreshSelect) {
      expect(refreshSelect).toBeDefined();
    }

    // Verify aria-label attributes exist in source
    expect(container.innerHTML).toContain('aria-label="Default page size"');
    expect(container.innerHTML).toContain('aria-label="Language and region"');
    expect(container.innerHTML).toContain('aria-label="Daily spending cap (USD)"');
    expect(container.innerHTML).toContain('aria-label="Monthly spending cap (USD)"');
    expect(container.innerHTML).toContain('aria-label="Refresh interval"');
  });
});
