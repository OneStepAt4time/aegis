/**
 * components/overview/SessionTable.tsx — Live session table with polling.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Ban,
  Play,
} from 'lucide-react';
import { getSessions, getSessionHealth, approve, interrupt, killSession } from '../../api/client';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from './StatusDot';
import type { SessionInfo, SessionHealth } from '../../types';

interface RowHealth {
  alive: boolean;
  loading: boolean;
}

export default function SessionTable() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, RowHealth>>({});

  const fetchSessions = useCallback(async () => {
    try {
      const list = await getSessions();
      setSessions(list);

      // Fetch health for each session
      for (const s of list) {
        setHealthMap((prev) => ({ ...prev, [s.id]: { ...prev[s.id], loading: true } }));
        getSessionHealth(s.id)
          .then((h: SessionHealth) => {
            setHealthMap((prev) => ({
              ...prev,
              [s.id]: { alive: h.alive, loading: false },
            }));
          })
          .catch(() => {
            setHealthMap((prev) => ({
              ...prev,
              [s.id]: { alive: false, loading: false },
            }));
          });
      }
    } catch {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5_000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleApprove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    try { await approve(id); } catch { /* ignore */ }
  };

  const handleInterrupt = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    try { await interrupt(id); } catch { /* ignore */ }
  };

  const handleKill = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (!confirm('Kill this session?')) return;
    try { await killSession(id); } catch { /* ignore */ }
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
    <div className="overflow-x-auto rounded-lg border border-void-lighter bg-[#111118]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-void-lighter text-[#666]">
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">WorkDir</th>
            <th className="px-4 py-3 font-medium">Age</th>
            <th className="px-4 py-3 font-medium">Last Activity</th>
            <th className="px-4 py-3 font-medium">Auto-Approve</th>
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

                {/* Auto-Approve */}
                <td className="px-4 py-3">
                  {s.autoApprove ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      On
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-xs text-gray-500">
                      Off
                    </span>
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {needsApproval(s) && (
                      <button
                        onClick={(e) => handleApprove(e, s.id)}
                        className="rounded-md bg-green-900/30 px-2 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/50"
                        title="Approve"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => handleInterrupt(e, s.id)}
                      className="rounded-md bg-yellow-900/30 px-2 py-1 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-900/50"
                      title="Interrupt"
                    >
                      <Ban className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleKill(e, s.id)}
                      className="rounded-md bg-red-900/30 px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50"
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
  );
}
