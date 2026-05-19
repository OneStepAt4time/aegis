/**
 * agent-registry.ts — Static mapping of ACP agent runner names to UI metadata.
 *
 * Forward-compatible: unknown runnerName values render as gray badges with
 * the raw name, so new agents display correctly without dashboard code changes.
 *
 * Related: #3622 (ACP competitive intel), #3682 (backend runnerName field)
 */

export interface AgentMeta {
  /** Human-readable label shown in badges and dropdowns. */
  label: string;
  /** Tailwind color token for badge background. */
  color: "purple" | "green" | "blue" | "amber" | "cyan" | "rose" | "gray";
  /** Optional icon name (Lucide) — null uses a generic bot icon. */
  icon?: string;
}

/**
 * Canonical agent registry. Keys match `runnerName` from the Aegis API.
 *
 * When the backend exposes new runner types, they automatically render as
 * gray badges with the raw name — no dashboard update required.
 */
export const AGENT_REGISTRY: Record<string, AgentMeta> = {
  "claude-code": { label: "Claude Code", color: "purple", icon: "bot" },
  codex: { label: "Codex", color: "green", icon: "terminal" },
  "gemini-cli": { label: "Gemini", color: "blue", icon: "sparkles" },
  copilot: { label: "Copilot", color: "amber", icon: "github" },
  qwen: { label: "Qwen", color: "cyan", icon: "message-square" },
  cursor: { label: "Cursor", color: "blue", icon: "mouse-pointer" },
  opencode: { label: "OpenCode", color: "rose", icon: "code" },
  kimi: { label: "Kimi", color: "cyan", icon: "zap" },
  goose: { label: "Goose", color: "amber", icon: "bird" },
  auggie: { label: "Auggie", color: "green", icon: "brain" },
  amp: { label: "Amp", color: "purple", icon: "zap" },
  kiro: { label: "Kiro", color: "amber", icon: "cloud" },
};

const DEFAULT_META: AgentMeta = { label: "Agent", color: "gray", icon: "bot" };

/**
 * Resolve runnerName to UI metadata.
 * Returns the default (gray "Agent") for unknown/undefined values.
 */
export function getAgentMeta(runnerName?: string | null): AgentMeta {
  if (!runnerName) return DEFAULT_META;
  return AGENT_REGISTRY[runnerName] ?? { ...DEFAULT_META, label: runnerName };
}

/**
 * All known agent types for filter dropdowns.
 * Returns sorted by label for consistent UI ordering.
 */
export function getAgentFilterOptions(): Array<{ value: string; label: string }> {
  return Object.entries(AGENT_REGISTRY)
    .map(([value, meta]) => ({ value, label: meta.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
