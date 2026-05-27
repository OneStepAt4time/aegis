/**
 * layout/Header.tsx — Top header bar with breadcrumb, actions, version, and theme toggle.
 */

import { lazy, Suspense } from 'react';
import { SSEStatusIndicator } from './SSEStatusIndicator';
import Breadcrumb from '../shared/Breadcrumb';
import { ApprovalBadge } from '../approvals/ApprovalNotification';
import { Sun, Moon, Plus, Search, RefreshCw, Menu } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useDrawerStore } from '../../store/useDrawerStore';
import { useT } from '../../i18n/context';
import type { UpdateCheckResult } from '../../api/client';
const CommandPalette = lazy(() => import('../shared/CommandPalette'));

interface HeaderProps {
  aegisVersion: string;
  updateCheckLoading: boolean;
  updateCheckError: string | null;
  updateResult: UpdateCheckResult | null;
  onCheckUpdates: () => void;
  isMobileDrawerOpen: boolean;
  onToggleMobile: () => void;
  paletteOpen: boolean;
  onPaletteOpenChange: (open: boolean) => void;
}

export function Header({
  aegisVersion,
  updateCheckLoading,
  updateCheckError,
  updateResult,
  onCheckUpdates,
  isMobileDrawerOpen,
  onToggleMobile,
  paletteOpen,
  onPaletteOpenChange,
}: HeaderProps) {
  const t = useT();
  const { resolvedTheme, toggleTheme } = useTheme();
  const openNewSession = useDrawerStore((s) => s.openNewSession);

  return (
    <>
      <header className="shrink-0 border-b border-white/5 bg-transparent backdrop-blur-md px-4 py-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={onToggleMobile}
              tabIndex={isMobileDrawerOpen ? -1 : undefined}
              aria-hidden={isMobileDrawerOpen ? 'true' : undefined}
              className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)] transition-colors"
              aria-label={t("aria.openMenu")}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <Breadcrumb />
            </div>
          </div>

          <div className={`flex items-center justify-end gap-1.5 sm:gap-3 transition-opacity ${isMobileDrawerOpen ? "pointer-events-none opacity-30" : ""}`}>
            <span className="hidden sm:inline-flex rounded-md border border-transparent bg-[var(--color-info)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-info)] ring-1 ring-[var(--color-info)]/30 dark:border-[var(--color-cta-bg)]/50 dark:bg-[var(--color-cta-bg)]/10 dark:text-[var(--color-cta-bg)] dark:ring-0">
              PREVIEW
            </span>

            <SSEStatusIndicator />
            <ApprovalBadge />

            <button
              type="button"
              onClick={openNewSession}
              aria-label={t("aria.newSessionCmd")}
              title="New Session (⌘N)"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg p-2.5 min-h-[44px] min-w-[44px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onPaletteOpenChange(true)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-md border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-slate-50 hover:text-[var(--color-text-primary)] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 transition-all"
              aria-label="Open command palette"
            >
              <Search className="h-3 w-3" />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="hidden sm:inline ml-1 font-mono text-[10px] text-[var(--color-text-primary)] border border-white/10 rounded px-1">⌘K</kbd>
            </button>

            <div className="inline-flex items-center gap-1 sm:gap-2 rounded-md border border-[var(--color-border-strong)] bg-white px-1.5 py-1 sm:px-2 text-xs text-[var(--color-text-primary)] dark:border-[var(--color-void-lighter)] dark:bg-[var(--color-void-dark)] dark:text-[var(--color-text-primary)]">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-11 w-11 items-center justify-center rounded p-2 sm:p-2.5 min-h-[44px] min-w-[44px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)]"
                aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <span className="hidden sm:inline truncate">Version {aegisVersion}</span>
            </div>

            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={updateCheckLoading || aegisVersion === '...'}
              className="hidden min-h-[44px] sm:inline-flex items-center gap-1 rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] dark:border-[var(--color-void-lighter)] dark:hover:bg-[var(--color-void-lighter)] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-50 disabled:text-[var(--color-text-primary)] dark:disabled:border-[var(--color-void-lighter)] dark:disabled:bg-transparent dark:disabled:text-[var(--color-text-muted)]"
            >
              <RefreshCw className={`h-3 w-3 ${updateCheckLoading ? 'animate-spin' : ''}`} />
              {updateCheckLoading ? 'Checking…' : 'Check updates'}
            </button>

            {updateResult && (
              <div className="hidden text-xs text-[var(--color-text-muted)] sm:block">
                {updateResult.updateAvailable ? (
                  <a
                    href={updateResult.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent-cyan)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-cyan)]"
                  >
                    Update available: v{updateResult.latestVersion}
                  </a>
                ) : (
                  <span>Up to date (v{updateResult.currentVersion})</span>
                )}
              </div>
            )}

            {updateCheckError && (
              <div className="hidden sm:block text-xs text-[var(--color-warning)]" title={updateCheckError}>
                Update check failed
              </div>
            )}
          </div>
        </div>
      </header>
      <Suspense fallback={null}><CommandPalette open={paletteOpen} onClose={() => onPaletteOpenChange(false)} /></Suspense>
    </>
  );
}
