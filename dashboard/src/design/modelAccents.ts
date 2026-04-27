/**
 * design/modelAccents.ts — model-family accent colors.
 *
 * Issue 04.9 of the session-cockpit epic.
 *
 * Pure mapping from a raw model name (as parsed from the Claude CLI
 * footer or returned by a BYO-LLM backend) to a CSS custom-property
 * reference defined in `index.css` / `tokens.ts`. Consumers render:
 *
 *   <span style={{ color: modelAccent(name) }}>{name}</span>
 *
 * The map is intentionally family-level, not per-version: `opus`,
 * `sonnet`, `haiku` are the Claude stability boundaries, and the
 * BYO families we've seen in the wild (GLM, GPT, Llama) each get a
 * distinct hue so sparklines + pie slices (follow-up) can inherit.
 */

export type ModelFamily =
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'gpt'
  | 'glm'
  | 'llama'
  | 'mistral'
  | 'qwen'
  | 'deepseek'
  | 'unknown';

// Model names commonly glue a family prefix directly to a digit
// (`gpt-4o`, `glm-5.1`, `qwen2.5`, `o3-mini`) so the patterns match
// the prefix followed by an optional separator or digit — not a
// word boundary on the trailing side.
const FAMILY_PATTERNS: ReadonlyArray<readonly [ModelFamily, RegExp]> = [
  ['opus',     /\bopus(?=\b|[-_])/i],
  ['sonnet',   /\bsonnet(?=\b|[-_])/i],
  ['haiku',    /\bhaiku(?=\b|[-_])/i],
  ['gpt',      /\bgpt[-.]/i],
  ['gpt',      /\bo[134](?=\b|[-.])/i],
  ['glm',      /\bglm(?=[-.\d])/i],
  ['llama',    /\bllama(?=[-.\d])/i],
  ['mistral',  /\b(?:mistral|mixtral)(?=[-.\d_])/i],
  ['qwen',     /\bqwen(?=[-.\d])/i],
  ['deepseek', /\bdeepseek(?=\b|[-.])/i],
];

/** Map a raw model string to its family. Case-insensitive. Returns
 *  `'unknown'` when no family matches. */
export function modelFamily(name: string | undefined | null): ModelFamily {
  if (!name) return 'unknown';
  for (const [family, re] of FAMILY_PATTERNS) {
    if (re.test(name)) return family;
  }
  return 'unknown';
}

const FAMILY_ACCENT: Record<ModelFamily, string> = {
  // Claude tiers use the existing semantic accents so the palette stays
  // consistent with status dots elsewhere on the page.
  opus:     'var(--color-metrics-purple)',
  sonnet:   'var(--color-accent-cyan)',
  haiku:    'var(--color-success)',

  // BYO families fan out into distinct hues.
  gpt:      'var(--color-accent)',
  glm:      'var(--color-warning)',
  llama:    'var(--color-accent-purple)',
  mistral:  'var(--color-info)',
  qwen:     'var(--color-accent-cyan)',
  deepseek: 'var(--color-metrics-purple)',

  unknown:  'var(--color-text-muted)',
};

/** CSS color (custom-property reference) for the model's family. */
export function modelAccent(name: string | undefined | null): string {
  return FAMILY_ACCENT[modelFamily(name)];
}
