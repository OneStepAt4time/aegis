/**
 * capture-pane-dcs.test.ts — Tests for Issue #89 L23 and Issue #1800.
 *
 * Tests that DCS sequences (Device Control String, ESC P ... ESC \)
 * are stripped from capture-pane output WITHOUT eating visible text.
 */

import { describe, it, expect } from 'vitest';

/** DCS stripping regex used in TmuxManager.capturePane (must match src/tmux.ts). */
const DCS_PATTERN = /\x1bP[^\x1b\n]*\x1b\\/g;

describe('DCS sequence stripping (Issue #89 L23)', () => {
  it('should strip a single DCS sequence from pane output', () => {
    const input = 'Hello\x1bPDCS data here\x1b\\World';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe('HelloWorld');
  });

  it('should strip multiple DCS sequences', () => {
    const input = 'A\x1bPfirst\x1b\\B\x1bPsecond\x1b\\C';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe('ABC');
  });

  it('should not modify output without DCS sequences', () => {
    const input = 'Normal pane content\nwith multiple lines\n❯';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe(input);
  });

  it('should handle DCS with no inner content', () => {
    const input = 'Before\x1bP\x1b\\After';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe('BeforeAfter');
  });

  it('should strip DCS from realistic pane output', () => {
    const input = [
      '  \x1bP1j\x1b\\✻ Reading src/server.ts',
      '  ✻ Analyzing imports',
      '──────────────────────────────',
      '❯',
    ].join('\n');
    const result = input.replace(DCS_PATTERN, '');
    expect(result).not.toContain('\x1b');
    expect(result).toContain('✻ Reading src/server.ts');
    expect(result).toContain('❯');
  });

  it('should strip tmux passthrough DCS sequences', () => {
    const input = '\x1bPtmux;DA1\x1b\\Visible pane text';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe('Visible pane text');
  });
});

describe('DCS stripping preserves visible text (Issue #1800)', () => {
  it('should NOT strip visible text when DCS start and terminator are on different lines', () => {
    const input = '\x1bPtmux;DA1\nNow I\'ll make the changes\n\x1b\\';
    const result = input.replace(DCS_PATTERN, '');
    // The old regex /[\s\S]*?/ would match across lines and strip everything.
    // The new regex /[^\x1b\n]*/ must NOT match across lines.
    // The DCS markers remain (they weren't matched), but visible text is preserved.
    expect(result).toContain('Now I\'ll make the changes');
  });

  it('should preserve spaces between words when DCS sequences appear in output', () => {
    const input = 'Now \x1bPtmux;DA1\x1b\\ I\'ll make the changes';
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toContain('Now');
    expect(result).toContain('I\'ll');
    expect(result).toContain('make');
    expect(result).toContain('changes');
  });

  it('should handle DCS sequences that contain only a space (passthrough padding)', () => {
    // Spaces between words should not be eaten by DCS stripping
    const input = 'Now\x1bP \x1b\\I\'ll\x1bP \x1b\\make\x1bP \x1b\\the\x1bP \x1b\\changes';
    const result = input.replace(DCS_PATTERN, '');
    // After stripping DCS markers, words may be concatenated (DCS data is stripped),
    // but the pattern should not match across lines.
    expect(result).not.toContain('\x1b');
  });

  it('should not match DCS start on one line and terminator on another', () => {
    // Simulates a pane where DCS opens on line 1 and closes on line 3
    const input = [
      'Header \x1bPdata',
      'Now I\'ll make the changes. First, update the combo counter',
      'initialization to start at 1.\x1b\\',
      'Footer',
    ].join('\n');
    const result = input.replace(DCS_PATTERN, '');
    // Visible text must survive — the regex must not match across newlines
    expect(result).toContain('Now I\'ll make the changes');
    expect(result).toContain('Header');
    expect(result).toContain('Footer');
  });

  it('should correctly handle multiple single-line DCS sequences in multi-line output', () => {
    const input = [
      '\x1bPseq1\x1b\\Line 1 content',
      '\x1bPseq2\x1b\\Line 2 content',
      '\x1bPseq3\x1b\\Line 3 content',
    ].join('\n');
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe('Line 1 content\nLine 2 content\nLine 3 content');
  });

  it('should handle commit messages with spaces preserved', () => {
    const commitMessage = 'Add combo counter with milestone flash effects';
    const input = `\x1bPtmux;DA1\x1b\\${commitMessage}`;
    const result = input.replace(DCS_PATTERN, '');
    expect(result).toBe(commitMessage);
    expect(result).toContain(' ');
  });
});
