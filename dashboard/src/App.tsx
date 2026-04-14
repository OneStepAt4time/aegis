/**
 * App.tsx — Root component with React Router.
 */

import { Suspense, lazy, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const AuditPage = lazy(() => import('./pages/AuditPage'));
const AuthKeysPage = lazy(() => import('./pages/AuthKeysPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const SessionHistoryPage = lazy(() => import('./pages/SessionHistoryPage'));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage'));
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'));
const PipelineDetailPage = lazy(() => import('./pages/PipelineDetailPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
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
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <UsersPage />
                </Suspense>
              }
            />
            <Route
              path="/sessions/history"
              element={
                <Suspense fallback={<LoadingFallback />}>
                  <SessionHistoryPage />
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
