/**
 * components/session/ClaudeStatusStrip.tsx
 *
 * Compact single-line strip rendering Claude CLI runtime metadata — version,
 * model, effort level, and thinking state. Replaces raw "· Frolicking…" /
 * "esc to interrupt·high·/effort" text appearing in the terminal.
 *
 * Usage:
 *   <ClaudeStatusStrip version="2.5.0" model="claude-3-5-sonnet" effort="high" thinking={true} />
 */

export interface ClaudeStatusStripProps {
  version?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  thinking: boolean;
  className?: string;
}

const EFFORT_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

/**
 * Parse a raw Claude CLI status footer line into typed metadata.
 *
 * Example inputs:
 *   "· Frolicking…"
 *   "esc to interrupt · high · /effort"
 *   "claude 2.5.0 · claude-3-5-sonnet-20241022 · medium · /effort"
 */
export function parseStatusFooter(line: string): Partial<Omit<ClaudeStatusStripProps, 'className'>> {
  const result: Partial<Omit<ClaudeStatusStripProps, 'className'>> = { thinking: false };

  // Detect "thinking" from gerund status lines like "· Thinking…"
  if (/[·•]\s*[A-Z][a-zA-Z]+ing\s*[….]*/i.test(line)) {
    result.thinking = /[·•]\s*Thinking/i.test(line);
  }

  // Parse effort level from "esc to interrupt · high · /effort" or inline footer
  const effortMatch = /\b(low|medium|high)\b/i.exec(line);
  if (effortMatch) {
    const e = effortMatch[1].toLowerCase() as 'low' | 'medium' | 'high';
    if (e === 'low' || e === 'medium' || e === 'high') result.effort = e;
  }

  // Parse version from "claude 2.5.0" or "v2.5.0"
  const versionMatch = /\bv?(\d+\.\d+\.\d+)\b/.exec(line);
  if (versionMatch) result.version = versionMatch[1];

  // Parse model name (claude-* pattern)
  const modelMatch = /\b(claude-[a-z0-9-]+)\b/i.exec(line);
  if (modelMatch) result.model = modelMatch[1];

  return result;
}

export function ClaudeStatusStrip({
  version,
  model,
  effort,
  thinking,
  className,
}: ClaudeStatusStripProps) {
  const parts: string[] = [];
  if (version) parts.push(`claude v${version}`);
  if (model) parts.push(model);
  if (effort) parts.push(`${EFFORT_LABEL[effort]} effort`);

  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-text-muted)] ${className ?? ''}`}
      aria-live="polite"
      aria-label="Claude runtime status"
    >
      <span>{parts.join(' · ')}</span>
      {thinking && (
        <span
          className="inline-flex items-center gap-1 text-[var(--color-warning)]"
          aria-label="Claude is thinking"
        >
          {parts.length > 0 && <span aria-hidden="true">·</span>}
          <span aria-hidden="true">◉</span>
          <span>Thinking</span>
        </span>
      )}
    </div>
  );
}

export default ClaudeStatusStrip;
