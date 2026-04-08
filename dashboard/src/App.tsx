/**
 * App.tsx — Root component with React Router.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Outlet, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import { useAuthStore } from './store/useAuthStore.js';

const AuthKeysPage = lazy(() => import('./pages/AuthKeysPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage'));
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'));
const PipelineDetailPage = lazy(() => import('./pages/PipelineDetailPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

function ProtectedRoute(): React.JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isVerifying = useAuthStore((s) => s.isVerifying);

  if (isVerifying) {
    return <LoadingFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    init().then(() => setInitialized(true));
  }, [init]);

  if (!initialized) {
    return <LoadingFallback />;
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={
          isAuthenticated
            ? <Navigate to="/" replace />
            : <Suspense fallback={<LoadingFallback />}><LoginPage /></Suspense>
        } />
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
    </ErrorBoundary>
  );
}
