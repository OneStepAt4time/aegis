/**
 * components/overview/SessionTable.tsx — Live session table with polling.
 */

import { useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Ban,
  Play,
} from 'lucide-react';
import { getSessions, getAllSessionsHealth, approve, interrupt, killSession } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from './StatusDot';
import type { SessionInfo, RowHealth } from '../../types';

export default function SessionTable() {
  const sessions = useStore((s) => s.sessions);
  const healthMap = useStore((s) => s.healthMap);
  const setSessionsAndHealth = useStore((s) => s.setSessionsAndHealth);
  const addToast = useToastStore((t) => t.addToast);

  const fetchSessions = useCallback(async () => {
    try {
      const list = await getSessions();

      // Fetch health in parallel; if it fails, render sessions without health data
      let healthMap: Record<string, RowHealth> = {};
      try {
        const healthResults = await getAllSessionsHealth();
        const liveIds = new Set(list.sessions.map((s) => s.id));
        for (const [id, health] of Object.entries(healthResults)) {
          if (liveIds.has(id)) {
            healthMap[id] = { alive: health.alive, loading: false };
          }
        }
      } catch {
        // Health fetch failed — show sessions without health indicators
      }

      setSessionsAndHealth(list.sessions, healthMap);
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch sessions', e instanceof Error ? e.message : undefined);
    }
  }, [addToast, setSessionsAndHealth]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5_000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleApprove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    try { await approve(id); } catch (err: unknown) {
      addToast('error', 'Approve failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleInterrupt = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    try { await interrupt(id); } catch (err: unknown) {
      addToast('error', 'Interrupt failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleKill = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (!confirm('Kill this session?')) return;
    try { await killSession(id); } catch (err: unknown) {
      addToast('error', 'Failed to kill session', err instanceof Error ? err.message : undefined);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
        <p className="text-gray-500">No active sessions</p>
      </div>
    );
  }

  const needsApproval = (s: SessionInfo) =>
    s.status === 'permission_prompt' || s.status === 'bash_approval';

  const truncateDir = (dir: string, max = 40) =>
    dir.length > max ? `…${dir.slice(dir.length - max + 1)}` : dir;

  return (
    <>
      {/* Mobile card view (< md) */}
      <div className="md:hidden space-y-3">
        {sessions.map((s) => {
          const health = healthMap[s.id];
          const isAlive = health ? health.alive : true;
          return (
            <Link
              key={s.id}
              to={`/sessions/${encodeURIComponent(s.id)}`}
              className="block rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 active:bg-[#1a1a2e]/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={s.status} />
                  <span className="font-medium text-gray-200 truncate">
                    {s.windowName || s.id}
                  </span>
                  {!isAlive && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {needsApproval(s) && (
                    <button
                      onClick={(e) => handleApprove(e, s.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-green-900/30 p-2 text-green-400 transition-colors hover:bg-green-900/50"
                      title="Approve"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => handleInterrupt(e, s.id)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-yellow-900/30 p-2 text-yellow-400 transition-colors hover:bg-yellow-900/50"
                    title="Interrupt"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => handleKill(e, s.id)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-red-900/30 p-2 text-red-400 transition-colors hover:bg-red-900/50"
                    title="Kill"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="font-mono text-xs text-gray-500 truncate mb-1.5">
                {truncateDir(s.workDir, 50)}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>Age: {formatTimeAgo(s.createdAt)}</span>
                <span>Active: {formatTimeAgo(s.lastActivity)}</span>
                {s.permissionMode && s.permissionMode !== 'default' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-green-400">
                    <CheckCircle2 className="h-3 w-3" /> {s.permissionMode}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Desktop table view (md+) */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-void-lighter bg-[#111118]">
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
            {sessions.map((s) => {
              const health = healthMap[s.id];
              const isAlive = health ? health.alive : true; // Assume alive while loading
              return (
                <tr
                  key={s.id}
                  className="border-b border-void-lighter/50 transition-colors hover:border-l-2 hover:border-l-cyan"
                >
                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={s.status} />
                      {!isAlive && (
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </div>
                  </td>

                  {/* Name */}
                  <td className="px-4 py-3">
                    <Link
                      to={`/sessions/${encodeURIComponent(s.id)}`}
                      className="font-medium text-gray-200 hover:text-cyan transition-colors"
                    >
                      {s.windowName || s.id}
                    </Link>
                  </td>

                  {/* WorkDir */}
                  <td className="px-4 py-3 max-w-[200px] truncate font-mono text-xs text-gray-400" title={s.workDir}>
                    {truncateDir(s.workDir)}
                  </td>

                  {/* Age */}
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                    {formatTimeAgo(s.createdAt)}
                  </td>

                  {/* Last Activity */}
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                    {formatTimeAgo(s.lastActivity)}
                  </td>

                  {/* Permission Mode */}
                  <td className="px-4 py-3">
                    {s.permissionMode && s.permissionMode !== 'default' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {s.permissionMode}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-xs text-gray-500">
                        default
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {needsApproval(s) && (
                        <button
                          onClick={(e) => handleApprove(e, s.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-green-900/30 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/50"
                          title="Approve"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleInterrupt(e, s.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-yellow-900/30 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-900/50"
                        title="Interrupt"
                      >
                        <Ban className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => handleKill(e, s.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-red-900/30 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50"
                        title="Kill"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
