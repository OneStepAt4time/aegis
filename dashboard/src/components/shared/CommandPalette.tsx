/**
 * components/shared/CommandPalette.tsx
 * Global Cmd+K command palette — search sessions, navigate, run system actions.
 * Glamour enhancements (issue 2014): staggered result animations, search highlighting,
 * gradient backdrop, glow border on active.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  LayoutDashboard,
  Settings,
  Shield,
  KeyRound,
  ChevronRight,
  Terminal,
  Zap,
  Activity,
  DollarSign,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useDrawerStore } from '../../store/useDrawerStore';
import { useViewTransitionNavigate } from '../../hooks/useViewTransitionNavigate';
import { tokens } from '../../design/tokens';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: typeof Search;
  group: 'sessions' | 'navigate' | 'actions';
  action: () => void;
  keywords?: string[];
}

const staggerMs = tokens.glamour.paletteStaggerMs;

const NAV_COMMANDS = (navigate: ReturnType<typeof useViewTransitionNavigate>): CommandItem[] => [
  { id: 'nav-overview', label: 'Overview', description: 'System health & agent status', icon: LayoutDashboard, group: 'navigate', action: () => navigate('/'), keywords: ['home', 'dashboard'] },
  { id: 'nav-sessions', label: 'Sessions', description: 'Active and historical sessions', icon: Terminal, group: 'navigate', action: () => navigate('/sessions'), keywords: ['sessions', 'active', 'history', 'past'] },
  { id: 'nav-sessions-all', label: 'All Sessions', description: 'Browse session history', icon: Terminal, group: 'navigate', action: () => navigate('/sessions?tab=all'), keywords: ['sessions', 'history', 'all', 'past'] },
  { id: 'nav-pipelines', label: 'Pipelines', description: 'Manage automation pipelines', icon: Activity, group: 'navigate', action: () => navigate('/pipelines'), keywords: ['pipeline', 'automation'] },
  { id: 'nav-activity', label: 'Live activity', description: 'Real-time audit stream and metrics', icon: Activity, group: 'navigate', action: () => navigate('/activity'), keywords: ['live', 'audit', 'stream', 'metrics', 'operational'] },
  { id: 'nav-audit', label: 'Audit', description: 'Security and access logs', icon: Shield, group: 'navigate', action: () => navigate('/audit'), keywords: ['logs', 'security', 'audit', 'trail'] },
  { id: 'nav-cost', label: 'Cost & Billing', description: 'Usage, burn rate & budgets', icon: DollarSign, group: 'navigate', action: () => navigate('/cost'), keywords: ['cost', 'billing', 'budget', 'spend', 'usage'] },
  { id: 'nav-keys', label: 'Auth Keys', description: 'API key management', icon: KeyRound, group: 'navigate', action: () => navigate('/auth/keys'), keywords: ['api', 'token', 'key'] },
  { id: 'nav-settings', label: 'Settings', description: 'Application configuration', icon: Settings, group: 'navigate', action: () => navigate('/settings'), keywords: ['config', 'preferences'] },
];

const SYSTEM_COMMANDS = (navigate: ReturnType<typeof useViewTransitionNavigate>, openNewSession: () => void): CommandItem[] => [
  { id: 'action-new-session', label: 'New Session', description: 'Deploy a new agent session', icon: Terminal, group: 'actions', action: openNewSession, keywords: ['create', 'start', 'deploy', 'agent'] },
  { id: 'action-audit-errors', label: 'View Error Logs', description: 'See failed sessions & prompts', icon: Zap, group: 'actions', action: () => navigate('/audit'), keywords: ['errors', 'failed', 'logs'] },
];

const GROUP_LABELS: Record<string, string> = {
  sessions: 'Sessions',
  navigate: 'Navigate',
  actions: 'System Actions',
};

/** Highlight matching text in a string. */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[var(--color-accent-cyan)] font-semibold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(open);
  const navigate = useViewTransitionNavigate();
  const sessions = useStore((s) => s.sessions);
  const openNewSession = useDrawerStore((s) => s.openNewSession);

  // Reset query and active index when closed
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
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
    ...SYSTEM_COMMANDS(navigate, openNewSession),
  ], [sessionCommands, navigate, openNewSession]);

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

  const handleSelect = useCallback((item: CommandItem) => {
    item.action();
    onClose();
  }, [onClose]);

  const flatFiltered = filtered;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const item = flatFiltered[activeIndex];
      if (item) handleSelect(item);
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Compute a flat index for stagger delay
  let runningIndex = 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop with gradient glow */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] md:bg-black/60 md:backdrop-blur-sm bg-[var(--color-void)]"
            style={{ backgroundImage: 'var(--palette-backdrop)' }}
            onClick={onClose}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            ref={trapRef as React.Ref<HTMLDivElement>}
            className="fixed left-1/2 top-[20vh] z-[201] w-full max-w-xl -translate-x-1/2"
          >
            <div className="card-glass overflow-hidden shadow-palette">
              {/* Search input */}
              <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3.5">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-autocomplete="list"
                  aria-controls="command-palette-listbox"
                  aria-activedescendant={flatFiltered[activeIndex] ? `cmd-item-${flatFiltered[activeIndex].id}` : undefined}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search sessions, navigate, run commands…"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
                />
                <kbd className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  ESC
                </kbd>
              </div>

              {/* Results with staggered entry */}
              <div
                id="command-palette-listbox"
                role="listbox"
                ref={listRef}
                className="max-h-[60vh] overflow-y-auto py-2"
              >
                {Object.keys(grouped).length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    No results for &ldquo;{query}&rdquo;
                  </div>
                )}
                {Object.entries(grouped).map(([group, items]) => {
                  const groupStartIndex = runningIndex;
                  return (
                    <div key={group}>
                      <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        {GROUP_LABELS[group] ?? group}
                      </div>
                      {items.map((item, localIdx) => {
                        const globalIdx = groupStartIndex + localIdx;
                        runningIndex = groupStartIndex + localIdx + 1;
                        const isActive = activeIndex === globalIdx;
                        const Icon = item.icon;
                        return (
                          <motion.button
                            key={item.id}
                            id={`cmd-item-${item.id}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onClick={() => handleSelect(item)}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15, delay: globalIdx * staggerMs / 1000 }}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 group ${
                              isActive
                                ? 'bg-white/5 glow-ring-active'
                                : ''
                            }`}
                          >
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-white/10 glow-icon-active' : 'bg-white/5 group-hover:bg-white/10'}`}>
                              <Icon className={`h-3.5 w-3.5 transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate transition-colors ${isActive ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                                <HighlightMatch text={item.label} query={query} />
                              </p>
                              {item.description && (
                                <p className="text-xs text-slate-500 truncate mt-0.5">
                                  <HighlightMatch text={item.description} query={query} />
                                </p>
                              )}
                            </div>
                            <ChevronRight className={`h-3.5 w-3.5 text-slate-600 shrink-0 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                          </motion.button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Footer hint */}
              <div className="border-t border-white/5 px-4 py-2 flex items-center gap-4">
                <span className="text-[10px] text-slate-600">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">&uarr;&darr;</kbd>
                  {' '}navigate
                </span>
                <span className="text-[10px] text-slate-600">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">&crarr;</kbd>
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
