/**
 * App.tsx — Root component with React Router.
 */

import { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDrawerStore } from './store/useDrawerStore';

const AuditPage = lazy(() => import('./pages/AuditPage'));
const AuthKeysPage = lazy(() => import('./pages/AuthKeysPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const SessionsPage = lazy(() => import('./pages/SessionsPage'));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage'));
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'));
const PipelineDetailPage = lazy(() => import('./pages/PipelineDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

/**
 * NewSessionRedirect — Opens the new session drawer and redirects back
 */
function NewSessionRedirect() {
  const navigate = useNavigate();
  const openNewSession = useDrawerStore((s) => s.openNewSession);

  useEffect(() => {
    openNewSession();
    // Redirect back to /sessions (or previous location if available)
    navigate('/sessions', { replace: true });
  }, [openNewSession, navigate]);

  return <LoadingFallback />;
}

export default function App() {
  const [showHelp, setShowHelp] = useState(false);

  useKeyboardShortcuts({
    onShortcut: (shortcut) => {
      if (shortcut.key === '?' || (shortcut.key === 'k' && shortcut.modifier === 'ctrl')) {
        setShowHelp((prev) => !prev);
      }
    },
  });

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <LoginPage />
            </Suspense>
          }
        />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route
              path="/"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <OverviewPage />
                </Suspense>
              }
            />
            <Route
              path="/auth/keys"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <AuthKeysPage />
                </Suspense>
              }
            />
            <Route
              path="/users"
              element={<Navigate to="/auth/keys" replace state={{ usersRedirect: true }} />}
            />
            {/* New Session route opens drawer and redirects to current page */}
            <Route path="/sessions/new" element={<NewSessionRedirect />} />
            {/* Redirect legacy /sessions/history → /sessions?tab=all */}
            <Route
              path="/sessions/history"
              element={<Navigate to="/sessions?tab=all" replace />}
            />
            <Route
              path="/sessions"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <SessionsPage />
                </Suspense>
              }
            />
            <Route
              path="/sessions/:id"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <SessionDetailPage />
                </Suspense>
              }
            />
            <Route
              path="/pipelines"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <PipelinesPage />
                </Suspense>
              }
            />
            <Route
              path="/pipelines/:id"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <PipelineDetailPage />
                </Suspense>
              }
            />
            <Route
              path="/audit"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <AuditPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<Suspense fallback={<LoadingFallback />}><SettingsPage /></Suspense>} />

            <Route
              path="*"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <NotFoundPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Routes>

      <KeyboardShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </ErrorBoundary>
  );
}
