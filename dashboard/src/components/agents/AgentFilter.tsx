/**
 * AgentFilter — dropdown filter for sessions by agent runner type.
 *
 * Shows all known agents from the registry + an "All Agents" option.
 * Related: #3622, #3682
 */

import type { FC, ChangeEvent } from "react";
import { getAgentFilterOptions, getAgentMeta } from "./agent-registry";
import { useT } from '../../i18n/context';

export interface AgentFilterProps {
  /** Currently selected runnerName (undefined = all). */
  value?: string | null;
  /** Callback when filter changes. */
  onChange: (runnerName: string | null) => void;
  className?: string;
}

export const AgentFilter: FC<AgentFilterProps> = ({ value, onChange, className = "" }) => {
  const options = getAgentFilterOptions();
  const t = useT();

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    onChange(v || null);
  };

  const selectedMeta = value ? getAgentMeta(value) : null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor="agent-filter" className="sr-only">
        Filter by agent
      </label>
      <select
        id="agent-filter"
        value={value ?? ""}
        onChange={handleChange}
        className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-void)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-cta-bg)] focus-visible:outline-none focus:ring-1 focus:ring-[var(--color-cta-bg)] transition-colors"
        aria-label={t('aria.filterByAgentType')}
      >
        <option value="">{t('sessions.allAgents')}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {selectedMeta && (
        <span className="text-xs text-[var(--color-text-muted)]">Showing {selectedMeta.label} sessions</span>
      )}
    </div>
  );
};

export default AgentFilter;
