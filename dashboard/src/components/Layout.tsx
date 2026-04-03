/**
 * components/Layout.tsx — Main layout with sidebar, header, and content area.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  KeyRound,
  LayoutDashboard,
  Shield,
  Terminal,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { subscribeGlobalSSE } from '../api/client';
import ToastContainer from './ToastContainer';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/pipelines', label: 'Pipelines', icon: Activity },
  { to: '/auth/keys', label: 'Auth Keys', icon: KeyRound },
];

const MAX_SSE_RETRIES = 5;
const SSE_RETRY_BASE_MS = 1000;

export default function Layout() {
  const sseConnected = useStore((s) => s.sseConnected);
  const setSseConnected = useStore((s) => s.setSseConnected);
  const sseError = useStore((s) => s.sseError);
  const setSseError = useStore((s) => s.setSseError);
  const addActivity = useStore((s) => s.addActivity);
  const token = useStore((s) => s.token);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sseRetryCount, setSseRetryCount] = useState(0);

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
            if (disconnectTimerRef.current) {
              clearTimeout(disconnectTimerRef.current);
              disconnectTimerRef.current = null;
            }
            setSseConnected(true);
            setSseError(null);
            setSseRetryCount(0);
          },
          onClose: () => {
            disconnectTimerRef.current = setTimeout(() => {
              setSseConnected(false);
            }, 2000);
          },
          onGiveUp: () => {
            setSseError('SSE connection failed — real-time updates unavailable');
            setSseConnected(false);
          },
        });
      } catch (err) {
        console.error('Failed to subscribe to global SSE (attempt %d):', attempt + 1, err);

        if (attempt < MAX_SSE_RETRIES) {
          const delay = SSE_RETRY_BASE_MS * Math.pow(2, attempt);
          setSseRetryCount(attempt + 1);
          retryTimer = setTimeout(() => attemptConnect(attempt + 1), delay);
        } else {
          setSseError('SSE subscription failed after retries — real-time updates unavailable');
          setSseConnected(false);
        }
      }
    }

    attemptConnect(0);

    return () => {
      cancelled = true;
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribe?.();
    };
  }, [setSseConnected, setSseError, addActivity, token]);

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-56 flex-col border-r border-void-lighter bg-void-light shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-void-lighter">
          <Shield className="h-6 w-6 text-blue-500" />
          <span className="text-lg font-semibold tracking-tight text-gray-100">
            Aegis
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-1 px-2 py-4 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan/10 text-cyan'
                    : 'text-gray-400 hover:bg-void-lighter hover:text-gray-200'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}

          {/* Placeholder nav items */}
          <div className="mt-4 border-t border-void-lighter pt-4 opacity-40">
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Sessions navigation is not available yet"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-gray-500"
            >
              <Terminal className="h-4 w-4" />
              Sessions
            </button>
          </div>
        </nav>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-void-lighter bg-void-light px-6 py-3 shrink-0">
          <h1 className="text-sm font-medium text-gray-300">
            Aegis Dashboard
          </h1>
          <div className="flex items-center gap-3">
            {/* SSE indicator */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500" title={sseError ?? undefined}>
              {sseError ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  <span className="text-amber-500">
                    SSE Error{sseRetryCount > 0 ? ` (retry ${sseRetryCount})` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span
                    className={`status-dot ${sseConnected ? 'status-dot--idle' : ''}`}
                    style={sseConnected ? undefined : { backgroundColor: '#666' }}
                  />
                  {sseConnected ? 'SSE Live' : 'SSE Off'}
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
