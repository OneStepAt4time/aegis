/**
 * pages/UsersPage.tsx — API key users summary and session ownership overview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, UsersRound, Users } from 'lucide-react';
import EmptyState from '../components/shared/EmptyState';
import { fetchUsers, type UserSummary } from '../api/client';
import { formatTimeAgo } from '../utils/format';

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) return 'never';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
}

function roleClass(role: string): string {
  if (role === 'admin') return 'text-fuchsia-300 bg-fuchsia-400/10 border-fuchsia-400/20';
  if (role === 'operator') return 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20';
  return 'text-zinc-300 bg-zinc-700/30 border-zinc-700';
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100 dark:border-zinc-800">
          <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
        </tr>
      ))}
    </>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setEndpointMissing(false);

    try {
      const response = await fetchUsers(signal);
      setUsers(response.users);
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number };
      if ((err as DOMException).name === 'AbortError') return;
      if (err.statusCode === 404) {
        setEndpointMissing(true);
        setUsers([]);
      } else {
        setError(err.message ?? 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.id.toLowerCase().includes(q)
      || u.name.toLowerCase().includes(q)
      || u.role.toLowerCase().includes(q),
    );
  }, [users, search]);

  const totalActiveSessions = useMemo(() => filtered.reduce((sum, u) => sum + u.activeSessions, 0), [filtered]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h2>
          <p className="mt-1 text-sm text-gray-500">API key ownership, usage, and session activity</p>
        </div>
        <button
          onClick={() => { void load(); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">Visible users</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-zinc-100">{filtered.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">Active sessions</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-600 dark:text-cyan-300">{totalActiveSessions}</p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-500">Query</p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by id, name, role"
            className="mt-2 w-full rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
          />
        </div>
      </div>

      {endpointMissing ? (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-12 text-center">
          <UsersRound className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-zinc-600" />
          <p className="font-medium text-gray-600 dark:text-zinc-400">Users endpoint not available yet</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">The /v1/users endpoint has not been implemented on the server.</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="font-medium text-red-400">Failed to load users</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">User</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">Role</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">Rate</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">Active</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">Created</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-500">Last session</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows count={8} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-0">
                      <EmptyState
                        icon={<Users className="h-8 w-8" />}
                        title="No users match the current filter"
                        description="Try adjusting your search or filter criteria."
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 dark:border-zinc-800 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-mono text-sm text-gray-900 dark:text-zinc-100">{user.id}</span>
                          <span className="text-xs text-gray-500 dark:text-zinc-500">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${roleClass(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-zinc-300">{user.rateLimit}/min</td>
                      <td className="px-4 py-3 text-sm text-cyan-600 dark:text-cyan-300">{user.activeSessions}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-400" title={formatTimestamp(user.createdAt)}>
                        {formatTimeAgo(user.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-400" title={formatTimestamp(user.lastSessionAt)}>
                        {user.lastSessionAt ? formatTimeAgo(user.lastSessionAt) : 'never'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
