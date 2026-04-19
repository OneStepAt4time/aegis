import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import sanitizeTerminalStream, { sanitizeTerminalStream as named } from '../utils/sanitizeStream';

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('sanitizeTerminalStream — module surface', () => {
  it('exposes the same function as default and named export', () => {
    expect(sanitizeTerminalStream).toBe(named);
  });

  it('returns the input unchanged when preserveRaw is true (byte-identical)', () => {
    const input = loadFixture('stream-bootstrap-win.txt');
    const out = sanitizeTerminalStream(input, 'win32', { preserveRaw: true });
    expect(out).toBe(input);
  });

  it('is stable for empty input', () => {
    expect(sanitizeTerminalStream('', 'linux')).toBe('');
  });
});

describe('sanitizeTerminalStream — Windows bootstrap fixture', () => {
  const input = loadFixture('stream-bootstrap-win.txt');
  const output = sanitizeTerminalStream(input, 'win32');

  it('strips the PowerShell prompt-only line', () => {
    expect(output).not.toMatch(/^PS D:\\aegis>\s*$/m);
  });

  it('strips the Set-Location / Remove-Item / claude bootstrap line', () => {
    expect(output).not.toMatch(/Set-Location\s+-LiteralPath/);
    expect(output).not.toMatch(/Remove-Item\s+Env:TMUX/);
    expect(output).not.toMatch(/--session-id\s+8c0b2b44/);
  });

  it('strips the aegis-hooks settings path', () => {
    expect(output).not.toMatch(/aegis-hooks-[0-9a-f]{6,}/);
  });

  it('strips the Claude CLI ASCII logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/APIUsageBilling/);
    expect(output).not.toMatch(/Welcome to Claude Code/);
  });

  it('strips the status-footer progress line ("· Frolicking…")', () => {
    expect(output).not.toMatch(/·\s*Frolicking/);
  });

  it('strips the "esc to interrupt" footer line', () => {
    expect(output).not.toMatch(/esc to interrupt/);
  });

  it('preserves the user prompt message verbatim', () => {
    expect(output).toContain(
      '> Write me a migration for the users table; here is the data:',
    );
  });

  it('preserves the pasted CSV payload', () => {
    expect(output).toContain('id,name,email');
    expect(output).toContain('1,Alice,alice@example.com');
    expect(output).toContain('2,Bob,bob@example.com');
  });

  it("preserves Claude's assistant output", () => {
    expect(output).toContain("Claude: I'll draft that migration now.");
  });
});

describe('sanitizeTerminalStream — Unix bootstrap fixture', () => {
  const input = loadFixture('stream-bootstrap-unix.txt');
  const output = sanitizeTerminalStream(input, 'linux');

  it('strips the unset TMUX TMUX_PANE && exec claude bootstrap line', () => {
    expect(output).not.toMatch(/unset\s+TMUX\s+TMUX_PANE/);
    expect(output).not.toMatch(/exec\s+claude/);
  });

  it('strips the aegis-hooks settings path', () => {
    expect(output).not.toMatch(/aegis-hooks-[0-9a-f]{6,}/);
  });

  it('strips the Claude CLI ASCII logo block', () => {
    expect(output).not.toMatch(/ClaudeCode/);
    expect(output).not.toMatch(/APIUsageBilling/);
  });

  it('strips the status-footer progress line ("· Thinking…")', () => {
    expect(output).not.toMatch(/·\s*Thinking/);
  });

  it('strips the "esc to interrupt" footer line', () => {
    expect(output).not.toMatch(/esc to interrupt/);
  });

  it('preserves the user prompt message', () => {
    expect(output).toContain('> refactor the auth module to use JWT');
  });

  it("preserves Claude's assistant output", () => {
    expect(output).toContain("Claude: Starting the refactor now. I'll begin with auth.ts.");
  });
});

describe('sanitizeTerminalStream — user content fixture', () => {
  const input = loadFixture('stream-bootstrap-user-content.txt');

  it('leaves user-pasted PowerShell code block contents untouched', () => {
    const output = sanitizeTerminalStream(input, 'win32');
    expect(output).toContain("Set-Location -LiteralPath 'D:\\project'");
    expect(output).toContain('Remove-Item Env:TMUX -ErrorAction SilentlyContinue');
    expect(output).toContain('claude --session-id demo --permission-mode bypassPermissions');
  });

  it('leaves user-pasted Unix code block contents untouched', () => {
    const output = sanitizeTerminalStream(input, 'linux');
    expect(output).toContain('cd /home/dev/project && unset TMUX TMUX_PANE && exec claude --session-id demo');
  });

  it('preserves the user question about "Frolicking"', () => {
    const output = sanitizeTerminalStream(input, 'linux');
    expect(output).toContain('> What is Frolicking?');
    expect(output).toContain('Frolicking is playful movement');
  });

  it('keeps fence markers intact', () => {
    const output = sanitizeTerminalStream(input, 'linux');
    expect(output).toMatch(/```powershell/);
    expect(output).toMatch(/```sh/);
    // Three closing fences (powershell, sh) — count of ``` should be >= 4 on boundaries.
    const fenceCount = (output.match(/```/g) ?? []).length;
    expect(fenceCount).toBeGreaterThanOrEqual(4);
  });
});

describe('sanitizeTerminalStream — cross-platform safety', () => {
  it('also strips a Unix bootstrap when platform is win32 (defence in depth)', () => {
    const input = "cd '/home/dev/x' && unset TMUX TMUX_PANE && exec claude --session-id demo\nhello world\n";
    const output = sanitizeTerminalStream(input, 'win32');
    expect(output).not.toMatch(/unset TMUX TMUX_PANE/);
    expect(output).toContain('hello world');
  });

  it('also strips a Windows bootstrap when platform is linux (defence in depth)', () => {
    const input =
      "Set-Location -LiteralPath 'D:\\x'; Remove-Item Env:TMUX -ErrorAction SilentlyContinue; claude --session-id demo\nhello world\n";
    const output = sanitizeTerminalStream(input, 'linux');
    expect(output).not.toMatch(/Remove-Item Env:TMUX/);
    expect(output).toContain('hello world');
  });

  it('darwin platform hint behaves like linux for Unix bootstraps', () => {
    const input = "unset TMUX TMUX_PANE && exec claude --session-id demo\nhello\n";
    const output = sanitizeTerminalStream(input, 'darwin');
    expect(output).not.toMatch(/unset TMUX TMUX_PANE/);
    expect(output).toContain('hello');
  });
});

describe('sanitizeTerminalStream — never over-strips', () => {
  it('does not strip a user sentence that merely mentions "claude"', () => {
    const input = 'I asked claude about the migration, but the answer was unclear.\n';
    expect(sanitizeTerminalStream(input, 'linux')).toBe(input);
  });

  it('does not strip a "· " list bullet followed by a noun', () => {
    const input = '· items\n· another bullet\n';
    // "items" ends in "s", not gerund-style; should be preserved.
    expect(sanitizeTerminalStream(input, 'linux')).toBe(input);
  });

  it('does not strip a lone blank line run', () => {
    const input = 'line 1\n\nline 2\n';
    expect(sanitizeTerminalStream(input, 'linux')).toBe(input);
  });
});
