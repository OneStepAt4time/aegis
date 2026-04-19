/**
 * pages/SettingsPage.tsx — Dashboard settings with localStorage persistence.
 */

import { useState, useEffect } from 'react';
import { Settings, Monitor, Bell, DollarSign } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useReadingFont, type ReadingFont } from '../stores/readingFontStore';
import { useLocale } from '../i18n/context';

const STORAGE_KEY = 'aegis-dashboard-settings';

interface Settings {
  autoRefresh: boolean;
  refreshIntervalSec: number;
  defaultPageSize: number;
  budgetDailyCapUsd: number;
  budgetMonthlyCapUsd: number;
  budgetAlertEnabled: boolean;
  budgetHardStopEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  autoRefresh: true,
  refreshIntervalSec: 30,
  defaultPageSize: 25,
  budgetDailyCapUsd: 100,
  budgetMonthlyCapUsd: 1000,
  budgetAlertEnabled: true,
  budgetHardStopEnabled: false,
};

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

const LIGHT_VARIANTS: { value: Exclude<Theme, 'dark' | 'auto'>; label: string; description: string }[] = [
  { value: 'light', label: 'Default', description: 'Cool slate white' },
  { value: 'light-paper', label: 'Paper', description: 'Warm sepia tone' },
  { value: 'light-aaa', label: 'AAA', description: 'Max contrast (7:1+)' },
];

const READING_FONTS: { value: ReadingFont; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'DM Sans' },
  { value: 'hyperlegible', label: 'Hyperlegible', description: 'Atkinson Hyperlegible' },
  { value: 'dyslexia', label: 'Dyslexia', description: 'OpenDyslexic' },
];

const LOCALES: { value: string; label: string; flag: string }[] = [
  { value: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { value: 'ar-SA', label: 'العربية', flag: '🇸🇦' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { theme, resolvedTheme, toggleTheme, setTheme } = useTheme();
  const { readingFont, setReadingFont } = useReadingFont();
  const { locale, setLocale } = useLocale();

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const isLight = resolvedTheme !== 'dark';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Settings</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Dashboard preferences</p>
        </div>
      </div>

      {/* Display */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">Display</h3>
        </div>
        <div className="space-y-4">
          {/* Dark / Light toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Theme</p>
              <p className="text-xs text-[var(--color-text-muted)]">Switch between dark and light mode</p>
            </div>
            <button
              onClick={toggleTheme}
              className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {resolvedTheme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>

          {/* Light sub-theme picker — shown only in light mode */}
          {isLight && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--color-text-primary)]">Light variant</p>
                <p className="text-xs text-[var(--color-text-muted)]">Choose a light-mode sub-theme</p>
              </div>
              <div className="flex gap-1.5">
                {LIGHT_VARIANTS.map(({ value, label, description }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    title={description}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      theme === value || (theme === 'auto' && value === 'light')
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium dark:bg-blue-500/10 dark:text-blue-300'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Auto theme toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Auto theme</p>
              <p className="text-xs text-[var(--color-text-muted)]">Follow system <code className="font-mono text-[11px]">prefers-color-scheme</code></p>
            </div>
            <input
              type="checkbox"
              id="auto-theme-toggle"
              checked={theme === 'auto'}
              onChange={(e) => setTheme(e.target.checked ? 'auto' : resolvedTheme)}
              className="h-4 w-4 cursor-pointer accent-blue-600"
              aria-label="Auto theme"
            />
          </div>

          {/* Default page size */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Default page size</p>
              <p className="text-xs text-[var(--color-text-muted)]">Rows per page in session history</p>
            </div>
            <select
              value={settings.defaultPageSize}
              onChange={(e) => update('defaultPageSize', Number(e.target.value))}
              className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          {/* Reading font toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Reading font</p>
              <p className="text-xs text-[var(--color-text-muted)]">Choose a body font for readability</p>
            </div>
            <div className="flex gap-1.5">
              {READING_FONTS.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => setReadingFont(value)}
                  title={description}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    readingFont === value
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium dark:bg-blue-500/10 dark:text-blue-300'
                      : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Locale picker */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Language & Region</p>
              <p className="text-xs text-[var(--color-text-muted)]">Set display language and regional formats</p>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
            >
              {LOCALES.map(({ value, label, flag }) => (
                <option key={value} value={value}>
                  {flag} {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Notifications / Auto-refresh */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">Auto-Refresh</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Enable auto-refresh</p>
              <p className="text-xs text-[var(--color-text-muted)]">Automatically update dashboard data</p>
            </div>
            <button
              onClick={() => update('autoRefresh', !settings.autoRefresh)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autoRefresh ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-700'
              }`}
              role="switch"
              aria-checked={settings.autoRefresh}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  settings.autoRefresh ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {settings.autoRefresh && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--color-text-primary)]">Refresh interval</p>
                <p className="text-xs text-[var(--color-text-muted)]">How often to poll for updates</p>
              </div>
              <select
                value={settings.refreshIntervalSec}
                onChange={(e) => update('refreshIntervalSec', Number(e.target.value))}
                className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
              >
                <option value={10}>10 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Budget & Cost Alerts */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" id="budget">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">Budget & Cost Alerts</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">Enable budget alerts</p>
              <p className="text-xs text-[var(--color-text-muted)]">Warning at 80% of cap</p>
            </div>
            <button
              onClick={() => update('budgetAlertEnabled', !settings.budgetAlertEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.budgetAlertEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-700'
              }`}
              role="switch"
              aria-checked={settings.budgetAlertEnabled}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  settings.budgetAlertEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {settings.budgetAlertEnabled && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">Daily spending cap</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Maximum USD per day</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--color-text-muted)]">$</span>
                  <input
                    type="number"
                    min="1"
                    step="10"
                    value={settings.budgetDailyCapUsd}
                    onChange={(e) => update('budgetDailyCapUsd', Number(e.target.value))}
                    className="w-24 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">Monthly spending cap</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Maximum USD per month</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--color-text-muted)]">$</span>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={settings.budgetMonthlyCapUsd}
                    onChange={(e) => update('budgetMonthlyCapUsd', Number(e.target.value))}
                    className="w-24 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">Hard stop at 100%</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Block new sessions when cap reached</p>
                </div>
                <input
                  type="checkbox"
                  id="budget-hard-stop"
                  checked={settings.budgetHardStopEnabled}
                  onChange={(e) => update('budgetHardStopEnabled', e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                  aria-label="Hard stop at 100%"
                />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
