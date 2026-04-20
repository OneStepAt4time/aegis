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

import { modelAccent } from '../../design/modelAccents';

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

  // Parse model name. In addition to `claude-*`, BYO LLM backends emit
  // names like `glm-5.1`, `gpt-4o-mini`, `llama3.1:70b`, `qwen2.5-coder`.
  // Issue 04.9: match by known family prefix so we can accent it later.
  const modelMatch = /\b((?:claude|gpt|o1|o3|o4|glm|llama|mistral|mixtral|qwen|deepseek)[-.:][a-z0-9.:_-]+)\b/i.exec(line);
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
  const leading: string[] = [];
  if (version) leading.push(`claude v${version}`);
  const trailing: string[] = [];
  if (effort) trailing.push(`${EFFORT_LABEL[effort]} effort`);

  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-text-muted)] ${className ?? ''}`}
      aria-live="polite"
      aria-label="Claude runtime status"
    >
      <span>
        {leading.length > 0 && <span>{leading.join(' · ')}</span>}
        {model && (
          <>
            {leading.length > 0 && <span aria-hidden="true"> · </span>}
            {/* Issue 04.9: the model token inherits its family accent so
                 sparklines + pie slices can match the same hue downstream. */}
            <span style={{ color: modelAccent(model) }}>{model}</span>
          </>
        )}
        {trailing.length > 0 && (
          <>
            {(leading.length > 0 || model) && <span aria-hidden="true"> · </span>}
            <span>{trailing.join(' · ')}</span>
          </>
        )}
      </span>
      {thinking && (
        <span
          className="inline-flex items-center gap-1 text-[var(--color-warning)]"
          aria-label="Claude is thinking"
        >
          {(leading.length > 0 || model || trailing.length > 0) && <span aria-hidden="true">·</span>}
          <span aria-hidden="true">◉</span>
          <span>Thinking</span>
        </span>
      )}
    </div>
  );
}

export default ClaudeStatusStrip;
