/**
 * App.tsx — Root component with React Router.
 */

import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';

const AuthKeysPage = lazy(() => import('./pages/AuthKeysPage'));
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

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
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
      </Routes>
    </ErrorBoundary>
  );
}
