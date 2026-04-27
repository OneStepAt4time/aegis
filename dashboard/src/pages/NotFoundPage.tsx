/**
 * NotFoundPage.tsx — 404 catch-all route (#646).
 *
 * Rendered when the user navigates to an undefined dashboard path.
 */

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="alert">
      <h1 className="text-6xl font-bold text-gray-500">404</h1>
      <p className="text-lg text-gray-400">Page not found</p>
      <Link
        to="/"
        className="mt-2 rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-void transition-colors hover:bg-cyan/80"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
