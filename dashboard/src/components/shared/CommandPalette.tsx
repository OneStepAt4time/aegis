/**
 * components/shared/CommandPalette.tsx
 * Global Cmd+K command palette — search sessions, navigate, run system actions.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  LayoutDashboard,
  History,
  Settings,
  Shield,
  KeyRound,
  ChevronRight,
  Terminal,
  Zap,
  Activity,
} from 'lucide-react';
import { useStore } from '../../store/useStore';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: typeof Search;
  group: 'sessions' | 'navigate' | 'actions';
  action: () => void;
  keywords?: string[];
}

const NAV_COMMANDS = (navigate: ReturnType<typeof useNavigate>): CommandItem[] => [
  { id: 'nav-overview', label: 'Overview', description: 'System health & agent status', icon: LayoutDashboard, group: 'navigate', action: () => navigate('/'), keywords: ['home', 'dashboard'] },
  { id: 'nav-history', label: 'Session History', description: 'Browse all past sessions', icon: History, group: 'navigate', action: () => navigate('/sessions/history'), keywords: ['sessions', 'history', 'past'] },
  { id: 'nav-pipelines', label: 'Pipelines', description: 'Manage automation pipelines', icon: Activity, group: 'navigate', action: () => navigate('/pipelines'), keywords: ['pipeline', 'automation'] },
  { id: 'nav-audit', label: 'Audit Trail', description: 'Security and access logs', icon: Shield, group: 'navigate', action: () => navigate('/audit'), keywords: ['logs', 'security', 'audit'] },
  { id: 'nav-keys', label: 'Auth Keys', description: 'API key management', icon: KeyRound, group: 'navigate', action: () => navigate('/auth/keys'), keywords: ['api', 'token', 'key'] },
  { id: 'nav-settings', label: 'Settings', description: 'Application configuration', icon: Settings, group: 'navigate', action: () => navigate('/settings'), keywords: ['config', 'preferences'] },
];

const SYSTEM_COMMANDS = (navigate: ReturnType<typeof useNavigate>): CommandItem[] => [
  { id: 'action-new-session', label: 'New Session', description: 'Deploy a new agent session', icon: Terminal, group: 'actions', action: () => navigate('/sessions/new'), keywords: ['create', 'start', 'deploy', 'agent'] },
  { id: 'action-audit-errors', label: 'View Error Logs', description: 'See failed sessions & prompts', icon: Zap, group: 'actions', action: () => navigate('/audit'), keywords: ['errors', 'failed', 'logs'] },
];

const GROUP_LABELS: Record<string, string> = {
  sessions: 'Sessions',
  navigate: 'Navigate',
  actions: 'System Actions',
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const sessions = useStore((s) => s.sessions);

  // Reset query when closed
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const sessionCommands: CommandItem[] = useMemo(() =>
    sessions.map((s) => ({
      id: `session-${s.id}`,
      label: s.windowName || s.id.slice(0, 12),
      description: s.workDir ? `📁 ${s.workDir}` : `Status: ${s.status}`,
      icon: Terminal,
      group: 'sessions' as const,
      action: () => navigate(`/sessions/${encodeURIComponent(s.id)}`),
      keywords: [s.id, s.status, s.workDir ?? ''].filter(Boolean),
    })),
    [sessions, navigate]
  );

  const allCommands = useMemo(() => [
    ...sessionCommands,
    ...NAV_COMMANDS(navigate),
    ...SYSTEM_COMMANDS(navigate),
  ], [sessionCommands, navigate]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  }, [query, allCommands]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const item of filtered) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return groups;
  }, [filtered]);

  const handleSelect = (item: CommandItem) => {
    item.action();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed left-1/2 top-[20vh] z-[201] w-full max-w-xl -translate-x-1/2"
          >
            <div className="card-glass overflow-hidden shadow-[0_40px_80px_-15px_rgba(0,0,0,0.9)]">
              {/* Search input */}
              <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3.5">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sessions, navigate, run commands…"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
                />
                <kbd className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-[60vh] overflow-y-auto py-2">
                {Object.keys(grouped).length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    No results for "{query}"
                  </div>
                )}
                {Object.entries(grouped).map(([group, items]) => (
                  <div key={group}>
                    <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                      {GROUP_LABELS[group] ?? group}
                    </div>
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelect(item)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none group"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                            <Icon className="h-3.5 w-3.5 text-slate-400 group-hover:text-white transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 group-hover:text-white truncate">
                              {item.label}
                            </p>
                            {item.description && (
                              <p className="text-xs text-slate-500 truncate mt-0.5">{item.description}</p>
                            )}
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="border-t border-white/5 px-4 py-2 flex items-center gap-4">
                <span className="text-[10px] text-slate-600">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">↑↓</kbd>
                  {' '}navigate
                </span>
                <span className="text-[10px] text-slate-600">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">↵</kbd>
                  {' '}select
                </span>
                <span className="text-[10px] text-slate-600">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">esc</kbd>
                  {' '}close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
