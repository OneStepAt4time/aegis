/**
 * components/Layout.tsx — Main layout composition root.
 *
 * Delegates to:
 *   layout/Sidebar.tsx    — collapsible sidebar navigation
 *   layout/Header.tsx     — top header bar
 *   layout/useLayoutSSE   — global SSE subscription
 *   layout/useVersionCheck — version loading + update checking
 */

import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import LiveAuditStream from './shared/LiveAuditStream';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { ApprovalNotification } from './approvals/ApprovalNotification';
import { NewSessionDrawer } from './NewSessionDrawer';
import ToastContainer from './ToastContainer';
import ConnectionBanner from './ConnectionBanner';
import { ServerHealthBanner } from './shared/ServerHealthIndicator';
import { SessionExpiredModal } from './shared/SessionExpiredModal';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore.js';
import { useSidebarStore } from '../store/useSidebarStore.js';
import { useDrawerStore } from '../store/useDrawerStore';
import { AlertTriangle } from 'lucide-react';

import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';
import { useLayoutSSE } from './layout/useLayoutSSE';
import { useVersionCheck } from './layout/useVersionCheck';
import { useInboxFromActivity } from '../hooks/useInboxFromActivity';
import { MOBILE_SIDEBAR_QUERY } from './layout/types';
import { useT } from '../i18n/context';

function isMobileSidebarViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches;
}

export default function Layout() {
  const t = useT();
  const token = useStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const isMobileOpen = useSidebarStore((s) => s.isMobileOpen);
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const closeMobile = useSidebarStore((s) => s.closeMobile);
  const openNewSession = useDrawerStore((s) => s.openNewSession);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileSidebarViewport);

  const { sseConnected, sseError, sseIndicatorLabel } = useLayoutSSE(token);
  useInboxFromActivity(); // Bridge SSE events to inbox
  const {
    aegisVersion,
    updateCheckLoading,
    updateCheckError,
    updateResult,
    handleCheckUpdates,
  } = useVersionCheck();

  // Cmd+K global shortcut (desktop only)
  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return undefined;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Mobile viewport detection
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    let wasMobileViewport = mediaQuery.matches;
    let hasAutoOpened = false;

    const handleViewportChange = () => {
      const nextIsMobileViewport = mediaQuery.matches;
      setIsMobileViewport(nextIsMobileViewport);
      if (!hasAutoOpened && !wasMobileViewport && nextIsMobileViewport) {
        setMobileOpen(true);
        hasAutoOpened = true;
      }
      wasMobileViewport = nextIsMobileViewport;
    };

    handleViewportChange();
    mediaQuery.addEventListener('change', handleViewportChange);
    return () => mediaQuery.removeEventListener('change', handleViewportChange);
  }, [setMobileOpen]);

  // Cmd+N global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
        if (!isInput) {
          e.preventDefault();
          openNewSession();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openNewSession]);

  // Escape to close mobile sidebar
  useEffect(() => {
    if (!isMobileOpen) return undefined;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMobile(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobileOpen, closeMobile]);

  const isMobileDrawerOpen = isMobileViewport && isMobileOpen;
  const isMobileSidebarHidden = isMobileViewport && !isMobileOpen;
  const hiddenMobileSidebarControlTabIndex = isMobileSidebarHidden ? -1 : undefined;

  function handleNavClick(): void { if (isMobileDrawerOpen) closeMobile(); }
  function handleLogout(): void { void logout(); }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-void-dark)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-[var(--color-accent-cyan)] focus:text-[var(--color-void-deep)] focus:px-4 focus:py-2 focus:rounded focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {isMobileOpen && (
        <div
          data-testid="mobile-sidebar-backdrop"
          className="fixed inset-0 z-30 bg-[var(--color-scrim)] md:hidden"
          onClick={closeMobile}
          role="button"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}

      <Sidebar
        onNavClick={handleNavClick}
        onLogout={handleLogout}
        isMobileDrawerOpen={isMobileDrawerOpen}
        isMobileSidebarHidden={isMobileSidebarHidden}
        hiddenMobileSidebarControlTabIndex={hiddenMobileSidebarControlTabIndex}
      />

      <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
        <Header
          aegisVersion={aegisVersion}
          updateCheckLoading={updateCheckLoading}
          updateCheckError={updateCheckError}
          updateResult={updateResult}
          onCheckUpdates={handleCheckUpdates}
          isMobileDrawerOpen={isMobileDrawerOpen}
          onToggleMobile={toggleMobile}
          paletteOpen={paletteOpen}
          onPaletteOpenChange={setPaletteOpen}
        />

        <div className="flex flex-1 overflow-hidden">
          <main
            id="main-content"
            aria-hidden={isMobileDrawerOpen ? 'true' : undefined}
            className={`flex-1 overflow-auto overscroll-contain p-3 sm:p-6 md:p-10 transition-all duration-500 animate-slide-in ${isMobileDrawerOpen ? 'pointer-events-none select-none blur-[1px] md:pointer-events-auto md:select-auto md:blur-none' : ''}`}
          >
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
          <LiveAuditStream />
        </div>

        <footer className="shrink-0 border-t border-white/5 bg-transparent backdrop-blur-md px-3 py-2 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0" title={sseError ?? undefined}>
            {sseError ? (
              <>
                <AlertTriangle className="h-3 w-3 text-[var(--color-warning)] shrink-0" />
                <span className="text-[11px] text-[var(--color-warning)] truncate">{sseIndicatorLabel}</span>
              </>
            ) : (
              <>
                <span
                  className={`status-dot shrink-0 ${sseConnected ? 'status-dot--idle' : ''}`}
                  style={sseConnected ? undefined : { backgroundColor: 'var(--color-text-muted)' }}
                />
                <span className="text-[11px] text-[var(--color-text-muted)] truncate">{sseIndicatorLabel}</span>
              </>
            )}
          </div>

          <span className="hidden sm:block text-[11px] text-[var(--color-text-muted)] font-mono">aegis v{aegisVersion}</span>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden min-h-[44px] md:flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <kbd className="font-mono text-[10px] border border-white/10 bg-white/5 rounded px-1 text-[var(--color-text-primary)]">⌘K</kbd>
            Command palette
          </button>

          <span className="hidden md:inline text-[11px] text-[var(--color-text-muted)]">·</span>

          <button
            type="button"
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={t('aria.keyboardShortcuts')}
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))}
          >
            <kbd className="font-mono text-[10px] border border-white/10 bg-white/5 rounded px-1.5 text-[var(--color-text-primary)]">?</kbd>
            Shortcuts
          </button>

          <span className="sm:hidden text-[11px] text-[var(--color-text-muted)] font-mono truncate">v{aegisVersion}</span>
        </footer>
      </div>

      <ToastContainer />
      <ConnectionBanner />
      <ServerHealthBanner />
      <SessionExpiredModal />
      <ApprovalNotification />
      <NewSessionDrawer />
    </div>
  );
}
