/**
 * components/overview/VirtualizedSessionList.tsx
 * Virtualized session table using react-window List.
 * Renders only visible rows for performant display of large session lists.
 */

import { formatSessionName } from '../../utils/formatSessionName';
import { ModelBadge } from '../shared/ModelBadge';
import { AgentBadge } from '../agents/AgentBadge';
import { EffortIndicator } from '../shared/EffortIndicator';
import type { ExtendedSessionInfo } from '../../types/session-extensions';
import { IsolationModeBadge } from '../shared/IsolationModeBadge';
import type { IsolationSessionInfo } from '../../types/session-isolation';
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
import { useT } from '../../i18n/context';

const needsApproval = (session: SessionInfo): boolean =>
  session.status === 'permission_prompt' || session.status === 'bash_approval';

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
  onReject: (e: React.MouseEvent, id: string) => void;
  onInterrupt: (e: React.MouseEvent, id: string) => void;
  onKill: (e: React.MouseEvent, id: string) => void;
}

// ── Constants ───────────────────────────────────────────────

const ROW_HEIGHT = 52;
const GROUP_ROW_HEIGHT = 44;
const DEFAULT_MAX_VISIBLE_ROWS = 12;
const OVERSCAN_COUNT = 5;

const GRID_COLUMNS = '36px 40px 80px 1fr 150px 80px 90px 1fr 80px 60px 80px';

// ── Helpers ─────────────────────────────────────────────────

function truncateDir(workDir: string, max = 24): string {
  const normalized = workDir.replace(/\\/g, '/');
  const abbreviated = normalized
    .replace(/^\/home\/[^/]+\//, '~/')
    .replace(/^[A-Z]:\/Users\/[^/]+\//i, (m) => `${m[0]}:/…/`);
  if (abbreviated.length <= max) return abbreviated;
  const segments = abbreviated.split('/');
  let result = segments[segments.length - 1] || abbreviated;
  for (let i = segments.length - 2; i >= 0; i--) {
    const candidate = segments.slice(i).join('/');
    if (candidate.length > max) break;
    result = candidate;
  }
  if (result.length > max) result = result.slice(-(max - 1));
  return result.length < abbreviated.length ? `…${result}` : `…${abbreviated.slice(-(max - 1))}`;
}

// ── Row Extra Props (what we pass via rowProps) ─────────────

interface SessionRowExtraProps {
  items: FlatItem[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onApprove: (e: React.MouseEvent, id: string) => void;
  onReject: (e: React.MouseEvent, id: string) => void;
  onInterrupt: (e: React.MouseEvent, id: string) => void;
  onKill: (e: React.MouseEvent, id: string) => void;
  onToggleGroup: (key: string) => void;
}

function ApproveButton({
  session,
  currentAction,
  onApprove,
}: {
  session: SessionInfo;
  currentAction: string | null;
  onApprove: (e: React.MouseEvent, id: string) => void;
}) {
  const t = useT();
  if (!needsApproval(session)) return null;
  return (
    <button
      type="button"
      onClick={(e) => onApprove(e, session.id)}
      disabled={currentAction === 'approve'}
      aria-label={`Approve session ${formatSessionName(session.displayName, session.id.slice(0, 8))}`}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-[var(--color-success)]/15 text-xs font-medium text-[var(--color-success)] transition-colors hover:bg-[var(--color-success)]/25 disabled:pointer-events-none disabled:opacity-40"
      title={t('aria.approve')}
    >
      <Play className="h-3 w-3" />
    </button>
  );
}

function RejectButton({
  session,
  currentAction,
  onReject,
}: {
  session: SessionInfo;
  currentAction: string | null;
  onReject: (e: React.MouseEvent, id: string) => void;
}) {
  const t = useT();
  if (!needsApproval(session)) return null;
  return (
    <button
      type="button"
      onClick={(e) => onReject(e, session.id)}
      disabled={currentAction === 'reject'}
      aria-label={`Reject session ${formatSessionName(session.displayName, session.id.slice(0, 8))}`}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-[var(--color-danger)]/15 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/25 disabled:pointer-events-none disabled:opacity-40"
      title={t('aria.reject')}
    >
      <XCircle className="h-3 w-3" />
    </button>
  );
}

// ── Virtualized Row Component ───────────────────────────────

function VirtualizedRow(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
} & SessionRowExtraProps): ReactElement {
  const t = useT();
  const { ariaAttributes, index, style, items, onToggleSelect, onApprove, onReject, onInterrupt, onKill, onToggleGroup } = props;
  const item = items[index];

  if (item.type === 'group') {
    const { dirKey, count, isCollapsed } = item;
    return (
      <div
        style={style}
        className="border-b border-[color:var(--color-overlay-border-faint)] bg-[color:var(--color-overlay-bg-faint)]"
        {...ariaAttributes}
      >
        <button
          type="button"
          className="flex h-full min-h-[44px] w-full items-center gap-2 px-4 text-left text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-overlay-bg)]"
          onClick={() => onToggleGroup(dirKey)}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${dirKey} group, ${count} sessions`}
        >
          {isCollapsed
            ? <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            : <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
          <FolderOpen className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <span className="font-mono text-xs">{dirKey}</span>
          <span className="text-[var(--color-text-muted)]">({count})</span>
        </button>
      </div>
    );
  }

  const { data } = item;
  const { session, isAlive, health, selected, currentAction, estimatedCostUsd, isFocused } = data;

  return (
    <div
      style={{ ...style, gridTemplateColumns: GRID_COLUMNS }}
      className={`grid border-b border-[var(--color-overlay-border)] transition-all duration-[var(--duration-slow)] ease-out ${
        isFocused
          ? 'bg-[var(--color-accent-cyan)]/10 ring-1 ring-inset ring-[var(--color-accent-cyan)]/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
          : 'hover:bg-[var(--color-overlay-bg)] hover:scale-[1.002] cursor-pointer'
      }${needsApproval(session) ? ' approval-pending-row' : ''}`}
      data-session-id={session.id}
      {...ariaAttributes}
    >
      <div className="flex items-center px-3">
        <input
          type="checkbox"
          aria-label={`Select session ${formatSessionName(session.displayName, session.id.slice(0, 8))}`}
          checked={selected}
          onChange={(e) => onToggleSelect(session.id, e.target.checked)}
          className="h-4 w-4 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-dark)] text-[var(--color-accent-cyan)] focus:ring-1 focus:ring-[var(--color-accent-cyan)]"
        />
      </div>
      <div className="flex items-center px-2">
        <span className={needsApproval(session) ? 'relative' : ''}>
          <StatusDot status={session.status} health={health} />
          {needsApproval(session) && (
            <span className="absolute -inset-1 animate-pulse rounded-full bg-[var(--color-warning)]/20" aria-hidden="true" />
          )}
        </span>
        {!isAlive && <XCircle className="h-3.5 w-3.5 text-[var(--color-danger)]" />}
      </div>
      <div className="hidden md:flex items-center whitespace-nowrap px-3 font-mono text-xs text-[var(--color-text-muted)]">
        {session.ownerKeyId
          ? `${session.ownerKeyId.slice(0, 8)}${session.ownerKeyId.length > 8 ? '…' : ''}`
          : '—'}
      </div>
      <div className="flex min-w-0 items-center px-3">
        <Link
          to={`/sessions/${encodeURIComponent(session.id)}`}
          className="inline-flex min-h-[44px] min-w-0 items-center truncate font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent-cyan)]"
          title={session.displayName || session.id}
        >
          {formatSessionName(session.displayName, session.id.slice(0, 8))}
        </Link>
        <AgentBadge runnerName={session.runnerName} model={session.model} compact />
        <ModelBadge model={session.model} />
        <EffortIndicator effort={(session as ExtendedSessionInfo).effort} />
        <IsolationModeBadge isolationMode={(session as IsolationSessionInfo).isolationMode} />
      </div>
      <div className="flex items-center max-w-[150px] truncate px-3 font-mono text-xs text-[var(--color-text-muted)]" title={session.workDir}>
        {truncateDir(session.workDir)}
      </div>
      <div className="flex items-center whitespace-nowrap px-3 text-[var(--color-text-muted)] text-sm">
        {formatTimeAgo(session.createdAt)}
      </div>
      <div className="flex items-center whitespace-nowrap px-3 text-[var(--color-text-muted)] text-sm">
        {formatTimeAgo(session.lastActivity)}
      </div>
      <div className="flex items-center px-3 text-xs text-[var(--color-text-muted)] truncate" title={session.latestActivityText ?? ''}>
        {session.latestActivityText
          ? <span className="truncate max-w-[120px] inline-block align-bottom">{session.latestActivityText}</span>
          : <span className="text-[var(--color-text-muted)]/40">—</span>}
      </div>
      <div className="flex items-center px-3">
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-xs text-[var(--color-success)]">
            <CheckCircle2 className="h-3 w-3" />
            {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-[var(--color-void-lighter)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
            default
          </span>
        )}
      </div>
      <div className="flex items-center px-3 text-xs text-[var(--color-text-muted)]">
        {estimatedCostUsd != null ? `$${estimatedCostUsd.toFixed(2)}` : '—'}
      </div>
      <div className="flex items-center gap-1 px-3">
        {currentAction === 'working' && (
          <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-cyan)]/30 px-1.5 py-0.5 text-xs text-[var(--color-accent-cyan)]">
            <Play className="h-2.5 w-2.5" />
            running
          </span>
        )}
        <ApproveButton session={session} currentAction={currentAction} onApprove={onApprove} />
                <RejectButton session={session} currentAction={currentAction} onReject={onReject} />
        <button
          type="button"
          onClick={(e) => onInterrupt(e, session.id)}
          aria-label={`Interrupt session ${formatSessionName(session.displayName, session.id.slice(0, 8))}`}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 transition-colors"
          title={t('aria.interrupt')}
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => onKill(e, session.id)}
          aria-label={`Kill session ${formatSessionName(session.displayName, session.id.slice(0, 8))}`}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
          title={t('aria.kill')}
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
  onReject,
  onInterrupt,
  onKill,
}: VirtualizedSessionListProps) {
    const t = useT();

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

  const totalHeight = items.reduce(
    (sum, item) => sum + (item.type === 'group' ? GROUP_ROW_HEIGHT : ROW_HEIGHT),
    0,
  );
  const listHeight = Math.min(totalHeight, maxVisibleRows * ROW_HEIGHT);

  if (items.length === 0) return null;

  const rowProps: SessionRowExtraProps = {
    items,
    onToggleSelect,
    onApprove,
    onReject,
    onInterrupt,
    onKill,
    onToggleGroup,
  };

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] overflow-hidden">
      {showHeader && (
        <div
          className="grid border-b border-[var(--color-void-lighter)] text-[var(--color-text-muted)] text-sm text-left bg-[var(--color-surface)]"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
        >
          <div className="px-3 py-3 font-medium">
            <input
              type="checkbox"
              aria-label={t("aria.selectAll")}
              checked={allVisibleSelected}
              onChange={(e) => onToggleSelectAll(e.target.checked)}
              className="h-4 w-4 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-dark)] text-[var(--color-accent-cyan)] focus:ring-1 focus:ring-[var(--color-accent-cyan)]"
            />
          </div>
          <div className="px-2 py-3 font-medium" role="columnheader">{t('sessionTable.status')}</div>
          <div className="hidden md:flex px-3 py-3 font-medium" role="columnheader">{t('sessionTable.createdBy')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.name')}</div>
          <div className="flex px-3 py-3 font-medium" role="columnheader">{t('sessionTable.workDir')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.age')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.lastActivity')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.activity')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.permission')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.cost')}</div>
          <div className="px-3 py-3 font-medium" role="columnheader">{t('sessionTable.actions')}</div>
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
