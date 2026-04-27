import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeOutput } from '../sanitize-stream.js';

function fixture(name: string): string {
  return readFileSync(join(__dirname, `${name}`), 'utf-8');
}

// ── Module surface ─────────────────────────────────────────────────────────

describe('sanitizeOutput — module surface', () => {
  it('exports sanitizeOutput as a named export', () => {
    expect(typeof sanitizeOutput).toBe('function');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeOutput('')).toBe('');
  });

  it('is stable: identical clean content passes through unchanged', () => {
    const clean = '> What is 2+2?\n\nClaude: The answer is 4.\n';
    expect(sanitizeOutput(clean)).toBe(clean);
  });

  it('does not strip a user sentence that mentions "claude"', () => {
    const input = 'I asked claude about the migration, but the answer was unclear.\n';
    expect(sanitizeOutput(input)).toBe(input);
  });

  it('does not strip a "· " list bullet followed by a plain noun', () => {
    const input = '· items\n· another bullet\n';
    expect(sanitizeOutput(input)).toBe(input);
  });
});

// ── Linux bootstrap fixture ────────────────────────────────────────────────

describe('sanitizeOutput — Linux bootstrap fixture', () => {
  const input = fixture('fixture-linux-bootstrap.txt');
  const output = sanitizeOutput(input);

  it('strips the Unix bootstrap line (unset TMUX TMUX_PANE && exec claude)', () => {
    expect(output).not.toMatch(/unset\s+TMUX\s+TMUX_PANE/);
    expect(output).not.toMatch(/exec\s+claude/);
  });

  it('strips the aegis-hooks settings path', () => {
    expect(output).not.toMatch(/aegis-hooks-[0-9a-fA-F]{6,}/);
  });

  it('strips the Claude CLI ASCII logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/APIUsageBilling/);
    expect(output).not.toMatch(/Welcome to Claude Code/);
  });

  it('strips the status-footer progress line (· Thinking…)', () => {
    expect(output).not.toMatch(/·\s*Thinking/);
  });

  it('strips the "esc to interrupt" footer line', () => {
    expect(output).not.toMatch(/esc to interrupt/);
  });

  it('preserves the user prompt message', () => {
    expect(output).toContain('> refactor the auth module to use JWT');
  });

  it("preserves Claude's assistant output", () => {
    expect(output).toContain("Claude: Starting the refactor now.");
  });
});

// ── Windows bootstrap fixture ──────────────────────────────────────────────

describe('sanitizeOutput — Windows bootstrap fixture', () => {
  const input = fixture('fixture-windows-bootstrap.txt');
  const output = sanitizeOutput(input);

  it('strips the PowerShell prompt-only line', () => {
    expect(output).not.toMatch(/^PS D:\\aegis>\s*$/m);
  });

  it('strips the Set-Location / Remove-Item / claude bootstrap line', () => {
    expect(output).not.toMatch(/Set-Location\s+-LiteralPath/);
    expect(output).not.toMatch(/Remove-Item\s+Env:TMUX/);
    expect(output).not.toMatch(/--session-id\s+8c0b2b44/);
  });

  it('strips the aegis-hooks settings path', () => {
    expect(output).not.toMatch(/aegis-hooks-[0-9a-fA-F]{6,}/);
  });

  it('strips the Claude CLI ASCII logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/APIUsageBilling/);
    expect(output).not.toMatch(/Welcome to Claude Code/);
  });

  it('strips the status-footer progress line (· Frolicking…)', () => {
    expect(output).not.toMatch(/·\s*Frolicking/);
  });

  it('strips the "esc to interrupt" footer line', () => {
    expect(output).not.toMatch(/esc to interrupt/);
  });

  it('preserves the user prompt message verbatim', () => {
    expect(output).toContain('> Write me a migration for the users table');
  });

  it('preserves user-pasted CSV payload', () => {
    expect(output).toContain('id,name,email');
    expect(output).toContain('1,Alice,alice@example.com');
    expect(output).toContain('2,Bob,bob@example.com');
  });

  it("preserves Claude's assistant output", () => {
    expect(output).toContain("Claude: I'll draft that migration now.");
  });
});

// ── macOS bootstrap fixture ────────────────────────────────────────────────

describe('sanitizeOutput — macOS bootstrap fixture', () => {
  const input = fixture('fixture-macos-bootstrap.txt');
  const output = sanitizeOutput(input);

  it('strips the Unix bootstrap line', () => {
    expect(output).not.toMatch(/unset\s+TMUX\s+TMUX_PANE/);
    expect(output).not.toMatch(/exec\s+claude/);
  });

  it('strips the aegis-hooks settings path', () => {
    expect(output).not.toMatch(/aegis-hooks-[0-9a-fA-F]{6,}/);
  });

  it('strips the ASCII logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/APIUsageBilling/);
  });

  it('strips the status-footer progress line (· Processing…)', () => {
    expect(output).not.toMatch(/·\s*Processing/);
  });

  it('strips the "esc to interrupt" footer', () => {
    expect(output).not.toMatch(/esc to interrupt/);
  });

  it('preserves the user prompt', () => {
    expect(output).toContain('> add dark mode support to the settings page');
  });

  it("preserves Claude's assistant output", () => {
    expect(output).toContain("Claude: I'll update the settings page");
  });
});

// ── ASCII logo-only fixture ────────────────────────────────────────────────

describe('sanitizeOutput — ASCII logo fixture', () => {
  const input = fixture('fixture-ascii-logo.txt');
  const output = sanitizeOutput(input);

  it('strips the entire logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/╭─────/);
    expect(output).not.toMatch(/╰─────/);
    expect(output).not.toMatch(/APIUsageBilling/);
    expect(output).not.toMatch(/Welcome to Claude Code/);
  });

  it('preserves the user prompt after the logo', () => {
    expect(output).toContain('> what is 2 + 2?');
  });

  it("preserves Claude's answer", () => {
    expect(output).toContain('Claude: The answer is 4.');
  });
});

// ── Code-fence protection (user-pasted content) ───────────────────────────

describe('sanitizeOutput — never over-strips inside fences', () => {
  it('preserves Windows bootstrap inside a fenced code block', () => {
    const input = [
      '> Here is the launch command:',
      '',
      '```powershell',
      "Set-Location -LiteralPath 'D:\\project'; Remove-Item Env:TMUX -ErrorAction SilentlyContinue; claude --session-id demo",
      '```',
      '',
      'Claude: Got it.',
    ].join('\n');

    const output = sanitizeOutput(input);
    expect(output).toContain("Set-Location -LiteralPath 'D:\\project'");
    expect(output).toContain('Remove-Item Env:TMUX');
    expect(output).toContain('Claude: Got it.');
  });

  it('preserves Unix bootstrap inside a fenced code block', () => {
    const input = [
      '> Here is the launch command:',
      '',
      '```sh',
      "cd '/home/dev/project' && unset TMUX TMUX_PANE && exec claude --session-id demo",
      '```',
      '',
      'Claude: Understood.',
    ].join('\n');

    const output = sanitizeOutput(input);
    expect(output).toContain("cd '/home/dev/project' && unset TMUX TMUX_PANE && exec claude");
    expect(output).toContain('Claude: Understood.');
  });

  it('preserves aegis-hooks reference inside a fenced block', () => {
    const input = [
      '> Example path:',
      '```',
      '/tmp/aegis-hooks-4f3a1b/hooks-abc123.json',
      '```',
    ].join('\n');

    const output = sanitizeOutput(input);
    expect(output).toContain('aegis-hooks-4f3a1b');
  });
});

// ── Never over-strips ──────────────────────────────────────────────────────

describe('sanitizeOutput — never over-strips', () => {
  it('does not strip a lone blank line run of exactly 2', () => {
    const input = 'line 1\n\nline 2\n';
    expect(sanitizeOutput(input)).toBe(input);
  });

  it('collapses 3+ consecutive blank lines to at most 2', () => {
    const input = 'a\n\n\n\nb\n';
    const output = sanitizeOutput(input);
    expect(output).toContain('a');
    expect(output).toContain('b');
    // At most one blank line between a and b (double-blank collapsed)
    expect(output).not.toMatch(/a\n\n\n/);
  });

  it('keeps plain "· " bullet points that are not gerund status lines', () => {
    const input = '· items\n· tasks completed yesterday\n';
    expect(sanitizeOutput(input)).toBe(input);
  });
});

// ── Permission-mode footer (issue 01 of session-cockpit epic) ────────────

describe('sanitizeOutput — permission-mode markers', () => {
  it('drops the [CAVEMAN] mode-marker line', () => {
    const input = 'Agent: hello\n[CAVEMAN]\nmore output\n';
    const out = sanitizeOutput(input);
    expect(out).not.toContain('[CAVEMAN]');
    expect(out).toContain('Agent: hello');
    expect(out).toContain('more output');
  });

  it('drops [YOLO] and other ALL-CAPS mode markers', () => {
    const input = '[YOLO]\n[DEFAULT]\n[BYPASS_PERMISSIONS]\n';
    expect(sanitizeOutput(input).trim()).toBe('');
  });

  it('drops the "bypass permissions on (shift+tab to cycle)" footer', () => {
    const input = 'Agent: done\n>> bypass permissions on (shift+tab to cycle)\n';
    expect(sanitizeOutput(input)).not.toMatch(/shift\s*\+\s*tab/i);
  });

  it('keeps prose that happens to mention square-bracketed keywords', () => {
    // Mixed-case and multi-word bracketed phrases are not mode markers.
    const input = '[important] See [the docs] and [example-1] below.\n';
    expect(sanitizeOutput(input)).toBe(input);
  });

  it('preserves mode markers inside fenced code blocks', () => {
    const input = 'doc:\n```\n[CAVEMAN]\n```\nend\n';
    expect(sanitizeOutput(input)).toContain('[CAVEMAN]');
  });
});
