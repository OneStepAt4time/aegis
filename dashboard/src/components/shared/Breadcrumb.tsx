/**
 * components/shared/Breadcrumb.tsx — Navigation breadcrumb trail.
 */

import { Link, useLocation, useParams } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface Crumb {
  label: string;
  path?: string;
}

const ROUTE_LABELS: Record<string, string> = {
  '': 'Overview',
  sessions: 'Sessions',
  history: 'History',
  pipelines: 'Pipelines',
  audit: 'Audit',
  users: 'Users',
  auth: 'Auth',
  keys: 'Keys',
};

function buildCrumbs(pathname: string, _params: Record<string, string | undefined>): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Home', path: '/' }];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    currentPath += `/${seg}`;

    // Check if this is a dynamic param (UUID or short ID)
    const isParam = seg.length > 8 && /^[a-f0-9-]+$/.test(seg);

    if (isParam) {
      // Truncate long IDs
      crumbs.push({
        label: seg.slice(0, 8) + '…',
        // Last segment has no link
        path: i < segments.length - 1 ? currentPath : undefined,
      });
    } else {
      const label = ROUTE_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1);
      crumbs.push({
        label,
        path: i < segments.length - 1 ? currentPath : undefined,
      });
    }
  }

  return crumbs;
}

export default function Breadcrumb() {
  const location = useLocation();
  const params = useParams();

  // Don't show breadcrumb on home page
  if (location.pathname === '/' || location.pathname === '') return null;

  const crumbs = buildCrumbs(location.pathname, params);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-zinc-500">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
          {i === 0 && <Home className="h-3.5 w-3.5 text-zinc-500" />}
          {crumb.path ? (
            <Link
              to={crumb.path}
              className="text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-zinc-300 font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
