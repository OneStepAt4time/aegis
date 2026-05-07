/**
 * components/overview/SessionMobileCard.tsx — Compact card for mobile session list.
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Cpu, User } from 'lucide-react';
import StatusDot from './StatusDot';
import type { SessionInfo } from '../../types';
import { formatTimeAgo } from '../../utils/format';

interface SessionMobileCardProps {
  session: SessionInfo;
  onInterrupt: (id: string) => void;
}

export const SessionMobileCard = memo(function SessionMobileCard({
  session,
  onInterrupt,
}: SessionMobileCardProps) {
  const status = session.status ?? 'unknown';
  const truncatedName = session.displayName
    ? session.displayName.length > 30
      ? session.displayName.slice(0, 30) + '…'
      : session.displayName
    : session.id.slice(0, 8);

  return (
    <Link
      to={`/sessions/${session.id}`}
      className="block rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] p-3 transition-colors hover:border-[var(--color-void-lighter)] active:bg-[var(--color-void-light)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={status} />
          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            {truncatedName}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onInterrupt(session.id);
          }}
          className="shrink-0 rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-void-light)] hover:text-[var(--color-text-primary)]"
          title="Interrupt"
        >
          <Cpu className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {session.createdAt ? formatTimeAgo(session.createdAt) : '—'}
        </span>
        {session.ownerKeyId && (
          <span className="flex items-center gap-1 truncate">
            <User className="h-3 w-3" />
            {session.ownerKeyId.slice(0, 8)}
          </span>
        )}
      </div>
    </Link>
  );
});
