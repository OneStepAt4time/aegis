/**
 * components/overview/SessionTable.tsx — Live session table with fallback polling.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, Play, XCircle } from 'lucide-react';
import { approve, getAllSessionsHealth, getSessions, interrupt, killSession } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useStore } from '../../store/useStore';
import type { RowHealth, SessionInfo } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from './StatusDot';

interface SessionRowProps {
  session: SessionInfo;
  isAlive: boolean;
  currentAction: string | null;
  onApprove: (e: React.MouseEvent, id: string) => void;
  onInterrupt: (e: React.MouseEvent, id: string) => void;
  onKill: (e: React.MouseEvent, id: string) => void;
}

const needsApproval = (session: SessionInfo): boolean =>
  session.status === 'permission_prompt' || session.status === 'bash_approval';

const truncateDir = (dir: string, max = 40): string =>
  dir.length > max ? `…${dir.slice(dir.length - max + 1)}` : dir;

const isDisplayedSessionEqual = (a: SessionInfo, b: SessionInfo): boolean => {
  return a.id === b.id
    && a.windowName === b.windowName
    && a.workDir === b.workDir
    && a.status === b.status
    && a.createdAt === b.createdAt
    && a.lastActivity === b.lastActivity
    && a.permissionMode === b.permissionMode;
};

const areSessionRowPropsEqual = (prev: SessionRowProps, next: SessionRowProps): boolean => {
  return isDisplayedSessionEqual(prev.session, next.session)
    && prev.isAlive === next.isAlive
    && prev.currentAction === next.currentAction;
};

const SessionMobileCard = memo(function SessionMobileCard({
  session,
  isAlive,
  currentAction,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <Link
      to={`/sessions/${encodeURIComponent(session.id)}`}
      className="block rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 active:bg-[#1a1a2e]/50 transition-colors"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={session.status} />
          <span className="truncate font-medium text-gray-200">
            {session.windowName || session.id}
          </span>
          {!isAlive && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {needsApproval(session) && (
            <button
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 p-2 text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 p-2 text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-red-900/30 p-2 text-red-400 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Kill"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mb-1.5 truncate font-mono text-xs text-gray-500">
        {truncateDir(session.workDir, 50)}
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Age: {formatTimeAgo(session.createdAt)}</span>
        <span>Active: {formatTimeAgo(session.lastActivity)}</span>
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-green-400">
            <CheckCircle2 className="h-3 w-3" /> {session.permissionMode}
          </span>
        ) : null}
      </div>
    </Link>
  );
}, areSessionRowPropsEqual);

const SessionDesktopRow = memo(function SessionDesktopRow({
  session,
  isAlive,
  currentAction,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <tr className="border-b border-void-lighter/50 transition-colors hover:border-l-2 hover:border-l-cyan">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          {!isAlive && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
      </td>

      <td className="px-4 py-3">
        <Link
          to={`/sessions/${encodeURIComponent(session.id)}`}
          className="font-medium text-gray-200 transition-colors hover:text-cyan"
        >
          {session.windowName || session.id}
        </Link>
      </td>

      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-400" title={session.workDir}>
        {truncateDir(session.workDir)}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-gray-400">
        {formatTimeAgo(session.createdAt)}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-gray-400">
        {formatTimeAgo(session.lastActivity)}
      </td>

      <td className="px-4 py-3">
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-xs text-gray-500">
            default
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {needsApproval(session) && (
            <button
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-red-900/30 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Kill"
          >
            <XCircle className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}, areSessionRowPropsEqual);

export default function SessionTable() {
  const sessions = useStore((s) => s.sessions);
  const healthMap = useStore((s) => s.healthMap);
  const sseConnected = useStore((s) => s.sseConnected);
  const setSessionsAndHealth = useStore((s) => s.setSessionsAndHealth);
  const addToast = useToastStore((t) => t.addToast);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});

  const withLoading = useCallback(async (id: string, action: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [id]: action }));
    try {
      await fn();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }));
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const list = await getSessions();

      // Fetch health in parallel; if it fails, render sessions without health data.
      let nextHealthMap: Record<string, RowHealth> = {};
      try {
        const healthResults = await getAllSessionsHealth();
        const liveIds = new Set(list.sessions.map((s) => s.id));
        for (const [id, health] of Object.entries(healthResults)) {
          if (liveIds.has(id)) {
            nextHealthMap[id] = { alive: health.alive, loading: false };
          }
        }
      } catch {
        // Health fetch failed — show sessions without health indicators.
      }

      setSessionsAndHealth(list.sessions, nextHealthMap);
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch sessions', e instanceof Error ? e.message : undefined);
    }
  }, [addToast, setSessionsAndHealth]);

  useEffect(() => {
    fetchSessions();

    if (sseConnected) {
      return;
    }

    const interval = setInterval(fetchSessions, 5_000);
    return () => clearInterval(interval);
  }, [fetchSessions, sseConnected]);

  const handleApprove = useCallback(async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    await withLoading(id, 'approve', async () => {
      try {
        await approve(id);
      } catch (err: unknown) {
        addToast('error', 'Approve failed', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, withLoading]);

  const handleInterrupt = useCallback(async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    await withLoading(id, 'interrupt', async () => {
      try {
        await interrupt(id);
      } catch (err: unknown) {
        addToast('error', 'Interrupt failed', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, withLoading]);

  const handleKill = useCallback(async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (!confirm('Kill this session?')) {
      return;
    }

    await withLoading(id, 'kill', async () => {
      try {
        await killSession(id);
      } catch (err: unknown) {
        addToast('error', 'Failed to kill session', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, withLoading]);

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
        <p className="text-gray-500">No active sessions</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {sessions.map((session) => {
          const health = healthMap[session.id];
          const isAlive = health ? health.alive : true;

          return (
            <SessionMobileCard
              key={session.id}
              session={session}
              isAlive={isAlive}
              currentAction={actionLoading[session.id] ?? null}
              onApprove={handleApprove}
              onInterrupt={handleInterrupt}
              onKill={handleKill}
            />
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-void-lighter bg-[#111118] md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-void-lighter text-[#666]">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">WorkDir</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Last Activity</th>
              <th className="px-4 py-3 font-medium">Permission</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const health = healthMap[session.id];
              const isAlive = health ? health.alive : true;

              return (
                <SessionDesktopRow
                  key={session.id}
                  session={session}
                  isAlive={isAlive}
                  currentAction={actionLoading[session.id] ?? null}
                  onApprove={handleApprove}
                  onInterrupt={handleInterrupt}
                  onKill={handleKill}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
