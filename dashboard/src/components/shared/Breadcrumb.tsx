/**
 * components/shared/Breadcrumb.tsx — Navigation breadcrumb trail.
 */

import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface Crumb {
  label: string;
  path?: string;
}

const ROUTE_LABELS: Record<string, string> = {
  '': 'Overview',
  sessions: 'Sessions',
  pipelines: 'Pipelines',
  audit: 'Audit',
  users: 'Users',
  auth: 'Auth',
  keys: 'Keys',
};

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Home', path: '/' }];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    currentPath += `/${seg}`;

    const isParam = seg.length > 8 && /^[a-f0-9-]+$/.test(seg);

    if (isParam) {
      crumbs.push({
        label: seg.slice(0, 8) + '…',
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

  if (location.pathname === '/' || location.pathname === '') return null;

  const crumbs = buildCrumbs(location.pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden text-sm text-zinc-500">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
          {i === 0 && <Home className="h-3.5 w-3.5 text-zinc-500" />}
          {crumb.path ? (
            <Link
              to={crumb.path}
              className="truncate text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-zinc-300">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
