/**
 * App.tsx — Root component with React Router.
 */

import { Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import AuthKeysPage from './pages/AuthKeysPage';
import OverviewPage from './pages/OverviewPage';
import SessionDetailPage from './pages/SessionDetailPage';
import PipelinesPage from './pages/PipelinesPage';
import PipelineDetailPage from './pages/PipelineDetailPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/auth/keys" element={<AuthKeysPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
