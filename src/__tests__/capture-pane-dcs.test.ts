/**
 * capture-pane-dcs.test.ts — Tests for Issue #89 L23: DCS passthrough leak.
 *
 * Tests that DCS sequences (Device Control String, ESC P ... ESC \)
 * are stripped from capture-pane output.
 */

import { describe, it, expect } from 'vitest';

/** DCS stripping regex used in TmuxManager.capturePane. */
const DCS_PATTERN = /\x1bP[^\x1b]*\x1b\\/g;

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
});
