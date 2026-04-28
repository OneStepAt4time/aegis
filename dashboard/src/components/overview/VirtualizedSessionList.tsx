/**
 * components/overview/VirtualizedSessionList.tsx
 * Virtualized session table using react-window List.
 * Renders only visible rows for performant display of large session lists.
 */

import { type CSSProperties, type ReactElement, useMemo } from 'react';
import { List } from 'react-window';
import { Link } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Play,
  XCircle,
} from 'lucide-react';
import type { SessionHealthState, SessionInfo } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from './StatusDot';

// ── Exported Types ──────────────────────────────────────────

export interface VirtualizedRowData {
  session: SessionInfo;
  isAlive: boolean;
  health: SessionHealthState | null;
  selected: boolean;
  currentAction: string | null;
  estimatedCostUsd?: number;
  isFocused: boolean;
}

// ── Internal Types ──────────────────────────────────────────

type FlatItem =
  | { type: 'group'; dirKey: string; count: number; isCollapsed: boolean }
  | { type: 'session'; data: VirtualizedRowData };

export interface VirtualizedSessionListProps {
  rowViewModels: VirtualizedRowData[];
  groupedRowModels: Map<string, VirtualizedRowData[]> | null;
  collapsedGroups: Set<string>;
  allVisibleSelected: boolean;
  maxVisibleRows?: number;
  showHeader?: boolean;
  onToggleGroup: (key: string) => void;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onApprove: (e: React.MouseEvent, id: string) => void;
  onInterrupt: (e: React.MouseEvent, id: string) => void;
  onKill: (e: React.MouseEvent, id: string) => void;
}

// ── Constants ───────────────────────────────────────────────

const ROW_HEIGHT = 52;
const GROUP_ROW_HEIGHT = 40;
const DEFAULT_MAX_VISIBLE_ROWS = 12;
const OVERSCAN_COUNT = 5;

const GRID_COLUMNS = '36px 44px 90px 1fr 160px 100px 110px 100px 70px 90px';

// ── Helpers ─────────────────────────────────────────────────

function truncateDir(workDir: string, max = 24): string {
  const dir = workDir.replace(/^\/home\//, '~/');
  return dir.length > max ? `…${dir.slice(dir.length - max + 1)}` : dir;
}

// ── Row Extra Props (what we pass via rowProps) ─────────────

interface SessionRowExtraProps {
  items: FlatItem[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onApprove: (e: React.MouseEvent, id: string) => void;
  onInterrupt: (e: React.MouseEvent, id: string) => void;
  onKill: (e: React.MouseEvent, id: string) => void;
  onToggleGroup: (key: string) => void;
}

// ── Virtualized Row Component ───────────────────────────────

function VirtualizedRow(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
} & SessionRowExtraProps): ReactElement {
  const { index, style, items, onToggleSelect, onInterrupt, onKill, onToggleGroup } = props;
  const item = items[index];

  if (item.type === 'group') {
    const { dirKey, count, isCollapsed } = item;
    return (
      <div
        style={style}
        className="flex items-center gap-2 px-4 border-b border-white/5 bg-white/[0.02] text-sm text-gray-400 cursor-pointer hover:bg-white/5"
        onClick={() => onToggleGroup(dirKey)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleGroup(dirKey); }}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${dirKey} group, ${count} sessions`}
      >
        {isCollapsed
          ? <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
          : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
        <FolderOpen className="h-3.5 w-3.5 text-gray-500" />
        <span className="font-mono text-xs">{dirKey}</span>
        <span className="text-gray-600">({count})</span>
      </div>
    );
  }

  const { data } = item;
  const { session, isAlive, health, selected, currentAction, estimatedCostUsd, isFocused } = data;

  return (
    <div
      style={style}
      className={`grid border-b border-white/5 transition-all duration-[300ms] ease-out ${
        isFocused
          ? 'bg-cyan-950/30 ring-1 ring-inset ring-[var(--color-accent-cyan)]/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
          : 'hover:bg-white/5 hover:scale-[1.002] cursor-pointer'
      }`}
      data-session-id={session.id}
    >
      <div className="flex items-center px-3">
        <input
          type="checkbox"
          aria-label={`Select session ${session.windowName || session.id}`}
          checked={selected}
          onChange={(e) => onToggleSelect(session.id, e.target.checked)}
          className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
        />
      </div>
      <div className="flex items-center px-2">
        <StatusDot status={session.status} health={health} />
        {!isAlive && <XCircle className="h-3.5 w-3.5 text-red-400" />}
      </div>
      <div className="hidden md:flex items-center whitespace-nowrap px-3 font-mono text-xs text-zinc-400">
        {session.ownerKeyId
          ? `${session.ownerKeyId.slice(0, 8)}${session.ownerKeyId.length > 8 ? '…' : ''}`
          : '—'}
      </div>
      <div className="flex items-center px-3">
        <Link
          to={`/sessions/${encodeURIComponent(session.id)}`}
          className="font-medium text-gray-200 transition-colors hover:text-cyan"
        >
          {session.windowName || session.id}
        </Link>
      </div>
      <div className="hidden lg:flex items-center max-w-[200px] truncate px-3 font-mono text-xs text-gray-400" title={session.workDir}>
        {truncateDir(session.workDir)}
      </div>
      <div className="flex items-center whitespace-nowrap px-3 text-gray-400 text-sm">
        {formatTimeAgo(session.createdAt)}
      </div>
      <div className="flex items-center whitespace-nowrap px-3 text-gray-400 text-sm">
        {formatTimeAgo(session.lastActivity)}
      </div>
      <div className="flex items-center px-3">
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-void-lighter px-2 py-0.5 text-xs text-gray-500">
            default
          </span>
        )}
      </div>
      <div className="flex items-center px-3 text-xs text-gray-500">
        {estimatedCostUsd != null ? `$${estimatedCostUsd.toFixed(2)}` : '—'}
      </div>
      <div className="flex items-center gap-1 px-3">
        {currentAction === 'working' && (
          <span className="inline-flex items-center gap-1 rounded bg-cyan-900/30 px-1.5 py-0.5 text-xs text-cyan-400">
            <Play className="h-2.5 w-2.5" />
            running
          </span>
        )}
        <button
          type="button"
          onClick={(e) => onInterrupt(e, session.id)}
          aria-label={`Interrupt session ${session.windowName || session.id}`}
          className="p-1 rounded text-gray-500 hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors"
          title="Interrupt"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => onKill(e, session.id)}
          aria-label={`Kill session ${session.windowName || session.id}`}
          className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Kill"
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export function VirtualizedSessionList({
  rowViewModels,
  groupedRowModels,
  collapsedGroups,
  allVisibleSelected,
  maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS,
  showHeader = true,
  onToggleGroup,
  onToggleSelect,
  onToggleSelectAll,
  onApprove,
  onInterrupt,
  onKill,
}: VirtualizedSessionListProps) {
  const items: FlatItem[] = useMemo(() => {
    if (!groupedRowModels || groupedRowModels.size === 0) {
      return rowViewModels.map((data) => ({ type: 'session' as const, data }));
    }
    const flat: FlatItem[] = [];
    for (const [dirKey, groupRows] of groupedRowModels) {
      flat.push({ type: 'group', dirKey, count: groupRows.length, isCollapsed: collapsedGroups.has(dirKey) });
      if (!collapsedGroups.has(dirKey)) {
        for (const data of groupRows) {
          flat.push({ type: 'session', data });
        }
      }
    }
    return flat;
  }, [rowViewModels, groupedRowModels, collapsedGroups]);

  const listHeight = Math.min(
    items.length * ROW_HEIGHT,
    maxVisibleRows * ROW_HEIGHT,
  );

  if (items.length === 0) return null;

  const rowProps: SessionRowExtraProps = {
    items,
    onToggleSelect,
    onApprove,
    onInterrupt,
    onKill,
    onToggleGroup,
  };

  return (
    <div className="rounded-lg border border-void-lighter overflow-hidden">
      {showHeader && (
        <div
          className="grid border-b border-void-lighter text-[--color-text-secondary] text-sm text-left bg-[var(--color-surface)]"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
        >
          <div className="px-3 py-3 font-medium">
            <input
              type="checkbox"
              aria-label="Select all visible sessions"
              checked={allVisibleSelected}
              onChange={(e) => onToggleSelectAll(e.target.checked)}
              className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
            />
          </div>
          <div className="px-2 py-3 font-medium" role="columnheader">Status</div>
          <div className="hidden md:flex px-3 py-3 font-medium" role="columnheader">Created by</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Name</div>
          <div className="hidden lg:flex px-3 py-3 font-medium" role="columnheader">WorkDir</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Age</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Last Activity</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Permission</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Cost</div>
          <div className="px-3 py-3 font-medium" role="columnheader">Actions</div>
        </div>
      )}

      <List<SessionRowExtraProps>
        rowComponent={VirtualizedRow}
        rowCount={items.length}
        rowHeight={(index: number) =>
          items[index]?.type === 'group' ? GROUP_ROW_HEIGHT : ROW_HEIGHT
        }
        overscanCount={OVERSCAN_COUNT}
        rowProps={rowProps}
        style={{ height: listHeight, overflow: 'auto' }}
      />
    </div>
  );
}
