/**
 * App.tsx — Root component with React Router.
 */

import { Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import OverviewPage from './pages/OverviewPage';
import SessionDetailPage from './pages/SessionDetailPage';
import PipelinesPage from './pages/PipelinesPage';
import PipelineDetailPage from './pages/PipelineDetailPage';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
