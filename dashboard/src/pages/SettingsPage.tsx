/**
 * pages/SettingsPage.tsx — Dashboard settings with localStorage persistence.
 */

import { useState, useEffect } from 'react';
import { Settings, Monitor, Bell } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

const STORAGE_KEY = 'aegis-dashboard-settings';

interface Settings {
  autoRefresh: boolean;
  refreshIntervalSec: number;
  defaultPageSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  autoRefresh: true,
  refreshIntervalSec: 30,
  defaultPageSize: 25,
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Dashboard preferences</p>
        </div>
      </div>

      {/* Display */}
      <section className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="h-4 w-4 text-gray-400 dark:text-zinc-400" />
          <h3 className="text-lg font-medium text-gray-800 dark:text-zinc-200">Display</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-zinc-300">Theme</p>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Switch between dark and light mode</p>
            </div>
            <button
              onClick={toggleTheme}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
            >
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-zinc-300">Default page size</p>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Rows per page in session history</p>
            </div>
            <select
              value={settings.defaultPageSize}
              onChange={(e) => update('defaultPageSize', Number(e.target.value))}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </section>

      {/* Notifications / Auto-refresh */}
      <section className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-gray-400 dark:text-zinc-400" />
          <h3 className="text-lg font-medium text-gray-800 dark:text-zinc-200">Auto-Refresh</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-zinc-300">Enable auto-refresh</p>
              <p className="text-xs text-gray-500 dark:text-zinc-500">Automatically update dashboard data</p>
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
                <p className="text-sm text-gray-700 dark:text-zinc-300">Refresh interval</p>
                <p className="text-xs text-gray-500 dark:text-zinc-500">How often to poll for updates</p>
              </div>
              <select
                value={settings.refreshIntervalSec}
                onChange={(e) => update('refreshIntervalSec', Number(e.target.value))}
                className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100"
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
    </div>
  );
}
