/**
 * components/Layout.tsx — Main layout with sidebar, header, and content area.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import {
  Activity,
  LayoutDashboard,
  Shield,
  Terminal,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { subscribeGlobalSSE } from '../api/client';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
];

export default function Layout() {
  const sseConnected = useStore((s) => s.sseConnected);
  const setSseConnected = useStore((s) => s.setSseConnected);
  const addActivity = useStore((s) => s.addActivity);
  const token = useStore((s) => s.token);

  // #121: Wire up global SSE connection
  useEffect(() => {
    const unsubscribe = subscribeGlobalSSE((event) => {
      addActivity(event);
    }, token);
    
    // Mark connected; EventSource auto-reconnects on error
    setSseConnected(true);
    
    return () => {
      unsubscribe();
      setSseConnected(false);
    };
  }, [setSseConnected, addActivity, token]);

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-56 flex-col border-r border-void-lighter bg-void-light shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-void-lighter">
          <Shield className="h-6 w-6 text-cyan glow-text-cyan" />
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
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-500">
              <Terminal className="h-4 w-4" />
              Sessions
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-500">
              <Activity className="h-4 w-4" />
              Pipelines
            </div>
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
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`status-dot ${sseConnected ? 'status-dot--idle' : ''}`}
                style={sseConnected ? undefined : { backgroundColor: '#666' }}
              />
              {sseConnected ? 'SSE Live' : 'SSE Off'}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
