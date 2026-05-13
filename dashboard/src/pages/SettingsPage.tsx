/**
 * pages/SettingsPage.tsx — Dashboard settings with localStorage persistence.
 */

import { useState, useEffect } from 'react';
import { Settings, Monitor, Bell, DollarSign, AlertTriangle, RotateCcw } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useReadingFont, type ReadingFont } from '../stores/readingFontStore';
import { useLocale } from '../i18n/context';
import { useT } from '../i18n/context';

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

const LOCALES: { value: string; label: string; flag: string }[] = [
  { value: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { value: 'ar-SA', label: 'العربية', flag: '🇸🇦' },
];

interface TouchTargetCheckboxProps {
  checked: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

function TouchTargetCheckbox({ checked, id, label, onCheckedChange }: TouchTargetCheckboxProps) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center"
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-blue-600"
        aria-label={label}
      />
    </label>
  );
}

interface SettingsSwitchProps {
  checked: boolean;
  label: string;
  onClick: () => void;
}

function SettingsSwitch({ checked, label, onClick }: SettingsSwitchProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] min-w-[56px] items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-cyan)]"
      role="switch"
      aria-label={label}
      aria-checked={checked}
    >
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-[var(--color-void-lighter)]'
        }`}
      >
        <span
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const handleRestartOnboarding = () => { try { localStorage.removeItem('aegis:onboarded'); sessionStorage.removeItem('aegis:onboarded'); } catch {} window.location.reload(); };
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { theme, resolvedTheme, toggleTheme, setTheme } = useTheme();
  const { readingFont, setReadingFont } = useReadingFont();
  const { locale, setLocale } = useLocale();
  const t = useT();

  const LIGHT_VARIANTS: { value: Exclude<Theme, 'dark' | 'auto'>; label: string; description: string }[] = [
    { value: 'light', label: t('settings.display.variantDefault'), description: t('settings.display.variantDefaultDescription') },
    { value: 'light-paper', label: t('settings.display.variantPaper'), description: t('settings.display.variantPaperDescription') },
    { value: 'light-aaa', label: t('settings.display.variantAaa'), description: t('settings.display.variantAaaDescription') },
  ];

  const READING_FONTS: { value: ReadingFont; label: string; description: string }[] = [
    { value: 'default', label: t('settings.display.fontDefault'), description: t('settings.display.fontDefaultDescription') },
    { value: 'hyperlegible', label: t('settings.display.fontHyperlegible'), description: t('settings.display.fontHyperlegibleDescription') },
    { value: 'dyslexia', label: t('settings.display.fontDyslexia'), description: t('settings.display.fontDyslexiaDescription') },
  ];

  useEffect(() => {
    try {
      saveSettings(settings);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    }
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
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('settings.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('settings.subtitle')}</p>
        </div>
      </div>

      {saveError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{t('settings.saveErrorTitle')}</p>
            <p className="mt-1 text-amber-200/80">{saveError}</p>
          </div>
        </div>
      )}

      {/* Display */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">{t('settings.display.title')}</h3>
        </div>
        <div className="space-y-4">
          {/* Dark / Light toggle */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.theme')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.themeDescription')}</p>
            </div>
            <button type="button"
              onClick={toggleTheme}
              className="min-h-[44px] rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {resolvedTheme === 'dark' ? t('settings.display.themeDark') : t('settings.display.themeLight')}
            </button>
          </div>

          {/* Light sub-theme picker — shown only in light mode */}
          {isLight && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.lightVariant')}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.lightVariantDescription')}</p>
              </div>
              <div className="flex gap-1.5">
                {LIGHT_VARIANTS.map(({ value, label, description }) => (
                  <button type="button"
                    key={value}
                    onClick={() => setTheme(value)}
                    title={description}
                    className={`min-h-[44px] px-2.5 py-1 text-xs rounded border transition-colors ${
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.autoTheme')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.autoThemeDescription')}</p>
            </div>
            <TouchTargetCheckbox
              id="auto-theme-toggle"
              checked={theme === 'auto'}
              onCheckedChange={(checked) => setTheme(checked ? 'auto' : resolvedTheme)}
              label={t('settings.display.autoTheme')}
            />
          </div>

          {/* Default page size */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.defaultPageSize')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.defaultPageSizeDescription')}</p>
            </div>
            <select
              aria-label={t('settings.display.defaultPageSize')}
              value={settings.defaultPageSize}
              onChange={(e) => update('defaultPageSize', Number(e.target.value))}
              className="min-h-[44px] rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          {/* Reading font toggle */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.readingFont')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.readingFontDescription')}</p>
            </div>
            <div className="flex gap-1.5">
              {READING_FONTS.map(({ value, label, description }) => (
                <button type="button"
                  key={value}
                  onClick={() => setReadingFont(value)}
                  title={description}
                  className={`min-h-[44px] px-2.5 py-1 text-xs rounded border transition-colors ${
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.display.locale')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.display.localeDescription')}</p>
            </div>
            <select
              aria-label={t('settings.display.locale')}
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="min-h-[44px] rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
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
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">{t('settings.autoRefresh.title')}</h3>
        </div>
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.autoRefresh.enable')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.autoRefresh.enableDescription')}</p>
            </div>
            <SettingsSwitch
              checked={settings.autoRefresh}
              label={t('settings.autoRefresh.enable')}
              onClick={() => update('autoRefresh', !settings.autoRefresh)}
            />
          </div>
          {settings.autoRefresh && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-[var(--color-text-primary)]">{t('settings.autoRefresh.interval')}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('settings.autoRefresh.intervalDescription')}</p>
              </div>
              <select
                aria-label={t('settings.autoRefresh.interval')}
                value={settings.refreshIntervalSec}
                onChange={(e) => update('refreshIntervalSec', Number(e.target.value))}
                className="min-h-[44px] rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
              >
                <option value={10}>{t('settings.autoRefresh.interval10s')}</option>
                <option value={30}>{t('settings.autoRefresh.interval30s')}</option>
                <option value={60}>{t('settings.autoRefresh.interval1m')}</option>
                <option value={120}>{t('settings.autoRefresh.interval2m')}</option>
                <option value={300}>{t('settings.autoRefresh.interval5m')}</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Budget & Cost Alerts */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" id="budget">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">{t('settings.budget.title')}</h3>
        </div>
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{t('settings.budget.enableAlerts')}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.budget.enableAlertsDescription')}</p>
            </div>
            <SettingsSwitch
              checked={settings.budgetAlertEnabled}
              label={t('settings.budget.enableAlerts')}
              onClick={() => update('budgetAlertEnabled', !settings.budgetAlertEnabled)}
            />
          </div>

          {settings.budgetAlertEnabled && (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">{t('settings.budget.dailyCap')}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('settings.budget.dailyCapDescription')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--color-text-muted)]">$</span>
                  <input
                    aria-label={t('settings.budget.dailyCap')}
                    type="number"
                    min="1"
                    step="10"
                    value={settings.budgetDailyCapUsd}
                    onChange={(e) => update('budgetDailyCapUsd', Number(e.target.value))}
                    className="min-h-[44px] w-24 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">{t('settings.budget.monthlyCap')}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('settings.budget.monthlyCapDescription')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--color-text-muted)]">$</span>
                  <input
                    aria-label={t('settings.budget.monthlyCap')}
                    type="number"
                    min="1"
                    step="100"
                    value={settings.budgetMonthlyCapUsd}
                    onChange={(e) => update('budgetMonthlyCapUsd', Number(e.target.value))}
                    className="min-h-[44px] w-24 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-[var(--color-text-primary)]">{t('settings.budget.hardStop')}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('settings.budget.hardStopDescription')}</p>
                </div>
                <TouchTargetCheckbox
                  id="budget-hard-stop"
                  checked={settings.budgetHardStopEnabled}
                  onCheckedChange={(checked) => update('budgetHardStopEnabled', checked)}
                  label={t('settings.budget.hardStop')}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Onboarding */}
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Onboarding</h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Restart the first-run walkthrough wizard.
        </p>
        <button
          type="button"
          onClick={handleRestartOnboarding}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restart onboarding
        </button>
      </section>
    </div>
  );
}
