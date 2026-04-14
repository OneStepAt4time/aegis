/**
 * components/Layout.tsx — Main layout with sidebar, header, and content area.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Breadcrumb from './shared/Breadcrumb';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Shield,
  UserRound,
  History,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore.js';
import { useSidebarStore } from '../store/useSidebarStore.js';
import { checkForUpdates, getHealth, subscribeGlobalSSE, type UpdateCheckResult } from '../api/client';
import ToastContainer from './ToastContainer';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/pipelines', label: 'Pipelines', icon: Activity },
  { to: '/sessions/history', label: 'Session History', icon: History },
  { to: '/users', label: 'Users', icon: UserRound },
  { to: '/audit', label: 'Audit Trail', icon: Shield },
  { to: '/auth/keys', label: 'Auth Keys', icon: KeyRound },
];

const MAX_SSE_RETRIES = 5;
const SSE_RETRY_BASE_MS = 1000;
const UPDATE_CHECK_CACHE_KEY = 'aegis:update-check:v1';
const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;

interface CachedUpdateCheckResult extends UpdateCheckResult {
  checkedAt: number;
  sourceVersion: string;
}
const SSE_RECONNECTING_MESSAGE = 'Reconnecting to real-time updates. Overview widgets are using fallback polling where available.';
const SSE_UNAVAILABLE_MESSAGE = 'Real-time updates unavailable. Overview widgets are using fallback polling where available.';
const SSE_SUBSCRIPTION_RETRY_MESSAGE = 'Connecting real-time updates failed. Retrying now.';

export default function Layout() {
  const sseConnected = useStore((s) => s.sseConnected);
  const setSseConnected = useStore((s) => s.setSseConnected);
  const sseError = useStore((s) => s.sseError);
  const setSseError = useStore((s) => s.setSseError);
  const addActivity = useStore((s) => s.addActivity);
  const token = useStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const isMobileOpen = useSidebarStore((s) => s.isMobileOpen);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);

  const [sseRetryCount, setSseRetryCount] = useState(0);
  const [aegisVersion, setAegisVersion] = useState<string>('...');
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  function readCachedUpdate(version: string): UpdateCheckResult | null {
    try {
      const raw = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw) as CachedUpdateCheckResult;
      if (cached.sourceVersion !== version) return null;
      if (Date.now() - cached.checkedAt > UPDATE_CHECK_TTL_MS) return null;
      return {
        currentVersion: cached.currentVersion,
        latestVersion: cached.latestVersion,
        updateAvailable: cached.updateAvailable,
        releaseUrl: cached.releaseUrl,
      };
    } catch {
      return null;
    }
  }

  function writeCachedUpdate(version: string, result: UpdateCheckResult): void {
    try {
      const payload: CachedUpdateCheckResult = {
        ...result,
        checkedAt: Date.now(),
        sourceVersion: version,
      };
      localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures (private mode/quota) and keep runtime behavior.
    }
  }

  async function runUpdateCheck(version: string, force: boolean): Promise<void> {
    if (!version || version === '...' || version === 'unknown') return;

    if (!force) {
      const cached = readCachedUpdate(version);
      if (cached) {
        setUpdateResult(cached);
        setUpdateCheckError(null);
        return;
      }
    }

    setUpdateCheckLoading(true);
    setUpdateCheckError(null);
    try {
      const result = await checkForUpdates(version);
      setUpdateResult(result);
      writeCachedUpdate(version, result);
    } catch (err) {
      setUpdateCheckError(err instanceof Error ? err.message : 'Failed to check updates');
      setUpdateResult(null);
    } finally {
      setUpdateCheckLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      try {
        const health = await getHealth();
        if (!cancelled) {
          setAegisVersion(health.version);
          void runUpdateCheck(health.version, false);
        }
      } catch (err) {
        console.warn('Failed to load Aegis version', err);
        if (!cancelled) setAegisVersion('unknown');
      }
    };

    void loadVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckUpdates = async () => {
    await runUpdateCheck(aegisVersion, true);
  };

  // #121: Wire up global SSE connection
  // #587: Wrap in try/catch with retry to prevent app crash and auto-recover
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function attemptConnect(attempt: number): void {
      if (cancelled) return;

      try {
        unsubscribe = subscribeGlobalSSE((event) => {
          if (!event.sessionId) return;
          addActivity(event);
        }, token, {
          onOpen: () => {
            setSseConnected(true);
            setSseError(null);
            setSseRetryCount(0);
          },
          onReconnecting: (attempt) => {
            setSseConnected(false);
            setSseRetryCount(attempt);
            setSseError(SSE_RECONNECTING_MESSAGE);
          },
          onClose: () => {
            setSseConnected(false);
          },
          onGiveUp: () => {
            setSseRetryCount(0);
            setSseError(SSE_UNAVAILABLE_MESSAGE);
            setSseConnected(false);
          },
        });
      } catch (err) {
        console.error('Failed to subscribe to global SSE (attempt %d):', attempt + 1, err);
        setSseConnected(false);

        if (attempt < MAX_SSE_RETRIES) {
          const delay = SSE_RETRY_BASE_MS * Math.pow(2, attempt);
          setSseRetryCount(attempt + 1);
          setSseError(SSE_SUBSCRIPTION_RETRY_MESSAGE);
          retryTimer = setTimeout(() => attemptConnect(attempt + 1), delay);
        } else {
          setSseRetryCount(0);
          setSseError(SSE_UNAVAILABLE_MESSAGE);
          setSseConnected(false);
        }
      }
    }

    attemptConnect(0);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribe?.();
    };
  }, [setSseConnected, setSseError, addActivity, token]);

  const sseIndicatorLabel = sseConnected
    ? 'SSE Live'
    : sseError
      ? sseRetryCount > 0
        ? `SSE Reconnecting (retry ${sseRetryCount})`
        : 'SSE Degraded'
      : 'SSE Off';

  function handleNavClick(): void {
    if (isMobileOpen) {
      toggleMobile();
    }
  }

  const sidebarWidth = isCollapsed ? 'w-16' : 'w-56';

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {/* Skip-to-content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-[100] focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none"
      >
        Skip to content
      </a>

      {/* ── Mobile backdrop ─────────────────────────────────── */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={toggleMobile}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col border-r border-void-lighter bg-void-light
          transition-all duration-200 ease-in-out
          ${sidebarWidth}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:shrink-0
          group/sidebar
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-void-lighter">
          <Shield className="h-6 w-6 text-blue-500 shrink-0" />
          {!isCollapsed && (
            <span className="text-lg font-semibold tracking-tight text-gray-100 whitespace-nowrap">
              Aegis
            </span>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-1 px-2 py-4 flex-1 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-l-2 border-cyan bg-cyan/10 text-cyan'
                    : 'text-gray-400 hover:bg-void-lighter hover:text-gray-200 border-l-2 border-transparent'
                } ${isCollapsed ? 'justify-center' : ''}`
              }
              title={isCollapsed ? label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}

        </nav>

        {/* Bottom section: toggle + logout */}
        <div className="border-t border-void-lighter px-2 py-3 flex flex-col gap-1">
          {/* Collapse toggle — desktop only */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden md:flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-void-lighter hover:text-gray-200 transition-colors w-full"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
            {!isCollapsed && <span className="truncate">Collapse</span>}
          </button>

          {/* Logout */}
          <button
            type="button"
            onClick={logout}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-void-lighter hover:text-gray-200 transition-colors w-full ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Sign out' : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="truncate">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-void-lighter bg-void-light px-6 py-3 shrink-0">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={toggleMobile}
              className="lg:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 hover:bg-void-lighter hover:text-gray-200 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Breadcrumb />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="rounded-md border border-yellow-500/50 px-2 py-1 bg-yellow-500/10 text-yellow-500 font-semibold text-[10px] uppercase tracking-wider mr-1">ALPHA</span><span className="rounded-md border border-void-lighter px-2 py-1 bg-void">
                Version {aegisVersion}
              </span>
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={updateCheckLoading || aegisVersion === '...'}
                className="inline-flex items-center gap-1 rounded-md border border-void-lighter px-2 py-1 text-gray-300 hover:bg-void-lighter disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3 w-3 ${updateCheckLoading ? 'animate-spin' : ''}`} />
                {updateCheckLoading ? 'Checking...' : 'Check updates'}
              </button>
            </div>

            {updateResult && (
              <div className="text-xs text-gray-400">
                {updateResult.updateAvailable ? (
                  <a
                    href={updateResult.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan hover:underline"
                  >
                    Update available: v{updateResult.latestVersion}
                  </a>
                ) : (
                  <span>Up to date (v{updateResult.currentVersion})</span>
                )}
              </div>
            )}

            {updateCheckError && (
              <div className="text-xs text-amber-500" title={updateCheckError}>
                Update check failed
              </div>
            )}

            {/* SSE indicator */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500" title={sseError ?? undefined}>
              {sseError ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  <span className="text-amber-500">{sseIndicatorLabel}</span>
                </>
              ) : (
                <>
                  <span
                    className={`status-dot ${sseConnected ? 'status-dot--idle' : ''}`}
                    style={sseConnected ? undefined : { backgroundColor: '#666' }}
                  />
                  {sseIndicatorLabel}
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main id="main-content" className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
