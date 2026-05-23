/**
 * AgentBadge — color-coded pill showing which agent runner powers a session.
 *
 * Forward-compatible: unknown runnerName values render as gray with raw name.
 * Before backend ships runnerName (#3682), falls back to heuristic from model field.
 *
 * Related: #3622 (ACP competitive intel), #3682 (backend runnerName field)
 */

import type { FC } from "react";
import { getAgentMeta } from "./agent-registry";

/** Tailwind color → dark-theme badge classes. */
const COLOR_CLASSES: Record<string, string> = {
  purple: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  amber: "bg-[var(--color-warning)]/15 text-amber-400 border-[var(--color-warning)]/25",
  cyan: "bg-[var(--color-cta-bg)]-500/15 text-[var(--color-accent-cyan)]-400 border-[var(--color-accent-cyan)]-500/25",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  gray: "bg-gray-500/15 text-gray-400 border-gray-500/25",
};

export interface AgentBadgeProps {
  /** Runner name from API (e.g. "claude-code", "codex"). Undefined before #3682 ships. */
  runnerName?: string | null;
  /** Model name for fallback heuristic when runnerName is absent. */
  model?: string | null;
  /** Additional CSS classes. */
  className?: string;
  /** Show as compact (icon only, no label). */
  compact?: boolean;
}

/**
 * Infer agent type from model name when runnerName is not available.
 * This is a temporary heuristic until backend ships #3682.
 */
function inferRunnerFromModel(model?: string | null): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.includes("claude")) return "claude-code";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "codex";
  if (m.includes("gemini")) return "gemini-cli";
  if (m.includes("qwen")) return "qwen";
  if (m.includes("copilot")) return "copilot";
  return undefined;
}

export const AgentBadge: FC<AgentBadgeProps> = ({ runnerName, model, className = "", compact }) => {
  // Prefer explicit runnerName; fall back to model heuristic
  const resolved = runnerName ?? inferRunnerFromModel(model);
  const meta = getAgentMeta(resolved);
  const colorClasses = COLOR_CLASSES[meta.color] ?? COLOR_CLASSES.gray;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${colorClasses} ${compact ? "px-1" : ""} ${className}`}
      title={meta.label}
      aria-label={`Agent: ${meta.label}`}
    >
      {!compact && meta.label}
    </span>
  );
};

export default AgentBadge;
